import { json } from '../_middleware';
import { type LibraryEnv, readLibrary, writeLibrary } from './_library';

/**
 * Removes one prompt from the shared library.
 *
 * A key that is not there is a success rather than a 404: the caller wanted it
 * gone, and it is gone. Two browsers deleting the same prompt should not have
 * one of them report a failure.
 *
 * The built-ins need no special case. They are never in the bucket, so a
 * request naming one removes nothing and the picker still offers it — which is
 * the correct outcome and not worth a message of its own.
 *
 * A MANNER PUBLISHED FROM THIS PROMPT SURVIVES IT, and that is deliberate
 * rather than an oversight. Studio publishes the rendered text into the house
 * library, and a published lesson carries a flattened copy of that again — so
 * deleting the draft here reaches neither. Same rule as everything else that
 * was handed out: what went out stays out.
 */

interface DeleteBody {
  key?: unknown;
}

export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.PROMPTS) {
    return json({ error: 'No prompt library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  if (typeof body?.key !== 'string' || !body.key) {
    return json({ error: 'A key is required', code: 'bad_key' }, 400);
  }

  const existing = await readLibrary(env.PROMPTS);
  const remaining = existing.filter((entry) => entry.key !== body.key);
  if (remaining.length !== existing.length) {
    await writeLibrary(env.PROMPTS, remaining);
  }

  return json({ deleted: body.key });
}
