/**
 * The R2 side of the shared Voco Session library.
 *
 * ONE OBJECT, for evaluators/_library.ts's reason and not for sessions'. The
 * distinction there is who reads it: a published setup is read by a student who
 * wants exactly one and has no business seeing the others, so it is keyed per
 * code. This library is read by the teacher choosing from a picker, so the
 * whole thing in one read is the cheap answer — and it makes a save a
 * read-modify-write of a single object rather than of an index and its members,
 * with no window where the two disagree.
 *
 * NOTHING HERE IS EVER READ BY A STUDENT. The student page reads a published
 * setup, which carries this one's text inlined — see session.ts. So a Voco
 * Session edited after a publish cannot change what a student mid-lesson is
 * looking at, and this bucket is a teacher's filing cabinet rather than part of
 * the serving path.
 *
 * ONE WRITER IS ASSUMED, as with faces and evaluators and for the same reason:
 * the author is one person at one keyboard, and students never hold a write
 * credential. Two saves landing together can lose one, which costs a retype
 * rather than data.
 */

import {
  type VocoSession,
  looksLikeVocoSession,
} from '../../../src/realtime/vocoSessions';

/**
 * Everything, in one object. See the note above on why it is not split.
 *
 * The key still says `sheets`, as does the bucket this binding names, because
 * both predate the rename and neither is worth a migration: renaming an object
 * key means a read-both-write-one dance, and renaming a bucket means creating
 * one and copying. The binding is the name a reader meets, and that one is
 * current. `sessions` is likewise the array's field name inside the object.
 */
export const LIBRARY_KEY = 'sheets.json';

export interface VocoSessionEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so a deployment without the binding answers with a plain message
   * rather than throwing on first property access — the posture every key check
   * in _vertex.ts already takes.
   */
  VOCO_SESSIONS?: R2Bucket;
}

export async function readVocoSessions(bucket: R2Bucket): Promise<VocoSession[]> {
  const object = await bucket.get(LIBRARY_KEY);
  if (!object) return [];

  try {
    const parsed = (await object.json()) as { sheets?: unknown; sessions?: unknown };
    // Either field name is read, only the new one is written. The objects
    // already in the bucket were written under `sheets` and have to keep
    // opening; the first save rewrites the whole object under `sessions`, so
    // this branch retires itself one save per deployment.
    const rows = Array.isArray(parsed.sessions)
      ? parsed.sessions
      : Array.isArray(parsed.sheets)
        ? parsed.sheets
        : null;
    if (!rows) return [];
    // Each entry checked on its own, so one corrupt row does not cost the rest
    // — the posture the evaluator library takes on its own object.
    return rows.filter(looksLikeVocoSession);
  } catch {
    // Empty is still the right answer: a save writes the whole object, so the
    // next one repairs it.
    return [];
  }
}

export function writeVocoSessions(
  bucket: R2Bucket,
  sessions: VocoSession[],
): Promise<unknown> {
  return bucket.put(LIBRARY_KEY, JSON.stringify({ sessions }), {
    httpMetadata: { contentType: 'application/json' },
  });
}
