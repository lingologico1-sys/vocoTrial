/**
 * The R2 side of the published session library.
 *
 * ONE OBJECT PER SETUP, PLUS A POINTER — not one object holding all of them,
 * which is what evaluators/_library.ts does. The difference is who reads it.
 * A scale library is read by the author, choosing from a picker, so handing
 * over the whole thing in one request is the cheap answer. A session is read by
 * a student who wants exactly one of them and has no business seeing the
 * others: their classmates' setups, the drafts, the prompt for a class they are
 * not in. Keying by code means the student page reads one object and the
 * listing is a thing only the workshop asks for.
 *
 *   sessions/<CODE>.json   one published setup
 *   current.json           { "code": "VOCO-7K2M" }
 *
 * The pointer exists because /eleve has no code to go on yet. Join codes are
 * the next pass; until then "the tutor" means "whichever was published last",
 * and that is a fact about the deployment rather than about any one setup, so
 * it lives beside them rather than inside one.
 *
 * ONE WRITER IS ASSUMED, as with faces and evaluators and for the same reason:
 * the author is one person at one keyboard, and students never hold a write
 * credential. Two publishes landing together can leave the pointer naming the
 * older of them, which costs a re-publish rather than data.
 */

import {
  SESSION_CODE,
  looksLikeSession,
  type CurrentPointer,
  type StudentSession,
} from '../../../src/realtime/session';

export const CURRENT_KEY = 'current.json';

export interface SessionEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so a deployment without the binding answers with a plain message
   * rather than throwing on first property access — the posture every key check
   * in _vertex.ts already takes.
   */
  SESSIONS?: R2Bucket;
}

/**
 * A code's object key, or null if that is not a code.
 *
 * The validation is the point of the function. A key built from unchecked
 * caller input is how somebody reads `sessions/../../something`, and returning
 * null rather than throwing lets each route answer in its own words.
 */
export function sessionKey(code: unknown): string | null {
  if (typeof code !== 'string' || !SESSION_CODE.test(code)) return null;
  return `sessions/${code}.json`;
}

export async function readSession(
  bucket: R2Bucket,
  code: string,
): Promise<StudentSession | null> {
  const key = sessionKey(code);
  if (!key) return null;

  const object = await bucket.get(key);
  if (!object) return null;

  try {
    const parsed: unknown = await object.json();
    // Validated on the way out as well as in. What is in the bucket was written
    // by an older version of this app as often as by the current one, and a
    // setup missing a field added since should read as "not set up" rather than
    // as a page that renders half a tutor.
    return looksLikeSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSession(bucket: R2Bucket, session: StudentSession): Promise<unknown> {
  const key = sessionKey(session.code);
  if (!key) throw new Error('Refusing to write a session with no valid code');

  return bucket.put(key, JSON.stringify(session), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/** The code currently pointed at, or null when nothing has been published. */
export async function readCurrent(bucket: R2Bucket): Promise<string | null> {
  const object = await bucket.get(CURRENT_KEY);
  if (!object) return null;

  try {
    const parsed = (await object.json()) as Partial<CurrentPointer>;
    return typeof parsed.code === 'string' && SESSION_CODE.test(parsed.code) ? parsed.code : null;
  } catch {
    // A corrupt pointer reads as "nothing published", which is recoverable by
    // publishing again — the same repair-on-next-write posture the evaluator
    // library takes on its own object.
    return null;
  }
}

export function writeCurrent(bucket: R2Bucket, code: string): Promise<unknown> {
  return bucket.put(CURRENT_KEY, JSON.stringify({ code } satisfies CurrentPointer), {
    httpMetadata: { contentType: 'application/json' },
  });
}
