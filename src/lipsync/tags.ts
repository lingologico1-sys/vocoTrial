// The leaf, not polly.ts. This module is imported by functions/api/lipsync, which
// runs in a Worker; polly.ts reaches AudioContext through visemes.ts and would
// take the whole browser audio stack in with it. See visemeTable.ts.
// No POLLY_VISEMES here any more, and its absence is the point: a reaction has no
// phone, so there is nothing to collapse. This module names poses directly.
import type { Viseme, VisemeMark } from '../live/visemeTable';
import type { ExpressionSpan, ReactionOptions } from './published';

/**
 * ElevenLabs v3 audio tags, sorted by what they do to a forced alignment.
 *
 * The palette is one list to a person writing a line and three quite different things to
 * an aligner, and the difference decides whether a tag is free, helpful, or a hazard.
 *
 *   directive  [happy] [whispering] [slowly] — change how the words are said and add no
 *              audio of their own. Strip them from the transcript and alignment is
 *              untouched. Free.
 *
 *   pause      [pause] [long pause] — insert silence. MFA does not label silence; it
 *              leaves a hole in the phone tier, and to_marks already turns a hole into
 *              `sil`. So these close the mouth correctly without anything extra. They are
 *              the case that exposed the freeze-open bug in the first place.
 *
 *   reaction   [laughs] [sighs] [gasps] — audio with no words in it. This is the hazard.
 *              MFA is handed a transcript saying nothing happened there, so it stretches
 *              the surrounding words across the laugh to account for the time, and the
 *              mouth is then wrong on both sides of it as well as during.
 *
 * WHAT FIXES THE HAZARD is something we already had and were only using for verification.
 * ElevenLabs' character timestamps cover the tag's own characters, so the span a reaction
 * occupies is known exactly. `overlayReactions` replaces the marks inside that span with
 * a pose chosen for the reaction and leaves the marks either side alone.
 *
 * It is a heuristic and worth saying so: a laugh is not one pose held for a second. It is
 * better than words smeared across it, which is the bar, and it is at least honest about
 * which span it covers, because the span is measured rather than guessed.
 */

export type TagKind = 'directive' | 'pause' | 'reaction';

/**
 * How the MP3 that actually gets spliced was made.
 *
 * DEFINED HERE RATHER THAN IN laughs.ts, WHERE IT IS MOSTLY USED, because the tag table's
 * `prefer` field needs it and this module deliberately imports nothing from the library.
 * tags.ts is the leaf — it is pulled into a Worker by functions/api/lipsync — so every
 * edge points at it and none point out. laughs.ts re-exports this for its own callers.
 */
export type ClipTreatment = 'original' | 'voice-converted';

export interface Tag {
  /** Exactly as it must appear in the text, brackets included. */
  tag: string;
  kind: TagKind;
  /** Which group the picker files it under. */
  group: 'Emotions' | 'Delivery' | 'Reactions' | 'Pacing';
  /**
   * True of a reaction that can be replaced by a recording somebody provided.
   *
   * THIS FLAG IS THE KIND SET. REACTION_CLIP_KINDS is derived from it, so adding a tag to
   * the library is one field here rather than an edit in four files that have to agree.
   * A row carrying it must also carry a `viseme`, because a spliced clip builds its span
   * from this table and a span with no pose is a clip nothing can draw — asserted in
   * scripts/laughs.ts rather than left to convention.
   *
   * Not every reaction has it, and the omissions are deliberate. `[panting]` is rhythmic
   * and pulses rather than holding, so one recording cannot stand in for a span of
   * arbitrary length. `[hesitates]` and `[stammers]` are wordlike and language-specific:
   * a recorded English "um" spliced into a French lesson is worse than the model's own
   * attempt, which at least hesitates in the right language.
   */
  clip?: true;
  /**
   * Which treatment this sound defaults to when nobody has chosen one for the voice.
   *
   * Per kind rather than per category, because "unvoiced" is not the cut that matters.
   * Speech-to-speech is a *speech* model: it has plenty to work with in a yawn, which is
   * voiced and sustained, and nothing at all in a 200ms throat click. So a yawn defaults
   * to a conversion and a gulp to the recording as made. An author's explicit per-voice
   * choice still wins over this — see preferredTreatmentByVoice in laughs.ts.
   */
  prefer?: ClipTreatment;
  /**
   * Whether background-noise removal is on by default when converting this kind.
   *
   * ElevenLabs' isolation model is trained to remove everything that is not speech, and a
   * sniff *is* not speech. On a laugh it takes a room off and occasionally softens the
   * edges; on a breath sound it can remove the clip. Off by default for anything breathy,
   * and still available for a recording with an audible room behind it.
   */
  denoise?: boolean;
  /**
   * For reactions only: the pose its span wears.
   *
   * A drawn pose rather than a Polly identifier, and that is a change from how this
   * table started. Emitting identifiers was right while every mark came from a phone,
   * because it kept POLLY_VISEMES the only place the collapse onto artwork happened.
   * A reaction has no phone — nothing in any transcript says a laugh — so there is
   * nothing to collapse, and naming the pose directly is the honest form.
   */
  viseme?: Viseme;
  /**
   * How the span is played, for reactions.
   *
   *   hold   one shape for the whole span. Right when the body really does hold still:
   *          a gasp snaps open and stays open, a gulp keeps the lips shut throughout.
   *   pulse  alternates with `rebound`. For anything rhythmic — a laugh, panting —
   *          where one held shape reads as a scream rather than as breathing.
   *   arc    `edge`, then the main pose, then `edge` again. For anything with a shape
   *          over time: a yawn opens slowly and closes slowly, a sigh parts and trails
   *          shut. Holding the middle of one of those loses the whole gesture.
   */
  perform?: 'hold' | 'pulse' | 'arc';
  /** Where a pulse falls back to between beats. */
  rebound?: Viseme;
  /** Where an arc begins and ends. */
  edge?: Viseme;
  /** Half a pulse, in ms. Panting is quicker than laughing. */
  pulseMs?: number;
  /**
   * What the eyes do, decided by the body rather than by preference.
   *
   * `none` is a real answer and not an omission — a gasp WIDENS the eyes, and there is
   * no wide-eye artwork in any kit, so shutting them would be worse than leaving them
   * alone. Written out for every reaction so that the absence is visibly deliberate.
   */
  eyes?: 'closed' | 'blink' | 'none';
  /** True of a laugh, which is the only thing a smile precedes. */
  laughing?: boolean;
  /**
   * True of a giggle, which is a laugh with its mouth shut.
   *
   * A SECOND FLAG RATHER THAN A DEGREE ON THE FIRST. The two share a shape — held pose,
   * head carrying the rhythm — and differ in every switch that reaches them: a giggle
   * wants no lead-in smile (its pose already is `smile`, so a smile before it is a
   * smile before itself), no eye channel at all, and a shallower bob. A single
   * `laughing` with an intensity beside it would have had three call sites asking
   * "which kind" through a number, which is the flag written badly.
   */
  giggling?: boolean;
}

