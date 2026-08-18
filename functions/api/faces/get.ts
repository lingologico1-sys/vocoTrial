import { json } from '../_middleware';
import { kitKey } from '../../../src/facekit/published';
import type { LibraryEnv } from './_library';

/**
 * One published kit, whole.
 *
 * The body is streamed through rather than parsed and re-serialised: this is
 * the megabytes, and the Worker has no reason to hold them in memory to hand
 * them straight on. The client checks the copy it already has against the
 * index's `publishedAt` before ever calling this — see publishedKit() in
 * facekit/store.ts, which is what keeps a page load from re-fetching a face
 * that has not changed.
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

  const object = await env.FACES.get(kitKey(body.id));
  if (!object) {
    return json({ error: `No published face "${body.id}"`, code: 'not_found' }, 404);
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
}
