import { AGENT_INSTRUCTIONS } from './_agent';
import { type GateEnv, json } from '../_middleware';

/**
 * Mints a short-lived Gemini Live ephemeral auth token.
 *
 * Same reasoning as the OpenAI route: GOOGLE_API_KEY stays here, the browser
 * gets a single-use token and opens the Live WebSocket itself, so audio goes
 * browser <-> Google without a hop through this Worker.
 *
 * The ephemeral-token endpoint is on the v1alpha surface — the one part of
 * this file most likely to move. If minting starts failing with 404, check
 * whether it has graduated to v1beta before assuming the key is wrong.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1alpha';
const DEFAULT_MODEL = 'gemini-live-2.5-flash-preview';

/** How long the token may be used to *open* a session. */
const NEW_SESSION_WINDOW_MS = 2 * 60 * 1000;
/** How long a session opened with it may then run. */
const SESSION_LIFETIME_MS = 30 * 60 * 1000;

interface AuthTokenResponse {
  name?: string;
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;

  if (!env.GOOGLE_API_KEY) {
    return json({ error: 'GOOGLE_API_KEY is not configured', code: 'no_key' }, 500);
  }

  const model = env.GEMINI_LIVE_MODEL || DEFAULT_MODEL;
  const now = Date.now();

  const upstream = await fetch(`${API_BASE}/auth_tokens?key=${env.GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // One connection per token. A token that leaks after the browser has
      // used it is already spent.
      uses: 1,
      newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
      expireTime: new Date(now + SESSION_LIFETIME_MS).toISOString(),

      // Binding the model and the system instruction to the token is what
      // makes handing it to a browser safe: the holder can talk to *this*
      // agent and nothing else. Without constraints the token would be a
      // general-purpose key to the Live API on our account.
      //
      // The field is `bidiGenerateContentSetup`, and the nesting is flat —
      // no `config` wrapper, and responseModalities sits under
      // generationConfig. The Python SDK calls this `live_connect_constraints`
      // with a nested config, which is the SDK's own shape, not the REST
      // one; sending that spelling gets "Unknown name" and a 400. Verified
      // against the v1alpha discovery document:
      //   https://generativelanguage.googleapis.com/$discovery/rest?version=v1alpha
      bidiGenerateContentSetup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
        systemInstruction: {
          parts: [{ text: AGENT_INSTRUCTIONS }],
        },
        // Both sides of the conversation as text, so the UI has something to
        // render. Off by default — audio-only is the cheaper path.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    console.error('gemini auth_tokens failed', upstream.status, detail);
    return json(
      { error: 'Could not start a Gemini session', code: 'upstream', status: upstream.status },
      502,
    );
  }

  const token = (await upstream.json()) as AuthTokenResponse;
  if (!token.name) {
    console.error('gemini auth_tokens returned no name', token);
    return json({ error: 'Malformed response from Google', code: 'upstream' }, 502);
  }

  // The token *is* the resource name ("auth_tokens/..."), passed verbatim as
  // the access_token query parameter on the WebSocket URL.
  return json({
    token: token.name,
    model,
    expiresAt: Math.floor((now + SESSION_LIFETIME_MS) / 1000),
  });
}
