import type { LipsyncPackage } from './published';
import { REACTION_CLIP_KINDS, clipKindOf, tagForKind } from './tags';
import type { ReactionClipKind } from './tags';

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
 *
 * WHY THE PUNCTUATION ONE *IS* OFFERED AS A FIX, which looks like a reversal of that and
 * is not. Both halves of the rule above fail to apply. The right place for the comma is
 * not ambiguous — it is beside the tag, and there is nowhere else it could go. And a wrong
 * guess is not silent: the rewrite lands in the textarea where it can be read before
 * anything is spent, and the gap it was meant to buy is measured afterwards and printed on
 * the audio report. It is offered rather than applied for the remaining reason, which is
 * that punctuation changes how a line is read and that is the author's to decide.
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
 * A reaction tag with a word butted against it, which will sound like an interruption.
 *
 * WHY THIS MATTERS ONLY FOR LIFTED TAGS. A tag the model performs itself phrases its own
 * room — it knows a sigh is coming because it can see the tag. One the library covers is
 * removed before synthesis, so the model has no reason to leave a gap where it was, and
 * two words either side run straight together. That is the trade splitClips documents, and
 * this is the part of it an author can act on.
 *
 * READS THE RAW TEXT, NOT THE SCRIPT, and that is why this is a separate function rather
 * than another regex inside scriptWarnings. `stripTags` has already removed the tags by
 * the time a script exists, so the position being warned about is gone: there is nothing
 * left in that string to point at.
 */
export interface RoomWarning {
  tag: string;
  /** Where the tag starts in the raw text, so a fix can be applied without searching. */
  at: number;
  kind: ReactionClipKind;
}

/** Punctuation that already buys room, so nothing needs adding on that side. */
const BREATHES = /[,.!?;:—–…)\]]/;
const OPENS = /[([]/;

/**
 * Every covered reaction in the text that has no punctuation to sit against.
 *
 * `covered` is passed rather than assumed for the same reason splitClips takes it: a kind
 * with no clip for this voice is still the model's to perform on v3, and warning about the
 * spacing of something we are not going to splice would be advice about nothing.
 */
export function roomWarnings(
  text: string,
  covered: readonly ReactionClipKind[] = REACTION_CLIP_KINDS,
): RoomWarning[] {
  const out: RoomWarning[] = [];

  for (const match of text.matchAll(/\[[^\]\n]*\]/g)) {
    const kind = clipKindOf(match[0]);
    if (kind === null || !covered.includes(kind)) continue;

    const at = match.index;
    const head = text.slice(0, at);
    const tail = text.slice(at + match[0].length);

    // Only spaces and tabs are skipped, never a newline: a tag at the start of its own
    // line already has all the room a line break can give it.
    const left = /[^ \t]?[ \t]*$/.exec(head)?.[0].trim() ?? '';
    const right = /^[ \t]*[^ \t]?/.exec(tail)?.[0].trim() ?? '';

    // ONE MARK IS ENOUGH, AND TWO IS A BUG. The tag is removed before synthesis, so a
    // comma either side of it collapses to ",," in what the model is asked to say. What
    // buys the room is a single pause at the point the reaction occupies — so punctuation
    // on EITHER side already does the job, and the fix adds one only when there is none.
    const roomBefore = left === '' || BREATHES.test(left) || OPENS.test(left);
    const roomAfter = right === '' || BREATHES.test(right);
    if (!roomBefore && !roomAfter) out.push({ tag: match[0], at, kind });
  }

  return out;
}

/**
 * The mark a kind wants beside it: a comma for something brief, a dash for something long.
 *
 * NEVER A FULL STOP, and that is the line this deliberately does not cross. A period means
 * recapitalising the word after it, which is rewriting somebody's sentence rather than
 * pacing it — and getting that wrong in French or Spanish, where this app also runs, is a
 * good deal easier than getting it right. A long reaction that really wants a sentence
 * boundary is left to the author, who is told so.
 */
function markFor(kind: ReactionClipKind): string {
  return tagForKind(kind)?.perform === 'arc' ? '—' : ',';
}

/**
 * The text with one mark added in front of every reaction that had no room.
 *
 * IN FRONT, and only one. The tag comes out before synthesis, so what the model receives
 * is the words either side with the mark between them — which is the pause the reaction
 * then sits inside. Putting a mark on both sides would send it a doubled one.
 *
 * Applied right to left so that an earlier insertion does not invalidate a later offset.
 * The alternative is recomputing every position after each edit, which is the same thing
 * done less obviously.
 *
 * A dash is spaced on both sides and a comma is not, which holds in all three languages
 * this app speaks. French also spaces `?`, `!`, `;` and `:`, and none of those are marks
 * this inserts, so the language does not need to be known here.
 */
export function addRoom(text: string, warnings: readonly RoomWarning[]): string {
  let out = text;

  for (const w of [...warnings].sort((a, b) => b.at - a.at)) {
    const mark = markFor(w.kind);
    const head = out.slice(0, w.at).replace(/[ \t]*$/, '');
    const lead = mark === '—' ? ` ${mark} ` : `${mark} `;
    out = head + lead + out.slice(w.at);
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
