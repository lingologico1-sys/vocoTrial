/**
 * Single gate in front of every /api/* route.
 *
 * The routes behind it mint spendable credentials, so the default posture is
 * closed: same-origin POSTs only, everything else refused before a handler
 * runs. A route added later is covered without anyone remembering to cover it.
 *
 * There are two checks, and the second is the one with teeth:
 *
 *  - Same origin. An Origin header is set by the browser but trivially forged
 *    by anything that is not a browser, so alone this stops other *sites* from
 *    using our keys, not a determined individual with curl.
 *  - A valid session cookie, proving the caller knew the site password. This is
 *    what actually keeps strangers off the account, because it is the only one
 *    of the two that curl cannot simply assert. See auth/_cookie.ts.
 *
 * Everything under /api/* needs both, including the WebSocket upgrade — the
 * relay spends the Google key directly for as long as the socket is open, and
 * image generation spends on every request. Two prefixes are exempt from the
 * cookie, and only from the cookie:
 *
 *  - /api/auth/*, which is how a caller gets a cookie in the first place.
 *  - /api/share/*, which serves one take and one face to somebody holding a
 *    link. It carries its own credential instead — a 128-bit token naming
 *    exactly what it opens — and it spends nothing: two R2 reads, no provider,
 *    no key, no listing. See src/lipsync/shared.ts for why the key is cut per
 *    take rather than the gate being widened, and functions/api/share/_token.ts
 *    for the check that replaces this one.
 *
 * STILL NOT DONE: per-caller rate limiting. Workers have no shared counter
 * without KV or a Durable Object, so there is nothing here slowing down
 * repeated password guesses beyond Cloudflare's own edge limits.
 */

import { readToken, tokenIsValid } from './auth/_cookie';

/*
 * `OPENAI_API_KEY` left this list and has come back, which is the whole of its
 * history worth keeping. It went when OpenAI Realtime did and again when the
 * GPT Image models followed, on the rule that declaring a variable nothing
 * reads invites the next person to wire something to it. Something reads it
 * again — functions/api/live/openai.ts, the realtime relay — so the same rule
 * puts it back. The secret was never deleted from the dashboard, which is why
 * this is a declaration rather than a migration.
 */
export interface GateEnv {
  /** Vertex AI key (GCP billing), primary then fallback — see _vertex.ts. */
  GEMINI_API_KEY?: string;
  GEMINI_API_KEY2?: string;
  /**
   * AI Studio key (AI Studio billing) — see _aistudio.ts. Not a fallback for
   * the Vertex keys: it reaches a different catalogue on a different meter, and
   * only the models marked `surface: 'aistudio'` are served by it.
   */
  GOOGLE_API_KEY?: string;
  /** OpenAI, for the realtime relay — see functions/api/live/openai.ts. */
  OPENAI_API_KEY?: string;
  /** The site password. A Secret in the dashboard — never in wrangler.toml. */
  SITE_PASSWORD?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * True when the request came from this deployment's own page.
 *
 * `wrangler pages dev` serves the SPA from a different port than Vite, so a
 * localhost origin is accepted on any port. That branch cannot fire in
 * production: reaching a deployed Pages Function requires a Host that
 * Cloudflare routes to this project, and localhost is not and cannot be one.
 */
function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');

  // Some browsers omit Origin on same-origin requests; fall back to Referer.
  if (!origin) {
    const referer = request.headers.get('Referer');
    if (!referer) return false;
    try {
      return new URL(referer).origin === url.origin;
    } catch {
      return false;
    }
  }

  if (origin === url.origin) return true;

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    try {
      const { hostname } = new URL(origin);
      return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Fails closed when SITE_PASSWORD is unset. A deployment missing the secret is
 * a misconfigured deployment, and the safe reading of that is "nobody gets in"
 * rather than "everybody does".
 */
async function hasValidSession(request: Request, env: GateEnv): Promise<boolean> {
  if (!env.SITE_PASSWORD) return false;
  const token = readToken(request);
  return token !== null && (await tokenIsValid(env.SITE_PASSWORD, token));
}

function withCors(response: Response, origin: string | null): Response {
  const out = new Response(response.body, response);
  if (origin) {
    out.headers.set('Access-Control-Allow-Origin', origin);
    out.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  out.headers.append('Vary', 'Origin');
  return out;
}

export async function onRequest(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  if (!isSameOrigin(request, url)) {
    return json({ error: 'Forbidden', code: 'cross_origin' }, 403);
  }

  // Preflight reveals nothing and carries no body; answer it directly.
  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }), origin);
  }

  // The two prefixes described at the top of this file, and nothing else.
  // Scoped to exact prefixes: a route added elsewhere is covered by default.
  const isOpenRoute =
    url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/share/');

  if (!isOpenRoute && !(await hasValidSession(request, env))) {
    // 401 rather than 403 — the client tells these apart to decide whether to
    // re-prompt for the password or report a genuine refusal.
    return json({ error: 'Password required', code: 'unauthorized' }, 401);
  }

  // A WebSocket upgrade is a GET, and its 101 response carries a live socket
  // that cannot survive being copied into a new Response. So it skips both the
  // POST rule and the CORS wrapper below — but neither the origin check nor the
  // session check above, which are the ones that matter here.
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    return next();
  }

  if (request.method !== 'POST') {
    return withCors(json({ error: 'Method not allowed' }, 405), origin);
  }

  return withCors(await next(), origin);
}
