import { json } from '../../_middleware';
import type { LipsyncEnv } from '../_library';
import { laughRenderKey, laughSourceKey } from '../../../../src/lipsync/laughs';

/**
 * One clip's audio, so it can be auditioned before it is trusted.
 *
 * Either half of the library is fetchable, and both are worth hearing for different
 * reasons: the render is what will actually be spliced, and the source is what it was made
 * from — which is the comparison that answers "did the conversion do something strange to
 * this laugh", the one real unknown in the whole mechanism.
 *
 * Base64 in a JSON body, for the reason get.ts gives at length: the gate in _middleware.ts
 * passes nothing but POSTs, so there is no URL an <audio> element could be pointed at. A
 * laugh is a second or two, which is nothing to carry this way.
 */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  let id = '';
  let of: 'render' | 'source' = 'render';
  try {
    ({ id, of = 'render' } = (await request.json()) as {
      id: string;
      of?: 'render' | 'source';
    });
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }
  if (!id) return json({ error: 'No id', code: 'no_id' }, 400);

  const object = await env.LIPSYNC.get(
    of === 'source' ? laughSourceKey(id) : laughRenderKey(id),
  );
  if (!object) return json({ error: 'No such clip', code: 'not_found' }, 404);

  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  return json({
    audioBase64: btoa(binary),
    // So the page can hand the right MIME to a Blob without knowing what it asked for.
    contentType: of === 'source' ? 'audio/wav' : 'audio/mpeg',
  });
}
