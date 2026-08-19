/**
 * The student's own word list.
 *
 * IN localStorage, AND THAT IS A KNOWN LIMITATION rather than a design. There
 * is no student account to hang a list on — the site has one shared password —
 * and inventing a user store before anybody is using the page would be building
 * the wrong thing early. The cost is real and belongs in the README: clear your
 * browser, lose your words.
 *
 * THE WHOLE LOOKUP IS STORED, not just the word. It makes each entry a few
 * kilobytes instead of a few bytes, and it buys the thing that makes the list
 * worth having: opening a saved word shows its definitions, examples and
 * conjugation instantly, offline, with no model call. A list of bare words that
 * has to phone home to be read is a list nobody opens twice.
 *
 * Ported from LingoLecto, including the two decisions that are not obvious:
 * verbs are folded to their infinitive so "vais", "vas" and "allons" are one
 * entry, and the category is derived from the part of speech rather than
 * carried by the model, so it stays a small closed set the filter chips can
 * rely on.
 */

import type { DictionaryResult } from '../realtime/dictionary';

const VOCAB_KEY = 'vocotrial.vocab.v1';

export type VocabCategory =
  | 'verb'
  | 'noun'
  | 'adjective'
  | 'adverb'
  | 'expression'
  | 'other';

export interface VocabItem {
  /** The canonical form. For verbs, the infinitive — see `add`. */
  term: string;
  data: DictionaryResult;
  addedAt: number;
  category: VocabCategory;
}

export function load(): VocabItem[] {
  try {
    const raw = window.localStorage.getItem(VOCAB_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as VocabItem[]) : [];
  } catch {
    return [];
  }
}

function save(list: VocabItem[]): void {
  try {
    window.localStorage.setItem(VOCAB_KEY, JSON.stringify(list));
  } catch {
    // Quota or private browsing. Silent for LingoLecto's reason: the failure a
    // student can act on is "my words are gone", and that shows up in the list
    // rather than in a message at the moment of saving.
  }
}

/**
 * The part of speech, reduced to something the filter chips can use.
 *
 * Matched loosely because the model writes prose into that field —
 * "verb (aller — present indicative, 1st person singular)" is a real answer —
 * so this looks for the word rather than expecting an enum.
 */
export function categorise(data: DictionaryResult): VocabCategory {
  const pos = (data.entries?.[0]?.part_of_speech ?? '').toLowerCase();
  if (/\bverb\b/.test(pos)) return 'verb';
  if (/\bnoun\b/.test(pos)) return 'noun';
  if (/\badj/.test(pos)) return 'adjective';
  if (/\badv/.test(pos)) return 'adverb';
  if (/idiom|expression|phrase|proverb|collocation/.test(pos)) return 'expression';
  return 'other';
}

const sameTerm = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether this lookup is already saved, under whatever name it would take. */
export function has(data: DictionaryResult): boolean {
  const term = canonical(data);
  return load().some((item) => sameTerm(item.term, term));
}

/**
 * The name a lookup is filed under.
 *
 * A verb goes under its infinitive, so a learner who taps "vais" today and
 * "allons" tomorrow finds one entry for `aller` rather than two conjugated
 * fragments they have to recognise as the same word.
 */
export function canonical(data: DictionaryResult): string {
  const first = data.entries?.[0];
  const infinitive = first?.is_verb ? first.verb_details?.infinitive : undefined;
  return infinitive || data.term;
}

export function add(data: DictionaryResult): VocabItem[] {
  const list = load();
  const term = canonical(data);
  const entry: VocabItem = {
    term,
    // Stored under the name it is filed under, so the saved copy and the list
    // agree about what this word is called.
    data: term === data.term ? data : { ...data, term },
    addedAt: Date.now(),
    category: categorise(data),
  };

  const index = list.findIndex((item) => sameTerm(item.term, term));
  if (index >= 0) list[index] = entry;
  else list.push(entry);

  save(list);
  return list;
}

export function remove(term: string): VocabItem[] {
  const list = load().filter((item) => !sameTerm(item.term, term));
  save(list);
  return list;
}

export type VocabSort = 'alpha' | 'recent';

/** Sorted and filtered for display. Alphabetical uses French collation. */
export function arrange(
  list: VocabItem[],
  sort: VocabSort,
  category: VocabCategory | 'all',
): VocabItem[] {
  const filtered =
    category === 'all' ? list : list.filter((item) => (item.category ?? 'other') === category);

  return [...filtered].sort((a, b) =>
    sort === 'alpha' ? a.term.localeCompare(b.term, 'fr') : b.addedAt - a.addedAt,
  );
}
