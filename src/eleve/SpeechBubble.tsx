import { useEffect, useRef } from 'react';
import { useLongPress } from './useLongPress';

/**
 * What the tutor is saying, hanging under its face.
 *
 * THE NOTCH IS FIXED AND CENTRED, unlike liveTrial's, which measures the
 * artwork and aims a polygon at the mouth. That machinery exists because a
 * balloon beside a head has to reach across to it, and the mouth moves from kit
 * to kit. Here the balloon hangs directly below and the tail has nowhere to go
 * but up — so a fixed notch is both simpler and the better shape, and it never
 * crosses the portrait, which a measured tail aimed at a mouth necessarily
 * does.
 *
 * IT GROWS DOWNWARD AND THEN SCROLLS. The whole turn is kept, because a learner
 * reading back a sentence they half caught should find it there. Past a cap it
 * scrolls inside itself rather than pushing the pill and the button down the
 * page — a control that moves while you are reaching for it is worse than a
 * scrollbar.
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

  useLongPress(scroller, onWord, !empty);

  /**
   * Follow the voice.
   *
   * Only once the text is past the cap, which is the whole of the condition —
   * before that there is nothing to scroll and calling this would fight a user
   * who has scrolled up to reread something.
   */
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [text]);

  return (
    <div className="relative mx-auto w-full max-w-xl">
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
        className={`max-h-64 overflow-y-auto rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-6 py-5 text-center text-lg leading-relaxed shadow-lingo-pop transition-opacity ${
          empty ? 'text-lingo-muted/70 italic' : 'text-lingo-ink'
        } ${stale && !empty ? 'opacity-90' : 'opacity-100'}`}
      >
        {empty ? placeholder : text}
      </div>
    </div>
  );
}
