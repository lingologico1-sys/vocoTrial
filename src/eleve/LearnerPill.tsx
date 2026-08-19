import { useRef } from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import { FR } from './strings';
import { useLongPress } from './useLongPress';

/**
 * The learner's own words, and the microphone that is now the whole call.
 *
 * ONLY COMPLETED UTTERANCES REACH IT. The provider streams a partial
 * transcription of the user as they speak, and it is bad — it revises itself
 * mid-clause and guesses badly at a learner's accent. Showing it would put a
 * garbled version of your own sentence in front of you while you are still
 * saying it, which is worse than showing nothing and actively discouraging: the
 * page appears to be mishearing you. So the pill waits for a turn to close.
 *
 * THE MICROPHONE IS THE ONLY CONTROL, and it is big because of it. Commencer,
 * Recommencer and Raccrocher were three words for one act — deciding whether to
 * be talking to the tutor — and they sat in a pill beside a microphone that did
 * a fourth, quieter thing. Now the button starts the call, ends it, and is the
 * indicator while it runs. Mute went with them: the learner's way of not being
 * heard is to stop the call, and a second mode on the same button would make
 * the state it shows ambiguous exactly when it matters most.
 *
 * THE RED STAYS INSIDE THE BUTTON. The pulse used to be a ring on the pill
 * itself, scaling a wash of accent out past all four rims — which spent the
 * widest element on the page to say something about a 44px control. Now the
 * button fills and haloes (see the lingo-halo keyframe, sized so it cannot
 * reach the pill's edge), and the pill is left to hold text.
 *
 * WHICH LEAVES THE HINT. Before the first call there is nothing to transcribe,
 * so the space goes to an arrow pointing back at the button, in the hand font
 * the rest of the family uses for asides. It returns between calls as
 * "recommencer", which is the whole of what the second button used to be for.
 */

interface LearnerPillProps {
  /** The last completed utterance, or empty before there is one. */
  text: string;
  live: boolean;
  /** Mid-connect: the one moment the button cannot be pressed. */
  busy: boolean;
  /** Whether the microphone is hearing a voice right now. */
  heard: boolean;
  /**
   * What the arrow points at when there is no call — start, or start again.
   *
   * Passed in rather than chosen here, for the same reason the call label used
   * to be: which of the two it is depends on whether this learner has already
   * had a conversation, and that is the page's memory, not the pill's.
   */
  idleHint: string;
  onCall: () => void;
  onWord: (word: string, context: string) => void;
}

export default function LearnerPill({
  text,
  live,
  busy,
  heard,
  idleHint,
  onCall,
  onWord,
}: LearnerPillProps) {
  const body = useRef<HTMLDivElement>(null);

  const listening = live && heard;

  /*
   * The transcript is shown only while the call it belongs to is up.
   *
   * Once the call ends, the sentence you last said is worth less than the way
   * back in: the evaluation panel keeps the conversation, and leaving the last
   * line sitting here would bury the only remaining control's own label behind
   * a sentence that is already finished with.
   */
  const showText = live && Boolean(text);

  useLongPress(body, onWord, showText);

  const hint = busy ? FR.starting : !live ? idleHint : heard ? FR.pillListening : FR.pillWaiting;

  /*
    Tone by state, and the two filled ones are told apart by the halo rather
    than by colour: orange-and-still is an invitation, orange-and-pulsing is the
    microphone hearing you. Between them sits the quiet cream of a call that is
    up and waiting, which is the state a learner should read as "your turn".

    Hover while live is the one place the glyph changes. Nothing on a resting
    button should say "hang up" — it would read as the call's label rather than
    as what a press would do — but reaching for it has to be answerable before
    the click, so the mic becomes a dropped handset under the pointer.
  */
  const tone = !live
    ? 'border-lingo-accent bg-lingo-accent text-white shadow-lingo-pop-sm hover:border-lingo-accent-deep hover:bg-lingo-accent-deep'
    : listening
      ? 'border-lingo-accent bg-lingo-accent text-white hover:border-lingo-error hover:bg-lingo-error'
      : 'border-lingo-accent bg-lingo-cream text-lingo-accent hover:border-lingo-error hover:bg-lingo-error hover:text-white';

  const idle = !live && !busy;

  return (
    /*
      The ten pixels under the rim are slack, not spacing.

      The pill is pinned to the foot of the panel and grows upward as the
      sentence in it wraps — and the rim used to sit straight on the panel's own
      padding, which put the shadow hard against the bottom of the window and
      read as the pill falling out of the page rather than resting in it. Small
      enough that nothing above it moves, wide enough that a three-line pill
      still has ground under it.
    */
    <div className="relative mx-auto mb-2.5 w-full max-w-xl shrink-0">
      {/*
        Padded by the gap around the microphone rather than by a text inset. The
        right side carries more than the left because there is no longer a
        second control to balance it: an equal inset would leave the last word
        of a wrapped line almost touching the rim.
      */}
      <div className="relative flex items-center gap-4 rounded-full border-2 border-lingo-border-strong bg-lingo-cream py-3 pl-3 pr-7 shadow-lingo-pop-sm">
        <div className="relative shrink-0">
          {listening && (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-lingo-halo rounded-full bg-lingo-accent"
            />
          )}

          <button
            type="button"
            onClick={onCall}
            disabled={busy}
            aria-label={live ? FR.hangUp : FR.micStart}
            title={live ? FR.hangUp : FR.micStart}
            className={`group relative flex h-16 w-16 items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
          >
            {live ? (
              <>
                <Mic size={28} className="group-hover:hidden group-focus-visible:hidden" />
                <PhoneOff size={26} className="hidden group-hover:block group-focus-visible:block" />
              </>
            ) : (
              <Mic size={28} className={busy ? 'animate-pulse' : undefined} />
            )}
          </button>
        </div>

        <div ref={body} data-dict-context className="min-w-0 flex-1 text-center text-base leading-snug">
          {showText ? (
            <span className="text-lingo-ink">{text}</span>
          ) : (
            <span className="inline-flex items-center gap-2 text-lingo-muted/75">
              {/*
                Hand-drawn rather than a glyph, and only before a call: it aims
                at one specific button a fixed distance to its left, which is
                not something an arrow character can be made to do. It leaves
                the moment the call is up, because by then the button it points
                at has a job the sentence beside it no longer describes.
              */}
              {idle && (
                <svg
                  viewBox="0 0 44 16"
                  width="32"
                  height="13"
                  aria-hidden="true"
                  className="shrink-0 animate-lingo-nudge overflow-visible"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M42 3 C 30 1, 14 3, 6 10" />
                  <path d="M6 10 L 8.6 2.4 M6 10 L 13.9 8.5" />
                </svg>
              )}
              <span className={idle ? 'font-lingo-hand text-[17px]' : 'italic'}>{hint}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
