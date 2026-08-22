import { useCallback, useEffect, useRef, useState } from 'react';
import { startGeminiSession } from '../realtime/gemini';
import type { SessionSettings } from '../realtime/settings';
import {
  KEEP_GOING_SIGNAL,
  PROGRESS_TOOL,
  withoutSystemNote,
  wroteASystemNote,
} from '../realtime/tutorPrompt';
import type { AudioTap, SessionStatus, TranscriptDelta, VoiceSession } from '../realtime/types';
import { RevealQueue, type StampedText } from './reveal';
import type { TiltCue } from './headMotion';

/**
 * Holding one live call: the socket, the transcript, and the timing that makes
 * the two agree.
 *
 * LIFTED OUT OF studio RATHER THAN COPIED FOR /eleve. What lives here is not
 * glue — it is the reveal queue holding the agent's words until the audio
 * carrying them is actually audible, the barge-in that throws away words whose
 * audio was dropped unplayed, and the drain that rescues whatever was still
 * waiting when a call ends. Two copies of that would be two copies of a
 * question with one right answer, and the failure mode of drift is invisible:
 * a page that reads a sentence out a beat before its own voice says it, which
 * nobody notices until they are watching for it.
 *
 * WHAT IS DELIBERATELY NOT HERE. The prompt, the face, the settings panel and
 * every decision about what to show. This owns the call; the page owns the
 * conversation. That is what lets studio keep two balloons and a log while
 * /eleve renders one bubble and a pill from the same turns.
 */

/**
 * As tutorBench: audio bills per second of connection, so a forgotten tab costs.
 *
 * The default, not the rule. /eleve overrides it down to thirty seconds — see
 * `idleTimeoutMs` below for why the two pages want different numbers.
 */
export const IDLE_TIMEOUT_MS = 90_000;

/**
 * How often the silence is checked, which bounds how late the hang-up is.
 *
 * A second rather than five. The comparison is two numbers and runs while a
 * websocket is streaming audio, so the cost is not worth measuring — and at the
 * old five-second poll a thirty-second rule cut somewhere between thirty and
 * thirty-five, which is a tenth of the interval it is meant to be enforcing.
 */
const IDLE_POLL_MS = 1_000;

/**
 * How long a tutor may say nothing after its bookkeeping call before the page
 * asks it to carry on.
 *
 * SIX SECONDS, AND IT WAS TWO AND A HALF, WHICH LOST A RACE IT CANNOT AFFORD TO
 * ENTER. The old number came off a measurement that was true as far as it went:
 * on gemini-flash-31 the bookkeeping call comes first and the speech about
 * eight tenths of a second behind it, every time — in the lesson that was
 * measured. On 2026-08-22 a turn took two and a half seconds to start, the note
 * went out at 2.5s, the first audio arrived at 2.6s, and the note interrupted
 * the turn it was asking for. The words already queued were dropped unheard,
 * the model started again from the note, and the learner sat through eight
 * seconds of silence — in the middle of a lesson, caused by the thing that
 * exists to prevent exactly that.
 *
 * THE TWO MISTAKES COST WILDLY DIFFERENT AMOUNTS, which is what sets the
 * number. Firing late costs a few more seconds of a silence that was going to
 * be long anyway — the failure this exists for is silence with no end at all,
 * waiting on a learner to give up and speak first. Firing early costs a turn
 * that was already on its way, plus the whole regeneration behind it. So this
 * is set well clear of the slowest start anybody has seen rather than snugly
 * above the average one, and the average one never reaches it.
 *
 * IT REACHES THE LAST QUESTION TOO, and there is nothing left for it to race.
 * The page no longer says anything when the list completes — the tutor closes
 * that turn itself, see the closing effect in Eleve.tsx — so a report for the
 * last question with no speech behind it is the same stall as any other, and
 * the same nudge is the right answer: the turn it asks for is the goodbye. That
 * close waits twelve seconds on a tutor which has not spoken, which is this
 * with room after it, so the nudge always gets its chance first.
 */
const STALL_NUDGE_MS = 6_000;

/**
 * How recently a note must have gone out for a barge-in to be laid at its door.
 *
 * A second and a half: the measured case was two tenths, and everything past a
 * second is the learner. Wrong in either direction costs a word in a log line,
 * which is why this is a plain number and not a mechanism.
 */
const NOTE_BLAME_MS = 1_500;

export interface Turn {
  role: 'user' | 'agent';
  text: string;
  done: boolean;
  /**
   * Wall clock at the moment this turn's first words landed.
   *
   * ON THE AGENT'S SIDE THAT IS WHEN THEY WERE HEARD, not when they arrived on
   * the socket: `flush` is what calls `append`, and it releases only text the
   * voice has already reached. So the stamp is the learner's own experience of
   * the conversation, which is the only reading that can be compared with the
   * events around it.
   *
   * Nothing on screen draws it — it is here for the diagnostic. A conversation
   * that went wrong is nearly always one where *when* is the whole question: a
   * question asked twice a minute apart is a tutor that lost the thread, and
   * the same question twice in four seconds is one whose first asking was
   * talked over.
   */
  at: number;
  /** Wall clock when `done` went true, so a turn's length can be read off. */
  endedAt?: number;
}

/**
 * Everything a call does that is not words.
 *
 * WHY A TRANSCRIPT IS NOT ENOUGH. The turns say what was said; they cannot say
 * that the tutor's tool reported the list finished twice, that the learner talked
 * over the answer, that the page injected a closing note, or that the socket
 * dropped and came back. Every one of those produces a conversation that reads
 * oddly on the page and reads as nothing at all in the transcript — so the
 * transcript alone sends whoever is diagnosing it hunting for a cause among the
 * only evidence that survived, which is the prompt.
 *
 * IN MEMORY AND ACROSS CALLS. `turns` is cleared when a new call is dialled,
 * because the page draws them; this is not, because a second call that goes
 * wrong is very often explained by the first. A reload clears it, which is the
 * right way: this is a stethoscope, not a record.
 */
