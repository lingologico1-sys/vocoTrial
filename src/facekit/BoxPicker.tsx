import { useRef } from 'react';
import { CANVAS_EDGE } from './imageModels';
import { browHeadroom, chinLine, clampBox, type Boxes, type MeasuredBox } from './kit';
import { isBrow, type BoxId } from './slots';

/**
 * Drag a rectangle over the mouth, and another over the eyes.
 *
 * One interaction doing two jobs, which is why it is worth a component. The
 * rectangle is the mask sent to a provider that takes one, *and* it is the crop
 * every result is cut down to, *and* it is where the patch lands when the face
 * is assembled. Placing it by eye against the actual portrait beats writing
 * coordinates into a manifest and reloading to see whether they were right.
 *
 * Boxes are held in canvas pixels and drawn as percentages, so the picker is
 * the same picker at any display size and a dragged box means the same thing
 * whether the window is wide or narrow.
 */

const BOX_STYLE: Record<BoxId, { ring: string; label: string; name: string }> = {
  mouth: { ring: 'border-amber-400', label: 'text-amber-300', name: 'mouth' },
  eyeLeft: { ring: 'border-sky-400', label: 'text-sky-300', name: 'left eye' },
  eyeRight: { ring: 'border-emerald-400', label: 'text-emerald-300', name: 'right eye' },
  browLeft: { ring: 'border-violet-400', label: 'text-violet-300', name: 'left brow' },
  browRight: { ring: 'border-fuchsia-400', label: 'text-fuchsia-300', name: 'right brow' },
};

/**
 * Above this far down the canvas, a box wears its label on the inside.
 *
 * The head box was the reason and is gone, but the rule outlives it: every box
 * here is draggable anywhere on the canvas, and one dragged up near the top of
 * the frame has its caption cropped away by the panel that holds it. No box now
 * *wants* to live up there — the highest of them, a brow, sits about a third of
 * the way down — so this fires rarely. It costs one comparison, and the failure
 * it prevents is a label you cannot read on a box you are in the middle of
 * placing.
 */
const LABEL_INSIDE_ABOVE = 0.08;

interface BoxPickerProps {
  base: string;
  boxes: Boxes;
  active: BoxId;
  /**
   * Whether the active region's box has been fixed by a generation.
   *
   * A patch is a bare rectangle of pixels that gets drawn stretched to whatever
   * the box currently is — it does not remember where it was cut from. So moving
   * a box after generating silently distorts every patch already made for it,
   * with no warning and nothing visibly wrong until the face moves. Refusing the
   * drag is the cheap way to make that impossible.
   */
  locked?: boolean;
  /**
   * Takes a `MeasuredBox` rather than a `Box`, which every `Box` already is.
   *
   * The widest of the types, because two of the drags here report a measurement
   * that lives inside a box rather than on its corners, and the alternative was a
   * cast at the call site to say so. Nothing stops an eye box arriving with a
   * `chin` on it as far as the types are concerned; what stops it is that only the
   * boxes with a line drawn on them are ever given a line to drag.
   */
  onChange: (region: BoxId, box: MeasuredBox) => void;
}

