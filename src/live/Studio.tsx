import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Mic, MicOff, PhoneOff, Radio, SlidersHorizontal, User } from 'lucide-react';
import BuildBadge from '../BuildBadge';
import ReturnButton from '../ReturnButton';
import { findModel } from '../realtime/models';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import { findIn } from '../realtime/presets';
import { usePromptLibrary } from '../realtime/usePromptLibrary';
import PromptEditor from '../PromptEditor';
import SettingsFields from '../SettingsFields';
import { MAX_INSTRUCTIONS, withPersona } from '../realtime/instructions';
import {
  VOICES,
  houseFieldsFor,
  houseSettings,
  type SessionSettings,
} from '../realtime/settings';
import {
  MAX_LESSON_RULES,
  MAX_STYLE_NAME,
  newStyleId,
  type TutorStyle,
} from '../realtime/house';
import { DEFAULT_LESSON_RULES } from '../realtime/tutorPrompt';
import {
  deleteStyle,
  fetchHouse,
  saveLessonRules,
  savePerformance,
  saveStyle,
} from '../realtime/houseStore';
import type { PerformanceProfile } from '../realtime/session';
import type { SessionStatus } from '../realtime/types';
import type { FaceKit } from '../facekit/kit';
import { hasPersona } from '../facekit/persona';
import { loadBundledKit } from '../facekit/bundled';
import { listPublished } from '../facekit/library';
import type { PublishedFace } from '../facekit/published';
import { activeKit, publishedKit, selectFace, selectedFace } from '../facekit/store';
import { useWarmKit } from '../facekit/warm';
import Stage from './Stage';
import { useVoiceCall } from './useVoiceCall';
import {
  BROW_LIFT_MAX,
  BROW_LIFT_MIN,
  CHANCE_MAX,
  CHANCE_MIN,
  DEFAULT_BROW_BLINK,
  DEFAULT_BROW_FLASH_CHANCE,
  DEFAULT_BROW_LIFT,
  DEFAULT_CADENCE,
  DEFAULT_HEAD_MOTION,
  DEFAULT_LISTEN_NOD,
  DEFAULT_NOD_CHANCE,
  DEFAULT_NOD_DEPTH,
  DEFAULT_PRESS_TRIGGERS,
  DEFAULT_SMILE_GAP,
  DEFAULT_SMILE_HOLD,
  DEFAULT_TILT_CHANCE,
  DEFAULT_TILT_ROLL,
  DEFAULT_TILT_SETTLE,
  DEFAULT_TILT_TRIGGERS,
  HEAD_MOTIONS,
  MOTION_CADENCES,
  NOD_DEPTH_MAX,
  NOD_DEPTH_MIN,
  PRESS_TRIGGERS,
  SMILE_GAP_MAX,
  SMILE_GAP_MIN,
  SMILE_HOLD_MAX,
  SMILE_HOLD_MIN,
  TILT_ROLL_MAX,
  TILT_ROLL_MIN,
  TILT_SETTLE_MAX,
  TILT_SETTLE_MIN,
  TILT_TRIGGERS,
  type HeadMotion,
  type MotionCadence,
  type PressTrigger,
  type TiltCue,
  type TiltTrigger,
} from './headMotion';
import {
  DEFAULT_LOOKAHEAD_MS,
  DEFAULT_ROUNDNESS,
  MAX_LOOKAHEAD_MS,
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
const PREFS_KEY = 'vocotrial.live.v8';

interface Prefs {
  language: string;
  voice: string;
  /**
   * The prompt being worked on, and which preset it was written against.
   *
   * The scratch copy, kept for tutorBench's reason and under this page's own
   * key: a half-typed prompt belongs to the tab it was typed in. The *pick* is
   * not in here — that is one shared key, so choosing a prompt on either page
   * is what the other opens on. See usePromptLibrary.
   */
  presetKey: string;
  instructions: string;
  edited: boolean;
  /**
   * The knobs this page publishes as the house profile's turn-taking half.
   *
   * Here rather than only in R2 so that a tuning session survives a reload the
   * way the sliders do — nothing is published until the button is pressed.
   */
  settings: SessionSettings;
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
  tiltSettle: number;
  tiltChance: number;
  listenNod: boolean;
  nodDepth: number;
  nodChance: number;
  browFlashChance: number;
  smileHold: number;
  smileGap: number;
  roundness: RoundnessMode;
}

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

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  closed: 'Call ended',
  error: 'Error',
};

