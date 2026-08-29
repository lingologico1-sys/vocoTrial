import { json } from '../_middleware';
import { type LipsyncEnv, readIndex } from './_library';

/**
 * Every saved line, without its marks or its audio.
 *
 * One R2 read, small enough to draw a picker from. A package is fetched one at a time by
 * get.ts and only when one is actually going to be played -- the same split faces/list.ts
 * makes, and for the same reason: a listing that carried every mark array would be
 * megabytes to answer a question about names.
 */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }
  return json({ lines: await readIndex(env.LIPSYNC) });
}
