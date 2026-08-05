import { type GateEnv, json } from '../_middleware';
import { readToken, tokenIsValid } from './_cookie';

/**
 * Whether the caller's cookie is currently good.
 *
 * The cookie is HttpOnly, so the page cannot look at it — this route is how the
 * UI decides between showing the password form and showing the app on load.
 * It reveals only a boolean about the caller's own cookie.
 */
export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  const token = readToken(request);
  const authed = Boolean(
    env.SITE_PASSWORD && token && (await tokenIsValid(env.SITE_PASSWORD, token)),
  );

  return json({ authed, configured: Boolean(env.SITE_PASSWORD) });
}
