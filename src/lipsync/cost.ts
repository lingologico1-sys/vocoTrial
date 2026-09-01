import { TAGS } from './tags';

/**
 * What a line costs, in the unit ElevenLabs actually bills in.
 *
 * CHARACTERS, NOT WORDS OR SECONDS. That distinction is the whole reason this file is
 * worth having, because it makes one thing true that nobody expects: **audio tags are
 * billed**. `[warmly]` is eight characters of quota spent on something that is never
 * spoken and appears in no transcript. On a plan measured in tens of thousands of
 * characters a month, a habit of opening every line with two directives is a few percent
 * of the month spent on stage directions.
 *
 * That is not an argument against tags — they are the reason v3 is interesting — but it
 * is worth seeing while writing rather than discovering at the end of a month, which is
 * why the panel breaks the count into words and tags rather than showing one total.
 *
 * WHAT IS EXACT AND WHAT IS NOT. The character count is exact: it is the string, and the
 * string is what gets sent. The quota figures come from ElevenLabs itself. The money is
 * an estimate and says so, because the rate depends on the plan, on rollover, and on
 * overage — this account's limit is not the tier's headline number, which is exactly the
 * sort of thing that makes a hardcoded price wrong.
 */

const BRACKETED = /\[[^\]\n]*\]/g;
const KNOWN = new Set(TAGS.map((t) => t.tag.toLowerCase()));

/**
 * An accent tag, which is known without being in the table.
 *
 * TAGS is a fixed palette and an accent is not: the whole point of the accent field is
 * that the author names one, so there is no list to check membership against. Without
 * this every generation made with an accent would report its own tag as unrecognised,
 * and `unknownTags` would stop meaning "you may have mistyped something" — which is the
 * only reason it is reported.
 */
const ACCENT = /^\[[^\]\n]*\baccent\b[^\]\n]*\]$/i;

export interface Cost {
  /** Everything sent to ElevenLabs. This is what is billed. */
  total: number;
  /** Of that, what is inside brackets — paid for, never spoken. */
  tagChars: number;
  /** How many tags, and how many of them this build recognises. */
  tagCount: number;
  unknownTags: string[];
}

export function costOf(text: string): Cost {
  const found = text.match(BRACKETED) ?? [];
  return {
    total: text.length,
    tagChars: found.reduce((n, t) => n + t.length, 0),
    tagCount: found.length,
    unknownTags: found.filter((t) => !KNOWN.has(t.toLowerCase()) && !ACCENT.test(t)),
  };
}

/** What ElevenLabs says about the account. Straight from /v1/user/subscription. */
export interface Quota {
  tier: string;
  used: number;
  limit: number;
  /** Unix seconds. Absent on plans that do not reset. */
  resetsAt?: number;
}

/**
 * A rough price per thousand characters, for the estimate only.
 *
 * Starter's list price, which is the plan this was built against. Deliberately a single
 * loose number rather than a table of tiers: a table would look authoritative and would
 * still be wrong the moment a plan changed, whereas one number labelled as an estimate
 * is honest about being one. The count beside it is exact, and the count is what matters
 * for deciding whether a line is worth regenerating.
 */
export const USD_PER_1K_CHARS = 0.17;

export function estimateUsd(chars: number): number {
  return (chars / 1000) * USD_PER_1K_CHARS;
}

/** What is left, which is the number worth leading with. */
export function remaining(q: Quota): number {
  return Math.max(0, q.limit - q.used);
}

/**
 * "86,408 left of 88,736".
 *
 * Remaining first, spent second. The panel used to lead with what had been used, which
 * is the same information and the wrong way round: nobody writing a line wants to know
 * how much of the month is gone, they want to know whether there is room for this one.
 */
export function formatQuota(q: Quota): string {
  return `${remaining(q).toLocaleString()} left of ${q.limit.toLocaleString()}`;
}

/** How much of the allowance is gone, 0 to 1, for the bar. */
export function spentFraction(q: Quota): number {
  return q.limit > 0 ? Math.min(1, q.used / q.limit) : 0;
}

/** How many more lines like this one the remaining quota affords. */
export function linesLeft(q: Quota, chars: number): number | null {
  if (chars <= 0) return null;
  return Math.max(0, Math.floor((q.limit - q.used) / chars));
}
