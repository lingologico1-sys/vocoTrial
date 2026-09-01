/**
 * The reaction library: performances you provide, used as recorded or re-performed into
 * one exact voice, and spliced in place of whatever ElevenLabs would have done with the
 * tag.
 *
 * WHY THERE IS A LIBRARY AT ALL, and the answer is now two answers. On `eleven_v3` these
 * are *audio tags*, which are advisory: the model decides per generation whether to render
 * one, so the same line gives an audible laugh on one take and silence on the next — and
 * nothing downstream can tell which happened, because `reactionSpans` reads the span off
 * the tag's character timings whether or not any sound was made. A face then laughs over
 * speech.
 *
 * On `eleven_multilingual_v2` the case is stronger and different in kind. That model does
 * not read tags at all, and generate.ts strips every one of them out of what it is asked
 * to say, so a reaction tag there makes no sound whatsoever. The library is not an
 * improvement on the model's attempt; it is the only reason these exist on the model that
 * holds an accent. That is what makes it worth recording eight kinds rather than two.
 *
 * WHERE THE CLIPS COME FROM, AND WHY THAT CHANGED. The first version of this harvested
 * clips out of takes where the model happened to laugh well. That assumed the model has
 * varied, good laughs to harvest; it has roughly one mediocre one per voice, so a library
 * built that way could never be better than the thing it replaced. So you provide the
 * sound — recorded on a phone, or from a sound library. The browser makes a splice-ready
 * MP3 without changing that performance. Speech-to-speech remains an optional second
 * treatment when matching the exact tutor matters more than preserving the recording.
 *
 * WHICH TREATMENT WINS IS A FACT ABOUT THE SOUND, not a global default, and it is written
 * in the tag table rather than here — see `prefer` in tags.ts. Speech-to-speech is a
 * *speech* model: it has a vowel to work with in a laugh or a yawn and nothing at all in a
 * 200ms throat click, so a gulp defaults to the recording as made.
 *
 * A SOURCE IS NOT A RENDER, and keeping them apart is the whole shape of this file. A
 * converted clip belongs to exactly one voice. An original belongs to a male or female
 * pool and every matching voice may use it. Cross-pool conversion is refused.
 *
 * WHAT MAKES THE SPLICE FREE is that both treatments produce `mp3_44100_128`, the same
 * format as text-to-speech. ElevenLabs encodes converted clips; a dynamically loaded LAME
 * encoder handles originals in the browser. The Worker scans both before storage.
 *
 * WHY THE STORED NAMES STILL SAY "LAUGH". The R2 keys, the route paths and the package
 * field below were written when this held two kinds, and they are data rather than code —
 * renaming them means migrating every stored object and every saved take to buy nothing a
 * reader of this comment does not already know. The types say what they mean; the keys say
 * where things are.
 */

import { tagForKind, type ReactionClipKind, type ClipTreatment } from './tags';

// Re-exported so that callers reaching for a library type do not have to know the tag
// table owns two of them. See the note on ClipTreatment in tags.ts for why it lives there.
export type { ReactionClipKind, ClipTreatment };

/** The two vocal pools an original recording can belong to. */
export type VoiceGender = 'male' | 'female';

/**
 * A reaction you provided, trimmed and kept. Belongs to no voice.
 *
 * This is the thing worth keeping. It is stored as WAV rather than as the file you picked
 * because what is kept is your *selection* — and a selection cannot be cut out of a
 * compressed file without a codec, whereas the browser has already decoded it to samples
 * to draw the trim. A header over those samples is a WAV, and speech-to-speech accepts
 * one, so the format never needs converting on this side at all.
 */
