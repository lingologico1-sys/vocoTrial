/**
 * The prompts you can pick from: the five written into the app, plus whatever
 * has been saved into the shared library.
 *
 * WHAT THIS FILE IS NOW. It used to be the browser's localStorage store, and
 * the note here defended that: saved prompts were the author's own workshop
 * notes, and only a scale — the thing a student is measured against — needed to
 * travel. That did not survive use. A prompt written on the bench is what
 * studio publishes as a manner and what a class eventually hears, and a library
 * that lives in one browser cannot be published from another. So the prompts
 * went to R2 with the faces, the evaluators and the house, and this file is the
 * browser's half of that: it talks to /api/prompts/*, and nothing server-side
 * may import it. The pure half is savedPrompts.ts.
 *
 * WHAT STAYS LOCAL, and correctly so, is the *pick* — which prompt this browser
 * had selected last. That is a per-browser convenience like a scroll position,
 * not authored content, and evaluatorStore.ts keeps its own for the same
 * reason.
 *
 * THE BUILT-INS ARE MERGED HERE, NOT STORED, the way the built-in evaluator is.
 * list returns only what has been authored, so a deployment with no bucket, no
 * saves, or a failed request still shows five working prompts rather than an
 * empty picker.
 *
 * THE ONE REAL DIFFERENCE between a built-in and a saved prompt is what they
 * are made of. A built-in is a *function of the language* — pick Italian and
 * every one of them says "Italian" throughout, because they are written to be
 * rendered rather than stored. A saved prompt is text, captured once, in
 * whatever language it was written in. It cannot follow the language picker
 * afterwards, and pretending otherwise would mean rewriting someone's own words
 * on a dropdown change. So it does not follow, the panel says so, and both are
 * exposed through one `render` so nothing downstream has to care which it got.
 *
 * ASYNC IS THE VISIBLE COST of the move, and it is paid at the picker rather
 * than at the call: `listPresets` is a request, and everything after it —
 * finding one, rendering one, resolving the last-used key — takes the list it
 * returned and stays synchronous. That is what keeps the per-keystroke compare
 * in the prompt box off the network. See `renderFrom`.
 */

import type { LanguageChoice } from './languages';
import { INSTRUCTION_PRESETS, defaultPresetKey } from './instructions';
import {
  CUSTOM_PREFIX,
  MAX_PRESET_NAME,
  MAX_SAVED_PRESETS,
  type SavedPrompt,
  newPromptKey,
} from './savedPrompts';

export { MAX_PRESET_NAME, MAX_SAVED_PRESETS };

/**
 * Where the last-used pick is remembered, and — until it is migrated — the old
 * library alongside it.
 *
 * The key is unchanged from when this store held everything, which is what lets
 * the migration below find prompts written before the move. Nothing here is a
 * secret; the credentials live in an HttpOnly cookie precisely so they never
 * touch this store.
 */
const STORE_KEY = 'vocotrial.presets.v1';

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

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(answer?.error || 'That did not work');
  if (!answer) throw new Error('Empty reply');
  return answer;
}

function toPreset(stored: SavedPrompt): Preset {
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

/** The five in the bundle, and nothing else. What a page opens on. */
export function builtInPresets(): Preset[] {
  return builtIns;
}

function merge(prompts: SavedPrompt[]): Preset[] {
  const saved = [...prompts]
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    .map(toPreset);
  return [...builtIns, ...saved];
}

// --- The migration off localStorage ------------------------------------------

/**
 * The prompts this browser saved before the library moved to R2.
 *
 * Read defensively and structurally, exactly as the old store read itself: one
 * corrupt row must not cost the rest of them, because this is the only copy
 * that exists and it is about to be either uploaded or abandoned.
 */
function strandedPrompts(): SavedPrompt[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return [];

    const custom = (parsed as { custom?: unknown }).custom;
    if (!Array.isArray(custom)) return [];

    return custom
      .filter(
        (entry): entry is SavedPrompt =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as SavedPrompt).key === 'string' &&
          typeof (entry as SavedPrompt).label === 'string' &&
          typeof (entry as SavedPrompt).text === 'string' &&
          !!(entry as SavedPrompt).text.trim(),
      )
      .map((entry) => ({
        key: entry.key.startsWith(CUSTOM_PREFIX) ? entry.key : newPromptKey(),
        label: entry.label,
        text: entry.text,
        savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

/** Drops the old library, keeping the last-used pick. Called only after a save. */
function clearStranded(): void {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const lastUsed =
      parsed && typeof parsed === 'object'
        ? (parsed as { lastUsed?: unknown }).lastUsed
        : undefined;
    window.localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ custom: [], lastUsed: typeof lastUsed === 'string' ? lastUsed : undefined }),
    );
  } catch {
    // Failing to clear costs a second upload attempt on the next load, which
    // the key check below turns into a no-op. Nothing is lost either way.
  }
}

/**
 * Lifts this browser's stranded prompts into the shared library, once.
 *
 * RUNS ON EVERY MACHINE, AND ONLY ONCE ON EACH. The keys carry time and
 * entropy, so two machines that never shared a prompt cannot collide, and each
 * one contributes what it holds the first time it loads a page after the move.
 * Anything already up there by key is left alone — that is what makes a second
 * run, after a failed clear, harmless.
 *
 * THE SECOND FILTER IS FOR THE OBVIOUS DUPLICATE: the same prompt typed into
 * two laptops before there was any way to share it. Identical name and
 * identical text is not a coincidence worth preserving twice in a picker, and
 * the local copy is the one that yields — the shared library was there first.
 *
 * A FAILURE IS NOT REPORTED AND NOT FATAL. The local store is left intact, the
 * page shows the shared library as it stands, and the next load tries again.
 * The one thing that must not happen is dropping the only copy of somebody's
 * writing because a request failed, and clearing only after a successful save
 * is what prevents it.
 */
