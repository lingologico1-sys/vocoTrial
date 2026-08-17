import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio, SlidersHorizontal } from 'lucide-react';
import { startGeminiSession } from '../realtime/gemini';
import { findModel } from '../realtime/models';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import { lastUsedKey, listPresets, rememberPreset, renderPreset } from '../realtime/presets';
import type { AudioTap, SessionStatus, TranscriptDelta, VoiceSession } from '../realtime/types';
import type { FaceKit } from '../facekit/kit';
import { activeKit } from '../facekit/store';
import Stage from './Stage';
import { RevealQueue } from './reveal';
import {
  BROW_LIFT_MAX,
  BROW_LIFT_MIN,
  DEFAULT_BROW_LIFT,
  DEFAULT_CADENCE,
  DEFAULT_HEAD_MOTION,
  DEFAULT_PRESS_TRIGGERS,
  DEFAULT_TILT_ROLL,
  DEFAULT_TILT_TRIGGERS,
  HEAD_MOTIONS,
  MOTION_CADENCES,
  PRESS_TRIGGERS,
  TILT_ROLL_MAX,
  TILT_ROLL_MIN,
  TILT_TRIGGERS,
  type HeadMotion,
  type MotionCadence,
  type PressTrigger,
  type TiltCue,
  type TiltTrigger,
} from './headMotion';
import {
  DEFAULT_ROUNDNESS,
  ROUNDNESS_MODES,
  type MouthDriver,
  type RoundnessMode,
} from './visemes';
import { tailSentences } from './text';

/**
 * The live-model playground.
 *
 * Separate from App.tsx by design. That page is a comparison rig — both models,
 * every knob exposed, everything held constant so the numbers mean something.
 * This one is fixed to a single model and spends its screen on the character
 * instead. The prompt list is the only thing the two share; see presets.ts.
 */

/** The only model this page runs. It is the thing being tried out. */
const MODEL_KEY = 'gemini-native-audio';

/** As App.tsx: audio bills per second of connection, so a forgotten tab costs. */
const IDLE_TIMEOUT_MS = 90_000;
const IDLE_POLL_MS = 5_000;

/** How many sentences stay in the balloon. The rest are still in the log. */
const BUBBLE_SENTENCES = 2;

/**
 * Its own key — this page's picks are not the comparison rig's picks.
 *
 * Versioned so that changing a default can actually reach a browser that has
 * been here before. Saved picks beat defaults, which is right while you are
 * tuning and wrong the moment the tuning is settled and written into the code:
 * without the bump, the only people still seeing the old value are the ones who
 * used the page enough to have an opinion. Bump it when a default moves.
 */
const PREFS_KEY = 'vocotrial.live.v6';

