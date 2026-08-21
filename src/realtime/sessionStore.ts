/**
 * The browser's half of the published setup library.
 *
 * Same split as evaluatorStore.ts and for the same reason: session.ts is pure
 * and shared with functions/, and this file talks to the network, so nothing
 * server-side may import it.
 *
 * Both ends of the journey live here — /teach publishes through
 * `publishVocoSession`, /eleve reads through `fetchSetup` — because they are
 * two halves of one contract and a change to either is a change to both.
 *
 * WHAT GOES OUT IS NOT WHAT COMES BACK, which is new and worth the sentence. A
 * publish sends a Voco Session: ids, and the lesson as the teacher typed it. A
 * `PublishedSetup` comes back, with the prompt composed, the house profile
 * flattened in and a code minted. All of that happens in the route, because all
 * of it needs buckets a teacher's browser has no business reading. See
 * functions/api/sessions/publish.ts.
 */

import type { MouthDriver, RoundnessMode } from '../live/visemes';
import type {
  PublishedSetup,
  SessionMouthDriver,
  SessionRoundness,
} from './session';
import type { VocoSession } from './vocoSessions';

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

/** One row of the teacher's list of what has gone out. */
export interface PublishedRow {
  code: string;
  label: string;
  lesson: string;
  updatedAt: number;
  /**
   * Which tutor protocol this code's prompt was composed against, if it says.
   *
   * Off the object's R2 metadata rather than out of the setup — the listing
   * deliberately never reads a setup body, see listSetups — which is why it can
   * be absent for two different reasons and is read as stale for both. See
   * PROMPT_COMPOSER_VERSION in vocoSessions.ts.
   */
  composerVersion?: number;
}

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

/**
 * Hands a Voco Session out, and gets back the code to read to a class.
 *
 * Throws with the reason, which /teach shows verbatim — the route's messages
 * are written for the teacher rather than for a log, and the two that matter
 * (no style published, prompt too long) both name what to do about it.
 */
export async function publishVocoSession(
  session: VocoSession,
  label?: string,
): Promise<PublishedSetup> {
  const answer = await post<{ setup: PublishedSetup }>('/api/sessions/publish', {
    session,
    label,
  });
  return answer.setup;
}

/**
 * The setup behind a code.
 *
 * Null is a real answer rather than a failure — the code was typed wrong, or
 * names a lesson deleted since — and the page renders "check that code" for it.
 * A thrown error is the other case: the library could not be reached at all,
 * which is worth saying out loud because retrying might fix it and retyping the
 * code will not.
 */
export async function fetchSetup(code: string): Promise<PublishedSetup | null> {
  const answer = await post<{ setup: PublishedSetup | null }>('/api/sessions/get', { code });
  return answer.setup ?? null;
}

/** What this deployment has published, newest first. Teacher-facing. */
export async function listPublishedSetups(): Promise<{ setups: PublishedRow[]; error?: string }> {
  try {
    return await post<{ setups: PublishedRow[] }>('/api/sessions/list', {});
  } catch (error) {
    return {
      setups: [],
      error: error instanceof Error ? error.message : 'Could not read what has been published',
    };
  }
}

/**
 * The code in the address bar, if there is one.
 *
 * `token`, not `c`. The parameter is LingoLecto's, already in circulation on
 * links handed to real students, and a second spelling would mean every future
 * shared link had to know which app it was pointing at — see
 * docs/lesson-codes.md. The old `?c=` is not accepted: it was never shown to a
 * student, so no link carrying it exists outside a developer's history.
 *
 * Not validated here. A student who mistypes should meet the page's own words,
 * not a silent null that looks like having typed nothing at all.
 */
export function codeFromUrl(): string {
  try {
    const code = new URL(window.location.href).searchParams.get('token');
    return code ? code.trim().toUpperCase() : '';
  } catch {
    return '';
  }
}
