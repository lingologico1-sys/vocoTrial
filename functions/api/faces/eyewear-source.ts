import { json } from '../_middleware';
import { eyewearSourceKey } from '../../../src/facekit/published';
import type { LibraryEnv } from './_library';

/** Returns authoring history without putting it on the face's wearable path. */
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
  const object = await env.FACES.get(eyewearSourceKey(body.id));
  if (!object) {
    return json({ error: `No eyewear source kept for "${body.id}"`, code: 'no_source' }, 404);
  }
  return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
}
