import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DictionaryResult } from '../realtime/dictionary';
import { lookup } from './dictionaryStore';
import { FR } from './strings';
import * as vocab from './vocab';

/**
 * One word, taken apart.
 *
 * The rendering is LingoLecto's, because the shape of the answer is
 * LingoLecto's: part of speech, then senses in frequency order, each with an
 * example in French, the same example in the learner's language, and a note on
 * the grammar. A verb also gets its six forms, which is the one part of a
 * French dictionary entry a learner returns to.
 *
 * THE PANEL IS DRIVEN FROM OUTSIDE AS WELL AS FROM ITS OWN BOX. A long press on
 * a word in the conversation arrives here as a `request`, carrying the sentence
 * it was found in so the model can spot that "besoin" was really "avoir besoin
 * de". The sequence number is what makes tapping the same word twice run twice.
 */

/** The pronouns the six forms belong to. French, like everything else here. */
const PRONOUNS = ['je', 'tu', 'il', 'nous', 'vous', 'ils'];

export interface LookupRequest {
  term: string;
  context: string;
  /** Distinguishes two requests for the same word. */
  seq: number;
  /**
   * An answer we already hold, from the saved list.
   *
   * Present means no lookup at all — not a cache read, not a request. The whole
   * lookup was stored with the word precisely so that reopening it is free and
   * works offline, and routing it back through `lookup` would throw that away
   * the first time the cache evicted an entry the vocabulary list still had.
   */
  known?: DictionaryResult;
}

interface DictionaryPanelProps {
  l1: string;
  request: LookupRequest | null;
  /** So the vocabulary tab's count can follow a save made here. */
  onVocabChange: () => void;
}

/**
 * The looked-up term, picked out of its own example.
 *
 * Case-insensitive and literal — the term can carry an apostrophe or a hyphen,
 * and treating it as a pattern would turn "l'eau" into a broken expression.
 */
function emphasise(sentence: string, term: string): ReactNode {
  const needle = term.trim();
  if (!needle) return sentence;

  const parts: ReactNode[] = [];
  const haystack = sentence.toLowerCase();
  const lower = needle.toLowerCase();
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(lower, from);
    if (at === -1) break;
    if (at > from) parts.push(sentence.slice(from, at));
    parts.push(
      <b key={at} className="font-bold text-lingo-accent-deep">
        {sentence.slice(at, at + needle.length)}
      </b>,
    );
    from = at + needle.length;
  }

  if (parts.length === 0) return sentence;
  if (from < sentence.length) parts.push(sentence.slice(from));
  return parts;
}

export default function DictionaryPanel({ l1, request, onVocabChange }: DictionaryPanelProps) {
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<DictionaryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /** Guards against a slow lookup landing after a later, faster one. */
  const latest = useRef(0);

  const run = useCallback(
    async (term: string, context?: string) => {
      const word = term.trim();
      if (!word) return;

      const ticket = ++latest.current;
      setBusy(true);
      setError(null);

      try {
        const found = await lookup(word, l1, context);
        if (ticket !== latest.current) return;
        setResult(found);
        setSaved(vocab.has(found));
      } catch (problem) {
        if (ticket !== latest.current) return;
        setResult(null);
        setError(problem instanceof Error ? problem.message : FR.dictNoResult);
      } finally {
        if (ticket === latest.current) setBusy(false);
      }
    },
    [l1],
  );

  // A long press elsewhere on the page, or a word reopened from the saved list.
  // The box is filled in as well as the result shown, so the word can be edited
  // and asked again — a learner mishears a word as often as the transcript does.
  useEffect(() => {
    if (!request) return;
    setTyped(request.term);

    if (request.known) {
      latest.current += 1;
      setBusy(false);
      setError(null);
      setResult(request.known);
      setSaved(vocab.has(request.known));
      return;
    }

    void run(request.term, request.context);
  }, [request, run]);

  const toggleSave = () => {
    if (!result) return;
    if (saved) vocab.remove(vocab.canonical(result));
    else vocab.add(result);
    setSaved(!saved);
    onVocabChange();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex shrink-0 gap-2 border-b border-lingo-border px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(typed);
        }}
      >
        <input
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={FR.dictPlaceholder}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border-[1.5px] border-lingo-border bg-lingo-paper px-3 py-2 text-sm text-lingo-ink outline-none transition-colors focus:border-lingo-accent"
        />
        <button
          type="submit"
          disabled={busy || !typed.trim()}
          className="shrink-0 rounded-lg bg-lingo-accent px-4 py-2 text-xs font-semibold text-white shadow-lingo-pop-sm transition-colors hover:bg-lingo-accent-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {FR.dictSearch}
        </button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {busy && <p className="py-8 text-center text-sm text-lingo-muted">{FR.dictLoading}</p>}

        {!busy && error && (
          <p className="py-6 text-center text-sm text-lingo-error">{error}</p>
        )}

        {!busy && !error && !result && (
          <p className="py-8 text-center text-sm leading-relaxed text-lingo-muted">
            {FR.dictEmpty}
          </p>
        )}

        {!busy && !error && result && (
          <>
            <h3 className="mb-3 font-lingo-display text-2xl font-semibold text-lingo-ink">
              {result.term}
            </h3>

            <label
              className={`mb-4 flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                saved
                  ? 'bg-lingo-accent-glow font-semibold text-lingo-accent-deep'
                  : 'bg-lingo-accent-glow/50 text-lingo-muted hover:bg-lingo-accent-glow'
              }`}
            >
              <input
                type="checkbox"
                checked={saved}
                onChange={toggleSave}
                className="h-4 w-4 cursor-pointer accent-lingo-accent"
              />
              {saved ? FR.dictSaved : FR.dictSave}
            </label>

            {result.entries.map((entry, index) => (
              <section key={index} className="mb-6">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-lingo-accent">
                  {entry.part_of_speech}
                </p>

                {entry.definitions.map((definition, at) => (
                  <div
                    key={at}
                    className="mb-3 rounded-lg border border-lingo-border-light bg-lingo-surface px-3 py-2.5"
                  >
                    <p className="mb-1.5 text-[15px] font-bold text-lingo-ink">
                      {definition.translation}
                    </p>
                    <p className="text-[13px] italic leading-snug text-lingo-ink">
                      {emphasise(definition.example_a, result.term)}
                    </p>
                    <p className="mb-2 text-[13px] leading-snug text-lingo-muted">
                      {emphasise(definition.example_b, definition.translation)}
                    </p>
                    <p className="border-t border-lingo-border-light pt-2 text-xs leading-relaxed text-lingo-muted">
                      {definition.grammar_explanation}
                    </p>
                  </div>
                ))}

                {entry.verb_details && entry.verb_details.conjugation_current.length > 0 && (
                  <div className="rounded-lg border border-lingo-border-light bg-lingo-surface px-3 py-2.5">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-lingo-muted">
                      {FR.dictConjugation} — {entry.verb_details.infinitive}
                    </p>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-0.5">
                      {entry.verb_details.conjugation_current.slice(0, 6).map((form, slot) => (
                        <p key={slot} className="flex gap-1.5 py-0.5 text-[13px]">
                          <span className="min-w-8 text-xs text-lingo-muted">
                            {PRONOUNS[slot]}
                          </span>
                          <span className="font-semibold text-lingo-ink">{form}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
