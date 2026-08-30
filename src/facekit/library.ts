import { composite, loadImage } from './canvas';
import { migrate, type FaceKit } from './kit';
import { THUMB_EDGE, type PublishedFace } from './published';

/**
 * The browser's side of the shared face library.
 *
 * Everything here is a POST, because the gate in functions/api/_middleware.ts
 * allows nothing else through — which also settles a question the picker would
 * otherwise raise: a thumbnail cannot be an <img src> pointing at a route, so
 * thumbnails ride inside the listing as data URLs instead. See published.ts.
 */

/**
 * A refusal from the library, with the status kept.
 *
 * It matters in one place: a 404 from `original` means the library keeps no
 * portrait for that face, which is a fallback rather than a failure. Carrying
 * the status on the error is cheaper than a second fetch helper that would
 * differ from this one only in what it does with a missing object.
 */
export class LibraryError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LibraryError';
    this.status = status;
  }
}

async function post<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/faces/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new LibraryError(
      detail?.error ?? `The face library refused that (${response.status})`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

export async function listPublished(): Promise<PublishedFace[]> {
  const { faces } = await post<{ faces: PublishedFace[] }>('list');
  return faces;
}

/**
 * Through the same migration a stored kit gets, for the same reason: a face
 * published against an older format is not a second thing to remember.
 */
export async function fetchPublished(id: string): Promise<FaceKit> {
  return migrate(await post<FaceKit>('get', { id }));
}

/**
 * The portrait one face was authored from, when the library kept one.
 *
 * Fetched beside the kit rather than inside it — see originalKey — so opening a
 * face for editing costs this one object on top of a kit the browser may well
 * have cached already from wearing it.
 *
 * Null means no portrait was kept: a face saved before the originals/ split,
 * whose index entry says `hasOriginal: false`. The caller opens the kit anyway,
 * which is editable in every way except that "start again from the original"
 * has no original to go back to. Saving it once from here seeds it.
 */
export async function fetchOriginal(id: string): Promise<string | null> {
  try {
    return await post<string>('original', { id });
  } catch (cause) {
    if (cause instanceof LibraryError && cause.status === 404) return null;
    throw cause;
  }
}

/** Exact pre-deglassing neutral base, kept off the wearable kit. */
export async function fetchEyewearSource(id: string): Promise<string | null> {
  try {
    return await post<string>('eyewear-source', { id });
  } catch (cause) {
    if (cause instanceof LibraryError && cause.status === 404) return null;
    throw cause;
  }
}

/**
 * The portrait of a face saved before the originals/ split, dug out of the
 * whole-kit object it is buried in.
 *
 * Reached only when the listing says `hasOriginal` is false, which is the only
 * state that can point at a legacy object. Null covers both ways of having no
 * portrait — the face predates originals/ and its sources/ object is gone or
 * was never written, or it predates `original` entirely and never had one.
 *
 * A whole kit crosses the wire to yield one member of it. That is the price of
 * recovering these at all, it is paid once per face because the save that
 * follows writes the portrait where it belongs, and the alternative was
 * abandoning the portraits or parsing them in a Worker. See source.ts.
 */
export async function fetchLegacyOriginal(id: string): Promise<string | null> {
  try {
    const kit = await post<FaceKit>('source', { id });
    return kit.original ?? null;
  } catch (cause) {
    if (cause instanceof LibraryError && cause.status === 404) return null;
    throw cause;
  }
}

/**
 * Marks a face finished, or puts it back to a draft.
 *
 * Deliberately not a save: this rewrites one boolean in the index and touches
 * no artwork, which is why it is worth a route of its own. See ready.ts.
 */
export function setReady(id: string, ready: boolean): Promise<unknown> {
  return post('ready', { id, ready });
}

/**
 * Deletes a face, artwork and all.
 *
 * There is no other copy — the library is where a kit lives — so the caller is
 * expected to have asked first. See delete.ts.
 */
export function deleteFace(id: string): Promise<unknown> {
  return post('delete', { id });
}

/**
 * A small square of the base.
 *
 * A straight scale with no cropping, because a base is always CANVAS_EDGE
 * square by construction — the portrait was normalised to it on the way in, so
 * there is no aspect ratio here to preserve or to get wrong.
 *
 * WebP at a visible-but-cheap quality. A face at 192 pixels is being used to
 * tell one portrait from another, not to judge the artwork, and the index this
 * lands in is read on every page that draws a picker.
 */
async function thumbnail(base: string): Promise<string> {
  const image = await loadImage(base);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_EDGE;
  canvas.height = THUMB_EDGE;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser would not give a 2D context');

  context.drawImage(image, 0, 0, THUMB_EDGE, THUMB_EDGE);
  return canvas.toDataURL('image/webp', 0.72);
}

/**
 * Saves one kit to the library. This is the only save there is.
 *
 * `original` travels as its own member and only when the library does not
 * already hold it, which is what keeps a save proportional to what changed. The
 * portrait is close to half the bytes and never changes after upload, so
 * sending it on every save would mean paying the larger half of the upload for
 * a write that could not alter it. `hasOriginal` comes from the listing the
 * caller already has — no extra request to find out.
 *
 * `ready` rides along because publish.ts writes the whole index entry and would
 * otherwise have to guess. Guessing wrong in the generous direction puts an
 * unfinished face in front of a class, so the flag is always stated.
 */
export async function publishKit(
  kit: FaceKit,
  options: {
    ready: boolean;
    hasOriginal: boolean;
    hasEyewearSource?: boolean;
    eyewearSourceChanged?: boolean;
  },
): Promise<PublishedFace> {
  // The smiling portrait when the author drew one, and this is the only place
  // it is ever used. It is not the base and never becomes it — see
  // SMILE_BASE_PROMPT — so a face that has one is neutral everywhere except in
  // the picker, where a smile is worth more than accuracy about a resting mouth
  // nobody is comparing it against. Baked in here rather than chosen at draw
  // time so that a browser picking a face has one image to fetch, as it always
  // did.
  const thumbBase = kit.bases?.smile ?? kit.base;
  const thumbSource = kit.eyewear
    ? await composite(thumbBase, [{ patch: kit.eyewear.frame, box: kit.eyewear.box }])
    : thumbBase;
  const thumb = await thumbnail(thumbSource);
  // Split rather than deleted from a copy: `original` is one member among data
  // URLs, and pulling it out by name here is what makes the request's two
  // halves independent.
  const { original, glassed, ...rest } = kit;
  const { face } = await post<{ face: PublishedFace }>('publish', {
    kit: rest,
    thumb,
    ready: options.ready,
    ...(original && !options.hasOriginal ? { original } : {}),
    ...(glassed && (!options.hasEyewearSource || options.eyewearSourceChanged)
      ? { eyewearSource: glassed }
      : {}),
    ...(!kit.eyewear && options.hasEyewearSource ? { removeEyewearSource: true } : {}),
  });
  return face;
}
