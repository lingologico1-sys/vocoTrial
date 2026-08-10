/**
 * Holding the agent's words back until they are audible.
 *
 * Gemini streams audio faster than real time and the transcript alongside it,
 * so text rendered on arrival finishes a sentence the voice has not started.
 * Each delta carries the output-clock time it will be heard at (see
 * TranscriptDelta.at), and this holds it until that moment comes round.
 *
 * The other half of the reason is barge-in. When the user talks over the agent,
 * the queued audio is dropped and never spoken — and only text that was still
 * waiting here can be dropped with it. Text already on screen cannot be
 * unsaid, which is exactly why it must not go on screen early.
 */

export interface StampedText {
  text: string;
  done: boolean;
  /** Output-clock time this becomes audible. */
  at: number;
}

export class RevealQueue {
  private pending: StampedText[] = [];

  push(item: StampedText): void {
    this.pending.push(item);
  }

  /** Everything now audible, oldest first, removed from the queue. */
  take(now: number): StampedText[] {
    // Stamps are monotonic — the playhead only moves forward within a turn — so
    // the queue is already in order and the first item that is not due means
    // none after it are either.
    let count = 0;
    while (count < this.pending.length && this.pending[count].at <= now) count++;
    return count === 0 ? [] : this.pending.splice(0, count);
  }

  /**
   * Everything left, due or not. For the end of a call: whatever was still
   * waiting was said, or was about to be, and losing it silently would be worse
   * than showing it a moment early.
   */
  drain(): StampedText[] {
    return this.pending.splice(0, this.pending.length);
  }

  /** Barge-in: the audio for all of this was thrown away, so this goes too. */
  discard(): void {
    this.pending.length = 0;
  }

  get size(): number {
    return this.pending.length;
  }
}
