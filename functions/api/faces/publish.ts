import { json } from '../_middleware';
import {
  MAX_KIT_BYTES,
  kitKey,
  legacySourceKey,
  originalKey,
  eyewearSourceKey,
  type PublishedFace,
} from '../../../src/facekit/published';
import { type LibraryEnv, readIndex, writeIndex } from './_library';

/**
 * Writes one kit into the shared library.
 *
 * Keyed by the kit's own id, so saving a kit twice replaces it rather than
 * leaving two faces with one name — which is what saving should mean for
 * artwork you are still adjusting.
 *
 * THIS IS THE SAVE PATH, not a second step after one. faceKit has no local
 * store any more: the bucket is where a kit lives from its first save, which is
 * why `ready` exists to say whether the thing saved is finished. A face arrives
 * here half-drawn as a matter of course.
 *
 * WHAT ARRIVES IS THE WEARABLE KIT without authoring sources. The uploaded
 * portrait and exact pre-deglassing neutral base arrive separately when they
 * changed, and are written under their own keys. None contains another, so a
 * student reads only wearable artwork and an ordinary save does not resend
 * unchanged authoring history.
 *
 * The checks below are shape checks, not a security boundary. The middleware
 * has already established that the caller knew the site password, and every
 * caller is faceKit; what these catch is a malformed kit poisoning the index
 * for the pages that read it, which is a bug rather than an attack.
 *
 * The objects are written before the index. That order is deliberate:
 * interrupted before it, the bucket holds objects nothing lists — invisible,
 * and overwritten by the next save. The other order would list a face whose
 * artwork is not there, which is a broken picker rather than a quiet one.
 * Between the objects there is no order to get right, since none is reachable
 * until the index names them.
 */

interface PublishBody {
  kit?: unknown;
  thumb?: unknown;
  original?: unknown;
  eyewearSource?: unknown;
  removeEyewearSource?: unknown;
  ready?: unknown;
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
  // Absent is the ordinary case — every save after the first — so only a
  // present-but-wrong value is a refusal.
  const original = body.original;
  if (original !== undefined && (typeof original !== 'string' || !original.startsWith('data:image/'))) {
    return json({ error: 'That is not a portrait', code: 'bad_original' }, 400);
  }
  const eyewearSource = body.eyewearSource;
  if (
    eyewearSource !== undefined &&
    (typeof eyewearSource !== 'string' || !eyewearSource.startsWith('data:image/'))
  ) {
    return json({ error: 'That is not an eyewear source', code: 'bad_eyewear_source' }, 400);
  }

  const kit = body.kit;
  // Belt and braces: the browser strips `original` before sending, and this is
  // what stops a caller that forgot from writing the bytes into both objects.
  delete kit.original;
  delete kit.glassed;
  const wearable = JSON.stringify(kit);

  // Measured in bytes rather than characters: the data URLs are ASCII, but the
  // name beside them is whatever someone typed, and a length in UTF-16 code
  // units would be the wrong number for the thing being capped. Measured across
  // both halves, since both had to cross the wire to get here.
  const encoder = new TextEncoder();
  const size =
    encoder.encode(wearable).length +
    (original ? encoder.encode(original).length : 0) +
    (typeof eyewearSource === 'string' ? encoder.encode(eyewearSource).length : 0);
  if (size > MAX_KIT_BYTES) {
    return json(
      { error: `That kit is ${Math.round(size / 1e6)} MB, over the limit`, code: 'too_large' },
      413,
    );
  }

  const faces = await readIndex(env.FACES);
  const existing = faces.find((face) => face.id === kit.id);

  await Promise.all([
    env.FACES.put(kitKey(kit.id), wearable, {
      httpMetadata: { contentType: 'application/json' },
    }),
    ...(original === undefined
      ? []
      : [
          env.FACES.put(originalKey(kit.id), JSON.stringify(original), {
            httpMetadata: { contentType: 'application/json' },
          }),
          // Only now, and this condition is the whole of the safety. A face
          // published in the window when sources/ existed keeps its portrait
          // inside that object and nowhere else; deleting it on every save
          // would throw the portrait away to tidy up after it. Reached only on
          // the save that has just written the replacement, so what goes is a
          // copy of something the bucket now holds under its own key. A face
          // nobody re-saves keeps its legacy object until it is deleted, which
          // costs storage and nothing else. See legacySourceKey.
          env.FACES.delete(legacySourceKey(kit.id)),
        ]),
    ...(eyewearSource === undefined
      ? []
      : [
          env.FACES.put(eyewearSourceKey(kit.id), JSON.stringify(eyewearSource), {
            httpMetadata: { contentType: 'application/json' },
          }),
        ]),
  ]);

  const entry: PublishedFace = {
    id: kit.id,
    name: kit.name || 'Untitled',
    createdAt: typeof kit.createdAt === 'number' ? kit.createdAt : Date.now(),
    publishedAt: Date.now(),
    thumb: body.thumb,
    // Draft unless the caller says otherwise. The default matters: this route
    // is now reached by every save, most of which are of unfinished faces, and
    // the safe reading of "someone pressed save" is not "put this in front of a
    // class". Saying `ready: true` is a separate, deliberate act.
    ready: body.ready === true,
    // True once the portrait has ever been written, not only when it arrived
    // just now — that is the whole point of not re-sending it.
    hasOriginal: original !== undefined || existing?.hasOriginal === true,
    hasEyewearSource:
      body.removeEyewearSource === true
        ? false
        : eyewearSource !== undefined || existing?.hasEyewearSource === true,
  };

  const without = faces.filter((face) => face.id !== entry.id);
  await writeIndex(env.FACES, [entry, ...without].sort((a, b) => b.createdAt - a.createdAt));

  // Removal follows the index for the same safety ordering as delete.ts. If
  // this request stops between the two, an unlisted authoring object remains
  // and nothing tries to fetch it; the reverse order could leave an index that
  // promises a source which has already gone.
  if (body.removeEyewearSource === true) {
    await env.FACES.delete(eyewearSourceKey(kit.id));
  }

  return json({ face: entry });
}
