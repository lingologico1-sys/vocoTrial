import { json } from '../_middleware';
import { type LibraryEnv, readIndex } from './_library';

/**
 * Everything published, without the artwork.
 *
 * One R2 read, and what comes back is small enough to draw a picker from — see
 * the note on the index in facekit/published.ts. The kits themselves are asked
 * for one at a time, by get.ts, and only when one is actually going to be worn.
 */
export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.FACES) {
    return json({ error: 'No face library is configured', code: 'no_bucket' }, 500);
  }

  return json({ faces: await readIndex(env.FACES) });
}
