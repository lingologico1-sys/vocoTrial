/**
 * A take handed to somebody who does not have the site password.
 *
 * Everything else in this app is behind one gate — functions/api/_middleware.ts refuses
 * every /api/* route without the session cookie — and that gate is what keeps strangers
 * off an account that spends money on every request. So the way out is not a hole in the
 * gate but a key cut for one door: a random token that names exactly one take and exactly
 * one face, and unlocks nothing else. Guessing is the only attack, and 128 bits is not
 * guessable; enumerating is not an attack, because the listing route stays gated.
 *
 * WHY THE FACE IS RECORDED HERE. A package stores audio and movement, not artwork — the
 * note under the picker on Takes says so. A viewer with no password has no library to
 * pick from and no business picking, so the choice has to be made by whoever shares, at
 * the moment they share, and travel with the link. `faceId: ''` means the deployment's
 * own bundled face, exactly as the picker's empty option does.
 *
 * Both sides import this, so neither can invent a key the other does not look at — the
 * same arrangement published.ts describes at greater length.
 */

/** The token's own object: what one link is allowed to reach. */
export interface Share {
  token: string;
  /** The take. Its package, audio and marks are what the link serves. */
  takeId: string;
  /** The face to wear, or '' for the bundled one. Chosen when the link was made. */
  faceId: string;
  createdAt: number;
}

/** What a token unlocks, by token. */
export const shareKey = (token: string) => `shares/${token}.json`;

/**
 * Which token a take already has, so sharing twice hands out one link rather than two.
 *
 * A link that changes every time it is copied is a link nobody can revoke, because
 * revoking means finding all of them. One token per take keeps "stop sharing this" a
 * single deletion — and it means re-sharing with a different face updates the link
 * somebody may already be holding rather than silently leaving them on the old face.
 */
export const shareOfTakeKey = (takeId: string) => `shares/by-take/${takeId}.json`;

/** Where a share link points. Built here so the page and any future caller agree. */
export const shareUrl = (origin: string, token: string) =>
  `${origin}/watch?t=${encodeURIComponent(token)}`;

/** Tokens are opaque; this is only the shape check that keeps a key out of R2's keyspace. */
export const looksLikeToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
