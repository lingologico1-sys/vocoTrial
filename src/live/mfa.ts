import { POLLY_VISEMES, type PollyViseme, type VisemeMark } from './polly';

/**
 * Marks from a forced aligner, for audio Polly did not speak.
 *
 * Polly hands over speech marks because it did the synthesis and knows what it was
 * about to articulate. Nothing does that for a recording, or for a voice from a
 * provider that publishes no marks — and the audio driver in visemes.ts is the
 * fallback precisely because that information is missing. A forced aligner recovers
 * it after the fact: given the audio and the script that was read, it says where in
 * the recording each phone begins.
 *
 * That runs in ../../../lipsyncBackend, on Montreal Forced Aligner, at build time. The
 * result is a static JSON file fetched alongside the audio; nothing here waits on an
 * aligner, and no aligner is anywhere near the browser.
 *
 * WHAT THIS FILE DOES NOT CONTAIN is the point of it. There is no phone table and no
 * mapping onto the seven drawn poses, because polly.ts already has one and it is the
 * good one — POLLY_VISEMES carries the reasoning for why the postalveolars round to
 * `oh` rather than joining the sibilants, why /l/ sits at `ee` so a sound does not
 * change shape with the voice speaking it, and which of Polly's distinctions were
 * measured and dropped because a flat patch cannot show a tongue. So the backend
 * stops one step short and emits Polly's *identifiers*, which this reads. The
 * aligner becomes a second source of the same marks rather than a second vocabulary,
 * and MarkMouth cannot tell the two apart.
 *
 * The cost of that choice is a coupling worth naming: the backend's phone table
 * targets the identifiers in POLLY_VISEMES, so removing one from that Record breaks
 * a service in another repository. Adding one is free.
 */

/** One clip's marks, as the bake writes them. */
export interface MfaMarkFile {
  /** The audio file these were aligned from. Diagnostic only. */
  source?: string;
  /** ISO-639-1, and which model produced them. Diagnostic only. */
  language?: string;
  model?: string;
  /** Length of the aligned audio. Worth comparing against the real clip. */
  durationMs?: number;
  /**
   * How many words the dictionary did not know.
   *
   * Not decoration. An out-of-vocabulary word aligns as `spn`, which lands on `rest`
   * — so the mouth stays shut for the whole of it. A file with a non-zero count has
   * a visibly dead patch in it somewhere, and the number is the only warning.
   */
  oovCount?: number;
  marks: Array<{ timeMs: number; polly: string }>;
}

const IS_POLLY_VISEME = (value: unknown): value is PollyViseme =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(POLLY_VISEMES, value);

/**
 * Reads a baked marks file into the marks MarkMouth already consumes.
 *
 * Deliberately the same shape and the same tolerances as parseSpeechMarks, because
 * the two produce the same thing from different sources and any difference between
 * them would be a difference in how the mouth behaves that nobody chose. So an
 * unrecognised identifier is dropped rather than thrown on — a build that emitted a
 * mark this one has never heard of wants a table updated, and the failure that suits
 * that is one wrong-looking mouth shape, not a lesson that dies mid-sentence — and
 * the result is sorted on the way out because markAt binary-searches it. The bake
 * emits in order, but that is a property of the writer rather than of the format.
 *
 * What it does not share is the parsing. Polly's marks are newline-delimited JSON,
 * one object per line, and cannot be handed to JSON.parse whole; this is an ordinary
 * document, so it can.
 */
export function parseMfaMarks(file: MfaMarkFile | string): VisemeMark[] {
  let parsed: unknown = file;

  if (typeof file === 'string') {
    try {
      parsed = JSON.parse(file);
    } catch {
      return [];
    }
  }

  if (typeof parsed !== 'object' || parsed === null) return [];
  const raw = (parsed as MfaMarkFile).marks;
  if (!Array.isArray(raw)) return [];

  const marks: VisemeMark[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const mark = entry as { timeMs?: unknown; polly?: unknown };
    if (typeof mark.timeMs !== 'number' || !Number.isFinite(mark.timeMs)) continue;
    if (!IS_POLLY_VISEME(mark.polly)) continue;

    marks.push({
      timeMs: mark.timeMs,
      polly: mark.polly,
      viseme: POLLY_VISEMES[mark.polly],
    });
  }

  return marks.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Fetches and parses a marks file.
 *
 * Resolves to an empty array rather than rejecting, and that is the same judgement
 * the parser makes one level down: a missing or malformed marks file should cost the
 * mouth its shape, not cost the page its lesson. MarkMouth reads an empty timeline as
 * `rest` throughout, so the face simply falls still — which is exactly what it would
 * have done had nobody built any of this.
 *
 * The caller that wants to know can compare `length` against zero, and probably
 * should before choosing this driver over the audio one.
 */
export async function loadMfaMarks(url: string): Promise<VisemeMark[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    return parseMfaMarks((await response.json()) as MfaMarkFile);
  } catch {
    return [];
  }
}
