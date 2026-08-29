import { json } from '../_middleware';
import type { LipsyncEnv } from './_library';
import { audioKey, packageKey } from '../../../src/lipsync/published';

/**
 * One package, and a URL for its audio.
 *
 * The audio comes back as base64 beside the package rather than as a link, so that the
 * page can hand an <audio> element a blob it already holds. A signed URL would be
 * tidier and is what this should become if lines ever get long -- but a lesson line is
 * seconds of speech, and one round trip that returns something playable beats two.
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

  const [body, audio] = await Promise.all([
    env.LIPSYNC.get(packageKey(id)),
    env.LIPSYNC.get(audioKey(id)),
  ]);
  if (!body) return json({ error: 'No such line', code: 'not_found' }, 404);

  const bytes = audio ? new Uint8Array(await audio.arrayBuffer()) : null;
  let audioBase64: string | undefined;
  if (bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    audioBase64 = btoa(binary);
  }

  return json({ package: await body.json(), audioBase64 });
}