const directive = (group: Tag['group']) => (tag: string): Tag => ({
  tag,
  kind: 'directive',
  group,
});

export const TAGS: Tag[] = [
  // Emotions and delivery are pure direction: no audio of their own, so no risk.
  ...['[happy]', '[sad]', '[angry]', '[excited]', '[nervous]', '[curious]',
    '[frustrated]', '[calm]', '[terrified]', '[bored]'].map(directive('Emotions')),
  ...['[whispering]', '[shouting]', '[quietly]', '[loudly]', '[rushed]', '[slowly]',
    '[flatly]', '[monotone]', '[dramatic]', '[warmly]'].map(directive('Delivery')),

  // Reactions. Each carries how it is played and what the eyes do, both chosen from
  // what the body actually does rather than from what is convenient.
  //
  // A laugh: eyes screwed up, the only one a smile precedes, and the only one whose
  // rhythm is carried by the head instead of the mouth.
  //
  // HELD, AND IT USED TO PULSE. The pulse alternated `laugh` with a half-open `uh` at
  // LAUGH_PULSE_MS, on the argument that a laugh is a jaw bouncing rather than one
  // shape held — which is true of a face and false of a facekit. A kit does not open a
  // jaw, it swaps one whole drawn mouth for another, and `laugh` and `uh` differ in
  // width, in curve and in whether the lower teeth show. Alternating them eight times a
  // second is not a jaw, it is two pictures flapping, and it got worse rather than
  // better the harder the pulse was driven.
  //
  // The rhythm was right; the channel was wrong. It is on the head now — the pose is
  // held and `laughBob` dips the head through the span. See LAUGH_NOD_GAIN in
  // headMotion.ts, and `nod` below, which is what turns it on.
  { tag: '[laughs]', kind: 'reaction', group: 'Reactions', viseme: 'laugh',
    perform: 'hold', eyes: 'closed', laughing: true,
    clip: true, prefer: 'voice-converted', denoise: true },
  // A giggle: the same gesture as a laugh, one size down and with the mouth shut. It
  // was a literal alias of [laughs] until now — same open pose, same closed eyes, same
  // bob — which meant the palette offered a distinction it did not draw.
  //
  // THE MOUTH IS `smile`, NOT `laugh`. slots.ts keeps `smile` closed on purpose and
  // calls a closed-mouth laugh a stifled one, which is exactly what a giggle is. That
  // one substitution carries most of the difference on its own: the teeth do not
  // appear, the jaw does not drop, and what is left to read laughter from is the head.
  //
  // EYES LEFT ALONE, and this is where it parts company with the laugh rather than
  // merely scaling it. A laugh screws its eyes up; a giggle is the version being held
  // in, and the kit has no eye-crinkle artwork to say so. Lids down across a shut mouth
  // is not a smaller laugh — it is a face doing nothing at all, which on a portrait
  // reads as serene or asleep. With the mouth closed the bob is the only signal left,
  // and the open eyes are what keep it looking amused rather than becalmed.
  //
  // No lead-in smile either, and not by omission: `laughing` is what leadIns gates on,
  // and a giggle whose own pose is `smile` has nothing to anticipate with. The bob is
  // shallower — see GIGGLE_BOB_GAIN in headMotion.ts, which is where the depth lives,
  // because depth is a fact about playback and this table is a fact about the body.
  { tag: '[giggles]', kind: 'reaction', group: 'Reactions', viseme: 'smile',
    perform: 'hold', eyes: 'none', giggling: true,
    clip: true, prefer: 'voice-converted', denoise: true },

  // Panting keeps the pulse, and is the only thing left that has one. It survives the
  // argument above because it alternates between two poses that differ only in how far
  // the mouth is open — `aa` and `uh` are the same mouth at two sizes, where `laugh` and
  // `uh` are two different mouths — so the swap reads as breathing rather than as a
  // switch of picture. Quicker than a laugh was, too: breaths, not syllables.
  { tag: '[panting]', kind: 'reaction', group: 'Reactions', viseme: 'aa',
    perform: 'pulse', rebound: 'uh', pulseMs: 85, eyes: 'none' },

  // A yawn is slow open, long hold, slow close — and the eyes are half of what makes
  // one recognisable. Held `aa` with the eyes open gets the shape and misses the yawn.
  // Voiced and sustained, which is why this is the one of the six that defaults to a
  // conversion: there is a vowel in a yawn for a speech model to carry into the voice.
  { tag: '[yawn]', kind: 'reaction', group: 'Reactions', viseme: 'aa',
    perform: 'arc', edge: 'uh', eyes: 'closed',
    clip: true, prefer: 'voice-converted', denoise: true },

  // A sigh has a shape over time: the lips part, hold, and trail shut. The blink is
  // what a sigh looks like as much as the mouth is.
  { tag: '[sighs]', kind: 'reaction', group: 'Reactions', viseme: 'uh',
    perform: 'arc', edge: 'rest', eyes: 'blink',
    clip: true, prefer: 'original', denoise: false },

  // A gasp snaps open and STAYS open — the one place a held pose is literally correct.
  // Eyes deliberately left alone: a gasp widens them, and no kit has wide-eye artwork,
  // so shutting them would be actively wrong rather than merely incomplete.
  // The attack IS the gasp, and a conversion is liable to smear it, so the recording
  // stands as made unless somebody auditions a conversion and prefers it.
  { tag: '[gasps]', kind: 'reaction', group: 'Reactions', viseme: 'aa',
    perform: 'hold', eyes: 'none',
    clip: true, prefer: 'original', denoise: false },

  // Lips slightly parted, the sound made in the throat, and over quickly.
  { tag: '[clears throat]', kind: 'reaction', group: 'Reactions', viseme: 'uh',
    perform: 'hold', eyes: 'none',
    clip: true, prefer: 'original', denoise: false },

  // Swallowing keeps the lips shut. The throat does the work and a portrait has no
  // throat, so a closed mouth is not an approximation — it is all there is.
  { tag: '[gulps]', kind: 'reaction', group: 'Reactions', viseme: 'mbp',
    perform: 'hold', eyes: 'none',
    clip: true, prefer: 'original', denoise: false },

  // A sniff is nasal, and `rest` was the worst answer in the table: indistinguishable
  // from saying nothing. Compressed lips and a blink is what one looks like from the
  // front, the nose being the part a drawing cannot move.
  // Nasal, unvoiced, and the kind most easily destroyed by noise removal — a sniff is
  // exactly what an isolation model is trained to consider noise. See `denoise` above.
  { tag: '[sniffs]', kind: 'reaction', group: 'Reactions', viseme: 'mbp',
    perform: 'hold', eyes: 'blink',
    clip: true, prefer: 'original', denoise: false },

  // Pacing. The first three are silence, which the aligner handles correctly unaided.
  { tag: '[pause]', kind: 'pause', group: 'Pacing' },
  { tag: '[long pause]', kind: 'pause', group: 'Pacing' },
  { tag: '[continues after a beat]', kind: 'pause', group: 'Pacing' },
  // These two are filed as reactions despite sounding like pacing, because they add
  // sound rather than silence: a stammer repeats a syllable the transcript has once,
  // and a hesitation fills the gap with something wordlike. Both leave audio MFA has no
  // text for, which is the definition of the hazard above.
  { tag: '[hesitates]', kind: 'reaction', group: 'Pacing', viseme: 'uh',
    perform: 'hold', eyes: 'none' },
  { tag: '[stammers]', kind: 'reaction', group: 'Pacing', viseme: 'uh',
    perform: 'hold', eyes: 'none' },
];

