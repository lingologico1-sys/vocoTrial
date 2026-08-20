import { json } from '../_middleware';
import { type VocoSessionEnv, readVocoSessions, writeVocoSessions } from './_library';

/**
 * Removes one Voco Session from the shared library.
 *
 * An id that is not there is a success rather than a 404: the caller wanted it
 * gone, and it is gone. Two browsers deleting the same one should not have one
 * of them report a failure.
 *
 * Deleting one does NOT touch any setup published from it. The published setup
 * carries the questions inlined and the prompt already composed — see
 * session.ts — so a lesson already handed out keeps working after the Voco
 * Session behind it is thrown away, which is the property that makes deleting
 * one a safe thing to do mid-term.
 */

interface DeleteBody {
  id?: unknown;
}

export async function onRequestPost(
  context: EventContext<VocoSessionEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.VOCO_SESSIONS) {
    return json({ error: 'No Voco Session library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return json({ error: 'An id is required', code: 'bad_id' }, 400);
  }

  const existing = await readVocoSessions(env.VOCO_SESSIONS);
  const remaining = existing.filter((entry) => entry.id !== body.id);
  if (remaining.length !== existing.length) {
    await writeVocoSessions(env.VOCO_SESSIONS, remaining);
  }

  return json({ deleted: body.id });
}
