import { useEffect, useMemo, useState } from 'react';
import {
  MAX_BRIEF,
  MAX_QUESTIONS,
  MAX_SHEET_NAME,
  MAX_TARGETS,
  joinLines,
  newSheetId,
  sheetBlock,
  splitLines,
  type QuestionSheet,
} from '../realtime/sheets';
import { deleteSheet, listSheets, saveSheet } from '../realtime/sheetStore';

/**
 * The question sheets, and the editor for them.
 *
 * A PAGE RATHER THAN A PANEL, unlike EvaluatorPanel which lives inside
 * tutorBench. A scale is authored once a term and then chosen; a sheet is
 * authored every lesson, which makes it the thing somebody sits down to do
 * rather than something adjusted while a call is open. It also has no business
 * on a page with a live socket: writing next Tuesday's questions is not worth
 * holding a metered connection open for.
 *
 * WHAT IS EDITED HERE IS NOT WHAT A STUDENT IS LOOKING AT. Publishing copies a
 * sheet's text into the session — see session.ts — so nothing on this page can
 * reach a lesson already handed out. That is deliberate and it cuts both ways:
 * fixing a typo here does not fix it in a published session either, and the fix
 * is to publish again from liveTrial.
 *
 * THREE BOXES RATHER THAN ONE PARSED BLOB, which is where this departs from
 * EvaluatorPanel. A scale is nested — bands with structures under them — so it
 * is edited as one textarea in a format parseBands reads. A sheet is three flat
 * things that happen to sit together, and inventing a syntax to hold them in
 * one box would be a format to learn for no gain. One entry per line is the
 * whole of it, and splitLines strips a pasted list's own numbering.
 */

/** A blank sheet, so "New" has something to open. */
function empty(): QuestionSheet {
  return { id: '', name: '', note: '', brief: '', targets: [], questions: [] };
}

