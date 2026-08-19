/**
 * The browser's half of the published session library.
 *
 * Same split as evaluatorStore.ts and for the same reason: session.ts is pure
 * and shared with functions/, and this file talks to the network, so nothing
 * server-side may import it.
 *
 * Both ends of the journey live here — liveTrial publishes through
 * `publishSession`, /eleve reads through `fetchSession` — because they are two
 * halves of one contract and a change to either is a change to both.
 */

import type { MouthDriver, RoundnessMode } from '../live/visemes';
import type {
  SessionMouthDriver,
  SessionRoundness,
  StudentSession,
} from './session';

/**
 * The compile-time half of a promise session.ts makes in prose.
 *
 * It cannot import the mouth unions — visemes.ts reaches audio.ts, which is
 * DOM — so it restates them, and a restatement is a copy waiting to drift. This
 * is where the drift is caught: `Exact` is true only when each union extends
 * the other, so adding a third driver in one file and not the other fails the
 * browser typecheck rather than shipping a config naming a mode the face cannot
 * run.
 *
 * `Exact` resolves to `false` rather than `never` on a mismatch, which is the
 * whole of why the guard works — `never` is assignable to everything, so an
 * assertion written against it passes exactly when it should fail.
 *
 * Exported so `noUnusedLocals` cannot quietly delete the guard.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
export type DriverSpellingMatches = AssertTrue<Exact<MouthDriver, SessionMouthDriver>>;
export type RoundnessSpellingMatches = AssertTrue<Exact<RoundnessMode, SessionRoundness>>;

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(answer?.error || 'That did not work');
  if (!answer) throw new Error('Empty reply');
  return answer;
}

/** Writes a setup and points the student page at it. Throws with the reason. */
export async function publishSession(session: StudentSession): Promise<StudentSession> {
  const answer = await post<{ session: StudentSession }>('/api/sessions/publish', { session });
  return answer.session;
}

/**
 * The setup to run, by code or by pointer.
 *
 * Null is a real answer rather than a failure — nothing has been published yet
 * — and the page renders an invitation for it. A thrown error is the other
 * case: the library could not be reached at all, which is worth saying out loud
 * because retrying might fix it and publishing again will not.
 */
export async function fetchSession(code?: string | null): Promise<StudentSession | null> {
  const answer = await post<{ session: StudentSession | null }>('/api/sessions/get', {
    code: code || undefined,
  });
  return answer.session ?? null;
}

/**
 * The code in the address bar, if there is one.
 *
 * Read but not advertised. Join codes are a later pass — there is no card to
 * type one into and no page that hands one out — but the resolution order is
 * wired now, so that pass is a form rather than a migration. Upper-cased
 * because a code is read off a board and typed back in whatever case the
 * keyboard was in.
 */
export function codeFromUrl(): string | null {
  try {
    const code = new URL(window.location.href).searchParams.get('c');
    return code ? code.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}
