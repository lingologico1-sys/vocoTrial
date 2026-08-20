/**
 * The R2 side of the published setup library.
 *
 * ONE OBJECT PER SETUP — not one object holding all of them, which is what
 * evaluators/_library.ts does. The difference is who reads it. A scale library
 * is read by the author, choosing from a picker, so handing over the whole
 * thing in one request is the cheap answer. A published setup is read by a
 * student who wants exactly one of them and has no business seeing the others:
 * their classmates' setups, the drafts, the prompt for a class they are not in.
 * Keying by code means the student page reads one object and the listing is a
 * thing only the teacher's page asks for.
 *
 *   sessions/<CODE>.json   one published setup
 *
 * THERE IS NO POINTER ANY MORE, and its removal is the point of this pass.
 * `current.json` used to name whichever setup was published last, because
 * /eleve had no code to go on. That made the second teacher to publish silently
 * replace the first for every student in the deployment. Codes are real now —
 * see lessonCodes.ts — so a student arrives with one or arrives with nothing,
 * and "whichever was published last" is not a thing this library can be asked.
 *
 * Setups published under the old `VOCO-XXXX` codes are still in the bucket and
 * are no longer reachable: the key is built through `sessionKey`, which now
 * validates against the shared six-character format. Nothing is lost that
 * anybody could have written down — /eleve never showed a student a code until
 * this pass, so no old code was ever handed out.
 *
 * ONE WRITER IS ASSUMED, as with faces and evaluators and for the same reason:
 * the author is one person at one keyboard, and students never hold a write
 * credential.
 */

import { LESSON_CODE, normaliseLessonCode } from '../../../src/realtime/lessonCodes';
import { looksLikeSetup, type PublishedSetup } from '../../../src/realtime/session';

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
  if (typeof code !== 'string' || !LESSON_CODE.test(code)) return null;
  return `sessions/${code}.json`;
}

/**
 * Whether a code is already spoken for.
 *
 * `head` rather than `get`, because the answer is whether the object exists and
 * pulling thirty kilobytes to learn that is thirty kilobytes wasted on every
 * publish.
 */
export async function codeTaken(bucket: R2Bucket, code: string): Promise<boolean> {
  const key = sessionKey(code);
  if (!key) return true;
  return (await bucket.head(key)) !== null;
}

export async function readSetup(
  bucket: R2Bucket,
  code: string,
): Promise<PublishedSetup | null> {
  const key = sessionKey(normaliseLessonCode(code) ?? '');
  if (!key) return null;

  const object = await bucket.get(key);
  if (!object) return null;

  try {
    const parsed: unknown = await object.json();
    // Validated on the way out as well as in. What is in the bucket was written
    // by an older version of this app as often as by the current one, and a
    // setup missing a field added since should read as "not set up" rather than
    // as a page that renders half a tutor.
    return looksLikeSetup(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * R2 custom metadata travels as HTTP headers, which are ASCII.
 *
 * A label is a teacher's own words — "4e, les vacances" — and a header value
 * with an é in it is a header some part of the stack will mangle or refuse.
 * Percent-encoded on the way in and decoded on the way out, so the listing
 * shows what was typed rather than a repair of it.
 */
const encodeMeta = (value: string): string => encodeURIComponent(value.slice(0, 120));

const decodeMeta = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    // Written by a version that did not encode, or truncated mid-escape. The
    // raw text is a better answer than an empty cell.
    return value;
  }
};

export function writeSetup(bucket: R2Bucket, setup: PublishedSetup): Promise<unknown> {
  const key = sessionKey(setup.code);
  if (!key) throw new Error('Refusing to write a setup with no valid code');

  return bucket.put(key, JSON.stringify(setup), {
    httpMetadata: { contentType: 'application/json' },
    // Duplicated out of the object so the listing below can show a name
    // without reading every setup in the bucket. See listSetups.
    customMetadata: {
      label: encodeMeta(setup.label ?? ''),
      lesson: encodeMeta(setup.vocoSessionName ?? ''),
    },
  });
}

/**
 * Every published code, newest first, with the label and lesson name.
 *
 * FOR THE TEACHER'S PAGE ONLY. A student reads one object by code and never
 * this; /teach shows what it has handed out so a code read off a board last
 * week can be found again. Strips everything else — a listing that carried the
 * prompts would be the whole bucket in one response, and the picker needs a
 * date and a name.
 *
 * `list()` rather than an index object, which is the opposite of what the face
 * library does and worth the sentence. Faces keep an index because the picker
 * needs thumbnails and R2's own metadata is HTTP headers, capped around two
 * kilobytes. Here the picker needs a code, a date and a name — the code is the
 * key and the other two fit in custom metadata, so the enumeration R2 already
 * offers is the whole answer and there is no second object to keep in step.
 */
export async function listSetups(
  bucket: R2Bucket,
  limit = 100,
): Promise<Array<{ code: string; label: string; lesson: string; updatedAt: number }>> {
  const listed = await bucket.list({ prefix: 'sessions/', limit, include: ['customMetadata'] });

  return listed.objects
    .map((object) => {
      const code = object.key.slice('sessions/'.length, -'.json'.length);
      const meta = object.customMetadata ?? {};
      return {
        code,
        label: decodeMeta(meta.label),
        lesson: decodeMeta(meta.lesson),
        updatedAt: object.uploaded.getTime(),
      };
    })
    .filter((entry) => LESSON_CODE.test(entry.code))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
