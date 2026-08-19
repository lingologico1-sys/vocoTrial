/**
 * The R2 side of the shared evaluator library.
 *
 * Evaluators go to R2 rather than localStorage for the reason faces did: one
 * authored on this laptop has to reach a student on another, and a browser
 * store reaches nobody. Saved prompts in presets.ts stayed local because they
 * are the author's own workshop notes; a scale is the thing a student is
 * measured against, so it travels.
 *
 * ONE OBJECT, NOT AN INDEX AND A BLOB EACH. faces/_library.ts splits them
 * because a kit is nine PNGs — too big to list, so the listing is a separate,
 * small object naming them. A scale is a few kilobytes of text. The whole
 * library fits in one read, which makes a save a read-modify-write of a single
 * object rather than of an index and its members, and removes the window where
 * the two disagree.
 *
 * ONE WRITER IS ASSUMED, same as faces and for the same reason: the author is
 * one person at one keyboard, and the students this is built towards never hold
 * a write credential. Two saves landing together can lose one, which costs a
 * retype rather than data — worth knowing, not worth a lock.
 */

import { type Evaluator, looksLikeEvaluator } from '../../../src/realtime/evaluators';

/** Everything, in one object. See the note above on why it is not split. */
export const LIBRARY_KEY = 'evaluators.json';

export interface LibraryEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so that a deployment without the binding answers with a plain
   * message rather than throwing on the first property access — the posture
   * every key check in _vertex.ts already takes.
   */
  EVALUATORS?: R2Bucket;
}

export async function readLibrary(bucket: R2Bucket): Promise<Evaluator[]> {
  const object = await bucket.get(LIBRARY_KEY);
  if (!object) return [];

  try {
    const parsed = (await object.json()) as { evaluators?: unknown };
    if (!Array.isArray(parsed.evaluators)) return [];
    // Each entry is checked on its own, so one corrupt row does not cost the
    // rest of them — the same posture presets.ts takes on its store.
    return parsed.evaluators.filter(looksLikeEvaluator);
  } catch {
    // Nothing here is recoverable from elsewhere, unlike a corrupt face index
    // whose kits still sit in the bucket. Empty is still the right answer:
    // a save writes the whole object, so the next one repairs it.
    return [];
  }
}

export function writeLibrary(bucket: R2Bucket, evaluators: Evaluator[]): Promise<unknown> {
  return bucket.put(LIBRARY_KEY, JSON.stringify({ evaluators }), {
    httpMetadata: { contentType: 'application/json' },
  });
}
