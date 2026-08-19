import type { FaceKit } from '../facekit/kit';
import SpeakingFace from '../live/SpeakingFace';
import type { TiltCue } from '../live/headMotion';
import type { AudioTap } from '../realtime/types';
import type { StudentSession } from '../realtime/session';
import LearnerPill from './LearnerPill';
import SpeechBubble from './SpeechBubble';
import { FR } from './strings';

/**
 * The left-hand panel: a face, what it is saying, and what you said back.
 *
 * Laid out top to bottom rather than side by side, which is the one structural
 * difference from liveTrial's Stage and the reason this is a separate component
 * rather than a prop on that one. Everything that made Stage complicated — the
 * measured tails, the two balloons reaching for one mouth — exists to solve a
 * problem this arrangement does not have.
 *
 * The face itself is liveTrial's, unchanged. It takes the whole performance as
 * props and knows nothing about the page around it, which is exactly why the
 * student sees the tutor that was tuned rather than a second implementation of
 * it.
 */

interface TutorStageProps {
  session: StudentSession;
  kit: FaceKit | null;
  agentText: string;
  learnerText: string;
  tap: AudioTap | null;
  speaking: boolean;
  heard: boolean;
  muted: boolean;
  live: boolean;
  tiltCue: TiltCue | null;
  onToggleMute: () => void;
  onWord: (word: string, context: string) => void;
}

export default function TutorStage({
  session,
  kit,
  agentText,
  learnerText,
  tap,
  speaking,
  heard,
  muted,
  live,
  tiltCue,
  onToggleMute,
  onWord,
}: TutorStageProps) {
  return (
    <div className="flex h-full flex-col items-center gap-8">
      {/*
        The head is inset inside the ring rather than cropped to it.

        A circle inscribed in the artwork's square passes exactly through the
        bottom edge, which is where the chin is — kit.ts measures it as the
        lowest row of the resting face — so cropping square to circle takes the
        jaw off. Six percent of clearance all round costs a little size and
        keeps the face whole, whatever kit is worn.
      */}
      <div
        className={`relative h-56 w-56 shrink-0 overflow-hidden rounded-full border-[3px] bg-lingo-cream shadow-lingo-pop transition-colors duration-300 ${
          speaking ? 'border-lingo-accent' : 'border-lingo-border-strong'
        }`}
      >
        <div className="absolute inset-[6%]">
          <SpeakingFace
            tap={tap}
            driver={session.driver}
            lookaheadMs={session.lookaheadMs}
            roundness={session.roundness}
            language={session.language}
            kit={kit}
            motion={session.motion}
            cadence={session.cadence}
            browBlink={session.browBlink}
            press={session.press}
            heard={heard}
            listenNod={session.listenNod}
            nodDepth={session.nodDepth}
            browLift={session.browLift}
            tilt={session.tilt}
            tiltRoll={session.tiltRoll}
            tiltCue={tiltCue}
            speaking={speaking}
          />
        </div>
      </div>

      <SpeechBubble
        text={agentText}
        placeholder={FR.bubbleIdle}
        stale={!speaking}
        onWord={onWord}
      />

      {/* Pushes the pill to the foot of the panel, wherever the bubble ends. */}
      <div className="flex-1" />

      <LearnerPill
        text={learnerText}
        live={live}
        muted={muted}
        heard={heard}
        onToggleMute={onToggleMute}
        onWord={onWord}
      />
    </div>
  );
}
