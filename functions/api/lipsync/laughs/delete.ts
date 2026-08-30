import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import { laughClipKey } from '../../../../src/lipsync/laughs';

/**
 * Drops a clip from the library.
 *
 * The index first, then the object — the reverse of cut.ts, and for the reason delete.ts
 * gives: whichever end is interrupted, what survives is an object nobody lists rather
 * than a listing that points at nothing.
 *
 * Packages that already spliced this clip are untouched and stay playable. Their audio
 * contains the laugh, not a reference to it; what they lose is only the ability to trace
 * the recorded `clipId` back to something that still exists, which is why `SplicedLaugh`
 * carries the label as well as the id.
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

  const clips = await readClips(env.LIPSYNC);
  await writeClips(env.LIPSYNC, clips.filter((c) => c.id !== id));
  await env.LIPSYNC.delete(laughClipKey(id));

  return json({ ok: true });
}
