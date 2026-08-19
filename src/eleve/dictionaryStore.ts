/**
 * The browser's half of the dictionary: the request, and the cache in front
 * of it.
 *
 * THE CACHE IS THE POINT OF THIS FILE. A lookup costs a model call, and the
 * access pattern is the worst possible one for that: a learner taps the same
 * unfamiliar word three times in a conversation, then again in the next one.
 * LingoLecto pays for every one of those. Keyed by term *and* L1, because the
 * same word answered in two languages is two different answers.
 *
 * Stored in localStorage rather than in memory, so it survives the reload
 * between one conversation and the next — which is where most of the repeats
 * are. Bounded, because a term is a few kilobytes and the quota is five
 * megabytes: the oldest entries go when it fills, which is exactly the right
 * thing to lose.
 */

import type { DictionaryResult } from '../realtime/dictionary';

const CACHE_KEY = 'vocotrial.dict.v1';

/**
 * How many lookups are kept.
 *
 * A busy conversation produces a few dozen; a term runs to a couple of
 * kilobytes of JSON. Two hundred is comfortably inside the quota and past what
 * a student gets through in a term, so the eviction path is rare enough that
 * its cost does not matter and present enough that it cannot be skipped.
 */
const CACHE_LIMIT = 200;

interface CacheEntry {
  at: number;
  result: DictionaryResult;
}

type Cache = Record<string, CacheEntry>;

/** Case-folded: tapping "Bonjour" and typing "bonjour" is one question. */
const cacheKey = (term: string, l1: string) => `${l1}|${term.trim().toLowerCase()}`;

function readCache(): Cache {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private browsing, or the quota is full despite the trim below. Losing the
    // cache costs money rather than correctness, so it is not worth an error in
    // front of a student.
  }
}

function remember(term: string, l1: string, result: DictionaryResult): void {
  const cache = readCache();
  cache[cacheKey(term, l1)] = { at: Date.now(), result };

  const keys = Object.keys(cache);
  if (keys.length > CACHE_LIMIT) {
    const oldest = keys
      .sort((a, b) => (cache[a]?.at ?? 0) - (cache[b]?.at ?? 0))
      .slice(0, keys.length - CACHE_LIMIT);
    for (const key of oldest) delete cache[key];
  }

  writeCache(cache);
}

export function cached(term: string, l1: string): DictionaryResult | null {
  return readCache()[cacheKey(term, l1)]?.result ?? null;
}

/**
 * One lookup, from the cache or from the model.
 *
 * `context` is deliberately outside the cache key. It changes the answer — it
 * is how "besoin" becomes "avoir besoin de" — but a learner who taps the same
 * word in two sentences wants the word, and keying on the sentence would mean
 * a cache that never hits during the conversation it exists to serve. The
 * first sentence a word was met in wins.
 */
export async function lookup(
  term: string,
  l1: string,
  context?: string,
): Promise<DictionaryResult> {
  const hit = cached(term, l1);
  if (hit) return hit;

  const response = await fetch('/api/dictionary/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ term, l1, context: context || undefined }),
  });

  const answer = (await response.json().catch(() => null)) as
    | { result?: DictionaryResult; error?: string }
    | null;

  if (!response.ok || !answer?.result) {
    throw new Error(answer?.error || 'La recherche a échoué');
  }

  remember(term, l1, answer.result);
  return answer.result;
}
