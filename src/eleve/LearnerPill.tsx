import { useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { FR } from './strings';
import { useLongPress } from './useLongPress';

/**
 * The learner's own words, and the microphone that caught them.
 *
 * ONLY COMPLETED UTTERANCES REACH IT. The provider streams a partial
 * transcription of the user as they speak, and it is bad — it revises itself
 * mid-clause and guesses badly at a learner's accent. Showing it would put a
 * garbled version of your own sentence in front of you while you are still
 * saying it, which is worse than showing nothing and actively discouraging: the
 * page appears to be mishearing you. So the pill waits for a turn to close.
 *
 * IT IS ALSO THE MICROPHONE. Pressing it mutes and unmutes, and it pulses while
 * a voice is actually being heard — which makes "is this thing on" answerable
 * without a separate indicator to look for. The pulse is driven by the
 * provider's own voice detection rather than by a level meter: that is the same
 * signal the tutor is using to decide you have finished talking, so what the
 * pill shows is what the tutor believes.
 */

interface LearnerPillProps {
  /** The last completed utterance, or empty before there is one. */
  text: string;
  live: boolean;
  muted: boolean;
  /** Whether the microphone is hearing a voice right now. */
  heard: boolean;
  onToggleMute: () => void;
  onWord: (word: string, context: string) => void;
}

export default function LearnerPill({
  text,
  live,
  muted,
  heard,
  onToggleMute,
  onWord,
}: LearnerPillProps) {
  const body = useRef<HTMLDivElement>(null);
  useLongPress(body, onWord, Boolean(text));

  const hint = !live
    ? FR.pillIdle
    : muted
      ? FR.pillMuted
      : heard
        ? FR.pillListening
        : FR.pillWaiting;

  const listening = live && !muted && heard;

  return (
    <div className="relative mx-auto w-full max-w-xl">
      {/*
        The pulse is a sibling rather than a ring on the pill itself, so it can
        scale past the pill's own edge without the text moving with it.
      */}
      {listening && (
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full bg-lingo-accent/20"
          style={{ animationDuration: '1.6s' }}
        />
      )}

      <div
        className={`relative flex items-center gap-4 rounded-full border-2 bg-lingo-cream px-6 py-4 shadow-lingo-pop-sm transition-colors ${
          listening ? 'border-lingo-accent' : 'border-lingo-border-strong'
        }`}
      >
        <button
          type="button"
          onClick={onToggleMute}
          disabled={!live}
          aria-label={muted ? FR.muteOff : FR.muteOn}
          title={muted ? FR.muteOff : FR.muteOn}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            muted
              ? 'border-lingo-error bg-lingo-error text-white'
              : 'border-lingo-accent text-lingo-accent hover:bg-lingo-accent hover:text-white'
          }`}
        >
          {muted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        <div
          ref={body}
          data-dict-context
          className={`min-w-0 flex-1 text-center text-base leading-snug ${
            text ? 'text-lingo-ink' : 'text-lingo-muted/70 italic'
          }`}
        >
          {text || hint}
        </div>

        {/* Balances the button so the text stays optically centred. */}
        <span aria-hidden="true" className="h-11 w-11 shrink-0" />
      </div>
    </div>
  );
}
