import { json } from '../_middleware';
import { type SheetEnv, readSheets, writeSheets } from './_library';

/**
 * Removes one question sheet from the shared library.
 *
 * An id that is not there is a success rather than a 404: the caller wanted it
 * gone, and it is gone. Two browsers deleting the same sheet should not have
 * one of them report a failure.
 *
 * Deleting a sheet does NOT touch any session published from it. The session
 * carries the questions inlined — see session.ts — so a lesson already handed
 * out keeps working after the sheet behind it is thrown away, which is the
 * property that makes deleting one a safe thing to do mid-term.
 */

interface DeleteBody {
  id?: unknown;
}

export async function onRequestPost(
  context: EventContext<SheetEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.SHEETS) {
    return json({ error: 'No sheet library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return json({ error: 'An id is required', code: 'bad_id' }, 400);
  }

  const existing = await readSheets(env.SHEETS);
  const remaining = existing.filter((entry) => entry.id !== body.id);
  if (remaining.length !== existing.length) {
    await writeSheets(env.SHEETS, remaining);
  }

  return json({ deleted: body.id });
}
