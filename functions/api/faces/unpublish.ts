import { json } from '../_middleware';
import { kitKey, sourceKey } from '../../../src/facekit/published';
import { type LibraryEnv, readIndex, writeIndex } from './_library';

/**
 * Takes one face back out of the shared library.
 *
 * The index is written before the objects are deleted, which is publish.ts's
 * order reversed for publish.ts's reason: interrupted between the two leaves
 * unlisted objects, which nothing can reach and the next publish overwrites.
 *
 * Both copies go — the wearable one under kitKey and the authoring one under
 * sourceKey. Leaving the source behind would be a face nobody can see and
 * nobody can open, still charged for by the byte.
 *
 * The authored kit in the author's own IndexedDB is untouched. Unpublishing is
 * "stop sharing this", not "delete it" — faceKit's own delete button is where
 * the second thing lives, and conflating them would make a mistake here cost
 * artwork rather than a re-publish.
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
  // R2 takes an array, so this is one request rather than two. Deleting a key
  // that is not there is not an error, which is what makes this safe for a face
  // published before the sources/ prefix existed.
  await env.FACES.delete([kitKey(body.id), sourceKey(body.id)]);

  return json({ ok: true });
}
