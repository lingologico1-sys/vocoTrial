import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandBar from '../lingo/BrandBar';
import type { FaceKit } from '../facekit/kit';
import { loadBundledKit } from '../facekit/bundled';
import { publishedKit } from '../facekit/store';
import { L1_CHOICES, resolveL1 } from '../realtime/l1';
import type { SessionReport } from '../realtime/report';
import { LESSON_CODE_LENGTH, normaliseLessonCode } from '../realtime/lessonCodes';
import { hasLesson, type PublishedSetup } from '../realtime/session';
import {
  LESSON_DONE_SIGNAL,
  TIME_UP_SIGNAL,
  capMinutesOf,
} from '../realtime/vocoSessions';
import { codeFromUrl, fetchSetup } from '../realtime/sessionStore';
import { useVoiceCall } from '../live/useVoiceCall';
import ConsignePanel from './ConsignePanel';
import DictionaryPanel, { type LookupRequest } from './DictionaryPanel';
import EvaluationPanel, {
  EvaluationGate,
  MIN_COMPLETE_EVAL_MS,
  MIN_EVAL_MS,
} from './EvaluationPanel';
import TutorStage from './TutorStage';
import VocabPanel from './VocabPanel';
import { FR } from './strings';
import * as vocab from './vocab';
import type { VocabItem } from './vocab';

/**
 * The student page.
 *
 * THE THIRD TIER. tutorBench, faceKit and studio are the workshop — dark,
 * English, every knob exposed, and written for the one person who built the
 * thing. This page is for the person the thing was built for, and it inherits
 * everything and offers nothing: no model, no prompt, no face, no scale. The
 * only control a student has over the tutor is when to start talking to it.
 *
 * IT RUNS ON A PUBLISHED SETUP, NOT ON DEFAULTS. Everything the tutor is comes
 * from R2 — see realtime/session.ts. That is the whole reason the page can be
 * opened on a laptop that has never met the workshop: without it the student
 * would silently get a different tutor from the one that was tuned for them.
 */

/**
 * How long the tutor gets to close before the page hangs up on it.
 *
 * The lesson's minutes are the conversation's length, not the call's: at the
 * limit the tutor is told to close, and closing is a turn or two of speech that
 * has to finish. Forty-five seconds is long enough for a warm goodbye and short
 * enough that a tutor which ignores the note — or never hears it, because the
 * socket dropped — does not leave the call running on the meter.
 *
 * The call can still end sooner than this. A learner who has heard goodbye
 * presses the microphone, and the idle timer is still watching underneath.
 */
const CLOSING_GRACE_MS = 45_000;

/** Where the learner's own language is remembered. Nothing here is a secret. */
const L1_KEY = 'vocotrial.eleve.l1';

type Tab = 'evaluation' | 'dictionary' | 'vocab';

function loadL1(): string {
  try {
    return window.localStorage.getItem(L1_KEY) ?? L1_CHOICES[0].code;
  } catch {
    return L1_CHOICES[0].code;
  }
}

