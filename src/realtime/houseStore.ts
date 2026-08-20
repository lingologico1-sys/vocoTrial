/**
 * The browser's half of the house library.
 *
 * Same split as evaluatorStore.ts and for the same reason: house.ts is pure and
 * shared with functions/, this file talks to the network, and nothing
 * server-side may import it.
 *
 * Both ends live here — studio writes through `saveStyle` and
 * `savePerformance`, /teach reads through `fetchHouse` — because they are two
 * halves of one contract and a change to either is a change to both.
 *
 * A FAILED READ IS AN EMPTY HOUSE, NOT A THROW, which is evaluatorStore's
 * posture. An unreachable bucket should leave /teach's picker empty and say
 * why, rather than take the page down — the rest of the page still writes a
 * lesson, and the publish button is the only thing that stops working. That is
 * the one place the floor is hard: publishing with no style refuses, in the
 * route, because a tutor with no instructions is not a tutor.
 */

import { DEFAULT_LOOKAHEAD_MS, DEFAULT_ROUNDNESS } from '../live/visemes';
import {
  FALLBACK_LOOKAHEAD_MS,
  FALLBACK_ROUNDNESS,
  type TutorStyle,
} from './house';
import type { PerformanceProfile } from './session';

/**
 * The compile-time half of a promise house.ts makes in prose.
 *
 * house.ts restates two constants it cannot import from a Worker, and a
 * restatement is a copy waiting to drift. This is where the drift is
 * caught: both are visible from the browser side, so a default changed in
 * visemes.ts and not here fails the browser typecheck rather than publishing a
 * face subtly unlike the one the app ships with.
 *
 * Exported so `noUnusedLocals` cannot quietly delete the guard — the
 * arrangement sessionStore.ts uses for the mouth unions, and for the same
 * reason.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
export type RoundnessDefaultMatches = AssertTrue<
  Exact<typeof FALLBACK_ROUNDNESS, typeof DEFAULT_ROUNDNESS>
>;
export type LookaheadDefaultMatches = AssertTrue<
  Exact<typeof FALLBACK_LOOKAHEAD_MS, typeof DEFAULT_LOOKAHEAD_MS>
>;

/** What the house holds, as one read. */
export interface House {
  styles: TutorStyle[];
  /** Null when no administrator has saved one. See FALLBACK_PERFORMANCE. */
  performance: PerformanceProfile | null;
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
 * Both halves in one request, styles newest first.
 *
 * One round trip rather than two because both callers want both: /teach draws a
 * style picker and wants to say whether a house profile is set, and studio
 * wants to show what it would be overwriting. Splitting them would be two
 * requests to render one panel.
 */
export async function fetchHouse(): Promise<House & { error?: string }> {
  try {
    const house = await post<House>('/api/house/get', {});
    return {
      styles: [...house.styles].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
      performance: house.performance ?? null,
    };
  } catch (error) {
    return {
      styles: [],
      performance: null,
      error: error instanceof Error ? error.message : 'Could not read the house library',
    };
  }
}

export async function saveStyle(style: TutorStyle): Promise<TutorStyle> {
  const answer = await post<{ style: TutorStyle }>('/api/house/style-save', { style });
  return answer.style;
}

export async function deleteStyle(id: string): Promise<void> {
  await post('/api/house/style-delete', { id });
}

export async function savePerformance(
  performance: PerformanceProfile,
): Promise<PerformanceProfile> {
  const answer = await post<{ performance: PerformanceProfile }>('/api/house/performance-save', {
    performance,
  });
  return answer.performance;
}

/**
 * The style a Voco Session names, or the one to fall back to.
 *
 * The remembered id may name a style since deleted — on this browser or
 * another, since the library is shared — and publishing is a bad moment to find
 * out. Falls back to the newest style, which is the same rule the publish route
 * applies server-side; the two agree so that what /teach shows is what gets
 * published.
 */
export function resolveStyle(styles: TutorStyle[], id?: string): TutorStyle | null {
  return styles.find((style) => style.id === id) ?? styles[0] ?? null;
}
