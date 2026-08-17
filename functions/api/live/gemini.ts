import { geminiSetup } from './_setup';
import { VERTEX_KEY_NAMES, VERTEX_LIVE_URL, vertexKey, vertexModel } from '../_vertex';
import { AISTUDIO_KEY_NAME, AISTUDIO_LIVE_URL, aiStudioKey, aiStudioModel } from '../_aistudio';
import { resolveInstructions, resolveSettings } from './_resolve';
import { findModel } from '../../../src/realtime/models';
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
 * The cost is real and worth stating: audio now hops through Cloudflare instead
 * of going browser-to-Google, which adds a leg of latency and bills Worker
 * time for the length of every call. It is the only voice path the app has —
 * the OpenAI Realtime one, which went direct over WebRTC and paid neither, was
 * removed — so nothing here is a fallback for anything.
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

/**
 * How long to wait for the browser's config frame before setting up without it.
 *
 * A socket carries no request body, so instructions and settings arrive as the
 * first frame the client sends rather than in the URL — they are far too long
 * for a query string. That makes the handshake dependent on a client that knows
 * to send one, and a cached older bundle does not. Rather than hang forever
 * waiting, fall back to the defaults after this long and let the call proceed.
 */
const CONFIG_GRACE_MS = 3_000;

/**
 * Reads a `{"config": …}` opening frame, or reports that this is not one.
 *
 * `null` means "not a config frame" and is distinct from a config frame with
 * nothing in it, which means "use the defaults" and is a perfectly ordinary
 * thing for the client to send.
 */
function readConfigFrame(data: unknown): { config: unknown } | null {
  if (typeof data !== 'string') return null;

  try {
    const parsed = JSON.parse(data) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || !('config' in parsed)) return null;
    return { config: parsed.config ?? {} };
  } catch {
    return null;
  }
}

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
    return json({ error: `Unknown Gemini model "${modelKey}"`, code: 'bad_model' }, 400);
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
  const key = aiStudio ? aiStudioKey(env) : vertexKey(env);
  if (!key) {
    const names = aiStudio ? AISTUDIO_KEY_NAME : VERTEX_KEY_NAMES;
    return json({ error: `${names} is not configured`, code: 'no_key' }, 500);
  }

  const liveUrl = aiStudio ? AISTUDIO_LIVE_URL : VERTEX_LIVE_URL;
  const modelPath = aiStudio ? aiStudioModel(choice.id) : vertexModel(choice.id);

  const language = findLanguage(params.get('language') ?? defaultLanguageCode());
  if (!language) {
    return json({ error: 'Unsupported language', code: 'bad_language' }, 400);
  }

  /**
   * The key rides in the query string because that is the only credential form
   * Google's Live endpoint accepts, so anything logged about this request has
   * to be scrubbed first. It is not hypothetical: the wss:// scheme bug that
   * VERTEX_LIVE_URL still carries a note about threw a TypeError whose message
   * quoted the whole URL, and the key went straight into the Worker log with it.
   */
  const scrub = (text: string) => text.split(key).join('<redacted>');

  const upstreamUrl = new URL(liveUrl);
  upstreamUrl.searchParams.set('key', key);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), { headers: { Upgrade: 'websocket' } });
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

  /**
   * Forwards a frame, normalising whatever the runtime handed us.
   *
   * `event.data` is not always a string or ArrayBuffer here — Google's frames
   * arrive as Blobs, and `send()` turns a Blob into the literal text
   * "[object Blob]", which is what the browser received before this existed.
   *
   * Sends go through a per-direction promise chain because the Blob conversion
   * is async: forwarding without one lets a converted frame overtake a
   * synchronous one, and a Live stream reordered by even one frame is audible.
   */
  const forwarder = (target: WebSocket) => {
    let chain: Promise<void> = Promise.resolve();
    return (data: unknown) => {
      chain = chain
        .then(async () => {
          const payload =
            typeof data === 'string' || data instanceof ArrayBuffer
              ? data
              : await new Response(data as BodyInit).arrayBuffer();
          target.send(payload);
        })
        .catch(() => {
          // The peer went away mid-flight; the close handlers tear the pair down.
        });
    };
  };

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
        setup: geminiSetup(modelPath, written.value, resolveSettings(config, choice)),
      }),
    );
    return true;
  };

  const grace = setTimeout(() => sendSetup(null), CONFIG_GRACE_MS);

  fromWorker.addEventListener('message', (event) => {
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
    toClient(event.data);
  });

  // Either side closing must close the other, or the survivor leaks for the
  // rest of the request's lifetime — and a hung Live socket bills for it.
  const bridgeClose = (a: WebSocket, b: WebSocket) => {
    a.addEventListener('close', (event) => {
      try {
        b.close(event.code === 1006 ? 1011 : event.code, event.reason);
      } catch {
        /* already closed */
      }
    });
    a.addEventListener('error', () => {
      try {
        b.close(1011, 'peer error');
      } catch {
        /* already closed */
      }
    });
  };
  bridgeClose(google, fromWorker);
  bridgeClose(fromWorker, google);

  // A call that dies during the handshake must not leave the grace timer armed:
  // it would fire into a closed socket and throw out of a bare setTimeout.
  fromWorker.addEventListener('close', () => clearTimeout(grace));
  google.addEventListener('close', () => clearTimeout(grace));

  return new Response(null, { status: 101, webSocket: toBrowser });
}
