import { useEffect, useRef, useState } from 'react';
import type { AudioTap } from '../realtime/audio';
import type { FaceKit } from '../facekit/kit';
import Face from './Face';
import { MarkMouth, type VisemeMark } from './polly';
import { laughBob } from './headMotion';
import type {
  HeadMotion,
  MotionCadence,
  PressTrigger,
  TiltCue,
  TiltTrigger,
} from './headMotion';
import {
  MouthAnalyser,
  VISEMES,
  reactiveFeatures,
  scheduledFeatures,
  type LipShape,
  type MouthDriver,
  type RoundnessMode,
  type Viseme,
} from './visemes';

/**
 * Runs the mouth.
 *
 * The animation loop lives here rather than in the page so that sixty frames a
 * second of mouth movement re-render a face and nothing else — not the
 * transcript, not the balloons, not the log. The page updates when words
 * arrive; this updates when the sound changes.
 */

interface SpeakingFaceProps {
  /** Null between calls, when there is nothing to listen to. */
  tap: AudioTap | null;
  /**
   * Marks to wear instead of measuring anything. Supplying these and `audioTime`
   * switches the mouth to MarkMouth and ignores `tap`, `driver` and `roundness`.
   *
   * Not a third entry in MouthDriver, deliberately. That union is mirrored into
   * SessionMouthDriver and travels inside published session config, so a value
   * added there is a value a teacher's saved lesson can request — and a live call
   * has no marks to give it. Marks arrive with a particular recording, so the
   * thing that has them passes them, and nothing that does not can ask for them.
   */
  marks?: readonly VisemeMark[] | null;
  /**
   * Seconds into that recording currently being *heard*, read fresh each frame.
   *
   * The caller owns it because only it knows how the audio is being played. See
   * the note on MarkMouth's constructor: whatever produces this has to subtract
   * output latency, or the mouth leads by however far the speakers are behind.
   */
  audioTime?: (() => number) | null;
  /**
   * What the rest of the face does, and when. Read on the mouth's clock.
   *
   * A second channel rather than a field on each mark, because Viseme is a vocabulary
   * about lips and eyes are not lips. See ExpressionSpan in lipsync/published.ts.
   */
  expressions?: ReadonlyArray<{
    startMs: number;
    endMs: number;
    eyesClosed?: boolean;
    nod?: boolean;
  }> | null;
  /** Which way of measuring the audio drives the mouth. Switchable mid-call. */
  driver: MouthDriver;
  /** How far ahead the scheduled driver runs, in milliseconds. Ignored by the other. */
  lookaheadMs: number;
  /** What evidence the lips are decided on. See ROUNDNESS_MODES. Switchable mid-call. */
  roundness?: RoundnessMode;
  /** ISO-639-1 code of the language being spoken. Only `auto` roundness reads it. */
  language?: string;
  /** Artwork for the face to wear. Null leaves the drawn placeholder in place. */
  kit?: FaceKit | null;
  /** Which way the head moves. Switchable mid-call, like the driver above. */
  motion?: HeadMotion;
  /** On what schedule it moves. Switchable mid-call, and most worth doing so. */
  cadence?: MotionCadence;
  /** Whether some blinks carry a brow lift. */
  browBlink?: boolean;
  /** Which moments close the lips. See PRESS_TRIGGERS in headMotion.ts. */
  press?: readonly PressTrigger[];
  /** Whether the mic is hearing a voice. The `reply` press and the nod read it. */
  heard?: boolean;
  /** Whether the head may nod while it does. See DEFAULT_LISTEN_NOD. */
  listenNod?: boolean;
  /** How far it dips, in head units. See DEFAULT_NOD_DEPTH. */
  nodDepth?: number;
  /** What share of finished answers get one. See DEFAULT_NOD_CHANCE. */
  nodChance?: number;
  /** How far the brows travel, in head units. Switchable mid-call, like the lean. */
  browLift?: number;
  /** What share of blinks carry a flash. See DEFAULT_BROW_FLASH_CHANCE. */
  browFlashChance?: number;
  /** Which events may lean the head sideways. See TILT_TRIGGERS. */
  tilt?: readonly TiltTrigger[];
  /** How far it leans, in degrees. Switchable mid-call, like the lookahead. */
  tiltRoll?: number;
  /** How long it takes to get there. See DEFAULT_TILT_SETTLE. */
  tiltSettle?: number;
  /** What share of its conversation events are taken. See DEFAULT_TILT_CHANCE. */
  tiltChance?: number;
  /** The latest question or handover. See TiltCue. */
  tiltCue?: TiltCue | null;
  /** Whether the agent's audio is playing. Only the tilt reads it. */
  speaking?: boolean;
  /** Whether a smile is warranted, at the two ends of a call. See Face. */
  smiling?: boolean;
  /** Whether that smile is held rather than let go on a clock. See Face. */
  smileSustain?: boolean;
  /** How long it is worn, and how long until the next. See DEFAULT_SMILE_HOLD. */
  smileHold?: number;
  smileGap?: number;
  /** Lets a kit paint past the frame, for a caller that clips already. See Face. */
  bleed?: boolean;
  mouthRef?: React.Ref<SVGCircleElement>;
}

const RESTING: { shape: LipShape; level: number; viseme: Viseme } = {
  shape: VISEMES.rest,
  level: 0,
  viseme: 'rest',
};

