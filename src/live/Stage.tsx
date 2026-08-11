import { useLayoutEffect, useRef, useState } from 'react';
import type { AudioTap } from '../realtime/audio';
import type { FaceKit } from '../facekit/kit';
import SpeakingFace from './SpeakingFace';
import type { MouthDriver } from './visemes';
import Bubble, { BUBBLE_FILL } from './Bubble';

/**
 * The face and its two balloons.
 *
 * All three share one positioned box because the tails are drawn across it in a
 * single overlay: a tail has to start on a balloon and end on a mouth, and
 * neither element can reach the other. Everything it needs arrives as props, so
 * the page above it decides *what* is said and this decides how it looks.
 */

/**
 * A tail: a short base on the balloon, a point at whatever it indicates.
 *
 * Which of the four edges it leaves by is decided the way a ray leaves a
 * rectangle — by comparing the two offsets against the balloon's own half-width
 * and half-height, not against each other. A balloon is much wider than it is
 * tall, so a target a little below and a long way left exits the *side*; judging
 * that on the vertical offset alone puts the base on the bottom edge, where its
 * width lies along the wrong axis and the triangle collapses into a sliver.
 */
function tailPoints(bubble: DOMRect, stage: DOMRect, apexX: number, apexY: number): string {
  const left = bubble.left - stage.left;
  const top = bubble.top - stage.top;
  const right = left + bubble.width;
  const bottom = top + bubble.height;

  /** Half the width of the tail where it meets the balloon. */
  const half = 11;
  /** Keeps the base off the rounded corners, which it would otherwise float over. */
  const inset = 22;

  const dx = apexX - (left + bubble.width / 2);
  const dy = apexY - (top + bubble.height / 2);
  const sideways = Math.abs(dx) * bubble.height > Math.abs(dy) * bubble.width;

  if (sideways) {
    const baseX = dx < 0 ? left : right;
    const baseY = Math.min(Math.max(apexY, top + inset), bottom - inset);
    return `${baseX},${baseY - half} ${baseX},${baseY + half} ${apexX},${apexY}`;
  }

  const baseY = dy < 0 ? top : bottom;
  const baseX = Math.min(Math.max(apexX, left + inset), right - inset);
  return `${baseX - half},${baseY} ${baseX + half},${baseY} ${apexX},${apexY}`;
}

interface StageProps {
  agentText: string;
  userText: string;
  /** Null between calls: nothing to listen to, so the mouth rests. */
  tap: AudioTap | null;
  /** Which way of measuring the audio drives the mouth. */
  driver: MouthDriver;
  /** How far ahead the scheduled driver runs, in milliseconds. */
  lookaheadMs: number;
  /** Artwork for the face to wear, from /facekit. Null keeps the placeholder. */
  kit?: FaceKit | null;
  /** Dims the agent balloon once the words are no longer being said. */
  speaking: boolean;
}

export default function Stage({
  agentText,
  userText,
  tap,
  driver,
  lookaheadMs,
  kit,
  speaking,
}: StageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const agentBubble = useRef<HTMLDivElement>(null);
  const userBubble = useRef<HTMLDivElement>(null);
  const mouth = useRef<SVGCircleElement>(null);
  const [tails, setTails] = useState({ agent: '', user: '' });

  /**
   * Where the tails point.
   *
   * Measured rather than hard-coded, so a tail still lands on the mouth when
   * the balloon grows a line, when the window changes shape, and — the reason
   * it is worth the refs — when this placeholder head is replaced by drawn art
   * whose mouth is somewhere else entirely.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const box = stage.current?.getBoundingClientRect();
      if (!box) return;

      const target = mouth.current?.getBoundingClientRect();
      const agent =
        agentBubble.current && target && agentText
          ? tailPoints(
              agentBubble.current.getBoundingClientRect(),
              box,
              target.left + target.width / 2 - box.left,
              target.top + target.height / 2 - box.top,
            )
          : '';

      // The user's tail has nothing on screen to reach, so it points off the
      // near edge — at whoever is doing the talking.
      let user = '';
      if (userBubble.current && userText) {
        const rect = userBubble.current.getBoundingClientRect();
        user = tailPoints(rect, box, rect.right - box.left - 30, rect.bottom - box.top + 22);
      }

      setTails((current) =>
        current.agent === agent && current.user === user ? current : { agent, user },
      );
    };

    measure();
    // Text changes the balloons' size, and their size moves the tails. An
    // observer catches that as well as the window being dragged about.
    const observer = new ResizeObserver(measure);
    for (const node of [stage.current, agentBubble.current, userBubble.current]) {
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [agentText, userText]);

  return (
    <div
      ref={stage}
      className="relative flex min-h-[19rem] flex-col rounded-2xl border border-slate-900 bg-slate-900/40 p-5"
    >
      {/*
        Between the two: over the head, so a tail reaches the mouth instead of
        stopping at the hairline, and under the balloons, so its base is hidden
        beneath the one it belongs to.
      */}
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
        {tails.agent && <polygon points={tails.agent} fill={BUBBLE_FILL.agent} />}
        {tails.user && <polygon points={tails.user} fill={BUBBLE_FILL.user} />}
      </svg>

      {/*
        Bottom-anchored, so spare height opens up above the balloon rather than
        between it and the head. A tail stretched across a tall stage stops
        reading as a tail and starts reading as a wire.
      */}
      {/*
        Bottom-anchored, so spare height opens up above the pair rather than
        between them. The agent's balloon sits beside the head at roughly mouth
        height: a tail that has to climb over the face crosses it diagonally and
        reads as a wire rather than as speech.
      */}
      <div className="relative flex flex-1 flex-col justify-end gap-3">
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="relative z-0 h-32 w-32 shrink-0 sm:h-40 sm:w-40">
            <SpeakingFace
              tap={tap}
              driver={driver}
              lookaheadMs={lookaheadMs}
              kit={kit}
              mouthRef={mouth}
            />
          </div>
          <div className="min-w-0 max-w-[30rem]">
            <Bubble
              ref={agentBubble}
              role="agent"
              text={agentText}
              stale={!speaking}
              placeholder="The tutor's words appear here, in time with the voice."
            />
          </div>
        </div>

        <div className="flex justify-end pl-10">
          <Bubble ref={userBubble} role="user" text={userText} placeholder="Your words." />
        </div>
      </div>
    </div>
  );
}
