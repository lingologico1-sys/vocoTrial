/**
 * A speech bubble holds the last thing said, not everything ever said.
 *
 * Left to grow, a bubble stops being a bubble — it becomes a transcript pane
 * with a tail. The full text is still kept; this only decides how much of it is
 * in the balloon.
 */

/**
 * Where one sentence ends and the next begins.
 *
 * Two alternatives rather than one character class, because the space after the
 * terminator is required in some scripts and absent in others — and the original
 * single rule, which demanded one, silently did nothing at all in the scripts
 * that do not use it. A Japanese or Chinese turn never split, so the balloon
 * grew for the whole call: exactly the transcript-pane-with-a-tail the comment
 * above says it must not become.
 *
 *  - `[.!?…]` needs trailing whitespace, and needs it for a reason worth keeping:
 *    it is what stops a decimal point from ending a sentence. "3.50" survives
 *    because nothing follows the dot; "3. 50" would not, and neither would
 *    "Dr. Smith", which is a pre-existing wrong answer this does not make worse.
 *  - `[。！？؟]` splits with or without it. The CJK terminators are full-width
 *    and unambiguous — they do not appear inside numbers or abbreviations — so
 *    there is nothing for the whitespace to protect against, and demanding it
 *    is what broke them. `؟` is Arabic's question mark, which does take a space
 *    in practice; it sits here rather than above only because it is equally
 *    unambiguous and costs nothing to be lenient about.
 *
 * Greek is knowingly left out. Its question mark is the semicolon, which is
 * ordinary mid-sentence punctuation everywhere else and would split French and
 * German sentences in half — the fix needs the language code, which nothing at
 * this level has. Greek still splits on its full stops, so the balloon still
 * trims; it just keeps a question and its answer together.
 *
 * Thai has no sentence-final punctuation at all and is not handled by any of
 * this. It marks sentences with spaces and questions with particles, so there is
 * no terminator to find and its balloon still grows unbounded.
 */
const SENTENCE_END = /(?<=[.!?…])\s+|(?<=[。！？؟])\s*/g;

export function tailSentences(text: string, keep: number): string {
  const trimmed = text.trim();

  /**
   * Where each sentence after the first begins.
   *
   * Offsets into the original rather than an array of pieces, because the pieces
   * would have to be joined again and there is no separator that is right for
   * every script: a space is what English lost at the split and what Japanese
   * never had, so rejoining with one repairs the first and damages the second.
   * Slicing the input at a boundary returns whatever was actually there.
   *
   * A boundary at the very end is dropped. Text closing on a CJK terminator has
   * one — the pattern can match the empty string after it — and counting it
   * would claim a final sentence that is nothing at all, costing a real one its
   * place in the balloon. The old code was safe from this only because `filter`
   * quietly threw the empty piece away.
   */
  const starts = [...trimmed.matchAll(SENTENCE_END)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((at) => at < trimmed.length);

  if (starts.length + 1 <= keep) return trimmed;
  // No leading ellipsis: the words that fell off are still in the log below,
  // and a bubble that starts with punctuation reads as a glitch.
  return trimmed.slice(starts[starts.length - keep]);
}
