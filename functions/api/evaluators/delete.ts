import { json } from '../_middleware';
import { type LibraryEnv, readLibrary, writeLibrary } from './_library';

/**
 * Removes one evaluator from the shared library.
 *
 * An id that is not there is a success rather than a 404: the caller wanted it
 * gone, and it is gone. Two browsers deleting the same scale should not have
 * one of them report a failure.
 *
 * The built-in needs no special case here. It is never in the bucket, so a
 * request naming it removes nothing and the picker still offers it — which is
 * the correct outcome and not worth a message of its own.
 */

interface DeleteBody {
  id?: unknown;
}

export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.EVALUATORS) {
    return json({ error: 'No evaluator library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return json({ error: 'An id is required', code: 'bad_id' }, 400);
  }

  const existing = await readLibrary(env.EVALUATORS);
  const remaining = existing.filter((entry) => entry.id !== body.id);
  if (remaining.length !== existing.length) {
    await writeLibrary(env.EVALUATORS, remaining);
  }

  return json({ deleted: body.id });
}
