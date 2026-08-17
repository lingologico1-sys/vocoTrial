import { useEffect, useState } from 'react';
import Face from '../live/Face';
import {
  BROW_LIFT_MAX,
  DEFAULT_CADENCE,
  DEFAULT_HEAD_MOTION,
  HEAD_MOTIONS,
  MOTION_CADENCES,
  type HeadMotion,
  type MotionCadence,
  type PressTrigger,
  TILT_ROLL_MAX,
  type TiltCue,
  type TiltTrigger,
} from '../live/headMotion';
import { VISEMES } from '../live/visemes';
import { CANVAS_EDGE } from './imageModels';
import type { Box, FaceKit } from './kit';

/**
 * The boxes that move, moving, before anyone has spoken a word at the page.
 *
 * The other previews on this page are composited: a patch cut to its box, laid
 * on the base, judged as a still or played as a strip. Motion cannot be shown
 * that way, because it is not artwork — it is a mask, a stretched row and some
 * cropped redraws of the base, all of them recomputed per frame from a loudness
 * the compositor never sees. Rebuilding that in canvas would mean two
 * implementations of the one effect on the page, and the second one would be
 * the one you approved.
 *
 * So this renders the shipping component, `Face`, with a `level` this page
 * invents. Everything below the number is the live face's own code, which is
 * what makes the preview worth trusting: there is nothing here for the real
 * thing to disagree with.
 *
 * Two questions get asked here, and they are different in kind. The brow boxes
 * ask a question about a seam — at speaking speed, does the edge of the moved
 * crop read as movement or as a rectangle? The head motion asks a question about
 * taste, which is why it is a switch rather than a number: swing and rise are
 * both defensible and the only way to have an opinion is to flip between them
 * while the loop runs.
 */

/** Roughly the rate a speaking voice puts stresses at. */
const SYLLABLES_PER_SECOND = 3.2;

/**
 * And roughly the rate it gets louder and quieter across a sentence.
 *
 * Deliberately not a whole-number multiple of the syllable rate: the two drift
 * against each other, so the loop reaches full volume from a different phase
 * each time round and never settles into the metronome that would let you stop
 * watching it.
 */
const PHRASES_PER_SECOND = 0.23;

/**
 * How far in the close view goes.
 *
 * The thing being judged is a seam a few pixels tall — where a moved crop meets
 * whatever it was moved away from — and at the size this panel can afford, a
 * whole head puts that seam inside about four pixels of screen. Chosen to be
 * the largest zoom that still shows an eye, because a seam is only wrong
 * relative to the face it is on.
 */
const ZOOM = 2.4;

/**
 * How often the tilt demonstration fires, in milliseconds.
 *
 * Well under what a conversation would produce, because this panel is not
 * showing you a conversation. It is showing you the far end of the movement so
 * you can decide whether the frame still holds a picture there, and waiting the
 * live page's five-plus seconds between looks at it would make the check tedious
 * enough to skip. The channel's own lockout still applies, so the true rate is
 * whichever of the two is slower.
 */
const TILT_DEMO_MS = 2600;

/**
 * How often the lip press is provoked, and for how long, in milliseconds.
 *
 * The same lie of convenience as TILT_DEMO below, told about a different prop.
 * The press fires on the rising edge of `speaking`, and `speaking` means the
 * transport has queued audio — which cannot happen on a page with no call
 * behind it. So the button pulses the prop instead: on, held long enough for the
 * gesture to play out, off again in time for the next edge.
 *
 * The period has to clear PRESS_LOCKOUT at its longest, or some pulses would be
 * swallowed by a channel that has not finished refusing yet and the panel would
 * look like it was dropping them at random. Longest rather than nominal is the
 * whole of the sizing: LOCKOUT_JITTER spreads every lockout by ±40%, so the two
 * seconds that constant advertises is really anything up to 2.8 — and a period
 * chosen against the advertised figure would work most of the time, which is the
 * worst available outcome for a panel whose job is to tell you whether something
 * fired.
 */
const PRESS_DEMO_MS = 3000;
const PRESS_DEMO_HOLD_MS = 800;

