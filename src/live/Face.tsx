import { useEffect, useId, useRef, useState } from 'react';
import { CANVAS_EDGE } from '../facekit/imageModels';
import { browHeadroom, type FaceKit } from '../facekit/kit';
import { BROW_BOXES, type SlotId } from '../facekit/slots';
import {
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
  HeadPerformer,
  LAUGH_NOD_GAIN,
  MOTION,
  NOD_DEPTH_MAX,
  OVERSCAN,
  PIVOT_X,
  PIVOT_Y,
  TILT_OVERSCAN,
  type HeadMotion,
  type MotionCadence,
  type Performance,
  type PressTrigger,
  type TiltCue,
  type TiltTrigger,
} from './headMotion';
import { MOUTH_BOX, SILENCE, VISEMES, lipPath, type LipShape, type Viseme } from './visemes';

/**
 * The placeholder face.
 *
 * Deliberately plain: it exists to prove the mouth is being driven correctly,
 * and it is meant to be replaced by drawn art. What is *not* placeholder is the
 * mouth slot — a fixed MOUTH_BOX-sized window at a fixed position on the head.
 * Art authored to those bounds drops in by swapping what is rendered inside the
 * nested <svg> below, and nothing outside this file has to know it happened.
 */

/** Where the mouth slot sits on the 200x200 head. */
const MOUTH_X = 100 - MOUTH_BOX.width / 2;
const MOUTH_Y = 118;

const SKIN = '#f3c79c';
const SKIN_SHADE = '#e0ac7c';
const INK = '#33211a';
const THROAT = '#8c3f3a';

/** A blink lasts this long, and one falls somewhere in every window this wide. */
const BLINK_MS = 120;
const BLINK_EVERY_MS = 4200;

/**
 * How much bolder the placeholder's own brows are than a kit's.
 *
 * These are two strokes on flat skin with nothing registered to them, so the only
 * thing limiting their travel is what looks right, and a drawing this simple has
 * to overact slightly to say anything at all. On a portrait drawn anywhere near
 * naturalistically the same amount does not read as emphasis, it reads as alarm.
 *
 * A multiplier on the setting rather than a figure of its own, which it used to
 * be. The reason is the slider: a control that moves the brows of every kit and
 * does nothing to the face the page shows before a kit is chosen is a control
 * whose first use teaches you it is broken.
 */
const PLACEHOLDER_BROW_BOLDNESS = 1.5;

/*
 * There is deliberately no such allowance for the lip press, which had one until
 * PRESS_DEPTH went to full travel and it became a way of asking for a mouth
 * nobody has drawn.
 *
 * The brows can be overacted because their travel is a free number — a distance
 * in head units, with no drawing at the end of it saying where to stop. The press
 * ends at a pose: VISEMES.mbp, the same one a kit dissolves to. Multiplying past
 * that does not exaggerate the gesture, it extrapolates a fourth shape out of two
 * that exist, and the placeholder would then be demonstrating a mouth the live
 * face cannot make.
 *
 * For scale, since it is the same question the brows had to answer: `rest` to
 * `mbp` is 4 units of half-width and 1.7 of aperture, and the stage draws this
 * head at 160 pixels, so a unit is 0.8 of one. Full travel is therefore 3.2
 * pixels at the corners and 1.4 across the opening — modest, and unlike the brows
 * at 1.4px it is a shape change across the whole mouth rather than a line moving
 * under its own stroke width.
 */

/**
 * How far the brow patch fades out at its top and sides, in head units.
 *
 * The one number that decides whether this looks like a lift or like a
 * rectangle. Every edge of the moved crop is a place where pixels from one
 * height sit next to pixels from another, and a hard edge announces itself the
 * moment it crosses anything with structure — a curl of hair at the temple, the
 * outer tip of the brow itself. Fading over a dozen pixels turns each of those
 * into a place where the lift simply tapers off, which is also how a real brow
 * moves: most at the middle, least at the ends.
 */
const BROW_FEATHER = 2.6;

