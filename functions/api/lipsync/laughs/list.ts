import { json } from '../../_middleware';
import { type LipsyncEnv, readClips } from '../_library';

/**
 * The whole library, without any audio: the laughs you provided and every voice each has
 * been rendered into.
 *
 * One R2 read, and both halves together because the panel needs both to draw a single row —
 * a laugh, and whether this voice has it yet. Audio is fetched by `laughs/get` and only
 * when something is going to be played.
 */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }
  return json(await readClips(env.LIPSYNC));
}