/**
 * The set that turns the tilt on here, and it is a lie of convenience.
 *
 * The kit page has no transcript and no call, so none of the three real triggers
 * can happen: no question can be heard, no turn can end, and `speaking` is false
 * so there is no turn for a hesitation to sit inside. What the button below does
 * instead is push question cues in on a timer. `question` is named here because
 * a cue is only honoured if its trigger is ticked, and it is the one the live
 * page ships with.
 */
const TILT_DEMO: readonly TiltTrigger[] = ['question'];

/**
 * And the empty set, hoisted rather than written inline at the call site.
 *
 * A fresh `[]` per render would be a new prop identity sixty times a second, on
 * a panel that re-renders sixty times a second because it is animating a
 * loudness. Nothing downstream breaks — the effect it retriggers only assigns a
 * ref — but it is a needless piece of churn in the one component here that runs
 * every frame by design.
 */
const TILT_OFF: readonly TiltTrigger[] = [];

/**
 * The press this panel can demonstrate, which is one of the two.
 *
 * `turn` fires on the rising edge of `speaking`, and the button below fakes that
 * edge on a timer — see PRESS_DEMO_MS. `reply` cannot be faked the same way and
 * is deliberately not tried: it fires when a microphone hears the user, this
 * page never opens one, and pulsing `heard` at a face with nothing to hear would
 * be a demonstration of the wiring rather than of the artwork.
 *
 * Nothing is lost by leaving it out, because the two are the same gesture. What
 * this panel is for is deciding whether a kit's `rest` and `mbp` are drawn far
 * enough apart to see, and that question has one answer for both triggers.
 */
const PRESS_DEMO: readonly PressTrigger[] = ['turn'];
const PRESS_OFF: readonly PressTrigger[] = [];

interface MotionPreviewProps {
  kit: FaceKit;
  /**
   * The rectangle the close view frames, in canvas pixels.
   *
   * The caller's job rather than this component's, because the interesting part
   * of a box is not always the middle of it: for the brows it is the whole pair,
   * and for the head it is the bottom band alone — nobody needs a close look at
   * the crown, which moves rigidly and cannot seam. Null means there is nothing
   * placed to look at, and is also what hides the control.
   */
  focus: Box | null;
  /** What to say when `focus` is null. */
  note: string;
}