interface FaceProps {
  shape: LipShape;
  /**
   * The discrete shape the classifier settled on.
   *
   * Unused by the drawn face, which interpolates `shape` continuously, and the
   * only thing a kit can use: drawn artwork comes in fixed poses, not on a
   * spectrum between them.
   */
  viseme: Viseme;
  /** Smoothed loudness, 0 to 1. Drives everything that is not the mouth. */
  level: number;
  /** Artwork to wear instead of the drawing. Null falls back to the placeholder. */
  kit?: FaceKit | null;
  /** Which way the head moves. See HEAD_MOTIONS. */
  motion?: HeadMotion;
  /** On what schedule it moves, and the brows with it. See MOTION_CADENCES. */
  cadence?: MotionCadence;
  /** Whether some blinks carry a brow lift. See BROW_FLASH in headMotion.ts. */
  browBlink?: boolean;
  /**
   * Which moments close the lips for an instant. See PRESS_TRIGGERS. Empty is off.
   *
   * Reads `speaking` and `heard` and nothing else, so a face with no call behind
   * it never does this — which is the same silence the tilt's default relies on,
   * and for once it is not a compromise: both moments are the edge of a turn,
   * and a preview has no turns.
   */
  press?: readonly PressTrigger[];
  /**
   * Whether the microphone is hearing a voice. See `heard` on CueInput.
   *
   * Two things read it: the `reply` half of the press, and the nod, which reads
   * nothing else at all. Defaulting to false is what keeps the kit page's
   * preview from pressing its lips or nodding at a microphone that is not open —
   * the same defence `speaking` makes for the tilt, owed to the same page, and
   * the reason neither feature has to be switched off there by hand.
   */
  heard?: boolean;
  /**
   * Whether the head may nod once as the user finishes speaking.
   *
   * See DEFAULT_LISTEN_NOD. It has no effect on any preview, for the reason
   * directly above: nothing there is ever heard, so nothing there ever stops.
   */
  listenNod?: boolean;
  /**
   * How far it dips when one lands, in head units. See DEFAULT_NOD_DEPTH.
   *
   * Does not affect the overscan, and unlike the tilt's angle it does not have
   * to be kept from affecting it — the whole of this range already fits inside
   * the margin the picture is drawn with. See NOD_DEPTH_MAX.
   */
  nodDepth?: number;
  /**
   * What share of finished answers get one, 0 to 1. See DEFAULT_NOD_CHANCE.
   *
   * Rolled per answer inside the performer, so this is odds rather than a
   * schedule: there is no cadence here to be caught keeping.
   */
  nodChance?: number;
  /**
   * How far the head is dipped for a laugh this frame, 0 to 1, and 0 otherwise.
   *
   * Driven from outside rather than by the performer, because it is the only head
   * movement here that is not a response to a live loudness: a laugh's rhythm has
   * to sit on the recorded clip's own clock or it drifts against the mouth pose it
   * accompanies. See `laughBob` in headMotion.ts, and SpeakingFace, which reads it
   * off the same instant it asks MarkMouth about.
   *
   * Scaled by `nodDepth` times LAUGH_NOD_GAIN, so the panel's one depth setting
   * governs both gestures and a laugh stays the deeper of the two whatever it is
   * set to. Capped at NOD_DEPTH_MAX, which is the dip the overscan is paid for.
   */
  laughNod?: number;
  /**
   * How far the brows travel at full lift, in head units. See DEFAULT_BROW_LIFT.
   *
   * What a kit's brows get is this or what its box affords, whichever is smaller —
   * so this is a request rather than a promise, and a portrait with no forehead to
   * spare quietly keeps its own answer. The placeholder's drawn brows have nothing
   * registered to them and take it in full, times PLACEHOLDER_BROW_BOLDNESS.
   */
  browLift?: number;
  /**
   * What share of blinks carry a brow flash, 0 to 1. See DEFAULT_BROW_FLASH_CHANCE.
   *
   * Read at the moment a lid closes rather than per frame, which is why it is
   * handed to `blinked` below instead of riding on the cue with the other two
   * rates — the blink's clock lives in this component and the performer only
   * ever hears about it as an event.
   *
   * Does nothing while `browBlink` is false. The tick is whether the brows
   * answer blinks at all; this is how many of them they answer.
   */
  browFlashChance?: number;
  /** Which events may lean the head sideways. See TILT_TRIGGERS. Empty is off. */
  tilt?: readonly TiltTrigger[];
  /**
   * How far it leans when one lands, in degrees. See DEFAULT_TILT_ROLL.
   *
   * Does not affect how much the picture is overscanned, on purpose — the whole
   * slider's range is paid for whatever this says, so that dragging it moves the
   * head without also resizing it.
   */
  tiltRoll?: number;
  /**
   * How long it takes to get there, in seconds. See DEFAULT_TILT_SETTLE.
   *
   * The release follows this at a fixed ratio and is not separately settable —
   * the shape of the gesture is the file's opinion, and only its pace is the
   * caller's.
   */
  tiltSettle?: number;
  /**
   * What share of the tilt's conversation events are taken, 0 to 1.
   *
   * See DEFAULT_TILT_CHANCE. `waiting` is not subject to it and neither is a
   * probe, so a preview driving the head through `tiltCue` still leans every
   * time it asks — which is what makes this safe to default low.
   */
  tiltChance?: number;
  /**
   * The latest question or handover, or null if there has not been one.
   *
   * A fresh object per event and never rebuilt on an ordinary render, because
   * the effect below fires on its identity — see TiltCue.
   */
  tiltCue?: TiltCue | null;
  /**
   * Whether the agent's audio is playing, gaps inside it included.
   *
   * Only the tilt reads it, and only to tell a pause mid-turn from the end of
   * one. Defaulting to false is what keeps a face with no call behind it — the
   * kit page's preview — from finding a hesitation in its own silence.
   */
  speaking?: boolean;
  /**
   * Holds the lids shut and the brows at their ceiling for as long as it is on.
   *
   * The kit page's affordance, and nothing the live face ever sets. Both are
   * frames the face otherwise only shows in passing — a blink is BLINK_MS, and a
   * brow at full lift is one instant inside a gesture — and both are frames where
   * a kit's artwork can be wrong in a way no other view on that page can show: a
   * closed-lid patch that does not register with the base under it, or a brow crop
   * whose top edge has cleared the plain forehead and is drawing a band of skin
   * across a fringe. Stopping on them is the only way to look at either for longer
   * than it exists.
   *
   * It overrides rather than drives. The blink schedule and the performer both
   * keep running underneath, and what they say about these two channels is
   * discarded until this goes off — so releasing it hands the face straight back
   * to whatever they had got to, with nothing to resynchronise. Nothing else is
   * touched: a held face still swings and still leans if it is given a loudness,
   * which is the caller's business to stop.
   */
  hold?: boolean;
  /**
   * Lids shut, and nothing else touched.
   *
   * `hold` above does this too, but it also pins the brows at their ceiling, because it
   * exists to freeze a frame for inspection on the kit page. This is for a face that is
   * doing something — laughing, with its eyes screwed up — where the brows should carry
   * on with whatever the performer had planned for them.
   *
   * Overrides the blink schedule rather than driving it, exactly as `hold` does: the
   * schedule keeps running underneath and the face is handed back to it, mid-cycle,
   * with nothing to resynchronise.
   */
  eyesShut?: boolean;
  /**
   * Whether the face is at the edges of a conversation rather than inside one.
   *
   * IT SAYS A SMILE IS WARRANTED, NOT THAT ONE IS WORN. The difference is
   * `smileHold` below and it is the whole of why this prop is no longer enough
   * on its own: the two moments that set it are moments, but the states they
   * describe are open-ended — an idle page waits as long as the learner does —
   * and a pose worn for the whole of a state is a mask rather than a gesture.
   * So this arms the smile and the hold takes it off again.
   *
   * Two moments set it and no others — before the tutor has said its first word,
   * and once its goodbye has finished playing — which is what keeps it from
   * becoming a face that smiles through every silence a learner leaves while
   * thinking. See Eleve.tsx, which computes it.
   *
   * Ignored while the analyser is reporting anything but `rest`, so a caller
   * that leaves it on into a turn gets a mouth that talks rather than a smile
   * ghosting over a vowel. That is a guard and not a licence: the fade is timed
   * for the ends of a call, and a caller holding this through speech would be
   * asking the guard to do the work of a decision it should have made itself.
   *
   * Absent in a kit is absent on the face: a kit with no smile patch simply
   * stays at `rest`, which VISEMES.rest already draws faintly upturned.
   *
   * The placeholder ignores it, and cannot do otherwise. A LipShape is three
   * numbers describing an opening — half-width, how far the upper lip rises, how
   * far the lower one drops — and none of them is curvature. There is no smile
   * to interpolate towards in that table, and adding a fourth number to draw one
   * would be inventing a mouth for a face whose whole job is to prove the driver
   * works.
   */
  smiling?: boolean;
  /**
   * Whether the armed smile is held rather than let go — the one exemption from
   * the schedule below.
   *
   * There is exactly one state where a decaying smile is the wrong answer, and
   * it is the state the smile's first term was written for: the socket is up and
   * the tutor has not spoken yet. That gap is a second or two, it is *about* to
   * end, and it is covered on purpose — a face that let its greeting go halfway
   * through it would go neutral immediately before saying hello, which is worse
   * than either behaviour on its own.
   *
   * A caller that never sets it gets the schedule for every smile, which is the
   * right default: this is an exemption granted by a caller that knows something
   * is coming, and nothing here can know that.
   */
  smileSustain?: boolean;
  /**
   * How long a smile is worn before it is let go, in seconds, and how long the
   * face waits before smiling again. See DEFAULT_SMILE_HOLD.
   *
   * A hold of zero is no smile at all, and is the way to switch this off from
   * the panel rather than a degenerate case to guard against — a face whose kit
   * has a smile patch it never wears is a legitimate thing to want to look at. A
   * gap of zero is one smile per edge and no repeat, which is the conservative
   * reading of DEFAULT_SMILE_GAP's own argument against itself.
   */
  smileHold?: number;
  smileGap?: number;
  /**
   * Lets a kit's artwork paint past the frame, for a caller that clips already.
   *
   * The clip this turns off is described where it is applied: the picture is
   * drawn OVERSCAN wider than the frame so a lean cannot uncover a corner, and
   * something has to cut that back or a portrait bleeds over its neighbours.
   * That is the right default and the live stage depends on it — a speech
   * balloon sits exactly where the spill would land.
   *
   * It is the wrong answer for a round frame. The overscan eats a twentieth of
   * the canvas off every edge, and a portrait has less clearance than that above
   * the crown — the bundled kit has 3.5% against the 9% a tilt-armed frame takes
   * — so the square cut lands *on the hair* and flattens the top of the head.
   * A circle inscribed in the same square is nowhere near the crown: it clears
   * it by a comfortable margin at the one place the head is tallest, because it
   * only has to reach the middle of the top edge rather than the whole of it.
   *
   * So the roundel asks for the spill and clips it itself. See TutorStage, which
   * is the only caller that sets this, and which owes the overscan one thing in
   * return: its own background has to be the white a kit is flattened onto, so
   * that the sliver of frame a deep lean can still uncover does not show.
   */
  bleed?: boolean;
  /** Anchor for the speech bubble's tail. Marks the mouth, not the head. */
  mouthRef?: React.Ref<SVGCircleElement>;
}

