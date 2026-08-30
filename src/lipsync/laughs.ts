/**
 * The laugh library: laughs you provide, rendered into each voice, spliced in place of
 * whatever ElevenLabs would have done with the tag.
 *
 * WHY THERE IS A LIBRARY AT ALL. `[laughs]` and `[giggles]` are v3 *audio tags*, which are
 * advisory. The model decides per generation whether to render one, so the same line gives
 * an audible laugh on one take and silence on the next — and nothing downstream can tell
 * which happened, because `reactionSpans` reads the laugh's span off the tag's character
 * timings whether or not any sound was made. A face then laughs over speech. On
 * `eleven_multilingual_v2` it is worse than unreliable: that model ignores tags entirely,
 * so a laugh is not merely inconsistent, it is impossible.
 *
 * WHERE THE LAUGHS COME FROM, AND WHY THAT CHANGED. The first version of this harvested
 * clips out of takes where the model happened to laugh well. That assumed the model has
 * varied, good laughs to harvest; it has roughly one mediocre one per voice, so a library
 * built that way could never be better than the thing it replaced. So you provide the
 * laugh — recorded on a phone, or from a sound library — and ElevenLabs' speech-to-speech
 * endpoint re-performs it in the target voice before it is stored. You choose the
 * performance; the output is still unmistakably the right speaker.
 *
 * A SOURCE IS NOT A RENDER, and keeping them apart is the whole shape of this file. A
 * converted clip belongs to exactly one voice — speech-to-speech renders into one voice,
 * and a laugh in the wrong voice is a stranger interrupting, which no amount of correct
 * splicing repairs. The *recording behind it* belongs to no voice at all. So the recording
 * is kept as the asset, and adopting a new voice is a re-render of something you already
 * have rather than a hunt for the original file.
 *
 * WHAT MAKES THE SPLICE FREE is that the conversion is asked for as `mp3_44100_128`, the
 * same format the text-to-speech endpoint returns. Both sides of every join therefore agree
 * on version, layer, rate, bitrate and channel mode, which is exactly what _mp3.ts needs to
 * concatenate bytes instead of decoding them. ElevenLabs does the transcode on the way in,
 * so no codec is needed anywhere in this app.
 */

/** The two tags this applies to, and the only two. See TAGS in tags.ts. */
export type LaughKind = 'laughs' | 'giggles';

export const LAUGH_KINDS: LaughKind[] = ['laughs', 'giggles'];

/** `[laughs]` -> 'laughs'. Null for every other tag, which is most of them. */
export function laughKindOf(tag: string): LaughKind | null {
  const inner = tag.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return inner === 'laughs' || inner === 'giggles' ? inner : null;
}

/**
 * A laugh you provided, trimmed and kept. Belongs to no voice.
 *
 * This is the thing worth keeping. It is stored as WAV rather than as the file you picked
 * because what is kept is your *selection* — and a selection cannot be cut out of a
 * compressed file without a codec, whereas the browser has already decoded it to samples
 * to draw the trim. A header over those samples is a WAV, and speech-to-speech accepts
 * one, so the format never needs converting on this side at all.
 */
export interface LaughSource {
  id: string;
  createdAt: number;
  /**
   * Which tag this stands in for.
   *
   * Fixed at import rather than chosen per render, because it is a fact about the sound.
   * A giggle is a laugh with the mouth shut, and the face commits to a closed smile before
   * it hears anything — so a big open laugh filed under `giggles` is a shut mouth over a
   * wide sound in every voice it is ever rendered into, not just the first.
   */
  kind: LaughKind;
  label: string;
  durationMs: number;
  bytes: number;
}

/**
 * One source converted into one voice: the mp3 that actually gets spliced.
 *
 * `kind` and `label` are copied down from the source rather than looked up through
 * `sourceId`, and that is deliberate. generate.ts asks "what can I use for this tag, in
 * this voice" on every request; denormalising means that stays a scan of one flat list
 * instead of a join, and `eligible` and `pick` keep the shape they already had.
 */
