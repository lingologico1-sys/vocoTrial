import { json } from '../_middleware';
import type { LipsyncEnv } from './_library';
import { lookupVoice } from './_voice';

/** Resolve a voice's labels without exposing the ElevenLabs key to the browser. */
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

  const found = await lookupVoice(voiceId, env.ELEVENLABS_API_KEY);
  if (!found.ok) {
    return json(
      {
        error: 'ElevenLabs could not find that voice',
        code: 'voice_lookup',
        detail: found.detail,
      },
      // A 401 is this deployment's key, not the ID that was pasted. Reported as ours so
      // nobody goes looking for a typo in a voice ID that was correct all along.
      found.status === 401 ? 500 : found.status,
    );
  }
  return json(found.voice);
}
