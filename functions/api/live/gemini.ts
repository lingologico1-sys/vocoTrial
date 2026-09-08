import { geminiSetup } from './_setup';
import { VERTEX_CRED_NAMES, VERTEX_LIVE_URL, VERTEX_LOCATION, vertexAuth } from '../_vertex';
import { AISTUDIO_KEY_NAME, AISTUDIO_LIVE_URL, aiStudioKey, aiStudioModel } from '../_aistudio';
import { resolveInstructions, resolveSettings } from './_resolve';
import {
  CONFIG_GRACE_MS,
  bridgeClose,
  forwarder,
  readConfigFrame,
  readPingFrame,
  upstreamWatch,
} from './_relay';
import { findModel, isGoogle } from '../../../src/realtime/models';
import { defaultLanguageCode, findLanguage } from '../../../src/realtime/languages';
import { type GateEnv, json } from '../_middleware';

/**
 * Proxies the Gemini Live socket, browser <-> Worker <-> Google.
 *
 * The ephemeral-token design this replaces could not work on this account:
 * `auth_tokens` mints happily, and the resulting token is then refused as a
 * credential *everywhere* — the Live socket, and plain REST too, whether passed
 * as ?key=, ?access_token=, a Bearer header or x-goog-api-key. It is not a
 * WebSocket problem, so no amount of fixing the socket call would have helped.
 *
 * The cost is real and worth stating: audio hops through Cloudflare instead of
 * going browser-to-Google, which adds a leg of latency and bills Worker time
 * for the length of every call. The OpenAI route beside this one pays it too,
 * and by choice rather than by necessity — see _relay.ts, which holds
 * everything the two have in common and the argument for why they have it.
 *
 * What survives from the old design is the part that mattered: the key stays
 * server-side, and the agent's configuration is not the browser's to choose —
 * see the setup handling below.
 *
 * The upstream is whichever of Google's two APIs carries the chosen model —
 * Vertex AI in express mode for 2.5 native audio, AI Studio for 3.1 Flash Live,
 * which has no Vertex build in any region. The relay is indifferent to which:
 * the socket is opened the same way and the frames are forwarded verbatim, and
 * the entire difference is three values resolved below from the model itself —
 * the URL, the key, and how the model is spelled in the setup frame. See
 * _vertex.ts and _aistudio.ts, and the Surface type in models.ts for why this
 * is a property of the model rather than a setting.
 */

