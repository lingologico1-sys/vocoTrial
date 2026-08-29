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
