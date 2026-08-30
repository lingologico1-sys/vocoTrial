import { json } from '../../_middleware';
import type { LipsyncEnv } from '../_library';
import { laughClipKey } from '../../../../src/lipsync/laughs';

/**
 * One clip's audio, so it can be auditioned before it is trusted.
 *
 * Base64 in a JSON body, for the reason get.ts gives at length: the gate in
 * _middleware.ts passes nothing but POSTs, so there is no URL an <audio> element could
 * be pointed at. A laugh is a second or two, which is nothing to carry this way.
 */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  let id = '';
  try {
    ({ id } = (await request.json()) as { id: string });
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }
  if (!id) return json({ error: 'No id', code: 'no_id' }, 400);

  const object = await env.LIPSYNC.get(laughClipKey(id));
  if (!object) return json({ error: 'No such clip', code: 'not_found' }, 404);

  const bytes = new Uint8Array(await object.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

  return json({ audioBase64: btoa(binary) });
}
