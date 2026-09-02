import { json } from '../_middleware';
import { looksLikeToken, shareKey, type Share } from '../../../src/lipsync/shared';

/**
 * The one thing every public route here does first: turn a token into a share, or refuse.
 *
 * These routes run with no session cookie — see the exemption in _middleware.ts — so the
 * token is the entire credential and this function is the entire check. It is therefore
 * written to say nothing a caller did not already know: an unparseable token, a token
 * that was never minted and a token that was revoked all answer the same way, because
 * telling those apart is the difference between guessing blind and guessing with a
 * scoreboard.
 */

export interface ShareEnv {
  LIPSYNC?: R2Bucket;
  FACES?: R2Bucket;
}

export type Resolved = { share: Share } | { refusal: Response };

export async function resolve(request: Request, env: ShareEnv): Promise<Resolved> {
  if (!env.LIPSYNC) {
    return {
      refusal: json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500),
    };
  }

  const body = (await request.json().catch(() => null)) as { t?: unknown } | null;
  const notFound = json({ error: 'That link is not valid', code: 'no_share' }, 404);
  if (!looksLikeToken(body?.t)) return { refusal: notFound };

  const object = await env.LIPSYNC.get(shareKey(body.t));
  if (!object) return { refusal: notFound };

  const share = (await object.json().catch(() => null)) as Share | null;
  if (!share?.takeId) return { refusal: notFound };

  return { share };
}
