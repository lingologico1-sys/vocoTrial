/**
 * The browser's half of the Voco Session library.
 *
 * Same split as evaluatorStore.ts and for the same reason: vocoSessions.ts is
 * pure and shared with functions/, this file talks to the network, and nothing
 * server-side may import it.
 *
 * A FAILED LIST IS AN EMPTY LIST, NOT A THROW — evaluatorStore's posture, with
 * a different floor. There the fallback is the built-in scale, because a report
 * needs one; here there is nothing to fall back to and nothing that needs one,
 * so an unreachable bucket leaves /teach on a blank new session and still lets
 * it be written. The error travels alongside so the page can say why the picker
 * is empty rather than implying nobody has written a lesson.
 */

import type { VocoSession } from './vocoSessions';

/** Where the last pick is remembered. Nothing here is a secret. */
const CHOICE_KEY = 'vocotrial.vocoSession.v1';

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

/** Newest first, so the one being worked on is at the top of the picker. */
export async function listVocoSessions(): Promise<{ sessions: VocoSession[]; error?: string }> {
  try {
    const { sessions } = await post<{ sessions: VocoSession[] }>('/api/voco-sessions/list', {});
    return { sessions: [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)) };
  } catch (error) {
    return {
      sessions: [],
      error: error instanceof Error ? error.message : 'Could not read the library',
    };
  }
}

export async function saveVocoSession(session: VocoSession): Promise<VocoSession> {
  const answer = await post<{ session: VocoSession }>('/api/voco-sessions/save', { session });
  return answer.session;
}

export async function deleteVocoSession(id: string): Promise<void> {
  await post('/api/voco-sessions/delete', { id });
}

export function rememberVocoSession(id: string): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, id);
  } catch {
    // Losing the pick costs one dropdown change on the next visit.
  }
}

/**
 * The id last opened, checked against what actually exists.
 *
 * The remembered id may name one since deleted — on this browser or another,
 * since the library is shared — and landing on a picker with a selection that
 * resolves to nothing is worse than landing on the newest. Falls back to the
 * newest, which `listVocoSessions` has already sorted to the front.
 */
export function lastVocoSessionId(available: VocoSession[]): string {
  try {
    const remembered = window.localStorage.getItem(CHOICE_KEY);
    if (remembered && available.some((entry) => entry.id === remembered)) return remembered;
  } catch {
    // Private browsing. The newest is the answer.
  }
  return available[0]?.id ?? '';
}
