/**
 * The laugh library: our own laughs, cut from takes, spliced in place of the model's.
 *
 * WHY THERE IS A LIBRARY. `[laughs]` and `[giggles]` are ElevenLabs v3 *audio tags*, which
 * are advisory. The model decides per generation whether to render one, so the same line
 * gives an audible laugh on one take and silence on the next — and nothing downstream can
 * tell which happened, because `reactionSpans` reads the laugh's span off the tag's
 * character timings whether or not any sound was made. A face then laughs over speech.
 *
 * Keeping laughs that came out well and splicing one in removes the coin flip, and gives
 * something the tag never could: the laugh's duration is known *before* synthesis rather
 * than measured after it. Every judgement built on that duration — the lead-in smile's
 * threshold, the eye close, the depth and rhythm of `laughBob` — stops being fitted to a
 * take we happened to get and starts being fitted to a clip we chose.
 *
 * CLIPS COME OUT OF TAKES, which is the decision the rest of this file follows from. A
 * clip is cut from audio this app generated, so it is the same voice, the same room and
 * the same encoder — there is no timbre to match, no level to normalise, and no format to
 * convert, because the bytes came from the same ElevenLabs endpoint as the speech they
 * will be joined to. That is what lets the splice be a byte concatenation (see _mp3.ts)
 * rather than a decode-and-re-encode, and it is why there is no upload path here: a file
 * from outside would have none of those guarantees, and accepting one would mean owning
 * every one of them.
 */

/** The two tags this applies to, and the only two. See TAGS in tags.ts. */
export type LaughKind = 'laughs' | 'giggles';

export const LAUGH_KINDS: LaughKind[] = ['laughs', 'giggles'];

/** `[laughs]` -> 'laughs'. Null for every other tag, which is most of them. */
export function laughKindOf(tag: string): LaughKind | null {
  const inner = tag.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return inner === 'laughs' || inner === 'giggles' ? inner : null;
}

/** One kept laugh. */
export interface LaughClip {
  id: string;
  createdAt: number;
  kind: LaughKind;
  /**
   * The voice this was cut from, and the only voice it may be spliced into.
   *
   * Not a preference. The whole argument for concatenating bytes instead of mixing audio
   * is that both sides came from the same voice on the same endpoint; a laugh from
   * another voice would be a different person interrupting, which no amount of correct
   * framing fixes.
   */
  voiceId: string;
  voiceName?: string;
  /** What to call it in a picker. Named by whoever cut it, or its source line. */
  label: string;
  durationMs: number;
  bytes: number;
  /** The saved line it was cut out of, kept so a clip can be traced back. */
  sourceId?: string;
  sourceName?: string;
}

export const LAUGHS_INDEX_KEY = 'laughs/index.json';

export const laughClipKey = (id: string) => `laughs/${id}.mp3`;

/**
 * A laugh that was spliced in, recorded on the package.
 *
 * Carried so a saved take is reproducible and so Diagnostics can say what happened. `atMs`
 * is on the *final* timeline — where the laugh is in the audio someone will hear, not
 * where it was going to go before earlier laughs pushed it along.
 */
export interface SplicedLaugh {
  clipId: string;
  kind: LaughKind;
  label: string;
  atMs: number;
  durationMs: number;
}

/**
 * The clips eligible for one tag: right kind, right voice.
 *
 * Both filters are hard. A giggle standing in for a laugh is the wrong gesture at the
 * wrong length, and the face is already committed to performing whichever the author
 * typed — `[giggles]` holds a closed smile, so a full open laugh under it would be a
 * shut mouth over a wide sound.
 */
export function eligible(
  clips: readonly LaughClip[],
  kind: LaughKind,
  voiceId: string,
): LaughClip[] {
  return clips.filter((c) => c.kind === kind && c.voiceId === voiceId);
}

/**
 * One clip for a tag, at random, or null when the library has nothing to offer.
 *
 * Random rather than round-robin or newest-first, because the failure being avoided is
 * the same clip on every laugh in a paragraph, which is more obviously synthetic than the
 * model's own inconsistency ever was. The choice is written onto the package by the
 * caller, so a saved take replays exactly and only a regenerate rolls again.
 *
 * Null is a normal answer, not an error. An empty library, or a voice nobody has cut a
 * laugh from yet, means the tag falls back to being sent to ElevenLabs — which is what
 * this build did before the library existed, so the floor is the old behaviour rather
 * than a failure.
 */
export function pick(
  clips: readonly LaughClip[],
  kind: LaughKind,
  voiceId: string,
  random: () => number = Math.random,
): LaughClip | null {
  const options = eligible(clips, kind, voiceId);
  if (options.length === 0) return null;
  return options[Math.floor(random() * options.length) % options.length];
}

/**
 * Times moved along by the laughs inserted before them.
 *
 * Every insertion pushes everything at or after it later by the clip's length, and a
 * second insertion is pushed by the first. Expressed as a closure over the whole list
 * rather than applied in a loop per array, so that marks, words and spans are all shifted
 * by provably the same function — three call sites each doing this arithmetic themselves
 * is how one of them ends up off by a clip.
 *
 * `atMs` values here are on the ORIGINAL timeline: this is the map from before to after,
 * so its input must be a before. Boundary goes to the later side — a mark exactly at the
 * cut is the first mark of the word after the laugh, and it belongs after it.
 */
export function shiftPast(
  insertions: ReadonlyArray<{ atMs: number; durationMs: number }>,
): (ms: number) => number {
  const sorted = [...insertions].sort((a, b) => a.atMs - b.atMs);
  return (ms: number) => {
    let shifted = ms;
    for (const at of sorted) {
      if (at.atMs <= ms) shifted += at.durationMs;
    }
    return shifted;
  };
}
