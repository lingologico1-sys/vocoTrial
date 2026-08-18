import { json } from '../_middleware';
import { MAX_KIT_BYTES, kitKey, sourceKey, type PublishedFace } from '../../../src/facekit/published';
import { type LibraryEnv, readIndex, writeIndex } from './_library';

/**
 * Copies one authored kit into the shared library, as two objects.
 *
 * Keyed by the kit's own id, so publishing a kit twice replaces it rather than
 * leaving two faces with one name — which is what "publish" should mean for
 * artwork you are still adjusting.
 *
 * WHAT ARRIVES IS THE AUTHORING COPY, `original` included, and the split is
 * made here rather than in the browser. Two writes come out of it: the copy
 * verbatim under sourceKey, and the same kit minus `original` under kitKey for
 * everything that only wears the face. Stripping server-side is why the browser
 * uploads the big payload once instead of uploading both halves — see
 * publishKit() in facekit/library.ts, and the note on sourceKey for why the two
 * are separate objects at all.
 *
 * The checks below are shape checks, not a security boundary. The middleware
 * has already established that the caller knew the site password, and every
 * caller is faceKit; what these catch is a malformed kit poisoning the index
 * for the pages that read it, which is a bug rather than an attack.
 *
 * Both objects are written before the index. That order is deliberate:
 * interrupted before it, the bucket holds objects nothing lists — invisible,
 * and overwritten by the next publish. The other order would list a face whose
 * artwork is not there, which is a broken picker rather than a quiet one.
 * Between the two objects there is no order to get right, since neither is
 * reachable until the index names them.
 */

interface PublishBody {
  kit?: unknown;
  thumb?: unknown;
}

/** Enough of a kit to be worn. The rest is faceKit's business, not this route's. */
function looksLikeKit(value: unknown): value is Record<string, unknown> & { id: string; name: string; createdAt?: number } {
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
  const source = JSON.stringify(kit);
  // Measured in bytes rather than characters: the data URLs are ASCII, but the
  // name beside them is whatever someone typed, and a length in UTF-16 code
  // units would be the wrong number for the thing being capped. Measured on the
  // authoring copy, which is the larger of the two and the one that had to
  // cross the wire.
  const size = new TextEncoder().encode(source).length;
  if (size > MAX_KIT_BYTES) {
    return json(
      { error: `That kit is ${Math.round(size / 1e6)} MB, over the limit`, code: 'too_large' },
      413,
    );
  }

  // Re-serialised from a copy rather than edited as text: `original` is a data
  // URL of unbounded length sitting among other data URLs, and there is no
  // honest way to cut one out of a JSON string.
  const wearable = { ...kit };
  delete wearable.original;

  await Promise.all([
    env.FACES.put(sourceKey(kit.id), source, {
      httpMetadata: { contentType: 'application/json' },
    }),
    env.FACES.put(kitKey(kit.id), JSON.stringify(wearable), {
      httpMetadata: { contentType: 'application/json' },
    }),
  ]);

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
