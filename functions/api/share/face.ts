import { json } from '../_middleware';
import { kitKey } from '../../../src/facekit/published';
import { resolve, type ShareEnv } from './_token';

/**
 * The artwork one shared take wears — and only that one.
 *
 * Addressed by token rather than by face id, which is the whole point: holding a link
 * does not let anyone walk the face library, it lets them fetch the single kit that link
 * was made with. Streamed rather than parsed, as faces/get.ts is, because this is the
 * megabytes.
 *
 * `null` is a real answer, not a failure: an empty faceId means the deployment's own
 * bundled face, which the page fetches from /faces/ like any other visitor does.
 */
export async function onRequestPost(
  context: EventContext<ShareEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  const resolved = await resolve(request, env);
  if ('refusal' in resolved) return resolved.refusal;

  const { faceId } = resolved.share;
  if (!faceId) return json({ kit: null });
  if (!env.FACES) return json({ kit: null });

  const object = await env.FACES.get(kitKey(faceId));
  // A face deleted since the link was made leaves the take playable on the bundled face,
  // which is a better answer than a black screen.
  if (!object) return json({ kit: null });

  return new Response(object.body, { headers: { 'Content-Type': 'application/json' } });
}
