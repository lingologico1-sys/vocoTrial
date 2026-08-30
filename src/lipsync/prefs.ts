import {
  DEFAULT_PARAMS,
  DEFAULT_REACTIONS,
  type LipsyncModel,
  type LipsyncPackage,
  type ReactionOptions,
  type VoiceParams,
} from './published';
import { MARK_LOOKAHEAD_MS } from '../live/polly';
import { MAX_LOOKAHEAD_MS } from '../live/visemes';

/**
 * What this page remembers between visits.
 *
 * The page is a bench: the same voice ID, the same language and the same knobs get
 * used across a dozen sittings, and retyping a twenty-character ElevenLabs voice ID
 * from another tab was the first thing done on every one of them. So the *settings*
 * persist and the *material* does not.
 *
 * That line is deliberate. Audio lives in an object URL and marks are megabytes of
 * timings; neither survives a reload in any useful form, and a page that opened
 * holding a clip it could no longer play would be lying about its state. What comes
 * back is only what you would otherwise have typed again.
 *
 * The script is included because a line under test is rewritten and regenerated many
 * times, and losing the wording to a refresh costs more than the few kilobytes.
 */
export interface LipsyncPrefs {
  text: string;
  language: LipsyncPackage['language'];
  voiceId: string;
  model: LipsyncModel;
  params: VoiceParams;
  reactions: ReactionOptions;
  /** The published face worn, by id. Empty string is the deployment's own face. */
  faceId: string;
  lookaheadMs: number;
}

const PREFS_KEY = 'lipsync.prefs.v1';

/**
 * Which build's opinions the stored blob carries, kept inside it rather than in the key.
 *
 * A default that changes is not a problem — a stored value simply wins, which is the
 * whole point of remembering it. It is a problem when the stored value was never chosen:
 * `reactions.nod` defaulted to false and had no control on the page for as long as it
 * was unwired, so every visit wrote a `false` nobody meant. Shipping the new default
 * against those blobs would mean the laugh's bob is off for everyone who has ever opened
 * this page, and off in the one way that looks like the feature not working.
 *
 * The key is not bumped for it. Bumping the key throws away the voice ID and the script
 * as well, which is the one thing the note above says this file exists to avoid, to
 * repair one checkbox nobody set. So the version rides inside the blob and `migrate`
 * takes back only the field that was never a choice.
 */
const PREFS_VERSION = 2;

/**
 * The fields an older blob is not allowed to speak for.
 *
 * One field and one version so far, and deliberately written as a general step rather
 * than as a special case: the next unwired default to be finished will want the same
 * treatment, and the shape is easier to copy than to rediscover.
 *
 * `giggleNod` did not need a step and the difference is the whole test: it has never
 * been written to storage, so an older blob is missing it rather than wrong about it,
 * and `validate` fills a missing flag from the default already. This exists only for a
 * field that carries an answer nobody gave.
 */
function migrate(saved: Partial<LipsyncPrefs> & { version?: number }): Partial<LipsyncPrefs> {
  if (saved.version === PREFS_VERSION) return saved;
  // Deleted from a copy rather than destructured around, because the name that would
  // have to be bound and ignored is exactly what the lint forbids.
  const reactions = { ...(saved.reactions ?? {}) } as Partial<ReactionOptions>;
  delete reactions.nod;
  return { ...saved, reactions: reactions as ReactionOptions };
}

const LANGUAGES: readonly LipsyncPackage['language'][] = ['en', 'fr', 'es'];
const MODELS: readonly LipsyncModel[] = ['eleven_v3', 'eleven_multilingual_v2'];

/**
 * The longest script this will keep, and a storage guard rather than an API limit.
 *
 * localStorage is about five megabytes for the whole origin, and facekit/store.ts
 * already treats that budget as tight enough to push face artwork into IndexedDB
 * instead. This page has no business spending a measurable slice of it on one text
 * box, and no line worth generating comes anywhere near this — a script this long
 * would be rejected by ElevenLabs before it was ever aligned.
 *
 * OVER THE CAP THE TEXT IS DROPPED, NOT TRUNCATED. A shortened script that came back
 * looking complete could be generated and billed as if it were the whole line, and
 * the missing tail would show up only as a face that stops moving early — which is
 * the exact failure this page exists to catch, arriving from the one direction nobody
 * would think to check. Losing the text outright is obvious; losing its end is not.
 */
