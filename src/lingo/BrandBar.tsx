import { Mic } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The LingoMondo header lockup, and the bar it sits in.
 *
 * EXTRACTED RATHER THAN COPIED, because a second page now wears it. /eleve had
 * it inline, at numbers taken one for one from LingoLecto after a good deal of
 * measuring; /teach is the same shape of page in the same family and must not
 * be a second guess at the same lockup. Two headers eighty lines apart that are
 * supposed to be identical are two headers that will stop being identical.
 *
 * WHY A TEACHER'S PAGE WEARS A STUDENT'S CHROME AT ALL. The workshop pages —
 * tutorBench, faceKit, studio — are dark and English and built from Tailwind's
 * slate, because they are for whoever built the thing. /teach is not that. A
 * teacher is a user of LingoMondo the way a student is, arriving from the same
 * family of apps and expecting them to look like one product, so this page
 * takes the LingoLabo look the family shares (see sciptomondo/STYLE_GUIDE.md).
 * That the person using it is authoring rather than answering does not make it
 * a workshop page.
 *
 * THE BAR IS FULL BLEED, ITS CONTENTS ARE NOT — LingoLecto's `.header-inner`,
 * at its own numbers. The lockup is cut to the same 1152px column the page
 * body is cut to, with the same 16px gutter, so the wordmark starts where the
 * content starts. Without it the lockup hangs off the far corner of a wide
 * monitor while everything it belongs to sits in the middle. The gutter lives
 * on the inner row rather than on the bar for the reason LingoLecto found: on
 * the bar it lands outside the cap, which insets the lockup from the column
 * while the content is inset from the mat instead, and the two insets are not
 * the same 16px.
 */

interface BrandBarProps {
  /**
   * The line after the divider — what this page is, in the target language.
   *
   * Per page rather than fixed, because it is the one part of the lockup that
   * says which page you are on. Omitted drops the divider with it, rather than
   * leaving a rule with nothing after it.
   */
  tagline?: string;
  /** The right-hand control: a language picker, a link, a count. */
  children?: ReactNode;
}

export default function BrandBar({ tagline, children }: BrandBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center border-b-4 border-lingo-rule bg-lingo-bar">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4">
        {/*
          No `gap` on this row: every piece of the lockup carries its own
          margin, copied one for one from LingoLecto, and a gap here would add
          itself to each of them — which is how the wordmark came to sit 14px
          from `Voco` where LingoLecto puts it at 9.
        */}
        <div className="flex items-center">
          {/*
            Chock A Block draws the tile box as part of each glyph, so the
            wordmark is text with a stroke rather than text on a fill — a CSS
            background would cover the whole inline box and turn the blocks'
            transparent interiors opaque. Cream on this blue is about 1.3:1, so
            the stroke is doing the real work.

            The sizes are LingoLecto's `.brand-lock--inline`, not a fresh guess:
            30px wordmark, 26px badge around a 15px glyph, 22px sub-name, 22px
            divider. That variant exists because its reading view is a 100vh
            flex column where a pixel of header is a pixel of passage, so the
            lockup is grown inside a fixed 56px bar rather than by growing the
            bar — the wordmark plus its stroke is ~32px of the 56, and that is
            the ceiling here, not the font size. Every page that wears this bar
            is the same shape and takes the same numbers; anything smaller and
            the apps read as different headers, which is what they did.
          */}
          <div
            className="flex gap-0.5 font-lingo-block text-[30px] leading-none"
            role="img"
            aria-label="LingoMondo"
          >
            {'LINGO'.split('').map((letter, index) => (
              <span
                key={`lingo-${index}`}
                aria-hidden="true"
                className="text-lingo-paper"
                style={{ WebkitTextStroke: '0.03em #311706' }}
              >
                {letter}
              </span>
            ))}
            {'MONDO'.split('').map((letter, index) => (
              <span
                key={`mondo-${index}`}
                aria-hidden="true"
                className="text-lingo-gold"
                style={{ WebkitTextStroke: '0.03em #311706' }}
              >
                {letter}
              </span>
            ))}
          </div>

          <div className="ml-[9px] flex items-center gap-1.5">
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md border-2 border-lingo-stroke bg-lingo-accent shadow-lingo-pop-sm">
              <Mic size={15} className="text-lingo-paper" strokeWidth={2.5} />
            </span>
            <span
              className="font-lingo-brand text-[22px] leading-none text-lingo-accent"
              style={{ WebkitTextStroke: '0.07em #311706', paintOrder: 'stroke fill' }}
            >
              Voco
            </span>
          </div>

          {tagline && (
            <>
              <span className="mx-3 h-[22px] w-px bg-lingo-paper/30" />
              <span className="font-lingo-hand text-sm leading-none text-lingo-paper/75">
                {tagline}
              </span>
            </>
          )}
        </div>

        {children}
      </div>
    </header>
  );
}
