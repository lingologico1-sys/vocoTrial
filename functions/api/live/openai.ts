import { openAiSession } from './_setup';
import { resolveInstructions, resolveKeywords, resolveSettings } from './_resolve';
import {
  CONFIG_GRACE_MS,
  bridgeClose,
  forwarder,
  readConfigFrame,
  readPingFrame,
  upstreamWatch,
} from './_relay';
import { findModel, isOpenAi } from '../../../src/realtime/models';
import { defaultLanguageCode, findLanguage } from '../../../src/realtime/languages';
import { type GateEnv, json } from '../_middleware';

/**
 * Proxies the OpenAI realtime socket, browser <-> Worker <-> OpenAI.
 *
 * THE SAME SHAPE AS THE GEMINI RELAY, FOR A DIFFERENT REASON. That one is a
 * relay because Google's ephemeral tokens are refused as credentials on this
 * account, so there is no artefact a browser could safely hold. OpenAI has no
 * such problem — it mints `ek_...` client secrets that work from a browser, and
 * this app used to use them.
 *
 * IT IS A RELAY BY CHOICE, AND THE CHOICE IS ABOUT THE AUDIO AND NOT THE KEY.
 * The credential-safe browser path OpenAI recommends is WebRTC, and WebRTC does
 * the media work behind an <audio> element: no PCM in either direction. Every
 * instrument this project has reads PCM — the viseme mouth and the head motion
 * read the output analyser, the reveal queue schedules text against the output
 * clock, PcmPlayer reports its own underruns, MicCapture counts the bytes that
 * actually left the browser. All of that was built after the WebRTC path was
 * removed, and none of it survives going back. So this pays the extra hop and
 * the Worker time, and the browser gets raw 24 kHz PCM in both directions.
 *
 * (A browser WebSocket cannot carry an Authorization header, and OpenAI's
 * documented workaround is an `openai-insecure-api-key.<key>` subprotocol. The
 * name is not a joke: it puts a credential in a bundle. The Worker attaches a
 * real header instead, which is the other thing this relay buys.)
 */

/** The realtime endpoint. The model rides in the query string. */
const OPENAI_LIVE_URL = 'https://api.openai.com/v1/realtime';

/** The secret this route spends. Face-kit generation used to spend it too. */
const OPENAI_KEY_NAME = 'OPENAI_API_KEY';


