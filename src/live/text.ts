/**
 * A speech bubble holds the last thing said, not everything ever said.
 *
 * Left to grow, a bubble stops being a bubble — it becomes a transcript pane
 * with a tail. The full text is still kept; this only decides how much of it is
 * in the balloon.
 */

/** Keeps the terminator, so trimmed text still reads as sentences. */
const SENTENCE_END = /(?<=[.!?…。！？])\s+/;

export function tailSentences(text: string, keep: number): string {
  const trimmed = text.trim();
  const sentences = trimmed.split(SENTENCE_END).filter(Boolean);
  if (sentences.length <= keep) return trimmed;
  // No leading ellipsis: the words that fell off are still in the log below,
  // and a bubble that starts with punctuation reads as a glitch.
  return sentences.slice(-keep).join(' ');
}