export default function Eleve() {
  const [session, setSession] = useState<PublishedSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  /*
   * The code, and what came of trying it.
   *
   * `typed` is the box; `codeError` is the answer to the last attempt. They are
   * separate so that a student correcting one character does not have the
   * complaint vanish and reappear on every keystroke — it clears on submit,
   * which is when it stops being true.
   */
  const [typed, setTyped] = useState(codeFromUrl);
  const [codeError, setCodeError] = useState('');
  const [checking, setChecking] = useState(false);
  const [kit, setKit] = useState<FaceKit | null>(null);

  const [l1, setL1] = useState(loadL1);
  const [tab, setTab] = useState<Tab>('evaluation');

  const [words, setWords] = useState<VocabItem[]>([]);
  const [request, setRequest] = useState<LookupRequest | null>(null);
  const lookupSeq = useRef(0);

  const [report, setReport] = useState<SessionReport | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  /** Ticks only while a call is up, so the elapsed line moves. */
  const [now, setNow] = useState(() => Date.now());

  const call = useVoiceCall({
    modelKey: 'gemini-native-audio',
    language: session?.language ?? 'fr',
    instructions: session?.instructions ?? '',
    /*
     * Thirty seconds of nobody talking ends the call, where the workshop pages
     * allow ninety.
     *
     * The two numbers are answering different questions. On tutorBench you are
     * reading a prompt or a settings panel with a call open and half a minute
     * of quiet is a normal part of the work. Here a silence that long means the
     * learner has stopped — walked off, or run out of things to say — and the
     * call is billing by the second either way. It is also, now, the thing that
     * closes a session nobody pressed the microphone to end.
     */
    idleTimeoutMs: 30_000,
    idleNotice: FR.idleEnded,
    settings: useMemo(() => {
      if (!session) return {};
      // Absent rather than empty throughout — see settings.ts on why "leave it
      // upstream" and "pin today's default" have to stay distinguishable.
      return {
        ...(session.voice ? { voice: session.voice } : {}),
        ...(session.silenceDurationMs !== undefined
          ? { silenceDurationMs: session.silenceDurationMs }
          : {}),
        ...(session.prefixPaddingMs !== undefined
          ? { prefixPaddingMs: session.prefixPaddingMs }
          : {}),
        ...(session.startSensitivity ? { startSensitivity: session.startSensitivity } : {}),
        ...(session.endSensitivity ? { endSensitivity: session.endSensitivity } : {}),
        ...(session.affectiveDialog !== undefined
          ? { affectiveDialog: session.affectiveDialog }
          : {}),
        ...(session.proactiveAudio !== undefined
          ? { proactiveAudio: session.proactiveAudio }
          : {}),
        ...(session.temperature !== undefined ? { temperature: session.temperature } : {}),
        ...(session.maxOutputTokens !== undefined
          ? { maxOutputTokens: session.maxOutputTokens }
          : {}),
      };
    }, [session]),
  });

  /**
   * Opens a code, and fetches the face it names.
   *
   * ONE PATH IN, whether the code came from the address bar or from the box.
   * A link with `?token=` and a student typing the same six characters have to
   * land in exactly the same state, and two code paths to one state is how they
   * stop doing that.
   */
  const open = useCallback(async (raw: string) => {
    const code = normaliseLessonCode(raw);
    if (!code) {
      setCodeError(FR.codeMalformed);
      return;
    }

    setChecking(true);
    setCodeError('');
    try {
      const found = await fetchSetup(code);
      if (!found) {
        setCodeError(FR.codeUnknown);
        return;
      }
      setSession(found);

      // The artwork is fetched after the setup rather than with it: a kit is
      // megabytes and the page has something to show without it.
      try {
        const worn = found.faceId ? await publishedKit(found.faceId) : await loadBundledKit();
        setKit(worn);
      } catch {
        // The drawn placeholder is a smaller page, not a broken one.
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  // --- The published setup, if the address bar already names one.
  useEffect(() => {
    const fromUrl = codeFromUrl();
    if (!fromUrl) {
      // No code is not a failure — it is a student who has not typed one yet,
      // which is the ordinary way to arrive. Straight to the box.
      setLoading(false);
      return;
    }
    void open(fromUrl).finally(() => setLoading(false));
  }, [open]);

  useEffect(() => setWords(vocab.load()), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(L1_KEY, l1);
    } catch {
      // Private browsing. Losing the pick costs one dropdown change.
    }
  }, [l1]);

  useEffect(() => {
    if (!call.live) return;
    // Set once immediately: the elapsed line is rendered the moment the call
    // goes live, and waiting a whole second for the first tick shows a stale
    // `now` against a fresh `connectedAt` — which reads as a negative duration.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call.live]);

  /**
   * What the tutor is saying now, and what the learner last finished saying.
   *
   * The two are read differently on purpose. The agent's turn is taken whole —
   * the bubble keeps it and scrolls — because a learner rereads the sentence
   * they half caught. The learner's is taken only when the turn has closed, for
   * the reason in LearnerPill: a partial transcription of a language learner is
   * bad enough that showing it reads as the page mishearing them.
   */
  const agentText = useMemo(() => {
    for (let index = call.turns.length - 1; index >= 0; index--) {
      if (call.turns[index].role === 'agent') return call.turns[index].text;
    }
    return '';
  }, [call.turns]);

  const learnerText = useMemo(() => {
    for (let index = call.turns.length - 1; index >= 0; index--) {
      const turn = call.turns[index];
      if (turn.role === 'user' && turn.done && turn.text.trim()) return turn.text;
    }
    return '';
  }, [call.turns]);

  const askDictionary = useCallback((term: string, context: string) => {
    lookupSeq.current += 1;
    setRequest({ term, context, seq: lookupSeq.current });
    setTab('dictionary');
  }, []);

  const openSaved = useCallback((item: VocabItem) => {
    lookupSeq.current += 1;
    // The stored answer travels with the request, so reopening a saved word
    // costs nothing and works with the network down. See LookupRequest.known.
    setRequest({ term: item.term, context: '', seq: lookupSeq.current, known: item.data });
    setTab('dictionary');
  }, []);

  const refreshWords = useCallback(() => setWords(vocab.load()), []);

  const start = () => {
    setReport(null);
    setReportError(null);
    void call.connect();
  };

  const evaluate = async () => {
    setReporting(true);
    setReportError(null);
    try {
      const response = await fetch('/api/report/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          languageCode: session?.language,
          l1Code: resolveL1(l1).reportCode,
          evaluatorId: session?.evaluatorId,
          /*
           * The code, not the targets, even though this page is holding them.
           * The route reads the lesson from the bucket it was published to —
           * see analyse.ts on why a target that lands in a system prompt has to
           * be one somebody published rather than one a caller posted.
           */
          sessionCode: session?.code,
          turns: call.turns.map((turn) => ({ role: turn.role, text: turn.text })),
        }),
      });
      const answer = (await response.json().catch(() => null)) as
        | { report?: SessionReport; error?: string }
        | null;
      if (!response.ok || !answer?.report) {
        throw new Error(answer?.error || FR.evalFailed);
      }
      setReport(answer.report);
    } catch (problem) {
      setReportError(problem instanceof Error ? problem.message : FR.evalFailed);
    } finally {
      setReporting(false);
    }
  };

  const elapsedMs = call.connectedAt === null ? null : now - call.connectedAt;

  /**
   * Whether the tutor says it has been through the whole list.
   *
   * THE TUTOR'S CLAIM AND NOT A FACT, which is why it is named for what it is.
   * `answered` is a tool count the model volunteers — see `onQuestionAnswered`
   * in useVoiceCall — and it under-reports more readily than it over-reports.
   * What follows from it here is when the call hangs up, and nothing else: the
   * report reads the transcript afterwards and is the authority on what was
   * actually covered.
   *
   * Absent questions means no lesson — a setup published before there were any,
   * or a bench call — and such a conversation can never complete. It runs to the
   * cap, which is what it did before this existed.
   */
  const total = session?.questions?.length ?? 0;
  const lessonDone = total > 0 && call.answered >= total;

  /**
   * The two ways a lesson ends, and the close each one triggers.
   *
   * THE QUESTIONS END IT AND THE CLOCK ONLY CATCHES IT. This effect used to
   * watch one condition; it watches two, and the order they are tested in is
   * the whole design. A lesson is over when its questions are answered. The cap
   * is a cost bound underneath — it ends a call the tutor has stopped making
   * progress in, and on a healthy lesson it never fires at all. See
   * vocoSessions.ts above `MIN_CAP_MINUTES`.
   *
   * THE PAGE OWNS BOTH because nothing else can. The model is told there is no
   * length to fill and told never to guess the time, so it has no clock and is
   * given none — the moment of closing is decided out here and said into the
   * conversation. Which of the two notes goes matters: one congratulates a
   * finished lesson, the other admits to cutting one short. See
   * LESSON_DONE_SIGNAL and TIME_UP_SIGNAL.
   *
   * TWO STEPS, NOT ONE. The note goes first and the hang-up follows a grace
   * period later, so the conversation ends on a goodbye rather than mid-clause.
   * Cutting the socket at the limit would also cost the end of the transcript,
   * which is the part a report reads for how the learner handled a close.
   *
   * The ref is what stops it firing every second once the moment has passed:
   * state would re-render before the note was sent and send it again on the
   * next tick. It is cleared when a call ends, so a second conversation gets
   * its own clock rather than closing the instant it connects.
   */
  const closedAt = useRef<number | null>(null);
  const capMs = session ? capMinutesOf(session) * 60_000 : 0;

  useEffect(() => {
    if (!call.live) {
      closedAt.current = null;
      return;
    }
    if (elapsedMs === null) return;

    if (closedAt.current === null) {
      // Completion first: a lesson that finishes on the very tick the cap
      // lands should still be told it finished.
      if (lessonDone) {
        closedAt.current = Date.now();
        call.say(LESSON_DONE_SIGNAL);
        return;
      }
      if (!capMs || elapsedMs < capMs) return;
      closedAt.current = Date.now();
      call.say(TIME_UP_SIGNAL);
      return;
    }

    if (Date.now() - closedAt.current >= CLOSING_GRACE_MS) call.hangUp();
  }, [call, call.live, elapsedMs, capMs, lessonDone]);

  /**
   * Whether the conversation that just ended is worth reading.
   *
   * TWO DOORS, AND COMPLETING THE LESSON IS ONE OF THEM. The gate was a flat
   * two minutes, on the sound argument that a level judgement needs a couple of
   * minutes of learner speech to stand on. What that missed is a short lesson
   * done properly: three questions, answered fully, over in ninety seconds. The
   * student has finished everything they were set and the page told them they
   * had not talked enough — which is the app punishing them for the teacher's
   * list being short.
   *
   * So a completed lesson opens the gate at MIN_COMPLETE_EVAL_MS instead. The
   * report that comes back is honestly smaller: most bands stay `not-shown` and
   * the diagnosis is free to answer `too-little-evidence`, which the panel
   * already renders as "not placed" rather than as a bad mark. What still works
   * on ninety seconds is the half a student actually reads — their best
   * sentences, whether they hit the consigne, whether they reached for
   * anything. See report.ts, which is told to expect a short sample rather than
   * to apologise for one.
   *
   * The floor does not go away entirely, because "completed" is the tutor's
   * word. A model that reports all five questions in the first twenty seconds
   * would otherwise produce a report on nothing at all.
   */
  const evalFloorMs = lessonDone ? MIN_COMPLETE_EVAL_MS : MIN_EVAL_MS;

  /**
   * What the arrow in the pill points at when there is no call running.
   *
   * All that survives of a call button that used to say four different things:
   * the microphone is the control now, and the only part of its label the pill
   * cannot work out for itself is whether this is a first conversation or
   * another one. `lastCallMs` is the page's memory of that, and nothing in the
   * pill has any business knowing it.
   */
  const idleHint = call.lastCallMs === null ? FR.pillStart : FR.pillAgain;

  /**
   * The first tab, which is two things in sequence rather than one thing with a
   * fixed name.
   *
   * Before any conversation has finished it holds the consigne, and calling it
   * Évaluation would name something the student cannot have yet — the tab would
   * promise a reading and deliver a list of questions. Once a call has ended
   * the consigne has been acted on and the reading is what the panel is for, so
   * the label turns over. `lastCallMs` is the page's memory of a finished call
   * and is already what `idleHint` reads; nothing new is tracked for this.
   *
   * The threshold is a call having *ended*, not one having been long enough to
   * evaluate. A student who talks for a minute and stops has finished a
   * conversation, and the tab that then says Consignes while the panel under it
   * counts down to an evaluation is contradicting itself.
   *
   * The id behind both names is unchanged, so nothing else on the page has to
   * know this happens — a tab that renamed its own id would drop the student's
   * selection at the moment a call ends, which is the one moment they are
   * looking at it.
   */
  const consigne = hasLesson(session) && !report;
  const firstTab = consigne && call.lastCallMs === null ? FR.tabConsignes : FR.tabEvaluation;

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'evaluation', label: firstTab },
    { id: 'dictionary', label: FR.tabDictionary },
    { id: 'vocab', label: FR.tabVocab },
  ];

  return (
    <div className="lingo-light flex h-screen flex-col overflow-hidden bg-lingo-mat font-lingo text-lingo-ink">
      <BrandBar tagline={FR.tagline}>
        <label className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-lingo-paper/70">
            {FR.l1Label}
          </span>
          <select
            value={l1}
            onChange={(event) => setL1(event.target.value)}
            className="rounded-lg border-2 border-white/20 bg-white/10 px-2.5 py-1 text-[13px] text-lingo-paper outline-none transition-colors hover:border-lingo-accent-light focus:border-lingo-accent-light"
          >
            {L1_CHOICES.map((choice) => (
              <option key={choice.code} value={choice.code} className="bg-lingo-bar">
                {choice.name}
              </option>
            ))}
          </select>
        </label>
      </BrandBar>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-lingo-muted">…</p>
        </div>
      ) : !session ? (
        /*
          The door, and it is the only one.

          A student reaches a lesson by typing the code their teacher read out —
          there is no "whichever was published last" behind this any more, which
          is what used to let one class walk into another's conversation. The
          box is LingoLecto's, deliberately: same six characters, same
          upper-casing as you type, same monospace at a size meant for copying
          off a board across a room. A student who uses both apps types their
          code into the same box twice.
        */
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-md rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-9 py-10 text-center shadow-lingo-pop">
            <h1 className="font-lingo-display text-2xl font-semibold">
              {loadFailed ? FR.loadFailedTitle : FR.codeTitle}
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-lingo-muted">
              {loadFailed ? FR.loadFailedBody : FR.codeBody}
            </p>

            {loadFailed ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-6 w-full rounded-xl bg-lingo-accent px-6 py-3 text-[15px] font-semibold text-white shadow-lingo-pop-sm transition-colors hover:bg-lingo-accent-deep"
              >
                {FR.retry}
              </button>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!checking) void open(typed);
                }}
                className="mt-6 flex flex-col gap-3"
              >
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value.toUpperCase())}
                  maxLength={LESSON_CODE_LENGTH}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABC123"
                  aria-label={FR.codeTitle}
                  className="w-full rounded-xl border-2 border-lingo-border-strong bg-lingo-cream px-4 py-3 text-center font-lingo-mono text-[22px] font-bold uppercase tracking-[0.18em] text-lingo-ink outline-none transition-colors placeholder:text-lingo-muted/40 focus:border-lingo-accent"
                />
                <button
                  type="submit"
                  disabled={checking || !typed.trim()}
                  className="w-full rounded-xl bg-lingo-accent px-6 py-3 text-[15px] font-semibold text-white shadow-lingo-pop-sm transition-colors hover:bg-lingo-accent-deep disabled:opacity-40"
                >
                  {checking ? FR.starting : FR.codeAction}
                </button>
                {codeError && (
                  <p className="text-sm leading-relaxed text-lingo-error">{codeError}</p>
                )}
              </form>
            )}
          </div>
        </div>
      ) : (
        /*
          LingoLecto's `.questioner-wrap`: a 1152px cap, 16px of mat as padding
          around the pair and again in the gap between them. Only the right side
          is a card — paper inside a 4px terracotta frame rounded at 24px. The
          note on the left column says why it is not the other one.

          THE CAP COSTS THE LEFT COLUMN NOTHING AND BUYS IT THE DISTANCE. The face
          and the balloon are centred and capped at 36rem already, so on a wide
          monitor they sit on the same pixels either way — what changes is how far
          the end of a spoken line is from the panel that answers for it, which on
          a 1920 screen was most of the width of the desk. That trip is the whole
          interaction of this page, the same way it is the whole interaction of
          LingoLecto's reading view.
        */
        <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-[1fr_360px] gap-4 overflow-hidden p-4">
          {/*
            NO CARD ON THIS SIDE, AND THE CONTRAST IS THE ARGUMENT.

            Everything this column holds is already a finished object with its
            own edge: a 3px ring around the face, a bordered balloon with a
            drawn tail, a bordered pill. A frame around the three of them is a
            fourth concentric edge to get past before the eye reaches the face,
            and it was containing nothing — the right-hand panel is a tab strip
            welded to a scroll area and genuinely needs a boundary, this was a
            backdrop.

            It was also flattening its own contents. The balloon is white and
            the pill is cream, and on `paper` those land at about 1.10:1 and
            1.03:1 — the two things the learner actually reads were held up
            entirely by their borders. On the mat they sit near 1.38:1 and
            1.33:1. Taking the card away separates them rather than setting
            them adrift, which is the opposite of what removing a card usually
            does.

            And it changes what the gap above the pill means. That space is
            deliberate — the spacer in TutorStage keeps the microphone at the
            foot — but framed it read as a mostly empty box, and unframed it
            reads as room between the tutor and the control.

            What this costs: the page is no longer LingoLecto's matched
            `.questioner-wrap` pair. That is on purpose. Two identical frames
            claimed the conversation and the reference panel were peers; they
            are not. The conversation is the page.

            `overflow-hidden`, not `auto`, and the padding stays: the column is
            laid out so that it always fits — the balloon and the spacer between
            them absorb everything that grows — and a scrollbar here would only
            ever appear as the symptom of that having failed. That contract is
            layout rather than decoration, so it survives the frame. See
            TutorStage.
          */}
          <div className="flex min-h-0 flex-col overflow-hidden px-8 py-8">
            <TutorStage
              session={session}
              kit={kit}
              agentText={agentText}
              learnerText={learnerText}
              tap={call.tap}
              speaking={call.speaking}
              heard={call.heard}
              live={call.live}
              busy={call.busy}
              tiltCue={call.tiltCue}
              idleHint={idleHint}
              onCall={() => (call.live ? call.hangUp() : start())}
              onWord={askDictionary}
            />

            {/*
              All that is left below the pill, and it stays outside TutorStage
              so the pill keeps the foot of the panel: this line is usually
              absent, and a spacer that reserved room for it would leave a gap
              on every call that goes well.
            */}
            {call.detail && (
              <p className="mx-auto mt-3 max-w-xl shrink-0 text-center text-xs leading-relaxed text-lingo-muted">
                {call.detail}
              </p>
            )}
          </div>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-3xl border-4 border-lingo-terracotta bg-lingo-paper shadow-lingo-pop">
            {/*
              LingoLecto's tab strip, tile for tile (its `.qr-tabs` / `.qr-tab`).
              A student who reads a text there and then talks about it here meets
              the same three tabs in the same clothes, so the two pages read as
              one product rather than as two tools that happen to share a header.

              The strip is a header, not the top of the scroll area, and three
              things say so together: the warm ground behind it, the terracotta
              rule closing it, and the terracotta hairlines between the tabs. The
              active tab is a filled orange tile rather than an underlined word —
              orange means "this is the thing", and at this size an underline is
              too quiet to find at a glance.

              Its top corners are cut by the card's radius, which is the card's
              doing rather than the strip's: the frame clips, so the strip needs
              no corner of its own and cannot get one wrong when the radius moves.
            */}
            <div className="flex shrink-0 border-b-[3px] border-lingo-terracotta bg-lingo-panel-warm [&>button+button]:border-l-2 [&>button+button]:border-l-lingo-terracotta">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`flex-1 select-none border-b-2 py-[9px] text-center font-lingo-brand text-[15px] font-normal transition-all duration-150 ${
                    tab === entry.id
                      ? 'border-b-lingo-accent-deep bg-lingo-accent text-lingo-paper'
                      : 'border-b-transparent text-lingo-muted hover:text-lingo-ink'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {/*
              The lifecycle of the first tab, top to bottom.

              The consigne sits above the gate in every state before there is a
              report, INCLUDING while the call is live — a learner three
              questions in wants to check what the fourth one is, and one who
              has to remember the consigne stops following it by the second
              turn. The gate underneath yields instead: `under` collapses it to
              a clock, or to nothing. See EvaluationGate.

              When the report arrives both go, and the reading has the panel to
              itself. Starting another conversation clears the report — see
              `start` — which brings the consigne back with no machinery of its
              own, and is why nothing here tracks a phase.
            */}
            {tab === 'evaluation' && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {report ? (
                  <EvaluationPanel report={report} />
                ) : (
                  <>
                    {consigne && session && (
                      <ConsignePanel session={session} answered={call.answered} />
                    )}
                    <EvaluationGate
                      live={call.live}
                      elapsedMs={elapsedMs}
                      lastCallMs={call.lastCallMs}
                      minimumMs={evalFloorMs}
                      complete={lessonDone}
                      busy={reporting}
                      error={reportError}
                      under={consigne}
                      onEvaluate={() => void evaluate()}
                    />
                  </>
                )}
              </div>
            )}

            {tab === 'dictionary' && (
              <DictionaryPanel l1={l1} request={request} onVocabChange={refreshWords} />
            )}

            {tab === 'vocab' && (
              <VocabPanel items={words} onOpen={openSaved} onChange={refreshWords} />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
