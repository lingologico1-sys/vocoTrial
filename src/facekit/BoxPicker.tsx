import { useRef } from 'react';
import { CANVAS_EDGE } from './imageModels';
import { clampBox, type Box } from './kit';
import type { Region } from './slots';

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

const REGION_STYLE: Record<Region, { ring: string; label: string }> = {
  mouth: { ring: 'border-amber-400', label: 'text-amber-300' },
  eyes: { ring: 'border-sky-400', label: 'text-sky-300' },
};

interface BoxPickerProps {
  base: string;
  boxes: Record<Region, Box>;
  active: Region;
  onChange: (region: Region, box: Box) => void;
}

export default function BoxPicker({ base, boxes, active, onChange }: BoxPickerProps) {
  const frame = useRef<HTMLDivElement>(null);

  /**
   * Turns a pointer drag into a box change.
   *
   * `handle` is null when the whole box is being moved, or a corner when it is
   * being resized. Both run off the same pointer capture so a fast drag that
   * leaves the rectangle — or leaves the window — keeps its grip instead of
   * dropping the box half-moved.
   */
  const startDrag = (
    event: React.PointerEvent,
    region: Region,
    handle: null | 'nw' | 'ne' | 'sw' | 'se',
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const box = boxes[region];
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

      {(Object.keys(boxes) as Region[]).map((region) => {
        const box = boxes[region];
        const style = REGION_STYLE[region];
        const isActive = region === active;

        return (
          <div
            key={region}
            onPointerDown={(event) => startDrag(event, region, null)}
            className={`absolute border-2 ${style.ring} ${
              isActive ? 'cursor-move opacity-100' : 'pointer-events-none opacity-40'
            }`}
            style={{
              left: percent(box.x),
              top: percent(box.y),
              width: percent(box.width),
              height: percent(box.height),
            }}
          >
            <span
              className={`absolute -top-6 left-0 text-xs font-medium capitalize ${style.label}`}
            >
              {region}
            </span>

            {isActive &&
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
