import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import BrandBar from '../lingo/BrandBar';
import { LANGUAGES, defaultLanguageCode } from '../realtime/languages';
import { VOICES } from '../realtime/settings';
import { BUILTIN_EVALUATOR_ID, type Evaluator } from '../realtime/evaluators';
import { listEvaluators } from '../realtime/evaluatorStore';
import { fetchHouse, resolveStyle } from '../realtime/houseStore';
import type { TutorStyle } from '../realtime/house';
import { listPublished } from '../facekit/library';
import type { PublishedFace } from '../facekit/published';
import {
  MAX_BRIEF,
  MAX_QUESTIONS,
  MAX_TARGETS,
  MAX_VOCO_SESSION_NAME,
  joinLines,
  newVocoSessionId,
  splitLines,
  type VocoSession,
} from '../realtime/vocoSessions';
import {
  deleteVocoSession,
  lastVocoSessionId,
  listVocoSessions,
  rememberVocoSession,
  saveVocoSession,
} from '../realtime/vocoSessionStore';
import { listPublishedSetups, publishVocoSession, type PublishedRow } from '../realtime/sessionStore';
import type { PublishedSetup } from '../realtime/session';

/**
 * The teacher's page: write a Voco Session, then hand it out.
 *
 * THE SECOND TIER, AND THE ONLY PAGE IN IT. tutorBench, faceKit and studio are
 * the workshop — dark, English, every knob exposed, written for whoever built
 * the thing. /eleve is the student's. This is for the person in between, who
 * prepares lessons and never opens a workshop page: publishing used to live in
 * studio, which meant handing a class out required an administrator.
 *
 * IT WEARS THE FAMILY LOOK RATHER THAN THE WORKSHOP'S, which is the visible
 * half of that. A teacher arrives here from LingoLecto and ScriptoMondo and
 * should meet one product rather than three — the LingoLabo palette, the shared
 * brand bar, the panels-on-a-mat that /eleve already uses (see
 * sciptomondo/STYLE_GUIDE.md, and BrandBar.tsx on why an authoring page takes a
 * student page's chrome). The copy is English, as LingoLecto's own teach page
 * is: /eleve is French because a learner should be immersed, and that argument
 * says nothing about the person writing the questions.
 *
 * WHAT A TEACHER IS NOT ASKED. No prompt, no model, no motion knobs, no
 * turn-taking. Those are an administrator's, and they reach a student anyway —
 * a tutor style and a house performance profile, both published from studio and
 * both spent server-side at publish. See house.ts. What is left here is what a
 * teacher actually decides: the questions, the consigne, the language, the
 * manner, the face, the voice and the scale.
 *
 * WHAT IS EDITED HERE IS NOT WHAT A STUDENT IS LOOKING AT. Publishing composes
 * and copies — see functions/api/sessions/publish.ts — so nothing on this page
 * can reach a lesson already handed out. That is deliberate and it cuts both
 * ways: fixing a typo here does not fix it under a code already read to a
 * class, and the fix is to publish again and hand out the new code.
 *
 * THREE BOXES RATHER THAN ONE PARSED BLOB for the lesson, which is where this
 * departs from EvaluatorPanel. A scale is nested — bands with structures under
 * them — so it is edited as one textarea in a format parseBands reads. A lesson
 * is three flat things that happen to sit together, and inventing a syntax to
 * hold them in one box would be a format to learn for no gain. One entry per
 * line is the whole of it, and splitLines strips a pasted list's own numbering.
 */

/** A blank session, so "New" has something to open. */
function empty(): VocoSession {
  return {
    id: '',
    name: '',
    note: '',
    brief: '',
    targets: [],
    questions: [],
    language: defaultLanguageCode(),
    styleId: '',
    voice: '',
    faceId: null,
    evaluatorId: BUILTIN_EVALUATOR_ID,
  };
}

const panel =
  'rounded-3xl border-4 border-lingo-terracotta bg-lingo-paper shadow-lingo-pop overflow-hidden';

const panelHead =
  'flex items-baseline justify-between gap-3 border-b-[3px] border-lingo-terracotta bg-lingo-panel-warm px-5 py-3';

const field =
  'w-full rounded-xl border-2 border-lingo-border-strong bg-lingo-surface px-3 py-2 text-[15px] text-lingo-ink outline-none transition-colors placeholder:text-lingo-muted/50 focus:border-lingo-accent disabled:opacity-50';

