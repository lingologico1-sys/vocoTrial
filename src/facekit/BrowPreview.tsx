import { useEffect, useMemo, useState } from 'react';
import Face from '../live/Face';
import { VISEMES } from '../live/visemes';
import { CANVAS_EDGE } from './imageModels';
import type { Box, FaceKit } from './kit';
import { BROW_BOXES } from './slots';

/**
 * The brow boxes, moving, before anyone has spoken a word at the page.
 *
 * The other previews on this page are composited: a patch cut to its box, laid
 * on the base, judged as a still or played as a strip. The lift cannot be shown
 * that way, because it is not artwork — it is a mask, a stretched row and two
 * cropped redraws of the base, all of them recomputed per frame from a loudness
 * the compositor never sees. Rebuilding that in canvas would mean two
 * implementations of the one effect on the page, and the second one would be
 * the one you approved.
 *
 * So this renders the shipping component, `Face`, with a `level` this page
 * invents. Everything below the number is the live face's own code, which is
 * what makes the preview worth trusting: there is nothing here for the real
 * thing to disagree with.
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
 * The thing being judged is a seam a few pixels tall — where the moved crop
 * meets the stretched row under it — and at the size this panel can afford, a
 * whole head puts that seam inside about four pixels of screen. Chosen to be
 * the largest zoom that still shows an eye, because a seam is only wrong
 * relative to the face it is on.
 */
const ZOOM = 2.4;

interface BrowPreviewProps {
  kit: FaceKit;
}

export default function BrowPreview({ kit }: BrowPreviewProps) {
  /**
   * Starts at full and starts moving.
   *
   * Full because the extreme is the frame that fails: a box with too little
   * forehead above it, or a bottom edge sitting on a spectacle rim, both look
   * perfectly fine at half volume. Moving because a lift held still is a
   * rectangle of forehead you will stare at until it looks wrong, whereas the
   * question is whether it reads at speaking speed.
   */
  const [level, setLevel] = useState(1);
  const [loop, setLoop] = useState(true);
  const [zoom, setZoom] = useState(true);

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

  /**
   * Where to point the close view: the middle of whatever brow boxes exist.
   *
   * Null when neither is placed, which is also the signal that there is nothing
   * to zoom to — a kit with no brow boxes has no brow motion, and framing a
   * spot on its forehead would imply otherwise.
   */
  const focus = useMemo(() => {
    const boxes = BROW_BOXES.map((id) => kit.boxes[id]).filter((box): box is Box => Boolean(box));
    if (!boxes.length) return null;

    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const top = Math.min(...boxes.map((box) => box.y));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));

    return {
      x: (((left + right) / 2) / CANVAS_EDGE) * 100,
      y: (((top + bottom) / 2) / CANVAS_EDGE) * 100,
    };
  }, [kit.boxes]);

  const close = zoom && focus;

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
              ? { transform: `scale(${ZOOM})`, transformOrigin: `${focus.x}% ${focus.y}%` }
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
          shown you there is a question: it holds the lift at an exact loudness
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

        {focus && (
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

      {!focus && (
        <p className="text-xs text-slate-500">
          Neither brow is placed, so neither brow moves — what you can see here is the head
          lift, which every kit has always had.
        </p>
      )}
    </div>
  );
}
