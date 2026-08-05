import { agentInstructions } from './_agent';
import { readJson, resolveLanguage, resolveModel } from './_resolve';
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
  const model = resolved.value;

  const chosen = resolveLanguage(body);
  if (!chosen.ok) {
    return json({ error: chosen.error, code: 'bad_language' }, 400);
  }
  const language = chosen.value;

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
        instructions: agentInstructions(language),
        audio: {
          // Without an input transcription model the API returns audio only,
          // and the UI has nothing to show for what the user just said.
          //
          // whisper-1 is deliberate, not legacy. It transcribes the utterance
          // whole rather than streaming it, so it can use the end of a sentence
          // to make sense of the start — which is where a learner's speech is
          // hardest to read. A streaming model would put words on screen sooner
          // but commit to each guess before hearing what follows. The transcript
          // arrives after the reply has begun; src/App.tsx orders turns by
          // conversation item so that lag does not scramble the log.
          //
          // `language` stops it hedging between languages, which is the failure
          // that costs a learner the most: a hesitant French sentence decoded as
          // English comes back as plausible nonsense rather than as a mistake
          // they can see. `prompt` is a style hint — see languages.ts.
          input: {
            transcription: {
              model: 'whisper-1',
              language: language.code,
              prompt: language.sample,
            },
          },
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