export default function Studio() {
  const [prefs] = useState(loadPrefs);
  const [language, setLanguage] = useState(prefs.language ?? defaultLanguageCode());
  /**
   * The prompt, the shared library it comes out of, and the editing of both.
   *
   * THIS PAGE USED TO ONLY BE ABLE TO PICK. The library has lived in R2 since
   * a prompt written on the bench had to be publishable as a manner from
   * another machine — but studio got a dropdown and no textarea, so the way to
   * shorten an over-long prompt it was about to publish was to go to the bench
   * and come back. Its own warning said so. Both pages mount the same editor
   * over the same hook now, and a prompt edited here is edited everywhere.
   *
   * The list re-reads on focus, so publishing a manner from a prompt written a
   * minute ago on the other page does not require a refresh — see the hook.
   */
  const library = usePromptLibrary({
    language: findLanguage(language) ?? LANGUAGES[0],
    initial: prefs,
  });
  const { presets, presetKey, instructions, edited, error: presetError } = library;
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
   * The rest of the call's knobs: how long it waits, how freely it improvises.
   *
   * NEW HERE, AND THE REASON IS A HOLE RATHER THAN A WISH. A published setup
   * has carried these fields since PerformanceProfile existed, /eleve reads
   * them and sends them, and studio — the only page that writes the profile —
   * never set one. So every lesson ever handed to a class went out with the
   * block empty and ran on Google's defaults, which settings.ts describes as
   * tuned for fluent speakers who do not pause to assemble a clause. They are
   * live on this page's own calls as well as published, which is the point of
   * tuning them here: the setting is judged by listening to it.
   *
   * The voice is deliberately not among them. It belongs to the face rather
   * than to the house, it has its own picker above, and the publish route reads
   * it off the face a teacher chose. See houseSettings.
   */
  const [settings, setSettings] = useState<SessionSettings>(prefs.settings ?? {});
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
  const [browBlink, setBrowBlink] = useState<boolean>(prefs.browBlink ?? DEFAULT_BROW_BLINK);
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
  const [tiltSettle, setTiltSettle] = useState<number>(prefs.tiltSettle ?? DEFAULT_TILT_SETTLE);
  /*
    And how many of its reasons it takes, which is the one setting on this row
    that changes how often the gesture happens rather than what it looks like.

    Three of these now, one per gesture, and they arrived together because the
    complaint was one complaint: a movement that answers an event and never once
    misses is read as a rule about the event rather than as an answer to it. See
    DEFAULT_TILT_CHANCE, DEFAULT_NOD_CHANCE and DEFAULT_BROW_FLASH_CHANCE, which
    argue it three times because the three gestures fail it differently.
  */
  const [tiltChance, setTiltChance] = useState<number>(prefs.tiltChance ?? DEFAULT_TILT_CHANCE);

  // The head's one movement during the user's turn. Stored like the rest, and
  // absent from anybody's saved prefs until they touch it — which is what the
  // `??` gives it, and the reason shipping this on does not need PREFS_KEY
  // bumped: there is no stale value for the new default to lose to.
  const [listenNod, setListenNod] = useState<boolean>(prefs.listenNod ?? DEFAULT_LISTEN_NOD);
  const [nodDepth, setNodDepth] = useState<number>(prefs.nodDepth ?? DEFAULT_NOD_DEPTH);
  const [nodChance, setNodChance] = useState<number>(prefs.nodChance ?? DEFAULT_NOD_CHANCE);
  const [browFlashChance, setBrowFlashChance] = useState<number>(
    prefs.browFlashChance ?? DEFAULT_BROW_FLASH_CHANCE,
  );

  /*
    The mouth's other movement that is not speech, and the only pair on this
    panel that tunes something this page cannot show you.

    The stage below never smiles: `smiling` is computed from where a lesson has
    got to, which is a thing the student page knows and the workshop does not.
    That is not an argument for hiding these — the values travel with a published
    setup like every other dial here, and a face that greeted a learner and then
    froze for ten minutes was the bug that produced them. It is an argument for
    saying so, which the note under the sliders does.
  */
  const [smileHold, setSmileHold] = useState<number>(prefs.smileHold ?? DEFAULT_SMILE_HOLD);
  const [smileGap, setSmileGap] = useState<number>(prefs.smileGap ?? DEFAULT_SMILE_GAP);

  /*
    The fifteen controls the Head motion fieldset owns, gathered so it can be put
    back. Listed in the order the panel shows them rather than the order Prefs
    declares them, so that adding a row and forgetting it here is a discrepancy
    visible from the row itself.

    Compared as sets where the setting is a set. Unticking a box and reticking it
    leaves the same triggers in a different array order, and a Reset that stayed
    lit through that would be reporting on a literal rather than on the face.
  */
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));

  const motionAtDefaults =
    motion === DEFAULT_HEAD_MOTION &&
    cadence === DEFAULT_CADENCE &&
    browBlink === DEFAULT_BROW_BLINK &&
    browLift === DEFAULT_BROW_LIFT &&
    browFlashChance === DEFAULT_BROW_FLASH_CHANCE &&
    sameSet(press, DEFAULT_PRESS_TRIGGERS) &&
    listenNod === DEFAULT_LISTEN_NOD &&
    nodDepth === DEFAULT_NOD_DEPTH &&
    nodChance === DEFAULT_NOD_CHANCE &&
    sameSet(tilt, DEFAULT_TILT_TRIGGERS) &&
    tiltRoll === DEFAULT_TILT_ROLL &&
    tiltSettle === DEFAULT_TILT_SETTLE &&
    tiltChance === DEFAULT_TILT_CHANCE &&
    smileHold === DEFAULT_SMILE_HOLD &&
    smileGap === DEFAULT_SMILE_GAP;

  const resetMotion = () => {
    setMotion(DEFAULT_HEAD_MOTION);
    setCadence(DEFAULT_CADENCE);
    setBrowBlink(DEFAULT_BROW_BLINK);
    setBrowLift(DEFAULT_BROW_LIFT);
    setBrowFlashChance(DEFAULT_BROW_FLASH_CHANCE);
    setPress([...DEFAULT_PRESS_TRIGGERS]);
    setListenNod(DEFAULT_LISTEN_NOD);
    setNodDepth(DEFAULT_NOD_DEPTH);
    setNodChance(DEFAULT_NOD_CHANCE);
    setTilt([...DEFAULT_TILT_TRIGGERS]);
    setTiltRoll(DEFAULT_TILT_ROLL);
    setTiltSettle(DEFAULT_TILT_SETTLE);
    setTiltChance(DEFAULT_TILT_CHANCE);
    setSmileHold(DEFAULT_SMILE_HOLD);
    setSmileGap(DEFAULT_SMILE_GAP);
  };

  const [showLog, setShowLog] = useState(false);
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
   * Warmed here as on the student page, and for the same reason — see warm.ts.
   * The bench swaps faces mid-session, so this is keyed on the kit rather than
   * done once at load.
   */
  useWarmKit(kit);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          language,
          voice,
          presetKey,
          instructions,
          edited,
          settings,
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
          tiltSettle,
          tiltChance,
          listenNod,
          nodDepth,
          nodChance,
          browFlashChance,
          smileHold,
          smileGap,
          roundness,
        } satisfies Prefs),
      );
    } catch {
      // Private browsing. Losing the pick is not worth an error.
    }
  }, [
    language,
    voice,
    presetKey,
    instructions,
    edited,
    settings,
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
    tiltSettle,
    tiltChance,
    listenNod,
    nodDepth,
    nodChance,
    browFlashChance,
    smileHold,
    smileGap,
    roundness,
  ]);

  /**
   * What this page would actually send, kept where it can be looked at.
   *
   * Composed here rather than inside `connect` so the length can be checked
   * before the button is pressed instead of by the Worker after it. The server
   * still enforces the ceiling — it has to, it is the only side that can — but
   * its refusal arrives as "instructions are limited to 8000 characters" about
   * a box nobody typed 8000 characters into, because the overflow is the sum of
   * three things chosen on three different pages. Adding up in the browser is
   * what lets the message name all of them.
   *
   * NO LESSON IS COMPOSED IN HERE ANY MORE. A question list used to be picked
   * on this page and appended, because this page published. It does not, and a
   * lesson belongs to the teacher who wrote it — so what a call on this page
   * runs is the manner and the face, which is exactly what this page is for
   * tuning. The publish route does the same composition with the lesson added;
   * see `composeTutorPrompt` in tutorPrompt.ts.
   */
  const composed = useMemo(
    () => withPersona(instructions, persona ? kit?.persona : undefined),
    [instructions, persona, kit],
  );

  /**
   * The prompt's own length, which is now simply the length of the box.
   *
   * It used to be a second render of the preset, because the box did not exist
   * and the only way to ask what the composition would have been without the
   * persona was to compose it again. What is typed is what is spent now, so the
   * honest number is the one under the textarea.
   */
  const presetChars = instructions.length;
  const tooLong = composed.length > MAX_INSTRUCTIONS;

  /**
   * The call itself, which this page no longer runs by hand.
   *
   * Everything from the socket to the reveal queue moved into useVoiceCall when
   * /eleve needed the same behaviour — see the header there on why that was a
   * lift rather than a copy. What stays here is the half that is about this
   * page: which prompt, which voice, and the refusal below.
   */
  const call = useVoiceCall({
    modelKey: MODEL_KEY,
    language,
    // The preset decides what the tutor does; the worn face decides who is
    // doing it. Composed at the call rather than held in state so that the
    // prompt cannot go stale against a face swapped since — and composed by a
    // function that leaves the preset's own text untouched, which is what makes
    // a persona-on run comparable with a persona-off one.
    instructions: composed,
    // The voice is absent rather than empty when nothing is picked: the Worker
    // drops a blank, but sending one at all reads as a choice nobody made. The
    // rest are the knobs this page publishes, sent on this page's own calls for
    // the reason they are tuned here at all — a turn-taking setting is judged
    // by hearing it, not by reading the number back.
    settings: { ...settings, ...(voice ? { voice } : {}) },
  });
  const { status, detail, turns, tap, speaking, heard, muted, tiltCue, live, busy } = call;

  /*
    Both sources of a lean funnel into one piece of state, because Face keys on
    the cue's *identity* rather than on anything inside it — two props racing to
    be that identity is a bug waiting for a call that ends mid-drag. The call's
    own cues pass through untouched, and the button below writes one of its own
    against a counter that cannot collide with them.
  */
  const [leanCue, setLeanCue] = useState<TiltCue | null>(null);
  useEffect(() => {
    if (tiltCue) setLeanCue(tiltCue);
  }, [tiltCue]);
  const probes = useRef(0);
  const { hangUp, toggleMute } = call;

  /**
   * What this page publishes now, which is not a lesson.
   *
   * PUBLISHING TO STUDENTS MOVED TO /teach. What stays here are the two things
   * a teacher cannot supply and this page is the only one that can: the manner
   * a tutor talks in, which is whatever is in the prompt box, and the
   * performance profile — the sliders, plus the turn-taking knobs beside the
   * prompt. Both go to R2 as the house library, and the publish route spends
   * them. See house.ts.
   *
   * THE EVALUATOR PICKER WENT WITH IT. A scale is part of what a student is
   * handed, and what a student is handed is now assembled on /teach — so this
   * page no longer needs to know which scale exists.
   */
  /** The language the preset renders against — the page's own picker. */
  const styleLanguage = findLanguage(language) ?? LANGUAGES[0];

  const [houseStyles, setHouseStyles] = useState<TutorStyle[]>([]);
  const [housePerformance, setHousePerformance] = useState(false);
  const [styleName, setStyleName] = useState('');
  const [housing, setHousing] = useState(false);
  const [houseNote, setHouseNote] = useState('');
  const [houseError, setHouseError] = useState('');
  /**
   * The lesson rules as the box has them, and as the house last stored them.
   *
   * TWO PIECES OF STATE FOR ONE STRING, because the question the panel has to
   * answer is not "what does it say" but "is this what would be published".
   * `lessonRules` is what has been typed; `savedLessonRules` is what a lesson
   * published this second would carry. Null there means nobody has ever written
   * one, which is a different thing from a block somebody cleared — and both
   * compose the same prompt, so the panel is the only place the difference is
   * visible.
   *
   * The box opens on the build’s own text when the house has none, rather than
   * on emptiness. An administrator rewriting this is editing a paragraph, not
   * composing one from nothing, and handing them a blank textarea for a block
   * whose current contents are three screens away in a source file is handing
   * them a way to lose it.
   */
  const [lessonRules, setLessonRules] = useState(DEFAULT_LESSON_RULES);
  const [savedLessonRules, setSavedLessonRules] = useState<string | null>(null);

  const loadHouse = () => {
    void fetchHouse().then((house) => {
      setHouseStyles(house.styles);
      setHousePerformance(house.performance !== null);
      setSavedLessonRules(house.lessonRules);
      setLessonRules(house.lessonRules?.trim() || DEFAULT_LESSON_RULES);
      if (house.error) setHouseError(house.error);
    });
  };

  useEffect(loadHouse, []);

  /**
   * The sliders on this page, as a profile.
   *
   * Gathered at the press rather than held in state, for the reason `composed`
   * above is composed at the call: a copy kept in step by hand is a copy that
   * eventually is not, and every one of these already has a piece of state
   * driving a control.
   */
  const currentPerformance = (): PerformanceProfile => ({
    // The turn-taking half, spread first and picked rather than spread whole:
    // the voice is the face's, not the house's. Unset fields are left out
    // rather than stored as undefined — see houseSettings.
    ...houseSettings(settings),
    driver,
    lookaheadMs,
    roundness,
    motion,
    cadence,
    browBlink,
    press,
    browLift,
    tilt,
    tiltRoll,
    tiltSettle,
    tiltChance,
    listenNod,
    nodDepth,
    nodChance,
    browFlashChance,
    smileHold,
    smileGap,
  });

  const saveHousePerformance = async () => {
    setHousing(true);
    setHouseNote('');
    setHouseError('');
    try {
      await savePerformance(currentPerformance());
      setHousePerformance(true);
      setHouseNote('Saved. The next lesson published carries this tuning.');
    } catch (error) {
      setHouseError(error instanceof Error ? error.message : 'Could not save that');
    } finally {
      setHousing(false);
    }
  };

  /**
   * Writes the lesson rules, or puts the build’s own text back.
   *
   * RESTORING IS A SAVE OF THE DEFAULT TEXT, not a delete, and the difference
   * matters on the next publish rather than here: a stored block that happens
   * to equal `DEFAULT_LESSON_RULES` composes the same prompt as no block at
   * all, so the two are indistinguishable to a student and only one of them
   * needs a route. What it costs is that a deployment which restores stays
   * pinned to today’s text — a later build that rewrites the default will not
   * reach it. That is the same bargain every published style already makes, and
   * the panel says so.
   */
  const publishLessonRules = async (text: string) => {
    setHousing(true);
    setHouseNote('');
    setHouseError('');
    try {
      const written = await saveLessonRules(text);
      setSavedLessonRules(written);
      setLessonRules(written || DEFAULT_LESSON_RULES);
      setHouseNote('Saved. The next lesson published carries these rules.');
    } catch (error) {
      setHouseError(error instanceof Error ? error.message : 'Could not save that');
    } finally {
      setHousing(false);
    }
  };

  const publishStyle = async () => {
    setHousing(true);
    setHouseNote('');
    setHouseError('');
    try {
      const written = await saveStyle({
        id: newStyleId(),
        name: styleName.trim(),
        note: '',
        // What is in the box, which is what was tried on this page's own calls.
        text: instructions,
        language: styleLanguage.code,
        // And the key as well, when it names a built-in *and nobody has typed
        // over it*. A built-in is not in a browser store — it is in the bundle
        // and in the Worker — so publishing can render the manner again for the
        // language of the lesson going out. An edited one has to send nothing:
        // the key would re-render the built-in's own words at publish and throw
        // the edit away, silently, on somebody else's lesson. A saved prompt
        // sends nothing either, and stays in the language it was written in.
        preset: findIn(presets, presetKey)?.builtIn && !edited ? presetKey : undefined,
      });
      setStyleName('');
      setHouseNote(`Published “${written.name}”. Teachers can pick it on /teach.`);
      loadHouse();
    } catch (error) {
      setHouseError(error instanceof Error ? error.message : 'Could not publish that');
    } finally {
      setHousing(false);
    }
  };

  const removeStyle = async (id: string) => {
    setHousing(true);
    setHouseNote('');
    setHouseError('');
    try {
      await deleteStyle(id);
      loadHouse();
    } catch (error) {
      setHouseError(error instanceof Error ? error.message : 'Could not delete that');
    } finally {
      setHousing(false);
    }
  };

  const connect = () => {
    // Refused here rather than at the socket. Nothing is spent either way — the
    // Worker checks this before it mints anything — but a call that fails at
    // connect looks like the model being unreachable, which is the wrong thing
    // to go and debug. It is refused in the page rather than in the hook
    // because the message has to name both halves of the overflow, and only
    // this page knows there are two.
    if (tooLong) {
      call.fail(
        `That prompt and this persona come to ${composed.length} characters together, and a session takes ${MAX_INSTRUCTIONS}. Shorten the prompt (${presetChars}), shorten the background on faceKit, or switch the persona off.`,
      );
      return;
    }
    void call.connect();
  };

  const lastOf = (role: 'user' | 'agent') =>
    [...turns].reverse().find((turn) => turn.role === role)?.text ?? '';
  const agentText = tailSentences(lastOf('agent'), BUBBLE_SENTENCES);
  const userText = tailSentences(lastOf('user'), BUBBLE_SENTENCES);

  const model = findModel(MODEL_KEY);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <BuildBadge look="workshop" />
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-5 pb-8 pt-12">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">studio</h1>
            <p className="text-xs text-slate-500">{model?.label ?? MODEL_KEY}</p>
          </div>
          <nav className="flex items-center gap-4 text-xs text-slate-500">
            <a href="/facekit" className="underline-offset-4 hover:underline">
              {kit ? `faceKit · ${kit.name}` : 'faceKit'} →
            </a>
            <ReturnButton look="workshop" />
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
          nodChance={nodChance}
          browLift={browLift}
          browFlashChance={browFlashChance}
          tilt={tilt}
          tiltRoll={tiltRoll}
          tiltSettle={tiltSettle}
          tiltChance={tiltChance}
          tiltCue={leanCue}
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
              No faces on offer from the shared library. Save one from faceKit with
              &ldquo;Show in studio&rdquo; ticked, and it appears here on every browser
              signed in to this site.
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

            {/*
              Beside Lean rather than under it, because they are the two halves
              of one gesture — how far it goes and how long it takes to get
              there. The readout gives both ends of the movement, since the
              number being dragged is only the arrival and the departure is the
              half that was ever complained about.
            */}
            {tilt.length > 0 && (
              <label
                title="How long the head takes to reach the lean. The return is always slower — a tilt that unwinds faster than it arrived reads as the head being dropped rather than lifted — so this drags both, at a fixed ratio. It does not change how long the lean is held, which is what makes it a pose rather than a beat."
                className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
              >
                Settle
                <input
                  type="range"
                  min={TILT_SETTLE_MIN}
                  max={TILT_SETTLE_MAX}
                  step={0.05}
                  value={tiltSettle}
                  onChange={(event) => setTiltSettle(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-20 text-right font-mono text-slate-300">
                  {tiltSettle.toFixed(2)}/{(tiltSettle * 1.6).toFixed(2)}s
                </span>
              </label>
            )}

            {/*
              And how many of the ticked events actually get one, which is the
              only control on this row that changes the gesture's frequency
              rather than its shape.

              Hidden when `waiting` is the only box ticked, and that is the same
              rule as the two sliders above rather than an exception to it. This
              governs the three triggers that answer a conversation event; the
              waiting lean answers a clock and is deliberately left alone — see
              DEFAULT_TILT_CHANCE. With only that one on, this would be a slider
              with nothing under it, which is the thing the comment above refuses.
            */}
            {tilt.some((id) => id !== 'waiting') && (
              <label
                title="How many of the ticked events actually lean the head, rolled per event. Below 100% the same question sometimes gets a tilt and sometimes does not, which is what stops the movement reading as a rule about question marks. Waiting is not counted here — that one leans on its own jittered clock and already happens only sometimes."
                className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
              >
                How often
                <input
                  type="range"
                  min={CHANCE_MIN}
                  max={CHANCE_MAX}
                  step={0.05}
                  value={tiltChance}
                  onChange={(event) => setTiltChance(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-24 text-right font-mono text-slate-300">
                  {Math.round(tiltChance * 100)}% of events
                </span>
              </label>
            )}

            {/*
              The two sliders above govern a gesture that will not happen while
              you are looking at them: the trigger this ships on needs a live
              call to say anything, and the other three are rare by design. A
              button is the difference between tuning this and waiting for it.
            */}
            {tilt.length > 0 && (
              <button
                type="button"
                onClick={() => setLeanCue({ kind: 'probe', seq: (probes.current += 1) })}
                title="Leans the head once, now, whatever is ticked above and whether or not a call is running. Nothing happens while a lean is already playing — a gesture cannot be restarted part-way without the jump these sliders exist to keep out of it — so wait for it to finish and click again."
                className="shrink-0 cursor-pointer rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
              >
                Fire one
              </button>
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
              title="Dips the head as you finish speaking — about half a second after your last word, which is when the microphone is sure you have stopped. The only movement on this panel that answers something you did. Not on every answer: how many is the slider beside this, and the reason it is not all of them is that a nod which never once misses stops reading as agreement. It used to nod every few seconds while you talked, which is what real listeners do and was distracting to be on the other end of."
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

            {listenNod && (
              <label
                title="How many finished answers actually get one, rolled once per answer. At 100% the head dips at the end of every single thing you say, which is what this shipped as and what it was changed for — a nod that never fails to happen is not agreement, it is punctuation. Nothing is spent on an answer the roll declines, so the next one is a fresh chance."
                className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
              >
                How often
                <input
                  type="range"
                  min={CHANCE_MIN}
                  max={CHANCE_MAX}
                  step={0.05}
                  value={nodChance}
                  onChange={(event) => setNodChance(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-24 text-right font-mono text-slate-300">
                  {Math.round(nodChance * 100)}% of answers
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
              title="Some blinks carry a small brow lift, so the face keeps moving between turns without the head drifting. How many of them is the slider beside this. Untick it to see how still the face is with nobody speaking."
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

            {/*
              Between the tick and the travel, which is the row's own order: what
              fires the movement, then how often, then how far. The nod and the
              tilt rows above now read the same way.
            */}
            {browBlink && (
              <label
                title="How many blinks carry the lift, rolled per blink. This shipped at half, which put a flash every eight seconds forever — slow enough to seem unplanned for a minute and no longer. A quarter is roughly one every sixteen seconds and, more to the point, at no interval you can hold: some blinks pass bare, then two in a row carry one."
                className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
              >
                How often
                <input
                  type="range"
                  min={CHANCE_MIN}
                  max={CHANCE_MAX}
                  step={0.05}
                  value={browFlashChance}
                  onChange={(event) => setBrowFlashChance(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-24 text-right font-mono text-slate-300">
                  {Math.round(browFlashChance * 100)}% of blinks
                </span>
              </label>
            )}

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
            The smile, which is a row rather than a checkbox because the question
            it answers is not whether but for how long.

            It sits under the press for the reason the press sits apart from the
            brows: these are the two things the mouth does with no sound behind
            them, and they are now the same argument twice. The difference worth
            seeing from the panel is that the press is a maintenance movement a
            silent face can make honestly, while the smile is an expression — so
            the press gets a box you tick and the smile gets a leash you shorten.

            Seconds, not milliseconds, and no unit conversion in the readout.
            Every other slider here is a shape and reads as a percentage or an
            angle; these two are durations, and a duration is the one quantity on
            this panel you can check against the face with your own eyes.
          */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-slate-500">Smile</span>
            <label
              title="How long the tutor wears its smile once it arrives — before the first word of a call and after its goodbye. It then lets it go and waits with the neutral face, which is where blinking and the waiting press live. Zero is no smile at all."
              className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
            >
              Held for
              <input
                type="range"
                min={SMILE_HOLD_MIN}
                max={SMILE_HOLD_MAX}
                step={0.5}
                value={smileHold}
                onChange={(event) => setSmileHold(Number(event.target.value))}
                className="flex-1 accent-sky-500"
              />
              <span className="w-24 text-right font-mono text-slate-300">
                {smileHold === 0 ? 'never' : `${smileHold.toFixed(1)}s`}
              </span>
            </label>

            {/*
              Hidden at a hold of zero, which is the tilt's rule about `waiting`
              applied to a pair instead of a row: with no smile to wear there is
              nothing for a gap between smiles to space out, and a live slider
              under a dead one is a control that does nothing you can see.
            */}
            {smileHold > 0 && (
              <label
                title="How long the face waits before smiling again through a silence nobody is filling — jittered, like every other schedule here. This is the one movement on the face with no cause in the conversation at all, which is why it is spaced three times further apart than anything else. Zero is one smile per moment and no repeat."
                className="flex min-w-[11rem] flex-1 cursor-help items-center gap-2 text-xs text-slate-500"
              >
                Again every
                <input
                  type="range"
                  min={SMILE_GAP_MIN}
                  max={SMILE_GAP_MAX}
                  step={5}
                  value={smileGap}
                  onChange={(event) => setSmileGap(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-24 text-right font-mono text-slate-300">
                  {smileGap === 0 ? 'once only' : `${smileGap}s`}
                </span>
              </label>
            )}
          </div>

          {/*
            Owed harder than the tilt's or the press's, because those two govern
            a gesture you could at least catch by watching long enough. This one
            governs a gesture that cannot happen on this page at all.
          */}
          <Why
            summary={
              smileHold === 0
                ? 'No smile. The tutor meets a learner with the same face it wears between sentences.'
                : smileGap === 0
                  ? `Smiling for ${smileHold.toFixed(1)}s at each end of a call, once.`
                  : `Smiling for ${smileHold.toFixed(1)}s at each end of a call, then again every ${smileGap}s of quiet.`
            }
          >
            <p>
              The stage above will not show you this. A smile is worn where a lesson is — before
              the tutor's first word and after its goodbye — and this page has no lesson, so the
              face here never wears one whatever these say. The student page is where to judge it,
              and these values travel there with a published setup.
            </p>
            {smileHold > 0 && (
              <p>
                What the hold buys is what happens after it. The smile paints over the resting
                mouth at full strength, so while it is worn nothing else the mouth does is visible
                — including the waiting press, which is the only movement a silent face is allowed.
                Letting the smile go is what uncovers it.
              </p>
            )}
            {smileHold > 0 && smileGap > 0 && (
              <p>
                The repeat is the one thing on this face that moves with nothing in the
                conversation to answer, which is the test every other idle movement here was
                refused for. It is set far apart on purpose. Drag it to zero if you would rather the
                tutor greeted a learner once and then simply waited.
              </p>
            )}
          </Why>

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
                    {tilt.includes('waiting') &&
                      ' Waiting is outside that rather than a fourth member of it: it fires six seconds into a silence none of the others can reach, so it is the one box here that adds movement instead of relocating it.'}
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

          {/*
            Fifteen controls, and no way back from them but this.

            They are not thirteen independent settings. The lockouts, schedules
            and odds in headMotion.ts are picked against one another — the
            flash's quarter against the blink's four seconds, the tilt's five
            against the nod's three and a half, and the three rates against each
            other so that no two gestures come due together — so a panel dragged
            around for twenty minutes is
            not a set of separable mistakes to undo one at a time. It is a face
            that has stopped demonstrating anything, and the defaults are the one
            configuration this repo actually argues for.

            Disabled when there is nothing to undo, which makes it a readout as
            much as a control. On a fieldset this size "have I changed anything"
            is a real question, and answering it otherwise means ten comparisons
            against constants that are not on screen.
          */}
          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              onClick={resetMotion}
              disabled={motionAtDefaults}
              title="Puts every control in this fieldset back to the value the code ships with — direction, cadence, brows, lips, tilt and nod, rates included. Nothing outside it moves: the artwork, the mouth driver and the language are left where they are."
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:border-slate-800 disabled:text-slate-600 disabled:hover:border-slate-800 disabled:hover:text-slate-600"
            >
              {motionAtDefaults ? 'At defaults' : 'Reset to defaults'}
            </button>
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

          {/*
            Beside the voice rather than among the motion knobs, because it
            belongs to the same sentence: the prompt below is the job and this
            is who is doing it. Locked while a call is up, like the picker
            before it — both are fixed in the setup frame.
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

        {/*
          The prompt and the call's own knobs, folded away.

          A <details> rather than an always-open box for the reason this page
          is laid out the way it is: the face is what studio is looked at for,
          and a ten-row textarea permanently between the pickers and the dial
          button would push it off the screen. Open is where a prompt is
          written; shut is the normal state of a page you are watching a face
          on.

          THE KNOBS BESIDE IT ARE THE ONES THIS PAGE PUBLISHES. Every field
          here goes into the house profile when the button below is pressed,
          which is why they sit with the prompt rather than with the sliders:
          the sliders are how a face moves and these are how a call is
          conducted. See houseSettings, and house.ts on the asymmetry.
        */}
        <details className="rounded-lg border border-slate-800">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs uppercase tracking-wide text-slate-500 hover:text-slate-400">
            <SlidersHorizontal size={13} />
            Prompt &amp; call
            <span className="ml-auto normal-case tracking-normal text-slate-600">
              {presets.find((option) => option.key === presetKey)?.label ?? 'Custom'}
              {edited && ' (edited)'}
            </span>
          </summary>

          <div className="border-t border-slate-800 px-3 py-3">
            <PromptEditor library={library} disabled={live || busy} />

            {/*
              Said only when the library could not be read, and it says what is
              still on offer: the five built-ins are in the bundle, so the
              picker is short rather than broken, and a manner published from
              one of them is a perfectly ordinary manner.
            */}
            {presetError && (
              <p className="mt-1.5 text-[11px] text-amber-500">
                {presetError}. Only the built-in prompts are listed.
              </p>
            )}

            <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] uppercase tracking-wide text-slate-500">
              How the call is conducted
            </p>
            <SettingsFields
              fields={model ? houseFieldsFor(model) : []}
              settings={settings}
              onSettings={setSettings}
              disabled={live || busy}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Live on this page&rsquo;s own calls, and published with the tuning below. The voice
              is not among them — it belongs to the face a teacher picks, not to the house.
            </p>
          </div>
        </details>

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
          Both name the same numbers — this is the only screen the sum is
          visible on.
        */}
        {tooLong && !live && (
          <p className="rounded-lg border border-amber-700/70 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            This prompt and this persona come to{' '}
            <span className="tabular-nums">{composed.length}</span> characters together, and a
            session takes {MAX_INSTRUCTIONS}. The prompt is{' '}
            <span className="tabular-nums">{presetChars}</span> of it. Shorten it in the box
            above, shorten the background on faceKit, or switch the persona off. A published
            lesson adds its questions on top of this, so a prompt near the ceiling here leaves a
            teacher no room.
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

        {/*
          What this page gives every teacher.

          PUBLISHING TO STUDENTS USED TO LIVE HERE, and it moved to /teach. The
          reason was never that this was the wrong place to press a button — it
          was that publishing needs a lesson, and writing a lesson is a
          teacher's weekly job on a page with no live socket on it. What is left
          behind is the half a teacher genuinely cannot supply: the manner the
          tutor talks in, and the tuning that makes a face look like a person.
          Both go to R2 and are spent server-side at publish. See house.ts.

          A SAVE HERE REACHES THE NEXT PUBLISH, NOT THE NEXT CALL. Setups
          already handed out carry a flattened copy of whatever these were at
          the time — session.ts's rule, that what was handed out stays handed
          out — so retuning cannot reach a class mid-lesson.
        */}
        <fieldset className="rounded-lg border border-slate-800 px-3 pb-3 pt-1">
          <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">
            The house
          </legend>

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveHousePerformance()}
              disabled={housing}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-40"
            >
              Save this tuning as the house default
            </button>
            <span className="text-[11px] text-slate-500">
              {housePerformance
                ? 'Replaces the profile every published lesson carries — the face, and how the call takes turns.'
                : 'Nothing saved yet, so lessons publish with the built-in defaults and leave the turn-taking to Google.'}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              value={styleName}
              onChange={(event) => setStyleName(event.target.value)}
              maxLength={MAX_STYLE_NAME}
              placeholder="Name this manner — Patient beginner tutor"
              disabled={housing}
              className="min-w-[16rem] flex-1 rounded border border-slate-800 bg-transparent px-2.5 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-700 focus:border-slate-700 disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => void publishStyle()}
              disabled={housing || !styleName.trim()}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-40"
            >
              Publish as a tutor style
            </button>
          </div>
          {/*
            The rendered preset, not the preset key — a key names a prompt in
            this browser's localStorage and nowhere else. Except a built-in's,
            which names the same function of the language everywhere, and goes
            with it so a teacher's language picker can still decide the text.
            The persona is deliberately absent: which face is worn is decided
            per lesson on /teach, so the wrap is applied at publish rather than
            baked in here.
          */}
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            Saves the {instructions.length.toLocaleString()} characters in the prompt box above as
            they stand, rendered for {styleLanguage.label}.{' '}
            {findIn(presets, presetKey)?.builtIn && !edited
              ? 'It is one of the built-in prompts, untouched, so a lesson published in another language gets it in that language instead.'
              : edited
                ? 'It has been edited, so it goes out as these exact words in whatever language a lesson is published in.'
                : 'It is a saved prompt, so it stays in the language it was written in whatever language a lesson is published in.'}{' '}
            The face&rsquo;s persona is not included — that is applied when a teacher picks a
            face.
          </p>

          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
            {houseStyles.map((entry) => (
              <span
                key={entry.id}
                className="flex items-center gap-1.5 rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-400"
              >
                {entry.name}
                <button
                  type="button"
                  onClick={() => void removeStyle(entry.id)}
                  disabled={housing}
                  title="Delete this style"
                  className="text-slate-600 hover:text-rose-400 disabled:opacity-40"
                >
                  ×
                </button>
              </span>
            ))}
            {!houseStyles.length && (
              <span className="text-[11px] text-slate-500">
                No styles published. A teacher cannot hand out a lesson until there is one.
              </span>
            )}
          </div>

          {/*
            How a lesson is worked through, which is the half of the lesson
            block that is not this build’s.

            IT IS NOT BESIDE THE STYLE PICKER BY ACCIDENT. A style is rendered
            from a preset and published under a name, and there can be a dozen;
            this is one block with no name and no list, because a manner is a
            teacher’s choice per lesson and how a lesson is conducted is a
            property of the deployment. See house.ts on that asymmetry, and
            DEFAULT_LESSON_RULES on where the line between this and the
            protocol falls.

            THE PROTOCOL IS DELIBERATELY NOT IN THIS BOX. What the tutor is
            told about the questionDone tool and about system notes describes
            machinery the running build implements, and an administrator who
            could rewrite that could describe a tool that does not exist — a
            failure that reads, from the outside, exactly like a model ignoring
            its instructions.
          */}
          <div className="mt-3 border-t border-slate-800 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                How a lesson is worked through
              </span>
              <span
                className={`text-[11px] ${
                  lessonRules.length > MAX_LESSON_RULES ? 'text-rose-400' : 'text-slate-600'
                }`}
              >
                {lessonRules.length.toLocaleString()}/{MAX_LESSON_RULES.toLocaleString()}
              </span>
            </div>
            <textarea
              value={lessonRules}
              onChange={(event) => setLessonRules(event.target.value)}
              rows={10}
              spellCheck={false}
              disabled={housing}
              className="mt-1.5 w-full resize-y rounded border border-slate-800 bg-transparent px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-300 outline-none focus:border-slate-700 disabled:opacity-40"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void publishLessonRules(lessonRules)}
                disabled={
                  housing ||
                  lessonRules.length > MAX_LESSON_RULES ||
                  lessonRules.trim() === (savedLessonRules ?? '').trim()
                }
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-40"
              >
                Save as the house lesson rules
              </button>
              <button
                type="button"
                onClick={() => setLessonRules(DEFAULT_LESSON_RULES)}
                disabled={housing || lessonRules === DEFAULT_LESSON_RULES}
                className="text-[11px] text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline disabled:opacity-40"
              >
                Put the built-in text back
              </button>
            </div>
            {/*
              Which of the three states this deployment is in, said plainly,
              because two of them compose the same prompt and nothing a student
              sees can tell them apart.
            */}
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              {savedLessonRules === null
                ? 'Nothing saved, so lessons publish with the text above — the one this build ships with.'
                : savedLessonRules.trim() === DEFAULT_LESSON_RULES
                  ? 'Saved, and identical to the built-in text. A later build that rewrites the default will not reach this deployment until it is saved again.'
                  : 'Saved. Every lesson published from /teach carries this block until it is rewritten.'}{' '}
              It goes under the questions and above the reporting rules, which stay with the build.
              Republishing is what carries a change to a class; codes already handed out keep the
              block they went out with.
            </p>
          </div>

          {houseNote && <p className="mt-2 text-xs text-emerald-400">{houseNote}</p>}
          {houseError && <p className="mt-2 text-xs text-rose-400">{houseError}</p>}

          <p className="mt-3 border-t border-slate-800 pt-2.5 text-[11px] leading-relaxed text-slate-500">
            Handing a lesson to a class happens on{' '}
            <a href="/teach" className="text-slate-400 underline-offset-4 hover:underline">
              /teach
            </a>
            , where the questions are written.
          </p>
        </fieldset>
      </div>
    </div>
  );
}
