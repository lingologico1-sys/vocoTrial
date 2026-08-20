import { json } from '../_middleware';
import { type VocoSessionEnv, readVocoSessions } from './_library';

/**
 * Every saved Voco Session, whole.
 *
 * Like evaluators/list.ts this strips nothing: one is a few hundred bytes and
 * the picker needs its questions to show what is in it before you choose it.
 * There is no second route to fetch one by id, because there would be nothing
 * left for it to fetch.
 *
 * There is no built-in to merge in on the way out, unlike evaluators — see the
 * header in vocoSessions.ts on why "no lesson" is a supported answer here. An
 * empty list is a working deployment nobody has written a lesson for yet.
 */
export async function onRequestPost(
  context: EventContext<VocoSessionEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.VOCO_SESSIONS) {
    return json({ error: 'No Voco Session library is configured', code: 'no_bucket' }, 500);
  }

  return json({ sessions: await readVocoSessions(env.VOCO_SESSIONS) });
}
