import { useRef } from 'react';
import { CANVAS_EDGE } from './imageModels';
import { laughCaptureBox, type Box, type MouthBox } from './kit';

interface LaughInsertPickerProps {
  image: string;
  mouth: MouthBox;
  insert: Box;
  onChange: (insert: Box) => void;
}

const MIN_EDGE = 36;

/** Keeps the editable Laugh boundary inside the mouth patch it will replace. */
function insideMouth(next: Box, mouth: MouthBox): Box {
  const width = Math.max(MIN_EDGE, Math.min(Math.round(next.width), mouth.width));
  const height = Math.max(MIN_EDGE, Math.min(Math.round(next.height), mouth.height));
  return {
    x: Math.round(Math.min(mouth.x + mouth.width - width, Math.max(mouth.x, next.x))),
    y: Math.round(Math.min(mouth.y + mouth.height - height, Math.max(mouth.y, next.y))),
    width,
    height,
  };
}

/**
 * The boundary the generator cannot cross in the final patch.
 *
 * It deliberately sits over the AA-composited portrait rather than over the
 * neutral base: AA is the geometry a Laugh inherits, so the useful judgement is
 * whether this rectangle includes the lips, teeth and a little surrounding skin
 * while excluding the jaw and cheeks AA already got right.
 */
export default function LaughInsertPicker({ image, mouth, insert, onChange }: LaughInsertPickerProps) {
  const frame = useRef<HTMLDivElement>(null);
  const capture = laughCaptureBox(mouth, insert);

  const begin = (event: React.PointerEvent, resize: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY, insert };
    const scale = CANVAS_EDGE / (frame.current?.getBoundingClientRect().width ?? 1);
    target.setPointerCapture(event.pointerId);

    const move = (next: PointerEvent) => {
      const dx = (next.clientX - start.x) * scale;
      const dy = (next.clientY - start.y) * scale;
      onChange(
        insideMouth(
          resize
            ? { ...start.insert, width: start.insert.width + dx, height: start.insert.height + dy }
            : { ...start.insert, x: start.insert.x + dx, y: start.insert.y + dy },
          mouth,
        ),
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
    <div className="space-y-2">
      <div
        ref={frame}
        className="relative mx-auto aspect-square w-full max-w-md select-none overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
      >
        <img src={image} alt="" draggable={false} className="pointer-events-none h-full w-full" />
        <div
          className="pointer-events-none absolute border border-dashed border-cyan-400/70"
          style={{
            left: percent(capture.x),
            top: percent(capture.y),
            width: percent(capture.width),
            height: percent(capture.height),
          }}
        >
          <span className="absolute -bottom-5 left-0 whitespace-nowrap text-[10px] text-cyan-300/80">
            generated details captured
          </span>
        </div>
        <div
          onPointerDown={(event) => begin(event, false)}
          className="absolute cursor-move border-2 border-fuchsia-400"
          style={{
            left: percent(insert.x),
            top: percent(insert.y),
            width: percent(insert.width),
            height: percent(insert.height),
          }}
        >
          <span className="absolute -top-6 left-0 whitespace-nowrap text-xs font-medium text-fuchsia-300">
            final Laugh area
          </span>
          <button
            type="button"
            aria-label="Resize laugh edit boundary"
            onPointerDown={(event) => begin(event, true)}
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-sm border border-fuchsia-200 bg-fuchsia-500"
          />
        </div>
      </div>
      <p className="mx-auto max-w-md text-xs text-slate-500">
        Put the magenta sides just outside AA’s desired outer mouth corners rather than leaving generous skin padding. The dashed cyan area captures the wider generated mouth and corner lines, then compresses them horizontally into that final area. AA supplies everything outside it, including the jaw and chin.
      </p>
    </div>
  );
}
