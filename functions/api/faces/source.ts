import { json } from '../_middleware';
import { legacySourceKey } from '../../../src/facekit/published';
import type { LibraryEnv } from './_library';

/**
 * A face's whole authoring copy, from before the portrait was split out.
 *
 * A legacy route, and the only reader of the sources/ prefix. It exists so that
 * the portrait inside those objects can still be recovered: for the faces
 * published in the window when this prefix was how `original` was stored, this
 * is the one place it survives, and abandoning it would mean quietly losing
 * "start again from the original" for them.
 *
 * The browser does the extraction rather than the Worker, and that is the
 * reason this hands back the whole object instead of the one member wanted.
 * Pulling `original` out here would mean parsing twenty-odd megabytes of JSON
 * inside a Worker with 128 MB to its name, to save bytes on a request that
 * happens once per face ever. The browser already parses whole kits.
 *
 * Self-limiting by design: a face opened through here is saved back through
 * publish.ts, which writes the portrait under originals/ and deletes the object
 * this route just read. Deletable once no bucket holds a sources/ key.
 */
export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.FACES) {
    return json({ error: 'No face library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== 'string' || !body.id) {
    return json({ error: 'A face id is required', code: 'bad_id' }, 400);
  }

  const object = await env.FACES.get(legacySourceKey(body.id));
  if (!object) {
    return json({ error: `No legacy authoring copy of "${body.id}"`, code: 'no_source' }, 404);
  }

  return new Response(object.body, {
    headers: { 'Content-Type': 'application/json' },
  });
}
