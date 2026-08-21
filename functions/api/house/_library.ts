/**
 * The R2 side of the house library.
 *
 * ONE OBJECT EACH, NOT ONE BETWEEN THEM, and they are different shapes of
 * thing. The styles are a list somebody picks from; the performance profile and
 * the lesson rules are single settings the deployment has or has not got.
 * Holding them in one object would mean a save to any of them being a
 * read-modify-write of all, and an administrator saving a style while another
 * tab saves a profile losing one of them.
 *
 *   styles.json        { "styles": [ ... ] }
 *   performance.json   one PerformanceProfile
 *   lesson-rules.json  { "rules": "..." }
 *
 * The rules are wrapped in an object where the profile is not, because the
 * profile is already one and a bare JSON string is a thing every future field
 * would have to be added beside rather than into.
 *
 * WRITTEN BY AN ADMINISTRATOR, READ BY A TEACHER, SPENT BY THE PUBLISH ROUTE.
 * Nothing a student's browser ever sees: a published setup carries the composed
 * prompt and the flattened profile, so this bucket is out of the serving path
 * the same way the Voco Session library is.
 *
 * ONE WRITER IS ASSUMED, as everywhere else here and for the same reason: the
 * author is one person at one keyboard. Two saves landing together can lose
 * one, which costs a re-save rather than data.
 */

import {
  looksLikeLessonRules,
  looksLikePerformance,
  looksLikeStyle,
  type TutorStyle,
} from '../../../src/realtime/house';
import type { PerformanceProfile } from '../../../src/realtime/session';

export const STYLES_KEY = 'styles.json';
export const PERFORMANCE_KEY = 'performance.json';
export const LESSON_RULES_KEY = 'lesson-rules.json';

export interface HouseEnv {
  /**
   * The bucket, bound in wrangler.toml.
   *
   * Optional so a deployment without the binding answers with a plain message
   * rather than throwing on first property access — the posture every key check
   * in _vertex.ts already takes. The publish route treats an absent binding as
   * an empty house rather than a failure, because a deployment nobody has set
   * up yet should still publish something that runs.
   */
  HOUSE?: R2Bucket;
}

export async function readStyles(bucket: R2Bucket): Promise<TutorStyle[]> {
  const object = await bucket.get(STYLES_KEY);
  if (!object) return [];

  try {
    const parsed = (await object.json()) as { styles?: unknown };
    if (!Array.isArray(parsed.styles)) return [];
    // Each entry checked on its own, so one corrupt row does not cost the rest.
    return parsed.styles.filter(looksLikeStyle);
  } catch {
    // Empty is still the right answer: a save writes the whole object, so the
    // next one repairs it.
    return [];
  }
}

export function writeStyles(bucket: R2Bucket, styles: TutorStyle[]): Promise<unknown> {
  return bucket.put(STYLES_KEY, JSON.stringify({ styles }), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/** The saved profile, or null when nobody has saved one. */
export async function readPerformance(bucket: R2Bucket): Promise<PerformanceProfile | null> {
  const object = await bucket.get(PERFORMANCE_KEY);
  if (!object) return null;

  try {
    const parsed: unknown = await object.json();
    // Validated on the way out as well as in, for readSession's reason: what is
    // in the bucket was written by an older version of this app as often as by
    // the current one, and a half-profile should read as "none saved" — which
    // falls back to the face's own defaults — rather than as a face missing a
    // driver.
    return looksLikePerformance(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePerformance(
  bucket: R2Bucket,
  performance: PerformanceProfile,
): Promise<unknown> {
  return bucket.put(PERFORMANCE_KEY, JSON.stringify(performance), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * The saved lesson rules, or null when nobody has written any.
 *
 * Null and empty-string are the same answer here — both compose the build’s own
 * text — but they are kept distinct on the way out so studio can tell an
 * administrator which of the two they are looking at: a block nobody has
 * touched, or one somebody deliberately cleared.
 */
export async function readLessonRules(bucket: R2Bucket): Promise<string | null> {
  const object = await bucket.get(LESSON_RULES_KEY);
  if (!object) return null;

  try {
    const parsed = (await object.json()) as { rules?: unknown };
    // Validated on the way out as well as in, for readPerformance’s reason:
    // what is in the bucket was written by an older version of this app as
    // often as by the current one, and anything unreadable should compose the
    // build’s own text rather than reach a prompt.
    return looksLikeLessonRules(parsed.rules) ? parsed.rules : null;
  } catch {
    return null;
  }
}

export function writeLessonRules(bucket: R2Bucket, rules: string): Promise<unknown> {
  return bucket.put(LESSON_RULES_KEY, JSON.stringify({ rules }), {
    httpMetadata: { contentType: 'application/json' },
  });
}
