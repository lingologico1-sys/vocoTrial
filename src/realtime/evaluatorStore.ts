/**
 * The browser's half of the evaluator library.
 *
 * Same split as presets.ts and instructions.ts, for a different reason. There,
 * the line is localStorage: one file reads the DOM and the other is imported by
 * functions/. Here both halves are pure, and the line is the network — this
 * file talks to /api/evaluators/*, and nothing server-side may import it.
 *
 * THE BUILT-IN IS MERGED HERE, NOT STORED. list.ts returns only what has been
 * authored, so a deployment with no bucket, no saves, or a failed request still
 * shows a working scale rather than an empty picker. It is always first, and it
 * is the fallback everywhere an id fails to resolve.
 */

import { BUILTIN_EVALUATOR, BUILTIN_EVALUATOR_ID, type Evaluator } from './evaluators';

/** Where the last pick is remembered. Nothing here is a secret. */
const CHOICE_KEY = 'vocotrial.evaluator.v1';

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
 * Built-in first, then saved ones, newest first.
 *
 * A failed request yields the built-in alone rather than throwing. The picker
 * having one entry is a survivable state; the panel refusing to render because
 * the bucket is unreachable is not, and the report still works on the built-in.
 */
export async function listEvaluators(): Promise<{ evaluators: Evaluator[]; error?: string }> {
  try {
    const { evaluators } = await post<{ evaluators: Evaluator[] }>('/api/evaluators/list', {});
    const saved = [...evaluators].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return { evaluators: [BUILTIN_EVALUATOR, ...saved] };
  } catch (error) {
    return {
      evaluators: [BUILTIN_EVALUATOR],
      error: error instanceof Error ? error.message : 'Could not read the library',
    };
  }
}

export async function saveEvaluator(evaluator: Evaluator): Promise<Evaluator> {
  const answer = await post<{ evaluator: Evaluator }>('/api/evaluators/save', { evaluator });
  return answer.evaluator;
}

export async function deleteEvaluator(id: string): Promise<void> {
  await post('/api/evaluators/delete', { id });
}

/** Time for ordering, entropy so two saves in one millisecond stay distinct. */
export function newEvaluatorId(): string {
  return `scale:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function rememberEvaluator(id: string): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, id);
  } catch {
    // Losing the pick costs one dropdown change on the next visit.
  }
}

/**
 * The id last chosen, checked against what actually exists.
 *
 * The remembered id may name a scale since deleted — on this browser or
 * another, since the library is shared — and a call is a bad moment to find
 * out. Falls back to the built-in, which is always present.
 */
export function lastEvaluatorId(available: Evaluator[]): string {
  try {
    const remembered = window.localStorage.getItem(CHOICE_KEY);
    if (remembered && available.some((entry) => entry.id === remembered)) return remembered;
  } catch {
    // Private browsing. The built-in is the answer.
  }
  return BUILTIN_EVALUATOR_ID;
}
