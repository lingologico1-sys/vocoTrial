import { openAiSession } from './_providerConfig';
import {
  readJson,
  resolveInstructions,
  resolveLanguage,
  resolveModel,
  resolveSettings,
} from './_resolve';
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

  const body = await readJson(request);

  const resolved = resolveModel(body, 'openai');
  if (!resolved.ok) {
    return json({ error: resolved.error, code: 'bad_model' }, 400);
  }
  const choice = resolved.value;
  const model = choice.id;

  const chosen = resolveLanguage(body);
  if (!chosen.ok) {
    return json({ error: chosen.error, code: 'bad_language' }, 400);
  }
  const language = chosen.value;

  const written = resolveInstructions(body, language);
  if (!written.ok) {
    return json({ error: written.error, code: 'bad_instructions' }, 400);
  }

  const settings = resolveSettings(body, choice);

  /**
   * The env var is the fallback voice, not the voice. It stays because it is
   * how a deployment sets its own default without a code change; a voice picked
   * in the panel simply arrives already set in `settings` and wins.
   *
   * Everything else about the session — transcription, turn detection, speaking
   * rate — is assembled in _providerConfig.ts, which is also where the reasoning
   * behind each default lives.
   */
  const session = openAiSession(model, written.value, language, {
    voice: env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE,
    ...settings,
  });

  const upstream = await fetch(CLIENT_SECRETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session }),
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
