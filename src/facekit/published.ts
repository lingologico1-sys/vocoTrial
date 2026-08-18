/**
 * What the shared face library holds, and where it holds it.
 *
 * Both sides read this file — the Worker that writes R2 and the browser that
 * reads it back — so it holds no browser APIs. The Functions tsconfig compiles
 * whatever the routes import, and a `document` reached from here would break
 * `typecheck:functions` rather than anything at runtime. Same arrangement as
 * imageModels.ts, and the same reason.
 *
 * WHY AN INDEX OBJECT AND NOT `bucket.list()`. R2 will happily enumerate the
 * keys, and hand back custom metadata with them — but that metadata is HTTP
 * headers, capped around two kilobytes, which is nowhere near a thumbnail. A
 * picker of names with no faces is not a picker, so the alternative to this
 * index is one read per face just to draw the strip. One object it is.
 */

export interface PublishedFace {
  /** The kit's own id, so republishing replaces a face rather than forking it. */
  id: string;
  name: string;
  /** When the kit was authored, so the library can order as faceKit does. */
  createdAt: number;
  /**
   * When it last reached R2, and the whole of the cache check.
   *
   * A browser holding a copy compares this one number against its own rather
   * than re-downloading several megabytes to discover it already had them.
   * Bumped on every publish, including a republish of unchanged artwork — the
   * honest reading of "this is the copy to have" is the last one written.
   */
  publishedAt: number;
  /** A small square of the base, as a data URL. See THUMB_EDGE. */
  thumb: string;
}

/** The index, as one object, so listing the library is one read. */
export const INDEX_KEY = 'index.json';

/**
 * Where the wearable copy of one kit lives. Keyed by the kit's id, which is
 * already unique.
 *
 * This is the one on the wear path: every browser that puts the face on
 * downloads this object whole. It carries no `original` — see sourceKey.
 */
export function kitKey(id: string): string {
  return `kits/${id}.json`;
}

/**
 * Where the authoring copy of the same kit lives.
 *
 * A second object rather than a fatter first one, and the split is the whole
 * point. `original` is the portrait as uploaded, kept so that neutralising
 * stays repeatable; it is close to half a kit's bytes and useless to anything
 * that only wears the face. Folding it back into kitKey would make every
 * student's page load carry an authoring artefact they cannot use, so it lives
 * here instead and is fetched only when a face is opened for editing — one
 * person, occasionally, against everyone else on every visit.
 *
 * Written by publish.ts, read by source.ts, deleted by unpublish.ts. Nothing on
 * the live path touches it.
 */
export function sourceKey(id: string): string {
  return `sources/${id}.json`;
}

/**
 * How wide a thumbnail is, in pixels.
 *
 * Small on purpose: every one of these rides in the index, so the cost of the
 * listing is this number squared times however many faces have been published.
 * 192 is twice the 96-pixel square the strip actually draws, which is what a
 * retina panel needs and the most this is worth spending.
 */
export const THUMB_EDGE = 192;

/**
 * The most one published kit may weigh, as JSON.
 *
 * A kit is nine 1024-square PNGs inlined as data URLs, and base64 adds a third
 * again to each — so a heavy portrait lands in the low tens of megabytes and a
 * reasonable one well under. The ceiling is here to stop a single malformed
 * publish filling the bucket, not to police normal artwork; nothing authored by
 * faceKit has come close.
 *
 * Doubled from 32 MB when publishing started carrying `original` as well. The
 * request that arrives at publish.ts is now the authoring copy — both halves —
 * and measuring the old ceiling against it would have started bouncing heavy
 * portraits that used to fit. The wearable copy written out the far side is
 * unchanged in size.
 *
 * Still comfortably inside Cloudflare's own request-body limit, which is the
 * real ceiling here and is not ours to raise.
 */
export const MAX_KIT_BYTES = 64 * 1024 * 1024;
