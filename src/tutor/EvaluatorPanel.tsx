import { useEffect, useState } from 'react';
import { LANGUAGES } from '../realtime/languages';
import {
  BUILTIN_EVALUATOR_ID,
  MAX_EVALUATOR_NAME,
  formatBands,
  parseBands,
  type Evaluator,
} from '../realtime/evaluators';

/**
 * The scale a finished conversation is read against, and the editor for it.
 *
 * A SCALE IS EDITED AS TEXT. Twelve bands of six structures each is forty-odd
 * inputs and a tab order nobody enjoys, and a scale is a document anyway — it
 * gets drafted elsewhere, pasted in, reordered and diffed by eye. So the bands
 * are one textarea in the format parseBands reads, and a parse failure is shown
 * under it rather than swallowed.
 *
 * The report language lives here too, which looks out of place next to a level
 * scale and is not: it is the one setting that belongs to the report rather
 * than the call. Every prompt in instructions.ts stays in the target language
 * on purpose; a report does the opposite, because an explanation of a B1 error
 * written at B1 is unreadable to the person who made it.
 *
 * Nothing in this panel touches the tutor. The scale is applied after the call
 * has ended, which is what lets it be rewritten and the same conversation
 * re-read without placing another call.
 */

interface Props {
  disabled: boolean;
  evaluators: Evaluator[];
  evaluatorId: string;
  onEvaluator: (id: string) => void;
  l1Code: string;
  onL1: (code: string) => void;
  onSave: (evaluator: Evaluator) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Set by the parent when a save or delete came back unhappy. */
  error?: string;
}

export default function EvaluatorPanel({
  disabled,
  evaluators,
  evaluatorId,
  onEvaluator,
  l1Code,
  onL1,
  onSave,
  onDelete,
  error,
}: Props) {
  const chosen = evaluators.find((entry) => entry.id === evaluatorId) ?? evaluators[0];
  const builtIn = chosen?.id === BUILTIN_EVALUATOR_ID;

  const [name, setName] = useState(chosen?.name ?? '');
  const [note, setNote] = useState(chosen?.note ?? '');
  const [text, setText] = useState(() => (chosen ? formatBands(chosen.bands) : ''));
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState('');

  // Reloads the boxes when the pick changes. Deliberately keyed on the id
  // alone: retyping the name must not pull the bands back from under it.
  useEffect(() => {
    if (!chosen) return;
    setName(chosen.name);
    setNote(chosen.note);
    setText(formatBands(chosen.bands));
    setParseError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.id]);

  const commit = async (asCopy: boolean) => {
    // The library is fetched, so there is a window at mount where nothing is
    // selected yet. Short, and reachable: the panel renders through it.
    if (!chosen) return;
    const parsed = parseBands(text);
    if (parsed.error) {
      setParseError(parsed.error);
      return;
    }
    setParseError('');
    setBusy(true);
    try {
      await onSave({
        // A copy always takes a new id, and so does any save over the built-in
        // — save.ts refuses that id, and asking the parent to mint one here
        // keeps the refusal from ever being reached by an honest button press.
        id: asCopy || builtIn ? '' : chosen.id,
        name: name.trim() || 'Untitled scale',
        note: note.trim(),
        bands: parsed.bands,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await onDelete(chosen.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-lg border border-slate-800">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500 hover:text-slate-400">
        Level scale — {chosen?.name ?? 'none'}
      </summary>

      <div className="border-t border-slate-800 px-4 py-3">
        <label className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-slate-500">Scale</span>
          <select
            value={chosen?.id ?? ''}
            onChange={(event) => onEvaluator(event.target.value)}
            disabled={disabled || busy}
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
          >
            {evaluators.map((entry) => (
              <option key={entry.id} value={entry.id} className="bg-slate-900">
                {entry.name}
                {entry.id === BUILTIN_EVALUATOR_ID ? ' (built in)' : ''}
              </option>
            ))}
          </select>
        </label>
        {chosen?.note && <p className="mt-1 text-[11px] text-slate-600">{chosen.note}</p>}

        <label className="mt-3 flex items-center gap-3 border-t border-slate-800 pt-3">
          <span className="text-xs uppercase tracking-wide text-slate-500">Report in</span>
          <select
            value={l1Code}
            onChange={(event) => onL1(event.target.value)}
            disabled={disabled || busy}
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
          >
            {LANGUAGES.map((choice) => (
              <option key={choice.code} value={choice.code} className="bg-slate-900">
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
          The learner&rsquo;s own language. Quotes stay in the language of the call; everything
          said about them is written in this one.
        </p>

        <div className="mt-3 border-t border-slate-800 pt-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_EVALUATOR_NAME}
              placeholder="Scale name"
              disabled={disabled || busy}
              className="flex-1 rounded border border-slate-800 bg-transparent px-2 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-700 focus:border-slate-700 disabled:opacity-40"
            />
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="One line on what it is for"
              disabled={disabled || busy}
              className="flex-[2] rounded border border-slate-800 bg-transparent px-2 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-700 focus:border-slate-700 disabled:opacity-40"
            />
          </div>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={disabled || busy}
            spellCheck={false}
            rows={14}
            className="mt-2 w-full resize-y rounded border border-slate-800 bg-slate-900/50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-300 outline-none focus:border-slate-700 disabled:opacity-40"
          />

          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
            One band per block, lowest first. A heading is <code>code | name</code>, the line
            under it describes the band, and bullets are what the report looks for as evidence.
            Write them to fit any language and the model will read them as whatever they mean
            in the one being spoken.
          </p>

          {parseError && <p className="mt-2 text-xs text-rose-400">{parseError}</p>}
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => commit(false)}
              disabled={disabled || busy || builtIn}
              title={builtIn ? 'The built-in scale cannot be overwritten — save a copy' : undefined}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-900 disabled:opacity-40"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={() => commit(true)}
              disabled={disabled || busy}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-900 disabled:opacity-40"
            >
              Save as new
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={disabled || busy || builtIn}
              className="ml-auto rounded border border-rose-900/60 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-950/40 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
