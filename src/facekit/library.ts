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

async function post<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/faces/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `The face library refused that (${response.status})`);
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
 * Shares one authored kit, so that browsers which never authored it can wear it.
 *
 * `original` is dropped on the way out. It is the portrait as uploaded, kept so
 * that neutralising stays repeatable — an authoring concern, useless to anything
 * that only wears the face, and close to half the payload. Publishing it would
 * double the bytes every reader downloads to carry a copy none of them can use.
 */
export async function publishKit(kit: FaceKit): Promise<PublishedFace> {
  const thumb = await thumbnail(kit.base);
  const shared = { ...kit };
  delete shared.original;
  const { face } = await post<{ face: PublishedFace }>('publish', { kit: shared, thumb });
  return face;
}
