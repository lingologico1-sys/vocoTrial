import { useCallback, useEffect, useRef, useState } from 'react';
import { startGeminiSession } from '../realtime/gemini';
import type { SessionSettings } from '../realtime/settings';
import type {
  AudioTap,
  SessionStatus,
  TranscriptDelta,
  VoiceSession,
} from '../realtime/types';
import { RevealQueue } from './reveal';
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
 * that the tutor's tool reported question three twice, that the learner talked
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
    /** The tutor's tool reported a question done. Raw, repeats included. */
    | 'answered'
    /** The learner talked over the tutor and unheard words were dropped. */
    | 'interrupted'
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
  muted: boolean;
  tiltCue: TiltCue | null;
  live: boolean;
  busy: boolean;
  /** When the current call reached `live`, or null between calls. */
  connectedAt: number | null;
  /** How long the call that just ended ran, in ms. Null before the first one. */
  lastCallMs: number | null;
  /**
   * How many of the lesson's questions the tutor says are done.
   *
   * A FLOOR, NOT A COUNT, and the page showing it must treat it as one. It is
   * whatever the tutor has reported through its tool, and a model under-reports
   * far more readily than it over-reports — so this only ever goes up, resets
   * between calls, and is never the thing that decides whether a lesson was
   * completed. The end-of-call report reads the transcript and is what knows.
   *
   * Zero when there is no lesson, which is also zero when there is one and the
   * tutor has not got anywhere yet. Nothing downstream needs to tell those
   * apart: a page with no questions does not draw a counter.
   */
  answered: number;
  /**
   * What happened, in order, for the diagnostic to print beside the turns.
   *
   * Spans every call this page has made rather than only the current one — see
   * CallEvent. Nothing on screen reads it.
   */
  events: CallEvent[];
  connect: () => Promise<void>;
  hangUp: (reason?: string) => void;
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
  const [turns, setTurns] = useState<Turn[]>([]);
  /**
   * The tap is state, not a ref: the mouth is a component that has to re-run
   * its animation loop when one appears, and a ref would not tell it.
   */
  const [tap, setTap] = useState<AudioTap | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [lastCallMs, setLastCallMs] = useState<number | null>(null);
  const [answered, setAnswered] = useState(0);
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
   * `answered` as a plain value, for the two readers that cannot wait a render.
   *
   * The log line has to say whether a reported number moved the count forward
   * or repeated one already past, and that comparison needs the value as it is
   * *now* — state would be a render behind, and reading it inside the updater
   * would put the logging side effect somewhere StrictMode runs twice.
   */
  const answeredFar = useRef(0);

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

  const onTranscript = useCallback(
    (delta: TranscriptDelta) => {
      lastActivity.current = Date.now();

      // The user's own transcript lags their speech rather than leading it, so
      // there is nothing to hold it back for.
      if (delta.role === 'user') {
        append('user', delta.text, delta.done);
        return;
      }

      // A delta with no stamp has no better information than "now", which is
      // what -Infinity means to the queue: due on the next frame.
      queue.current.push({ text: delta.text, done: delta.done, at: delta.at ?? -Infinity });
    },
    [append],
  );

  /** Moves whatever has become audible out of the queue and onto the screen. */
  const flush = useCallback(
    (now: number) => {
      const due = queue.current.take(now);
      for (const item of due) append('agent', item.text, item.done);
      // The right side of the queue to read a question off, and the only one.
      // Deltas arrive here seconds before the voice reaches them and anything
      // still waiting is thrown away on barge-in — so a mark seen on the way in
      // would tilt the head at a question that was either not yet asked or, if
      // the user cut in, never asked at all. Everything in `due` has just been
      // heard, which is the moment the gesture belongs to.
      const asks = asksIn(language);
      if (due.some((item) => asks.test(item.text))) cue('question');
    },
    [append, cue, language],
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
    (reason?: string) => {
      // Only when there is something to hang up. The page calls this from a
      // timer and from a button, and both can land on a call that has already
      // closed — logging those would fill the account with hang-ups that hung
      // nothing up.
      if (session.current) record('hung-up', reason ?? 'asked to stop, with no reason given');
      session.current?.stop();
      session.current = null;
      // stop() drives onStatus('closed'), which clears detail — so say why after.
      if (reason) setDetail(reason);
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
      );
    }, IDLE_POLL_MS);

    return () => clearInterval(timer);
  }, [status, hangUp]);

  const fail = useCallback((message: string) => {
    setStatus('error');
    setDetail(message);
  }, []);

  const connect = useCallback(async () => {
    record('dialled', `${latest.current.modelKey} · ${latest.current.language}`);
    setTurns([]);
    setDetail(null);
    setMuted(false);
    queue.current.discard();

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
          // Whatever was still queued was said, or was a word away from it.
          // Dropping it silently would lose the end of every conversation.
          for (const item of queue.current.drain()) append('agent', item.text, item.done);
          // The learner's turn is closed by the tutor beginning to answer, so
          // the last thing said before hanging up has nothing to close it. No-op
          // unless one is open, and worth the line: without it the sentence
          // someone ends a call on is the one sentence the pill never shows.
          append('user', '', true);
          session.current = null;
          setTap(null);
          setSpeaking(false);
          setHeard(false);
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
        setSpeaking(next);
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
        setHeard(active);
      },
      // Barge-in. The audio for anything still queued was thrown away unplayed,
      // so showing those words would put sentences on screen that were cut off
      // mid-breath and never spoken.
      onInterrupted: () => {
        record('interrupted', 'the learner talked over the tutor; unheard words were dropped');
        queue.current.discard();
      },
      /*
       * Monotonic, and deliberately not a tally of calls received.
       *
       * The tutor reports a question's *number*, so the highest number seen is
       * the honest reading of how far down the list it has got — a repeated
       * call does not double-count, and one arriving out of order cannot make
       * the counter go backwards under a learner who is watching it. A tutor
       * that skips question three and reports four has, as far as anyone
       * watching a countdown is concerned, dealt with four of them.
       */
      onQuestionAnswered: (number: number) => {
        /*
         * Logged raw, and that is the point of logging it here rather than
         * reading the counter afterwards. `Math.max` is what makes the number
         * safe to show and is also what destroys the evidence: a tutor that
         * reports question three, wanders off and reports it again produces a
         * count that never moved and a lesson that feels like it is being
         * asked twice. The account keeps both reports; the counter keeps the
         * floor.
         */
        const far = answeredFar.current;
        record(
          'answered',
          number > far
            ? `question ${number} reported done`
            : `question ${number} reported done again — the count was already at ${far}`,
        );
        answeredFar.current = Math.max(far, number);
        setAnswered(answeredFar.current);
      },
    };

    try {
      lastActivity.current = Date.now();
      // A new call is a new pass down the list. Reset here rather than on hang
      // up, so the count stays readable on the summary of the call that ended.
      answeredFar.current = 0;
      setAnswered(0);
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
  }, [append, cue, onTranscript, record]);

  const say = useCallback(
    (text: string, label?: string) => {
      const said = label ?? oneLine(text);
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
