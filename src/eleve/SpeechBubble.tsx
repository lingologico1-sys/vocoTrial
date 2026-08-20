import { useCallback, useEffect, useRef, useState } from 'react';
import { useLongPress } from './useLongPress';

/**
 * What the tutor is saying, hanging under its face.
 *
 * THE NOTCH IS FIXED AND CENTRED, unlike studio's, which measures the
 * artwork and aims a polygon at the mouth. That machinery exists because a
 * balloon beside a head has to reach across to it, and the mouth moves from kit
 * to kit. Here the balloon hangs directly below and the tail has nowhere to go
 * but up — so a fixed notch is both simpler and the better shape, and it never
 * crosses the portrait, which a measured tail aimed at a mouth necessarily
 * does.
 *
 * IT TAKES THE ROOM ITS TEXT NEEDS AND NOT A PIXEL MORE. `flex-initial` rather
 * than `flex-auto`: it is sized by its content, it never grows into free space,
 * and it is the first thing in the column to give when there is a squeeze. That
 * ordering is the whole layout. The gap below it absorbs a growing pill, so the
 * pill grows upward instead of pushing the column past the foot of the window,
 * and the balloon only starts yielding once that gap is spent.
 *
 * IT USED TO BE CAPPED AT TWENTY REMS AND IT NO LONGER IS. The cap existed to
 * stop a long turn shoving the call button off the page, and it did that by
 * guaranteeing a scrollbar on every turn past five or six sentences — a bar
 * down the side of a speech balloon, on a page for a fourteen-year-old. The
 * column below is what stops the shove now, so the ceiling can just be the room
 * there actually is.
 *
 * WHEN EVEN THAT IS NOT ENOUGH IT SCROLLS, QUIETLY. A tutor can in principle
 * talk for longer than any window is tall, and clipping the words would be the
 * one outcome worse than a scrollbar. So it still scrolls and still follows the
 * voice — but the bar is hidden and a fade appears over the top edge instead,
 * which says "there is more above" in the only place the reader is looking.
 */

interface SpeechBubbleProps {
  text: string;
  placeholder: string;
  /** Dims very slightly once the words are no longer being said. */
  stale: boolean;
  /** Long-press a word to look it up. */
  onWord: (word: string, context: string) => void;
}

export default function SpeechBubble({ text, placeholder, stale, onWord }: SpeechBubbleProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const empty = !text;

  /** Whether anything has been scrolled out of sight above, so the fade shows. */
  const [clipped, setClipped] = useState(false);

  useLongPress(scroller, onWord, !empty);

  const measure = useCallback(() => {
    const node = scroller.current;
    setClipped(node !== null && node.scrollTop > 2);
  }, []);

  /**
   * Follow the voice.
   *
   * A no-op until the turn is longer than the room it has, which is the whole
   * of the condition: below that there is nothing to scroll, and the assignment
   * costs nothing. The measure that follows it is what decides the fade, and it
   * has to run here rather than only on the scroll event — text arriving is a
   * way for the top to go out of view without anyone scrolling.
   */
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    measure();
  }, [text, measure]);

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-xl flex-initial flex-col">
      {/*
        Drawn in two passes so the seam does not show. The filled triangle sits
        two pixels into the bubble, covering the border line that would
        otherwise run straight across its base; the open path then draws only
        the two slanted edges, leaving the base unstroked.
      */}
      <svg
        viewBox="0 0 28 14"
        width="28"
        height="14"
        aria-hidden="true"
        className="absolute left-1/2 z-10 -translate-x-1/2"
        style={{ top: -12 }}
      >
        <path d="M0 14 L14 0 L28 14 Z" className="fill-lingo-surface" />
        <path
          d="M0 14 L14 0 L28 14"
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          className="stroke-lingo-border-strong"
        />
      </svg>

      <div
        ref={scroller}
        data-dict-context
        onScroll={measure}
        className={`lingo-quiet-scroll min-h-0 flex-1 overflow-y-auto rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-6 py-5 text-center text-lg leading-relaxed shadow-lingo-pop transition-opacity ${
          empty ? 'text-lingo-muted/70 italic' : 'text-lingo-ink'
        } ${stale && !empty ? 'opacity-90' : 'opacity-100'}`}
      >
        {empty ? placeholder : text}
      </div>

      {/*
        Inset by the border rather than laid over it: the fade is about the text
        running out of the top of the box, and washing out the box's own outline
        would read as the balloon itself dissolving. Under the notch's z-10 so
        the tail stays solid where the two meet.
      */}
      {clipped && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[2px] top-[2px] h-8 rounded-t-2xl bg-gradient-to-b from-lingo-surface via-lingo-surface/85 to-transparent"
        />
      )}
    </div>
  );
}