const BY_TAG = new Map(TAGS.map((t) => [t.tag.toLowerCase(), t]));

/**
 * A reaction the library can stand in for, named without its brackets.
 *
 * WRITTEN OUT AS A UNION AND ALSO DERIVED BELOW, which looks like saying it twice and is
 * not. The union is what every signature downstream is checked against, so it has to be a
 * type; the derived list is what runs, so it has to come from the table or the table stops
 * being the single place a kind is added. scripts/laughs.ts asserts the two agree, which
 * is the only moment they could ever disagree.
 *
 * The values are the tag text, so `[clears throat]` is the kind `'clears throat'`, space
 * included. That reads oddly in a type and is right in every other respect: `clipKindOf`
 * unwraps a tag to get here and `clipSpan` re-wraps to look the row back up, so a kind is
 * exactly a tag with its brackets off and no mapping table is needed in between.
 */
export type ReactionClipKind =
  | 'laughs'
  | 'giggles'
  | 'yawn'
  | 'sighs'
  | 'gasps'
  | 'clears throat'
  | 'gulps'
  | 'sniffs';

/** Every kind the library can hold, in palette order. Derived; see ReactionClipKind. */
export const REACTION_CLIP_KINDS: ReactionClipKind[] = TAGS.filter((t) => t.clip).map(
  (t) => t.tag.slice(1, -1) as ReactionClipKind,
);

/**
 * `[sighs]` -> 'sighs'. Null for every other tag, which is still most of them.
 *
 * Case and surrounding space are forgiven because this reads what an author typed, and a
 * tag inserted by the palette sits next to tags that were not.
 */
export function clipKindOf(tag: string): ReactionClipKind | null {
  const inner = tag.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return (REACTION_CLIP_KINDS as string[]).includes(inner)
    ? (inner as ReactionClipKind)
    : null;
}

/** The table row for a kind, which is where its pose and its defaults live. */
export function tagForKind(kind: ReactionClipKind): Tag | undefined {
  return BY_TAG.get(`[${kind}]`);
}

/** Any bracketed run, whether or not it is a tag this build knows. */
const BRACKETED = /\[[^\]\n]*\]/g;

/**
 * The text with every tag removed, which is what the aligner is given.
 *
 * Unknown bracketed runs are stripped too. A tag this build has not heard of is still
 * not a word anybody said, and leaving it in would put a literal "[sobbing]" into the
 * transcript for MFA to look up, fail to find, and align as silence — shutting the mouth
 * across a word that really was spoken beside it.
 */
