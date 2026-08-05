import { agentInstructions } from '../session/_agent';
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
 * time for the length of every call. The OpenAI path still goes direct over
 * WebRTC and is unaffected.
 *
 * What survives from the old design is the part that mattered: GOOGLE_API_KEY
 * stays server-side, and the agent's configuration is not the browser's to
 * choose — see the setup handling below.
 */

/**
 * https, not wss. A Worker opens an outbound WebSocket by fetching with an
 * Upgrade header, and the Fetch API refuses any scheme but http(s) — a wss://
 * URL here throws "Fetch API cannot load" before the request is made.
 */
const UPSTREAM =
  'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

export async function onRequest(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'Expected a WebSocket upgrade', code: 'not_websocket' }, 426);
  }

  if (!env.GOOGLE_API_KEY) {
    return json({ error: 'GOOGLE_API_KEY is not configured', code: 'no_key' }, 500);
  }

  // Same allowlist the session routes use: a key, never a raw model id.
  const params = new URL(request.url).searchParams;
  const key = params.get('model') ?? '';
  const choice = findModel(key);
  if (!choice || choice.provider !== 'gemini') {
    return json({ error: `Unknown Gemini model "${key}"`, code: 'bad_model' }, 400);
  }

  const language = findLanguage(params.get('language') ?? defaultLanguageCode());
  if (!language) {
    return json({ error: 'Unsupported language', code: 'bad_language' }, 400);
  }

  /**
   * The key rides in the query string because that is the only credential form
   * Google's Live endpoint accepts, so anything logged about this request has
   * to be scrubbed first. It is not hypothetical: the wss:// bug above threw a
   * TypeError whose message quoted the whole URL, and the key went straight
   * into the Worker log with it.
   */
  const scrub = (text: string) => text.split(env.GOOGLE_API_KEY!).join('<redacted>');

  const upstreamUrl = new URL(UPSTREAM);
  upstreamUrl.searchParams.set('key', env.GOOGLE_API_KEY);

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
   * The Worker sends setup itself, and drops any the browser tries to send.
   *
   * This is what the ephemeral token's `bidiGenerateContentSetup` used to
   * guarantee. Without it, a visitor could open this socket and send their own
   * system instruction, turning a metered key into a general-purpose assistant
   * — the browser gets to stream audio, not to redefine the agent.
   */
  /**
   * The language is carried by the system instruction alone, with no
   * speechConfig.languageCode alongside it. Google documents that field as
   * unsupported on native-audio models, which pick their language from the
   * conversation — and one of the two models offered here is native audio, so
   * setting it would break that call to configure the other one. Gemini's input
   * transcription takes no language hint either way, so unlike the OpenAI path
   * the choice steers what the agent *speaks*, not how the user is transcribed.
   */
  google.send(
    JSON.stringify({
      setup: {
        model: `models/${choice.id}`,
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: agentInstructions(language) }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }),
  );

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

  fromWorker.addEventListener('message', (event) => {
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

  return new Response(null, { status: 101, webSocket: toBrowser });
}
