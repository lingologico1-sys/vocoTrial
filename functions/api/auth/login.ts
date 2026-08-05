import { type GateEnv, json } from '../_middleware';
import { mintToken, passwordMatches, setCookie } from './_cookie';

/**
 * Exchanges the site password for a session cookie.
 *
 * Reachable without a cookie — the middleware exempts /api/auth/* — so this is
 * the one route an unauthenticated caller can touch. It mints nothing billable
 * and talks to no provider, so that exemption costs nothing.
 */
export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (!env.SITE_PASSWORD) {
    // Fail closed and say why: an unset password must never mean "open".
    return json(
      { error: 'SITE_PASSWORD is not configured on this deployment', code: 'no_password' },
      500,
    );
  }

  let supplied = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === 'string') supplied = body.password;
  } catch {
    // Malformed body is just a failed attempt; fall through to the check.
  }

  if (!supplied || !(await passwordMatches(supplied, env.SITE_PASSWORD))) {
    return json({ error: 'Incorrect password', code: 'bad_password' }, 401);
  }

  const token = await mintToken(env.SITE_PASSWORD);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie(new URL(request.url), token),
    },
  });
}
