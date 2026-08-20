import { json } from '../_middleware';
import { looksLikePerformance } from '../../../src/realtime/house';
import { type HouseEnv, writePerformance } from './_library';

/**
 * Saves the house performance profile: how every published face moves.
 *
 * ONE OBJECT, OVERWRITTEN. There is no library of these and no id — see
 * house.ts on why a manner is a teacher's choice and a brow height is not. An
 * administrator tunes studio until the face looks right and presses save; the
 * next press replaces it. That is the whole lifecycle.
 *
 * IT TAKES EFFECT ON THE NEXT PUBLISH, NOT ON THE NEXT CALL. Setups already
 * published carry a flattened copy of whatever the profile was at the time, for
 * session.ts's reason: what was handed out stays handed out. So retuning does
 * not reach a class mid-lesson, and re-publishing is what carries it to them.
 *
 * The check is a shape check, not a range check. A brow lift of four hundred is
 * a slider nobody can reach from studio and a face that looks wrong if somebody
 * posts one by hand; a profile with no driver is a mouth with nothing driving
 * it, and that is the one worth refusing.
 */

interface SaveBody {
  performance?: unknown;
}

export async function onRequestPost(
  context: EventContext<HouseEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.HOUSE) {
    return json({ error: 'No house library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as SaveBody | null;
  if (!looksLikePerformance(body?.performance)) {
    return json({ error: 'That is not a performance profile', code: 'bad_profile' }, 400);
  }

  await writePerformance(env.HOUSE, body.performance);

  return json({ performance: body.performance });
}
