import { type GateEnv } from '../_middleware';
import { clearCookie } from './_cookie';

/**
 * Drops the session cookie.
 *
 * Only expires the caller's own cookie — there is no session store, so this
 * cannot revoke one already handed out elsewhere. To lock everyone out at once,
 * change SITE_PASSWORD: every existing token is an HMAC keyed by it, so they
 * all stop verifying the moment it changes.
 */
export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookie(new URL(context.request.url)),
    },
  });
}
