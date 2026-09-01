import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import { laughRenderKey, laughSourceKey } from '../../../../src/lipsync/laughs';

/**
 * Drops one render, or a laugh and every render made from it.
 *
 * TWO SCOPES BECAUSE THERE ARE TWO REGRETS. "This laugh does not suit this voice" removes
 * one render and leaves the recording — the next voice may well want it. "This laugh is not
 * a good laugh" removes the recording and everything rendered from it, because leaving the
 * renders would leave clips in the splice pool that nothing can explain the origin of.
 *
 * The index goes first, then the objects — the reverse of import.ts, and for the reason
 * delete.ts gives: whichever end is interrupted, what survives is an object nobody lists
 * rather than a listing that points at nothing.
 *
 * Packages that already spliced a deleted clip are untouched and stay playable. Their audio
 * contains the laugh, not a reference to it; what they lose is only the ability to trace the
 * recorded `clipId` back to something that still exists, which is why `SplicedClip` carries
 * the label as well as the id.
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

  const library = await readClips(env.LIPSYNC);

  if (of === 'source') {
    const doomed = library.renders.filter((r) => r.sourceId === id);
    await writeClips(env.LIPSYNC, {
      sources: library.sources.filter((s) => s.id !== id),
      renders: library.renders.filter((r) => r.sourceId !== id),
    });
    await Promise.all([
      env.LIPSYNC.delete(laughSourceKey(id)),
      ...doomed.map((r) => env.LIPSYNC!.delete(laughRenderKey(r.id))),
    ]);
    return json({ ok: true, removedRenders: doomed.length });
  }

  await writeClips(env.LIPSYNC, {
    sources: library.sources,
    renders: library.renders.filter((r) => r.id !== id),
  });
  await env.LIPSYNC.delete(laughRenderKey(id));

  return json({ ok: true, removedRenders: 1 });
}
