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
 * LIFTED OUT OF liveTrial RATHER THAN COPIED FOR /eleve. What lives here is not
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
 * conversation. That is what lets liveTrial keep two balloons and a log while
 * /eleve renders one bubble and a pill from the same turns.
 */

/** As tutorBench: audio bills per second of connection, so a forgotten tab costs. */
export const IDLE_TIMEOUT_MS = 90_000;
const IDLE_POLL_MS = 5_000;

export interface Turn {
  role: 'user' | 'agent';
  text: string;
  done: boolean;
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
  connect: () => Promise<void>;
  hangUp: (reason?: string) => void;
  toggleMute: () => void;
  /**
   * Refuse before dialling, in the caller's own words.
   *
   * For the checks a page can make and this cannot — liveTrial's is that the
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

  /** Extends the open turn for that role, or starts a new one. */
  const append = useCallback((role: 'user' | 'agent', text: string, done: boolean) => {
    if (!text && !done) return;
    setTurns((current) => {
      const tail = current.length - 1;
      if (tail >= 0 && current[tail].role === role && !current[tail].done) {
        const next = [...current];
        next[tail] = { ...next[tail], text: next[tail].text + text, done };
        return next;
      }
      return text ? [...current, { role, text, done }] : current;
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

  const hangUp = useCallback((reason?: string) => {
    session.current?.stop();
    session.current = null;
    // stop() drives onStatus('closed'), which clears detail — so say why after.
    if (reason) setDetail(reason);
  }, []);

  useEffect(() => {
    if (status !== 'live') return;

    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < IDLE_TIMEOUT_MS) return;
      hangUp(`Ended automatically after ${IDLE_TIMEOUT_MS / 1000}s with no one talking`);
    }, IDLE_POLL_MS);

    return () => clearInterval(timer);
  }, [status, hangUp]);

  const fail = useCallback((message: string) => {
    setStatus('error');
    setDetail(message);
  }, []);

  const connect = useCallback(async () => {
    setTurns([]);
    setDetail(null);
    setMuted(false);
    queue.current.discard();

    const handlers = {
      onStatus: (next: SessionStatus, message?: string) => {
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
      onInterrupted: () => queue.current.discard(),
    };

    try {
      lastActivity.current = Date.now();
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
  }, [append, cue, onTranscript]);

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
    connect,
    hangUp,
    toggleMute,
    fail,
  };
}