async function migrate(existing: SavedPrompt[]): Promise<SavedPrompt[]> {
  const stranded = strandedPrompts();
  if (!stranded.length) return existing;

  const keys = new Set(existing.map((entry) => entry.key));
  const twins = new Set(existing.map((entry) => `${entry.label} ${entry.text}`));
  const fresh = stranded.filter(
    (entry) => !keys.has(entry.key) && !twins.has(`${entry.label} ${entry.text}`),
  );

  if (!fresh.length) {
    clearStranded();
    return existing;
  }

  try {
    const { prompts } = await post<{ prompts: SavedPrompt[] }>('/api/prompts/save', {
      prompts: fresh.slice(0, MAX_SAVED_PRESETS),
    });
    clearStranded();
    return [...prompts, ...existing];
  } catch {
    return existing;
  }
}

// --- The library -------------------------------------------------------------

/**
 * Built-ins first, in their written order; saved ones after, newest first.
 *
 * A failed request yields the built-ins alone rather than throwing, the posture
 * listEvaluators takes: a picker with five entries is a survivable state, and a
 * bench that refuses to render because the bucket is unreachable is not.
 */
export async function listPresets(): Promise<{ presets: Preset[]; error?: string }> {
  try {
    const { prompts } = await post<{ prompts: SavedPrompt[] }>('/api/prompts/list', {});
    return { presets: merge(await migrate(prompts)) };
  } catch (error) {
    return {
      presets: builtIns,
      error: error instanceof Error ? error.message : 'Could not read the prompt library',
    };
  }
}

/**
 * One preset out of a list already in hand.
 *
 * Takes the list rather than fetching, and that is the point rather than an
 * inconvenience: the prompt box compares what has been typed against the
 * preset's own text on every keystroke, and a version of this that reached the
 * network would make typing a prompt an act of network traffic.
 */
export function findIn(presets: Preset[], key: string): Preset | undefined {
  return presets.find((preset) => preset.key === key);
}

/**
 * Renders a preset, falling back to the first built-in.
 *
 * The fallback is not defensive padding: a saved prompt can be deleted from
 * another machine while a page that remembers it is still open here, and a call
 * is a bad moment to discover it.
 */
export function renderFrom(presets: Preset[], key: string, language: LanguageChoice): string {
  return (findIn(presets, key) ?? presets[0] ?? builtIns[0]).render(language);
}

export async function savePreset(label: string, text: string): Promise<Preset> {
  const name = label.trim().slice(0, MAX_PRESET_NAME);
  if (!name) throw new Error('Give the prompt a name.');
  if (!text.trim()) throw new Error('There is nothing to save.');

  const { prompts } = await post<{ prompts: SavedPrompt[] }>('/api/prompts/save', {
    prompt: { key: newPromptKey(), label: name, text, savedAt: Date.now() },
  });
  rememberPreset(prompts[0].key);
  return toPreset(prompts[0]);
}

/**
 * Writes over a saved prompt in place, keeping its key.
 *
 * Keeping the key is the point: it is what the pages remember as last-used, so
 * an update is not allowed to look like a delete-and-recreate to them.
 */
export async function updatePreset(
  presets: Preset[],
  key: string,
  text: string,
): Promise<Preset | undefined> {
  const existing = findIn(presets, key);
  if (!existing || existing.builtIn) return undefined;

  const { prompts } = await post<{ prompts: SavedPrompt[] }>('/api/prompts/save', {
    prompt: { key, label: existing.label, text, savedAt: Date.now() },
  });
  return toPreset(prompts[0]);
}

/** Removes a saved prompt. Built-in keys are ignored rather than refused. */
export async function deletePreset(key: string): Promise<void> {
  if (!key.startsWith(CUSTOM_PREFIX)) return;
  await post('/api/prompts/delete', { key });
  forgetPreset(key);
}

// --- The pick, which stays in this browser -----------------------------------

/**
 * The preset to open on, checked against what actually exists.
 *
 * The remembered key may name a prompt since deleted — on this browser or
 * another, since the library is shared now — and a call is a bad moment to find
 * out. Falls back to the first built-in, which is always present.
 */
export function lastUsedKey(available: Preset[]): string {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const remembered =
      parsed && typeof parsed === 'object' ? (parsed as { lastUsed?: unknown }).lastUsed : null;
    if (typeof remembered === 'string' && available.some((entry) => entry.key === remembered)) {
      return remembered;
    }
  } catch {
    // Private browsing. The default is the answer.
  }
  return defaultPresetKey();
}

function writeLastUsed(key: string | undefined): void {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const custom =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { custom?: unknown }).custom)
        ? (parsed as { custom: unknown[] }).custom
        : [];
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ custom, lastUsed: key }));
  } catch {
    // Losing the pick costs one dropdown change on the next visit.
  }
}

/** Records a pick. Cheap and frequent; a failure here is not worth reporting. */
export function rememberPreset(key: string): void {
  writeLastUsed(key);
}

/**
 * Drops the pick if it names this key.
 *
 * A deleted prompt must not stay the default. Left alone, lastUsedKey would
 * fall back for the rest of time without the store ever being right.
 */
export function forgetPreset(key: string): void {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const remembered =
      parsed && typeof parsed === 'object' ? (parsed as { lastUsed?: unknown }).lastUsed : null;
    if (remembered === key) writeLastUsed(undefined);
  } catch {
    // Nothing to forget if the store cannot be read.
  }
}
