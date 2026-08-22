import type { FaceKit } from '../facekit/kit';
import SpeakingFace from '../live/SpeakingFace';
import type { TiltCue } from '../live/headMotion';
import type { AudioTap } from '../realtime/types';
import type { PublishedSetup } from '../realtime/session';
import LearnerPill from './LearnerPill';
import SpeechBubble from './SpeechBubble';
import { FR } from './strings';

/**
 * The left-hand panel: a face, what it is saying, and what you said back —
 * with the whole of the call now riding on the microphone in that last strip.
 *
 * Laid out top to bottom rather than side by side, which is the one structural
 * difference from studio's Stage and the reason this is a separate component
 * rather than a prop on that one. Everything that made Stage complicated — the
 * measured tails, the two balloons reaching for one mouth — exists to solve a
 * problem this arrangement does not have.
 *
 * The face itself is studio's, unchanged. It takes the whole performance as
 * props and knows nothing about the page around it, which is exactly why the
 * student sees the tutor that was tuned rather than a second implementation of
 * it.
 */

interface TutorStageProps {
  session: PublishedSetup;
  kit: FaceKit | null;
  agentText: string;
  learnerText: string;
  tap: AudioTap | null;
  speaking: boolean;
  heard: boolean;
  /** Whether the learner's last words are still being transcribed. The pill
   *  spends that span on a loader — see LearnerPill. */
  transcribing: boolean;
  live: boolean;
  /** Whether the tutor's opening turn is over. The pill's glyph turns on it. */
  openingDone: boolean;
  /** Mid-connect. The microphone carries this too — see LearnerPill. */
  busy: boolean;
  tiltCue: TiltCue | null;
  /** What the pill says before a call: start, or start again. */
  idleHint: string;
  onCall: () => void;
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
  transcribing,
  live,
  openingDone,
  busy,
  tiltCue,
  idleHint,
  onCall,
  onWord,
}: TutorStageProps) {
  /*
   * NOTHING IN THIS COLUMN SCROLLS, AND THE ORDER OF WHO YIELDS IS WHY.
   *
   * `min-h-0` lets the column shrink below its content; the face is fixed, the
   * balloon is `flex-initial` and so takes only what its text needs, and the
   * spacer below it holds every remaining pixel. So a pill that wraps to three
   * lines eats the spacer and grows upward — where it used to grow downward,
   * overflow the panel and hand the whole left-hand side a scrollbar with the
   * one control the learner has to reach sitting below its fold.
   *
   * Once the spacer is gone the balloon gives next, and only then does anything
   * scroll at all: quietly, inside the balloon, which is the one place a
   * conversation can genuinely outrun the window. See SpeechBubble.
   */
  return (
    /*
      `flex-1`, not `h-full`. The panel holding this also carries the line that
      says why a call ended, and a stage claiming the full height of the column
      would push that line out of a panel that — since it stopped scrolling —
      clips instead of scrolling it back into reach. Sharing the column means
      the notice costs the stage its own height, which the spacer below pays.
    */
    <div className="flex min-h-0 flex-1 flex-col items-center gap-8">
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
      {/*
        FOUR PIXELS, MATCHING THE RIGHT-HAND PANEL'S FRAME RATHER THAN THE 3 IT
        USED TO CARRY. The column around this lost its card, so the panel across
        the gutter is now the only heavy edge on the page and the eye drifts to
        it — toward the reference material and away from the person talking.
        This ring is the left side's anchor, so it takes the same weight.

        Still tan and not terracotta: clay-pink is the frame colour, and a
        second saturated edge would be two things claiming to be the boundary.
        The percentage inset below is unaffected — it is measured against the
        content box, so the geometry scales with the extra pixel.
      */}
      <div
        className={`relative h-56 w-56 shrink-0 overflow-hidden rounded-full border-4 bg-lingo-surface shadow-lingo-pop transition-colors duration-300 ${
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

      {/*
        Pushes the pill to the foot of the panel, wherever the bubble ends — and
        is also the slack the pill grows into, which is the same thing said from
        the other end. `min-h-0` so it can be spent down to nothing.
      */}
      <div className="min-h-0 flex-1" />

      <LearnerPill
        text={learnerText}
        live={live}
        openingDone={openingDone}
        busy={busy}
        heard={heard}
        transcribing={transcribing}
        idleHint={idleHint}
        onCall={onCall}
        onWord={onWord}
      />
    </div>
  );
}
