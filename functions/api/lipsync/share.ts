import { json } from '../_middleware';
import type { LipsyncEnv } from './_library';
import { packageKey } from '../../../src/lipsync/published';
import {
  looksLikeToken,
  shareKey,
  shareOfTakeKey,
  type Share,
} from '../../../src/lipsync/shared';

/**
 * Cuts a key for one take, or throws it away.
 *
 * Behind the gate, deliberately — minting is the privileged half and reading is the
 * public one, and they are separate routes so that no amount of confusion about a body
 * can turn a read into a mint. The public half is functions/api/share/.
 *
 * Idempotent per take: a second share of the same take returns the same token with its
 * face updated, rather than a second link. See shareOfTakeKey for why that matters.
 */

function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    faceId?: unknown;
    revoke?: unknown;
  } | null;

  const takeId = typeof body?.id === 'string' ? body.id : '';
  if (!takeId) return json({ error: 'No id', code: 'no_id' }, 400);

  const pointerKey = shareOfTakeKey(takeId);
  const pointer = (await env.LIPSYNC.get(pointerKey)
    .then((object) => (object ? (object.json() as Promise<{ token?: string }>) : null))
    .catch(() => null)) as { token?: string } | null;
  const existing = looksLikeToken(pointer?.token) ? pointer.token : null;

  if (body?.revoke === true) {
    // Both objects, and the pointer last: an interruption then leaves a pointer at a
    // token that no longer opens anything, which reads as "not shared" to every caller.
    if (existing) await env.LIPSYNC.delete(shareKey(existing));
    await env.LIPSYNC.delete(pointerKey);
    return json({ token: null });
  }

  // Checked rather than assumed: a link to a take that was deleted is a link to a 404,
  // and finding that out now is better than the person you sent it to finding out.
  if (!(await env.LIPSYNC.head(packageKey(takeId)))) {
    return json({ error: 'No such line', code: 'not_found' }, 404);
  }

  const token = existing ?? mintToken();
  const share: Share = {
    token,
    takeId,
    faceId: typeof body?.faceId === 'string' ? body.faceId : '',
    createdAt: Date.now(),
  };

  await env.LIPSYNC.put(shareKey(token), JSON.stringify(share), {
    httpMetadata: { contentType: 'application/json' },
  });
  if (!existing) {
    await env.LIPSYNC.put(pointerKey, JSON.stringify({ token }), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  return json({ token, faceId: share.faceId });
}
