import { json } from '../_middleware';
import { sourceKey } from '../../../src/facekit/published';
import type { LibraryEnv } from './_library';

/**
 * One published kit as it was authored, `original` and all.
 *
 * The counterpart to get.ts, and the only route that reads the sources/ prefix.
 * get.ts serves the face to everything that wears it; this serves it to the one
 * page that edits it, which is faceKit opening a library face on a laptop that
 * never authored it. Keeping them apart is what stops the authoring bytes
 * riding along on every student's page load — see sourceKey in
 * facekit/published.ts.
 *
 * Streamed through rather than parsed and re-serialised, for get.ts's reason:
 * this is the megabytes, and the Worker has nothing to say about them.
 *
 * A 404 here is ordinary rather than broken. Faces published before the sources/
 * prefix existed have no object under it, and never will until they are
 * republished; faceKit reads that as "open the wearable copy instead" rather
 * than as a failure. See openPublished() in facekit/FaceKit.tsx.
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

  const object = await env.FACES.get(sourceKey(body.id));
  if (!object) {
    return json({ error: `No authoring copy of "${body.id}"`, code: 'no_source' }, 404);
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
}
