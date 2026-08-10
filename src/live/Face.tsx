import { useEffect, useRef, useState } from 'react';
import { MOUTH_BOX, lipPath, type LipShape } from './visemes';

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

interface FaceProps {
  shape: LipShape;
  /** Smoothed loudness, 0 to 1. Drives everything that is not the mouth. */
  level: number;
  /** Anchor for the speech bubble's tail. Marks the mouth, not the head. */
  mouthRef?: React.Ref<SVGCircleElement>;
}

export default function Face({ shape, level, mouthRef }: FaceProps) {
  const [blinking, setBlinking] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const schedule = () => {
      // Jittered rather than metronomic — a face that blinks on the beat is
      // more unsettling than one that does not blink at all.
      const delay = BLINK_EVERY_MS * (0.45 + Math.random());
      timers.current.push(
        window.setTimeout(() => {
          setBlinking(true);
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
   * The rest of the performance, all of it from `level`.
   *
   * Six mouth shapes on a rigid head reads as a puppet; a head that lifts into
   * an emphasised syllable reads as someone talking. It costs three numbers.
   */
  const lift = level * 4;
  const browLift = level * 3.5;
  const eyeOpen = blinking ? 0.08 : 1 - level * 0.12;

  return (
    <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible" aria-hidden="true">
      <g transform={`translate(0 ${-lift}) rotate(${level * 0.8} 100 180)`}>
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
          transform={`translate(0 ${-browLift})`}
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
          <path d={lipPath(shape)} fill={THROAT} stroke={INK} strokeWidth="2.5" />
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
