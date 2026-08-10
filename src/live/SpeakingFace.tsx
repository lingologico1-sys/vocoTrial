import { useEffect, useRef, useState } from 'react';
import type { AudioTap } from '../realtime/audio';
import Face from './Face';
import { MouthAnalyser, VISEMES, type LipShape } from './visemes';

/**
 * Runs the mouth.
 *
 * The animation loop lives here rather than in the page so that sixty frames a
 * second of mouth movement re-render a face and nothing else — not the
 * transcript, not the bubbles, not the log. The page updates when words arrive;
 * this updates when the sound changes.
 */

interface SpeakingFaceProps {
  /** Null between calls, when there is nothing to listen to. */
  tap: AudioTap | null;
  mouthRef?: React.Ref<SVGCircleElement>;
}

const RESTING: { shape: LipShape; level: number } = { shape: VISEMES.rest, level: 0 };

export default function SpeakingFace({ tap, mouthRef }: SpeakingFaceProps) {
  const [mouth, setMouth] = useState(RESTING);
  const frame = useRef(0);

  useEffect(() => {
    if (!tap) {
      setMouth(RESTING);
      return;
    }

    const analyser = new MouthAnalyser(tap);
    let last = performance.now();

    const step = (time: number) => {
      // Clamped: a backgrounded tab resumes with a gap of seconds, and feeding
      // that in as one frame would snap every smoothed value to its target.
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      const next = analyser.read(dt);
      // A new object each frame on purpose — the analyser mutates its shape in
      // place, so passing it through unchanged would never re-render.
      setMouth({ shape: { ...next.shape }, level: next.level });
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [tap]);

  return <Face shape={mouth.shape} level={mouth.level} mouthRef={mouthRef} />;
}