interface Prefs {
  language: string;
  driver: MouthDriver;
  lookaheadMs: number;
  motion: HeadMotion;
  cadence: MotionCadence;
  browBlink: boolean;
  press: PressTrigger[];
  browLift: number;
  tilt: TiltTrigger[];
  tiltRoll: number;
  roundness: RoundnessMode;
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

/**
 * The two ways of driving the mouth, side by side.
 *
 * Switchable while the call is running, because the difference between them is
 * tens of milliseconds of timing — far too small to hold in your head across a
 * reconnect, and obvious the moment you flip between them on the same sentence.
 */
const DRIVERS: Array<{ id: MouthDriver; label: string; hint: string }> = [
  {
    id: 'reactive',
    label: 'Reactive',
    hint: 'An AnalyserNode reads the audio as it plays. Simple, and blind to anything that has not happened yet, so the mouth trails the voice by roughly the width of its analysis window.',
  },
  {
    id: 'scheduled',
    label: 'Scheduled',
    hint: 'The audio is measured before it plays and read back on the clock. Costs nothing in latency and removes some, because a reading can be centred on the instant it describes — or taken from ahead of it.',
  },
];

/** Where animators traditionally place a mouth shape: a frame or two early. */
const MAX_LOOKAHEAD_MS = 150;

/**
 * Enough to lead the sound, once the drawing has been paid for.
 *
 * About 50ms of it buys back the mouth's own lag — the shape eases toward its
 * target with a 35ms time constant, the level attacks over 15ms, and a frame
 * lands whenever it lands. Spend only that and the mouth is merely on time.
 * The remaining 30ms is the anticipation: roughly the frame of lead an animator
 * would draw in by hand, and far inside the margin where a mouth ahead of its
 * voice goes unnoticed. Being early is cheap and being late is not — video
 * leading audio survives past 100ms, lagging is caught around 45ms.
 */
const DEFAULT_LOOKAHEAD_MS = 80;

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

interface Turn {
  role: 'user' | 'agent';
  text: string;
  done: boolean;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  closed: 'Call ended',
  error: 'Error',
};

export default function LiveTrial() {
  const [prefs] = useState(loadPrefs);
  const [language, setLanguage] = useState(prefs.language ?? defaultLanguageCode());
  /**
   * Not in this page's prefs, unlike everything else here: the prompt list and
   * the last pick live in realtime/presets.ts, which the comparison rig writes
   * to as well. A prompt saved over there is offered here, and picking one here
   * is what that page opens on next.
   */
  const [presets] = useState(listPresets);
  const [presetKey, setPresetKey] = useState(lastUsedKey);
  // Scheduled by default: it is the better mouth, and reactive is kept beside
  // it as the thing to compare against rather than the thing to start from.
  const [driver, setDriver] = useState<MouthDriver>(prefs.driver ?? 'scheduled');
  const [lookaheadMs, setLookaheadMs] = useState(prefs.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS);
  // Which evidence decides the lips. Lives with the driver rather than with the
  // head motion: both are about how the sound is read, not about performance.
  const [roundness, setRoundness] = useState<RoundnessMode>(prefs.roundness ?? DEFAULT_ROUNDNESS);
  // Rise by default for the same reason scheduled is: it is the better motion,
  // and swing is kept beside it as the thing to compare against. See HeadMotion
  // on why that stopped being a matter of taste.
  const [motion, setMotion] = useState<HeadMotion>(prefs.motion ?? DEFAULT_HEAD_MOTION);
  // Which way the head goes and how often it goes there are separate questions,
  // so they are separate settings — every combination of the two is legal.
  const [cadence, setCadence] = useState<MotionCadence>(prefs.cadence ?? DEFAULT_CADENCE);
  // Defaulted on, and it is the one setting here that does something while
  // nobody is speaking at all — it rides on the blink, which never stops.
  const [browBlink, setBrowBlink] = useState<boolean>(prefs.browBlink ?? true);
  // A set for the tilt's reason, arrived at from the other direction: these two
  // are not rivals either, and unlike the tilt they cannot even be read as a
  // frequency dial — one lockout covers both ends of a short exchange.
  const [press, setPress] = useState<PressTrigger[]>(prefs.press ?? [...DEFAULT_PRESS_TRIGGERS]);
  // A slider for the lean's reason and one of its own: how far a brow travels
  // depends on how much forehead the portrait wearing it has, so there is no
  // single right answer to write into the file — and every previous attempt to
  // pick one from a comment ended up either invisible or startled.
  const [browLift, setBrowLift] = useState<number>(prefs.browLift ?? DEFAULT_BROW_LIFT);
  // A set rather than a pick: the open question is how many of these at once
  // stops reading as a person, which cannot be asked one at a time.
  const [tilt, setTilt] = useState<TiltTrigger[]>(prefs.tilt ?? [...DEFAULT_TILT_TRIGGERS]);
  // How far it leans is taste rather than a pick, so it is a slider — and live
  // while the call runs, for the lookahead's reason: an angle is judged against
  // the sentence it lands on, and a value you have to reconnect to try is a
  // value you are comparing against a memory.
  const [tiltRoll, setTiltRoll] = useState<number>(prefs.tiltRoll ?? DEFAULT_TILT_ROLL);

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
  const [showLog, setShowLog] = useState(false);
  /**
   * The tap is state, not a ref: the mouth is a component that has to re-run
   * its animation loop when one appears, and a ref would not tell it.
   */
  const [tap, setTap] = useState<AudioTap | null>(null);

  /**
   * The artwork the face wears, authored at /facekit and picked there.
   *
   * Loaded once at mount and never watched for changes: a kit is swapped on the
   * other page, which the user reaches by a link that reloads this one. Polling
   * IndexedDB for a change that cannot happen while this page is open would be
   * work in exchange for nothing. Absent — no kit made, or the selected one
   * deleted — leaves the drawn placeholder in place rather than an empty head.
   */
  const [kit, setKit] = useState<FaceKit | null>(null);

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

  useEffect(() => {
    let live = true;
    activeKit()
      .then((found) => {
        if (live) setKit(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const session = useRef<VoiceSession | null>(null);
  /** Agent words waiting for the audio that carries them. See reveal.ts. */
  const queue = useRef(new RevealQueue());
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          language,
          driver,
          lookaheadMs,
          motion,
          cadence,
          browBlink,
          press,
          browLift,
          tilt,
          tiltRoll,
          roundness,
        } satisfies Prefs),
      );
    } catch {
      // Private browsing. Losing the pick is not worth an error.
    }
  }, [
    language,
    driver,
    lookaheadMs,
    motion,
    cadence,
    browBlink,
    press,
    browLift,
    tilt,
    tiltRoll,
    roundness,
  ]);

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