export interface LaughRender {
  id: string;
  createdAt: number;
  /**
   * The recording this was made from, when there is one.
   *
   * Optional because the clips harvested by the first version of this feature have no
   * recording behind them — they were cut straight out of a generated take. They remain
   * perfectly good renders and splice exactly as before; the only thing they cannot do is
   * be re-rendered into another voice, because there is nothing to re-render. Treating
   * that as a missing field rather than as a migration is why there is no migration.
   */
  sourceId?: string;
  kind: LaughKind;
  label: string;
  /**
   * The voice this was rendered into, and the only voice it may be spliced into.
   *
   * The target of the conversion, not the origin of the recording. A laugh you recorded
   * yourself, rendered into a tutor's voice, is filed under the tutor.
   */
  voiceId: string;
  voiceName?: string;
  durationMs: number;
  bytes: number;
}

export const LAUGHS_INDEX_KEY = 'laughs/index.json';

export const laughSourceKey = (id: string) => `laughs/sources/${id}.wav`;
export const laughRenderKey = (id: string) => `laughs/renders/${id}.mp3`;

/** Both halves of the library, as one stored object. */
export interface LaughLibraryIndex {
  sources: LaughSource[];
  renders: LaughRender[];
}

/**
 * A laugh that was spliced in, recorded on the package.
 *
 * `atMs` is on the *final* timeline — where a listener hears it, not where it was going to
 * go before earlier laughs pushed it along. The label is copied rather than referenced so
 * that deleting a clip does not make an old package unable to describe itself.
 */
export interface SplicedLaugh {
  clipId: string;
  kind: LaughKind;
  label: string;
  atMs: number;
  durationMs: number;
}

/**
 * The renders eligible for one tag: right kind, right voice.
 *
 * Both filters are hard. A giggle standing in for a laugh is the wrong gesture at the wrong
 * length, and the face is already committed to whichever the author typed. A render from
 * another voice is another person.
 */
export function eligible(
  renders: readonly LaughRender[],
  kind: LaughKind,
  voiceId: string,
): LaughRender[] {
  return renders.filter((r) => r.kind === kind && r.voiceId === voiceId);
}

/**
 * One render for a tag, at random, or null when the library has nothing to offer.
 *
 * Random rather than round-robin or newest-first, because the failure being avoided is the
 * same laugh on every tag in a paragraph — more obviously synthetic than the model's own
 * inconsistency ever was. The choice is written onto the package by the caller, so a saved
 * take replays exactly and only a regenerate rolls again.
 *
 * Null is a normal answer, not an error: a voice nobody has rendered a laugh into yet falls
 * back to whatever generate.ts decides the tag should do without one.
 */
export function pick(
  renders: readonly LaughRender[],
  kind: LaughKind,
  voiceId: string,
  random: () => number = Math.random,
): LaughRender | null {
  const options = eligible(renders, kind, voiceId);
  if (options.length === 0) return null;
  return options[Math.floor(random() * options.length) % options.length];
}

/** Which voices a source has already been rendered into. */
export function renderedVoices(
  renders: readonly LaughRender[],
  sourceId: string,
): Set<string> {
  return new Set(renders.filter((r) => r.sourceId === sourceId).map((r) => r.voiceId));
}

/**
 * Times moved along by the laughs inserted before them.
 *
 * Every insertion pushes everything at or after it later by the clip's length, and a second
 * insertion is pushed by the first. Expressed as a closure over the whole list rather than
 * applied per array, so that marks, words and spans are all shifted by provably the same
 * function — three call sites each doing this arithmetic themselves is how one of them ends
 * up off by a clip.
 *
 * `atMs` values here are on the ORIGINAL timeline: this is the map from before to after, so
 * its input must be a before. The boundary goes to the later side — a mark exactly at the
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
