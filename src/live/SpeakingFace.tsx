import { useEffect, useRef, useState } from 'react';
import type { AudioTap } from '../realtime/audio';
import type { FaceKit } from '../facekit/kit';
import Face from './Face';
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
  /** How far the brows travel, in head units. Switchable mid-call, like the lean. */
  browLift?: number;
  /** Which events may lean the head sideways. See TILT_TRIGGERS. */
  tilt?: readonly TiltTrigger[];
  /** How far it leans, in degrees. Switchable mid-call, like the lookahead. */
  tiltRoll?: number;
  /** The latest question or handover. See TiltCue. */
  tiltCue?: TiltCue | null;
  /** Whether the agent's audio is playing. Only the tilt reads it. */
  speaking?: boolean;
  mouthRef?: React.Ref<SVGCircleElement>;
}

const RESTING: { shape: LipShape; level: number; viseme: Viseme } = {
  shape: VISEMES.rest,
  level: 0,
  viseme: 'rest',
};

export default function SpeakingFace({
  tap,
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
  browLift,
  tilt,
  tiltRoll,
  tiltCue,
  speaking,
  mouthRef,
}: SpeakingFaceProps) {
  const [mouth, setMouth] = useState(RESTING);
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
    if (!tap) return;
    analyser.current?.setSource(
      driver === 'scheduled'
        ? scheduledFeatures(tap, () => lookahead.current / 1000)
        : reactiveFeatures(tap),
    );
  }, [tap, driver]);

  useEffect(() => {
    if (!tap) {
      analyser.current = null;
      setMouth(RESTING);
      return;
    }

    const source =
      driver === 'scheduled'
        ? scheduledFeatures(tap, () => lookahead.current / 1000)
        : reactiveFeatures(tap);
    const mouthAnalyser = new MouthAnalyser(source);
    analyser.current = mouthAnalyser;

    let frame = 0;
    let last = performance.now();

    const step = (time: number) => {
      // Clamped: a backgrounded tab resumes with a gap of seconds, and feeding
      // that in as one frame would snap every smoothed value to its target.
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      const next = mouthAnalyser.read(dt, roundnessRef.current, languageRef.current);
      // A new object each frame on purpose — the analyser mutates its shape in
      // place, so passing it through unchanged would never re-render.
      // The viseme travels alongside the shape rather than instead of it: the
      // drawn face interpolates the shape, drawn artwork switches on the
      // viseme, and which of the two is on screen is not this loop's business.
      setMouth({ shape: { ...next.shape }, level: next.level, viseme: next.viseme });
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // The driver is deliberately absent: switching it is handled above, without
    // tearing down the analyser. Listing it here would defeat that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tap]);

  return (
    <Face
      shape={mouth.shape}
      viseme={mouth.viseme}
      level={mouth.level}
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
      mouthRef={mouthRef}
    />
  );
}
