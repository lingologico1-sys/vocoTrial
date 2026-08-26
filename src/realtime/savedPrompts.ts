/**
 * What one saved prompt is, on the wire and in the bucket.
 *
 * THE PURE HALF OF presets.ts, split off for the reason every other pair in
 * here is split: this file is imported by functions/, which compiles against
 * workers-types with no DOM lib and no fetch wrapper of ours, so it has to stay
 * shape and constants and nothing else. The browser's half — the network calls,
 * the merge with the built-ins, the last-used pick — is presets.ts, and nothing
 * server-side may import that.
 *
 * Same relationship evaluators.ts has with evaluatorStore.ts, and for the same
 * reason: one schema drives the picker, the save route's validation and the
 * object in R2, so they cannot drift apart.
 *
 * WHY THERE IS A BUCKET FOR THIS AT ALL. Saved prompts used to live in
 * localStorage, and the note that stood in presets.ts defended it: they were
 * the author's own workshop notes, and a scale was the thing a student was
 * measured against, so only the scale travelled. That line did not survive
 * contact with the way the app is actually used. A prompt written on the bench
 * is what studio publishes as a manner and what a class eventually hears, and
 * a browser store reaches no other machine — so a prompt drafted on the laptop
 * could not be published from the desktop, and the two machines held different
 * libraries under the same picker. It travels now, like everything else
 * authored here.
 */

import { MAX_INSTRUCTIONS } from './instructions';

/** Custom keys are namespaced so they can never collide with a built-in's. */
export const CUSTOM_PREFIX = 'custom:';

/** A ceiling on the picker, not on you. Well past any plausible use. */
export const MAX_SAVED_PRESETS = 50;

/** How long a name may be. Long enough to be descriptive, short enough to fit. */
export const MAX_PRESET_NAME = 60;

/**
 * A ceiling on one prompt, in characters.
 *
 * The same number a call enforces rather than a new one: a saved prompt is sent
 * as the instructions on the bench, so a prompt this file would accept and a
 * session would refuse is a prompt saved to be useless. Studio's published
 * manner is the looser case — it gets a persona and a lesson added at publish,
 * and the publish route checks the composed total — but the tighter of two
 * ceilings is the honest one to enforce at the point of writing.
 */
export const MAX_PROMPT_TEXT = MAX_INSTRUCTIONS;

/** One saved prompt, exactly as it sits in the library object. */
export interface SavedPrompt {
  /** Namespaced with CUSTOM_PREFIX. Stable across an update — see savePreset. */
  key: string;
  label: string;
  /** The prompt itself, exactly as it was when saved. */
  text: string;
  /** Last written. Sorts the picker, so the ones being worked on stay near. */
  savedAt: number;
}

/**
 * Shape check shared by the save route and the browser's reader.
 *
 * Structural only, matching looksLikeStyle's posture in house.ts: the
 * middleware has already established the caller knew the site password, so
 * this is not a security boundary. What it catches is a malformed row reaching
 * a picker, where a prompt with no text renders as a tutor with no
 * instructions.
 */
export function looksLikeSavedPrompt(value: unknown): value is SavedPrompt {
  if (!value || typeof value !== 'object') return false;
  const prompt = value as SavedPrompt;
  return (
    typeof prompt.key === 'string' &&
    prompt.key.startsWith(CUSTOM_PREFIX) &&
    typeof prompt.label === 'string' &&
    typeof prompt.text === 'string' &&
    prompt.text.length <= MAX_PROMPT_TEXT
  );
}

/** Time for ordering, entropy so two saves in one millisecond stay distinct. */
export function newPromptKey(): string {
  return `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
