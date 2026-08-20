import { json } from '../_middleware';
import { type HouseEnv, readStyles, writeStyles } from './_library';

/**
 * Removes one tutor style from the house library.
 *
 * An id that is not there is a success rather than a 404: the caller wanted it
 * gone, and it is gone.
 *
 * Deleting a style does NOT touch any setup published with it, which carries
 * the composed prompt as text — see session.ts. It does leave any Voco Session
 * naming it pointing at nothing, and that is handled where it is spent: the
 * publish route falls back to the newest style, and /teach's picker shows the
 * same fallback so the two agree.
 */

interface DeleteBody {
  id?: unknown;
}

export async function onRequestPost(
  context: EventContext<HouseEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.HOUSE) {
    return json({ error: 'No house library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return json({ error: 'An id is required', code: 'bad_id' }, 400);
  }

  const existing = await readStyles(env.HOUSE);
  const remaining = existing.filter((entry) => entry.id !== body.id);
  if (remaining.length !== existing.length) {
    await writeStyles(env.HOUSE, remaining);
  }

  return json({ deleted: body.id });
}
