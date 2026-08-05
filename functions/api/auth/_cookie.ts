/**
 * The session cookie behind the site password.
 *
 * WHY A COOKIE AND NOT A HEADER. The Gemini path is a WebSocket, and a browser
 * cannot set custom headers on an upgrade handshake — that is a limitation of
 * the WebSocket constructor, not something a library works around. Cookies ride
 * the handshake automatically, so a cookie is the only credential that covers
 * both /api/session/* (fetch) and /api/live/gemini (socket) with one mechanism.
 * HttpOnly is the bonus: unlike localStorage, injected script cannot read it.
 *
 * WHAT IS IN THE COOKIE. Not the password. The value is an expiry plus an HMAC
 * of that expiry keyed by the password, so the cookie proves someone knew the
 * password once without carrying it, and the expiry cannot be edited forward.
 * Verification is a recomputation, so no session store is needed — which suits
 * Workers, where there is nowhere to keep one without adding KV.
 */

const COOKIE_NAME = 'voco_session';

/** How long a successful login lasts. The user asked for it to persist. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64Url(new Uint8Array(signature));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return base64Url(new Uint8Array(digest));
}

/**
 * Compares without an early return, so the time taken says nothing about how
 * much of the value matched.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Both sides are hashed first so the compared strings are always the same
 * length — otherwise the length check above would leak the password's length.
 */
export async function passwordMatches(supplied: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(supplied), sha256(expected)]);
  return timingSafeEqual(a, b);
}

export async function mintToken(secret: string): Promise<string> {
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  return `${expiresAt}.${await hmac(secret, String(expiresAt))}`;
}

export async function tokenIsValid(secret: string, token: string): Promise<boolean> {
  const separator = token.indexOf('.');
  if (separator < 1) return false;

  const expiresAt = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;

  return timingSafeEqual(signature, await hmac(secret, expiresAt));
}

/** Pulls our cookie out of the request's Cookie header, if it is there. */
export function readToken(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }

  return null;
}

/**
 * `Secure` is set only over https so that `wrangler pages dev` on plain
 * http://localhost still works. SameSite=Strict costs nothing here — every
 * caller is our own page, and same-origin is same-site, so the WebSocket
 * handshake still gets the cookie.
 */
function serialize(url: URL, value: string, maxAge: number): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (url.protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

export function setCookie(url: URL, token: string): string {
  return serialize(url, token, TTL_SECONDS);
}

export function clearCookie(url: URL): string {
  return serialize(url, '', 0);
}
