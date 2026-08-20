/**
 * The browser's half of the question-sheet library.
 *
 * Same split as evaluatorStore.ts and for the same reason: sheets.ts is pure
 * and shared with functions/, this file talks to the network, and nothing
 * server-side may import it.
 *
 * A FAILED LIST IS AN EMPTY LIST, NOT A THROW — evaluatorStore's posture, with
 * a different floor. There the fallback is the built-in scale, because a report
 * needs one; here there is nothing to fall back to and nothing that needs one,
 * so an unreachable bucket leaves the picker on "no sheet" and the page still
 * publishes a working session. The error travels alongside so the panel can say
 * why the picker is empty rather than implying nobody has written a lesson.
 */

import type { QuestionSheet } from './sheets';

/** Where the last pick is remembered. Nothing here is a secret. */
const CHOICE_KEY = 'vocotrial.sheet.v1';

/** What `lastSheetId` returns, and what the picker's first option carries. */
export const NO_SHEET = '';

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

/** Newest first, so the sheet being worked on is at the top of the picker. */
export async function listSheets(): Promise<{ sheets: QuestionSheet[]; error?: string }> {
  try {
    const { sheets } = await post<{ sheets: QuestionSheet[] }>('/api/sheets/list', {});
    return { sheets: [...sheets].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)) };
  } catch (error) {
    return {
      sheets: [],
      error: error instanceof Error ? error.message : 'Could not read the library',
    };
  }
}

export async function saveSheet(sheet: QuestionSheet): Promise<QuestionSheet> {
  const answer = await post<{ sheet: QuestionSheet }>('/api/sheets/save', { sheet });
  return answer.sheet;
}

export async function deleteSheet(id: string): Promise<void> {
  await post('/api/sheets/delete', { id });
}

export function rememberSheet(id: string): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, id);
  } catch {
    // Losing the pick costs one dropdown change on the next visit.
  }
}

/**
 * The id last chosen, checked against what actually exists.
 *
 * The remembered id may name a sheet since deleted — on this browser or
 * another, since the library is shared — and publishing is a bad moment to find
 * out. Falls back to no sheet, which is always a valid thing to publish.
 */
export function lastSheetId(available: QuestionSheet[]): string {
  try {
    const remembered = window.localStorage.getItem(CHOICE_KEY);
    if (remembered && available.some((entry) => entry.id === remembered)) return remembered;
  } catch {
    // Private browsing. No sheet is the answer.
  }
  return NO_SHEET;
}
