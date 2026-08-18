import { json } from '../_middleware';
import { MAX_KIT_BYTES, kitKey, type PublishedFace } from '../../../src/facekit/published';
import { type LibraryEnv, readIndex, writeIndex } from './_library';

/**
 * Copies one authored kit into the shared library.
 *
 * Keyed by the kit's own id, so publishing a kit twice replaces it rather than
 * leaving two faces with one name — which is what "publish" should mean for
 * artwork you are still adjusting.
 *
 * The checks below are shape checks, not a security boundary. The middleware
 * has already established that the caller knew the site password, and every
 * caller is faceKit; what these catch is a malformed kit poisoning the index
 * for the pages that read it, which is a bug rather than an attack.
 *
 * The kit is written before the index. That order is deliberate: interrupted
 * between the two, the bucket holds an object nothing lists — invisible, and
 * overwritten by the next publish. The other order would list a face whose
 * artwork is not there, which is a broken picker rather than a quiet one.
 */

interface PublishBody {
  kit?: unknown;
  thumb?: unknown;
}

/** Enough of a kit to be worn. The rest is faceKit's business, not this route's. */
function looksLikeKit(value: unknown): value is { id: string; name: string; createdAt?: number } {
  if (typeof value !== 'object' || value === null) return false;
  const kit = value as Record<string, unknown>;
  return (
    typeof kit.id === 'string' &&
    kit.id.length > 0 &&
    typeof kit.name === 'string' &&
    typeof kit.base === 'string' &&
    typeof kit.boxes === 'object' &&
    kit.boxes !== null
  );
}

export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.FACES) {
    return json({ error: 'No face library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as PublishBody | null;
  if (!looksLikeKit(body?.kit)) {
    return json({ error: 'That is not a face kit', code: 'bad_kit' }, 400);
  }
  if (typeof body?.thumb !== 'string' || !body.thumb.startsWith('data:image/')) {
    return json({ error: 'A thumbnail is required', code: 'bad_thumb' }, 400);
  }

  const kit = body.kit;
  const payload = JSON.stringify(kit);
  // Measured in bytes rather than characters: the data URLs are ASCII, but the
  // name beside them is whatever someone typed, and a length in UTF-16 code
  // units would be the wrong number for the thing being capped.
  const size = new TextEncoder().encode(payload).length;
  if (size > MAX_KIT_BYTES) {
    return json(
      { error: `That kit is ${Math.round(size / 1e6)} MB, over the limit`, code: 'too_large' },
      413,
    );
  }

  await env.FACES.put(kitKey(kit.id), payload, {
    httpMetadata: { contentType: 'application/json' },
  });

  const entry: PublishedFace = {
    id: kit.id,
    name: kit.name || 'Untitled',
    createdAt: typeof kit.createdAt === 'number' ? kit.createdAt : Date.now(),
    publishedAt: Date.now(),
    thumb: body.thumb,
  };

  const faces = await readIndex(env.FACES);
  const without = faces.filter((face) => face.id !== entry.id);
  await writeIndex(env.FACES, [entry, ...without].sort((a, b) => b.createdAt - a.createdAt));

  return json({ face: entry });
}