  useEffect(() => {
    if (status !== 'live') return;

    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < IDLE_TIMEOUT_MS) return;
      hangUp(`Ended automatically after ${IDLE_TIMEOUT_MS / 1000}s with no one talking`);
    }, IDLE_POLL_MS);

    return () => clearInterval(timer);
  }, [status]);

  const connect = async () => {
    setTurns([]);
    setDetail(null);
    setMuted(false);
    queue.current.discard();

    const choice = findLanguage(language) ?? LANGUAGES[0];

    const handlers = {
      onStatus: (next: SessionStatus, message?: string) => {
        setStatus(next);
        setDetail(message ?? null);
        if (next === 'closed' || next === 'error') {
          // Whatever was still queued was said, or was a word away from it.
          // Dropping it silently would lose the end of every conversation.
          for (const item of queue.current.drain()) append('agent', item.text, item.done);
          session.current = null;
          setTap(null);
          setSpeaking(false);
          setHeard(false);
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
       * This page's job is to report that a microphone heard something, and it
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
      const started = await startGeminiSession(handlers, MODEL_KEY, language, {
        instructions: renderPreset(presetKey, choice),
      });
      session.current = started;
      setTap(started.tap ?? null);
    } catch (error) {
      session.current = null;
      setTap(null);
      setStatus('error');
      setDetail(error instanceof Error ? error.message : 'Could not start the session');
    }
  };

  const hangUp = (reason?: string) => {
    session.current?.stop();
    session.current = null;
    // stop() drives onStatus('closed'), which clears detail — so say why after.
    if (reason) setDetail(reason);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    session.current?.setMuted(next);
  };

  const live = status === 'live';
  const busy = status === 'connecting';

  const lastOf = (role: 'user' | 'agent') =>
    [...turns].reverse().find((turn) => turn.role === role)?.text ?? '';
  const agentText = tailSentences(lastOf('agent'), BUBBLE_SENTENCES);
  const userText = tailSentences(lastOf('user'), BUBBLE_SENTENCES);

  const model = findModel(MODEL_KEY);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-5 py-8">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">liveTrial</h1>
            <p className="text-xs text-slate-500">{model?.label ?? MODEL_KEY}</p>
          </div>
          <nav className="flex gap-4 text-xs text-slate-500">
            <a href="/facekit" className="underline-offset-4 hover:underline">
              {kit ? `faceKit · ${kit.name}` : 'faceKit'} →
            </a>
            <a href="/" className="underline-offset-4 hover:underline">
              comparison rig →
            </a>
          </nav>
        </header>

        <Stage
          agentText={agentText}
          userText={userText}
          tap={tap}
          driver={driver}
          lookaheadMs={lookaheadMs}
          roundness={roundness}
          language={language}
          kit={kit}
          motion={motion}
          cadence={cadence}
          browBlink={browBlink}
          press={press}
          heard={heard}
          browLift={browLift}
          tilt={tilt}
          tiltRoll={tiltRoll}
          tiltCue={tiltCue}
          speaking={speaking}
        />

        <fieldset className="rounded-lg border border-slate-800 px-3 pb-2.5 pt-1">
          <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">
            Mouth driver
          </legend>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {DRIVERS.map((option) => (
              <label
                key={option.id}
                title={option.hint}
                className="flex cursor-help items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="radio"
                  name="driver"
                  checked={driver === option.id}
                  // Never disabled: switching mid-sentence is the comparison.
                  onChange={() => setDriver(option.id)}
                  className="accent-sky-500"
                />
                {option.label}
              </label>
            ))}

            {driver === 'scheduled' && (
              <label className="flex min-w-[13rem] flex-1 items-center gap-2 text-xs text-slate-500">
                Lookahead
                <input
                  type="range"
                  min={0}
                  max={MAX_LOOKAHEAD_MS}
                  step={10}
                  value={lookaheadMs}
                  onChange={(event) => setLookaheadMs(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-14 text-right font-mono text-slate-300">{lookaheadMs}ms</span>
              </label>
            )}
          </div>

          {/*
            In this box rather than with the head motion, because it answers the
            driver's kind of question and not the performance's: both of these
            rows are about how the sound is *read*. The driver decides when a
            measurement describes, this decides what is measured.
          */}
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-800/70 pt-2">
            <span className="shrink-0 text-xs text-slate-500">Lips</span>
            {ROUNDNESS_MODES.map((option) => (
              <label
                key={option.id}
                title={option.hint}
                className="flex cursor-help items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="radio"
                  name="roundness"
                  checked={roundness === option.id}
                  onChange={() => setRoundness(option.id)}
                  className="accent-sky-500"
                />
                {option.label}
              </label>
            ))}
          </div>

          {/*
            Said out loud rather than left in the tooltip, because this is the
            one setting on the page whose thresholds have never been checked
            against real audio — and the person flipping it is the only one who
            can check them.
          */}
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            {ROUNDNESS_MODES.find((option) => option.id === roundness)?.hint} The thresholds
            behind the second measurement are reasoned from formant tables and checked against
            synthesised vowels, never against this voice — so listen to French tu, rue, peu or
            German über, schön and watch whether the lips purse or spread.
          </p>
        </fieldset>

        {/*
          Its own fieldset rather than a third control in the driver's, because
          it answers an unrelated question. The driver is about *timing* and is
          judged against the voice; this is about how the head carries the
          performance and is judged on its own. Sharing a box would imply they
          interact, which they do not.
        */}
        {/*
          Two rows, one box — unlike the driver above, which earns a box of its
          own by answering an unrelated question. These two are the same
          question asked along two axes: which way the head goes, and how often
          it goes there. Every pairing is legal, neither is a tuning of the
          other, and separating them into two bordered boxes would suggest they
          were as unrelated as the driver is, which they are not.
        */}
        <fieldset className="space-y-2 rounded-lg border border-slate-800 px-3 pb-2.5 pt-1">
          <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">
            Head motion
          </legend>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-slate-500">Direction</span>
            {HEAD_MOTIONS.map((option) => (
              <label
                key={option.id}
                title={option.hint}
                className="flex cursor-help items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="radio"
                  name="motion"
                  checked={motion === option.id}
                  // Never disabled, for the driver's reason: the comparison is
                  // only worth anything on the same sentence.
                  onChange={() => setMotion(option.id)}
                  className="accent-sky-500"
                />
                {option.label}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-slate-500">Cadence</span>
            {MOTION_CADENCES.map((option) => (
              <label
                key={option.id}
                title={option.hint}
                className="flex cursor-help items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="radio"
                  name="cadence"
                  checked={cadence === option.id}
                  onChange={() => setCadence(option.id)}
                  className="accent-sky-500"
                />
                {option.label}
              </label>
            ))}
          </div>

          {/*
            Checkboxes among radios, which is the row saying what it is: the two
            above are picks between rival answers, and this is a set. The label
            is "Tilt" rather than "Swing" only because Direction already owns
            that word one row up — it is the same rotation, waiting on a signal
            instead of on the volume.
          */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-slate-500">Tilt</span>
            {TILT_TRIGGERS.map((option) => (
              <label
                key={option.id}
                title={option.hint}
                className="flex cursor-help items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={tilt.includes(option.id)}
                  onChange={(event) =>
                    setTilt((current) =>
                      event.target.checked
                        ? [...current, option.id]
                        : current.filter((id) => id !== option.id),
                    )
                  }
                  className="accent-sky-500"
                />
                {option.label}
              </label>
            ))}

            {/*
              Beside the boxes rather than on a row of its own, because it is not
              a fourth trigger — it is how far the ones that are ticked go. Shown
              only when something can fire, for the lookahead's reason one panel
              up: a control over a movement that cannot happen is a control that
              teaches you nothing when you drag it.
            */}
            {tilt.length > 0 && (
              <label
                title="How far the head leans when one of these lands. Small is the useful end: the picture turns about a point well below the face, so a large angle slides the head sideways more than it tips it — which is what reads as odd rather than as a lean."
                className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
              >
                Lean
                <input
                  type="range"
                  min={TILT_ROLL_MIN}
                  max={TILT_ROLL_MAX}
                  step={0.1}
                  value={tiltRoll}
                  onChange={(event) => setTiltRoll(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-10 text-right font-mono text-slate-300">
                  {tiltRoll.toFixed(1)}°
                </span>
              </label>
            )}
          </div>

          {/*
            Both brow settings on one row, in the shape the Tilt row above
            established: the thing that fires the movement, and beside it how far
            the movement goes. The label used to say "Idle", which was true of the
            checkbox alone — the slider governs every brow movement the face makes,
            the blink's included, so a row named after one of them would be naming
            the smaller one.
          */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-slate-500">Brows</span>
            <label
              title="About half of all blinks carry a small brow lift, so the face keeps moving between turns without the head drifting. Untick it to see how still the face is with nobody speaking."
              className="flex cursor-help items-center gap-2 text-sm text-slate-300"
            >
              <input
                type="checkbox"
                checked={browBlink}
                onChange={(event) => setBrowBlink(event.target.checked)}
                className="accent-sky-500"
              />
              Lift with blinks
            </label>

            <label
              title="How far the brows travel at their fullest. A kit only gets as much of this as its brow boxes say there is clear forehead for, so a portrait with a low fringe will stop responding partway up — that is the picture's answer, not the slider's. Drag it to nothing to hear the same sentence with the brows held still."
              className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
            >
              Travel
              <input
                type="range"
                min={BROW_LIFT_MIN}
                max={BROW_LIFT_MAX}
                step={0.5}
                value={browLift}
                onChange={(event) => setBrowLift(Number(event.target.value))}
                className="flex-1 accent-sky-500"
              />
              {/*
                As a share of the head's height rather than in the head units the
                code keeps it in. 200 units is the head, so halving gives percent —
                and percent is the only figure here that means the same thing on
                this stage, on the kit page's zoomed panel, and on whatever size
                the face is drawn at next.
              */}
              <span className="w-10 text-right font-mono text-slate-300">
                {(browLift / 2).toFixed(1)}%
              </span>
            </label>
          </div>

          {/*
            A row of its own, which it earned when it held one box and keeps now
            that it holds two. Every other row here groups settings that answer
            one question — which way, how often, how far — and this answers a
            question none of them ask: whether the mouth is allowed to move for a
            reason other than sound. Folded in beside the brows it would read as
            a third brow setting, and the one thing worth knowing about it is
            that it is the only control on this panel that touches the mouth
            without touching the analyser.

            No travel slider beside it, unlike the two rows above. Those became
            sliders because a constant turned out to be taste; this one has a
            ceiling that is not taste at all — a press that reaches `mbp` is a
            consonant, and there would be nothing above the useful range for the
            slider to offer but that mistake.
          */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-slate-500">Lips</span>
            {PRESS_TRIGGERS.map((option) => (
              <label
                key={option.id}
                title={option.hint}
                className="flex cursor-help items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={press.includes(option.id)}
                  onChange={(event) =>
                    setPress((current) =>
                      event.target.checked
                        ? [...current, option.id]
                        : current.filter((id) => id !== option.id),
                    )
                  }
                  className="accent-sky-500"
                />
                {option.label}
              </label>
            ))}
          </div>

          {/*
            Spelled out rather than left in the tooltip, because the three
            cadences differ in a way their labels cannot carry: two of them are
            distinguished by how *often* they move rather than by how they look
            in any one frame, which is exactly what you cannot see by hovering.
          */}
          <p className="text-xs leading-relaxed text-slate-500">
            {MOTION_CADENCES.find((option) => option.id === cadence)?.hint}
          </p>

          {/*
            Spelled out for the cadence's reason and one sharper than it. These
            triggers cannot be told apart by looking at the face — every one of
            them produces the identical lean, and the only thing separating them
            is which moment it lands on. Watching without knowing what is ticked
            tells you nothing at all.
          */}
          <div className="space-y-1 text-xs leading-relaxed text-slate-500">
            {tilt.length === 0 ? (
              <p>
                No tilt. The head moves only with the loudness of the voice, which is what shipped.
              </p>
            ) : (
              <>
                {TILT_TRIGGERS.filter((option) => tilt.includes(option.id)).map((option) => (
                  <p key={option.id}>
                    <span className="text-slate-400">{option.label}:</span> {option.hint}
                  </p>
                ))}
                {tilt.length > 1 && (
                  <p>
                    All of them share one lockout of about five seconds, so ticking a second does
                    not lean the head twice as often — it changes which moments get the lean, and
                    which get swallowed by one that has just happened.
                  </p>
                )}
              </>
            )}
          </div>

          {/*
            The tilt's argument, owed harder. Two moments, one identical
            movement, and this one is smaller than the lean by some way — so
            watching without knowing what is ticked tells you nothing at all, and
            the last line is here because the most likely reaction to ticking
            both boxes is to wonder whether anything happened.
          */}
          <div className="space-y-1 text-xs leading-relaxed text-slate-500">
            {press.length === 0 ? (
              <p>No press. The mouth moves only with the sound of the tutor’s own voice.</p>
            ) : (
              <>
                {PRESS_TRIGGERS.filter((option) => press.includes(option.id)).map((option) => (
                  <p key={option.id}>
                    <span className="text-slate-400">{option.label}:</span> {option.hint}
                  </p>
                ))}
                {press.length > 1 && (
                  <p>
                    The two sit at either end of your turn and share one lockout of about two
                    seconds, so a short exchange gets one press rather than both — ticking the
                    second changes which end of your turn the face reacts at, not how often it
                    reacts.
                  </p>
                )}
                <p>
                  Expect this to be subtle to the point of deniability. Both poses it moves between
                  are a closed mouth, and on the kit shipped with the app they differ by under a
                  tenth of the pixels in the mouth — a fifth of what changing a vowel does. If you
                  cannot see it, that is the artwork rather than the setting, and the kit page’s
                  motion panel is where to find out which.
                </p>
              </>
            )}
          </div>
        </fieldset>

        <div className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-2.5">
          <Radio
            size={16}
            className={
              live
                ? speaking
                  ? 'animate-pulse text-emerald-400'
                  : 'text-emerald-400'
                : status === 'error'
                  ? 'text-rose-400'
                  : 'text-slate-600'
            }
          />
          <span className="text-sm">{STATUS_LABEL[status]}</span>
          {detail && <span className="truncate text-sm text-slate-500">— {detail}</span>}
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-800 px-3 py-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Practising</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={live || busy}
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
            >
              {LANGUAGES.map((choice) => (
                <option key={choice.code} value={choice.code} className="bg-slate-900">
                  {choice.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-800 px-3 py-2">
            <SlidersHorizontal size={13} className="text-slate-500" />
            <select
              value={presetKey}
              onChange={(event) => {
                setPresetKey(event.target.value);
                rememberPreset(event.target.value);
              }}
              disabled={live || busy}
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
            >
              {presets.map((preset) => (
                <option key={preset.key} value={preset.key} className="bg-slate-900">
                  {preset.builtIn ? preset.label : `${preset.label} · saved`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-3">
          {live ? (
            <>
              <button
                type="button"
                onClick={toggleMute}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-3 text-sm font-medium hover:bg-slate-900"
              >
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                type="button"
                onClick={() => hangUp()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-3 text-sm font-medium hover:bg-rose-500"
              >
                <PhoneOff size={16} />
                End call
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-3 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            >
              <Mic size={16} />
              {busy ? 'Connecting…' : 'Start call'}
            </button>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowLog((open) => !open)}
            className="text-xs text-slate-500 underline-offset-4 hover:underline"
          >
            {showLog ? 'Hide' : 'Show'} full transcript ({turns.length})
          </button>
          {showLog && (
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-800 p-3">
              {turns.length === 0 && <p className="text-sm text-slate-600">Nothing said yet.</p>}
              {turns.map((turn, index) => (
                <div key={index} className={turn.role === 'user' ? 'text-right' : 'text-left'}>
                  <span
                    className={`inline-block max-w-[85%] rounded-xl px-3 py-1.5 text-sm ${
                      turn.role === 'user'
                        ? 'bg-sky-500/15 text-sky-100'
                        : 'bg-slate-800/70 text-slate-200'
                    }`}
                  >
                    {turn.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
