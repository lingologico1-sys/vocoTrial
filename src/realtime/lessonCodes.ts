/**
 * The lesson code: six characters a student types to reach a lesson.
 *
 * WHY THIS IS ITS OWN FILE. The format is not vocoTrial's to choose. LingoLecto
 * has been minting these since before this app had a student page, and the
 * intent is that one day a student types one code and lands on whichever kind
 * of lingomondo lesson it names — scribo, lecto or voco. A shared format is the
 * first half of that, and a format spread across a session type and a publish
 * route is one nobody can copy into the next app. So it lives here, alone, with
 * the contract written down in docs/lesson-codes.md.
 *
 * THE FORMAT IS LINGOLECTO'S, COPIED DELIBERATELY. Six characters from an
 * alphabet with no I, O, 0 or 1 — the pairs that get misread off a whiteboard.
 * See LingoLecto's worker, which mints the same thing and calls it a token.
 * vocoTrial used to mint `VOCO-XXXX`, four characters behind a prefix, and the
 * prefix is the part that had to go: a code that announces its app cannot be
 * the code a shared resolver hands to whichever app owns it.
 *
 * WHICH MEANS A CODE DOES NOT SAY WHICH APP IT BELONGS TO, and that is a known
 * cost rather than an oversight. Two apps minting independently can land on the
 * same six characters, and nothing in `K7MPQR` distinguishes a reading from a
 * conversation. The resolver that fixes this is a registry the three apps share
 * and none of them has yet; until it exists, each app checks uniqueness within
 * its own bucket and a collision across apps is a thing to catch later rather
 * than a thing to prevent now. Recorded in the README's known edges.
 *
 * ENTROPY, SINCE SIX CHARACTERS LOOKS SHORT. 32^6 is just over a billion, which
 * is not a keyspace to defend a secret with — and a code is the student's whole
 * credential, so this is worth being plain about. It defends against a typo
 * landing in somebody else's lesson, not against somebody grinding the space.
 * The mitigation is that guessing costs a round trip against a Worker rather
 * than a local loop; the honest fix is the user store the README already owes.
 *
 * Deliberately free of DOM imports, for session.ts's reason: functions/
 * compiles against workers-types with no DOM lib, and the route that mints a
 * code is a Worker. `crypto.getRandomValues` is in both runtimes.
 */

/**
 * The alphabet a code is drawn from.
 *
 * No O, no I, no 0 and no 1. A code is going to be read off a board and typed
 * by somebody who did not choose it, and those are the characters that get
 * mistyped for one another. Dropping them costs a little entropy per character
 * and buys a code that survives handwriting.
 *
 * Character for character what LingoLecto uses. Changing this is changing the
 * contract, not tuning a constant — see docs/lesson-codes.md.
 */
export const LESSON_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Six. Also LingoLecto's, and the `maxlength` on every box that takes one. */
export const LESSON_CODE_LENGTH = 6;

/**
 * What a code may look like, for the routes that take one from a caller.
 *
 * Checked rather than trusted because a code becomes an R2 object key, and a
 * key assembled from unvalidated input is how a caller reads an object that is
 * none of their business. The shape is narrow on purpose: nothing matching this
 * can carry a slash or a dot segment.
 *
 * Anchored to the alphabet rather than to `[A-Z0-9]`, so the excluded
 * characters are excluded on the way in too. A code with an O in it was
 * mistyped, and reading it as a miss is more use than reading it as a lookup
 * that happens to find nothing.
 */
export const LESSON_CODE = new RegExp(`^[${LESSON_CODE_ALPHABET}]{${LESSON_CODE_LENGTH}}$`);

/**
 * A fresh code. Uniqueness is the caller's job — see the note below.
 *
 * NOT CHECKED FOR COLLISIONS HERE, because this file cannot see a bucket. At a
 * billion codes a collision is unlikely and silently overwriting somebody's
 * live lesson is not a risk worth taking on a probability, so the publish route
 * retries against R2 the way LingoLecto's does. This function is the alphabet
 * and the length; `publish.ts` is the uniqueness.
 *
 * `crypto.getRandomValues` rather than `Math.random`, which is the one place
 * this departs from LingoLecto. The format is the contract; how the characters
 * are drawn is not, and a code that is the student's whole credential should
 * not come out of a predictable generator.
 */
export function newLessonCode(): string {
  const random = new Uint32Array(LESSON_CODE_LENGTH);
  crypto.getRandomValues(random);

  let code = '';
  for (const value of random) code += LESSON_CODE_ALPHABET[value % LESSON_CODE_ALPHABET.length];
  return code;
}

/**
 * A typed-in code, in the shape the routes expect — or null if it is not one.
 *
 * Upper-cased and trimmed, because a code is read off a board and typed back in
 * whatever case the keyboard was in, and a student who gets caps wrong has not
 * made a mistake worth a 404. LingoLecto compares case-insensitively for the
 * same reason; doing it once on the way in is the same answer with one place to
 * look at.
 *
 * Null rather than a throw, so each caller answers in its own words: a route
 * says "that is not a lesson code", and a student page says it more kindly.
 */
export function normaliseLessonCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return LESSON_CODE.test(code) ? code : null;
}
