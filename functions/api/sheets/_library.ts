/**
 * The R2 side of the shared question-sheet library.
 *
 * ONE OBJECT, for evaluators/_library.ts's reason and not for sessions'. The
 * distinction there is who reads it: a session is read by a student who wants
 * exactly one and has no business seeing the others, so it is keyed per code. A
 * sheet library is read by the teacher choosing from a picker, so the whole
 * thing in one read is the cheap answer — and it makes a save a read-modify-
 * write of a single object rather than of an index and its members, with no
 * window where the two disagree.
 *
 * NOTHING HERE IS EVER READ BY A STUDENT. The student page reads a published
 * session, which carries the sheet's text inlined — see session.ts. So a sheet
 * edited after a publish cannot change what a student mid-lesson is looking at,
 * and this bucket is a teacher's filing cabinet rather than part of the serving
 * path.
 *
 * ONE WRITER IS ASSUMED, as with faces and evaluators and for the same reason:
 * the author is one person at one keyboard, and students never hold a write
 * credential. Two saves landing together can lose one, which costs a retype
 * rather than data.
 */

import { type QuestionSheet, looksLikeSheet } from '../../../src/realtime/sheets';

/** Everything, in one object. See the note above on why it is not split. */
export const SHEETS_KEY = 'sheets.json';

export interface SheetEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so a deployment without the binding answers with a plain message
   * rather than throwing on first property access — the posture every key check
   * in _vertex.ts already takes.
   */
  SHEETS?: R2Bucket;
}

export async function readSheets(bucket: R2Bucket): Promise<QuestionSheet[]> {
  const object = await bucket.get(SHEETS_KEY);
  if (!object) return [];

  try {
    const parsed = (await object.json()) as { sheets?: unknown };
    if (!Array.isArray(parsed.sheets)) return [];
    // Each entry checked on its own, so one corrupt row does not cost the rest
    // — the posture the evaluator library takes on its own object.
    return parsed.sheets.filter(looksLikeSheet);
  } catch {
    // Empty is still the right answer: a save writes the whole object, so the
    // next one repairs it.
    return [];
  }
}

export function writeSheets(bucket: R2Bucket, sheets: QuestionSheet[]): Promise<unknown> {
  return bucket.put(SHEETS_KEY, JSON.stringify({ sheets }), {
    httpMetadata: { contentType: 'application/json' },
  });
}
