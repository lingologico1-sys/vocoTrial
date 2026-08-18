import { json } from '../_middleware';
import { originalKey } from '../../../src/facekit/published';
import type { LibraryEnv } from './_library';

/**
 * The portrait one face was authored from, as uploaded.
 *
 * The counterpart to get.ts, and the only route that reads the originals/
 * prefix. get.ts serves the face to everything that wears it; this serves the
 * one member that only the page editing it can use, and only when that page
 * asks. Keeping them apart is what stops the authoring bytes riding along on
 * every student's page load — see originalKey in facekit/published.ts.
 *
 * Streamed through rather than parsed and re-serialised, for get.ts's reason:
 * this is megabytes, and the Worker has nothing to say about them.
 *
 * A 404 here is ordinary rather than broken, and the index says so in advance
 * — `hasOriginal` is false for a face whose portrait was never written under
 * this prefix, which is every face published before the split. faceKit reads
 * that as "this one cannot start again from the portrait" rather than as a
 * failure, and saving it once from a browser holding the portrait fixes it.
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

  const object = await env.FACES.get(originalKey(body.id));
  if (!object) {
    return json({ error: `No portrait kept for "${body.id}"`, code: 'no_original' }, 404);
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
}
