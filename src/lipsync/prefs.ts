import {
  DEFAULT_PARAMS,
  DEFAULT_REACTIONS,
  type LipsyncModel,
  type LipsyncPackage,
  type ReactionOptions,
  type VoiceParams,
} from './published';
import { MARK_LOOKAHEAD_MS } from '../live/polly';

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

/**
 * Anything malformed is discarded rather than repaired: it is only a cache.
 *
 * Merged over the defaults field by field so that a stored blob written before a
 * field existed still opens, with the new field at its default rather than
 * undefined — which for `params` would otherwise crash the sliders reading it.
 */
export function loadPrefs(): LipsyncPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS;
    const saved = parsed as Partial<LipsyncPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...saved,
      params: { ...DEFAULT_PARAMS, ...(saved.params ?? {}) },
      reactions: { ...DEFAULT_REACTIONS, ...(saved.reactions ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Partial<LipsyncPrefs>): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...prefs }));
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
