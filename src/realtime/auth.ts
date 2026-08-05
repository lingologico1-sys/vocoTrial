/**
 * The browser half of the site password.
 *
 * There is deliberately no password in this module's state and nothing in
 * localStorage. The session lives in an HttpOnly cookie the Worker sets, which
 * this page cannot read — so "am I signed in?" is a question only the server
 * can answer, and checkSession() is how it gets asked.
 *
 * Persistence comes free with that: the cookie outlives the tab, so a returning
 * visitor is already through the gate without the page having stored anything.
 */

/** Thrown wherever a 401 comes back, so callers can re-prompt instead of dying. */
export class UnauthorizedError extends Error {
  constructor(message = 'Password required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Lets anything that meets a 401 mid-flight kick the UI back to the gate,
 * without every call site having to thread a callback down to it. The gate
 * registers itself on mount.
 */
let onExpired: (() => void) | null = null;

export function setExpiredHandler(handler: (() => void) | null): void {
  onExpired = handler;
}

export function reportExpired(): void {
  onExpired?.();
}

export interface SessionState {
  authed: boolean;
  /** False when the deployment has no SITE_PASSWORD set — nobody can get in. */
  configured: boolean;
}

export async function checkSession(): Promise<SessionState> {
  const response = await fetch('/api/auth/status', { method: 'POST' });
  if (!response.ok) return { authed: false, configured: true };
  return (await response.json()) as SessionState;
}

/**
 * Returns null on success, or a message to show under the field. A wrong
 * password is an expected outcome here, not an exception.
 */
export async function login(password: string): Promise<string | null> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  if (response.ok) return null;

  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'Could not sign in';
  } catch {
    return `Could not sign in (${response.status})`;
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}
