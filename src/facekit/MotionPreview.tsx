import { useEffect, useState } from 'react';
import Face from '../live/Face';
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
 * It serves the brow boxes and the head box both, because they are the same
 * mechanism at two scales and the question asked of each is the same question:
 * at speaking speed, does the seam read as movement or as a rectangle?
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
  /** Whether the close view starts on. Off when the still background is the point. */
  startZoomed?: boolean;
  /** What to say when `focus` is null. */
  note: string;
}

export default function MotionPreview({ kit, focus, startZoomed, note }: MotionPreviewProps) {
  /**
   * Starts at full and starts moving.
   *
   * Full because the extreme is the frame that fails: a brow box with too little
   * forehead above it, or a head box whose bottom edge sits on a jaw rather than
   * a neck, both look perfectly fine at half volume. Moving because a lift held
   * still is a rectangle you will stare at until it looks wrong, whereas the
   * question is whether it reads at speaking speed.
   */
  const [level, setLevel] = useState(1);
  const [loop, setLoop] = useState(true);
  const [zoom, setZoom] = useState(startZoomed ?? true);

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
          <Face shape={VISEMES.rest} viseme="rest" level={level} kit={kit} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-400">
        <button
          type="button"
          onClick={() => setLoop((current) => !current)}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-200 hover:border-slate-500"
        >
          {loop ? 'Pause' : 'Speak'}
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

      {!focus && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}