export interface ReactionSource {
  id: string;
  createdAt: number;
  /**
   * Which tag this stands in for.
   *
   * Fixed at import rather than chosen per render, because it is a fact about the sound.
   * A giggle is a laugh with the mouth shut, and the face commits to a closed smile before
   * it hears anything — so a big open laugh filed under `giggles` is a shut mouth over a
   * wide sound in every voice it is ever rendered into, not just the first. The same trap
   * is wider now: a gulp filed under `sniffs` blinks, and a yawn filed under `gasps`
   * loses the arc that makes it read as a yawn at all.
   */
  kind: ReactionClipKind;
  /**
   * Which voices may use the recording without re-performing it.
   *
   * Optional only for sources imported before original-performance clips existed. An
   * unclassified source is never offered raw; its existing voice renders still work.
   */
  gender?: VoiceGender;
  /**
   * Per-voice audition choice, and the only thing that outranks the kind's own default.
   *
   * The default lives in the tag table (`prefer` in tags.ts) because it is a fact about
   * the sound. This is the author overriding it for one voice after hearing both, which is
   * the one piece of evidence the table cannot have.
   */
  preferredTreatmentByVoice?: Record<string, ClipTreatment>;
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
export interface ReactionRender {
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
  /** `original` is the source performance encoded to splice format, not re-performed. */
  treatment?: ClipTreatment;
  /** Copied from the source; absent on harvested legacy clips. */
  gender?: VoiceGender;
  kind: ReactionClipKind;
  label: string;
  /**
   * The voice this was rendered into, and the only voice it may be spliced into.
   *
   * The target of the conversion, not the origin of the recording. A laugh you recorded
   * yourself, rendered into a tutor's voice, is filed under the tutor.
   */
  /** Absent only for an original render, which belongs to a gender pool rather than a voice. */
  voiceId?: string;
  voiceName?: string;
  durationMs: number;
  bytes: number;
}

export const LAUGHS_INDEX_KEY = 'laughs/index.json';

export const laughSourceKey = (id: string) => `laughs/sources/${id}.wav`;
export const laughRenderKey = (id: string) => `laughs/renders/${id}.mp3`;

/** Both halves of the library, as one stored object. */
export interface ReactionLibraryIndex {
  sources: ReactionSource[];
  renders: ReactionRender[];
}

export function treatmentOf(render: ReactionRender): ClipTreatment {
  return render.treatment === 'original' ? 'original' : 'voice-converted';
}

/**
 * Which treatment a kind of sound wants when nobody has said otherwise.
 *
 * Reads the tag table rather than keeping a second list, so a kind added there arrives
 * here with its answer already attached. `voice-converted` for anything the table does not
 * mark, which preserves what this did before the field existed.
 */
export function preferredFor(kind: ReactionClipKind): ClipTreatment {
  return tagForKind(kind)?.prefer ?? 'voice-converted';
}

/** The one original-performance derivative belonging to a source, when it has one. */
export function originalFor(
  renders: readonly ReactionRender[],
  sourceId: string,
): ReactionRender | undefined {
  return renders.find(
    (render) => render.sourceId === sourceId && treatmentOf(render) === 'original',
  );
}

/**
 * A reaction that was spliced in, recorded on the package.
 *
 * `atMs` is on the *final* timeline — where a listener hears it, not where it was going to
 * go before earlier clips pushed it along. The label is copied rather than referenced so
 * that deleting a clip does not make an old package unable to describe itself.
 */
export interface SplicedClip {
  clipId: string;
  kind: ReactionClipKind;
  label: string;
  atMs: number;
  /**
   * How long the audible clip is — the pad NOT included.
   *
   * THE PAD IS EXCLUDED ON PURPOSE, and putting it in was the obvious mistake. This pair
   * of numbers is what `clipSpan` builds the face's span from, so a duration carrying
   * 78ms of silence at each end would hold the mouth in a gulp through the quiet before
   * and after it. `atMs` likewise points at the first frame of real sound, not at the
   * start of the insertion.
   *
   * What the timeline was shifted by is `durationMs + 2 * padMs`, derived where it is
   * needed rather than stored, so that these two fields keep meaning exactly what a
   * listener would say they mean.
   */
  durationMs: number;
  /** Silence added either side to keep the clip off the words. Absent when there was room. */
  padMs?: number;
  treatment?: ClipTreatment;
}

/**
 * The renders eligible for one tag: right kind, right voice.
 *
 * Both filters are hard. A giggle standing in for a laugh is the wrong gesture at the wrong
 * length, and the face is already committed to whichever the author typed. A render from
 * another voice is another person.
 *
 * WHERE TWO TREATMENTS EXIST, the kind decides which is offered unless the author has said
 * otherwise for this voice. That order — author, then kind, then whatever there is — is the
 * one behavioural change this file has had since the six new kinds arrived, and it matters
 * because the old rule was "a conversion always wins". True of a laugh, whose timbre is
 * most of what identifies it; false of a sniff, where speech-to-speech is being handed
 * unvoiced material it was never trained on and the recording is likelier to be the better
 * sound. See `prefer` in tags.ts, where the per-kind answer lives.
 */
export function eligible(
  library: ReactionLibraryIndex,
  kind: ReactionClipKind,
  voiceId: string,
  voiceGender?: VoiceGender,
): ReactionRender[] {
  const selected: ReactionRender[] = [];

  for (const source of library.sources) {
    if (source.kind !== kind) continue;
    const converted = library.renders.find(
      (render) =>
        render.sourceId === source.id &&
        treatmentOf(render) === 'voice-converted' &&
        render.voiceId === voiceId,
    );
    // Sources from the previous version have no gender and no original derivative. Their
    // exact-voice conversions remain usable until the source is explicitly classified.
    if (!source.gender) {
      if (converted) selected.push(converted);
      continue;
    }
    if (!voiceGender || source.gender !== voiceGender) continue;

    const original = originalFor(library.renders, source.id);
    // The author's ear for this voice first, then what the kind of sound asks for, and
    // only then whichever exists. Falling through to "whichever exists" is not a failure
    // case: a preference for a conversion nobody has rendered yet should play the
    // recording rather than play nothing.
    const wanted = source.preferredTreatmentByVoice?.[voiceId] ?? preferredFor(kind);
    if (wanted === 'original' && original) selected.push(original);
    else if (wanted === 'voice-converted' && converted) selected.push(converted);
    else if (converted) selected.push(converted);
    else if (original) selected.push(original);
  }

  // Harvested legacy clips have no source. They remain exact-voice renders and bypass the
  // gender pool because the voice they came from is already known by id.
  for (const render of library.renders) {
    if (
      render.kind === kind &&
      !render.sourceId &&
      treatmentOf(render) === 'voice-converted' &&
      render.voiceId === voiceId
    ) {
      selected.push(render);
    }
  }

  // A corrupt index must not make one object twice as likely. This also keeps the flat
  // list safe if a future migration temporarily leaves a duplicate render behind.
  return selected.filter(
    (render, index) => selected.findIndex((candidate) => candidate.id === render.id) === index,
  );
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
  library: ReactionLibraryIndex,
  kind: ReactionClipKind,
  voiceId: string,
  voiceGender?: VoiceGender,
  random: () => number = Math.random,
): ReactionRender | null {
  const options = eligible(library, kind, voiceId, voiceGender);
  if (options.length === 0) return null;
  return options[Math.floor(random() * options.length) % options.length];
}

/** Which voices a source has already been rendered into. */
export function renderedVoices(
  renders: readonly ReactionRender[],
  sourceId: string,
): Set<string> {
  return new Set(
    renders
      .filter(
        (render): render is ReactionRender & { voiceId: string } =>
          render.sourceId === sourceId &&
          treatmentOf(render) === 'voice-converted' &&
          Boolean(render.voiceId),
      )
      .map((render) => render.voiceId),
  );
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