/** Kit boxes are in CANVAS_EDGE pixels; this head is 200 units across. */
const toHead = (value: number) => (value / CANVAS_EDGE) * 200;

/**
 * Every mouth pose a kit can hold, listed so all of them can stay mounted.
 *
 * Spelled out rather than read off the kit's own keys, so the set of <image>
 * elements does not change when a patch is added — React would remount the
 * lot, and a remount mid-sentence is a visible blank.
 *
 * Being a plain array, this is the one place a new Viseme does not announce
 * itself: nothing here is exhaustive, so a shape left out is simply a patch
 * that never paints. `fv` is listed for that reason and no other — the audio
 * analyser cannot select it, so today it sits at opacity 0 for the whole of
 * every call, waiting for a driver that can.
 */
/**
 * How much of each mouth patch shows.
 *
 * Three things overlap here and each is a separate reason:
 *
 *   smile   worn on its own schedule for idle moments, AND selectable as a pose now that
 *           a laugh wants a beat of it first. Whichever asks for it more strongly wins,
 *           so a mark-driven smile is not dimmed by an idle timer that is not running.
 *   mbp     carries the lip press as well as the phoneme, which is why it has never
 *           simply been "1 when selected".
 *   laugh   falls back to `aa` on a kit that has no laugh patch. Every face published
 *           before the pose existed is such a kit, and the alternative to falling back
 *           is a laugh painting nothing and the base portrait's own mouth showing
 *           through — a still, closed mouth in the middle of laughter.
 */
function patchOpacity(
  id: SlotId,
  viseme: Viseme,
  smiled: number,
  pressed: number,
  noLaughPatch: boolean,
): number {
  if (id === 'smile') return Math.max(smiled, viseme === 'smile' ? 1 : 0);
  if (id === 'aa' && viseme === 'laugh' && noLaughPatch) return 1;
  if (viseme === id) return 1;
  if (id === 'mbp') return pressed;
  return 0;
}

const VISEME_ORDER: SlotId[] = [
  'rest', 'mbp', 'fv', 'ee', 'uh', 'aa', 'oh', 'laugh', 'smile',
];

/**
 * How long the smile takes to arrive and to leave, in milliseconds.
 *
 * A CSS transition rather than the rAF loop everything else here runs on, and
 * that is the one place in this file where the frame clock is the wrong tool:
 * this pose is worn when there is no audio, and with no audio there is no tap,
 * no loop and no frames — a fade driven from here would have nothing to drive
 * it. The browser eases an opacity with the tab idle; this component cannot.
 *
 * Slower in than out because the two do different jobs. Arriving, it is the
 * whole gesture and wants to be seen happening. Leaving, it is getting out of
 * the way of a mouth that has started talking, and the only thing that matters
 * is that it is gone before the first word lands.
 */
const SMILE_IN_MS = 420;
const SMILE_OUT_MS = 160;

/**
 * The same fade, for the smile that is worn as a pose rather than as an idle.
 *
 * Both numbers above are wrong for a mark-driven smile, and the second one was being
 * used for both halves of it: `smiled` is `smileWorn && viseme === 'rest'`, and a smile
 * leading a laugh is never at rest, so the lead-in arrived over SMILE_OUT_MS and left
 * over SMILE_OUT_MS — 160ms each way, governed by a constant whose whole reason for
 * existing is getting out of the way of a mouth that has started talking.
 *
 * Leaving was the damaging half. This patch is last in VISEME_ORDER and so paints over
 * every other one, and it is the only patch with a transition at all — `laugh` has
 * none and snaps to full opacity underneath. A 160ms fade-out against a 110ms pulse
 * meant the first pulse and most of the second happened behind a closed mouth, and the
 * laugh's visible onset landed a quarter of a second after its sound.
 *
 * So both halves are sized against the thing they have to fit inside rather than
 * against the idle timer: in, comfortably within SMILE_LEAD_MS, so the beat is fully
 * arrived when the jaw drops; out, well under one pulse, so it is gone before the laugh
 * has anything to show.
 */
