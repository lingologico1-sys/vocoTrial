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
  /**
   * Whether this face is finished enough to be worn.
   *
   * The library holds work in progress now — saving *is* publishing, since the
   * bucket is the only home a kit has — so "in the library" stopped meaning
   * "ready for a student". This is the flag that carries the difference, and it
   * is the only thing studio's picker filters on.
   *
   * Optional, and absent reads as ready. That is the migration: every face in
   * the index before this existed was put there by a deliberate publish of
   * finished artwork, so the old meaning and the new default agree.
   */
  ready?: boolean;
  /**
   * Whether `originals/{id}.json` exists for this face.
   *
   * Read by the browser before it uploads: the portrait as uploaded never
   * changes, so a republish that would only rewrite the same bytes sends
   * nothing instead. See originalKey, and publishKit in facekit/library.ts.
   *
   * Absent reads as false, which is right for both cases that produce it — a
   * face published before the split, whose original is inside a legacy sources/
   * object this code no longer reads, and one whose kit never had an `original`
   * at all. Both are seeded by republishing once from a browser holding one.
   */
  hasOriginal?: boolean;
}

/** The index, as one object, so listing the library is one read. */
export const INDEX_KEY = 'index.json';

/**
 * Where one kit lives. Keyed by the kit's id, which is already unique.
 *
 * The whole kit except `original` — which is to say everything anyone wears
 * *and* everything anyone edits, since the two differ by that one member. One
 * object serves both, so a face opened for editing on a browser that already
 * wore it costs nothing to read: it is the copy in the cache, unchanged.
 *
 * This is the one on the wear path, downloaded whole by every browser that
 * puts the face on. See originalKey for the half that stays behind.
 */
export function kitKey(id: string): string {
  return `kits/${id}.json`;
}

/**
 * Where the portrait as uploaded lives, on its own.
 *
 * `original` is kept so that neutralising stays repeatable; it is close to half
 * a kit's bytes and useless to anything that only wears the face. Two things
 * follow, and they are the reasons this is a separate object rather than a
 * member of the one above.
 *
 * It stays off the wear path. Folding it into kitKey would make every student's
 * page load carry an authoring artefact they cannot use.
 *
 * And it stays off the *save* path, which is the newer of the two reasons. A
 * portrait does not change after it is uploaded — every edit that follows lands
 * on `base` or on a patch — so re-sending these bytes on each save would be
 * paying the largest part of the upload for a write that changes nothing. The
 * index says whether this object exists (`hasOriginal`) and the browser skips
 * it when it does.
 *
 * Holds the bare data URL as a JSON string, not a wrapper object: it is one
 * value, and a `{ original: … }` around it would be a shape for the sake of
 * having one.
 *
 * Written by publish.ts, read by original.ts, deleted by unpublish.ts.
 */
export function originalKey(id: string): string {
  return `originals/${id}.json`;
}

/**
 * Where the authoring copy used to live, kept only so it can be deleted.
 *
 * Until originalKey existed, publishing wrote two objects: this one, holding
 * the whole kit, and kitKey holding the same kit minus `original`. The larger
 * one duplicated the smaller in full, which is what made splitting the portrait
 * out rather than the kit the better cut — the two objects now share nothing.
 *
 * Nothing reads it. publish.ts deletes it when it rewrites a face and
 * unpublish.ts deletes it with the rest, so the old objects drain as faces are
 * touched. A face never touched again keeps one until it is unpublished, which
 * costs storage and nothing else.
 *
 * The `original` inside those objects is not recovered on the way past. It
 * could be — parse twenty megabytes of JSON in the Worker to pull one member
 * out — but the same face republished once from a browser that holds the
 * portrait seeds `originals/` for free, and until then it degrades exactly as
 * a face published before any of this did: editable in every way except
 * starting again from the portrait. Removable once no bucket holds one.
 */
export function legacySourceKey(id: string): string {
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
 * Doubled from 32 MB when publishing started carrying `original` as well, and
 * left there now that the two travel as separate members of one request: the
 * first save of a face still puts both on the wire at once, which is the case
 * the ceiling has to clear. Every save after it sends the kit alone and lands
 * at roughly half this.
 *
 * Still comfortably inside Cloudflare's own request-body limit, which is the
 * real ceiling here and is not ours to raise.
 */
export const MAX_KIT_BYTES = 64 * 1024 * 1024;
