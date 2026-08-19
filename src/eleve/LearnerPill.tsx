import { useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { FR } from './strings';
import { useLongPress } from './useLongPress';

/**
 * The learner's own words, the microphone that caught them, and the call.
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
 *
 * AND IT CARRIES THE CALL. Commencer and Raccrocher used to sit under the pill
 * as a separate block, which put three stacked things between the tutor's words
 * and the foot of the page and spent the height on air. They belong here: the
 * pill is already the learner's half of the conversation — their voice, their
 * microphone — and starting or ending the call is the same kind of act. One
 * strip now holds all three, and the whole of what it gave back went to the
 * balloon above it.
 */

interface LearnerPillProps {
  /** The last completed utterance, or empty before there is one. */
  text: string;
  live: boolean;
  muted: boolean;
  /** Whether the microphone is hearing a voice right now. */
  heard: boolean;
  /** What the call button says now: Commencer, Recommencer, Raccrocher, Connexion… */
  callLabel: string;
  /** Whether the call is mid-connect, which is the one moment it cannot be pressed. */
  callBusy: boolean;
  onCall: () => void;
  onToggleMute: () => void;
  onWord: (word: string, context: string) => void;
}

export default function LearnerPill({
  text,
  live,
  muted,
  heard,
  callLabel,
  callBusy,
  onCall,
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
    /*
      The ten pixels under the rim are slack, not spacing.

      The pill is pinned to the foot of the panel and grows as the sentence in
      it wraps, so a long answer takes a second and a third line — and the rim
      used to sit straight on the panel's own padding, which put the shadow hard
      against the bottom of the window and read as the pill falling out of the
      page rather than resting in it. Small enough that nothing above it moves,
      wide enough that a three-line pill still has ground under it.
    */
    <div className="relative mx-auto mb-2.5 w-full max-w-xl shrink-0">
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

      {/*
        Padded by the gap between its two controls rather than by a text inset,
        which is what makes the round microphone and the call button sit at even
        clearance from the rim instead of one of them looking pushed in.
      */}
      <div
        className={`relative flex items-center gap-3 rounded-full border-2 bg-lingo-cream p-3 shadow-lingo-pop-sm transition-colors ${
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

        {/*
          Orange while there is a call to start, quiet once there is one running
          — the same swap the block below the pill used to make, and the reason
          it is one button rather than two: the learner's only control over the
          tutor is when to talk to it, so there is only ever one thing to press.
        */}
        <button
          type="button"
          onClick={onCall}
          disabled={callBusy}
          className={`h-11 shrink-0 rounded-full px-6 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            live
              ? 'border-2 border-lingo-border-strong bg-lingo-paper text-lingo-muted hover:border-lingo-accent-deep hover:bg-lingo-accent-glow hover:text-lingo-accent-deep'
              : 'bg-lingo-accent text-white shadow-lingo-pop-sm hover:bg-lingo-accent-deep'
          }`}
        >
          {callLabel}
        </button>
      </div>
    </div>
  );
}
