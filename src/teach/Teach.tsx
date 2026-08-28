import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Plus, X } from 'lucide-react';
import BrandBar from '../lingo/BrandBar';
import BuildBadge from '../BuildBadge';
import ReturnButton from '../ReturnButton';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import {
  ADVANCED_OPTIONS,
  advancedAvailableFor,
  BUILTIN_EVALUATOR_ID,
  isAdvancedEvaluator,
  type Evaluator,
} from '../realtime/evaluators';
import { listEvaluators } from '../realtime/evaluatorStore';
import {
  bankFor,
  missingDiscriminatingTiers,
  tierHint,
  TIER_NOTES,
} from '../realtime/questionBank';
import { fetchHouse, resolveStyle } from '../realtime/houseStore';
import type { TutorStyle } from '../realtime/house';
import { listPublished } from '../facekit/library';
import type { PublishedFace } from '../facekit/published';
import {
  DEFAULT_CAP_MINUTES,
  DEFAULT_QUESTION_ROWS,
  MAX_BRIEF,
  MAX_VOCABULARY,
  MAX_CAP_MINUTES,
  MAX_QUESTIONS,
  MAX_VOCO_SESSION_NAME,
  MINUTES_A_QUESTION,
  MIN_CAP_MINUTES,
  capLooksTight,
  capMinutesOf,
  newVocoSessionId,
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
import {
  PATIENCE,
  WHILE_TUTOR_SPEAKS,
  type Patience,
  type WhileTutorSpeaks,
} from '../realtime/settings';
import { PACE, type Pace } from '../realtime/tutorPrompt';
import { defaultModelKey, teachableModels } from '../realtime/models';
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
 * WHAT A TEACHER IS NOT ASKED. No prompt, no motion knobs, no voice, and no
 * turn-taking beyond the two controls named below. Those are an
 * administrator's, and they reach a student anyway — a tutor style, a house
 * performance profile and the voice written on the chosen face, all authored
 * in the workshop and all spent server-side at publish. See house.ts. What is
 * left here is what a teacher actually decides: the questions, the consigne,
 * the language, the manner, the face, the scale, and the three below.
 *
 * TURN-TAKING IS TWO OF THOSE THREE NOW, AND IT WAS ONE. `patience` is how
 * long the tutor waits for a learner who is still assembling a clause;
 * `whileTutorSpeaks` is what the learner may do while the tutor has the floor
 * — not heard at all, heard and answered next turn, or able to stop it
 * mid-sentence. Both are facts about the room rather than about the
 * deployment, which is the test for whether a knob belongs on this page: a
 * one-to-one lesson at a kitchen table and thirty Chromebooks in one hall want
 * opposite answers, and only the person writing the questions knows which this
 * is. Each spends two provider settings underneath and neither says so, for
 * the reason `patience` gives: a teacher is choosing pedagogy, and the wiring
 * that delivers it is not their problem. See PATIENCE and WHILE_TUTOR_SPEAKS
 * in settings.ts.
 *
 * THE MODEL IS ASKED FOR NOW, and it did not use to be. That line read "no
 * prompt, no model" and meant it: the student page held the choice in a
 * constant, and changing it for one class meant changing it for every class and
 * deploying. The two models do not differ the way two knobs differ — one counts
 * the questions and writes down what it heard, the other hears tone and is
 * unreliable at both — so which one a class should meet is a teaching decision
 * and it was being made by whoever last edited Eleve.tsx.
 *
 * It is asked in teacher language and not by name. See `teach` in models.ts,
 * which is where the sentences live; this page prints them and stores a key.
 *
 * THE VOICE WENT WITH THE FACE, which is worth saying because there was a
 * dropdown for it here and somebody will look for it. It sat beside the face
 * grid and defaulted to nothing, so the ordinary path — leave it alone, pick a
 * portrait — published an administrator's face and biography in a voice neither
 * of them had chosen. It is on the kit's persona now, next to the bio, and the
 * publish route reads the two together.
 *
 * That means this page cannot show which voice a face carries, and should not
 * try: the face index it fetches is names and thumbnails, and the persona lives
 * inside the kit, which is megabytes of artwork per face. The name under the
 * grid is the whole of what a teacher gets, and the fix if that is not enough
 * is a voice on the index rather than a kit fetch from here.
 *
 * WHAT IS EDITED HERE IS NOT WHAT A STUDENT IS LOOKING AT. Publishing composes
 * and copies — see functions/api/sessions/publish.ts — so nothing on this page
 * can reach a lesson already handed out. That is deliberate and it cuts both
 * ways: fixing a typo here does not fix it under a code already read to a
 * class, and the fix is to publish again and hand out the new code.
 *
 * THE QUESTIONS ARE ONE INPUT EACH, rather than lines in a textarea, because a
 * question is the unit the whole app counts in. The tutor is handed them
 * numbered, it reports progress by number, and the student watches a countdown
 * of them — so the number beside each box on this page is the same number those
 * three things mean, and a teacher editing question 4 can see that it is
 * question 4. A textarea makes that a matter of counting newlines.
 *
 * It also removes a quiet trap. The textarea sliced at MAX_QUESTIONS as you
 * typed, so pasting sixteen questions silently dropped the last one and showed
 * a full-looking box. Rows cannot do that: the Add button disappears at the
 * ceiling, which is a thing you can see.
 *
 * A LESSON IS A LENGTH AS WELL AS A LIST. The clock is the teacher's, set here
 * and spent in three places — the tutor is told its budget in prose so it can
 * pace, the student page runs the countdown, and the page tells the tutor to
 * close when it runs out. See composeTutorPrompt and Eleve.tsx.
 */

/** A blank session, so "New" has something to open. */
function empty(): VocoSession {
  return {
    id: '',
    name: '',
    note: '',
    brief: '',
    vocabulary: '',
    questions: [],
    language: defaultLanguageCode(),
    // A new lesson has no behaviour to preserve, so it gets the setting a class
    // of learners actually wants. An existing one shows whatever it was saved
    // with, and absent means 'standard' — see `patience` on VocoSession.
    patience: 'patient',
    // 'house' and not a rung, unlike patience above it. A new lesson has no
    // behaviour to preserve there, so it gets the one a class wants; here the
    // house profile already gives a class what it wants, and pinning a rung
    // would only put this teacher ahead of the next administrator. See
    // `whileTutorSpeaks` on VocoSession.
    whileTutorSpeaks: 'house',
    // Natural rather than the pair patience gets, and the asymmetry is
    // deliberate: waiting longer costs a beginner nothing, and talking in
    // six-word sentences costs an intermediate class the register they came
    // for. A teacher who wants it asks for it.
    pace: 'natural',
    // The counting, transcribing one. A new lesson gets the model the whole
    // app defaults to rather than the last one anybody happened to try.
    modelKey: defaultModelKey(),
    styleId: '',
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

/*
  Joins the reasons Publish is refusing into one sentence. There are three at
  most and usually one, so this is a comma list with an "and" on the end rather
  than a stack of bullets under the button.
*/
function listClauses(clauses: string[]): string {
  if (clauses.length < 2) return clauses.join('');
  return `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
}

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
  const [vocabulary, setVocabulary] = useState('');
  /**
   * One string per row, blanks included.
   *
   * Blanks are kept in state and dropped only on the way out — see `questions`
   * below. An empty row that vanished the moment it was emptied would delete
   * itself under a teacher clearing it to retype, which is the one thing a text
   * box must never do.
   */
  const [rows, setRows] = useState<string[]>(() => Array(DEFAULT_QUESTION_ROWS).fill(''));
  const [capMinutes, setCapMinutes] = useState(DEFAULT_CAP_MINUTES);
  const [patience, setPatience] = useState<Patience>('patient');
  const [pace, setPace] = useState<Pace>('natural');
  const [whileTutorSpeaks, setWhileTutorSpeaks] = useState<WhileTutorSpeaks>('house');
  const [modelKey, setModelKey] = useState<string>(defaultModelKey);

  // The tutor.
  const [language, setLanguage] = useState(defaultLanguageCode);
  const [styleId, setStyleId] = useState('');
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
    setVocabulary(source.vocabulary ?? '');
    // Padded up to the default so a short lesson still opens with somewhere to
    // type, and never truncated: a saved lesson shows every question it has.
    setRows(
      source.questions.length
        ? [...source.questions].concat(
            Array(Math.max(0, DEFAULT_QUESTION_ROWS - source.questions.length)).fill(''),
          )
        : Array(DEFAULT_QUESTION_ROWS).fill(''),
    );
    setCapMinutes(capMinutesOf(source));
    // Absent reads as 'standard' rather than as the default a new lesson gets:
    // a lesson saved before this control existed sent nothing, and opening it
    // must not quietly change how it behaves.
    setPatience(source.patience ?? 'standard');
    // Absent reads as 'natural' for patience's reason: a lesson saved before
    // this control existed composed no pace block, and opening it must not
    // quietly start composing one.
    setPace(source.pace ?? 'natural');
    // Absent reads as 'house' for the reason absent *means* 'house': a lesson
    // written before this control existed pinned neither knob, and opening it
    // here must not quietly pin one on the next save.
    setWhileTutorSpeaks(source.whileTutorSpeaks ?? 'house');
    // Absent reads as the default here rather than as some third thing, and
    // unlike patience that is not a compromise: a lesson saved before this
    // control existed ran on the default model, so opening it shows what it
    // has been doing all along. See `modelKey` on VocoSession.
    setModelKey(source.modelKey ?? defaultModelKey());
    setLanguage(source.language || defaultLanguageCode());
    setStyleId(source.styleId ?? '');
    setFaceId(source.faceId ?? null);
    setEvaluatorId(source.evaluatorId || BUILTIN_EVALUATOR_ID);
    setSaved('');
    setError('');
    setPublished(null);
    setPublishError('');
    if (chosen) rememberVocoSession(chosen.id);
  }, [chosenId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blank rows dropped here rather than in state, and trimmed the way the save
  // route trims them, so the count under the panel is the count that is saved.
  const questions = rows.map((row) => row.trim()).filter(Boolean).slice(0, MAX_QUESTIONS);

  /* Whether the cap will land mid-list. The one warning this page owes a teacher. */
  const tightCap = capLooksTight(questions.length, capMinutes);

  /*
    THE ADVANCED MARKER, and the two things this page has to know about it.

    It is offered only on a French lesson, because the rubric it runs is French
    throughout — see evaluators.ts. `advancedPicked` can therefore be true while
    `advancedOffered` is false, and that combination is not a bug: it is a
    teacher who picked advanced marking and then changed the language. Rather
    than silently resetting the pick — which would leave them handing out a
    lesson marked against something they did not choose — it stays selected,
    says what is wrong, and blocks publishing until one of the two moves.
  */
  const advancedOffered = advancedAvailableFor(language);
  const advancedPicked = isAdvancedEvaluator(evaluatorId);
  const advancedMismatch = advancedPicked && !advancedOffered;

  /*
    Which of the two discriminating tiers this list does not reach.

    ADVISORY, AND ONLY WHEN IT IS ACTIONABLE. It is computed only under an
    advanced pick, because tier coverage decides nothing for an authored scale
    and a warning about it there would be noise. It never blocks: a
    present-tense-only list is a legitimate lesson early in the year, and what
    the gap actually costs is the marker's ability to tell one band from
    another, not the marks themselves. See questionBank.ts, which owns the
    wording so the claim cannot drift into "this will mark low".
  */
  const missingTiers =
    advancedPicked && questions.length > 0 ? missingDiscriminatingTiers(questions) : [];

  /**
   * Drop a bank question into the first empty row, or add a row for it.
   *
   * The one-tap half of the hint. A hint that names a gap and leaves a teacher
   * to type their way out of it is a hint most people close.
   */
  const insertQuestion = (text: string) =>
    setRows((current) => {
      const blank = current.findIndex((row) => !row.trim());
      if (blank !== -1) return current.map((row, at) => (at === blank ? text : row));
      if (current.length >= MAX_QUESTIONS) return current;
      return [...current, text];
    });

  /*
    Why Publish is greyed out, said next to the greyed button. Each of these
    used to disable it in silence, and the two that a teacher can act on are
    both settled in the other panel — an unpicked face reads as nothing wrong
    from down here, where the sentence that says so is a scroll away. The
    button reads the same list, so what it refuses and what this explains
    cannot drift apart.
  */
  const publishBlockers = [
    !questions.length && 'write a question',
    !styles.length && 'wait for an administrator to publish a manner',
    faces.length > 0 && !faceId && 'pick a face',
    advancedMismatch && 'set the language to French, or pick a scale instead',
  ].filter((blocker): blocker is string => typeof blocker === 'string');

  const setRow = (index: number, value: string) =>
    setRows((current) => current.map((row, at) => (at === index ? value : row)));

  /**
   * Removing the last row empties it instead of deleting it.
   *
   * A lesson needs at least one question, and a panel with no boxes in it has
   * nothing to type into and no obvious way back. Clearing is what the button
   * means at that point, and it is the same gesture.
   */
  const dropRow = (index: number) =>
    setRows((current) =>
      current.length > 1 ? current.filter((_, at) => at !== index) : [''],
    );

  /**
   * The style that will actually be used, which is not always the one named.
   *
   * Resolved through the same helper the publish route resolves through, so
   * what this page shows selected is what gets published. A Voco Session naming
   * a style since deleted falls back to the newest rather than refusing to
   * publish — see resolveStyle.
   */
  const style = resolveStyle(styles, styleId);

  /**
   * The manner's own language, when the manner has one to disagree with.
   *
   * A style is prose an administrator published, frozen against whatever
   * language studio had on screen at the time — so a manner written out in
   * English, picked for a French lesson, is a tutor that greets a class in
   * English and keeps going. That is not a thing a call should discover: it was
   * discovered in a call, which is why this is here.
   *
   * A style carrying a built-in's key has no such language. Those are rendered
   * for the lesson at publish, so the picker above decides the language and
   * there is nothing to warn about — see `TutorStyle.preset`. Undefined here is
   * the ordinary, quiet case both ways round.
   */
  const styleLanguage = style && !style.preset ? findLanguage(style.language) : undefined;
  const styleMismatch = styleLanguage && styleLanguage.code !== language ? styleLanguage : null;
  const lessonLanguage = findLanguage(language);

  /** What would be written, gathered once for both save and publish. */
  const composed = (): VocoSession => ({
    id: chosen?.id ?? '',
    name: name.trim() || 'Untitled session',
    note: note.trim(),
    brief: brief.trim(),
    vocabulary: vocabulary.trim() || undefined,
    questions,
    capMinutes,
    patience,
    pace,
    whileTutorSpeaks,
    modelKey,
    language,
    styleId: style?.id ?? '',
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
    /*
     * A face is required whenever there is one to require.
     *
     * `null` stays legal on the wire — published setups already carry it, and
     * Eleve falls back to the shipped kit for a browser that can reach no
     * library — but it stops being something a teacher can choose by not
     * choosing. Unpicked used to publish the deployment's own face, with no
     * persona, in whatever voice the provider defaulted to; that is the trap
     * the voice dropdown was removed for, and leaving the face half of it in
     * place would have been half a fix.
     *
     * The exception is the case where a pick is impossible. An empty grid means
     * the library is empty or unreachable, and refusing to publish there would
     * take a working fallback away from a teacher who cannot do anything about
     * either cause.
     */
    if (faces.length > 0 && !faceId) {
      setPublishError('Pick a face before handing this out.');
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
      {/* The same build stamp tutorBench carries, in the family's palette and
          in the far corner from the brand bar's own link. See BuildBadge.tsx. */}
      <BuildBadge look="lingo" />
      <BrandBar tagline="Prepare a lesson">
        {/* The way out first, then the way on: the same left-to-right the page
            body reads in, and the same order the two get used in. */}
        <div className="flex items-center gap-2">
          <ReturnButton look="lingo" />
          <a
            href="/eleve"
            className="rounded-lg border-2 border-white/20 bg-white/10 px-2.5 py-1 text-[13px] text-lingo-paper transition-colors hover:border-lingo-accent-light"
          >
            Student page →
          </a>
        </div>
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

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className={label}>Questions</span>
                  <span className="text-[11px] text-lingo-muted">Asked in this order</span>
                </div>

                {/*
                  The number is the point of the row, not decoration. It is what
                  the tutor is handed, what it reports progress by, and what the
                  student's countdown counts down — so it is shown in the same
                  monospace the code is, and it does not move when a row above
                  is emptied, because blanks are only dropped on save.
                */}
                <ul className="flex flex-col gap-1.5">
                  {rows.map((row, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right font-lingo-mono text-xs text-lingo-muted">
                        {index + 1}
                      </span>
                      <input
                        value={row}
                        onChange={(event) => setRow(index, event.target.value)}
                        placeholder={
                          index === 0 ? 'Qu’as-tu fait pendant les vacances ?' : 'Another question…'
                        }
                        disabled={busy}
                        aria-label={`Question ${index + 1}`}
                        className={`${field} flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => dropRow(index)}
                        disabled={busy}
                        title={rows.length > 1 ? 'Remove this question' : 'Clear this question'}
                        aria-label={`Remove question ${index + 1}`}
                        className="shrink-0 rounded-lg border-2 border-transparent p-1.5 text-lingo-muted transition-colors hover:border-lingo-border-strong hover:text-lingo-error disabled:opacity-40"
                      >
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center gap-3 pl-7">
                  {/*
                    Gone at the ceiling rather than disabled-and-explaining. The
                    old textarea sliced silently at the limit; a button that is
                    simply absent, next to a count that reads 15/15, says the
                    same thing without a sentence.
                  */}
                  {rows.length < MAX_QUESTIONS ? (
                    <button
                      type="button"
                      onClick={() => setRows((current) => [...current, ''])}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-xl border-2 border-lingo-border-strong bg-lingo-surface px-3 py-1.5 text-sm text-lingo-muted transition-colors hover:border-lingo-accent hover:text-lingo-ink disabled:opacity-40"
                    >
                      <Plus size={14} />
                      Add question
                    </button>
                  ) : (
                    <span className="text-[11px] text-lingo-muted">
                      That is the most a lesson can hold.
                    </span>
                  )}
                  <span className="text-[11px] text-lingo-muted">
                    {questions.length} written
                  </span>
                </div>

                {/*
                  WHAT THIS LIST CAN MEASURE, said while it is being written.

                  Only under an advanced pick, and only about the two tiers that
                  discriminate. The claim is deliberately narrow: a list that
                  never asks for past narration cannot tell a 5 from a 7,
                  because the imparfait it would need to see was never asked
                  for. That is not the same as the lesson marking low, and this
                  block must never say it is — R3 scores what was elicited with
                  no ceiling applied. See questionBank.ts, which owns the
                  sentences for exactly that reason.

                  Every suggestion is a tagged question from the bank, inserted
                  on one tap. A hint that names a gap and then leaves somebody
                  to type their own way out of it is a hint most people close.
                */}
                {advancedPicked && questions.length > 0 && (
                  <div className="mt-1 rounded-2xl border-2 border-lingo-border-strong bg-lingo-panel-warm px-4 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-lingo-muted">
                      What this lesson can measure
                    </p>

                    {missingTiers.length === 0 ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-lingo-ink">
                        Past narration and opinion are both covered, so this lesson can separate a
                        5 from a 7.
                      </p>
                    ) : (
                      <>
                        {missingTiers.map((tier) => (
                          <div key={tier} className="mt-2.5">
                            <p className="text-xs leading-relaxed text-lingo-ink">
                              {tierHint(tier)}
                            </p>
                            <p className="mt-1.5 text-[11px] text-lingo-muted">
                              Add one? — {TIER_NOTES[tier].name.toLowerCase()}
                            </p>
                            <ul className="mt-1 flex flex-col gap-1">
                              {bankFor(tier).slice(0, 3).map((question) => (
                                <li key={question.text}>
                                  <button
                                    type="button"
                                    onClick={() => insertQuestion(question.text)}
                                    disabled={busy}
                                    className="flex w-full items-start gap-1.5 rounded-lg border-2 border-transparent px-2 py-1 text-left text-xs text-lingo-muted transition-colors hover:border-lingo-border-strong hover:text-lingo-ink disabled:opacity-40"
                                  >
                                    <Plus size={13} className="mt-0.5 shrink-0" />
                                    <span>{question.text}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        <p className="mt-2.5 text-[11px] leading-relaxed text-lingo-muted">
                          Nothing here stops you handing this out. A present-tense lesson is a fair
                          lesson — it just measures a narrower thing.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/*
                The cap, and it is a different control from the clock it
                replaces even though it looks the same.

                THE OLD SLIDER SET THE LESSON'S LENGTH. This one sets the point
                at which an unfinished lesson is cut off, which is a thing a
                teacher should be able to ignore most of the time and does not
                have to reason about per question. So the arithmetic underneath
                changed with it: it used to divide the minutes by the questions
                to show a pace, and a pace is exactly the idea being removed.
                What it says now is whether the cap is short enough to actually
                land — the one case where the number matters — and otherwise it
                says the questions are in charge.

                It stays beside the questions rather than moving to the tutor
                panel, because the warning is arithmetic over both.
              */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label className={label} htmlFor="voco-cap">
                    Stop after
                  </label>
                  <span className="text-[11px] text-lingo-muted">
                    {MIN_CAP_MINUTES}–{MAX_CAP_MINUTES} minutes
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    id="voco-cap"
                    type="range"
                    min={MIN_CAP_MINUTES}
                    max={MAX_CAP_MINUTES}
                    step={1}
                    value={capMinutes}
                    onChange={(event) => setCapMinutes(Number(event.target.value))}
                    disabled={busy}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-lingo-border-strong accent-lingo-accent disabled:opacity-40"
                  />
                  <span className="w-16 shrink-0 font-lingo-mono text-sm font-bold tabular-nums">
                    {capMinutes} min
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-lingo-muted">
                  The conversation ends when your questions have been answered — the tutor asks
                  nothing of its own once the list runs out. This is only the point at which one
                  that has not finished is stopped and closed off, so it costs nothing when it is
                  not reached.
                </p>
                {/*
                  Said only when it is true, and it is the one thing on this
                  page a teacher can get wrong now. Twenty questions under a
                  ten-minute cap is a lesson that will be guillotined halfway,
                  and nothing else on screen would say so — the clock used to
                  make the trade-off visible by being the point of the control.
                */}
                {tightCap && (
                  <p className="text-[11px] leading-relaxed text-lingo-accent-deep">
                    {questions.length} questions is nearer{' '}
                    {Math.round(questions.length * MINUTES_A_QUESTION)} minutes of conversation.
                    At {capMinutes} the lesson will be cut off before the list is finished.
                  </p>
                )}
              </div>

              {/*
                THE ONE PROVIDER SETTING A TEACHER TOUCHES, and it is here
                rather than in studio because it is the only one that belongs
                to the class rather than to the deployment. How long the tutor
                waits before deciding a learner has finished is the difference
                between a beginner getting to the end of their sentence and
                being answered over in the middle of it, and which of those a
                class needs is something the person who teaches them knows.

                Beside the cap because both are about the shape of the
                conversation rather than its content, and the questions above
                are the content.
              */}
              <div className="flex flex-col gap-1.5">
                <label className={label} htmlFor="voco-patience">
                  Waiting for the learner
                </label>
                <select
                  id="voco-patience"
                  value={patience}
                  onChange={(event) => setPatience(event.target.value as Patience)}
                  disabled={busy}
                  className={`${field} cursor-pointer`}
                >
                  {PATIENCE.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] leading-relaxed text-lingo-muted">
                  {PATIENCE.find((entry) => entry.key === patience)?.hint}
                </p>
              </div>

              {/*
                THE OTHER HALF OF THE SAME QUESTION, and next to it for that
                reason: the control above is how long the tutor waits for the
                learner, this is how fast it talks at them, and a class that
                needs one usually needs the other.

                NOT A SETTING, WHICH THE NOTE UNDER IT SAYS OUT LOUD. Every
                other control on this page is a value that gets sent; this one
                is a paragraph composed into the tutor's instructions, because
                the Live API has no speaking rate to set. A teacher should know
                that the tutor is being asked rather than told — it is the
                difference between a control that always works and one that
                mostly does, and finding that out from a lesson is worse than
                reading it here. See PACE in tutorPrompt.ts.
              */}
              <div className="flex flex-col gap-1.5">
                <label className={label} htmlFor="voco-pace">
                  How fast the tutor talks
                </label>
                <select
                  id="voco-pace"
                  value={pace}
                  onChange={(event) => setPace(event.target.value as Pace)}
                  disabled={busy}
                  className={`${field} cursor-pointer`}
                >
                  {PACE.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] leading-relaxed text-lingo-muted">
                  {PACE.find((entry) => entry.key === pace)?.hint}
                  {pace !== 'natural' &&
                    ' Asked for in the tutor’s instructions rather than set on the call, so it layers over the manner instead of replacing it.'}
                </p>
              </div>

              {/*
                THE THIRD CONTROL ABOUT THE SHAPE OF THE CONVERSATION, and the
                only one of the three that is about the learner's half of it.
                The two above are what the tutor does — how long it waits, how
                fast it talks. This is what the learner is allowed to do while
                it is talking, which is why it sits under them and not beside
                the questions.

                ONE CONTROL OVER TWO SETTINGS, WHICH THE NOTE UNDER IT DOES NOT
                SAY, deliberately. A teacher choosing between three sentences
                about a room does not need to know that two of them move a
                microphone gate and the third also moves a barge-in flag; what
                they need is that the sentences are true. The pairing, and why
                it is a ladder rather than two switches, is in
                WHILE_TUTOR_SPEAKS in settings.ts. An administrator who wants
                the two knobs apart has them apart, on /studio.

                THE EXTRA LINE ON THE TOP RUNG IS THE COST, and it is shown
                rather than buried in the hint because it is the one thing that
                will make a teacher change their mind. Closing the microphone
                is the safe choice in a classroom and the wrong one for a
                confident learner who answers over the question — they are
                simply not heard, and the tutor waits. Finding that out from a
                lesson is worse than reading it here, which is the same
                argument the pace control's note above makes.
              */}
              <div className="flex flex-col gap-1.5">
                <label className={label} htmlFor="voco-while-tutor">
                  While the tutor is speaking
                </label>
                <select
                  id="voco-while-tutor"
                  value={whileTutorSpeaks}
                  onChange={(event) =>
                    setWhileTutorSpeaks(event.target.value as WhileTutorSpeaks)
                  }
                  disabled={busy}
                  className={`${field} cursor-pointer`}
                >
                  {WHILE_TUTOR_SPEAKS.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] leading-relaxed text-lingo-muted">
                  {WHILE_TUTOR_SPEAKS.find((entry) => entry.key === whileTutorSpeaks)?.hint}
                </p>
              </div>

              {/*
                THE MODEL, ASKED FOR BY WHAT IT DOES.

                Radios rather than the select the two controls above it use, and
                that is not decoration. A select shows one option and hides the
                rest behind a click, which is right when the options differ by a
                degree — standard, patient, very patient — and wrong when they
                differ in kind. Both of these cost something the other does not,
                and a teacher choosing between them has to be able to read both
                costs at once, without discovering the second by opening a menu.

                The model id sits under each in mono and small. A teacher does
                not need it and should not have to parse it, but the person they
                ring when a lesson misbehaves does, and "the warm one" is not
                something you can grep for.
              */}
              <fieldset className="flex flex-col gap-1.5 border-0 p-0">
                <legend className={`${label} mb-1.5 p-0`}>How the tutor listens</legend>
                <div className="flex flex-col gap-2">
                  {teachableModels().map((model) => {
                    const chosenModel = model.key === modelKey;
                    return (
                      <label
                        key={model.key}
                        className={`flex cursor-pointer gap-2.5 rounded-xl border-2 px-3.5 py-3 transition-colors ${
                          chosenModel
                            ? 'border-lingo-accent bg-lingo-surface shadow-lingo-pop-sm'
                            : 'border-lingo-border-light bg-lingo-surface hover:border-lingo-accent-light'
                        } ${busy ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        <input
                          type="radio"
                          name="voco-model"
                          value={model.key}
                          checked={chosenModel}
                          onChange={() => setModelKey(model.key)}
                          disabled={busy}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-lingo-accent"
                        />
                        <span className="flex flex-col gap-1">
                          <span className="text-sm font-bold leading-snug">
                            {model.teach!.label}
                          </span>
                          <span className="text-[11px] leading-relaxed text-lingo-muted">
                            {model.teach!.blurb}
                          </span>
                          {/*
                            Printed only where there is one, so the model with
                            nothing to warn about does not carry a blank line
                            shaped like a warning. The colour is the one the
                            tight-cap note uses, which is this page's single
                            existing way of saying "this is a choice with a
                            consequence" — a second colour for a second kind of
                            caution would be a vocabulary nobody taught anyone.
                          */}
                          {model.teach!.caution && (
                            <span className="text-[11px] leading-relaxed text-lingo-accent-deep">
                              {model.teach!.caution}
                            </span>
                          )}
                          {/*
                            An id nobody has dialled yet, said in teacher
                            language rather than as the workshop's "(unverified
                            id)". The workshop can afford that shorthand because
                            whoever reads it can try the model in the next
                            breath; a teacher here is committing a class to it,
                            and the consequence they need warning about is not
                            "the string is a guess" but "this may not connect at
                            all". Same colour as the caution, being the same
                            kind of fact.
                          */}
                          {model.unverified && (
                            <span className="text-[11px] leading-relaxed text-lingo-accent-deep">
                              Not yet confirmed working on this build — try a lesson on it
                              yourself before handing the code to a class.
                            </span>
                          )}
                          <span className="font-lingo-mono text-[10px] leading-relaxed text-lingo-muted opacity-70">
                            {model.id}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

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

              {/*
                Optional, and last, because most lessons need nothing here. The
                questions are already handed to the transcriber as keywords, so
                this is for the words a unit is *about* that the questions may
                never say out loud. Nobody sees it: not the student, not the
                tutor. See `vocabulary` on VocoSession.
              */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label className={label} htmlFor="voco-vocabulary">
                    Words to listen for <span className="text-lingo-muted">(optional)</span>
                  </label>
                  <span className="text-[11px] text-lingo-muted">
                    {vocabulary.length}/{MAX_VOCABULARY} · nobody sees this
                  </span>
                </div>
                <textarea
                  id="voco-vocabulary"
                  value={vocabulary}
                  onChange={(event) =>
                    setVocabulary(event.target.value.slice(0, MAX_VOCABULARY))
                  }
                  rows={2}
                  placeholder="la grêle, le verglas, une averse…"
                  disabled={busy}
                  className={`${field} resize-y leading-relaxed`}
                />
                <p className="text-[11px] leading-relaxed text-lingo-muted">
                  Helps the tutor hear these words correctly when a learner says them, so the
                  report marks what they actually said. The questions are used this way
                  already — this is for vocabulary the questions do not contain. Used on GPT
                  Realtime only; the Gemini models have no equivalent and ignore it.
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
              {/*
                Still a two-column grid holding one field, which is deliberate.
                The voice picker was the other column; a language name is three
                words at most, and letting it stretch the full width of the
                panel now that it is alone would make the shortest field on the
                page the widest. The empty half is where the next tutor-level
                pick goes, if there is ever one a teacher should make.
              */}
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
                {/*
                  Said only when it is true, the way the cap warning above is.
                  This one names the fix as well, because the teacher cannot
                  apply it: a manner is an administrator's to publish, and a
                  teacher who reads only "mismatch" is left with a dropdown of
                  manners that all say the same wrong thing.
                */}
                {styleMismatch && (
                  <p className="text-[11px] leading-relaxed text-lingo-accent-deep">
                    This manner is written in {styleMismatch.label} and the lesson is in{' '}
                    {lessonLanguage?.label ?? language}, so the tutor will talk to the class in{' '}
                    {styleMismatch.label}. Ask an administrator to publish it for{' '}
                    {lessonLanguage?.label ?? language}.
                  </p>
                )}
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

                  Every tile here is a library face, which it did not use to be.
                  A "Default" tile sat first and pre-selected, standing for the
                  kit checked into public/faces/ — the one face with no picture
                  to look at, no name shown and no persona to carry, on a grid
                  whose whole argument is the sentence above. It is an ordinary
                  library face now; faceKit imports it once. See `seed` there.
                */}
                {faces.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
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
                ) : (
                  /*
                    An empty grid is a box with nothing in it, which reads as
                    broken rather than as empty. It has two causes and the
                    teacher can act on neither, so this says who can.
                  */
                  <p className="rounded-2xl border-2 border-lingo-border-strong bg-lingo-cream px-4 py-3 text-[11px] leading-relaxed text-lingo-muted">
                    No faces in the shared library — either none has been published yet, or
                    the library cannot be reached from here. Ask an administrator. You can
                    still hand this lesson out: it will wear the face the deployment ships
                    with, which carries no voice of its own.
                  </p>
                )}
                {faces.length > 0 && (
                  <p
                    className={`text-[11px] ${
                      faceId === null ? 'text-lingo-error' : 'text-lingo-muted'
                    }`}
                  >
                    {faceId === null
                      ? 'Pick a face before handing this out.'
                      : (faces.find((face) => face.id === faceId)?.name ??
                        'That face is no longer in the library — pick another.')}
                  </p>
                )}
                {/*
                  Where the voice went, said once on the page that used to have
                  a dropdown for it. Not a name, because this page has no way to
                  read one — see the header.
                */}
                <p className="text-[11px] text-lingo-muted">
                  A face brings its own voice and background with it, both written by an
                  administrator in the workshop.
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
                  <optgroup label="Scales">
                    {evaluators.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                        {entry.id === BUILTIN_EVALUATOR_ID ? ' (built in)' : ''}
                      </option>
                    ))}
                  </optgroup>
                  {/*
                    A second group rather than more entries in the first,
                    because these are not scales. A scale is a ladder somebody
                    authored and the report walks it; these two select a fixed
                    exam rubric with its own pipeline behind it. Grouping is the
                    cheapest way to say "different kind of thing" in a select.

                    Rendered when French is picked — or when one of them is
                    already selected, so that switching the language away does
                    not leave this control showing a value it has no option for.
                  */}
                  {(advancedOffered || advancedPicked) && (
                    <optgroup label="Advanced — exam rubric (French only)">
                      {ADVANCED_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {/*
                  One line on what the pick means. The advanced entries need it
                  more than the scales do: their names say which scale a student
                  reads, and nothing in a dropdown can say that both are always
                  computed or that they are allowed to disagree.
                */}
                {advancedPicked ? (
                  <p className="text-[11px] leading-relaxed text-lingo-muted">
                    {ADVANCED_OPTIONS.find((option) => option.id === evaluatorId)?.note} The IB mark
                    and the CEFR level are both worked out either way — this picks which one the
                    student reads first. They measure different things and will not always agree.
                  </p>
                ) : (
                  !advancedOffered && (
                    <p className="text-[11px] leading-relaxed text-lingo-muted">
                      Advanced exam marking is available on French lessons.
                    </p>
                  )
                )}

                {advancedMismatch && (
                  <p className="text-[11px] leading-relaxed text-lingo-error">
                    Advanced marking has only been calibrated for French. Set the language to
                    French, or pick a scale instead.
                  </p>
                )}
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
                disabled={publishing || publishBlockers.length > 0}
                className="flex items-center gap-2 rounded-3xl bg-lingo-accent px-7 py-3 font-lingo-brand text-lg text-lingo-paper shadow-lingo-pop transition-colors hover:bg-lingo-accent-deep active:translate-y-px disabled:opacity-40"
              >
                {publishing && <Loader2 size={18} className="animate-spin" />}
                {publishing ? 'Publishing…' : 'Publish'}
              </button>

              {/*
                Saving happens on the way out, so the button says so. A teacher
                who has typed a question and reaches straight for Publish should
                not lose it to a validation they did not know about. When there
                is a validation anyway, it takes this slot: a disabled button
                does not save first, and the reason it is disabled is the only
                thing worth reading here.
              */}
              {publishBlockers.length > 0 ? (
                <p className="text-xs leading-relaxed text-lingo-error">
                  Not ready to hand out — {listClauses(publishBlockers)}.
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-lingo-muted">
                  Saves first, then mints a new code.
                  <br />
                  Publishing again gives a different code; the old one keeps working.
                </p>
              )}
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
