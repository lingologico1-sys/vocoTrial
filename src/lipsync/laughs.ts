/**
 * The laugh library: performances you provide, used as recorded or re-performed into one
 * exact voice, and spliced in place of whatever ElevenLabs would have done with the tag.
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
 * laugh — recorded on a phone, or from a sound library. The browser makes a splice-ready
 * MP3 without changing that performance. Speech-to-speech remains an optional second
 * treatment when matching the exact tutor matters more than preserving the recording.
 *
 * A SOURCE IS NOT A RENDER, and keeping them apart is the whole shape of this file. A
 * converted clip belongs to exactly one voice. An original belongs to a male or female
 * pool and every matching voice may use it. Cross-pool conversion is refused.
 *
 * WHAT MAKES THE SPLICE FREE is that both treatments produce `mp3_44100_128`, the same
 * format as text-to-speech. ElevenLabs encodes converted clips; a dynamically loaded LAME
 * encoder handles originals in the browser. The Worker scans both before storage.
 */

/** The two tags this applies to, and the only two. See TAGS in tags.ts. */
export type LaughKind = 'laughs' | 'giggles';

/** The two vocal pools an original recording can belong to. */
export type VoiceGender = 'male' | 'female';

/** How the MP3 that is actually spliced was made. Absent on legacy voice renders. */
export type LaughTreatment = 'original' | 'voice-converted';

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
  /**
   * Which voices may use the recording without re-performing it.
   *
   * Optional only for sources imported before original-performance clips existed. An
   * unclassified source is never offered raw; its existing voice renders still work.
   */
  gender?: VoiceGender;
  /**
   * Per-voice audition choice. A conversion wins by default once it exists; recording an
   * explicit `original` here lets the author keep the source performance for that voice.
   */
  preferredTreatmentByVoice?: Record<string, LaughTreatment>;
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
  /** `original` is the source performance encoded to splice format, not re-performed. */
  treatment?: LaughTreatment;
  /** Copied from the source; absent on harvested legacy clips. */
  gender?: VoiceGender;
  kind: LaughKind;
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
export interface LaughLibraryIndex {
  sources: LaughSource[];
  renders: LaughRender[];
}

export function treatmentOf(render: LaughRender): LaughTreatment {
  return render.treatment === 'original' ? 'original' : 'voice-converted';
}

/** The one original-performance derivative belonging to a source, when it has one. */
export function originalFor(
  renders: readonly LaughRender[],
  sourceId: string,
): LaughRender | undefined {
  return renders.find(
    (render) => render.sourceId === sourceId && treatmentOf(render) === 'original',
  );
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
  treatment?: LaughTreatment;
}

/**
 * The renders eligible for one tag: right kind, right voice.
 *
 * Both filters are hard. A giggle standing in for a laugh is the wrong gesture at the wrong
 * length, and the face is already committed to whichever the author typed. A render from
 * another voice is another person.
 */
export function eligible(
  library: LaughLibraryIndex,
  kind: LaughKind,
  voiceId: string,
  voiceGender?: VoiceGender,
): LaughRender[] {
  const selected: LaughRender[] = [];

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
    const preferred = source.preferredTreatmentByVoice?.[voiceId];
    if (preferred === 'original' && original) selected.push(original);
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
  library: LaughLibraryIndex,
  kind: LaughKind,
  voiceId: string,
  voiceGender?: VoiceGender,
  random: () => number = Math.random,
): LaughRender | null {
  const options = eligible(library, kind, voiceId, voiceGender);
  if (options.length === 0) return null;
  return options[Math.floor(random() * options.length) % options.length];
}

/** Which voices a source has already been rendered into. */
export function renderedVoices(
  renders: readonly LaughRender[],
  sourceId: string,
): Set<string> {
  return new Set(
    renders
      .filter(
        (render): render is LaughRender & { voiceId: string } =>
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