export function stripTags(text: string): string {
  return text
    .replace(BRACKETED, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** The reaction tags a line uses, which are the ones that cost alignment accuracy. */
export function reactionsIn(text: string): Tag[] {
  const found = text.match(BRACKETED) ?? [];
  return found
    .map((raw) => BY_TAG.get(raw.toLowerCase()))
    .filter((t): t is Tag => t?.kind === 'reaction');
}

/**
 * Words as the aligner will count them: whitespace-separated, tags already gone, and
 * anything with no letter or digit in it thrown away.
 *
 * THE LAST CLAUSE IS THE WHOLE POINT, and it was missing. French puts a space before
 * `?`, `!`, `;` and `:`, so "sur le mur ?" splits into nine tokens where MFA reports
 * eight words — a bare `?` is punctuation to the aligner and never reaches its word
 * tier. Every laugh standing after such a mark then anchored one word late, which is
 * exactly the failure this counts against: the laugh landed after the first word of the
 * next sentence instead of in the silence before it. Proportional rescaling in
 * `clipTimeMs` does not save it, because a one-token disagreement spread over forty
 * words rounds straight back to the same off-by-one.
 */
export function wordCount(script: string): number {
  return script.split(/\s+/).filter(isWord).length;
}

/** A token the aligner will report — one carrying at least one letter or digit. */
function isWord(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

/** One reaction tag lifted out of the text, and where in the script it was standing. */
export interface ClipTag {
  kind: ReactionClipKind;
  tag: string;
  /**
   * How many script words precede it.
   *
   * The anchor is a word index rather than a character offset or a timestamp because the
   * aligner's word tier is the only thing that knows where anything actually is. It is
   * also the one coordinate that survives the tag being deleted: the words either side
   * are still there, still spoken, and still measured.
   */
  wordsBefore: number;
  /**
   * Where this tag stood among the lifted ones, counting from zero.
   *
   * NEEDED BECAUSE `wordsBefore` IS NOT UNIQUE. Two tags with nothing between them —
   * "[sighs] [yawn]" — precede exactly the same words, so they resolve to the same
   * millisecond and the sort that orders insertions cannot separate them. Today they
   * come out right anyway, because Array.prototype.sort has been stable since ES2019 and
   * nothing between here and the splice reorders the list. That is true, and it is an
   * invariant nothing states and nothing tests — the kind of thing that stays true until
   * somebody adds a filter. Sorting on (atMs, index) says it outright.
   */
  index: number;
}

/**
 * The text with library-covered reaction tags lifted out, and a note of where each stood.
 *
 * WHY THESE AND NOT EVERY TAG. A directive changes how words are said and costs nothing,
 * so `[whispering]` stays. A pause inserts silence the aligner reads correctly unaided,
 * so `[pause]` stays. What gets lifted is the set the library can put a real recording in
 * place of — see `clip` in the Tag table — because for those the model is either
 * unreliable or, on multilingual v2, silent. Taking the tag out of the prompt is most of
 * why the replacement works: the model stops being asked for a sound, so it stops
 * sometimes deciding not to make one, and what it returns is clean speech with a known
 * gap in the sense rather than a coin flip in the audio.
 *
 * WHAT THIS COSTS, said plainly because it is the one real regression. With the tag gone,
 * ElevenLabs has no reason to leave room where the reaction goes, so one in the middle of
 * an unpunctuated clause is spliced into continuous speech and reads as an interruption.
 *
 * THIS BITES HARDER THAN IT DID FOR LAUGHS, which is the thing to know before adding a
 * kind. A laugh usually stands at a sentence boundary, where there is room whether or not
 * anybody arranged for it; `[gulps]`, `[sniffs]` and `[clears throat]` are most natural
 * mid-clause, which is exactly where there is none.
 *
 * There are two answers to that and they are deliberately different in kind. Punctuation
 * either side asks the model to leave room, and is the author's to place — warnings.ts
 * spots the omission and offers the rewrite. Padding the splice takes the room instead of
 * asking for it and needs nothing from the model; see PAD_MS in generate.ts. Neither one
 * substitutes an ellipsis, which v3 reads as hesitation and would perform.
 */
export function splitClips(
  text: string,
  /**
   * Which kinds to lift, which is which kinds the library can actually cover.
   *
   * Passed in rather than assumed, because a tag we cannot replace must stay in the
   * prompt. An empty library, or a voice nobody has cut a giggle from, has to leave
   * `[giggles]` where it is and let ElevenLabs try — that is unreliable, but it is what
   * this build did before the library existed, so the floor is the old behaviour instead
   * of a laugh that silently never happens at all.
   */
  kinds: readonly ReactionClipKind[],
): { spoken: string; clips: ClipTag[] } {
  const clips: ClipTag[] = [];
  let spoken = '';
  let read = 0;

  for (const match of text.matchAll(BRACKETED)) {
    const kind = clipKindOf(match[0]);
    if (kind === null || !kinds.includes(kind)) continue;
    clips.push({
      kind,
      tag: match[0],
      // Counted over the script, not the raw text, so that directive tags standing
      // between here and the start are not mistaken for words the aligner will report.
      wordsBefore: wordCount(stripTags(text.slice(0, match.index))),
      index: clips.length,
    });
    spoken += text.slice(read, match.index);
    read = match.index + match[0].length;
  }

  spoken += text.slice(read);
  return {
    // Only the run of spaces a removed tag leaves behind is tidied. Newlines and the
    // author's own spacing are left alone: this is going to a model that reads
    // punctuation for prosody, and reflowing it would change the read.
    clips,
    spoken: spoken.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1').trim(),
  };
}

/**
 * Where in the audio a lifted reaction belongs, from the words the aligner did measure,
 * and how much room there was for it.
 *
 * THE MIDPOINT OF THE GAP, not the end of the word before or the start of the one after.
 * A clip butted against the last phoneme of the previous word clips its own onset; one
 * butted against the next word leaves no room for the mouth to arrive. Splitting the
 * silence gives the gesture a boundary on both sides, and where there is no silence at
 * all — two words run together — the midpoint degenerates to that instant, which is the
 * honest answer rather than a fabricated pause.
 *
 * `gapMs` IS RETURNED BECAUSE THE CALLER CANNOT RECOVER IT. The midpoint is the same
 * number whether it splits 400ms of silence or 0ms of none, so the one fact that decides
 * whether a reaction will sound placed or interrupting is destroyed by the very average
 * that positions it. Measured here, it does two jobs downstream: the splice pads a gap
 * too small to hold a clip, and the audio report prints it so "why did my sniff cut the
 * sentence in half" has an answer on the page rather than in somebody's ear.
 *
 * Zero in both degenerate branches, and that is a claim about room rather than a missing
 * measurement — at the very start or the very end of a take there is no gap between two
 * words to divide, so there is nothing the pad should be reasoning about.
 *
 * INDICES ARE RESCALED WHEN THE COUNTS DISAGREE, which is a real case and not a
 * defensive flourish. `wordsBefore` counts whitespace-separated tokens; MFA counts what
 * its dictionary considers words, and in French a clitic like "l'école" can come back as
 * two. Taking the index literally would then put every clip after that point one word
 * early, and the error accumulates down the line. Scaling proportionally spreads the
 * disagreement instead of concentrating it at the end, and the exact case — the counts
 * agreeing, which is nearly every English line — is unaffected because the ratio is 1.
 *
 * That rescale is also why warnings.ts is careful about inserting punctuation: MFA merges
 * tokens across some of it (see isMergedWord), so a comma added between two words can
 * lower `words.length` and move every anchor in the line.
 */
export function clipTimeMs(
  clip: ClipTag,
  scriptWordCount: number,
  words: ReadonlyArray<{ startMs: number; endMs: number }>,
  durationMs: number,
): { atMs: number; gapMs: number } {
  if (words.length === 0) {
    return { atMs: Math.max(0, Math.round(durationMs / 2)), gapMs: 0 };
  }

  const scaled =
    scriptWordCount > 0 && scriptWordCount !== words.length
      ? Math.round((clip.wordsBefore * words.length) / scriptWordCount)
      : clip.wordsBefore;
  const index = Math.max(0, Math.min(words.length, scaled));

  // Before the first word: at the very top of the clip. Whatever silence ElevenLabs put
  // in front of the speech stays in front of the reaction, which is where it belongs.
  if (index === 0) return { atMs: 0, gapMs: 0 };
  // After the last word: at the end, not at the last word's end — a clip usually has a
  // moment of decay after the final phoneme, and cutting into it to place a reaction
  // would truncate the sentence to fit the gesture.
  if (index >= words.length) {
    return { atMs: Math.max(words[words.length - 1].endMs, durationMs), gapMs: 0 };
  }

  // Negative where MFA reports overlapping words, which it occasionally does; clamped so
  // that a nonsense gap reads as no room rather than as room the pad would then skip.
  const gapMs = Math.max(0, words[index].startMs - words[index - 1].endMs);
  return {
    atMs: Math.round((words[index - 1].endMs + words[index].startMs) / 2),
    gapMs,
  };
}

/**
 * The span a spliced clip occupies, built from a length we chose rather than one we found.
 *
 * This is the payoff of the whole exercise, and it is worth being explicit about what
 * changed. `reactionSpans` below measures a span off ElevenLabs' character timings —
 * honest, but a measurement of whatever the model did, including doing nothing. This
 * builds the identical shape from a clip whose duration was known before a single byte
 * was synthesised. Everything downstream — `leadIns`, `performSpan`, `expressionSpans`,
 * `laughBob` — takes a `Span` and cannot tell which of the two it was handed, which is
 * exactly why nothing downstream had to change.
 */
export function clipSpan(
  kind: ReactionClipKind,
  startMs: number,
  durationMs: number,
): Span | null {
  const tag = tagForKind(kind);
  if (!tag?.viseme) return null;
  return spanFrom(tag, startMs, startMs + durationMs);
}

/** One reaction tag's row turned into a span over a stretch of time. */
function spanFrom(tag: Tag, startMs: number, endMs: number): Span {
  return {
    startMs,
    endMs,
    viseme: tag.viseme as Viseme,
    perform: tag.perform ?? 'hold',
    rebound: tag.rebound ?? 'uh',
    edge: tag.edge ?? 'rest',
    pulseMs: tag.pulseMs ?? PULSE_MS,
    eyes: tag.eyes ?? 'none',
    laughing: tag.laughing === true,
    giggling: tag.giggling === true,
  };
}

export interface Span {
  startMs: number;
  endMs: number;
  viseme: Viseme;
  perform: NonNullable<Tag['perform']>;
  rebound: Viseme;
  edge: Viseme;
  pulseMs: number;
  eyes: NonNullable<Tag['eyes']>;
  laughing: boolean;
  giggling: boolean;
}

/**
 * Half a pulse, for a reaction that does not say otherwise.
 *
 * ~4.5Hz, which is where a laugh sits and a little under speech. It was measured for the
 * laugh and outlived it: the laugh holds its pose now and bobs its head instead (see the
 * tag entries above), so the only thing still pulsing is panting, which sets its own.
 * Kept as the fallback because a rate near speech is the right default for any rhythmic
 * reaction added later, and because it is where the laugh's own bob got its rate.
 */
const PULSE_MS = 110;
/**
 * How long an arc spends arriving and leaving.
 *
 * The point of an arc is the *closing*: a yawn that stays wide open until the instant a
 * word begins hands the next syllable a mouth already at full stretch. Ramping out also
 * gives the easing something to work with, so the shape moves rather than snapping.
 */
const ARC_EDGE_MS = 160;
/** Below this an arc has no room for edges and is simply held. */
const ARC_MIN_MS = 2 * ARC_EDGE_MS + 120;
/** How long a blink lasts. Matches what a real one takes, and Face's own BLINK_MS. */
const BLINK_MS = 160;
/**
 * A span shorter than this gets no lead-in smile.
 *
 * A face smiles a beat before it laughs, and an expression arriving with the sound
 * reads as a flinch. A very short laugh still gets none: the beat is a piece of
 * anticipation, and anticipating something already over reads as a twitch rather than
 * as a laugh being wound up.
 *
 * The original reason was different and no longer applies — the beat used to be spent
 * inside the span, so a short laugh "would spend most of itself arriving". It is spent
 * before the span now, for the reason under SMILE_LEAD_MS, and costs the laugh nothing.
 * The gate is kept on the new grounds rather than removed with the old ones.
 *
 * The examples used to say "giggle", from when `[giggles]` was an alias of `[laughs]`.
 * A giggle is now gated a step earlier and never reaches this length at all: leadIns
 * asks `laughing`, and a giggle's own pose is the smile this would precede it with.
 */
export const SMILE_LEAD_MIN_MS = 420;
/**
 * How long that beat lasts, and — the part that was wrong — where it is spent.
 *
 * BEFORE THE SPAN, NOT INSIDE IT. The first draft placed the smile at `span.startMs`
 * and pushed the laugh to `startMs + SMILE_LEAD_MS`, which is not what "a beat before"
 * describes: the audible laugh began on time and the mouth began laughing 130ms late.
 * That is video lagging audio by more than lip-sync survives, and self-inflicted — the
 * span timings were measured, correct, and then moved.
 *
 * Anticipation has to come out of the silence in front of the laugh, because that is
 * where a real one takes it from. So the smile is stamped at `startMs - SMILE_LEAD_MS`
 * and the laugh still lands exactly on its sound. What this costs is the window of
 * speech before the tag, which overlayReactions now clears — see LEAD_CLEARED there.
 */
const SMILE_LEAD_MS = 130;

/**
 * Where each reaction tag sits in the audio, read off the character timings.
 *
 * Walks the characters ElevenLabs stamped rather than the source string, because they
 * are the same sequence and only one of them carries times. A bracket that never closes
 * is dropped rather than guessed at.
 */
export function reactionSpans(
  characters: readonly string[],
  starts: readonly number[],
  ends: readonly number[],
): Span[] {
  const spans: Span[] = [];
  let open = -1;

  for (let i = 0; i < characters.length; i++) {
    if (characters[i] === '[') {
      open = i;
    } else if (characters[i] === ']' && open >= 0) {
      const tag = BY_TAG.get(characters.slice(open, i + 1).join('').toLowerCase());
      if (tag?.kind === 'reaction' && tag.viseme) {
        spans.push(
          spanFrom(tag, Math.round(starts[open] * 1000), Math.round(ends[i] * 1000)),
        );
      }
      open = -1;
    }
  }
  return spans;
}

/**
 * Marks with each reaction span overwritten by the pose that reaction wears.
 *
 * Everything MFA said inside a span is dropped, because inside a span MFA was aligning
 * words to audio that has none. Everything outside is kept exactly as it was: the words
 * either side really were spoken, and really were measured.
 *
 * A closing mark is put at the end of each span so that whatever follows resumes from
 * the right pose rather than inheriting the reaction's.
 */
/**
 * The lead-in each span gets, in order, most of them zero.
 *
 * Derived once for the whole utterance and handed to everything that needs it, rather
 * than recomputed per span. performSpan stamps the smile and overlayReactions clears the
 * window it occupies; two places deriving the same number independently is how they
 * drift, and a drift here is a speech mark surviving inside the lead-in and simply
 * overwriting it.
 *
 * IT NEEDS ROOM THAT IS NOT ALREADY A REACTION, which is the whole reason this takes
 * the list rather than one span. A beat spent before the laugh has to come out of
 * something, and the only thing it can come out of is quiet: "[giggles] [giggles]"
 * puts two spans back to back, and a second giggle that anticipates itself reaches
 * backwards into the first one and drops a closed mouth into the middle of a laugh
 * already in progress. Nothing about that is anticipation. The face is laughing; there
 * is nothing left to anticipate.
 *
 * ALL OF IT OR NONE OF IT. A beat with only part of its room available is not a
 * shortened gesture, it is a flicker — the patch fades in over SMILE_MARK_IN_MS and a
 * lead-in shorter than that never finishes arriving before it is told to leave. So the
 * room is a threshold and not a clamp, which also covers the utterance that opens on a
 * laugh: no quiet in front of it, no lead-in, rather than a smile crushed into whatever
 * milliseconds happen to precede it.
 */
function leadIns(spans: readonly Span[], options: ReactionOptions): number[] {
  return spans.map((span, i) => {
    if (!span.laughing || !options.smileLeadIn) return 0;
    if (span.endMs - span.startMs < SMILE_LEAD_MIN_MS) return 0;
    // Start of the recording counts as quiet, so span 0 measures against zero.
    const quiet = span.startMs - (i > 0 ? spans[i - 1].endMs : 0);
    return quiet >= SMILE_LEAD_MS ? SMILE_LEAD_MS : 0;
  });
}

/**
 * The marks one span is performed with.
 *
 * Most reactions are a single held shape, because a sigh, a swallow — or a laugh, on
 * drawn artwork — genuinely is one. The pulse is left for panting, which alternates its
 * pose with a half-open rebound rather than a closed one: nothing here shuts the mouth
 * between beats, and MarkMouth's easing means neither extreme is fully reached anyway,
 * so the visible result is a jaw moving rather than a shape flickering.
 */
function performSpan(span: Span, leadMs: number): VisemeMark[] {
  const marks: VisemeMark[] = [];
  // Not const: the pulse loop below walks it to the end of the span.
  let at = span.startMs;

  // A smile before a laugh, on a span leadIns judged has room for one. Nothing else is
  // preceded by an expression, because nothing else is anticipated the way a laugh is.
  // It is stamped ahead of the span and `at` does not move: the beat comes out of the
  // quiet in front of the laugh, never out of the laugh. See SMILE_LEAD_MS.
  if (leadMs > 0) marks.push({ timeMs: at - leadMs, viseme: 'smile' });

  const length = span.endMs - at;

  if (span.perform === 'pulse') {
    for (let i = 0; at < span.endMs; i++) {
      marks.push({ timeMs: at, viseme: i % 2 === 0 ? span.viseme : span.rebound });
      at += span.pulseMs;
    }
    return marks;
  }

  if (span.perform === 'arc' && length >= ARC_MIN_MS) {
    marks.push({ timeMs: at, viseme: span.edge });
    marks.push({ timeMs: at + ARC_EDGE_MS, viseme: span.viseme });
    marks.push({ timeMs: span.endMs - ARC_EDGE_MS, viseme: span.edge });
    return marks;
  }

  // Held, and also what a too-short arc becomes: an arc with no room for its edges is
  // just its middle, and faking one would put three marks inside 200ms that the easing
  // could never resolve into a gesture.
  marks.push({ timeMs: at, viseme: span.viseme });
  return marks;
}

/**
 * Where the eyes and head do something, given what the author asked for.
 *
 * TWO CHANNELS, ONE LIST, AND NEITHER GATES THE OTHER. It used to return nothing at all
 * when `eyes` was off, which was harmless while the eyes were the only thing here and a
 * silent bug the moment they were not: a laugh's bob is carried on the same span, so
 * switching the eyes off switched the head off with them and a laugh went perfectly
 * still. A span is emitted if either channel has something to say about it, and each
 * flag is left undefined when its own switch is off.
 */
export function expressionSpans(
  spans: readonly Span[],
  options: ReactionOptions,
): ExpressionSpan[] {
  return spans
    .map((s) => {
      const shuts = options.eyes && s.eyes !== 'none';
      return {
        startMs: s.startMs,
        // A blink is the same flag over a short span. Clamped to the span so a blink on
        // a reaction shorter than a blink does not outlast the thing that caused it.
        // Only the eyes ever shorten a span: nothing that blinks laughs, so there is no
        // case where this would cut a bob short.
        endMs:
          shuts && s.eyes === 'blink'
            ? Math.min(s.endMs, s.startMs + BLINK_MS)
            : s.endMs,
        eyesClosed: shuts ? true : undefined,
        // Recorded rather than derived later, because by playback time the tag that
        // caused the span is gone and only its timings remain.
        laughing: s.laughing ? true : undefined,
        // Recorded for the same reason `laughing` is, and read for a different one:
        // playback scales the bob's depth by it. See GIGGLE_BOB_GAIN.
        giggling: s.giggling ? true : undefined,
        // The laugh's rhythm, and no longer a decoration on top of a pulsing mouth:
        // the mouth holds its pose now, so with this off a laugh is a still open
        // mouth. Which is a legitimate thing to want on a portrait whose head reads
        // badly in motion, and the reason it is still a switch rather than anatomy.
        //
        // Two switches feeding one flag, because the two gestures fail differently
        // when they read badly. A laugh with its bob off is still a laugh — the open
        // mouth carries it — whereas a giggle with its bob off is a closed smile and
        // nothing else, which is to say it is not a giggle at all. Somebody who wants
        // the head still through the big gesture may well want it moving through the
        // small one, and one switch could not have said so.
        nod:
          (options.nod && s.laughing) || (options.giggleNod && s.giggling)
            ? true
            : undefined,
      };
    })
    .filter((e) => e.eyesClosed || e.nod);
}

/**
 * Which of a package's expression spans are a laugh screwing its eyes up.
 *
 * A playback-time question, and deliberately not the same one `ReactionOptions.eyes`
 * answers. That flag decides whether the eyes move at all and is settled before the
 * voice is ever synthesised, so changing it costs a fresh take from ElevenLabs — and on
 * `eleven_v3` a fresh take is a different performance, not the same line with its eyes
 * open. This answers the narrower question the note on that flag singles out, about a
 * package that already exists.
 *
 * Two sources, in order:
 *
 *   the flag   Spans built since `ExpressionSpan.laughing` existed simply say.
 *   the text   Older ones do not, and are matched positionally instead. That is exact
 *              rather than a guess: `expressionSpans` keeps the reaction spans that
 *              have eyes in source order, and `reactionsIn` reads the same tags out of
 *              the same string in the same order, so the nth span is the nth such tag.
 *              The zip is trusted only when the two lengths agree; if they disagree the
 *              package is not what this function believes it is, and it says no rather
 *              than opening the eyes of whichever reaction happens to line up.
 *
 * A PACKAGE MADE BEFORE THE GIGGLE SPLIT lands in that refusal on purpose, and it is
 * worth naming because it is the first case to actually reach it. `[giggles]` used to
 * close its eyes and no longer does, so an old package's stored spans include one this
 * table no longer produces, the lengths disagree, and every laugh in that line keeps its
 * eyes. That is the right way round: the alternative is offsetting the tags against the
 * spans and opening the eyes of whatever sits at the wrong index. Anything generated
 * since `laughing` existed takes the first branch and is unaffected.
 */
export function laughEyeSpans(
  expressions: readonly ExpressionSpan[],
  text: string,
): boolean[] {
  if (expressions.some((e) => e.laughing !== undefined)) {
    return expressions.map((e) => e.laughing === true);
  }
  const tags = reactionsIn(text).filter((t) => (t.eyes ?? 'none') !== 'none');
  if (tags.length !== expressions.length) return expressions.map(() => false);
  return tags.map((t) => t.laughing === true);
}

/**
 * The same spans with the laughs' eyes left open.
 *
 * Non-destructive by construction: it takes the stored expressions and returns new ones,
 * so the package keeps what it was generated with and the choice stays a checkbox.
 */
export function withLaughEyesOpen(
  expressions: readonly ExpressionSpan[],
  text: string,
): ExpressionSpan[] {
  const laughs = laughEyeSpans(expressions, text);
  return (
    expressions
      // Only the lids are being argued about, so only the lids are cleared — a laugh
      // span can carry `nod` as well, and dropping the whole span would silently drop
      // that too. A span left with nothing at all to say is then dropped, rather than
      // handed on as an empty window for the face to evaluate every frame.
      .map((e, i) => (laughs[i] ? { ...e, eyesClosed: undefined } : e))
      .filter((e) => e.eyesClosed || e.nod)
  );
}

export function overlayReactions(
  marks: readonly VisemeMark[],
  spans: readonly Span[],
  options: ReactionOptions,
): VisemeMark[] {
  if (spans.length === 0) return [...marks];

  // LEAD_CLEARED. A span covers its own audio, and for a laugh with a lead-in it also
  // covers the beat of silence in front of it. Both windows have to be cleared of real
  // marks, and for the same reason at two removes: inside the span MFA was fitting words
  // to audio that has none, and inside the lead-in it was fitting them to the last of
  // the speech before the tag — real, but about to be overruled by an expression. A word
  // mark left standing there sorts after the smile and simply overwrites it, which is
  // the lead-in silently not happening rather than the lead-in looking wrong.
  const leads = leadIns(spans, options);
  const gesture = spans.map((s, i) => ({ from: s.startMs - leads[i], to: s.endMs }));
  const inside = (ms: number) => gesture.some((g) => ms >= g.from && ms < g.to);
  const out: VisemeMark[] = marks.filter((m) => !inside(m.timeMs));

  for (const [i, span] of spans.entries()) {
    out.push(...performSpan(span, leads[i]));

    // What was in force when the reaction began is what the mouth returns to, unless a
    // real mark already lands at that instant. The last mark before the GESTURE started
    // — the lead-in smile included — for the reason searching to the end would be wrong:
    // anything later is one of the marks just dropped, and resuming into a pose that was
    // suppressed for being about to be overruled puts it back after the fact.
    //
    // AND UNLESS ANOTHER SPAN IS STILL RUNNING THERE, which is the condition that was
    // missing and that adjacent spans made certain rather than merely possible. Two
    // laughs in a row end one where the next begins; the closing mark then lands inside
    // the second gesture, and because it sorts before the second laugh's own mark and
    // carries a different pose, the run collapses to "laugh, then whatever preceded the
    // first one" — the mouth stops laughing partway through a laugh that is still
    // audible. Resuming a previous pose only makes sense when there is nothing to resume
    // into; inside another reaction there is, and it is that reaction.
    //
    // leadIns already refuses its beat for the same reason (see the note there about
    // "[giggles] [giggles]"). This is the same hazard on the other end of the span, and
    // it went unguarded because nothing used to place two spans exactly back to back.
    const stillGoing = spans.some(
      (other, j) => j !== i && span.endMs >= other.startMs && span.endMs < other.endMs,
    );
    if (!stillGoing && !marks.some((m) => m.timeMs === span.endMs)) {
      const before = [...marks].reverse().find((m) => m.timeMs <= gesture[i].from);
      out.push({
        timeMs: span.endMs,
        polly: before?.polly,
        phone: before?.phone,
        viseme: before?.viseme ?? 'rest',
      });
    }
  }

  out.sort((a, b) => a.timeMs - b.timeMs);
  // Collapsed on the drawn pose rather than the identifier, because an overlay can butt
  // a pose against an identical one and because a laugh mark has no identifier at all.
  return out.filter((m, i) => i === 0 || m.viseme !== out[i - 1].viseme);
}

/**
 * An accent, written as the tag v3 answers to.
 *
 * Normalised rather than taken as typed, because the field it comes from is free text
 * and "French-African", "french african accent" and "[strong French-African accent]"
 * are all things somebody reasonably types meaning one thing.
 *
 * THE BRACKETS ARE UNWRAPPED, NOT DELETED, and the difference is a bug this had. Removing
 * whole bracketed runs — which is what stripTags does, correctly, for the aligner — turns
 * a pasted-back tag into the empty string, so the one input most likely to be pasted here
 * is the one that silently asks for no accent at all. Only the bracket characters go; what
 * was inside them is the answer.
 *
 * Then the scaffolding is peeled off either end so it is not said twice: a leading
 * "strong"/"thick"/"heavy" and a trailing "accent" are exactly what this function is
 * about to add back, and `[strong strong French-African accent accent]` is not a prompt.
 *
 * `strong` and not `thick`: both are documented, and ElevenLabs' own v3 guide writes the
 * form as `[strong X accent]`, so this follows the wording their examples are drawn from
 * rather than a synonym that may or may not have been trained on.
 */
export function accentTag(accent: string): string {
  const cleaned = accent
    .replace(/[[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:strong|thick|heavy)\s+/i, '')
    .replace(/\s+accent$/i, '')
    .trim();
  return cleaned ? `[strong ${cleaned} accent]` : '';
}

/**
 * The text as ElevenLabs should receive it, with the accent restated on every line.
 *
 * PER LINE, AND THAT IS THE EXPENSIVE CHOICE MADE DELIBERATELY. One tag at the top of a
 * script is what the docs show and it is not what a long script gets: v3 drifts back
 * toward its baseline over a paragraph, so a line three sentences down is read in the
 * voice's default accent no matter what the first line asked for. Restating it is the
 * only thing that holds. It costs roughly thirty characters a line of billed quota,
 * which is real money on a plan measured in characters — see cost.ts, which counts this
 * string rather than the author's so the panel shows the true figure before it is spent.
 *
 * A line that already opens with an accent tag is left alone, so that someone who has
 * been typing the tag by hand does not get it twice.
 *
 * NOT APPLIED ON multilingual v2, and the caller is where that is decided. v2 does not
 * read tags, it reads *text*, so an accent tag there is a voice saying the words "strong
 * French-African accent" out loud in the middle of a lesson. Same hazard the laugh lift
 * in generate.ts already guards against, and the same answer: send nothing.
 */
export function applyAccent(text: string, accent: string): string {
  const tag = accentTag(accent);
  if (!tag) return text;
  const opener = /^\s*\[[^\]\n]*\baccent\b[^\]\n]*\]/i;
  return text
    .split('\n')
    .map((line) => (line.trim() && !opener.test(line) ? `${tag} ${line}` : line))
    .join('\n');
}