export default function Sheets() {
  const [sheets, setSheets] = useState<QuestionSheet[]>([]);
  const [chosenId, setChosenId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [brief, setBrief] = useState('');
  const [targetText, setTargetText] = useState('');
  const [questionText, setQuestionText] = useState('');

  const load = (select?: string) => {
    void listSheets().then(({ sheets: found, error: problem }) => {
      setSheets(found);
      setLoading(false);
      if (problem) setError(problem);
      // What to land on: the id just written after a save, '' after a delete,
      // and undefined only on the first load — where the newest sheet is the
      // one most likely to be wanted back, and listSheets sorts newest first.
      setChosenId(select ?? found[0]?.id ?? '');
    });
  };

  useEffect(load, []);

  const chosen = useMemo(
    () => sheets.find((entry) => entry.id === chosenId) ?? null,
    [sheets, chosenId],
  );

  // Reloads the boxes when the pick changes. Keyed on the id alone, for
  // EvaluatorPanel's reason: retyping the name must not pull the questions back
  // from under it.
  useEffect(() => {
    const source = chosen ?? empty();
    setName(source.name);
    setNote(source.note);
    setBrief(source.brief);
    setTargetText(joinLines(source.targets));
    setQuestionText(joinLines(source.questions));
    setSaved('');
    setError('');
  }, [chosenId]); // eslint-disable-line react-hooks/exhaustive-deps

  const questions = splitLines(questionText, MAX_QUESTIONS);
  const targets = splitLines(targetText, MAX_TARGETS);

  /**
   * What the tutor will actually be told, shown rather than described.
   *
   * The one thing this page cannot otherwise make visible: the student sees the
   * consigne and the teacher writes the targets, but the block composed from
   * them is what decides how the call goes, and it is assembled somewhere else
   * entirely. Rendering it here costs a string concatenation and removes the
   * guesswork about what "steer towards these" turns into.
   */
  const preview = questions.length ? sheetBlock({ ...empty(), questions, targets }).trim() : '';

  const commit = async (asCopy: boolean) => {
    if (!questions.length) {
      setError('A sheet needs at least one question.');
      return;
    }
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const written = await saveSheet({
        id: asCopy || !chosen ? newSheetId() : chosen.id,
        name: name.trim() || 'Untitled sheet',
        note: note.trim(),
        brief: brief.trim(),
        targets,
        questions,
      });
      load(written.id);
      setSaved(`Saved “${written.name}”.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      await deleteSheet(chosen.id);
      setChosenId('');
      load('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not delete that');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded border border-slate-800 bg-transparent px-2.5 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-700 focus:border-slate-700 disabled:opacity-40';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-5 py-8">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">consignes</h1>
            <p className="text-xs text-slate-500">
              The questions a lesson is built on, and what the student is told to do with them.
            </p>
          </div>
          {/* Plain links, not a router push: main.tsx reads the path once at
              startup, so crossing between pages is a reload by design. */}
          <nav className="flex gap-4 text-xs text-slate-500">
            <a href="/livetrial" className="underline-offset-4 hover:underline">
              liveTrial →
            </a>
            <a href="/" className="underline-offset-4 hover:underline">
              tutorBench →
            </a>
          </nav>
        </header>

        <div className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-2.5">
          <span className="text-xs uppercase tracking-wide text-slate-500">Sheet</span>
          <select
            value={chosenId}
            onChange={(event) => setChosenId(event.target.value)}
            disabled={busy}
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
          >
            <option value="" className="bg-slate-900">
              {loading ? 'Loading…' : 'New sheet'}
            </option>
            {sheets.map((entry) => (
              <option key={entry.id} value={entry.id} className="bg-slate-900">
                {entry.name}
              </option>
            ))}
          </select>
          <span className="font-mono text-[11px] text-slate-600">
            {sheets.length} saved
          </span>
        </div>

        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_SHEET_NAME}
            placeholder="Sheet name — 4e, les vacances"
            disabled={busy}
            className={`${field} flex-1`}
          />
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="One line on what it is for"
            disabled={busy}
            className={`${field} flex-[1.4]`}
          />
        </div>

        <section className="rounded-lg border border-slate-800 px-4 py-3">
          <h2 className="text-xs uppercase tracking-wide text-slate-500">
            Consigne — the student reads this
          </h2>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            maxLength={MAX_BRIEF}
            rows={3}
            placeholder="Réponds aux questions suivantes. Utilise le passé composé correctement. N'oublie pas d'inclure quelques autres structures avancées."
            disabled={busy}
            className={`${field} mt-2 resize-y leading-relaxed`}
          />
          <p className="mt-1 flex justify-between gap-3 text-[11px] leading-relaxed text-slate-600">
            <span>
              Shown on the student page word for word, so write it in the language they are
              learning. The tutor never sees this — it is addressed to them, not to it. What the
              tutor acts on is the targets below.
            </span>
            <span className="shrink-0 tabular-nums">
              {brief.length}/{MAX_BRIEF}
            </span>
          </p>
        </section>

        <section className="rounded-lg border border-slate-800 px-4 py-3">
          <h2 className="text-xs uppercase tracking-wide text-slate-500">
            Questions — one per line, asked in this order
          </h2>
          <textarea
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={"Qu'est-ce que tu as fait le week-end dernier ?\nOù es-tu allé cet été ?\nRaconte-moi un bon souvenir de vacances."}
            disabled={busy}
            className={`${field} mt-2 resize-y font-mono text-xs leading-relaxed`}
          />
          <p className="mt-1 flex justify-between gap-3 text-[11px] leading-relaxed text-slate-600">
            <span>
              The tutor works down them in order and comes back to where it was after a tangent.
              Numbering is added for you — paste a numbered list and it will be stripped.
            </span>
            <span className="shrink-0 tabular-nums">
              {questions.length}/{MAX_QUESTIONS}
            </span>
          </p>
        </section>

        <section className="rounded-lg border border-slate-800 px-4 py-3">
          <h2 className="text-xs uppercase tracking-wide text-slate-500">
            Targets — one per line, checked in the report
          </h2>
          <textarea
            value={targetText}
            onChange={(event) => setTargetText(event.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'le passé composé\nune subordonnée avec « parce que »'}
            disabled={busy}
            className={`${field} mt-2 resize-y font-mono text-xs leading-relaxed`}
          />
          <p className="mt-1 flex justify-between gap-3 text-[11px] leading-relaxed text-slate-600">
            <span>
              One nameable structure each — each becomes a row in the student&rsquo;s report with
              its own verdict and quote, so a target that is really three things comes back as one
              unreadable line. The tutor steers towards them without ever saying them out loud.
            </span>
            <span className="shrink-0 tabular-nums">
              {targets.length}/{MAX_TARGETS}
            </span>
          </p>
        </section>

        {preview && (
          <details className="rounded-lg border border-slate-800">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500 hover:text-slate-400">
              What the tutor will be told ({preview.length} characters)
            </summary>
            <pre className="max-h-80 overflow-auto border-t border-slate-800 px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-400">
              {preview}
            </pre>
          </details>
        )}

        {error && (
          <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
        {saved && !error && <p className="text-xs text-emerald-400">{saved}</p>}

        <div className="flex flex-wrap items-center gap-2 pb-8">
          <button
            type="button"
            onClick={() => void commit(false)}
            disabled={busy || !questions.length}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-900 disabled:opacity-40"
          >
            {chosen ? 'Save changes' : 'Save sheet'}
          </button>
          {chosen && (
            <button
              type="button"
              onClick={() => void commit(true)}
              disabled={busy || !questions.length}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-900 disabled:opacity-40"
            >
              Save as new
            </button>
          )}
          {chosen && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="ml-auto rounded border border-rose-900/60 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-950/40 disabled:opacity-40"
            >
              Delete
            </button>
          )}
        </div>

        <p className="-mt-4 pb-8 text-[11px] leading-relaxed text-slate-600">
          A sheet reaches a student by being chosen on liveTrial and published. Publishing copies
          its text into the session, so editing a sheet here never changes a lesson already handed
          out — and never fixes one either. Publish again to do that.
        </p>
      </div>
    </div>
  );
}
