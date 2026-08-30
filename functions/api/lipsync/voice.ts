import { json } from '../_middleware';
import type { LipsyncEnv } from './_library';
import type { VoiceGender } from '../../../src/lipsync/laughs';

/** Resolve the optional gender label without exposing the ElevenLabs key to the browser. */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.ELEVENLABS_API_KEY) {
    return json(
      { error: 'ELEVENLABS_API_KEY is not configured on this deployment', code: 'no_key' },
      500,
    );
  }
  let voiceId = '';
  try {
    ({ voiceId = '' } = (await request.json()) as { voiceId?: string });
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }
  voiceId = voiceId.trim();
  if (!voiceId) return json({ error: 'No voice chosen', code: 'no_voice' }, 400);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
    { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY } },
  );
  if (!response.ok) {
    const detail = await response.text();
    return json(
      { error: 'ElevenLabs could not find that voice', code: 'voice_lookup', detail: detail.slice(0, 400) },
      response.status === 401 ? 500 : response.status,
    );
  }
  const voice = (await response.json()) as {
    voice_id?: string;
    name?: string;
    labels?: Record<string, string> | null;
  };
  const labelled = voice.labels?.gender?.trim().toLowerCase();
  const gender: VoiceGender | undefined =
    labelled === 'male' || labelled === 'female' ? labelled : undefined;
  return json({ voiceId: voice.voice_id ?? voiceId, name: voice.name, gender });
}
