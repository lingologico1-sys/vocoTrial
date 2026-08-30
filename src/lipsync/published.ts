/**
 * What a lip-sync package is, shared by the page and the functions that store it.
 *
 * The counterpart to facekit/published.ts, and deliberately the same shape: an index
 * object listing everything, one JSON object per package, one binary beside it, and the
 * key helpers written once here so the two sides cannot disagree about where anything
 * lives. That file explains at length why the index is a single object and what the
 * one-writer assumption costs; all of it applies here.
 *
 * WHAT A PACKAGE IS FOR. Before this, the four artefacts a talking face needs — the
 * text, the audio, the timings the synthesiser stamped, and the marks the aligner
 * produced — were four files a person carried between two tools by hand. That is exactly
 * as reliable as it sounds: the wrong pair got matched twice in one afternoon, and the
 * failure is silent, because a transcript that does not match its audio still aligns and
 * still returns confident marks. A package is those four things written together by one
 * process, which is the only arrangement in which they cannot disagree.
 */

import type { VisemeMark } from '../live/visemeTable';

export const INDEX_KEY = 'index.json';

/** The generated speech itself. Its extension is whatever ElevenLabs returned. */
export const audioKey = (id: string) => `audio/${id}.mp3`;

/** The package body: text, marks, words, and how it was made. */
export const packageKey = (id: string) => `packages/${id}.json`;

/**
 * The raw alignment ElevenLabs returned, kept rather than discarded.
 *
 * Two things read it. The reaction overlay in tags.ts needs the character timings to
 * find where a [laughs] actually sits, and verify_timing.py compares them against the
 * aligner as an independent opinion. It is also the only record of what the synthesiser
 * thought it was doing, which is worth having when a package looks wrong later.
 */
export const alignmentKey = (id: string) => `alignment/${id}.json`;

/** A word the aligner could not look up, and where it sits. */
export interface OovWord {
  word: string;
  startMs: number;
  endMs: number;
  reason: string;
}

/**
 * What the rest of the face does over a stretch of time.
 *
 * A second channel beside the marks, and it has to be second rather than folded in
 * because the marks are a vocabulary about lips. `Viseme` describes a mouth; eyes and a
 * head are not mouths, and giving a mark an `eyesClosed` field would make every mark
 * carry a question only a handful can answer.
 *
 * Only laughter fills this today. Whether it does at all is the author's choice — see
 * LaughOptions — because a laugh with the eyes screwed shut is delightful on one face
 * and unsettling on another, and that is a judgement about artwork rather than about
 * phonetics.
 */
export interface ExpressionSpan {
  startMs: number;
  endMs: number;
  /**
   * Both lids down, using the artwork every kit already carries for blinking.
   *
   * A blink is the same flag over a short span rather than a separate kind: shutting
   * the eyes for 140ms *is* a blink, and a second mechanism would only be a second
   * thing to keep in step with this one.
   */
  eyesClosed?: boolean;
  /**
   * A single deliberate nod through the span.
   *
   * CARRIED BUT NOT YET HONOURED. The head is driven by headMotion, whose nod fires on
   * turn edges from loudness and turn-taking; accepting a second master is a real change
   * and its own comments discuss the difficulty of nodding at the right *place* in a
   * sentence rather than at the right time. Kept in the format because the design is
   * settled, and out of the UI because a control that does nothing is worse than none.
   */
  nod?: boolean;
}

/**
 * How reactions are performed. Set per generation, stored with the package.
 *
 * Three switches rather than one per tag, because what each reaction *wants* is a fact
 * about physiology and belongs in the tag table: a yawn closes the eyes, a gasp widens
 * them, a gulp does nothing with them. What varies between faces is only whether that
 * reads well on this particular artwork, which is one question, not seven.
 */
export interface ReactionOptions {
  /**
   * Whether the eyes follow the reaction at all.
   *
   * On by default. The escape hatch exists because a laugh with the eyes screwed up is
   * delightful on one face and unsettling on another, which is a judgement about a
   * drawing rather than about anatomy.
   */
  eyes: boolean;
  /**
   * A brief smile before a laugh opens.
   *
   * Only on a span long enough to carry one — a short giggle that smiled first would
   * spend most of itself arriving. See SMILE_LEAD_MIN_MS in tags.ts.
   */
  smileLeadIn: boolean;
  /** Not honoured yet — see ExpressionSpan.nod. */
  nod: boolean;
}

export const DEFAULT_REACTIONS: ReactionOptions = {
  eyes: true,
  smileLeadIn: true,
  nod: false,
};

export type LipsyncModel = 'eleven_v3' | 'eleven_multilingual_v2';

/** Straight through to ElevenLabs; none of these affect alignment. */
export interface VoiceParams {
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
}

export const DEFAULT_PARAMS: VoiceParams = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  speakerBoost: true,
};

/** One line, with everything needed to play it and everything needed to judge it. */
export interface LipsyncPackage {
  id: string;
  createdAt: number;
  /** A short label for the listing. Derived from the text unless someone names it. */
  name: string;

  /** As typed, tags and all. What was sent to ElevenLabs. */
  text: string;
  /** Tags stripped. What the aligner was given, and the only text MFA ever saw. */
  script: string;
  language: 'en' | 'fr' | 'es';

  voiceId: string;
  voiceName?: string;
  model: LipsyncModel;
  params: VoiceParams;

  durationMs: number;
  /**
   * Words the dictionary did not know, each of which draws as a closed mouth.
   *
   * Carried on the package rather than left in a log because it is the one number that
   * says a package is quietly wrong somewhere, and the listing can show it.
   */
  oovCount: number;
  /** How many reaction spans were overlaid rather than trusted to the aligner. */
  reactionCount: number;
  /** How the reactions in this line were performed. */
  reactions: ReactionOptions;
  /** What the eyes and head do, and when. Empty unless something asked. */
  expressions: ExpressionSpan[];
  /**
   * Which words the aligner could not look up, not merely how many.
   *
   * The count on its own is the least useful true thing this can say: it warns that a
   * word will draw as a closed mouth without saying which, so the only way to act on it
   * is to reread the line guessing. With the spans, the page can point at the moment.
   */
  oovWords: OovWord[];

  marks: VisemeMark[];
  /** The aligner's word tier, for checking timing against the synthesiser's own. */
  words: Array<{ word: string; startMs: number; endMs: number }>;
}

/** The listing. Everything needed to render a row, and nothing that needs a fetch. */
export interface PublishedLine {
  id: string;
  name: string;
  createdAt: number;
  language: LipsyncPackage['language'];
  voiceId: string;
  voiceName?: string;
  model: LipsyncModel;
  durationMs: number;
  oovCount: number;
}

export function summarise(pkg: LipsyncPackage): PublishedLine {
  return {
    id: pkg.id,
    name: pkg.name,
    createdAt: pkg.createdAt,
    language: pkg.language,
    voiceId: pkg.voiceId,
    voiceName: pkg.voiceName,
    model: pkg.model,
    durationMs: pkg.durationMs,
    oovCount: pkg.oovCount,
  };
}

/**
 * A name for a line nobody named, taken from its opening words.
 *
 * The script rather than the text, so a line that opens with three directive tags is
 * still called something a person recognises.
 */
export function nameFrom(script: string): string {
  const words = script.replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');
  return words.length > 48 ? `${words.slice(0, 47)}…` : words || 'untitled';
}
