import type { LipsyncPackage } from './published';

/**
 * Things in a line that will align badly, said before a generation is spent on them.
 *
 * All of these are cheap to see in the text and expensive to discover afterwards: the
 * only symptom is a face that shuts its mouth while the voice is speaking, which looks
 * like a bug in the lip sync rather than a spelling in the script.
 *
 * WHY THIS IS NOT FIXED AUTOMATICALLY. It could be — a number could be spelled out
 * before the aligner sees it. But "6" is `six`, `sixième`, `le six` or `six heures`
 * depending on the sentence, and a wrong guess is worse than a warning because it is
 * silent. The person writing the line knows which they meant; this only has to tell them
 * it matters.
 */

export interface Warning {
  /** The exact substring at fault, so it can be searched for. */
  found: string;
  message: string;
}

/** Digits, which the voice reads aloud and no pronunciation dictionary lists. */
const DIGITS = /\d+(?:[.,]\d+)?/g;

/**
 * A word MFA will not find, spotted before it costs anything.
 *
 * The script rather than the raw text, because tags are stripped before the aligner sees
 * them and a digit inside a tag is not a word anybody says.
 */
export function scriptWarnings(script: string): Warning[] {
  const out: Warning[] = [];

  const digits = [...new Set(script.match(DIGITS) ?? [])];
  for (const found of digits) {
    out.push({
      found,
      message:
        `“${found}” is read aloud but no dictionary lists it, so the mouth will stay ` +
        `shut over it. Write it as words instead.`,
    });
  }

  return out;
}

/**
 * Whether a word in the aligner's tier is one the script actually contains.
 *
 * MFA merges tokens across some punctuation — "lycée, c'était" comes back as the single
 * word "lycéec'était" — and that matters here for one reason only: a genuine pause at
 * the comma then falls *inside* a word, and anything looking for quiet-while-speaking
 * reports it as an anomaly when it is the most ordinary thing in the sentence.
 *
 * Cheap to detect, because a merged token is by definition not in the script.
 */
export function isMergedWord(pkg: LipsyncPackage, word: string): boolean {
  const tokens = new Set(
    pkg.script
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
      .filter(Boolean),
  );
  return !tokens.has(word.toLowerCase());
}
