import { loadImage } from './canvas';
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
 * It matters in one place: a 404 from `source` means the face was published
 * before authoring copies existed, which is a fallback rather than a failure.
 * Carrying the status on the error is cheaper than a second fetch helper that
 * would differ from this one only in what it does with a missing object.
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
 * The same kit as it was authored, for editing rather than for wearing.
 *
 * Null means there is no authoring copy — a face published before the sources/
 * prefix existed, which republishing once from anywhere seeds. The caller opens
 * the wearable copy in that case, which is editable in every way except that
 * "start again from the original" has no original to go back to.
 */
export async function fetchSource(id: string): Promise<FaceKit | null> {
  try {
    return migrate(await post<FaceKit>('source', { id }));
  } catch (cause) {
    if (cause instanceof LibraryError && cause.status === 404) return null;
    throw cause;
  }
}

export function unpublishFace(id: string): Promise<unknown> {
  return post('unpublish', { id });
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
 * Shares one authored kit, so that browsers which never authored it can wear it
 * — and so that this one is no longer the only place it can be edited.
 *
 * The kit goes up whole, `original` included, and publish.ts makes the split:
 * the copy verbatim for editing, and the same kit minus `original` for wearing.
 * Stripping here instead would mean uploading both halves — the authoring copy
 * for the sources/ prefix and the trimmed one for kits/ — to save the Worker a
 * `delete` on an object it already holds in memory. So the browser sends one
 * payload and the far side does the arithmetic.
 *
 * What that costs is roughly twice the upload this used to make. What it buys
 * is that the artwork stops living only in the IndexedDB of whichever laptop
 * drew it; readers are unaffected either way, since the object they fetch is
 * the trimmed one and is exactly the size it always was.
 */
export async function publishKit(kit: FaceKit): Promise<PublishedFace> {
  const thumb = await thumbnail(kit.base);
  const { face } = await post<{ face: PublishedFace }>('publish', { kit, thumb });
  return face;
}
