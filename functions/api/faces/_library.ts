/**
 * The R2 side of the shared face library.
 *
 * faceKit authors a kit in one browser's IndexedDB, which is where every kit
 * lived until now — good enough while one person on one laptop was the whole
 * audience, and useless the moment a face has to appear on a machine that never
 * authored it. Publishing copies the kit here, and every other browser reads it
 * back through these routes. R2 rather than KV because a kit is nine PNGs: blob
 * shaped, past KV's value ceiling, and cheaper per byte in the store built for
 * exactly this.
 *
 * ONE WRITER IS ASSUMED. The index is read, edited and written back, so two
 * publishes landing together can lose one of the two entries — the kits
 * themselves are already safely written by then, so the loss is a face missing
 * from the listing until something republishes it. Worth knowing and not worth
 * a lock: the author is one person at one keyboard, and the students this is
 * built towards will never hold a write credential.
 */

import { INDEX_KEY, type PublishedFace } from '../../../src/facekit/published';

export interface LibraryEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so that a deployment without the binding answers with a plain
   * message rather than throwing on the first property access — the posture
   * every key check in _vertex.ts already takes.
   */
  FACES?: R2Bucket;
}

export async function readIndex(bucket: R2Bucket): Promise<PublishedFace[]> {
  const object = await bucket.get(INDEX_KEY);
  if (!object) return [];

  try {
    const parsed = (await object.json()) as { faces?: unknown };
    return Array.isArray(parsed.faces) ? (parsed.faces as PublishedFace[]) : [];
  } catch {
    // A corrupt index is not a corrupt library: the kits are still in the
    // bucket under their own keys, and the next publish rewrites this from
    // whatever survived. Empty is the recoverable answer, so it is the one.
    return [];
  }
}

export function writeIndex(bucket: R2Bucket, faces: PublishedFace[]): Promise<unknown> {
  return bucket.put(INDEX_KEY, JSON.stringify({ faces }), {
    httpMetadata: { contentType: 'application/json' },
  });
}
