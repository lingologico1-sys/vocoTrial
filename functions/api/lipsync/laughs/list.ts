import { json } from '../../_middleware';
import { type LipsyncEnv, readClips } from '../_library';

/**
 * Every kept laugh, without its audio.
 *
 * One R2 read. The audio is fetched by `laughs/get` and only when something is going to
 * be played, the same split list.ts makes for lines — except that a clip's whole record
 * is small enough that this listing is genuinely everything a picker needs.
 */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }
  return json({ clips: await readClips(env.LIPSYNC) });
}
