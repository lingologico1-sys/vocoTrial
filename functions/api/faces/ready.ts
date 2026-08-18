import { json } from '../_middleware';
import type { LibraryEnv } from './_library';
import { readIndex, writeIndex } from './_library';

/**
 * Marks one face finished, or puts it back to a draft.
 *
 * A route of its own rather than a flag on a save, because the two differ by
 * everything that costs: `ready` lives in the index and nowhere else, so
 * flipping it is one small read and one small write, while routing it through
 * publish.ts would mean re-uploading the artwork to change a boolean. That is
 * the difference between a link on a tile and a minute of waiting.
 *
 * Silent about a face that is not there. A tile can only be clicked from a
 * listing that named the face, so the miss means someone else removed it in
 * between — and the caller's next refresh is about to say so anyway, more
 * clearly than an error here could.
 */
export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.FACES) {
    return json({ error: 'No face library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown; ready?: unknown } | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return json({ error: 'A face id is required', code: 'bad_id' }, 400);
  }
  if (typeof body?.ready !== 'boolean') {
    return json({ error: 'ready must be true or false', code: 'bad_ready' }, 400);
  }

  const faces = await readIndex(env.FACES);
  await writeIndex(
    env.FACES,
    faces.map((face) => (face.id === body.id ? { ...face, ready: body.ready as boolean } : face)),
  );

  return json({ ok: true });
}
