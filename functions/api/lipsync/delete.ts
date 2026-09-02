import { json } from '../_middleware';
import { type LipsyncEnv, readIndex, writeIndex } from './_library';
import { alignmentKey, audioKey, packageKey } from '../../../src/lipsync/published';
import { looksLikeToken, shareKey, shareOfTakeKey } from '../../../src/lipsync/shared';

/**
 * Removes a line and everything under it.
 *
 * The index goes first here, the reverse of save.ts, and for the same reason it was
 * written last there: whichever end is interrupted, what survives is an object nobody
 * lists rather than a listing that points at nothing.
 *
 * INCLUDING ITS SHARE LINK, which is the one piece of this that reaches outside the
 * password. A token left behind would open a take that no longer exists — harmless
 * today, and a link that quietly starts working again the moment some future id
 * collides with it. Deleting is the only moment anyone is thinking about that take, so
 * it is the moment the key gets destroyed.
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

  const lines = await readIndex(env.LIPSYNC);
  await writeIndex(env.LIPSYNC, lines.filter((l) => l.id !== id));

  const pointer = (await env.LIPSYNC.get(shareOfTakeKey(id))
    .then((object) => (object ? (object.json() as Promise<{ token?: string }>) : null))
    .catch(() => null)) as { token?: string } | null;

  await Promise.all([
    env.LIPSYNC.delete(packageKey(id)),
    env.LIPSYNC.delete(audioKey(id)),
    env.LIPSYNC.delete(alignmentKey(id)),
    env.LIPSYNC.delete(shareOfTakeKey(id)),
    looksLikeToken(pointer?.token)
      ? env.LIPSYNC.delete(shareKey(pointer.token))
      : Promise.resolve(),
  ]);

  return json({ ok: true });
}