export interface CallEvent {
  /** Wall clock, on the same clock as `Turn.at`, so the two interleave. */
  at: number;
  kind:
    /** `connect` was called — one per press of the microphone. */
    | 'dialled'
    /** The session reported a new status, with whatever it said about it. */
    | 'status'
    /** The page said something to the tutor as the learner. See `say`. */
    | 'note'
    /**
     * The tutor called a tool, named and with its arguments, before anything
     * was made of it — including tools this build does not implement.
     *
     * Distinct from `progress` below, which is what the page *made* of one.
     * Two lines for one moment on purpose: a call that arrives and is not acted
     * on is the interesting case, and it can only be seen as the gap between
     * these two.
     */
    | 'tool'
    /**
     * The page's verdict on a progress report: taken, held, or refused and why.
     *
     * Every report gets one of these, including the refused ones — a tutor
     * reporting a question the learner never answered is the failure this
     * whole layer exists for, and it has to be visible as a line rather than
     * as an absence. A held report gets two: one where it arrived and one where
     * it was taken, a turn later, which is the only way to read off a timeline
     * that the tutor was early rather than wrong.
     */
    | 'progress'
    /** The learner talked over the tutor and unheard words were dropped. */
    | 'interrupted'
    /**
     * The tutor wrote itself a note — the page's marker, or its own paraphrase
     * of one — and it was cut out of the transcript before anyone read it.
     *
     * A line rather than a silent repair, because the cut is the only trace
     * left: the words never reach the bubble, the report or the vocabulary
     * list, and without this the diagnostic of a lesson that ended strangely
     * would show a tutor doing nothing unusual at all. See withoutSystemNote.
     */
    | 'stray'
    /** Something asked for the call to stop, and said why. */
    | 'hung-up';
  detail: string;
}

/**
 * How many events are kept.
 *
 * A long lesson is a few dozen; the cap is only here to stop a page left open
 * all afternoon from growing without bound. Oldest go first, so what survives
 * is always the part nearest whatever is being diagnosed.
 */
const EVENT_LIMIT = 400;