export async function onRequest(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'Expected a WebSocket upgrade', code: 'not_websocket' }, 426);
  }

  // The allowlist in models.ts: a key, never a raw model id.
  const params = new URL(request.url).searchParams;
  const modelKey = params.get('model') ?? '';
  const choice = findModel(modelKey);
  if (!choice) {
    return json({ error: `Unknown model "${modelKey}"`, code: 'bad_model' }, 400);
  }
  /*
   * ONE ROUTE PER PROVIDER, AND THE ALLOWLIST IS SHARED BETWEEN THEM. A key
   * that names an OpenAI model is a real key — it is simply not this socket's
   * — so it is refused here rather than silently reaching for a Google URL
   * with a Google key and failing upstream with a message about a model id.
   * See functions/api/live/openai.ts.
   */
  if (!isGoogle(choice)) {
    return json(
      { error: `"${modelKey}" is not a Gemini model`, code: 'wrong_provider' },
      400,
    );
  }

  /**
   * Surface, key and model spelling all come from the model, not from config.
   *
   * The allowlist decides this, as it decides everything else spendable here:
   * the browser sends a key like "gemini-flash-31" and cannot reach for the
   * other account by asking. Note there is deliberately no cross-surface
   * fallback — see the note in _aistudio.ts on why an error is not a reason to
   * retry somewhere else.
   */
  const aiStudio = choice.surface === 'aistudio';

  /*
   * THE TWO SURFACES NO LONGER CARRY THEIR CREDENTIAL THE SAME WAY, which is the
   * one asymmetry to keep in mind here. AI Studio still takes an API key, and
   * takes it in the query string. Vertex takes an OAuth bearer token from a
   * service account, in a header — see _vertex.ts for why it left express mode.
   * Both are resolved before either is used so a missing one is still a single
   * `no_key` answer rather than two.
   */
  const studioKey = aiStudio ? aiStudioKey(env) : undefined;
  const vertex = aiStudio ? null : await vertexAuth(env);
  if (aiStudio ? !studioKey : !vertex) {
    const names = aiStudio ? AISTUDIO_KEY_NAME : VERTEX_CRED_NAMES;
    return json({ error: `${names} is not configured`, code: 'no_key' }, 500);
  }

  const liveUrl = aiStudio ? AISTUDIO_LIVE_URL : VERTEX_LIVE_URL;

  /*
   * VERTEX_LOCATION, not the `global` this app's REST calls use. The bidi
   * service is regional and the model path has to agree with the host it is
   * sent to; a mismatch closes the socket with a 1007 or 1008 that reads like a
   * wrong model id. See the note on VERTEX_LIVE_URL.
   */
  const modelPath =
    aiStudio || !vertex ? aiStudioModel(choice.id) : vertex.model(choice.id, VERTEX_LOCATION);

  const language = findLanguage(params.get('language') ?? defaultLanguageCode());
  if (!language) {
    return json({ error: 'Unsupported language', code: 'bad_language' }, 400);
  }

  /**
   * Nothing spendable may reach a log, whichever form it took.
   *
   * Not hypothetical: the wss:// scheme bug that VERTEX_LIVE_URL still carries a
   * note about threw a TypeError whose message quoted the whole URL, and the
   * credential went into the Worker log with it. On AI Studio that is still the
   * risk exactly as described, because the key is still in the URL. On Vertex
   * the token is in a header and no longer appears in the URL at all — but it is
   * scrubbed the same way regardless, because an error's message is not
   * something this code chooses the contents of.
   */
  const secret = aiStudio ? (studioKey as string) : (vertex as NonNullable<typeof vertex>).token;
  const scrub = (text: string) => text.split(secret).join('<redacted>');

  const upstreamUrl = new URL(liveUrl);
  if (aiStudio) upstreamUrl.searchParams.set('key', studioKey as string);

  /*
   * A Worker opens an outbound socket by fetching with an Upgrade header, which
   * is the whole reason the bearer token can travel here at all: a browser's
   * WebSocket cannot set a header, and this is not a browser.
   */
  const upgradeHeaders: Record<string, string> = { Upgrade: 'websocket' };
  if (!aiStudio && vertex) Object.assign(upgradeHeaders, vertex.headers);

  /**
   * How long the Worker took to reach Google, in ms.
   *
   * The other half of the detour — see readPingFrame. Measured around the
   * upgrade rather than sampled during the call, because there is nothing in
   * the Live protocol the Worker may send upstream purely to time it: every
   * frame Google accepts is a frame that changes the conversation. A handshake
   * is one honest sample of the path from this colo to that endpoint, taken on
   * the same socket the call then runs over, and it is what the browser's own
   * ping cannot see.
   */
  const reachedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), { headers: upgradeHeaders });
  } catch (error) {
    console.error('gemini live fetch failed', scrub(error instanceof Error ? error.message : String(error)));
    return json({ error: 'Could not reach Google', code: 'upstream' }, 502);
  }

  const google = upstream.webSocket;
  if (!google) {
    console.error('gemini live upgrade failed', upstream.status, scrub(await upstream.text()));
    return json({ error: 'Google refused the socket', code: 'upstream' }, 502);
  }

  const pair = new WebSocketPair();
  const [toBrowser, fromWorker] = Object.values(pair);

  google.accept();
  fromWorker.accept();

  const toGoogle = forwarder(google);
  const toClient = forwarder(fromWorker);

  /**
   * The Worker composes setup, from a config the browser is allowed to write.
   *
   * The client never sends a `setup` frame of its own — one arriving from that
   * direction is still dropped below. That is not about the prompt any more,
   * which the panel now sets on purpose: it is that `setup` also names the
   * *model*, and the model is what decides which meter the key is spent
   * against. The browser gets to say what the agent should do; the allowlist in
   * models.ts says what it may cost.
   *
   * The language is carried by the system instruction alone — see the note in
   * settings.ts on why no speechConfig.languageCode is sent. Gemini's input
   * transcription takes no language hint either way, so the choice steers what
   * the agent *speaks* rather than how the user is transcribed.
   */
  let setupSent = false;

  const sendSetup = (config: unknown): boolean => {
    if (setupSent) return true;
    setupSent = true;
    clearTimeout(grace);

    const written = resolveInstructions(config, language);
    if (!written.ok) {
      // The upgrade has already happened, so there is no JSON body left to
      // refuse with. A close reason is the only channel that reaches the user,
      // and src/realtime/gemini.ts surfaces it verbatim.
      try {
        fromWorker.close(1008, written.error);
        google.close(1000, 'setup refused');
      } catch {
        /* already closed */
      }
      return false;
    }

    google.send(
      JSON.stringify({
        setup: geminiSetup(
          choice,
          modelPath,
          language,
          written.value,
          resolveSettings(config, choice),
        ),
      }),
    );
    return true;
  };

  const grace = setTimeout(() => sendSetup(null), CONFIG_GRACE_MS);

  const watch = upstreamWatch(Date.now() - reachedAt);

  fromWorker.addEventListener('message', (event) => {
    /*
     * Answered here and never forwarded, and tested before the config check
     * below — a ping reaching that check would be read as "this client is not
     * going to send a config", and the call would set up on the defaults.
     */
    const ping = readPingFrame(event.data);
    if (ping !== null) {
      watch.answer(ping, fromWorker, toClient);
      return;
    }

    if (!setupSent) {
      const frame = readConfigFrame(event.data);
      // A config frame is consumed here; anything else means this client is not
      // going to send one, so set up with the defaults and pass the frame on.
      if (!sendSetup(frame ? frame.config : null)) return;
      if (frame) return;
    }

    if (typeof event.data === 'string' && event.data.includes('"setup"')) return;
    toGoogle(event.data);
  });

  google.addEventListener('message', (event) => {
    watch.note();
    toClient(event.data);
  });

  bridgeClose(google, fromWorker);
  bridgeClose(fromWorker, google);

  // A call that dies during the handshake must not leave the grace timer armed:
  // it would fire into a closed socket and throw out of a bare setTimeout.
  fromWorker.addEventListener('close', () => clearTimeout(grace));
  google.addEventListener('close', () => clearTimeout(grace));

  return new Response(null, { status: 101, webSocket: toBrowser });
}