export default function SpeakingFace({
  tap,
  marks,
  audioTime,
  expressions,
  driver,
  lookaheadMs,
  roundness,
  language,
  kit,
  motion,
  cadence,
  browBlink,
  press,
  heard,
  listenNod,
  nodDepth,
  nodChance,
  browLift,
  browFlashChance,
  tilt,
  tiltRoll,
  tiltSettle,
  tiltChance,
  tiltCue,
  speaking,
  smiling,
  smileSustain,
  smileHold,
  smileGap,
  bleed,
  mouthRef,
}: SpeakingFaceProps) {
  const [mouth, setMouth] = useState(RESTING);
  const [eyesShut, setEyesShut] = useState(false);
  /**
   * How far the head is dipped for a laugh, this frame.
   *
   * Kept beside `eyesShut` because it is the same kind of value — something an
   * expression span says about a moment in the clip — and computed in the same
   * place for the reason that matters: both have to be read off the instant the
   * mouth was asked about, or the head bobs against a pose it is meant to be
   * carrying. See the note where they are set.
   */
  const [laughNod, setLaughNod] = useState(0);
  const analyser = useRef<MouthAnalyser | null>(null);
  /**
   * Read by the scheduled source on every frame rather than captured when it is
   * built, so dragging the slider retunes the mouth that is already talking.
   */
  const lookahead = useRef(lookaheadMs);

  useEffect(() => {
    lookahead.current = lookaheadMs;
  }, [lookaheadMs]);

  /**
   * Read per frame rather than captured, for the lookahead's reason exactly: the
   * loop below must not be rebuilt to change this, or flipping the switch would
   * reset the running peak and the smoothing and cost a second of the mouth
   * settling in — during the one sentence the comparison is being made on.
   */
  const roundnessRef = useRef(roundness);
  const languageRef = useRef(language);
  useEffect(() => {
    roundnessRef.current = roundness;
    languageRef.current = language;
  }, [roundness, language]);

  // Switching driver keeps the analyser, and with it the running peak and the
  // smoothing — so what changes on screen is the timing under comparison and
  // not a second of the mouth settling in.
  useEffect(() => {
    // Marks do not have a source to swap; MarkMouth is rebuilt below instead.
    if (!tap || marks) return;
    analyser.current?.setSource(
      driver === 'scheduled'
        ? scheduledFeatures(tap, () => lookahead.current / 1000)
        : reactiveFeatures(tap),
    );
  }, [tap, marks, driver]);

  useEffect(() => {
    /**
     * One loop, two mouths, and the branch is only over which one it reads.
     *
     * MarkMouth was built as the counterpart to MouthAnalyser and shares its
     * shape exactly — `read(dt)` returns a MouthFrame, `silence()` snaps it shut
     * — which is what lets everything below the first few lines be common. What
     * differs is only where the answer comes from: one measures a spectrum, the
     * other looks up a decision something else already made.
     */
    if (!marks || !audioTime) {
      if (!tap) {
        analyser.current = null;
        setMouth(RESTING);
        return;
      }
    }

    const markMouth =
      marks && audioTime
        ? new MarkMouth(marks, audioTime, () => lookahead.current / 1000)
        : null;

    let mouthAnalyser: MouthAnalyser | null = null;
    if (!markMouth && tap) {
      const source =
        driver === 'scheduled'
          ? scheduledFeatures(tap, () => lookahead.current / 1000)
          : reactiveFeatures(tap);
      mouthAnalyser = new MouthAnalyser(source);
      analyser.current = mouthAnalyser;
    }

    if (!markMouth && !mouthAnalyser) return;

    let frame = 0;
    let last = performance.now();

    const step = (time: number) => {
      // Clamped: a backgrounded tab resumes with a gap of seconds, and feeding
      // that in as one frame would snap every smoothed value to its target.
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      const next = markMouth
        ? markMouth.read(dt)
        : mouthAnalyser!.read(dt, roundnessRef.current, languageRef.current);
      // A new object each frame on purpose — the analyser mutates its shape in
      // place, so passing it through unchanged would never re-render.
      // The viseme travels alongside the shape rather than instead of it: the
      // drawn face interpolates the shape, drawn artwork switches on the
      // viseme, and which of the two is on screen is not this loop's business.
      setMouth({ shape: { ...next.shape }, level: next.level, viseme: next.viseme });

      // The same instant the mouth was asked about, so the two cannot disagree about
      // where in the clip they are.
      if (expressions && expressions.length > 0 && audioTime) {
        const at = audioTime() * 1000;
        setEyesShut(
          expressions.some((e) => e.eyesClosed && at >= e.startMs && at < e.endMs),
        );
        // The laugh's rhythm. The mouth holds one pose across a laugh — see the
        // laugh entries in tags.ts, where the pulse used to live — so this is the
        // whole of what makes it read as laughter rather than as a held grin.
        // Phase comes from where in the span the clip is, so a scrub or a pause
        // lands the head exactly where the audio says it should be.
        const bobbing = expressions.find(
          (e) => e.nod && at >= e.startMs && at < e.endMs,
        );
        setLaughNod(
          bobbing ? laughBob(at - bobbing.startMs, bobbing.endMs - bobbing.startMs) : 0,
        );
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // The driver is deliberately absent: switching it is handled above, without
    // tearing down the analyser. Listing it here would defeat that.
    //
    // `marks` and `audioTime` are present because a new recording genuinely is a
    // new timeline, and MarkMouth carries no running peak or smoothing state that
    // rebuilding would cost anything to lose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tap, marks, audioTime, expressions]);

  return (
    <Face
      shape={mouth.shape}
      viseme={mouth.viseme}
      level={mouth.level}
      kit={kit}
      eyesShut={eyesShut}
      laughNod={laughNod}
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
      tiltCue={tiltCue}
      speaking={speaking}
      smiling={smiling}
      smileSustain={smileSustain}
      smileHold={smileHold}
      smileGap={smileGap}
      bleed={bleed}
      mouthRef={mouthRef}
    />
  );
}