export default function MotionPreview({ kit, focus, note }: MotionPreviewProps) {
  /**
   * Starts at full and starts moving.
   *
   * Full because the extreme is the frame that fails: a brow box with too little
   * forehead above it looks perfectly fine at half volume. Moving because a lift
   * held still is a rectangle you will stare at until it looks wrong, whereas the
   * question is whether it reads at speaking speed.
   */
  const [level, setLevel] = useState(1);
  const [loop, setLoop] = useState(true);
  /**
   * Starts wide, because the whole head is the thing you have an opinion about
   * first: whether this face moves like a person at all, and whether the frame
   * still holds it at the far end of a lean. A seam a few pixels tall is a
   * second look, taken once the first one has passed — so the zoom is offered
   * rather than imposed. Tick it to go in on whatever `focus` frames.
   */
  const [zoom, setZoom] = useState(false);
  /**
   * Local to the preview, and deliberately not written back to the kit.
   *
   * How the head moves is a property of the face component, not of the artwork —
   * every kit animates the same way — so the setting that survives is the one on
   * the live page. This one is here to be flipped, not to be saved.
   */
  const [motion, setMotion] = useState<HeadMotion>(DEFAULT_HEAD_MOTION);
  /**
   * Local for the same reason, and worth having here rather than only on the
   * live page: the brows are the thing this panel exists to judge, and the
   * cadence is what decides how often they move at all.
   *
   * It does change what the slider means, which is worth knowing before you
   * reach for it. Under 'Every syllable' the slider is a direct control on brow
   * height. Under 'Every phrase' it still is, a beat later, once the envelope
   * has settled on whatever you dragged to. Under 'Occasional' it is not a
   * control at all — it can trigger a gesture and then the gesture ignores it,
   * which is the entire point of that setting and is best watched on the loop.
   */
  const [cadence, setCadence] = useState<MotionCadence>(DEFAULT_CADENCE);
  /**
   * Off, alone among the settings here, and against this panel's own subject.
   *
   * The brow flash is brow motion, so a page built to judge brow motion is the
   * obvious place to watch it — but it fires on the blink's clock, which takes
   * no notice of the slider. The slider's whole promise is that it holds the
   * lift at an exact height so a seam can be looked at rather than glimpsed,
   * and the flash outranks it: the two combine as a maximum, so any setting
   * below the flash's own share is not nudged by one but replaced by it. The
   * readout would say 30% while the face went to 70% and back, every eight
   * seconds or so, at 2.4x zoom, on a seam a few pixels tall.
   *
   * So it defaults off and is offered as a thing to turn on deliberately. What
   * it buys when you do is the one test the slider cannot set up: a lift
   * arriving from rest in 90ms, which is a different question of the stretched
   * row than the same height reached slowly. The loop under 'Every syllable'
   * gets close — a brow cycle every 310ms — but starts from wherever the last
   * syllable left it rather than from rest.
   */
  const [browBlink, setBrowBlink] = useState(false);
  /**
   * Off, and here for a reason unlike everything else on this panel.
   *
   * The others are about the artwork: whether a seam reads, whether a brow box
   * has room above it. This one is about the *frame*. Turning any tilt trigger
   * on at the live page draws the picture at TILT_OVERSCAN rather than OVERSCAN
   * — a tenth further in on every portrait, to pay for the corner the extra
   * rotation would otherwise uncover — and this is the only place a kit is
   * looked at closely enough to notice what that crop took off the edges.
   *
   * So it answers two questions at once, and both of them are about this kit
   * rather than about the motion: does the portrait still sit in the frame at
   * the tighter crop, and does a hard-edged wedge of panel appear in a corner at
   * the far end of the lean.
   */
  const [tilting, setTilting] = useState(false);
  const [tiltCue, setTiltCue] = useState<TiltCue | null>(null);
  /**
   * Off, and the only thing on this panel that asks a question about a patch
   * rather than about a box.
   *
   * The press dissolves `mbp` in over `rest` at PRESS_DEPTH, so what it costs to
   * draw is nothing and what it *shows* is entirely a property of those two
   * images. Most generators draw them very much alike — they are both a closed
   * mouth — and a pair drawn too alike produces a gesture that runs perfectly
   * and cannot be seen. There is nowhere else on this page to find that out: the
   * filmstrip shows the two patches side by side, which is a comparison nobody
   * watching a face ever gets to make, and the live page shows the press once
   * per turn at a moment you are listening rather than looking.
   *
   * Judged with the loudness dragged to nothing, which takes both controls and
   * is worth saying precisely because pausing alone does not do it. The press is
   * scaled away by anything audible — correctly, since a face mid-sentence has
   * no business closing its lips — and Pause stops the loop wherever the
   * oscillation had got to, which is usually somewhere loud. So it is the slider
   * that has to come down, and the button only stops it climbing back.
   */
  const [pressing, setPressing] = useState(false);
  /** The pulsed `speaking`, which is the only thing the press listens to. */
  const [turn, setTurn] = useState(false);
  /**
   * Off, and the only control here that stops the face rather than changing it.
   *
   * Everything else on this panel is watched: the loop runs, the movement goes
   * past, and you form an opinion about whether it read. Two of the frames it
   * goes past cannot be judged that way, because they are the ones the artwork
   * itself can be wrong in and they are both over in about a tenth of a second.
   * A lid patch either sits on the base under it or it does not, and a blink is
   * too short to tell which. A brow crop at full lift either has plain forehead
   * above it or is dragging a band of skin into a fringe, and full lift is one
   * instant inside a gesture that has already moved on.
   *
   * Neither is a question about motion, so neither is answered by watching. This
   * button parks the face on both at once — lids shut, brows as high as this kit
   * will ever take them — and leaves it there.
   *
   * It stops the loudness as well as the face, which is the part worth stating.
   * `hold` reaches the lids and the brows and nothing else, so a held face on a
   * running loop would still be swinging and possibly leaning, and a seam a few
   * pixels tall cannot be inspected on a moving head. So the click does what a
   * drag of the slider does — takes the loop off — and then takes the loudness to
   * nothing, which is the only value that leaves the head at rest. Speak gives
   * it all back.
   */
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!pressing) {
      setTurn(false);
      return;
    }
    let ending = 0;
    const starting = window.setInterval(() => {
      setTurn(true);
      ending = window.setTimeout(() => setTurn(false), PRESS_DEMO_HOLD_MS);
    }, PRESS_DEMO_MS);
    return () => {
      window.clearInterval(starting);
      window.clearTimeout(ending);
    };
  }, [pressing]);

  useEffect(() => {
    if (!tilting) {
      setTiltCue(null);
      return;
    }
    let seq = 0;
    const timer = window.setInterval(() => {
      seq += 1;
      setTiltCue({ kind: 'question', seq });
    }, TILT_DEMO_MS);
    return () => window.clearInterval(timer);
  }, [tilting]);

  useEffect(() => {
    if (!loop) return;
    let frame = 0;
    const start = performance.now();

    const step = (time: number) => {
      const t = (time - start) / 1000;
      const syllable = 0.5 - 0.5 * Math.cos(2 * Math.PI * SYLLABLES_PER_SECOND * t);
      const phrase = 0.55 + 0.45 * Math.sin(2 * Math.PI * PHRASES_PER_SECOND * t);
      setLevel(Math.max(0, Math.min(1, syllable * phrase)));
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [loop]);

  const origin = focus && {
    x: ((focus.x + focus.width / 2) / CANVAS_EDGE) * 100,
    y: ((focus.y + focus.height / 2) / CANVAS_EDGE) * 100,
  };
  const close = zoom && origin;

  return (
    <div className="space-y-2">
      <div className="relative mx-auto aspect-square w-full max-w-[18rem] overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        {/*
          Scaled on a wrapper rather than by narrowing the face's viewBox,
          because the viewBox belongs to the component that ships and this panel
          has no business reaching into it. The frame clips what the zoom pushes
          out, and the face inside is untouched at any magnification.
        */}
        <div
          className="h-full w-full"
          style={
            close
              ? { transform: `scale(${ZOOM})`, transformOrigin: `${origin.x}% ${origin.y}%` }
              : undefined
          }
        >
          <Face
            shape={VISEMES.rest}
            viseme="rest"
            level={level}
            kit={kit}
            motion={motion}
            cadence={cadence}
            browBlink={browBlink}
            press={pressing ? PRESS_DEMO : PRESS_OFF}
            // Pulsed rather than reported, and it reaches the face for the press
            // alone: nothing else here reads it, because `hesitation` is not in
            // TILT_DEMO and so the pause detector has nothing to fire.
            speaking={turn}
            // The same rule as the lean below, and this panel's oldest one: the
            // extreme is the frame that fails. A brow box judged at the default
            // travel tells you nothing about the box, only about the setting — and
            // the setting is the one thing on this page that is not a property of
            // the artwork. Whatever survives here survives anywhere the live
            // slider can be dragged to.
            browLift={BROW_LIFT_MAX}
            tilt={tilting ? TILT_DEMO : TILT_OFF}
            // Leaned as far as the live page's slider goes, never at its default.
            // The panel's own rule, applied to a second movement: the extreme is
            // the frame that fails, and a portrait that survives 1.2 degrees
            // tells you nothing about the one setting somebody will actually
            // drag it to.
            tiltRoll={TILT_ROLL_MAX}
            tiltCue={tiltCue}
            hold={held}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-400">
        <button
          type="button"
          // Releases the hold on the way past, whichever way it is going. The two
          // cannot both be in charge, and a click on this one is a statement that
          // the loop is: pressing Speak on a face parked with its eyes shut and
          // getting a talking face with its eyes still shut is not a state
          // anybody meant to ask for.
          onClick={() => {
            setLoop((current) => !current);
            setHeld(false);
          }}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-200 hover:border-slate-500"
        >
          {loop ? 'Pause' : 'Speak'}
        </button>

        {/*
          Beside the loop rather than down among the switches, because it is the
          other thing you can do to the whole face — those rows change what the
          face does, and these two decide whether it is doing anything.
        */}
        <button
          type="button"
          title="Stops the face with the lids shut and the brows as high as this kit will ever take them — two frames that otherwise pass in about a tenth of a second each. Tick Close and look for a lid patch that does not sit on the base underneath it, and for a hard edge or a flat band of skin where the lifted brow crop meets the forehead. Speak sets it going again."
          onClick={() => {
            const next = !held;
            setHeld(next);
            if (next) {
              setLoop(false);
              setLevel(0);
            }
          }}
          className={`rounded-lg border px-2.5 py-1 ${
            held
              ? 'border-violet-600 bg-violet-950/40 text-violet-200'
              : 'border-slate-700 text-slate-200 hover:border-slate-500'
          }`}
        >
          {held ? 'Release' : 'Shut and lifted'}
        </button>

        {/*
          The slider is the control that answers the question, once the loop has
          shown you there is a question: it holds the motion at an exact loudness
          so a seam can be looked at rather than glimpsed. Live while the loop
          runs, so dragging it is also how you stop the loop and take over.
        */}
        <label className="flex flex-1 items-center gap-2">
          <span className="w-16 tabular-nums">{Math.round(level * 100)}% loud</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(level * 100)}
            onChange={(event) => {
              setLoop(false);
              setLevel(Number(event.target.value) / 100);
            }}
            className="w-32"
          />
        </label>

        {origin && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={zoom}
              onChange={(event) => setZoom(event.target.checked)}
            />
            Close
          </label>
        )}
      </div>

      {/*
        The motion switch, under the controls rather than beside them, because
        it is the one thing here that changes what the face *does* rather than
        how you are looking at it.
      */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-12 shrink-0 text-slate-500">Head</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-700">
          {HEAD_MOTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              onClick={() => setMotion(option.id)}
              className={`px-2.5 py-1 ${
                motion === option.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-12 shrink-0 text-slate-500">When</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-700">
          {MOTION_CADENCES.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              onClick={() => setCadence(option.id)}
              className={`px-2.5 py-1 ${
                cadence === option.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/*
        Third in the group that changes what the face does, and serving the
        seam question rather than the taste one: it is here to put a faster
        lift on the brow than the slider can hold or the loop can start from,
        which is a different test of the stretched row and not a different
        opinion about it.

        Named for what the blink carries rather than as on and off, because
        "on" says nothing about what arrives — and what arrives, at a moment
        this page did not choose, is the whole reason it defaults to the
        quieter of the two.
      */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-12 shrink-0 text-slate-500">Blink</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-700">
          {(
            [
              [
                false,
                'Lids only',
                'The lids close and nothing else moves, so the slider is the only thing setting the brow height and a seam stays where you put it.',
              ],
              [
                true,
                'Lids and brows',
                'What the live page does: about half of blinks lift the brows to 70% in 90ms and ease them back. It ignores the slider and outranks any setting below 70%, so expect the readout to disagree with the face.',
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={label}
              type="button"
              title={hint}
              onClick={() => setBrowBlink(value)}
              className={`px-2.5 py-1 ${
                browBlink === value
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/*
        Fourth in the group, and the only one asking about artwork the page has
        no other way to test. The brow rows judge a seam this component makes out
        of the base image; this judges whether two patches a generator drew are
        different enough from each other to read as a movement when one is
        dissolved into the other.
      */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-12 shrink-0 text-slate-500">Lips</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-700">
          {(
            [
              [
                false,
                'Speech only',
                'The mouth holds the rest pose and moves for nothing but sound, which on this panel means it does not move at all.',
              ],
              [
                true,
                'Closing',
                'Every three seconds the lips close most of the way toward the M/B/P pose and part again, which is what the live face does in the moment before a turn begins. Drag the loudness to nothing to see it: the gesture is scaled away by anything audible, so it is correctly invisible while this page is pretending to speak.',
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={label}
              type="button"
              title={hint}
              onClick={() => setPressing(value)}
              className={`px-2.5 py-1 ${
                pressing === value
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-12 shrink-0 text-slate-500">Tilt</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-700">
          {(
            [
              [
                false,
                'Upright',
                'The head never leans sideways, and the picture is drawn at the smaller overscan that only the speaking motion has to pay for.',
              ],
              [
                true,
                'Leaning',
                'Leans every couple of seconds, and as far as the live page will ever lean — not as far as it does by default. Watch the corners for a wedge of panel, and the edges of the portrait for what the deeper crop this needs has taken off them.',
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={label}
              type="button"
              title={hint}
              onClick={() => setTilting(value)}
              className={`px-2.5 py-1 ${
                tilting === value
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        {MOTION_CADENCES.find((option) => option.id === cadence)?.hint}
      </p>

      {!focus && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}