export async function onRequest(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'Expected a WebSocket upgrade', code: 'not_websocket' }, 426);
  }

  // The allowlist in models.ts: a key, never a raw model id. Same rule as the
  // Gemini route and for the same reason — the model decides the spend.
  const params = new URL(request.url).searchParams;
  const modelKey = params.get('model') ?? '';
  const choice = findModel(modelKey);
  if (!choice) {
    return json({ error: `Unknown model "${modelKey}"`, code: 'bad_model' }, 400);
  }
  if (!isOpenAi(choice)) {
    return json(
      { error: `"${modelKey}" is not an OpenAI model`, code: 'wrong_provider' },
      400,
    );
  }

  const key = env.OPENAI_API_KEY;
  if (!key) {
    return json({ error: `${OPENAI_KEY_NAME} is not configured`, code: 'no_key' }, 500);
  }

  const language = findLanguage(params.get('language') ?? defaultLanguageCode());
  if (!language) {
    return json({ error: 'Unsupported language', code: 'bad_language' }, 400);
  }

  /*
   * The key rides in a header, which is the one place this route has it easier
   * than the Gemini one — that endpoint accepts a credential only in the query
   * string, so anything it logs has to be scrubbed first. Scrubbing is kept
   * here anyway: an error thrown out of `fetch` can quote the request, and a
   * header is part of a request.
   */
  const scrub = (text: string) => text.split(key).join('<redacted>');

  const upstreamUrl = new URL(OPENAI_LIVE_URL);
  upstreamUrl.searchParams.set('model', choice.id);

  // Measured around the upgrade, for the reason the Gemini route measures it:
  // one honest sample of the path from this colo to that endpoint, taken on the
  // socket the call then runs over. See upstreamWatch.
  const reachedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${key}` },
    });
  } catch (error) {
    console.error(
      'openai realtime fetch failed',
      scrub(error instanceof Error ? error.message : String(error)),
    );
    return json({ error: 'Could not reach OpenAI', code: 'upstream' }, 502);
  }

  const openai = upstream.webSocket;
  if (!openai) {
    console.error('openai realtime upgrade failed', upstream.status, scrub(await upstream.text()));
    return json({ error: 'OpenAI refused the socket', code: 'upstream' }, 502);
  }

  const pair = new WebSocketPair();
  const [toBrowser, fromWorker] = Object.values(pair);

  openai.accept();
  fromWorker.accept();

  const toOpenAi = forwarder(openai);
  const toClient = forwarder(fromWorker);
  const watch = upstreamWatch(Date.now() - reachedAt);

  /**
   * The Worker composes the session, from a config the browser is allowed to
   * write.
   *
   * SAME RULE AS THE GEMINI ROUTE, DIFFERENT FRAME. There the model is named in
   * the `setup` message, so a client-sent `setup` would be a client choosing
   * the meter. Here the model is fixed by the query string at the handshake and
   * cannot be changed afterwards — but `session.update` still carries the
   * instructions, the voice, the tools and the token ceiling, and a browser
   * that could send its own would be a browser that could hand this account's
   * key to a tutor with no lesson and no cap. So one goes out from here and any
   * arriving from the client is dropped.
   *
   * THE HANDSHAKE IS ALREADY DONE WHEN THIS RUNS, which is the structural
   * difference worth knowing. Gemini refuses every frame until it has a setup;
   * OpenAI has a live session on the model the moment the socket opens, running
   * on its own defaults. So the window between the socket opening and this
   * landing is a window in which the far end would answer — and the browser
   * holds its microphone shut until `session.updated` comes back for exactly
   * that reason. See setupDone in src/realtime/openai.ts.
   */
  let sessionSent = false;

  const sendSession = (config: unknown): boolean => {
    if (sessionSent) return true;
    sessionSent = true;
    clearTimeout(grace);

    const written = resolveInstructions(config, language);
    if (!written.ok) {
      // The upgrade has already happened, so there is no JSON body left to
      // refuse with. A close reason is the only channel that reaches the user,
      // and src/realtime/openai.ts surfaces it verbatim.
      try {
        fromWorker.close(1008, written.error);
        openai.close(1000, 'session refused');
      } catch {
        /* already closed */
      }
      return false;
    }

    openai.send(
      JSON.stringify({
        type: 'session.update',
        session: openAiSession(
          choice,
          language,
          written.value,
          resolveSettings(config, choice),
          resolveKeywords(config),
        ),
      }),
    );
    return true;
  };

  const grace = setTimeout(() => sendSession(null), CONFIG_GRACE_MS);

  fromWorker.addEventListener('message', (event) => {
    // Answered here and never forwarded, and tested before the config check
    // below — a ping reaching that check would be read as "this client is not
    // going to send a config", and the call would run on OpenAI's own defaults.
    const ping = readPingFrame(event.data);
    if (ping !== null) {
      watch.answer(ping, fromWorker, toClient);
      return;
    }

    if (!sessionSent) {
      const frame = readConfigFrame(event.data);
      // A config frame is consumed here; anything else means this client is not
      // going to send one, so configure with the defaults and pass the frame on.
      if (!sendSession(frame ? frame.config : null)) return;
      if (frame) return;
    }

    // The client's own session.update, dropped. See sendSession above.
    if (typeof event.data === 'string' && event.data.includes('"session.update"')) return;
    toOpenAi(event.data);
  });

  openai.addEventListener('message', (event) => {
    watch.note();
    toClient(event.data);
  });

  bridgeClose(openai, fromWorker);
  bridgeClose(fromWorker, openai);

  // A call that dies during the handshake must not leave the grace timer armed:
  // it would fire into a closed socket and throw out of a bare setTimeout.
  fromWorker.addEventListener('close', () => clearTimeout(grace));
  openai.addEventListener('close', () => clearTimeout(grace));

  return new Response(null, { status: 101, webSocket: toBrowser });
}
