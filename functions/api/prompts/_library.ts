/**
 * The R2 side of the shared prompt library.
 *
 * The journey faces and evaluators already made, made once more and for the
 * same sentence: a prompt authored on this laptop has to be publishable from
 * that one, and a browser store reaches nobody. See savedPrompts.ts for why
 * the old defence of localStorage stopped holding.
 *
 * ONE OBJECT, NOT AN INDEX AND A BLOB EACH, for evaluators/_library.ts's
 * reason: a prompt is a few kilobytes of text, the whole library fits in one
 * read, and a save is then a read-modify-write of a single object rather than
 * of an index and its members — which removes the window where the two
 * disagree.
 *
 * ONE WRITER IS ASSUMED, same as faces and evaluators. Two saves landing
 * together can lose one, which costs a retype rather than data.
 *
 * THE BUILT-INS ARE NEVER IN HERE. They are functions of the language compiled
 * into the bundle and the Worker, and the browser merges them in front of
 * whatever this returns — so a deployment with no bucket, or one where nobody
 * has saved anything, still has five working prompts rather than an empty
 * picker.
 */

import { type SavedPrompt, looksLikeSavedPrompt } from '../../../src/realtime/savedPrompts';

/** Everything, in one object. See the note above on why it is not split. */
export const LIBRARY_KEY = 'prompts.json';

export interface LibraryEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so that a deployment without the binding answers with a plain
   * message rather than throwing on the first property access — the posture
   * every key check in _vertex.ts already takes.
   */
  PROMPTS?: R2Bucket;
}

export async function readLibrary(bucket: R2Bucket): Promise<SavedPrompt[]> {
  const object = await bucket.get(LIBRARY_KEY);
  if (!object) return [];

  try {
    const parsed = (await object.json()) as { prompts?: unknown };
    if (!Array.isArray(parsed.prompts)) return [];
    // Each entry is checked on its own, so one corrupt row does not cost the
    // rest of them — the posture the localStorage store took before it.
    return parsed.prompts.filter(looksLikeSavedPrompt);
  } catch {
    // Empty is still the right answer: a save writes the whole object, so the
    // next one repairs it.
    return [];
  }
}

export function writeLibrary(bucket: R2Bucket, prompts: SavedPrompt[]): Promise<unknown> {
  return bucket.put(LIBRARY_KEY, JSON.stringify({ prompts }), {
    httpMetadata: { contentType: 'application/json' },
  });
}
