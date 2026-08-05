import { AGENT_INSTRUCTIONS } from './_agent';
import { readJson, resolveModel } from './_resolve';
import { type GateEnv, json } from '../_middleware';

/**
 * Mints a short-lived OpenAI Realtime client secret.
 *
 * The browser cannot hold OPENAI_API_KEY — anything in a bundle is public — so
 * it gets an `ek_...` secret instead, which is scoped to one Realtime session
 * and expires in minutes. The browser then does the WebRTC SDP exchange with
 * OpenAI directly (src/realtime/openai.ts): audio never transits this Worker,
 * which is what keeps latency at conversation speed.
 */

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const DEFAULT_VOICE = 'marin';

interface ClientSecretResponse {
  value?: string;
  expires_at?: number;
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not configured', code: 'no_key' }, 500);
  }

  const resolved = resolveModel(await readJson(request), 'openai');
  if (resolved.error) {
    return json({ error: resolved.error, code: 'bad_model' }, 400);
  }
  const model = resolved.id;

  const upstream = await fetch(CLIENT_SECRETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model,
        instructions: AGENT_INSTRUCTIONS,
        audio: {
          // Without an input transcription model the API returns audio only,
          // and the UI has nothing to show for what the user just said.
          input: { transcription: { model: 'whisper-1' } },
          output: { voice: env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE },
        },
      },
    }),
  });

  if (!upstream.ok) {
    // Surface the status but not the body: an upstream error can quote the
    // request back, and the request contains the account's own key material.
    const detail = await upstream.text();
    console.error('openai client_secrets failed', upstream.status, detail);
    return json(
      { error: 'Could not start an OpenAI session', code: 'upstream', status: upstream.status },
      502,
    );
  }

  const secret = (await upstream.json()) as ClientSecretResponse;
  if (!secret.value) {
    console.error('openai client_secrets returned no value', secret);
    return json({ error: 'Malformed response from OpenAI', code: 'upstream' }, 502);
  }

  // The model goes back with the token because the browser needs it for the
  // SDP exchange, and it is configured here (wrangler.toml) rather than there.
  return json({ token: secret.value, model, expiresAt: secret.expires_at ?? null });
}