export const MAX_STORED_TEXT = 20_000;

export const DEFAULT_PREFS: LipsyncPrefs = {
  text: '',
  language: 'fr',
  voiceId: '',
  model: 'eleven_v3',
  params: DEFAULT_PARAMS,
  reactions: DEFAULT_REACTIONS,
  faceId: '',
  lookaheadMs: MARK_LOOKAHEAD_MS,
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length <= MAX_STORED_TEXT ? value : fallback;
}

/**
 * Every field checked against what the controls that set it would allow.
 *
 * Run on the way in AND on the way out, which is not belt and braces: writing is where
 * an over-long script is stopped before it can cost the quota, and reading is where a
 * blob written by an older build — or edited by hand in devtools, which is a thing
 * that happens on a bench page — is brought back into range.
 *
 * The values matter more than they look. `lookaheadMs` out of range leaves the slider
 * silently pinned at its ceiling while state says otherwise, so the number under the
 * label stops describing the mouth. A `model` string this build does not know reaches
 * ElevenLabs and comes back a rejected generation, which costs a round trip and reads
 * as a broken page rather than as stale storage. Both are cheap to prevent here and
 * genuinely confusing to diagnose anywhere else.
 */
function validate(saved: Partial<LipsyncPrefs>): LipsyncPrefs {
  const params = saved.params ?? DEFAULT_PARAMS;
  const reactions = saved.reactions ?? DEFAULT_REACTIONS;
  return {
    text: str(saved.text, DEFAULT_PREFS.text),
    language: oneOf(saved.language, LANGUAGES, DEFAULT_PREFS.language),
    voiceId: str(saved.voiceId, DEFAULT_PREFS.voiceId),
    model: oneOf(saved.model, MODELS, DEFAULT_PREFS.model),
    params: {
      stability: bounded(params.stability, 0, 1, DEFAULT_PARAMS.stability),
      similarityBoost: bounded(params.similarityBoost, 0, 1, DEFAULT_PARAMS.similarityBoost),
      style: bounded(params.style, 0, 1, DEFAULT_PARAMS.style),
      speakerBoost: flag(params.speakerBoost, DEFAULT_PARAMS.speakerBoost),
    },
    reactions: {
      eyes: flag(reactions.eyes, DEFAULT_REACTIONS.eyes),
      smileLeadIn: flag(reactions.smileLeadIn, DEFAULT_REACTIONS.smileLeadIn),
      nod: flag(reactions.nod, DEFAULT_REACTIONS.nod),
      giggleNod: flag(reactions.giggleNod, DEFAULT_REACTIONS.giggleNod),
    },
    faceId: str(saved.faceId, DEFAULT_PREFS.faceId),
    lookaheadMs: bounded(saved.lookaheadMs, 0, MAX_LOOKAHEAD_MS, DEFAULT_PREFS.lookaheadMs),
  };
}

/** Anything malformed is discarded rather than repaired: it is only a cache. */
export function loadPrefs(): LipsyncPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS;
    return validate(migrate(parsed as Partial<LipsyncPrefs> & { version?: number }));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Partial<LipsyncPrefs>): void {
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      // Stamped on the way out, so the blob this build writes is the blob this build
      // trusts in full. Everything that reads prefs goes through validate(), which
      // drops the field again on the way in.
      JSON.stringify({ ...validate({ ...loadPrefs(), ...prefs }), version: PREFS_VERSION }),
    );
  } catch {
    // Private browsing, or a full quota. Losing the cache is not worth an error.
  }
}

export function clearPrefs(): void {
  try {
    window.localStorage.removeItem(PREFS_KEY);
  } catch {
    // As above: nothing here is worth failing over.
  }
}
