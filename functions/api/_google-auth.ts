/**
 * A Google OAuth2 access token, minted in the Worker from a service-account key.
 *
 * WHY THIS EXISTS. Vertex used to be reached in express mode, on an API key in
 * `x-goog-api-key`, which needed no exchange at all — see the header of
 * _vertex.ts for what that surface was and why it was chosen. Service-account
 * JSONs replace it, and they are not a credential any HTTP header will carry:
 * the key is an RSA private key, and what Google accepts is a short-lived token
 * signed by it. So the exchange has to happen here, on every cold start.
 *
 * It is all WebCrypto and fetch, deliberately. No dependency, nothing Node-only,
 * so the same module runs unchanged in the Worker and under `node` in
 * scripts/vertex-sa.ts — which is the point, because a probe that mints tokens
 * its own way tests a code path nobody ships.
 *
 * The private key never leaves the isolate. What goes over the wire is a JWT
 * signed with it and, in return, a token good for an hour.
 */

export interface ServiceAccount {
  type?: string;
  project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

/** Vertex wants the broad cloud scope; there is no narrower one for aiplatform. */
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/**
 * Tokens already minted, by service-account address.
 *
 * KEYED BY ACCOUNT, NOT A SINGLE SLOT, because there is a pool: the failover in
 * _vertex.ts moves between accounts mid-request, and a one-entry cache would
 * have each move evict the other's token and re-mint it on the way back. The
 * map is per-isolate and dies with it, which is the correct lifetime — a token
 * is not worth persisting, and an isolate rarely outlives one.
 */
const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Refresh this far before expiry, so a token cannot die mid-flight. */
const SKEW_SECONDS = 120;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlText(text: string): string {
  return base64url(new TextEncoder().encode(text));
}

/**
 * The PEM body as DER.
 *
 * Service-account JSON stores the key PEM-armoured with literal `\n`, which
 * JSON.parse has already turned into real newlines by the time this sees it.
 * Stripping all whitespace rather than splitting on lines is what makes it
 * indifferent to which of the two it was handed.
 */
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Parses a service-account JSON, or returns null if it is not one. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * A bearer token for this account, minted or reused.
 *
 * Throws rather than returning null when the exchange fails, because every
 * distinguishable failure here is a broken credential rather than a missing
 * one: a malformed key, a disabled account, a revoked key. The callers treat
 * "no credential configured" and "this credential was refused" differently —
 * the first is a 500 telling you to set a secret, the second is worth failing
 * over to the next account in the pool.
 */
export async function accessToken(sa: ServiceAccount): Promise<string> {
  const who = sa.client_email;
  if (!who || !sa.private_key) throw new Error('Service account is missing client_email or private_key');

  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(who);
  if (cached && cached.expiresAt - SKEW_SECONDS > now) return cached.token;

  const tokenUri = sa.token_uri || DEFAULT_TOKEN_URI;
  const header = base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64urlText(
    JSON.stringify({ iss: who, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }),
  );
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    // The body carries Google's own reason (invalid_grant, and so on). Worth
    // keeping: the common causes — a clock far out, a deleted key — are told
    // apart only by it.
    throw new Error(`Token exchange for ${who} failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error(`Token exchange for ${who} returned no access_token`);

  tokens.set(who, { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) });
  return body.access_token;
}
