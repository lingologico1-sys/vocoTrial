import { json } from '../_middleware';
import {
  eyewearSourceKey,
  kitKey,
  legacySourceKey,
  originalKey,
} from '../../../src/facekit/published';
import { type LibraryEnv, readIndex, writeIndex } from './_library';

/**
 * Deletes one face.
 *
 * This was `unpublish`, and the rename is the point. While faceKit kept every
 * kit in the authoring browser's IndexedDB, this route removed the shared copy
 * and left the original where it was — "stop sharing this", recoverable by
 * publishing again. There is no second copy any more: the bucket is where a kit
 * lives, so removing it from the bucket is the end of the artwork, and a name
 * promising otherwise was the dangerous half of that change. faceKit asks
 * before calling this; nothing else calls it.
 *
 * The index is written before the objects are deleted, which is publish.ts's
 * order reversed for publish.ts's reason: interrupted between the two leaves
 * unlisted objects, which nothing can reach and the next save overwrites.
 *
 * Every key goes — the kit, the portrait it was authored from, and whatever
 * this face left under the old sources/ arrangement. Leaving any of them would
 * be bytes nobody can see and nobody can open, still charged for.
 */
export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.FACES) {
    return json({ error: 'No face library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return json({ error: 'A face id is required', code: 'bad_id' }, 400);
  }

  const faces = await readIndex(env.FACES);
  await writeIndex(env.FACES, faces.filter((face) => face.id !== body.id));
  // R2 takes an array, so this is one request rather than four. Deleting a key
  // that is not there is not an error, which is what makes this safe for a face
  // from either side of the originals/ split — each has one of the two authoring
  // keys and neither has both.
  await env.FACES.delete([
    kitKey(body.id),
    originalKey(body.id),
    eyewearSourceKey(body.id),
    legacySourceKey(body.id),
  ]);

  return json({ ok: true });
}
