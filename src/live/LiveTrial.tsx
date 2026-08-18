import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Mic, MicOff, PhoneOff, Radio, SlidersHorizontal, User } from 'lucide-react';
import { startGeminiSession } from '../realtime/gemini';
import { findModel } from '../realtime/models';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import { lastUsedKey, listPresets, rememberPreset, renderPreset } from '../realtime/presets';
import { MAX_INSTRUCTIONS, withPersona } from '../realtime/instructions';
import { VOICES } from '../realtime/settings';
import type { AudioTap, SessionStatus, TranscriptDelta, VoiceSession } from '../realtime/types';
import type { FaceKit } from '../facekit/kit';
import { hasPersona } from '../facekit/persona';
import { loadBundledKit } from '../facekit/bundled';
import { listPublished } from '../facekit/library';
import type { PublishedFace } from '../facekit/published';
import { activeKit, publishedKit, selectFace, selectedFace } from '../facekit/store';
import Stage from './Stage';
import { RevealQueue } from './reveal';
import {
  BROW_LIFT_MAX,
  BROW_LIFT_MIN,
  DEFAULT_BROW_LIFT,
  DEFAULT_CADENCE,
  DEFAULT_HEAD_MOTION,
  DEFAULT_LISTEN_NOD,
  DEFAULT_NOD_DEPTH,
  DEFAULT_PRESS_TRIGGERS,
  DEFAULT_TILT_ROLL,
  DEFAULT_TILT_TRIGGERS,
  HEAD_MOTIONS,
  MOTION_CADENCES,
  NOD_DEPTH_MAX,
  NOD_DEPTH_MIN,
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
 * Separate from tutorBench by design. That page is the bench — both models,
 * every knob exposed, everything held constant so the numbers mean something.
 * This one is fixed to a single model and spends its screen on the character
 * instead. The prompt list is the only thing the two share; see presets.ts.
 */

/** The only model this page runs. It is the thing being tried out. */
const MODEL_KEY = 'gemini-native-audio';

/**
 * "a, b and c" — for summaries assembled from whichever boxes are ticked.
 *
 * Generated rather than written down, which is the point: a summary that is
 * composed from the live setting cannot fall out of step with it, and the one
 * defect this panel actually shipped was a sentence that said "the two" while
 * three boxes were ticked. Anything stating a count here should compute it.
 */
function listing(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * A row's reasoning, folded away until it is asked for.
 *
 * The prose under this panel is several times the height of the controls it
 * explains, and none of it is padding — every tilt trigger produces the
 * identical lean, so a reader who skips the text cannot tell from the face
 * which one fired, and the settings teach nothing. Deleting it was never the
 * fix. What was wrong is that all of it arrived at once, in one weight, with
 * nothing tying a paragraph to the row that owned it.
 *
 * So the argument folds and the summary stays: one line saying what the row is
 * doing as it stands, and a control for the reader who wants to know why. The
 * summary is the part that has to be true at a glance, which is why the ones
 * built from ticked boxes are composed by `listing` rather than written out.
 *
 * Open state is per instance and deliberately not persisted. It is a reading
 * aid rather than a setting, and a panel that remembered which of its three
 * arguments you had unfolded last week would be restoring clutter.
 */
function Why({ summary, children }: { summary: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);

  // No control at all when there is nothing behind it — an empty row still gets
  // its summary, and a "Why?" that opened onto nothing would be a broken
  // promise rather than a small one.
  if (!children) {
    return <p className="text-xs leading-relaxed text-slate-500">{summary}</p>;
  }

  return (
    <div className="text-xs leading-relaxed text-slate-500">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span>{summary}</span>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="shrink-0 text-slate-400 underline decoration-dotted underline-offset-2 transition-colors hover:text-slate-200"
        >
          {open ? 'Less' : 'Why?'}
        </button>
      </p>
      {open && (
        <div className="mt-1.5 space-y-1 border-l border-slate-800 pl-3">{children}</div>
      )}
    </div>
  );
}

/** As tutorBench: audio bills per second of connection, so a forgotten tab costs. */
const IDLE_TIMEOUT_MS = 90_000;
const IDLE_POLL_MS = 5_000;

/** How many sentences stay in the balloon. The rest are still in the log. */
const BUBBLE_SENTENCES = 2;

/**
 * Its own key — this page's picks are not tutorBench's picks.
 *
 * Versioned so that changing a default can actually reach a browser that has
 * been here before. Saved picks beat defaults, which is right while you are
 * tuning and wrong the moment the tuning is settled and written into the code:
 * without the bump, the only people still seeing the old value are the ones who
 * used the page enough to have an opinion. Bump it when a default moves.
 */
const PREFS_KEY = 'vocotrial.live.v7';

interface Prefs {
  language: string;
  voice: string;
  persona: boolean;
  driver: MouthDriver;
  lookaheadMs: number;
  motion: HeadMotion;
  cadence: MotionCadence;
  browBlink: boolean;
  press: PressTrigger[];
  browLift: number;
  tilt: TiltTrigger[];
  tiltRoll: number;
  listenNod: boolean;
  nodDepth: number;
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
   * the last pick live in realtime/presets.ts, which tutorBench writes
   * to as well. A prompt saved over there is offered here, and picking one here
   * is what that page opens on next.
   */
  const [presets] = useState(listPresets);
  const [presetKey, setPresetKey] = useState(lastUsedKey);
  /**
   * Which prebuilt voice the tutor speaks in. Empty means Google's default,
   * which is a third state rather than a synonym for whichever name that
   * happens to be today — see settings.ts — so an untouched picker sends no
   * voice field at all rather than pinning one.
   *
   * The only session setting this page offers. It belongs here and not with the
   * rest of the knobs on tutorBench because it is not a knob you tune once and
   * hold constant: the voice is half of who is on screen, and the face beside
   * it is the whole point of the page.
   */
  const [voice, setVoice] = useState<string>(prefs.voice ?? '');
  /**
   * Whether the worn face's own background goes into the prompt.
   *
   * A switch rather than a fixture, and that is the measurement rather than a
   * courtesy: a persona is a block of text competing with the preset for the
   * model's attention, and the question worth answering is whether a tutor
   * still corrects as well while it is being somebody. The same face under the
   * same preset with this off is the control, and `withPersona` is written as a
   * prefix and a suffix precisely so the two runs differ by nothing else.
   *
   * On by default: a kit that carries a persona was given one deliberately, and
   * a face whose backstory silently did nothing would be the more confusing of
   * the two defaults. It does nothing at all on a kit that has none.
   */
  const [persona, setPersona] = useState<boolean>(prefs.persona ?? true);
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

  // The head's one movement during the user's turn. Stored like the rest, and
  // absent from anybody's saved prefs until they touch it — which is what the
  // `??` gives it, and the reason shipping this on does not need PREFS_KEY
  // bumped: there is no stale value for the new default to lose to.
  const [listenNod, setListenNod] = useState<boolean>(prefs.listenNod ?? DEFAULT_LISTEN_NOD);
  const [nodDepth, setNodDepth] = useState<number>(prefs.nodDepth ?? DEFAULT_NOD_DEPTH);

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
   * The artwork the face wears.
   *
   * Resolved once at mount from whatever was last picked — see activeKit — and
   * thereafter only by the picker below, which is the one thing on this page
   * that can change it. Nothing polls: a kit authored on /facekit is reached by
   * a link that reloads this page, and a face published from another machine
   * cannot appear mid-session either. Absent — nothing made, or the selection
   * deleted from the library — leaves the drawn placeholder rather than an
   * empty head.
   */
  const [kit, setKit] = useState<FaceKit | null>(null);

  /**
   * The shared library, and which of it is worn.
   *
   * The listing is names and thumbnails only, so this costs one small request
   * whether the library holds two faces or twenty; the artwork is fetched when
   * a face is actually put on. `bundled` is the deployment's own face, loaded
   * for its thumbnail so the "default" tile can show what it is rather than
   * asserting it — it is also what an empty selection resolves to, so the tile
   * and the fallback are the same face by construction.
   */
  const [faces, setFaces] = useState<PublishedFace[]>([]);
  const [bundled, setBundled] = useState<FaceKit | null>(null);
  const [chosen, setChosen] = useState<string | null>(selectedFace);
  const [swapping, setSwapping] = useState(false);

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
        if (!live) return;
        setKit(found);
        // Only when this browser has no pick of its own to restore. A face's
        // suggested voice is a default, and a default that overrode a saved
        // preference on every reload would not be one — see `wear`, which is
        // the other half of this rule and the case where adopting is right.
        if (!prefs.voice && found?.persona?.voice) setVoice(found.persona.voice);
      })
      .catch(() => undefined);
    listPublished()
      .then((list) => {
        if (live) setFaces(list);
      })
      // A library that cannot be reached leaves the picker holding only the
      // default, which is a smaller page rather than a broken one. Whatever is
      // already worn stays on — activeKit has its own copy by now.
      .catch(() => undefined);
    loadBundledKit()
      .then((found) => {
        if (live) setBundled(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // `prefs` is the one snapshot this page ever reads — useState(loadPrefs)
    // holds it for the lifetime of the component — so naming it here satisfies
    // the rule without making this a mount effect that can run twice.
  }, [prefs]);

  /**
   * Puts a face on, and remembers it for next time.
   *
   * `null` means the deployment's own face, which is what an empty selection
   * already resolves to — so clearing the selection and picking the default are
   * deliberately the same act rather than two states that look alike.
   *
   * The picker is closed while a call is up, so nothing here has to reason
   * about swapping artwork out from under a face that is mid-sentence.
   */
  const wear = useCallback(async (id: string | null) => {
    setSwapping(true);
    try {
      const next = id === null ? await loadBundledKit() : await publishedKit(id);
      selectFace(id);
      setChosen(id);
      setKit(next);
      // Changing face is the one moment a suggested voice should win. The pick
      // being overwritten was made for the face being taken off, and the
      // alternative — a new character in the old character's voice — is the
      // mismatch the field exists to prevent. Silent on a kit with no opinion,
      // and a deliberate pick afterwards still stands.
      if (next?.persona?.voice) setVoice(next.persona.voice);
    } catch {
      // The face on screen is still the one that loaded, which is the better
      // of the two things to be looking at when a fetch fails.
    } finally {
      setSwapping(false);
    }
  }, []);

  /**
   * The faces this picker offers: the finished ones, plus whichever is on.
   *
   * The filter is the whole of what `ready` does. A face reaches the library
   * the moment it is first saved, half its mouths undrawn, because the library
   * is the only place a kit lives — so "in the library" stopped being the same
   * question as "fit to put in front of somebody", and this is where the two
   * come apart.
   *
   * The exception is not a loophole. A draft is worn from faceKit, by the
   * person drawing it, precisely to watch it move before calling it finished;
   * dropping it from the strip the moment they arrived here would take the worn
   * face off the list of faces and leave a picker with nothing highlighted,
   * which reads as a bug rather than as a rule. It is dimmed and labelled
   * instead, and switching away from it is what removes it.
   */
  const offered = useMemo(
    () => faces.filter((face) => face.ready !== false || face.id === chosen),
    [faces, chosen],
  );

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
          voice,
          persona,
          driver,
          lookaheadMs,
          motion,
          cadence,
          browBlink,
          press,
          browLift,
          tilt,
          tiltRoll,
          listenNod,
          nodDepth,
          roundness,
        } satisfies Prefs),
      );
    } catch {
      // Private browsing. Losing the pick is not worth an error.
    }
  }, [
    language,
    voice,
    persona,
    driver,
    lookaheadMs,
    motion,
    cadence,
    browBlink,
    press,
    browLift,
    tilt,
    tiltRoll,
    listenNod,
    nodDepth,
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

  /**
   * What this page would actually send, kept where it can be looked at.
   *
   * Composed here rather than inside `connect` so the length can be checked
   * before the button is pressed instead of by the Worker after it. The server
   * still enforces the ceiling — it has to, it is the only side that can — but
   * its refusal arrives as "instructions are limited to 8000 characters" about
   * a box nobody typed 8000 characters into, because the overflow is the sum of
   * two things chosen on different pages. Adding up in the browser is what lets
   * the message name both halves.
   */
  const composed = useMemo(
    () =>
      withPersona(
        renderPreset(presetKey, findLanguage(language) ?? LANGUAGES[0]),
        persona ? kit?.persona : undefined,
      ),
    [presetKey, language, persona, kit],
  );

  /**
   * The preset's own length, measured rather than derived.
   *
   * It is what the composition would have been with no persona, and the honest
   * way to get it is to render the preset again — subtracting the persona and a
   * constant for the wrapper would put a number here that goes quietly wrong the
   * first time that prose is edited in the other file. Rendering a string twice
   * costs nothing worth protecting.
   */
  const presetChars = useMemo(
    () => renderPreset(presetKey, findLanguage(language) ?? LANGUAGES[0]).length,
    [presetKey, language],
  );
  const tooLong = composed.length > MAX_INSTRUCTIONS;

  const connect = async () => {
    setTurns([]);
    setDetail(null);
    setMuted(false);
    queue.current.discard();

    // Refused here rather than at the socket. Nothing is spent either way — the
    // Worker checks this before it mints anything — but a call that fails at
    // connect looks like the model being unreachable, which is the wrong thing
    // to go and debug.
    if (tooLong) {
      setStatus('error');
      setDetail(
        `That prompt and this persona come to ${composed.length} characters together, and a session takes ${MAX_INSTRUCTIONS}. Shorten the prompt (${presetChars}), shorten the background on faceKit, or switch the persona off.`,
      );
      return;
    }

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
        // The preset decides what the tutor does; the worn face decides who is
        // doing it. Composed at the call rather than held in state so that the
        // prompt cannot go stale against a face swapped since — and composed
        // by a function that leaves the preset's own text untouched, which is
        // what makes a persona-on run comparable with a persona-off one.
        instructions: composed,
        // Absent rather than empty when nothing is picked: the Worker drops a
        // blank, but sending one at all reads as a choice nobody made.
        settings: voice ? { voice } : {},
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
              tutorBench →
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
          listenNod={listenNod}
          nodDepth={nodDepth}
          browLift={browLift}
          tilt={tilt}
          tiltRoll={tiltRoll}
          tiltCue={tiltCue}
          speaking={speaking}
        />

        <fieldset className="rounded-lg border border-slate-800 px-3 pb-2.5 pt-1">
          <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">
            Face
          </legend>
          {/*
            Idle only, unlike the mouth driver two fieldsets down. That one is
            switched mid-sentence on purpose — hearing one voice through two
            drivers back to back is the comparison it exists for. This is the
            opposite case: swapping artwork means a multi-megabyte fetch and a
            whole new set of patches arriving under a mouth that is moving, and
            the comparison it would buy is one you can make just as well between
            two calls.
          */}
          <ul className="flex flex-wrap items-start gap-3 py-1">
            {[null, ...offered].map((face) => {
              const picked = face ? chosen === face.id : chosen === null;
              const thumb = face ? face.thumb : bundled?.base;
              const draft = face?.ready === false;

              return (
                <li key={face?.id ?? 'default'} className="space-y-1 text-center">
                  <button
                    type="button"
                    disabled={live || busy || swapping}
                    onClick={() => void wear(face?.id ?? null)}
                    title={
                      face
                        ? draft
                          ? `Wear ${face.name} — a draft, still being worked on in faceKit`
                          : `Wear ${face.name}, from the shared library`
                        : 'The face this deployment ships with, in public/faces'
                    }
                    className="block disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className={`h-16 w-16 rounded-lg border object-cover ${
                          picked ? 'border-sky-500' : 'border-slate-800 hover:border-slate-600'
                        } ${draft ? 'opacity-60' : ''}`}
                      />
                    ) : (
                      <span
                        className={`flex h-16 w-16 items-center justify-center rounded-lg border text-[10px] text-slate-600 ${
                          picked ? 'border-sky-500' : 'border-slate-800'
                        }`}
                      >
                        none
                      </span>
                    )}
                  </button>
                  <p className="max-w-16 truncate text-[10px] text-slate-500">
                    {face ? face.name : 'default'}
                  </p>
                  {draft && <p className="text-[9px] uppercase tracking-wide text-amber-500">draft</p>}
                </li>
              );
            })}
          </ul>

          {offered.length === 0 && (
            <p className="pb-1 text-[11px] text-slate-500">
              No finished faces in the shared library. Save one from faceKit and mark it
              ready, and it appears here on every browser signed in to this site.
            </p>
          )}
        </fieldset>

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
            <span className="shrink-0 text-xs text-slate-500">Rounding</span>
            {ROUNDNESS_MODES.map((option) => (
              <label
                key={option.id}
                title={roundness === option.id ? undefined : option.hint}
                className={`flex items-center gap-2 text-sm text-slate-300 ${
                  roundness === option.id ? '' : 'cursor-help'
                }`}
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
            The lips are read from the sound rather than from the words, and one number carries
            it: how dark or bright the vowel is. That alone is right about English, which rounds
            only its back vowels — dark and rounded travel together there. The second measurement
            is a second opinion for the vowels that are front and rounded at once, which one
            number leaves stranded in the middle.
          </p>
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
                title={cadence === option.id ? undefined : option.hint}
                className={`flex items-center gap-2 text-sm text-slate-300 ${
                  cadence === option.id ? '' : 'cursor-help'
                }`}
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
                title={tilt.includes(option.id) ? undefined : option.hint}
                className={`flex items-center gap-2 text-sm text-slate-300 ${
                  tilt.includes(option.id) ? '' : 'cursor-help'
                }`}
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
            The one movement on this panel that happens while the tutor is not
            talking, which is why it sits under Tilt rather than beside Direction.
            Those rows are about how the head carries a voice; this is about what
            it does when there is no voice to carry. Same shape as the row above —
            what fires the movement, and beside it how far the movement goes.
          */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-slate-500">Nod</span>
            <label
              title="Dips the head once as you finish speaking — about half a second after your last word, which is when the microphone is sure you have stopped. The only movement on this panel that answers something you did. It used to nod every few seconds while you talked, which is what real listeners do and was distracting to be on the other end of."
              className="flex cursor-help items-center gap-2 text-sm text-slate-300"
            >
              <input
                type="checkbox"
                checked={listenNod}
                onChange={(event) => setListenNod(event.target.checked)}
                className="accent-sky-500"
              />
              As you finish
            </label>

            {listenNod && (
              <label
                title="How far the head dips, as a share of the head's own height. The range stops where the framing does — a deeper nod would lift the top edge of the picture out of frame — and unlike the lean above, the whole of it is meant to be usable."
                className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
              >
                Depth
                <input
                  type="range"
                  min={NOD_DEPTH_MIN}
                  max={NOD_DEPTH_MAX}
                  step={0.5}
                  value={nodDepth}
                  onChange={(event) => setNodDepth(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                {/* As a share of the head's height, for the brow travel's reason. */}
                <span className="w-24 text-right font-mono text-slate-300">
                  {(nodDepth / 2).toFixed(1)}% of head
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
              title="How far the brows travel at their fullest, as a share of the head's own height. A kit only gets as much of this as its brow boxes say there is clear forehead for, so a portrait with a low fringe will stop responding partway up — that is the picture's answer, not the slider's. Drag it to nothing to hear the same sentence with the brows held still."
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
              <span className="w-24 text-right font-mono text-slate-300">
                {(browLift / 2).toFixed(1)}% of head
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
            <span className="w-16 shrink-0 text-xs text-slate-500">Closing</span>
            {PRESS_TRIGGERS.map((option) => (
              <label
                key={option.id}
                title={press.includes(option.id) ? undefined : option.hint}
                className={`flex items-center gap-2 text-sm text-slate-300 ${
                  press.includes(option.id) ? '' : 'cursor-help'
                }`}
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
            The summary carries that much; the hint behind it carries the rest.
          */}
          <Why summary={MOTION_CADENCES.find((option) => option.id === cadence)?.summary}>
            <p>{MOTION_CADENCES.find((option) => option.id === cadence)?.hint}</p>
          </Why>

          {/*
            Spelled out for the cadence's reason and one sharper than it. These
            triggers cannot be told apart by looking at the face — every one of
            them produces the identical lean, and the only thing separating them
            is which moment it lands on. Watching without knowing what is ticked
            tells you nothing at all.
          */}
          <Why
            summary={
              tilt.length === 0
                ? 'No tilt. The head moves only with the loudness of the voice, which is what shipped.'
                : `Leaning on ${listing(
                    TILT_TRIGGERS.filter((option) => tilt.includes(option.id)).map((option) =>
                      option.label.toLowerCase(),
                    ),
                  )}.`
            }
          >
            {tilt.length > 0 && (
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
          </Why>

          {/*
            The tilt's argument, owed harder. Two moments, one identical
            movement, and this one is smaller than the lean by some way — so
            watching without knowing what is ticked tells you nothing at all, and
            the last line is here because the most likely reaction to ticking
            both boxes is to wonder whether anything happened.
          */}
          <Why
            summary={
              press.length === 0
                ? 'No press. The mouth moves only with the sound of the tutor’s own voice.'
                : `Closing ${listing(
                    PRESS_TRIGGERS.filter((option) => press.includes(option.id)).map((option) =>
                      option.label.toLowerCase(),
                    ),
                  )}.`
            }
          >
            {press.length > 0 && (
              <>
                {PRESS_TRIGGERS.filter((option) => press.includes(option.id)).map((option) => (
                  <p key={option.id}>
                    <span className="text-slate-400">{option.label}:</span> {option.hint}
                  </p>
                ))}
                {press.includes('turn') && press.includes('reply') && (
                  <p>
                    Before speaking and As you answer sit at either end of your turn and share one
                    lockout of about two seconds, so a short exchange gets one press rather than
                    both — ticking the second changes which end of your turn the face reacts at,
                    not how often it reacts.
                    {press.includes('waiting') &&
                      ' While waiting is outside that pair rather than a third member of it: it fires in a silence neither of them can reach, so it is the one box here that adds movement instead of moving it.'}
                  </p>
                )}
                <p>
                  Expect this to be subtle to the point of deniability. The two poses it moves
                  between are both a closed mouth, and on the kit shipped with the app they differ
                  by under a tenth of the pixels in the mouth — a fifth of what changing a vowel
                  does. If you cannot see it, that is the artwork rather than the setting, and the
                  kit page’s motion panel is where to find out which.
                </p>
              </>
            )}
          </Why>
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
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Voice</span>
            <select
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
              disabled={live || busy}
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
            >
              {/* Fixed in the setup frame, like the language beside it, so both
                  are locked for the length of a call rather than live. */}
              <option value="" className="bg-slate-900">
                Google default
              </option>
              {VOICES.map((option) => (
                <option key={option.value} value={option.value} className="bg-slate-900">
                  {option.label}
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

          {/*
            Beside the prompt picker rather than among the motion knobs, because
            it belongs to the same sentence: the preset is the job and this is
            who is doing it. Locked while a call is up, like the two pickers
            before it — all three are fixed in the setup frame.
          */}
          <button
            type="button"
            onClick={() => setPersona(!persona)}
            disabled={live || busy || !hasPersona(kit?.persona)}
            title={
              hasPersona(kit?.persona)
                ? 'Puts this face’s own background into the prompt, above the tutor prompt and with rules for using it below. Off is the control: the same face, the same prompt, nobody in particular.'
                : 'This face has no background. Write one on faceKit — it travels with the kit.'
            }
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              persona && hasPersona(kit?.persona)
                ? 'border-slate-700 text-slate-200'
                : 'border-slate-800 text-slate-500'
            } disabled:opacity-40`}
          >
            <User size={13} />
            {hasPersona(kit?.persona)
              ? kit?.persona?.fullName.trim() || 'Persona'
              : 'No persona'}
          </button>
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
              disabled={busy || tooLong}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-3 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            >
              <Mic size={16} />
              {busy ? 'Connecting…' : 'Start call'}
            </button>
          )}
        </div>

        {/*
          Said before the button is pressed as well as after, because the two
          answer different questions: the disabled button asks why it will not
          dial, and `connect` still refuses in case it is reached another way.
          Both name the same two numbers — this is the only screen either half
          of the sum is visible on.
        */}
        {tooLong && !live && (
          <p className="rounded-lg border border-amber-700/70 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            This prompt and this persona come to{' '}
            <span className="tabular-nums">{composed.length}</span> characters together, and a
            session takes {MAX_INSTRUCTIONS}. The prompt is{' '}
            <span className="tabular-nums">{presetChars}</span> of it. Shorten it on tutorBench,
            shorten the background on faceKit, or switch the persona off above.
          </p>
        )}

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
