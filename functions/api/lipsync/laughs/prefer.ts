import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import {
  originalFor,
  treatmentOf,
  type LaughTreatment,
  type VoiceGender,
} from '../../../../src/lipsync/laughs';

/** Choose original or converted for one source in one exact voice. */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  let body: {
    sourceId?: string;
    voiceId?: string;
    voiceGender?: VoiceGender;
    treatment?: LaughTreatment;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }
  const sourceId = (body.sourceId ?? '').trim();
  const voiceId = (body.voiceId ?? '').trim();
  if (!sourceId || !voiceId) return json({ error: 'No source or voice', code: 'missing' }, 400);
  if (body.treatment !== 'original' && body.treatment !== 'voice-converted') {
    return json({ error: 'Unknown treatment', code: 'bad_treatment' }, 400);
  }

  const library = await readClips(env.LIPSYNC);
  const source = library.sources.find((entry) => entry.id === sourceId);
  if (!source) return json({ error: 'No such laugh', code: 'not_found' }, 404);
  if (!source.gender || source.gender !== body.voiceGender) {
    return json({ error: 'That laugh is not in this voice gender pool', code: 'gender_mismatch' }, 400);
  }
  const exists = body.treatment === 'original'
    ? Boolean(originalFor(library.renders, sourceId))
    : library.renders.some(
        (render) =>
          render.sourceId === sourceId &&
          treatmentOf(render) === 'voice-converted' &&
          render.voiceId === voiceId,
      );
  if (!exists) return json({ error: 'That version does not exist', code: 'not_found' }, 404);

  const updated = {
    ...source,
    preferredTreatmentByVoice: {
      ...(source.preferredTreatmentByVoice ?? {}),
      [voiceId]: body.treatment,
    },
  };
  await writeClips(env.LIPSYNC, {
    sources: library.sources.map((entry) => (entry.id === sourceId ? updated : entry)),
    renders: library.renders,
  });
  return json({ source: updated });
}