const SMILE_MARK_IN_MS = 90;
const SMILE_MARK_OUT_MS = 60;

/**
 * How long the smile patch takes to cross the opacity it was just given.
 *
 * The direction is not knowable from props alone — CSS is handed a duration, not a
 * curve per direction — so it is read off what the mouth is doing instead, which is
 * the same thing one remove earlier:
 *
 *   smiled      the idle smile is on, so this is it arriving. Slow, on purpose: it is
 *               the whole gesture and wants to be seen happening.
 *   viseme is   a mark put it there, so this is the lead-in arriving.
 *   'smile'
 *   viseme is   the lead-in leaving, because a laugh is the only thing a smile ever
 *   'laugh'     leads. Fast, or it covers the laugh it introduced.
 *   otherwise   the idle smile leaving, ahead of a mouth that has started talking.
 */
const smileFadeMs = (smiled: number, viseme: Viseme): number => {
  if (smiled) return SMILE_IN_MS;
  if (viseme === 'smile') return SMILE_MARK_IN_MS;
  if (viseme === 'laugh') return SMILE_MARK_OUT_MS;
  return SMILE_OUT_MS;
};

export default function Face({
  shape,
  viseme,
  level,
  kit,
  motion = DEFAULT_HEAD_MOTION,
  cadence = DEFAULT_CADENCE,
  browBlink = DEFAULT_BROW_BLINK,
  press = DEFAULT_PRESS_TRIGGERS,
  heard = false,
  listenNod = DEFAULT_LISTEN_NOD,
  nodDepth = DEFAULT_NOD_DEPTH,
  nodChance = DEFAULT_NOD_CHANCE,
  laughNod = 0,
  browLift = DEFAULT_BROW_LIFT,
  browFlashChance = DEFAULT_BROW_FLASH_CHANCE,
  tilt = DEFAULT_TILT_TRIGGERS,
  tiltRoll = DEFAULT_TILT_ROLL,
  tiltSettle = DEFAULT_TILT_SETTLE,
  tiltChance = DEFAULT_TILT_CHANCE,
  tiltCue,
  speaking = false,
  hold = false,
  eyesShut = false,
  smiling = false,
  smileSustain = false,
  smileHold = DEFAULT_SMILE_HOLD,
  smileGap = DEFAULT_SMILE_GAP,
  bleed = false,
  mouthRef,
}: FaceProps) {
  const [blinking, setBlinking] = useState(false);
  /**
   * Whether the smile is being worn this instant, as against warranted.
   *
   * State rather than a derived value because the thing that takes it off is a
   * clock and not a prop: `smiling` stays true for the whole of an idle page,
   * and what turns over underneath it is this. See the schedule below.
   */
  const [smileWorn, setSmileWorn] = useState(false);
  const [perf, setPerf] = useState<Performance>({
    head: 0,
    brow: 0,
    tilt: 0,
    press: 0,
    nod: 0,
  });
  const timers = useRef<number[]>([]);
  /**
   * Built once, and reachable from both effects below rather than owned by the
   * loop that reads it — the blink schedule has to be able to tell it that an
   * eye just closed, and the two live in separate effects because they are
   * separate clocks.
   */
  const performer = useRef<HeadPerformer | null>(null);
  if (!performer.current) performer.current = new HeadPerformer();
  // Two faces on one page must not share a mask id, and nothing here knows
  // whether it is the only one.
  const maskId = useId().replace(/:/g, '');

  /**
   * The latest of everything the performer reads, kept where its loop can see it.
   *
   * Refs rather than dependencies on purpose. The loop below must not be torn
   * down and rebuilt when the cadence changes, because rebuilding it resets the
   * phrase envelope and both lockouts — and a switch that costs a second of the
   * face finding its feet cannot be used for the one thing it exists for, which
   * is flipping between two schedules on the same sentence.
   */
  const latest = useRef({
    level,
    cadence,
    browBlink,
    press,
    heard,
    tilt,
    speaking,
    listenNod,
    nodChance,
    browFlashChance,
    tiltSettle,
    tiltChance,
  });
  useEffect(() => {
    latest.current = {
      level,
      cadence,
      browBlink,
      press,
      heard,
      tilt,
      speaking,
      listenNod,
      nodChance,
      browFlashChance,
      tiltSettle,
      tiltChance,
    };
  }, [
    level,
    cadence,
    browBlink,
    press,
    heard,
    tilt,
    speaking,
    listenNod,
    nodChance,
    browFlashChance,
    tiltSettle,
    tiltChance,
  ]);

  /**
   * Questions and handovers, handed to the performer as they arrive.
   *
   * Keyed on the cue object rather than on anything inside it, which is the
   * whole reason the page keeps it in state: rebuilt inline on every render this
   * would fire on each transcript delta, and the face would lean at every word.
   */
  useEffect(() => {
    if (!tiltCue) return;
    if (tiltCue.kind === 'question') performer.current?.heardQuestion();
    else if (tiltCue.kind === 'probe') performer.current?.probed();
    else performer.current?.yielded();
  }, [tiltCue]);

  useEffect(() => {
    const schedule = () => {
      // Jittered rather than metronomic — a face that blinks on the beat is
      // more unsettling than one that does not blink at all.
      const delay = BLINK_EVERY_MS * (0.45 + Math.random());
      timers.current.push(
        window.setTimeout(() => {
          setBlinking(true);
          // Told at the moment the lids start to close, not when they open
          // again: the brow and the blink are meant to read as one movement,
          // and the brow's own attack is already the slower of the two.
          if (latest.current.browBlink) {
            performer.current?.blinked(latest.current.browFlashChance);
          }
          timers.current.push(
            window.setTimeout(() => {
              setBlinking(false);
              schedule();
            }, BLINK_MS),
          );
        }, delay),
      );
    };

    schedule();
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  /**
   * The smile's own clock: worn on arming, let go after the hold, and brought
   * back at the gap for as long as the moment that armed it lasts.
   *
   * TIMEOUTS RATHER THAN THE rAF LOOP, which is the blink's arrangement and for
   * the blink's reason doubled. What is wanted here is a boolean flipping at two
   * or three points a minute, and a frame clock is the wrong instrument for
   * that; more to the point this is the *only* thing on the face that has to
   * keep working when there is no audio anywhere near the page, and SMILE_IN_MS
   * already explains what runs the fade once the boolean has flipped. Neither
   * clock is doing the other's job.
   *
   * REBUILT WHEN ITS INPUTS CHANGE, unlike the head's loop, which goes to some
   * lengths not to be. That loop refuses because rebuilding it would reset a
   * phrase envelope and two lockouts mid-sentence; there is nothing here to
   * lose. A hold dragged on the panel restarting the smile it is being dragged
   * against is the behaviour you want from a dial, not a bug in one.
   *
   * The jitter is the blink's, in the blink's spelling, because a face that
   * smiles on the beat is the same failure as one that blinks on it — and this
   * one is worse, being longer and further apart, which is exactly the spacing
   * at which a person starts to feel a loop.
   */
  useEffect(() => {
    if (!smiling) {
      setSmileWorn(false);
      return;
    }
    // The exemption. No clock at all rather than a very long one: the caller is
    // saying this ends when something happens, and a timer would be this file
    // guessing when.
    if (smileSustain) {
      setSmileWorn(true);
      return;
    }

    const pending: number[] = [];
    const wear = () => {
      setSmileWorn(true);
      if (smileHold > 0) pending.push(window.setTimeout(release, smileHold * 1000));
    };
    const release = () => {
      setSmileWorn(false);
      if (smileGap > 0) {
        pending.push(window.setTimeout(wear, smileGap * 1000 * (0.45 + Math.random())));
      }
    };

    // A hold of nothing is the feature off, and the way it is off is that the
    // pose is never worn — not that it is worn for a frame and snatched back,
    // which with a 420ms fade under it would read as a flinch.
    if (smileHold > 0) wear();
    else setSmileWorn(false);

    return () => pending.forEach(clearTimeout);
  }, [smiling, smileSustain, smileHold, smileGap]);

  /**
   * The head's own clock, which is the blink's argument applied to the rest of
   * the face.
   *
   * It lives here rather than in SpeakingFace's loop for two reasons, and the
   * second is the load-bearing one. A schedule has to keep running when nothing
   * is being said — a lockout has to expire, a brow lifted by a blink has to
   * come back down — and SpeakingFace's loop stops entirely between calls. That
   * second clause is no longer hypothetical: the brow flash is fired by the
   * blink, which never stops, so this loop now has work to do on a face that
   * has not been spoken to in minutes. And MotionPreview drives
   * this component with a loudness it invents, with no analyser anywhere near
   * it; a performance computed upstream would leave that preview showing
   * something the live page does not do, which is the one thing that preview
   * promises never to do.
   */
  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const step = (time: number) => {
      // Clamped for the analyser's reason: a backgrounded tab resumes with a gap
      // of seconds, and feeding that in as one frame would expire every lockout
      // and snap the envelope to its target.
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      const next = performer.current!.read(dt, latest.current.level, latest.current.cadence, {
        triggers: latest.current.tilt,
        speaking: latest.current.speaking,
        heard: latest.current.heard,
        press: latest.current.press,
        nod: latest.current.listenNod,
        nodChance: latest.current.nodChance,
        settle: latest.current.tiltSettle,
        tiltChance: latest.current.tiltChance,
      });
      // Returning the identical object when nothing has moved is what keeps a
      // silent face cheap: between flashes this loop costs one callback a frame
      // and no renders at all, rather than re-rendering a whole portrait sixty
      // times a second to draw the same transform.
      //
      // Every field the performance carries has to be tested here. A field left
      // out is not a missed optimisation, it is a channel that silently stops
      // animating whenever the others are still — which, for the brows, is
      // exactly when they now have something to do.
      setPerf((current) =>
        Math.abs(current.head - next.head) < 1e-4 &&
        Math.abs(current.brow - next.brow) < 1e-4 &&
        Math.abs(current.tilt - next.tilt) < 1e-4 &&
        Math.abs(current.press - next.press) < 1e-4 &&
        Math.abs(current.nod - next.nod) < 1e-4
          ? current
          : next,
      );
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  /**
   * The rest of the performance.
   *
   * Six mouth shapes on a rigid head reads as a puppet; a head that carries the
   * emphasis reads as someone talking. What changed is where the two numbers
   * come from: `level` is the loudness of this frame and moves at syllable rate,
   * whereas `perf` is that loudness put through a schedule — see MOTION_CADENCES.
   * The mouth still reads `level` directly, because the mouth *should* move once
   * per syllable; it is the only thing here that should.
   */
  // Not destructured: `rise` would shadow the per-brow travel of the same name
  // a few dozen lines down, where the shadowing would be harmless and confusing.
  const travel = MOTION[motion];
  /**
   * The move, as one transform both branches share.
   *
   * SVG applies a transform list right to left, so this rotates about the pivot
   * and then translates — the order the face has always used. It used to be
   * unobservable, because every mode in MOTION leaves one of the two terms at
   * zero and one half of this was always an identity. The tilt ends that: under
   * `rise` a lean and a lift are now live at the same moment, and the order
   * above is what decides that the picture lifts along the frame's vertical
   * rather than along its own tilted one. That is the right way round — the
   * lift is a camera-ish move on the frame, the lean is the head turning inside
   * it — but it is now a choice rather than a spare comment.
   *
   * Both rotations go about the same pivot, which is not a detail. A tilt hinged
   * anywhere else would read as a different joint from the swing, and with both
   * able to run at once the discrepancy would be on screen rather than
   * theoretical.
   */
  const roll = perf.head * travel.roll + perf.tilt * tiltRoll;
  /*
    Both vertical movements on one term, which they can share because they cannot
    disagree: `head` is the agent's own loudness and `nod` only fires while the
    agent is silent, so at most one of the two is ever non-zero. Summed all the
    same rather than chosen between — a conditional here would be asserting that
    disjointness a second time, in the one place it would fail silently if it
    ever stopped holding.

    `laughNod` is the third, and it is the one that genuinely can land on top of
    another: a laugh is played back from a recording, so `head` is reading the
    laugh's own loudness at the same moment. That is why it is summed rather than
    switched — a laugh that cancelled the swing would go oddly still at its peak,
    and the two together are a head bobbing while the shoulders are already moving,
    which is what laughing looks like. Its own cap plus the nod's fits the margin,
    since the nod is silent for the whole of any playback.

    The signs differ because the channels do. A positive `head` lifts, so it is
    negated into SVG's downward y; `nod` spent its sign at definition and is
    always a dip, so it is not. See the nod block in headMotion.ts.
  */
  const lift =
    perf.nod * nodDepth
    + laughNod * Math.min(nodDepth * LAUGH_NOD_GAIN, NOD_DEPTH_MAX)
    - perf.head * travel.rise;
  const move = `translate(0 ${lift}) rotate(${roll} ${PIVOT_X} ${PIVOT_Y})`;
  /**
   * The two channels `hold` takes over, resolved once for both faces below.
   *
   * A full brow rather than a number of its own: full is what the cap in the kit
   * branch is written against, so this asks for the whole of `browLift` and gets
   * back exactly what that box affords — which is the height the artwork is being
   * held still to be judged at. Anything less would be judging the setting.
   */
  const brow = hold ? 1 : perf.brow;
  const shut = hold || eyesShut || blinking;
  // Bolder than a kit's, and following the same setting. See
  // PLACEHOLDER_BROW_BOLDNESS.
  const drawnBrowRise = brow * browLift * PLACEHOLDER_BROW_BOLDNESS;
  // Left on the raw loudness, alone among these. It is not a gesture — it is a
  // twelve percent narrowing that happens to the eyes of anyone raising their
  // voice, and putting it on a schedule would make the face blink-adjacent at
  // moments it had not chosen to blink.
  const eyeOpen = shut ? 0.08 : 1 - level * 0.12;
  /**
   * The lip press, faded out by whatever the voice is doing.
   *
   * This one line is the whole of how the press and the analyser settle which of
   * them owns the mouth, and the answer is that the analyser always does. The
   * gesture is scaled by how far below the classifier's own silence threshold
   * this frame sits, so it is at full strength while the analyser is reporting
   * `rest` and at nothing by the time it reports anything else — the two are the
   * same test, because `viseme === 'rest'` *is* `level < SILENCE`.
   *
   * Continuous rather than a test on `viseme` directly, which would be the
   * identical rule expressed as a cliff. The cliff is the problem: it would drop
   * the mouth by the entire depth of the press between two frames, on the exact
   * frame the first syllable lands. This way the press is already on its way out
   * as the sound comes up, which is also what lips parting into a word look like.
   *
   * `level` is the *agent's* loudness and always was, which is why this fade
   * does nothing to a `reply` press: that one fires while the face is silent, so
   * the term is 1 for the whole of it and the gesture is seen at whatever depth
   * PRESS_DEPTH asked for. The user's own voice never reaches this line. It has
   * already done its work upstream, deciding that there was a press at all.
   */
  const pressed = perf.press * Math.max(0, 1 - level / SILENCE);

  /**
   * The smile, on or off, with the browser easing between the two.
   *
   * The cliff the press goes to such lengths to avoid, taken deliberately —
   * because here it is not a cliff. `pressed` has to ramp because it is read on
   * every frame of a fade this file is running itself; this is a target handed
   * to a CSS transition, and a target is *supposed* to jump. What the eye gets
   * is still the gradual thing.
   *
   * Sharing the analyser's test rather than the ramp keeps the rule honest at
   * the one moment it matters: the tutor starts its first word, `viseme` leaves
   * `rest`, and the smile is on its way out that same frame — SMILE_OUT_MS, not
   * a term that decays as the loudness climbs.
   */
  //
  // Reads `smileWorn` and not the prop, so the analyser's veto and the hold's
  // expiry are the same line and neither can outvote the other: whichever says
  // no, the answer is no. The schedule keeps running underneath a veto rather
  // than pausing for it, which is right — a smile whose hold expired during a
  // sentence has expired, and reappearing as the sentence ends would be a
  // gesture arriving on a cue that had already gone by.
  const smiled = smileWorn && viseme === 'rest' ? 1 : 0;

  /**
   * The drawn face, wearing artwork.
   *
   * Everything the placeholder does with `level` — the swing into an emphasised
   * syllable — survives here, because it is a transform on a group rather than
   * anything drawn. That is the part of a live face that costs nothing to keep
   * when the art is swapped in, and it is worth noticing that it is also most of
   * the effect.
   *
   * The group contains the whole picture, and the overscan is what pays for
   * that: the artwork is drawn a tenth oversize inside the moving group, so the
   * frame stays covered however far the picture turns. Everything registered to
   * the base — patches, lids, brow crops — sits inside the same group and scales
   * with it, which is the only way the registration survives.
   *
   * What also changes is the mouth: discrete poses instead of a spectrum, chosen by
   * `viseme` rather than interpolated from `shape`. Every pose stays mounted and
   * is revealed by opacity, because decoding a patch the first time it is
   * painted costs a frame, and dropping a frame at the exact moment a mouth
   * changes shape is the one place it would be visible.
   */
  if (kit) {
    const mouth = kit.boxes.mouth;

    /**
     * The overscan, as a transform about the centre of the frame.
     *
     * Centre rather than the pivot, because what has to stay covered is the
     * whole frame rather than the neighbourhood of one point — scaling about a
     * pivot sitting 20 units off the bottom edge pushes that edge out barely at
     * all, and the bottom corners are exactly where the rotation uncovers.
     */
    /*
      Chosen by whether a tilt can happen at all, and never by how far one has
      got: a scale recomputed per frame would swell the head on every lean,
      which is a zoom rather than a movement and reads as the face lurching at
      the camera. It steps once, when the feature is switched on. See
      TILT_OVERSCAN on why it does not also follow the direction switch.
    */
    const grow = `translate(100 100) scale(${tilt.length > 0 ? TILT_OVERSCAN : OVERSCAN}) translate(-100 -100)`;
    // Both lids are drawn from the same flag. A kit holding only one of them
    // still blinks, with one eye — visibly wrong, and better than silently
    // doing nothing while the artwork looks complete in the picker.
    const lids = [
      { id: 'eyeLeftClosed', patch: kit.patches.eyeLeftClosed, box: kit.boxes.eyeLeft },
      { id: 'eyeRightClosed', patch: kit.patches.eyeRightClosed, box: kit.boxes.eyeRight },
    ];

    /**
     * The brows, and how far each one goes this frame.
     *
     * Capped at the clear forehead the box says is above the brow, which is a
     * measurement now rather than a fraction of the box — see `browHeadroom`. A
     * kit with no brow box gets no lift and no rectangles, which is how every kit
     * authored before this behaved.
     *
     * Worth knowing what the cap is protecting, because it is not a seam. Nothing
     * here breaks at a large rise: the crop covers the brow's old position, and
     * whatever the crop leaves behind is covered by the stretched row below it. It
     * is the two *cosmetic* failures that grow. The crop's top edge travels `rise`
     * above the box, drawing forehead pixels over forehead they did not come from
     * — fine while both are plain forehead, and a hard-edged band of skin across a
     * fringe the moment the edge clears the clean part. And the fill below is one
     * row of skin stretched over `rise` units, so it replaces graded skin with a
     * flat band that widens as the lift does. Both are bounded by the same thing:
     * how much of that box is plain forehead, which is what the line measures.
     */
    const brows = BROW_BOXES.flatMap((id) => {
      const box = kit.boxes[id];
      if (!box) return [];
      const rise = Math.min(brow * browLift, toHead(browHeadroom(box)));
      if (rise <= 0) return [];
      return [
        {
          id,
          rise,
          x: toHead(box.x),
          y: toHead(box.y),
          width: toHead(box.width),
          height: toHead(box.height),
        },
      ];
    });

    return (
      /*
        Clipped, unlike the placeholder below, and the overscan is why: the
        artwork is deliberately drawn a tenth wider than the frame, so something
        has to cut it back to the frame or a portrait bleeds a tenth of its width
        over whatever sits beside it. The live stage puts a speech balloon
        exactly there and does not clip on its own account.

        Unless the caller says it clips already, which a round frame does and
        which is the only way to keep a crown that sits nearer the canvas edge
        than the overscan is deep. See `bleed`.
      */
      <svg
        viewBox="0 0 200 200"
        className={`h-full w-full ${bleed ? 'overflow-visible' : 'overflow-hidden'}`}
        aria-hidden="true"
      >
        {/*
          Three ramps, in bounding-box units so one definition serves a strip of
          any size. Black at full opacity hides, transparent reveals, and a mask
          reads luminance — so painting these over a white rectangle is what
          turns a hard-edged crop into one that tapers away.
        */}
        <defs>
          {(
            [
              ['fade-left', '0', '0', '1', '0', 1, 0],
              ['fade-right', '0', '0', '1', '0', 0, 1],
              ['fade-top', '0', '0', '0', '1', 1, 0],
            ] as const
          ).map(([name, x1, y1, x2, y2, from, to]) => (
            <linearGradient key={name} id={`${maskId}-${name}`} x1={x1} y1={y1} x2={x2} y2={y2}>
              <stop offset="0%" stopColor="#000" stopOpacity={from} />
              <stop offset="100%" stopColor="#000" stopOpacity={to} />
            </linearGradient>
          ))}
        </defs>

        {/*
          The moving part, which is all of it. Two nested groups rather than one
          because they answer two separate questions and collapsing them would
          hide that: the outer one is where the head goes this frame, the inner
          one is the fixed overscan that keeps the frame covered while it gets
          there. Nesting also keeps the base's own coordinate system intact for
          everything drawn inside — the brow crops in particular are written in
          base pixels and would need rewriting against a scaled origin otherwise.
        */}
        <g transform={move}>
          <g transform={grow}>
            <image href={kit.base} x={0} y={0} width={200} height={200} />

            {/*
              The brows, lifted — the one piece of the performance that moves
              drawn artwork without a generator ever having seen it.
    
              Two draws per brow, both of them the base image again through a
              nested <svg>, which crops to its own bounds: source rect in the
              viewBox, destination rect in x/y/width/height. Nested rather than a
              clipPath so that two faces on one page cannot collide over an id.
    
              The crop is a plain translate. The strip under it is the part worth
              explaining: sliding the box up leaves a gap at the bottom still
              showing the brow that used to be there, and on a face wearing
              glasses there is no clear skin below to borrow — this portrait has
              about five pixels between brow and spectacle rim, and the rim runs
              diagonally, so it is nearer to nothing at one end.
    
              So the gap is filled by taking the box's own bottom row and
              stretching it — painted behind the crop rather than fitted into the
              gap beside it, for the reason written out below. It is the nearest
              skin there is, which makes it the right colour by construction.
              Filling from the *top* of the
              box instead was the first attempt and looked wrong immediately: the
              forehead is a good deal paler than the shaded skin just under a
              brow, so every raise flashed a bright rectangle. Uniform across the
              width, this drawing's skin is; uniform from forehead down to eye
              socket, it is not.
            */}
            {brows.map((brow) => {
              const fade = Math.min(BROW_FEATHER, brow.width / 3, brow.height / 2);
              const top = brow.y - brow.rise;
              const row = toHead(1);
              return (
                <g key={brow.id} mask={`url(#${maskId}-${brow.id})`}>
                  <mask
                    id={`${maskId}-${brow.id}`}
                    maskUnits="userSpaceOnUse"
                    x={brow.x}
                    y={top}
                    width={brow.width}
                    height={brow.height + brow.rise}
                  >
                    <rect
                      x={brow.x}
                      y={top}
                      width={brow.width}
                      height={brow.height + brow.rise}
                      fill="#fff"
                    />
                    <rect
                      x={brow.x}
                      y={top}
                      width={fade}
                      height={brow.height + brow.rise}
                      fill={`url(#${maskId}-fade-left)`}
                    />
                    <rect
                      x={brow.x + brow.width - fade}
                      y={top}
                      width={fade}
                      height={brow.height + brow.rise}
                      fill={`url(#${maskId}-fade-right)`}
                    />
                    <rect
                      x={brow.x}
                      y={top}
                      width={brow.width}
                      height={fade}
                      fill={`url(#${maskId}-fade-top)`}
                    />
                  </mask>
    
                  {/*
                    The bottom row of the box, stretched behind the whole of it.

                    Behind everything rather than into the gap alone, which is the
                    fix for a hairline of original brow that used to show along the
                    bottom of the lift. Sized to the gap, this strip's top edge and
                    the crop's bottom edge landed on the same y, and two abutting
                    nested <svg> viewports do not add up: each clips and
                    antialiases its own boundary independently, so the shared row
                    composites to 1 - (1 - a)(1 - b) and never reaches full
                    opacity. Whatever is behind the group shows through the
                    difference — and what is behind is the base image, still
                    holding the brow at the height it was drawn at. A thin dark
                    line, in the one place the eye is already looking.

                    It was there from the first version and invisible until now,
                    which is worth knowing before trusting any of this. At the 2.4
                    pixels the lift used to reach, that seam sat below the brow in
                    clear skin and leaked skin. The seam did not move; the brow
                    did, and a bigger lift walked the junction up into it.

                    So there is no junction any more. The strip covers the mask's
                    whole rect, the crop is painted over it, and the only thing
                    still visible of the strip is the gap the crop does not reach —
                    which is the same gap, filled with the same pixels, with
                    nothing left to seam against. Free, too: every unit of it under
                    the crop is hidden by an opaque draw, and the fade at the edges
                    applies to the composited group rather than between its
                    children.
                  */}
                  <svg
                    x={brow.x}
                    y={top}
                    width={brow.width}
                    height={brow.height + brow.rise}
                    viewBox={`${brow.x} ${brow.y + brow.height - row} ${brow.width} ${row}`}
                    preserveAspectRatio="none"
                  >
                    <image href={kit.base} x={0} y={0} width={200} height={200} />
                  </svg>
    
                  {/* The box itself, drawn where the brow is going. */}
                  <svg
                    x={brow.x}
                    y={top}
                    width={brow.width}
                    height={brow.height}
                    viewBox={`${brow.x} ${brow.y} ${brow.width} ${brow.height}`}
                  >
                    <image href={kit.base} x={0} y={0} width={200} height={200} />
                  </svg>
                </g>
              );
            })}
    
            {/*
              The poses: one fully opaque, the rest hidden — except during a
              press, when `mbp` is faded in on top of `rest`.

              That pairing is what lets the press be a *partial* one at all, and
              it works only because `rest` stays at full opacity underneath.
              These patches are painted over the base portrait, which has a mouth
              of its own; fade two of them to a half each and the composite keeps
              a quarter of the base showing through — a third mouth ghosting
              behind the other two, in the one place on the face nobody would
              miss it. Held at 1 with `mbp` coming up above it, which VISEME_ORDER
              guarantees is the paint order, the pair sums to exactly one opaque
              mouth at every depth, and what the eye gets is a dissolve between
              two poses rather than a blend of three.

              `pressed` is what keeps the second branch from ever firing during
              speech: it is zero for every frame the analyser is not reporting
              `rest`, so `mbp` cannot be laid over a vowel.

              The smile is the same arrangement again, with the same guard said
              a different way — `viseme === 'rest'` is exactly `level < SILENCE`,
              which is the test `pressed` performs with a ramp. It is last in the
              order and so painted over both, which costs nothing: the two never
              overlap in practice, since a press fires at the edges of a turn and
              a smile is only worn when there are no turns left to be at the edge
              of.
            */}
            {VISEME_ORDER.map((id) => {
              const patch = kit.patches[id];
              if (!patch) return null;
              return (
                <image
                  key={id}
                  href={patch}
                  x={toHead(mouth.x)}
                  y={toHead(mouth.y)}
                  width={toHead(mouth.width)}
                  height={toHead(mouth.height)}
                  opacity={patchOpacity(id, viseme, smiled, pressed, !kit.patches.laugh)}
                  style={
                    id === 'smile'
                      ? {
                          transition: `opacity ${smileFadeMs(smiled, viseme)}ms ease-in-out`,
                        }
                      : undefined
                  }
                />
              );
            })}
    
            {lids.map((lid) =>
              lid.patch ? (
                <image
                  key={lid.id}
                  href={lid.patch}
                  x={toHead(lid.box.x)}
                  y={toHead(lid.box.y)}
                  width={toHead(lid.box.width)}
                  height={toHead(lid.box.height)}
                  opacity={shut ? 1 : 0}
                />
              ) : null,
            )}
    
            <circle
              ref={mouthRef}
              cx={toHead(mouth.x + mouth.width / 2)}
              cy={toHead(mouth.y + mouth.height / 2)}
              r="1"
              fill="none"
              opacity="0"
            />
          </g>
        </g>
      </svg>
    );
  }

  /**
   * The drawn mouth, pressed.
   *
   * A lerp of the three numbers rather than a fourth named shape, which is what
   * LipShape is parameterised for: the placeholder interpolates its way between
   * poses already, and a press is just a partial trip toward one of them. Where
   * a kit dissolves between two pictures, this moves the actual geometry — the
   * same gesture arrived at by the only means each face has.
   *
   * Taken from the live `shape` rather than from VISEMES.rest, so that a press
   * still releasing when the first syllable lands eases out of wherever the
   * mouth has got to instead of snapping back from a pose it has already left.
   */
  const drawn: LipShape =
    pressed > 0
      ? {
          w: shape.w + (VISEMES.mbp.w - shape.w) * pressed,
          up: shape.up + (VISEMES.mbp.up - shape.up) * pressed,
          down: shape.down + (VISEMES.mbp.down - shape.down) * pressed,
        }
      : shape;

  return (
    <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible" aria-hidden="true">
      {/*
        No overscan here, and none wanted: the placeholder is a head on nothing,
        so there is no frame edge to swing out of view and nothing behind it to
        uncover. Scaling it a tenth larger would only make the head a tenth
        larger, which is a change to the drawing rather than to the motion.
      */}
      <g transform={move}>
        {/* Lit from the upper left, so the head reads as round, not as a disc. */}
        <defs>
          <radialGradient id="face-shade" cx="37%" cy="30%" r="80%">
            <stop offset="0%" stopColor={SKIN} />
            <stop offset="100%" stopColor={SKIN_SHADE} />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="86" fill="url(#face-shade)" />

        <g fill={INK}>
          <ellipse cx="72" cy="86" rx="8.5" ry={8.5 * eyeOpen} />
          <ellipse cx="128" cy="86" rx="8.5" ry={8.5 * eyeOpen} />
        </g>

        <g
          stroke={INK}
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
          transform={`translate(0 ${-drawnBrowRise})`}
        >
          <path d="M 61 64 Q 72 58 84 63" />
          <path d="M 116 63 Q 128 58 139 64" />
        </g>

        <g fill={SKIN_SHADE} opacity="0.5">
          <ellipse cx="55" cy="120" rx="12" ry="8" />
          <ellipse cx="145" cy="120" rx="12" ry="8" />
        </g>

        {/*
          The mouth slot. Its own coordinate system, 1:1 with MOUTH_BOX, so the
          shapes in visemes.ts are written in the same numbers they are drawn
          in — and so drawn art exported at those bounds needs no rescaling.
        */}
        <svg
          x={MOUTH_X}
          y={MOUTH_Y}
          width={MOUTH_BOX.width}
          height={MOUTH_BOX.height}
          viewBox={`0 0 ${MOUTH_BOX.width} ${MOUTH_BOX.height}`}
          overflow="visible"
        >
          <path d={lipPath(drawn)} fill={THROAT} stroke={INK} strokeWidth="2.5" />
          <circle
            ref={mouthRef}
            cx={MOUTH_BOX.width / 2}
            cy={MOUTH_BOX.height / 2}
            r="1"
            fill="none"
            opacity="0"
          />
        </svg>
      </g>
    </svg>
  );
}
