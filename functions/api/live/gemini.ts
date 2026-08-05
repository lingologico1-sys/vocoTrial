import { AGENT_INSTRUCTIONS } from '../session/_agent';
import { findModel } from '../../../src/realtime/models';
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

const UPSTREAM =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

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
  const key = new URL(request.url).searchParams.get('model') ?? '';
  const choice = findModel(key);
  if (!choice || choice.provider !== 'gemini') {
    return json({ error: `Unknown Gemini model "${key}"`, code: 'bad_model' }, 400);
  }

  const upstream = await fetch(`${UPSTREAM}?key=${env.GOOGLE_API_KEY}`, {
    headers: { Upgrade: 'websocket' },
  });

  const google = upstream.webSocket;
  if (!google) {
    console.error('gemini live upgrade failed', upstream.status, await upstream.text());
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
  google.send(
    JSON.stringify({
      setup: {
        model: `models/${choice.id}`,
        generationConfig: { responseModalities: ['AUDIO'] },
        systemInstruction: { parts: [{ text: AGENT_INSTRUCTIONS }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }),
  );

  fromWorker.addEventListener('message', (event) => {
    if (typeof event.data === 'string' && event.data.includes('"setup"')) return;
    try {
      google.send(event.data);
    } catch {
      // Upstream went away; the close handlers below tear the pair down.
    }
  });

  google.addEventListener('message', (event) => {
    try {
      fromWorker.send(event.data);
    } catch {
      // Browser went away.
    }
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
