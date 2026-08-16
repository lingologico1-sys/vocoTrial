import { useEffect, useRef, useState } from 'react';
import type { AudioTap } from '../realtime/audio';
import type { FaceKit } from '../facekit/kit';
import Face from './Face';
import type { HeadMotion, MotionCadence, TiltCue, TiltTrigger } from './headMotion';
import {
  MouthAnalyser,
  VISEMES,
  reactiveFeatures,
  scheduledFeatures,
  type LipShape,
  type MouthDriver,
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
  /** Artwork for the face to wear. Null leaves the drawn placeholder in place. */
  kit?: FaceKit | null;
  /** Which way the head moves. Switchable mid-call, like the driver above. */
  motion?: HeadMotion;
  /** On what schedule it moves. Switchable mid-call, and most worth doing so. */
  cadence?: MotionCadence;
  /** Whether some blinks carry a brow lift. */
  browBlink?: boolean;
  /** Which events may lean the head sideways. See TILT_TRIGGERS. */
  tilt?: readonly TiltTrigger[];
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
  kit,
  motion,
  cadence,
  browBlink,
  tilt,
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
      const next = mouthAnalyser.read(dt);
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
      tilt={tilt}
      tiltCue={tiltCue}
      speaking={speaking}
      mouthRef={mouthRef}
    />
  );
}