const label = 'text-[11px] font-semibold uppercase tracking-wide text-lingo-muted';

export default function Teach() {
  const [sessions, setSessions] = useState<VocoSession[]>([]);
  const [chosenId, setChosenId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  // The lesson.
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [brief, setBrief] = useState('');
  const [targetText, setTargetText] = useState('');
  const [questionText, setQuestionText] = useState('');

  // The tutor.
  const [language, setLanguage] = useState(defaultLanguageCode);
  const [styleId, setStyleId] = useState('');
  const [voice, setVoice] = useState('');
  const [faceId, setFaceId] = useState<string | null>(null);
  const [evaluatorId, setEvaluatorId] = useState(BUILTIN_EVALUATOR_ID);

  // What there is to choose from.
  const [styles, setStyles] = useState<TutorStyle[]>([]);
  const [houseTuned, setHouseTuned] = useState(false);
  const [faces, setFaces] = useState<PublishedFace[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);

  // Handing out.
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<PublishedSetup | null>(null);
  const [publishError, setPublishError] = useState('');
  const [handedOut, setHandedOut] = useState<PublishedRow[]>([]);
  const [copied, setCopied] = useState(false);

  const load = (select?: string) => {
    void listVocoSessions().then(({ sessions: found, error: problem }) => {
      setSessions(found);
      setLoading(false);
      if (problem) setError(problem);
      // What to land on: the id just written after a save, '' after a delete,
      // and undefined only on the first load — where the one last opened is the
      // one most likely to be wanted back.
      setChosenId(select ?? lastVocoSessionId(found));
    });
  };

  useEffect(load, []);

  /*
   * Everything a teacher picks between, in one pass.
   *
   * Four libraries, fetched together rather than each behind the panel that
   * needs it: they are all small, they are all read-only here, and a page that
   * fills in one section at a time reads as broken. Failures are absorbed
   * individually — a face bucket that is down leaves the face grid empty and
   * the rest of the page working, which is the posture every store in
   * realtime/ already takes.
   */
  useEffect(() => {
    let alive = true;

    void fetchHouse().then((house) => {
      if (!alive) return;
      setStyles(house.styles);
      setHouseTuned(house.performance !== null);
    });

    // Ready faces only. `ready` exists to mean "finished enough to be worn by a
    // student", and a teacher picking a half-drawn face publishes it to a
    // class. Drafts stay visible in faceKit, where they can be finished.
    void listPublished()
      .then((found) => {
        if (alive) setFaces(found.filter((face) => face.ready !== false));
      })
      .catch(() => {
        if (alive) setFaces([]);
      });

    void listEvaluators().then(({ evaluators: found }) => {
      if (alive) setEvaluators(found);
    });

    return () => {
      alive = false;
    };
  }, []);

  const chosen = useMemo(
    () => sessions.find((entry) => entry.id === chosenId) ?? null,
    [sessions, chosenId],
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
    setLanguage(source.language || defaultLanguageCode());
    setStyleId(source.styleId ?? '');
    setVoice(source.voice ?? '');
    setFaceId(source.faceId ?? null);
    setEvaluatorId(source.evaluatorId || BUILTIN_EVALUATOR_ID);
    setSaved('');
    setError('');
    setPublished(null);
    setPublishError('');
    if (chosen) rememberVocoSession(chosen.id);
  }, [chosenId]); // eslint-disable-line react-hooks/exhaustive-deps

  const questions = splitLines(questionText, MAX_QUESTIONS);
  const targets = splitLines(targetText, MAX_TARGETS);

  /**
   * The style that will actually be used, which is not always the one named.
   *
   * Resolved through the same helper the publish route resolves through, so
   * what this page shows selected is what gets published. A Voco Session naming
   * a style since deleted falls back to the newest rather than refusing to
   * publish — see resolveStyle.
   */
  const style = resolveStyle(styles, styleId);

  /** What would be written, gathered once for both save and publish. */
  const composed = (): VocoSession => ({
    id: chosen?.id ?? '',
    name: name.trim() || 'Untitled session',
    note: note.trim(),
    brief: brief.trim(),
    targets,
    questions,
    language,
    styleId: style?.id ?? '',
    voice,
    faceId,
    evaluatorId,
  });

  const commit = async (asCopy: boolean) => {
    if (!questions.length) {
      setError('A Voco Session needs at least one question.');
      return;
    }
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const written = await saveVocoSession({
        ...composed(),
        id: asCopy || !chosen ? newVocoSessionId() : chosen.id,
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
      await deleteVocoSession(chosen.id);
      setChosenId('');
      load('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not delete that');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hands it out, saving first.
   *
   * The save is not a convenience. A published setup carries `vocoSessionId` so
   * that a code can be traced back to the lesson it came from, and publishing
   * unsaved text would write an id naming something that does not exist — or,
   * worse, naming an older version of what was actually sent. Publishing what
   * is on screen means writing what is on screen.
   */
  const publish = async () => {
    if (!questions.length) {
      setPublishError('A Voco Session needs at least one question.');
      return;
    }
    setPublishing(true);
    setPublishError('');
    setPublished(null);
    setCopied(false);
    try {
      const written = await saveVocoSession({
        ...composed(),
        id: chosen?.id || newVocoSessionId(),
      });
      const setup = await publishVocoSession(written);
      load(written.id);
      setPublished(setup);
      void listPublishedSetups().then(({ setups }) => setHandedOut(setups));
    } catch (problem) {
      setPublishError(problem instanceof Error ? problem.message : 'Could not publish that');
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    void listPublishedSetups().then(({ setups }) => setHandedOut(setups));
  }, []);

  const copyCode = () => {
    if (!published) return;
    void navigator.clipboard
      ?.writeText(published.code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard refused — over http, or permission denied. The code is on
        // screen in a size made for reading out, so there is nothing to repair.
      });
  };

  return (
    <div className="lingo-light min-h-screen bg-lingo-mat font-lingo text-lingo-ink">
      <BrandBar tagline="Prepare a lesson">
        <a
          href="/eleve"
          className="rounded-lg border-2 border-white/20 bg-white/10 px-2.5 py-1 text-[13px] text-lingo-paper transition-colors hover:border-lingo-accent-light"
        >
          Student page →
        </a>
      </BrandBar>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6">
        {/* Which session is open. Its own strip above the panels, because it
            governs every one of them. */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-lingo-border-strong bg-lingo-cream px-4 py-3">
          <span className={label}>Voco Session</span>
          <select
            value={chosenId}
            onChange={(event) => setChosenId(event.target.value)}
            disabled={busy}
            className={`${field} h-10 flex-1 cursor-pointer`}
          >
            <option value="">{loading ? 'Loading…' : 'New Voco Session'}</option>
            {sessions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <span className="font-lingo-mono text-xs text-lingo-muted">
            {sessions.length} saved
          </span>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ── The lesson ────────────────────────────────────────────── */}
          <section className={panel}>
            <div className={panelHead}>
              <h2 className="font-lingo-brand text-lg">The lesson</h2>
              <span className="text-xs text-lingo-muted">
                {questions.length}/{MAX_QUESTIONS} questions
              </span>
            </div>

            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1.5">
                <label className={label} htmlFor="voco-name">
                  Name
                </label>
                <input
                  id="voco-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={MAX_VOCO_SESSION_NAME}
                  placeholder="4e, les vacances"
                  disabled={busy}
                  className={field}
                />
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="A note to yourself — who this is for, what it follows"
                  disabled={busy}
                  className={`${field} text-sm`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label className={label} htmlFor="voco-questions">
                    Questions
                  </label>
                  <span className="text-[11px] text-lingo-muted">
                    One per line, asked in order
                  </span>
                </div>
                <textarea
                  id="voco-questions"
                  value={questionText}
                  onChange={(event) => setQuestionText(event.target.value)}
                  rows={6}
                  placeholder={'Qu’as-tu fait pendant les vacances ?\nOù es-tu allé ?'}
                  disabled={busy}
                  className={`${field} resize-y font-lingo leading-relaxed`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label className={label} htmlFor="voco-brief">
                    Consigne
                  </label>
                  <span className="text-[11px] text-lingo-muted">
                    {brief.length}/{MAX_BRIEF} · the student reads this
                  </span>
                </div>
                <textarea
                  id="voco-brief"
                  value={brief}
                  onChange={(event) => setBrief(event.target.value.slice(0, MAX_BRIEF))}
                  rows={3}
                  placeholder="Réponds aux questions en utilisant le passé composé."
                  disabled={busy}
                  className={`${field} resize-y leading-relaxed`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label className={label} htmlFor="voco-targets">
                    What they are practising
                  </label>
                  <span className="text-[11px] text-lingo-muted">
                    {targets.length}/{MAX_TARGETS} · never said out loud
                  </span>
                </div>
                <textarea
                  id="voco-targets"
                  value={targetText}
                  onChange={(event) => setTargetText(event.target.value)}
                  rows={3}
                  placeholder={'le passé composé\nune subordonnée avec « parce que »'}
                  disabled={busy}
                  className={`${field} resize-y leading-relaxed`}
                />
                {/* The one thing this page cannot otherwise make visible: the
                    student reads the consigne and the teacher writes the
                    targets, and only one of the two reaches the tutor. */}
                <p className="text-[11px] leading-relaxed text-lingo-muted">
                  The tutor steers towards these and the report checks them one by one. The
                  consigne above goes to the student instead — the tutor never sees it.
                </p>
              </div>
            </div>
          </section>

          {/* ── The tutor ─────────────────────────────────────────────── */}
          <section className={panel}>
            <div className={panelHead}>
              <h2 className="font-lingo-brand text-lg">The tutor</h2>
              <span className="text-xs text-lingo-muted">
                {houseTuned ? 'House face tuning' : 'Default face tuning'}
              </span>
            </div>

            <div className="flex flex-col gap-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className={label} htmlFor="voco-language">
                    Language
                  </label>
                  <select
                    id="voco-language"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    disabled={busy}
                    className={`${field} cursor-pointer`}
                  >
                    {LANGUAGES.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.endonym}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className={label} htmlFor="voco-voice">
                    Voice
                  </label>
                  <select
                    id="voco-voice"
                    value={voice}
                    onChange={(event) => setVoice(event.target.value)}
                    disabled={busy}
                    className={`${field} cursor-pointer`}
                  >
                    <option value="">Default</option>
                    {VOICES.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={label} htmlFor="voco-style">
                  Manner
                </label>
                <select
                  id="voco-style"
                  value={style?.id ?? ''}
                  onChange={(event) => setStyleId(event.target.value)}
                  disabled={busy || !styles.length}
                  className={`${field} cursor-pointer`}
                >
                  {styles.length ? (
                    styles.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))
                  ) : (
                    <option value="">None published yet</option>
                  )}
                </select>
                <p className="text-[11px] leading-relaxed text-lingo-muted">
                  {style?.note ||
                    'How the tutor talks. Published from studio by an administrator — you pick one, you do not write one.'}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className={label}>Face</span>
                  <span className="text-[11px] text-lingo-muted">
                    {faces.length} in the shared library
                  </span>
                </div>
                {/*
                  A grid of portraits rather than a dropdown, which is the one
                  place this page spends more room than a form needs. A face has
                  a name only its author remembers; what a teacher is choosing
                  is a person to put in front of a class, and that choice is
                  made by looking.
                */}
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  <button
                    type="button"
                    onClick={() => setFaceId(null)}
                    disabled={busy}
                    title="The face this deployment ships with"
                    className={`aspect-square rounded-xl border-2 bg-lingo-cream text-[10px] leading-tight text-lingo-muted transition-colors ${
                      faceId === null
                        ? 'border-lingo-accent shadow-lingo-pop-sm'
                        : 'border-lingo-border-strong hover:border-lingo-accent-light'
                    }`}
                  >
                    Default
                  </button>
                  {faces.map((face) => (
                    <button
                      key={face.id}
                      type="button"
                      onClick={() => setFaceId(face.id)}
                      disabled={busy}
                      title={face.name}
                      className={`aspect-square overflow-hidden rounded-xl border-2 transition-colors ${
                        faceId === face.id
                          ? 'border-lingo-accent shadow-lingo-pop-sm'
                          : 'border-lingo-border-strong hover:border-lingo-accent-light'
                      }`}
                    >
                      <img
                        src={face.thumb}
                        alt={face.name}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-lingo-muted">
                  {faceId === null
                    ? 'The face this deployment ships with.'
                    : (faces.find((face) => face.id === faceId)?.name ??
                      'That face is no longer in the library — pick another.')}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={label} htmlFor="voco-scale">
                  Marked against
                </label>
                <select
                  id="voco-scale"
                  value={evaluatorId}
                  onChange={(event) => setEvaluatorId(event.target.value)}
                  disabled={busy}
                  className={`${field} cursor-pointer`}
                >
                  {evaluators.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.id === BUILTIN_EVALUATOR_ID ? ' (built in)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </div>

        {/* ── Saving ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void commit(false)}
            disabled={busy || !questions.length}
            className="rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-5 py-2.5 text-[15px] font-semibold text-lingo-ink shadow-lingo-pop-sm transition-colors hover:border-lingo-accent disabled:opacity-40"
          >
            {chosen ? 'Save' : 'Create'}
          </button>
          {chosen && (
            <>
              <button
                type="button"
                onClick={() => void commit(true)}
                disabled={busy}
                className="rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-4 py-2.5 text-sm text-lingo-muted transition-colors hover:border-lingo-accent disabled:opacity-40"
              >
                Save as copy
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-4 py-2.5 text-sm text-lingo-error transition-colors hover:border-lingo-error disabled:opacity-40"
              >
                Delete
              </button>
            </>
          )}
          {saved && <span className="text-sm text-lingo-success">{saved}</span>}
          {error && <span className="text-sm text-lingo-error">{error}</span>}
        </div>

        {/* ── Handing it out ────────────────────────────────────────── */}
        <section className={panel}>
          <div className={panelHead}>
            <h2 className="font-lingo-brand text-lg">Hand it out</h2>
            <span className="text-xs text-lingo-muted">
              A code the class types at /eleve
            </span>
          </div>

          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => void publish()}
                disabled={publishing || !questions.length || !styles.length}
                className="flex items-center gap-2 rounded-3xl bg-lingo-accent px-7 py-3 font-lingo-brand text-lg text-lingo-paper shadow-lingo-pop transition-colors hover:bg-lingo-accent-deep active:translate-y-px disabled:opacity-40"
              >
                {publishing && <Loader2 size={18} className="animate-spin" />}
                {publishing ? 'Publishing…' : 'Publish'}
              </button>

              {/*
                Saving happens on the way out, so the button says so. A teacher
                who has typed a question and reaches straight for Publish should
                not lose it to a validation they did not know about.
              */}
              <p className="text-xs leading-relaxed text-lingo-muted">
                Saves first, then mints a new code.
                <br />
                Publishing again gives a different code; the old one keeps working.
              </p>
            </div>

            {publishError && (
              <p className="rounded-2xl border-2 border-lingo-error bg-lingo-error-bg px-4 py-3 text-sm leading-relaxed text-lingo-error">
                {publishError}
              </p>
            )}

            {published && (
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-lingo-success bg-lingo-success-bg px-5 py-4">
                <div>
                  <p className={label}>Read this out</p>
                  {/* Monospace, spaced and large: this is a number to be read
                      off a screen and typed by somebody across the room. */}
                  <p className="font-lingo-mono text-3xl font-bold tracking-[0.18em] text-lingo-ink">
                    {published.code}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyCode}
                  className="flex items-center gap-1.5 rounded-xl border-2 border-lingo-border-strong bg-lingo-surface px-3 py-2 text-sm text-lingo-muted transition-colors hover:border-lingo-accent"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <a
                  href={`/eleve?token=${published.code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-lingo-info underline-offset-4 hover:underline"
                >
                  Open it as a student →
                </a>
              </div>
            )}

            {handedOut.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className={label}>Already handed out</p>
                <ul className="flex flex-col divide-y divide-lingo-border-light overflow-hidden rounded-2xl border-2 border-lingo-border-light">
                  {handedOut.slice(0, 8).map((row) => (
                    <li
                      key={row.code}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-lingo-cream px-4 py-2 text-sm"
                    >
                      <span className="font-lingo-mono font-bold tracking-[0.12em]">
                        {row.code}
                      </span>
                      <span className="flex-1 truncate text-lingo-muted">
                        {row.label || row.lesson || 'Untitled'}
                      </span>
                      <span className="text-[11px] text-lingo-muted">
                        {new Date(row.updatedAt).toLocaleDateString()}
                      </span>
                      <a
                        href={`/eleve?token=${row.code}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-lingo-info underline-offset-4 hover:underline"
                      >
                        open
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
