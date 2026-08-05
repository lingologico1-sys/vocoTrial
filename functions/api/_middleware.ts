/**
 * Single gate in front of every /api/* route.
 *
 * The routes behind it mint spendable credentials, so the default posture is
 * closed: same-origin POSTs only, everything else refused before a handler
 * runs. A route added later is covered without anyone remembering to cover it.
 *
 * WHAT THIS DOES NOT DO: identify the caller. An Origin header is set by the
 * browser but trivially forged by anything that is not a browser, so this stops
 * other *sites* from using our keys, not a determined individual with curl.
 * Until vocoTrial has real users that is the right trade — but before this is
 * public, put an actual session check here (sciptomondo's functions/api/auth/
 * is the worked example) and rate-limit per user. A minted OpenAI or Gemini
 * token is billable the moment it exists.
 */

export interface GateEnv {
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENAI_REALTIME_VOICE?: string;
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
  const { request, next } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  if (!isSameOrigin(request, url)) {
    return json({ error: 'Forbidden', code: 'cross_origin' }, 403);
  }

  // Preflight reveals nothing and carries no body; answer it directly.
  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }), origin);
  }

  if (request.method !== 'POST') {
    return withCors(json({ error: 'Method not allowed' }, 405), origin);
  }

  return withCors(await next(), origin);
}
