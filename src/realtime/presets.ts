/**
 * The prompts you can pick from: the five written into the app, plus whatever
 * you have saved yourself.
 *
 * WHY THIS IS NOT IN instructions.ts. That file is imported by functions/,
 * which compiles against workers-types with no DOM lib and no localStorage —
 * and it is also the server's fallback prompt, so it has to stay pure data that
 * a Worker can read. This file is the browser's half: it reads and writes the
 * store, and nothing server-side may import it.
 *
 * THE ONE REAL DIFFERENCE between a built-in and a saved preset is what they
 * are made of. A built-in is a *function of the language* — pick Italian and
 * every one of them says "Italian" throughout, because they are written to be
 * rendered rather than stored. A saved preset is text, captured once, in
 * whatever language it was written in. It cannot follow the language picker
 * afterwards, and pretending otherwise would mean rewriting someone's own words
 * on a dropdown change. So it does not follow, the panel says so, and both are
 * exposed through one `render` so nothing downstream has to care which it got.
 */

import type { LanguageChoice } from './languages';
import { INSTRUCTION_PRESETS, defaultPresetKey } from './instructions';

/**
 * Where saved prompts and the last-used pick live.
 *
 * Separate from either page's own prefs key on purpose: both pages read this
 * one, and a prompt you wrote on tutorBench is usable on the face page
 * without retyping it. Nothing here is a secret.
 */
const STORE_KEY = 'vocotrial.presets.v1';

/** Custom keys are namespaced so they can never collide with a built-in's. */
const CUSTOM_PREFIX = 'custom:';

/** A ceiling on the picker, not on you. Well past any plausible use. */
export const MAX_SAVED_PRESETS = 50;

/** How long a name may be. Long enough to be descriptive, short enough to fit. */
export const MAX_PRESET_NAME = 60;

/** What one saved prompt is, on disk. */
interface StoredPreset {
  key: string;
  label: string;
  /** The prompt itself, exactly as it was when saved. */
  text: string;
  /** Last written. Sorts the picker, so the ones you are working on stay near. */
  savedAt: number;
}

interface Store {
  custom: StoredPreset[];
  /** The key last chosen, on either page. Absent until something is picked. */
  lastUsed?: string;
}

/**
 * What the pickers render and what a call is built from.
 *
 * `render` hides the built-in/saved split described at the top of the file:
 * a built-in renders into the chosen language, a saved one ignores its argument
 * and hands back the text it was saved with.
 */
export interface Preset {
  key: string;
  label: string;
  /** One line under the picker. Built-ins describe intent; saved ones, origin. */
  blurb: string;
  builtIn: boolean;
  render: (language: LanguageChoice) => string;
}

const EMPTY: Store = { custom: [] };

/** Anything malformed is discarded rather than repaired. */
function read(): Store {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return EMPTY;

    const store = parsed as Partial<Store>;
    const custom = Array.isArray(store.custom) ? store.custom : [];

    return {
      // Each entry is checked on its own, so one corrupt row does not cost you
      // the rest of them.
      custom: custom.filter(
        (entry): entry is StoredPreset =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as StoredPreset).key === 'string' &&
          typeof (entry as StoredPreset).label === 'string' &&
          typeof (entry as StoredPreset).text === 'string',
      ),
      lastUsed: typeof store.lastUsed === 'string' ? store.lastUsed : undefined,
    };
  } catch {
    return EMPTY;
  }
}

function write(store: Store): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Private browsing, or a full quota. A prompt that fails to save is worth
    // knowing about, unlike a lost cache — see savePreset, which reports it.
    throw new Error('Could not save. Browser storage is full or unavailable.');
  }
}

function toPreset(stored: StoredPreset): Preset {
  return {
    key: stored.key,
    label: stored.label,
    blurb: 'Saved prompt. Fixed text, so it does not follow the language picker.',
    builtIn: false,
    render: () => stored.text,
  };
}

const builtIns: Preset[] = INSTRUCTION_PRESETS.map((preset) => ({
  key: preset.key,
  label: preset.label,
  blurb: preset.blurb,
  builtIn: true,
  render: preset.render,
}));

/** Built-ins first, in their written order; saved ones after, newest first. */
export function listPresets(): Preset[] {
  const custom = [...read().custom]
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    .map(toPreset);
  return [...builtIns, ...custom];
}

export function findPreset(key: string): Preset | undefined {
  return listPresets().find((preset) => preset.key === key);
}

/**
 * Renders a preset, falling back to the first built-in.
 *
 * The fallback is not defensive padding: a saved preset can be deleted while a
 * page that remembers it is still open in another tab, and a call is a bad
 * moment to discover it.
 */
export function renderPreset(key: string, language: LanguageChoice): string {
  const preset = findPreset(key) ?? builtIns[0];
  return preset.render(language);
}

/**
 * The preset to open on, which is the one last picked.
 *
 * Checked against the list rather than trusted, because the remembered key may
 * name a preset that has since been deleted — on this page or the other one.
 */
export function lastUsedKey(): string {
  const remembered = read().lastUsed;
  if (remembered && findPreset(remembered)) return remembered;
  return defaultPresetKey();
}

/** Records a pick. Cheap and frequent; a failure here is not worth reporting. */
export function rememberPreset(key: string): void {
  try {
    write({ ...read(), lastUsed: key });
  } catch {
    // Losing the pick costs one dropdown change on the next visit.
  }
}

function makeKey(): string {
  // Time for ordering, entropy so two saves in one millisecond stay distinct.
  return `${CUSTOM_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Saves the given text under a new name and selects it.
 *
 * Throws with something worth showing rather than failing quietly: unlike the
 * prefs cache elsewhere in the app, this is the user's own writing and losing
 * it silently would be the worst outcome available.
 */
export function savePreset(label: string, text: string): Preset {
  const name = label.trim().slice(0, MAX_PRESET_NAME);
  if (!name) throw new Error('Give the prompt a name.');
  if (!text.trim()) throw new Error('There is nothing to save.');

  const store = read();
  if (store.custom.length >= MAX_SAVED_PRESETS) {
    throw new Error(`That is ${MAX_SAVED_PRESETS} saved prompts. Delete one first.`);
  }

  const stored: StoredPreset = { key: makeKey(), label: name, text, savedAt: Date.now() };
  write({ custom: [...store.custom, stored], lastUsed: stored.key });
  return toPreset(stored);
}

/**
 * Writes over a saved preset in place, keeping its key.
 *
 * Keeping the key is the point: it is what the pages remember as last-used, so
 * an update is not allowed to look like a delete-and-recreate to them.
 */
export function updatePreset(key: string, text: string): Preset | undefined {
  const store = read();
  const existing = store.custom.find((entry) => entry.key === key);
  if (!existing) return undefined;

  const stored: StoredPreset = { ...existing, text, savedAt: Date.now() };
  write({
    ...store,
    custom: store.custom.map((entry) => (entry.key === key ? stored : entry)),
  });
  return toPreset(stored);
}

/** Removes a saved preset. Built-in keys are ignored rather than refused. */
export function deletePreset(key: string): void {
  const store = read();
  write({
    custom: store.custom.filter((entry) => entry.key !== key),
    // A deleted preset must not stay the default. Left alone, lastUsedKey()
    // would fall back for the rest of time without the store ever being right.
    lastUsed: store.lastUsed === key ? undefined : store.lastUsed,
  });
}