export default function BoxPicker({ base, boxes, active, locked, onChange }: BoxPickerProps) {
  const frame = useRef<HTMLDivElement>(null);

  /**
   * Turns a pointer drag into a box change.
   *
   * `handle` is null when the whole box is being moved, a corner when it is being
   * resized, or `headroom`/`chin` for a line drawn inside a box. All of them run
   * off the same pointer capture so a fast drag that leaves the rectangle — or
   * leaves the window — keeps its grip instead of dropping the box half-moved.
   *
   * The line drags are the odd ones out and are here rather than in a component of
   * their own for exactly that reason: they do not change the rectangle at all,
   * they change a number measured inside it. Everything else about the interaction
   * — the capture, the canvas scale, the closure over the box the drag started on
   * — is identical, and a second copy of that would be a second place for the
   * scale arithmetic to be subtly wrong.
   */
  const startDrag = (
    event: React.PointerEvent,
    region: BoxId,
    handle: null | 'nw' | 'ne' | 'sw' | 'se' | 'headroom' | 'chin',
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const box = boxes[region];
    if (!box) return;
    const width = frame.current?.getBoundingClientRect().width ?? 1;
    const scale = CANVAS_EDGE / width;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) * scale;
      const dy = (moveEvent.clientY - startY) * scale;

      if (!handle) {
        onChange(region, clampBox({ ...box, x: box.x + dx, y: box.y + dy }));
        return;
      }

      /*
        Clamped to the box rather than to the canvas, and not run through
        clampBox, which knows about rectangles and would have nothing to say
        about this. Both ends are allowed and both mean something. A headroom of
        zero says no clear forehead, so this brow does not rise — a legitimate
        answer for a portrait with a fringe, and reachable by dragging rather than
        only by removing the box, which would have been the difference between
        "this brow holds still" and "this brow is not configured". A chin line on
        the bottom edge says no clear room below, which is not a legitimate answer
        so much as a true report of a badly drawn box; the picker's job is to let
        it be said, and the caption's is to argue with it.
      */
      if (handle === 'headroom' || handle === 'chin') {
        const from = handle === 'headroom' ? browHeadroom(box) : chinLine(box);
        const line = Math.round(Math.min(box.height, Math.max(0, from + dy)));
        onChange(region, { ...box, [handle]: line });
        return;
      }

      // Resizing from a corner moves the opposite edges not at all: west
      // handles shift the origin and shrink the span by the same amount, east
      // handles only change the span.
      const west = handle === 'nw' || handle === 'sw';
      const north = handle === 'nw' || handle === 'ne';
      onChange(
        region,
        clampBox({
          x: west ? box.x + dx : box.x,
          y: north ? box.y + dy : box.y,
          width: west ? box.width - dx : box.width + dx,
          height: north ? box.height - dy : box.height + dy,
        }),
      );
    };

    const done = () => {
      target.releasePointerCapture(event.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', done);
      target.removeEventListener('pointercancel', done);
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', done);
    target.addEventListener('pointercancel', done);
  };

  const percent = (value: number) => `${(value / CANVAS_EDGE) * 100}%`;

  return (
    <div
      ref={frame}
      className="relative aspect-square w-full select-none overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
    >
      <img src={base} alt="" className="pointer-events-none h-full w-full" draggable={false} />

      {(Object.keys(boxes) as BoxId[]).map((region) => {
        const box = boxes[region];
        const style = BOX_STYLE[region];
        // A kit need not have every box — brows are optional, and one that has
        // not been placed has nothing to draw rather than a rectangle at zero.
        if (!box) return null;
        const isActive = region === active;
        const draggable = isActive && !locked;

        // Where this box's line sits and what dragging it means, or null for a
        // box that has no measurement inside it. Settled here so the geometry and
        // the handle name cannot drift apart, which is the failure a second copy
        // of this block would eventually produce.
        const line = isBrow(region)
          ? {
              handle: 'headroom' as const,
              at: browHeadroom(box),
              title:
                'Drag to the top of the brow. Everything above this line is forehead the brow can rise into, and it is what caps how far the brow travels — take it to the bottom of the box for no lift at all.',
            }
          : region === 'mouth'
            ? {
                handle: 'chin' as const,
                at: chinLine(box),
                title:
                  'Drag to the bottom of the chin at rest. Everything below this line is the clear room the open pose drops its jaw into — the box has to end well below it, and this is what keeps the patch’s bottom fade off the chin.',
              }
            : null;

        return (
          <div
            key={region}
            onPointerDown={draggable ? (event) => startDrag(event, region, null) : undefined}
            data-region={region}
            data-active={draggable || undefined}
            className={`absolute border-2 ${style.ring} ${
              draggable
                ? 'cursor-move opacity-100'
                : isActive
                  ? 'pointer-events-none border-dashed opacity-80'
                  : 'pointer-events-none opacity-40'
            }`}
            style={{
              left: percent(box.x),
              top: percent(box.y),
              width: percent(box.width),
              height: percent(box.height),
            }}
          >
            <span
              className={`absolute left-0 text-xs font-medium ${style.label} ${
                box.y / CANVAS_EDGE < LABEL_INSIDE_ABOVE ? 'top-0.5 px-1' : '-top-6'
              }`}
            >
              {style.name}
              {isActive && locked && <span className="text-slate-500"> · locked</span>}
            </span>

            {/*
              The line inside a box, on the two kinds that have one.

              Both say the same kind of thing — where the face inside the
              rectangle actually is — and both are read as the clear band on one
              side of themselves, which is why they are one piece of geometry
              rather than two. On a brow the band is above: clear forehead to rise
              into, and what the lift is capped at, since the box height was the
              wrong number for that (see BrowBox in kit.ts). On the mouth it is
              below: clear room for the open pose's jaw to drop into, which
              nothing measured until now.

              What each *does* differs completely, and that is worth knowing
              before dragging one. The brow's line is arithmetic in the live face
              and answers immediately. The mouth's is spent before a generation
              and cannot be seen moving: it keeps the patch's bottom fade off the
              chin, and warns while the box is still free. There is nothing to
              watch, which is exactly why the caption under the picker says what
              it is worth.

              Drawn dashed and its grab area three times its own thickness,
              because the thing being placed is a few canvas pixels from the mark
              it has to sit against: a solid hairline over a drawn brow is hard to
              tell from the brow, and a one-pixel target on a box this size is a
              target nobody hits on the first try.
            */}
            {draggable && line && (
              <div
                onPointerDown={(event) => startDrag(event, region, line.handle)}
                title={line.title}
                className="absolute -left-0.5 -right-0.5 h-2 -translate-y-1/2 cursor-ns-resize"
                style={{ top: `${(line.at / box.height) * 100}%` }}
              >
                <div className={`absolute inset-x-0 top-1/2 border-t border-dashed ${style.ring}`} />
              </div>
            )}

            {draggable &&
              (['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                <span
                  key={handle}
                  onPointerDown={(event) => startDrag(event, region, handle)}
                  className={`absolute h-3 w-3 rounded-sm border ${style.ring} bg-slate-950`}
                  style={{
                    left: handle === 'nw' || handle === 'sw' ? -7 : undefined,
                    right: handle === 'ne' || handle === 'se' ? -7 : undefined,
                    top: handle === 'nw' || handle === 'ne' ? -7 : undefined,
                    bottom: handle === 'sw' || handle === 'se' ? -7 : undefined,
                    cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
