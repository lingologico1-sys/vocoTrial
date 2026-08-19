import type { FaceKit } from '../facekit/kit';
import SpeakingFace from '../live/SpeakingFace';
import type { TiltCue } from '../live/headMotion';
import type { AudioTap } from '../realtime/types';
import type { StudentSession } from '../realtime/session';
import LearnerPill from './LearnerPill';
import SpeechBubble from './SpeechBubble';
import { FR } from './strings';

/**
 * The left-hand panel: a face, what it is saying, and what you said back —
 * with the call button riding in that last strip rather than under it.
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
  /** What the call button says now. It rides in the pill — see LearnerPill. */
  callLabel: string;
  callBusy: boolean;
  onCall: () => void;
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
  callLabel,
  callBusy,
  onCall,
  onToggleMute,
  onWord,
}: TutorStageProps) {
  /*
   * `min-h-0` on the column so the balloon is what gives when the window is
   * short. Without it this refuses to shrink below its content and the pill —
   * the one thing on the page the learner has to be able to reach — slides off
   * the bottom instead.
   */
  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-8">
      {/*
        The head is inset inside the ring rather than cropped to it.

        A circle inscribed in the artwork's square passes exactly through the
        bottom edge, which is where the chin is — kit.ts measures it as the
        lowest row of the resting face — so cropping square to circle takes the
        jaw off. Clearance all round costs a little size and keeps the face
        whole, whatever kit is worn.

        THE RING DOES THE CLIPPING, WHICH IS WHAT `bleed` BUYS. Face.tsx draws a
        kit TILT_OVERSCAN wider than its frame — 18% once any tilt trigger is
        armed, so 9% off every edge — and normally cuts the spill back to the
        square. A portrait has less headroom than that above the crown: the
        bundled kit's hair starts 3.5% down the canvas. So the square cut used
        to land on the hair and shear the top of the head flat. Letting the
        artwork spill and clipping to the circle instead moves the cut to a
        curve that is furthest away exactly where the head is tallest.

        SEVEN AND A HALF PERCENT, and both directions of that are measured
        rather than chosen. Less and the crown climbs back into the rim; more
        and the ring's own inscribed circle grows past the artwork, which would
        show as background at the four points where a circle reaches furthest
        past its square. The window between the two is about a percent wide on
        this kit, and this sits in it with the crown clearing by a few pixels.

        White, not cream, for the last of it: a deep lean swings the artwork's
        corners and can uncover a sliver at the rim for an instant, and white is
        the colour a kit is flattened onto — see flattenBackground — so the
        sliver is invisible instead of nearly invisible.
      */}
      <div
        className={`relative h-56 w-56 shrink-0 overflow-hidden rounded-full border-[3px] bg-lingo-surface shadow-lingo-pop transition-colors duration-300 ${
          speaking ? 'border-lingo-accent' : 'border-lingo-border-strong'
        }`}
      >
        <div className="absolute inset-[7.5%]">
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
            nodChance={session.nodChance}
            browLift={session.browLift}
            browFlashChance={session.browFlashChance}
            tilt={session.tilt}
            tiltRoll={session.tiltRoll}
            tiltSettle={session.tiltSettle}
            tiltChance={session.tiltChance}
            tiltCue={tiltCue}
            speaking={speaking}
            bleed
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
        callLabel={callLabel}
        callBusy={callBusy}
        onCall={onCall}
        onToggleMute={onToggleMute}
        onWord={onWord}
      />
    </div>
  );
}
