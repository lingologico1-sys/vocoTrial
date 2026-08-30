import { INDEX_KEY, type PublishedLine } from '../../../src/lipsync/published';
import {
  LAUGHS_INDEX_KEY,
  type LaughLibraryIndex,
} from '../../../src/lipsync/laughs';

/**
 * The R2 side of the saved-line library, and the keys the generator needs.
 *
 * Deliberately the same shape as faces/_library.ts, down to the one-writer note: the
 * index is read, edited and written back, so two saves landing together can lose one
 * entry. The package and its audio are safely written by then, so the loss is a line
 * missing from the listing until something rewrites it. Worth knowing and not worth a
 * lock while the author is one person at one keyboard.
 */

export interface LipsyncEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so a deployment without the binding answers with a plain message rather
   * than throwing on first property access — the posture every key check here takes.
   */
  LIPSYNC?: R2Bucket;
  /** ElevenLabs, for synthesis. A Secret in the dashboard. */
  ELEVENLABS_API_KEY?: string;
  /**
   * The Modal aligner: its URL, and the key its own X-API-Key gate expects.
   *
   * Two variables rather than a hardcoded URL because the endpoint moves between the
   * deployed app and `modal serve` during development, and a hostname baked into a
   * Worker is a redeploy every time it does.
   */
  LIPSYNC_URL?: string;
  LIPSYNC_API_KEY?: string;
}

export async function readIndex(bucket: R2Bucket): Promise<PublishedLine[]> {
  const object = await bucket.get(INDEX_KEY);
  if (!object) return [];

  try {
    const parsed = (await object.json()) as { lines?: unknown };
    return Array.isArray(parsed.lines) ? (parsed.lines as PublishedLine[]) : [];
  } catch {
    // A corrupt index is not a corrupt library: the packages are still under their own
    // keys and the next save rewrites this from whatever survived. Empty is the
    // recoverable answer, so it is the one — the same call faces/_library.ts makes.
    return [];
  }
}

export function writeIndex(bucket: R2Bucket, lines: PublishedLine[]): Promise<unknown> {
  return bucket.put(INDEX_KEY, JSON.stringify({ lines }), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * The laugh library's index, kept exactly the way the line index above is.
 *
 * A second small object rather than a second bucket, and separate from the line index
 * rather than folded into it. Separate because generate.ts reads this on every single
 * request and the line index on none of them: merging them would mean fetching every
 * saved line's summary to find out which laughs exist, on the hot path, forever.
 *
 * The same one-writer caveat applies and matters less here — laughs are imported
 * occasionally and by one person, where lines are saved in bursts while tuning a voice.
 *
 * BOTH HALVES IN ONE OBJECT, because they are always wanted together: the panel draws
 * sources annotated by which voices they have been rendered into, and no caller has ever
 * wanted one list without the other. Two objects would be two round trips and a window in
 * which they disagree.
 *
 * `clips` is read as `renders` when it is all that is there. The first version of this
 * feature stored a flat `{ clips: [...] }` of harvested takes; those are renders that
 * happen to have no recording behind them, so reading them under the new name is the whole
 * of the migration. Nothing rewrites them — an untouched library keeps working, and the
 * next import writes the new shape around it.
 */
export async function readClips(bucket: R2Bucket): Promise<LaughLibraryIndex> {
  const object = await bucket.get(LAUGHS_INDEX_KEY);
  if (!object) return { sources: [], renders: [] };

  try {
    const parsed = (await object.json()) as {
      sources?: unknown;
      renders?: unknown;
      clips?: unknown;
    };
    const renders = Array.isArray(parsed.renders)
      ? parsed.renders
      : Array.isArray(parsed.clips)
        ? parsed.clips
        : [];
    return {
      sources: Array.isArray(parsed.sources)
        ? (parsed.sources as LaughLibraryIndex['sources'])
        : [],
      renders: renders as LaughLibraryIndex['renders'],
    };
  } catch {
    return { sources: [], renders: [] };
  }
}

export function writeClips(
  bucket: R2Bucket,
  library: LaughLibraryIndex,
): Promise<unknown> {
  return bucket.put(LAUGHS_INDEX_KEY, JSON.stringify(library), {
    httpMetadata: { contentType: 'application/json' },
  });
}
