import { json } from '../_middleware';
import { type LipsyncEnv, readIndex, writeIndex } from './_library';
import { alignmentKey, audioKey, packageKey } from '../../../src/lipsync/published';

/**
 * Removes a line and everything under it.
 *
 * The index goes first here, the reverse of save.ts, and for the same reason it was
 * written last there: whichever end is interrupted, what survives is an object nobody
 * lists rather than a listing that points at nothing.
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
  await Promise.all([
    env.LIPSYNC.delete(packageKey(id)),
    env.LIPSYNC.delete(audioKey(id)),
    env.LIPSYNC.delete(alignmentKey(id)),
  ]);

  return json({ ok: true });
}
