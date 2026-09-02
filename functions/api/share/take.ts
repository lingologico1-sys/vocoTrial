import { json } from '../_middleware';
import { audioKey, packageKey } from '../../../src/lipsync/published';
import { resolve, type ShareEnv } from './_token';

/**
 * One shared take, for somebody with no password.
 *
 * The same body /api/lipsync/get returns, minus everything that is not needed to play it
 * — no alignment, no listing, no neighbours. `faceId` rides along because the viewer has
 * no picker and no library: which face this link wears was decided when it was made.
 */
export async function onRequestPost(
  context: EventContext<ShareEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  const resolved = await resolve(request, env);
  if ('refusal' in resolved) return resolved.refusal;

  const bucket = env.LIPSYNC!;
  const { takeId, faceId } = resolved.share;
  const [body, audio] = await Promise.all([
    bucket.get(packageKey(takeId)),
    bucket.get(audioKey(takeId)),
  ]);

  // A share whose take was deleted answers as a dead link rather than as an error, which
  // is what it is. Nothing here tells the holder which of the two happened.
  if (!body) return json({ error: 'That link is not valid', code: 'no_share' }, 404);

  const bytes = audio ? new Uint8Array(await audio.arrayBuffer()) : null;
  let audioBase64: string | undefined;
  if (bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    audioBase64 = btoa(binary);
  }

  return json({ package: await body.json(), audioBase64, faceId });
}
