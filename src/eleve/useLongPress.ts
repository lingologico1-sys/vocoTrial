import { useEffect, type RefObject } from 'react';

/**
 * Press and hold a word to look it up.
 *
 * PORTED FROM LINGOLECTO, WHERE IT NEEDED CHUNKED TEXT AND HERE IT DOES NOT.
 * That app pre-splits a passage into `.chunk` spans for its audio alignment,
 * and the long-press appears to depend on them — but it does not: the word is
 * found with `caretRangeFromPoint`, which walks whatever text node is under the
 * finger. The chunk is only used to decide *whether* the press counts and what
 * sentence to send as context. That is what makes this work on a live
 * transcript, which arrives as plain streamed text and is never chunked at all.
 *
 * THE FLASH IS A SELECTION, NOT A WRAPPED SPAN. LingoLecto highlights by
 * surrounding the range with a styled element and unwrapping it a second later.
 * Doing that here would mean mutating DOM that React owns and rerenders as the
 * transcript streams — the unwrap would race the next render, and the two would
 * fight over the same text node. Setting the document selection paints the same
 * word with the same immediacy, is styled through ::selection, and is invisible
 * to React because it touches no nodes.
 */

/** Long enough not to fire on a tap, short enough not to feel stuck. */
const DELAY = 500;

/** Letters, combining marks, and the two joiners French words contain. */
const WORD = /[\p{L}\p{M}'’-]/u;

/** How far a finger may drift and still count as a press rather than a drag. */
const SLOP = 10;

interface Found {
  word: string;
  range: Range;
  /** The sentence it sits in, for idiom detection. */
  context: string;
}

function wordAtPoint(x: number, y: number, root: HTMLElement): Found | null {
  let range: Range | undefined;

  const doc = root.ownerDocument;
  // caretRangeFromPoint is the WebKit/Blink spelling, caretPositionFromPoint the
  // standard one Firefox implements. Neither is universal, so both are tried.
  if (doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(x, y) ?? undefined;
  } else if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    if (position) {
      range = doc.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  }

  if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return null;

  const node = range.startContainer;
  const text = node.textContent ?? '';
  const offset = range.startOffset;

  let start = offset;
  let end = offset;
  while (start > 0 && WORD.test(text[start - 1])) start--;
  while (end < text.length && WORD.test(text[end])) end++;

  const word = text.slice(start, end).replace(/^['’-]+|['’-]+$/g, '');
  if (!word) return null;

  const wordRange = doc.createRange();
  wordRange.setStart(node, start);
  wordRange.setEnd(node, end);

  // The nearest element that has declared itself a sentence, or the container.
  // Same shape as LingoLecto's `chunk || closest(...) || target`, with the
  // marker made explicit rather than borrowed from a class that means something
  // else.
  const owner =
    node.parentElement?.closest<HTMLElement>('[data-dict-context]') ?? root;

  return { word, range: wordRange, context: (owner.textContent ?? '').trim() };
}

/**
 * Binds the gesture to one element.
 *
 * Native listeners rather than React's, because this needs a non-passive
 * `touchend` to swallow the click that would otherwise follow the press — React
 * attaches touch handlers passively at the root, where preventDefault does
 * nothing but warn.
 */
export function useLongPress(
  ref: RefObject<HTMLElement>,
  onWord: (word: string, context: string) => void,
  enabled = true,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;

    let timer: number | undefined;
    let fired = false;
    let pressX = 0;
    let pressY = 0;

    const clear = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const start = (event: MouseEvent | TouchEvent) => {
      const point = 'touches' in event ? event.touches[0] : event;
      if (!point) return;

      fired = false;
      pressX = point.clientX;
      pressY = point.clientY;

      timer = window.setTimeout(() => {
        const found = wordAtPoint(pressX, pressY, root);
        if (!found) return;
        fired = true;

        // Paint it. The selection is the feedback, and it is also what makes it
        // obvious which word was caught when two sit close together.
        const selection = root.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(found.range);

        onWord(found.word, found.context);
      }, DELAY);
    };

    const move = (event: MouseEvent | TouchEvent) => {
      if (timer === undefined) return;
      const point = 'touches' in event ? event.touches[0] : event;
      if (!point) return;
      // A little drift is a finger resting, not a drag. Cancelling on the first
      // pixel makes the gesture nearly impossible to land with a mouse.
      if (Math.abs(point.clientX - pressX) > SLOP || Math.abs(point.clientY - pressY) > SLOP) {
        clear();
      }
    };

    const end = (event: MouseEvent | TouchEvent) => {
      clear();
      if (!fired) return;
      // The press already did something; the click that would follow it must
      // not also do something.
      event.preventDefault();
      event.stopPropagation();
      fired = false;
    };

    root.addEventListener('mousedown', start);
    root.addEventListener('mousemove', move);
    root.addEventListener('mouseup', end);
    root.addEventListener('mouseleave', clear);
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: true });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', clear);

    return () => {
      clear();
      root.removeEventListener('mousedown', start);
      root.removeEventListener('mousemove', move);
      root.removeEventListener('mouseup', end);
      root.removeEventListener('mouseleave', clear);
      root.removeEventListener('touchstart', start);
      root.removeEventListener('touchmove', move);
      root.removeEventListener('touchend', end);
      root.removeEventListener('touchcancel', clear);
    };
  }, [ref, onWord, enabled]);
}