/** One line of it, for an event detail. Notes are paragraphs. */
function oneLine(text: string, limit = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * Whether a chunk of speech that just became audible carried a question.
 *
 * Deliberately looser than "the last character is a question mark". The
 * transcript arrives in fragments split wherever the model felt like splitting
 * them, so the mark is very often followed by the opening of the next sentence
 * in the same delta — and it is the mark being *heard* that matters, not where
 * the chunk happens to stop. A mark anywhere in newly audible text means the
 * question has just landed.
 *
 * Three marks rather than one, which is the difference between this working in
 * the language the page happens to be set to and working in the one it was
 * written in. `?` covers most of the list including Spanish, whose opening `¿`
 * is decorative here — the closing mark is the ordinary ASCII one and it is the
 * one that lands last. `？` is the full-width form Chinese and Japanese use, and
 * `؟` is Arabic's. Without them the tilt is simply dead in four of the languages
 * on offer, silently and only for the people using them.
 */
const ASKS = /[?？؟]/;

/**
 * Greek, which asks with a semicolon and cannot share the pattern above.
 *
 * U+037E, the Greek question mark, canonically decomposes to the ordinary
 * semicolon and in practice Greek text simply uses U+003B — so there is nothing
 * to match that is not also the mark French and German use in the middle of a
 * sentence. Adding it to ASKS would have the face lean at a clause boundary in
 * half of Europe, which is a worse failure than the one it fixes, so it is
 * gated on the language actually being Greek.
 *
 * A special case rather than a field on LanguageChoice: that type is shared with
 * the Pages Functions and is the allowlist a request is checked against, and one
 * language's punctuation is not something the server has any business carrying.
 */
const ASKS_EL = /[?？؟;]/;
const asksIn = (code: string) => (code === 'el' ? ASKS_EL : ASKS);

export interface VoiceCallOptions {
  /** Which model to dial. See models.ts. */
  modelKey: string;
  /** ISO-639-1 code of the language being spoken. Also decides the ask pattern. */
  language: string;
  /** The rendered system prompt, already composed with any persona. */
  instructions: string;
  /** Voice and turn-taking. Absent fields are not sent — see settings.ts. */
  settings?: SessionSettings;
  /**
   * How many questions this lesson has, if it is a lesson at all.
   *
   * What it buys is a bound on the tutor's own claims: a report for question 9
   * of a list of 5 is not a lesson three-quarters done, it is a model that has
   * lost its place, and without a total there is no way to say so. Absent means
   * no lesson — a workshop call trying a voice — and every report is refused,
   * because a conversation with no list cannot have got to the end of one.
   */
  questionCount?: number;
  /**
   * How long everyone can be silent before the call is dropped.
   *
   * A page-level decision rather than a constant, because the same silence
   * means different things on the two pages that dial. On the workshop pages a
   * quiet minute is somebody reading a settings panel with a call open; on the
   * student page it is a learner who has stopped, and the connection bills by
   * the second either way. Defaults to IDLE_TIMEOUT_MS.
   */
  idleTimeoutMs?: number;
  /**
   * What to say when that happens, in the language of the page saying it.
   *
   * The fallback below is English, which is right for the workshop and wrong
   * for a French page shown to a student — and this is the one message the call
   * layer produces that a learner is ever meant to read.
   */
  idleNotice?: string;
}

export interface VoiceCall {
  status: SessionStatus;
  detail: string | null;
  turns: Turn[];
  tap: AudioTap | null;
  speaking: boolean;
  heard: boolean;
  /**
   * Whether the tutor has finished its opening turn and handed over the floor.
   *
   * FALSE FOR THE WHOLE OF A CALL'S FIRST STRETCH — the dialling, and then the
   * tutor's own greeting — and true from the end of that greeting until the
   * call closes. It is not a running claim about who has the floor: later turns
   * do not put it back. See LearnerPill, which is the one thing that reads it,
   * and which uses it to decide whether the button may promise a microphone.
   */
  openingDone: boolean;
  muted: boolean;
  tiltCue: TiltCue | null;
  live: boolean;
  busy: boolean;
  /** When the current call reached `live`, or null between calls. */
  connectedAt: number | null;
  /** How long the call that just ended ran, in ms. Null before the first one. */
  lastCallMs: number | null;
  /**
   * Which questions the page believes have been answered, in the order it came
   * to believe it.
   *
   * NOT WHAT THE TUTOR REPORTED. The tutor's reports arrive raw on
   * `onQuestionDone` and are filtered here — see `acceptProgress`. This is
   * what survived that, and it is what the page acts on: the consigne ticks
   * these, and the lesson closes when there are as many of them as there are
   * questions.
   *
   * IT IS STILL NOT A FACT ABOUT THE LEARNING. It decides when the call hangs
   * up and nothing else. Whether a question was answered *well* is read off the
   * transcript afterwards by the end-of-call report, which is the authority on
   * everything a teacher would care about.
   *
   * Never shrinks during a call, and resets between calls.
   */
  answered: number[];
  /**
   * What happened, in order, for the diagnostic to print beside the turns.
   *
   * Spans every call this page has made rather than only the current one — see
   * CallEvent. Nothing on screen reads it.
   */
  events: CallEvent[];
  connect: () => Promise<void>;
  /**
   * Ends the call, in two registers.
   *
   * `notice` is shown on the page, so it is written for whoever is looking at
   * it — on /eleve that is a French sentence addressed to a learner. `why` is
   * the line in the account, written for whoever is reading a diagnostic
   * afterwards, and it falls back to the notice when there is nothing separate
   * to say.
   *
   * THEY SPLIT BECAUSE THE PAGE'S OWN HANG-UPS HAVE NOTHING TO SHOW. A call
   * closing on a finished lesson wants no message at all — the tutor has just
   * said goodbye, and a line of chrome underneath it is the app talking over the
   * ending. But it very much wants a log line, because "the page hung up after
   * the closing note" and "the learner pressed the microphone" are the same
   * event from the outside and different bugs from the inside. With one string
   * doing both jobs, every silent close read as `asked to stop, with no reason
   * given` and the two were indistinguishable.
   */
  hangUp: (notice?: string, why?: string) => void;
  toggleMute: () => void;
  /**
   * Say something to the tutor as the learner, invisibly.
   *
   * The page owns the clock — see `say` in types.ts — so this is how it tells
   * the tutor the time is up. A no-op between calls rather than a throw: a
   * timer that fires as the learner hangs up is an ordinary race, not a fault.
   *
   * `label` names the note in the event log, and exists because the notes are
   * paragraphs that all open on the same sixty characters of marker. Without it
   * a log line cannot say whether the page congratulated a finished lesson or
   * admitted to cutting one short, which is the difference between two very
   * different bugs. Absent falls back to an excerpt, so the call layer keeps
   * knowing nothing about which notes exist.
   */
  say: (text: string, label?: string) => void;
  /**
   * Refuse before dialling, in the caller's own words.
   *
   * For the checks a page can make and this cannot — studio's is that the
   * preset and the persona together overflow the instruction ceiling, and the
   * message has to name both halves because the overflow is the sum of two
   * things chosen on different pages. Nothing is spent either way; what this
   * buys is an error that reads as the prompt being too long rather than as the
   * model being unreachable.
   */
  fail: (message: string) => void;
}

export function useVoiceCall(options: VoiceCallOptions): VoiceCall {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  /**
   * Whether the microphone is hearing the user right now.
   *
   * State rather than a ref, because the face is a component and has to be told.
   * It is cheap to hold as state only because MicCapture debounces it into an
   * on/off — this changes once or twice per turn, where the level behind it
   * changes eight times a second.
   *
   * Never set outside a call: it is cleared when the session closes, below, and
   * MicCapture reports false on both mute and stop, so a call that ends
   * mid-sentence cannot leave the face believing it is still being spoken to.
   */
  const [heard, setHeard] = useState(false);
  /**
   * See `openingDone` on VoiceCall for what this means. The ref beside it is
   * the guard that keeps it honest: it flips on an *end* of tutor audio, and
   * only an end that had a beginning. A provider that reports `false` once on
   * connect — before it has said anything — would otherwise be taken for a
   * greeting that had already happened, which is exactly the moment the flag
   * exists to not get wrong.
   */
  const [openingDone, setOpeningDone] = useState(false);
  const tutorHasSpoken = useRef(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  /**
   * The tap is state, not a ref: the mouth is a component that has to re-run
   * its animation loop when one appears, and a ref would not tell it.
   */
  const [tap, setTap] = useState<AudioTap | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [lastCallMs, setLastCallMs] = useState<number | null>(null);
  const [answered, setAnswered] = useState<number[]>([]);
  const [events, setEvents] = useState<CallEvent[]>([]);

  /**
   * Writes one line of the account. See CallEvent.
   *
   * The stamp is taken out here rather than inside the updater, and the updater
   * itself does nothing else: StrictMode double-invokes updaters in
   * development, and an event built in there would be built twice off two
   * different clocks. React discards the first result either way, so the log
   * gets one entry — but only because the work is pure. Nothing with a side
   * effect may move inside it. Same rule as `toggleMute` below.
   */
  const record = useCallback((kind: CallEvent['kind'], detail: string) => {
    const at = Date.now();
    setEvents((current) => {
      const next = [...current, { at, kind, detail }];
      return next.length > EVENT_LIMIT ? next.slice(next.length - EVENT_LIMIT) : next;
    });
  }, []);

/**
   * The accepted numbers as a plain value, for the reader that cannot wait a
   * render.
   *
   * Every decision below compares against what has been accepted *now* —
   * whether this number is a repeat, whether the learner has spoken since the
   * last one — and state is a render behind. Reading it inside an updater would
   * put the deciding somewhere StrictMode runs twice, which is the same rule
   * `record` and `toggleMute` follow.
   */
  const accepted = useRef<number[]>([]);

  /**
   * How many turns the learner has finished speaking.
   *
   * THE CEILING ON WHAT A TUTOR MAY CLAIM. Five questions cannot have been
   * answered by somebody who has spoken three times, whatever the tutor
   * reports, and that is the whole of what this counts. See `acceptProgress`,
   * which spends it, and note what it is *not*: a judgement about whether any
   * of those turns was a good answer. Reading the text would mean this layer
   * deciding what a full sentence is in twenty-eight languages, on a transcript
   * of a hesitant beginner — see the report for who is allowed to make that
   * call, and on what evidence.
   *
   * IT COUNTS TO THE MOMENT, WHICH IT DID NOT USED TO. Two things in gemini.ts
   * decide what arrives here: a turn is closed when the model begins answering
   * — including when it begins with a tool call, which on this model is the
   * first thing it emits — and a turn the learner never spoke in is not closed
   * at all. Before the first, a report made as the learner stopped talking
   * arrived while their turn was still open here and was refused for being one
   * short. Before the second, the greeting credited every lesson with a turn
   * nobody had taken, and the two cancelled out — a ceiling one too high
   * meeting a count one too low. They are both true now instead, which is the
   * only version of this that stays true when either end changes.
   */
  const learnerTurns = useRef(0);

  /**
   * The one report that arrived a moment too early, waiting for the turn it is
   * about to finish.
   *
   * A REPORT ONE AHEAD OF THE LEARNER IS EARLY, NOT FALSE, and until this
   * existed the page could not tell those apart — it refused both, and a
   * refusal is permanent. What that cost is a whole lesson: on 2026-08-22 a
   * tutor reported question four in the same breath as question three, one
   * turn before the learner answered it. Four was refused; the learner then
   * answered four and five; the report for five was refused in turn because
   * four was never counted; and a lesson the learner had finished sat at three
   * of five until the cap ran out and told them they had run out of time. One
   * early report by one turn, and the count could never recover.
   *
   * ONE SLOT AND ONE TURN OF PATIENCE, which is what keeps the guard a guard. A
   * report is held only when it is exactly one ahead — the tutor reporting the
   * answer the learner is finishing as it speaks, which is the timing the
   * prompt asks for and the transport sometimes rounds the wrong way. Anything
   * further ahead is still refused on the spot, so the pathological case is
   * unchanged: a tutor claiming all five before anybody has spoken gets one
   * held and four refused, and the held one is taken only once a learner turn
   * exists to pay for it. Nothing is ever counted that the conversation could
   * not contain — the ceiling is the same, this just stops the page dropping a
   * claim that becomes true a second later.
   */
  const held = useRef<number | null>(null);

  /**
   * The last thing that happened worth leaning at.
   *
   * State rather than a ref because the face has to be told, and told by a
   * change of identity — which is also why it is never rebuilt inline. Its
   * counter is a ref: two questions in a row have to be two distinct objects,
   * and nothing on screen depends on how many there have been.
   */
  const [tiltCue, setTiltCue] = useState<TiltCue | null>(null);
  const cueCount = useRef(0);
  const cue = useCallback((kind: TiltCue['kind']) => {
    cueCount.current += 1;
    setTiltCue({ kind, seq: cueCount.current });
  }, []);

  const session = useRef<VoiceSession | null>(null);
  /** Agent words waiting for the audio that carries them. See reveal.ts. */
  const queue = useRef(new RevealQueue());
  const lastActivity = useRef(Date.now());
  /** Wall-clock start of the current call, for the duration reported on close. */
  const startedAt = useRef<number | null>(null);

  /**
   * The options as of this render, where `connect` can reach them.
   *
   * A ref rather than a dependency: the settings object is rebuilt every render
   * and the instructions change as the prompt is edited, so a `connect` that
   * closed over them would either be a new function every render or a stale
   * one. This keeps the identity stable and the values current, which is what a
   * plain function in the component body used to give for free.
   */
  const latest = useRef(options);
  latest.current = options;

  const { language } = options;

  useEffect(() => () => session.current?.stop(), []);

  /**
   * Extends the open turn for that role, or starts a new one.
   *
   * THE ROLE'S LAST TURN, NOT THE TRANSCRIPT'S LAST TURN. This used to look
   * only at the tail, and that quietly threw away every close the learner's
   * side ever got. The marker saying their turn is over arrives once the tutor
   * has begun answering — see gemini.ts — and by then the tutor's own first
   * words are already on the end of the list. The close found a role that did
   * not match, fell through to the push below, was empty and so did nothing,
   * and the learner's turn stayed open for the whole call. studio never
   * showed it because it reads the last turn of a role whether or not it has
   * closed; /eleve's pill waits for a closed turn, so it sat empty no matter
   * how much was said into it.
   *
   * A closed turn is never reopened. The last word or two of an utterance can
   * land after the tutor has started replying, and those begin a fresh turn at
   * the end of the list rather than being folded back into the sentence the
   * pill has already settled on — which is what stops a two-word tail
   * overwriting the answer while the learner is still reading it.
   */
  const append = useCallback((role: 'user' | 'agent', text: string, done: boolean) => {
    if (!text && !done) return;
    // Outside the updater, for `record`'s reason: one append must not be able
    // to stamp itself twice off two different clocks.
    const now = Date.now();
    setTurns((current) => {
      let index = current.length - 1;
      while (index >= 0 && current[index].role !== role) index--;
      if (index >= 0 && !current[index].done) {
        const next = [...current];
        next[index] = {
          ...next[index],
          text: next[index].text + text,
          done,
          ...(done ? { endedAt: now } : {}),
        };
        return next;
      }
      return text
        ? [...current, { role, text, done, at: now, ...(done ? { endedAt: now } : {}) }]
        : current;
    });
  }, []);

  /**
   * What the page does with a frame of progress reports.
   *
   * THE MODEL REPORTS AND THE PAGE COUNTS. That division is the fix this file
   * carries. A tutor used to make one claim that the lesson was over and the
   * page acted on it unexamined, which is exactly as reliable as it sounds: the
   * claim arrived after question three of five, on a one-word answer, and two
   * questions were never asked.
   *
   * WHAT THESE TESTS CAN AND CANNOT DO, stated plainly because the first
   * version of this promised more than it delivered. They are a cheap bound on
   * an untrusted claim, not a proof that a lesson happened. Nothing here reads
   * the answer: judging whether a hesitant beginner's sentence was good enough,
   * in twenty-eight languages, off a transcript, is the end-of-call report's
   * job and is made afterwards on the whole conversation. What the page can
   * cheaply know is that the tutor is claiming more than the conversation could
   * possibly contain, and that is what it refuses.
   *
   * FOUR TESTS. Is there a list at all; is this a question on it; has it been
   * reported already; and the two arithmetic ones below. A report that passes
   * is counted, and one that fails is written into the account with its reason,
   * because a refused report is evidence about the tutor and an invisible one
   * is not.
   *
   * NO QUESTION MAY OUTRUN THE LEARNER. The count of questions believed
   * answered can never exceed the number of turns the learner has finished:
   * five answered questions require five times the learner has spoken. This is
   * the test that makes the pathological case impossible — a tutor reporting
   * the whole list before anybody has said anything gets one report held and
   * the rest refused.
   *
   * IT IS THE ONE TEST THAT CAN FAIL TEMPORARILY, which is why it alone has a
   * third answer. Every other refusal here is about the report — a number off
   * the list, a repeat, a place in the list it cannot occupy — and none of those
   * becomes true later. This one is about the clock: a report one turn ahead of
   * the learner is the same report a second early, and a second later the turn
   * it names has happened. So a report exactly one ahead is held and taken when
   * the learner's next turn closes, and anything further ahead is refused where
   * it stands. See `held`, which carries what that distinction cost to learn.
   *
   * NO REPORT MAY JUMP AHEAD OF THE LIST. A report for question five while one
   * through three are uncounted is a tutor that has lost its place, so a number
   * is refused unless everything before it is already counted or arrives in the
   * same frame. This is the test that would have caught the run this rewrite
   * came from, where the ending arrived two questions early.
   *
   * A FRAME IS ONE DECISION AND IS SORTED BEFORE IT IS JUDGED. The tutor
   * catches its bookkeeping up in a single breath — `questionDone(2)` and
   * `questionDone(1)` in one frame, then `(3)` and `(4)` in another, which is
   * ordinary measured behaviour rather than a fault. Judged in arrival order
   * they refuse each other; sorted, they are what they are, which is two
   * questions finished. The earlier rule here — one report per learner turn —
   * refused two of five on a run where the tutor did everything right, and
   * would have closed a finished lesson with "we ran out of time".
   *
   * AN UNNUMBERED CALL IS STILL A REPORT. The tool declares `number` as
   * required and a model will occasionally call it without one anyway. Refusing
   * those would throw away a real signal over a missing field, so it is read as
   * the next question not yet counted.
   */
  const acceptProgress = useCallback(
    (reports: Array<number | undefined>) => {
      const total = latest.current.questionCount ?? 0;
      const seen = accepted.current;

      const refuse = (named: string, why: string) =>
        record('progress', `question ${named} refused — ${why}`);

      if (!total) {
        refuse(reports.map((entry) => entry ?? '(unnumbered)').join(', '), 'this call has no question list');
        return;
      }

      // Sorted, with the unnumbered ones last: they are read as "the next one
      // not yet counted", and that reading is only right once the numbered
      // reports in the same frame have been placed.
      const ordered = [...reports].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
      let took = false;

      for (const reported of ordered) {
        const named = reported === undefined ? '(unnumbered)' : String(reported);

        let number = reported;
        if (number === undefined) {
          number = 1;
          while (number <= total && seen.includes(number)) number += 1;
        }

        if (!Number.isInteger(number) || number < 1 || number > total) {
          refuse(named, `there is no question ${number} on a list of ${total}`);
          continue;
        }
        if (seen.includes(number)) {
          refuse(named, 'it was counted already');
          continue;
        }
        if (number > seen.length + 1) {
          refuse(named, `the ${number - seen.length - 1} question(s) before it are not counted yet`);
          continue;
        }
        if (seen.length + 1 > learnerTurns.current) {
          const short = `the learner has finished ${learnerTurns.current} turn(s)`;
          // One ahead is early rather than false, and the slot is free: hold it
          // for the turn the learner is finishing as the tutor speaks. See `held`.
          if (seen.length === learnerTurns.current && held.current === null) {
            held.current = number;
            record('progress', `question ${named} held — ${short}, so this is one early`);
            continue;
          }
          refuse(
            named,
            held.current === null
              ? short
              : `${short}, and question ${held.current} is already waiting on the next`,
          );
          continue;
        }

        seen.push(number);
        took = true;
        record(
          'progress',
          `question ${named} answered${reported === undefined ? ` — read as ${number}` : ''} — ${seen.length} of ${total}`,
        );
      }

      if (took) setAnswered([...seen]);
    },
    [record],
  );

  /**
   * Puts the early report back through the tests, now that the turn it was
   * about has happened.
   *
   * Through `acceptProgress` rather than straight onto the list, because being
   * one turn early was only ever one of five reasons to refuse a report and the
   * other four still apply. The slot is cleared before the call rather than
   * after, so the report is judged on the same terms as any other instead of
   * against a hold it is itself occupying.
   */
  const takeHeld = useCallback(() => {
    const waiting = held.current;
    if (waiting === null) return;
    held.current = null;
    acceptProgress([waiting]);
  }, [acceptProgress]);

  const onTranscript = useCallback(
    (delta: TranscriptDelta) => {
      lastActivity.current = Date.now();

      // The user's own transcript lags their speech rather than leading it, so
      // there is nothing to hold it back for.
      if (delta.role === 'user') {
        // A finished utterance, which is the unit the progress guard counts in.
        // Partials arrive on the way to it and must not each count as a turn.
        if (delta.done) {
          learnerTurns.current += 1;
          // The turn an early report was waiting on. Taken here rather than on a
          // timer because this is the moment it stops being a claim about the
          // future — and the closing note is two seconds behind the count, so a
          // report left waiting for the tutor's next tool call would arrive
          // after the lesson had already been declared unfinished.
          takeHeld();
        }
        append('user', delta.text, delta.done);
        return;
      }

      // A delta with no stamp has no better information than "now", which is
      // what -Infinity means to the queue: due on the next frame.
      queue.current.push({ text: delta.text, done: delta.done, at: delta.at ?? -Infinity });
    },
    [append, takeHeld],
  );

  /**
   * The turn the tutor is part-way through, as it arrived and as it was shown.
   *
   * Two lengths of the same speech, and they differ only when the tutor has
   * written a system note into its own turn. The raw text is what the marker
   * test needs — transcription is split wherever the model split it, so the
   * marker is very often across a fragment boundary and cannot be found in one
   * — and the count of what has been shown is what turns a test on the whole
   * turn back into deltas to append. See withoutSystemNote, whose cut is
   * monotonic, which is the property that lets this subtract two lengths and
   * never have to unsay anything.
   */
  const said = useRef({ heard: '', shown: 0, stray: false });

  /**
   * Puts words on screen, and is the only thing that may.
   *
   * Both callers reach it with text that has become audible: the frame loop
   * with what is due, and the end of a call with whatever was still waiting.
   * They share this rather than each calling `append` because the note test
   * above is stateful across deltas, and two copies of it would be two states
   * that disagree the moment a call ends mid-turn.
   *
   * Returns what it actually showed, which is what the question test then
   * reads: a mark inside a note the tutor invented is not a question anybody
   * was asked.
   */
  const reveal = useCallback(
    (items: StampedText[]) => {
      let shown = '';

      for (const item of items) {
        const turn = said.current;
        turn.heard += item.text;
        const spoken = withoutSystemNote(turn.heard);

        if (spoken.length > turn.shown) {
          const fresh = spoken.slice(turn.shown);
          append('agent', fresh, item.done);
          turn.shown = spoken.length;
          shown += fresh;
        } else if (item.done) {
          append('agent', '', true);
        }

        // Only on the whole marker. A turn that happens to end on `[` has a
        // tail withheld for a frame, and that is not worth a line in the log.
        if (!turn.stray && wroteASystemNote(turn.heard)) {
          turn.stray = true;
          record('stray', 'the tutor wrote itself a system note; it was cut from the transcript');
        }

        if (item.done) said.current = { heard: '', shown: 0, stray: false };
      }

      return shown;
    },
    [append, record],
  );

  /** Moves whatever has become audible out of the queue and onto the screen. */
  const flush = useCallback(
    (now: number) => {
      const spoken = reveal(queue.current.take(now));
      // The right side of the queue to read a question off, and the only one.
      // Deltas arrive here seconds before the voice reaches them and anything
      // still waiting is thrown away on barge-in — so a mark seen on the way in
      // would tilt the head at a question that was either not yet asked or, if
      // the user cut in, never asked at all. Everything in `due` has just been
      // heard, which is the moment the gesture belongs to.
      const asks = asksIn(language);
      if (asks.test(spoken)) cue('question');
    },
    [cue, language, reveal],
  );

  useEffect(() => {
    if (status !== 'live') return;
    let frame = 0;

    const step = () => {
      // The session reports `live` from inside startGeminiSession and only hands
      // back its tap when that call returns, so for a moment there is a live
      // call and no clock. Wait it out rather than falling back to the wall
      // clock, which would dump the greeting on screen before it was spoken.
      // Nothing is lost by waiting: onStatus drains the queue when the call ends.
      if (tap) flush(tap.now());
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [status, tap, flush]);

  const hangUp = useCallback(
    (notice?: string, why?: string) => {
      // Only when there is something to hang up. The page calls this from a
      // timer and from a button, and both can land on a call that has already
      // closed — logging those would fill the account with hang-ups that hung
      // nothing up.
      if (session.current) {
        record('hung-up', why ?? notice ?? 'asked to stop, with no reason given');
      }
      session.current?.stop();
      session.current = null;
      // stop() drives onStatus('closed'), which clears detail — so say why
      // after. Only the notice is ever shown: `why` is for the account.
      if (notice) setDetail(notice);
    },
    [record],
  );

  useEffect(() => {
    if (status !== 'live') return;

    const timer = setInterval(() => {
      // Read through the ref rather than through the effect's deps: both of
      // these can change with the session that is loaded, and re-running the
      // effect would restart the interval — and with it the window it is
      // measuring — every time the page re-renders with a new options object.
      const limit = latest.current.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
      if (Date.now() - lastActivity.current < limit) return;
      hangUp(
        latest.current.idleNotice ??
          `Ended automatically after ${limit / 1000}s with no one talking`,
        // Said separately, in English and with the number in it, because the
        // notice beside it is in whatever language the page speaks — and a log
        // line a reader has to translate before they can tell which timer fired
        // is a log line that gets skipped.
        `idle — nobody said anything for ${limit / 1000}s`,
      );
    }, IDLE_POLL_MS);

    return () => clearInterval(timer);
  }, [status, hangUp]);

  const fail = useCallback((message: string) => {
    setStatus('error');
    setDetail(message);
  }, []);

  /**
   * The tutor called its tool, said nothing, and is being given a moment.
   *
   * WHY A TIMER RATHER THAN A TEST. A bookkeeping call arriving before the
   * model has spoken is not a stall — on gemini-flash-31 it is simply the order
   * the model works in, measured at five calls out of five in one lesson, with
   * the speech following about eight tenths of a second later. It is a stall
   * only if nothing follows, and nothing following is not something that can be
   * known at the moment the call arrives. So this waits, and the waiting is the
   * whole mechanism: almost every arming is disarmed by the tutor talking.
   *
   * WHAT DISARMS IT is the tutor speaking, the learner speaking, or the call
   * ending. The learner counts because a note is `clientContent`, and
   * clientContent landing while somebody is mid-sentence cuts them off — so a
   * silence the learner has already filled is a silence that needs no help.
   */
  const stall = useRef<number | null>(null);
  /**
   * When this page last put a note on the wire, for the barge-in line to read.
   *
   * Starts at -Infinity rather than 0 so the first interruption of a call is
   * never blamed on a note that was never sent.
   */
  const noteAt = useRef(-Infinity);
  const clearStall = useCallback(() => {
    if (stall.current === null) return;
    clearTimeout(stall.current);
    stall.current = null;
  }, []);

  const say = useCallback(
    (text: string, label?: string) => {
      const said = label ?? oneLine(text);
      // Before the send, so an interruption caused by this note can never look
      // older than the note that caused it.
      noteAt.current = Date.now();
      /*
       * A note with no call to land in is recorded as dropped rather than not
       * recorded at all. That is the single most useful line this log can
       * carry: a closing note the page believes it sent and the tutor never
       * received is a conversation that runs to the idle timeout, and from the
       * outside it looks exactly like a tutor ignoring its instructions.
       */
      record('note', session.current ? said : `${said} — DROPPED, no call was running`);
      session.current?.say(text);
    },
    [record],
  );

  const connect = useCallback(async () => {
    record('dialled', `${latest.current.modelKey} · ${latest.current.language}`);
    setTurns([]);
    setDetail(null);
    setMuted(false);
    clearStall();
    queue.current.discard();
    setOpeningDone(false);
    tutorHasSpoken.current = false;
    said.current = { heard: '', shown: 0, stray: false };

    const handlers = {
      onStatus: (next: SessionStatus, message?: string) => {
        record('status', message ? `${next} — ${oneLine(message)}` : next);
        setStatus(next);
        setDetail(message ?? null);
        if (next === 'live' && startedAt.current === null) {
          startedAt.current = Date.now();
          setConnectedAt(startedAt.current);
        }
        if (next === 'closed' || next === 'error') {
          clearStall();
          // Whatever was still queued was said, or was a word away from it.
          // Dropping it silently would lose the end of every conversation.
          reveal(queue.current.drain());
          // The learner's turn is closed by the tutor beginning to answer, so
          // the last thing said before hanging up has nothing to close it. No-op
          // unless one is open, and worth the line: without it the sentence
          // someone ends a call on is the one sentence the pill never shows.
          append('user', '', true);
          session.current = null;
          setTap(null);
          setSpeaking(false);
          setHeard(false);
          setOpeningDone(false);
          tutorHasSpoken.current = false;
          // Measured from the moment the call went live rather than from the
          // press, so a slow connect is not credited to the conversation. The
          // student page gates its report on this.
          if (startedAt.current !== null) setLastCallMs(Date.now() - startedAt.current);
          startedAt.current = null;
          setConnectedAt(null);
        }
      },
      onTranscript,
      onSpeaking: (next: boolean) => {
        lastActivity.current = Date.now();
        // The turn arrived after all, which is the ordinary end of a wait.
        if (next) clearStall();
        setSpeaking(next);
        if (next) tutorHasSpoken.current = true;
        // The end of the tutor's first stretch of audio, which is the moment
        // the call stops being something the learner is listening to and starts
        // being something they are in. Every later end passes through here too
        // and costs nothing: the flag is already true.
        else if (tutorHasSpoken.current) setOpeningDone(true);
        // Every false, barge-in included, and no attempt to tell them apart:
        // both are the agent's audio ending and the floor going back to the
        // user, which is the whole of what a listening tilt responds to. The
        // channel's own lockout takes care of a provider that says it twice.
        if (!next) cue('listening');
      },
      /**
       * The user's voice, straight through to the face.
       *
       * No arming and no edge detection on the way, which is the part worth
       * noticing: both live in HeadPerformer, beside the gesture they decide.
       * This layer's job is to report that a microphone heard something, and it
       * is deliberately the same shape as `speaking` above — a fact about the
       * present moment, not a claim about what it means.
       *
       * It counts as activity for the idle timer, and that is a small fix
       * rather than a side effect. The timer previously only saw the agent:
       * transcription of the user arrives at the end of an utterance, so a
       * learner talking steadily to a tutor that had stopped answering could
       * have the call hung up underneath them.
       */
      onVoice: (active: boolean) => {
        if (active) lastActivity.current = Date.now();
        // A silence the learner has filled themselves. Nudging into it would
        // put a note on the wire in the middle of their sentence.
        if (active) clearStall();
        // A learner talking is proof the floor is theirs, whatever the audio
        // channel did or failed to report. Belt and braces for the one failure
        // that would matter — a greeting whose end never arrives, leaving the
        // button promising a tutor that has plainly already finished.
        if (active) setOpeningDone(true);
        setHeard(active);
      },
      /*
       * Every tool call, named, with what it carried and what became of it.
       *
       * THE ANNOTATION IS A CLAIM ABOUT THIS FILE AND NOT ABOUT THE DECLARATIONS.
       * `PROGRESS_TOOL` is the one name anything here tests; everything else is
       * answered on the socket and then dropped on the floor. So "not a tool
       * this page knows" is true by construction and stays true — a second tool
       * declared server-side and handled nowhere is still, accurately, one this
       * page does nothing with. A list of declared names copied over from
       * _setup.ts would be a second thing to keep in step, and a log that lies
       * about which tools exist is worse than one that says less.
       *
       * WHY THE UNKNOWN CASE SHOUTS. It is the signature of a setup published
       * against an older protocol, and its symptom — the tutor asking every
       * question twice — looks exactly like a model ignoring its prompt. That
       * cost a full diagnosis to find once — one of the reasons the prompt is
       * composed at dial time now, where it cannot describe a protocol this
       * build does not implement. See composeTutorPrompt.
       *
       * The arguments are printed because they are what tell two calls of the
       * same tool apart, which is the whole question when one is arriving after
       * every question. Trimmed hard: this is a log line, not a payload.
       */
      onToolCall: (name: string, args?: Record<string, unknown>, spoken?: boolean) => {
        const carried =
          args && Object.keys(args).length ? ` ${oneLine(JSON.stringify(args), 80)}` : '';
        record(
          'tool',
          name === PROGRESS_TOOL
            ? `${name}${carried} — the signal this page counts`
            : `${name}${carried} — NOT A TOOL THIS PAGE KNOWS; answered on the socket, then ignored`,
        );

        /*
         * Armed only where the turn has produced nothing yet, and it is a
         * question rather than a verdict — see `stall`. Rearmed rather than
         * stacked: a frame carrying two calls is one silence, not two.
         */
        if (spoken) return;
        clearStall();
        stall.current = window.setTimeout(() => {
          stall.current = null;
          say(KEEP_GOING_SIGNAL, 'nudge — the tutor called its tool and then said nothing');
        }, STALL_NUDGE_MS);
      },
      /*
       * Barge-in. The audio for anything still queued was thrown away unplayed,
       * so showing those words would put sentences on screen that were cut off
       * mid-breath and never spoken.
       *
       * IT SAID "THE LEARNER TALKED OVER THE TUTOR" AND THAT WAS A GUESS. The
       * socket reports that a turn was cut off and never says by what, and the
       * page is itself one of the two things that can do it: a note is
       * clientContent, and clientContent landing on a turn in flight interrupts
       * it exactly as a voice does. A diagnostic that names the learner every
       * time hides the case worth finding, which is the page interrupting its
       * own tutor — that cost eight seconds of dead air once, and read as the
       * learner talking over a tutor who had not started talking yet. So the
       * line reports the note if one had just gone out, and otherwise says the
       * only other thing it can honestly say.
       */
      onInterrupted: () => {
        const sinceNote = Date.now() - noteAt.current;
        record(
          'interrupted',
          sinceNote <= NOTE_BLAME_MS
            ? `the turn was cut off ${(sinceNote / 1000).toFixed(1)}s after this page sent a note, so the note is the likely cause; unheard words were dropped`
            : 'the learner talked over the tutor; unheard words were dropped',
        );
        queue.current.discard();
        // The turn those words belonged to is over, so the note test starts
        // again with the next one. What is already on screen was audible and
        // stays; this is only the part that never got there.
        said.current = { heard: '', shown: 0, stray: false };
      },
      // Every report, unexamined, straight to the one place allowed to
      // examine it. See `acceptProgress`.
      onQuestionDone: acceptProgress,
    };

    try {
      lastActivity.current = Date.now();
      // A new call is a new pass down the list. Reset here rather than on hang
      // up, so the state stays readable on the summary of the call that ended.
      accepted.current = [];
      held.current = null;
      setAnswered([]);
      learnerTurns.current = 0;
      const { modelKey, language: code, instructions, settings } = latest.current;
      const started = await startGeminiSession(handlers, modelKey, code, {
        instructions,
        settings: settings ?? {},
      });
      session.current = started;
      setTap(started.tap ?? null);
    } catch (error) {
      session.current = null;
      setTap(null);
      startedAt.current = null;
      setConnectedAt(null);
      setStatus('error');
      setDetail(error instanceof Error ? error.message : 'Could not start the session');
    }
  }, [acceptProgress, append, clearStall, cue, onTranscript, record, reveal, say]);

  // Read-then-set rather than a functional updater: the session call is a side
  // effect, and StrictMode double-invokes updaters in development, so putting
  // it inside one would mute the microphone twice per press.
  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    session.current?.setMuted(next);
  }, [muted]);

  return {
    status,
    detail,
    turns,
    tap,
    speaking,
    heard,
    openingDone,
    muted,
    tiltCue,
    live: status === 'live',
    busy: status === 'connecting',
    connectedAt,
    lastCallMs,
    answered,
    events,
    connect,
    hangUp,
    toggleMute,
    say,
    fail,
  };
}
