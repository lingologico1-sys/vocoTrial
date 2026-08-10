import { forwardRef } from 'react';

/**
 * One speech balloon. The tail is not drawn here — it is drawn in an overlay
 * behind the stage, because it has to reach an element this one knows nothing
 * about. See LiveTrial's tail geometry.
 */

/** Shared with the tail polygons, which have to be the same colour to join up. */
export const BUBBLE_FILL = { agent: '#f1f5f9', user: '#0284c7' } as const;

interface BubbleProps {
  role: keyof typeof BUBBLE_FILL;
  text: string;
  /** Dim the balloon once the words are no longer being said. */
  stale?: boolean;
  placeholder?: string;
}

const Bubble = forwardRef<HTMLDivElement, BubbleProps>(function Bubble(
  { role, text, stale, placeholder },
  ref,
) {
  const empty = !text;

  return (
    <div
      ref={ref}
      style={{ backgroundColor: empty ? undefined : BUBBLE_FILL[role] }}
      className={`relative z-20 max-w-full rounded-2xl px-4 py-3 text-[15px] leading-snug shadow-lg transition-opacity ${
        empty
          ? 'border border-dashed border-slate-800 text-slate-600'
          : role === 'agent'
            ? 'text-slate-900'
            : 'text-white'
      } ${stale && !empty ? 'opacity-60' : 'opacity-100'}`}
    >
      {empty ? placeholder : text}
    </div>
  );
});

export default Bubble;
