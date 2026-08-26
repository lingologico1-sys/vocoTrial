import { useCallback, useEffect, useState } from 'react';
import type { LanguageChoice } from './languages';
import {
  builtInPresets,
  deletePreset,
  findIn,
  lastUsedKey,
  listPresets,
  rememberPreset,
  renderFrom,
  savePreset,
  updatePreset,
  type Preset,
} from './presets';

/**
 * The shared prompt library, as a page holds it: the list, the pick, the text
 * in the box, and every way of changing them.
 *
 * WHY A HOOK. The library moved to R2 so that a prompt written on the bench
 * could be published as a manner from studio, on another machine. That made the
 * two pages equals over one store, but only one of them could write: studio had
 * a picker and no textarea, and its own over-length warning told you to go and
 * shorten the prompt somewhere else. Giving studio the editor meant either
 * copying eighty lines of pick-render-track-save into it — which is how two
 * pages over one store start disagreeing about what "edited" means — or lifting
 * them out once. This is the lift. PromptEditor is its face.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN is the scratch copy. Both pages cache the
 * in-progress text in their own prefs under their own key, because a half-typed
 * prompt belongs to the tab it was typed in; the hook takes what they restored
 * as `initial` and hands back what they should store. The *pick* is the other
 * way round — `rememberPreset` is one shared key, so choosing a prompt on one
 * page is what the other opens on.
 *
 * Browser-only, like presets.ts underneath it: nothing server-side may import
 * either. The pure schema is savedPrompts.ts.
 */

export interface PromptLibrary {
  presets: Preset[];
  presetKey: string;
  /** The text in the box, which is what a page should spend. */
  instructions: string;
  /** True once the text stops tracking the preset. Unlocks Revert and Update. */
  edited: boolean;
  /** Whether the shared library has answered. See the language effect below. */
  loaded: boolean;
  /** Why a save or a delete could not be done, or null. */
  error: string | null;
  choose: (key: string) => void;
  write: (text: string) => void;
  reset: () => void;
  saveAs: (label: string) => Promise<boolean>;
  update: () => void;
  remove: () => void;
}

export interface PromptLibraryOptions {
  /** What a built-in renders against. An edited prompt stops following it. */
  language: LanguageChoice;
  /**
   * The scratch copy the page restored, if it kept one.
   *
   * `presetKey` is compared rather than trusted: if it disagrees with the
   * remembered pick, a pick was made on the other page since this was written
   * and the text belongs to a prompt that is no longer selected. Showing it
   * under the wrong name is worse than dropping it.
   */
  initial?: { presetKey?: string; instructions?: string; edited?: boolean };
}

export function usePromptLibrary({ language, initial }: PromptLibraryOptions): PromptLibrary {
  /**
   * The first paint has only the built-ins, which is the price of the prompts
   * living in R2: five compile into the bundle and the rest are a request away.
   * The scratch copy covers the gap for the case that matters — a reload
   * mid-edit — so an opening on a saved prompt shows the right words
   * immediately and gets its label back when the list lands.
   */
  const [presets, setPresets] = useState(builtInPresets);
  const [presetKey, setPresetKey] = useState(
    () => initial?.presetKey ?? lastUsedKey(builtInPresets()),
  );
  const [opened] = useState(() => {
    const key = initial?.presetKey ?? lastUsedKey(builtInPresets());
    if (initial?.presetKey === key && initial.instructions !== undefined) {
      return { instructions: initial.instructions, edited: initial.edited ?? false };
    }
    return { instructions: renderFrom(builtInPresets(), key, language), edited: false };
  });
  const [instructions, setInstructions] = useState(opened.instructions);
  const [edited, setEdited] = useState(opened.edited);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A preset's text, rendered from the list already in memory.
   *
   * Not re-read from the store, and the difference is not stylistic: this runs
   * on *every keystroke* in the prompt box — see `write`, which re-renders the
   * preset to work out whether what has been typed still matches it.
   */
  const renderPreset = useCallback(
    (key: string, choice: LanguageChoice) => renderFrom(presets, key, choice),
    [presets],
  );

  /**
   * The library, at mount and again whenever the tab is looked at.
   *
   * A failure leaves the five built-ins in the picker and reports beside it
   * rather than blocking the page: a page that will not render because a bucket
   * is unreachable is worse than one with a shorter dropdown.
   *
   * THE FOCUS LISTENER IS WHAT MAKES THE TWO PAGES FEEL LIKE ONE LIBRARY.
   * Studio grew it first, for its own case — publishing a manner from a prompt
   * written a minute ago on the bench should not need a reload — and it is here
   * now because the case runs the other way too: a prompt saved on studio is a
   * prompt the bench should be able to dial without one. Only the list and the
   * pick are re-resolved; the text in the box is never touched, so this cannot
   * arrive on top of something half-typed.
   *
   * The pick is re-resolved against what came back, because the key held since
   * first paint may name a prompt deleted from another machine.
   */
  useEffect(() => {
    let alive = true;
    const load = () => {
      void listPresets().then(({ presets: found, error: failed }) => {
        if (!alive) return;
        setPresets(found);
        setPresetKey((current) => (findIn(found, current) ? current : lastUsedKey(found)));
        setError(failed ?? null);
        setLoaded(true);
      });
    };

    load();
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
    };
  }, []);

  /**
   * An untouched prompt follows the language picker; an edited one does not.
   *
   * Rewriting someone's own words because they switched from French to Italian
   * would lose work, so the tracking stops the moment they type. Editing it
   * back to the preset's exact text starts it again — see `write`.
   *
   * Gated on `loaded`, which would otherwise run at first paint against a list
   * holding only the built-ins and overwrite a restored prompt with whichever
   * built-in the fallback landed on.
   */
  useEffect(() => {
    if (!loaded || edited) return;
    setInstructions(renderPreset(presetKey, language));
  }, [loaded, presetKey, language, edited, renderPreset]);

  /** Picking a preset replaces the prompt outright — that is what picking means. */
  const choose = useCallback(
    (key: string) => {
      setPresetKey(key);
      setEdited(false);
      setInstructions(renderPreset(key, language));
      setError(null);
      // What makes it the one both pages open on next time.
      rememberPreset(key);
    },
    [renderPreset, language],
  );

  const write = useCallback(
    (text: string) => {
      setInstructions(text);
      // Typing it back to the preset's exact text puts it under tracking again.
      setEdited(text !== renderPreset(presetKey, language));
    },
    [renderPreset, presetKey, language],
  );

  const reset = useCallback(() => {
    setEdited(false);
    setInstructions(renderPreset(presetKey, language));
  }, [renderPreset, presetKey, language]);

  /**
   * Runs a change to the shared library and re-reads the list from it.
   *
   * Re-reading rather than patching the array in place: the library is the
   * thing both pages and both machines share, and a list assembled here from
   * what we *think* happened would be the copy that drifts. It costs a round
   * trip on a save, which is a button press rather than a keystroke.
   *
   * The re-read happens whether or not the change succeeded, because a failed
   * save is one of the ways to discover that somebody else changed the library
   * underneath this tab.
   */
  const withPresets = useCallback(async (change: () => Promise<void>): Promise<boolean> => {
    let ok = true;
    try {
      await change();
      setError(null);
    } catch (failed) {
      ok = false;
      setError(failed instanceof Error ? failed.message : 'Could not save the prompt');
    }
    const { presets: found, error: listed } = await listPresets();
    setPresets(found);
    if (listed) setError(listed);
    return ok;
  }, []);

  /** Keeps the text in the box as a preset of its own, and selects it. */
  const saveAs = useCallback(
    (label: string): Promise<boolean> =>
      withPresets(async () => {
        // savePreset records the new key as the last-used one itself, so there
        // is no rememberPreset call to pair with this the way choose has.
        const created = await savePreset(label, instructions);
        setPresetKey(created.key);
        // Saved *is* the preset now, so there is nothing left to be edited from.
        setEdited(false);
      }),
    [withPresets, instructions],
  );

  /** Writes the box over the selected saved preset, keeping its name and key. */
  const update = useCallback(() => {
    void withPresets(async () => {
      await updatePreset(presets, presetKey, instructions);
      setEdited(false);
    });
  }, [withPresets, presets, presetKey, instructions]);

  /**
   * Deletes the selected saved preset and falls back to the built-in default.
   *
   * Confirmed first, and worth the interruption: this is text somebody wrote,
   * the library keeps no history, the button sits one row from Save — and it
   * deletes on every machine rather than only this one.
   */
  const remove = useCallback(() => {
    const preset = findIn(presets, presetKey);
    if (!preset || preset.builtIn) return;
    if (
      !window.confirm(
        `Delete the saved prompt “${preset.label}”? It goes from the shared library, on every machine, and this cannot be undone.`,
      )
    ) {
      return;
    }

    void withPresets(async () => {
      await deletePreset(presetKey);
      // deletePreset drops the remembered pick with it, so this resolves to the
      // default built-in — which is in the bundle and cannot itself be gone.
      choose(lastUsedKey(builtInPresets()));
    });
  }, [withPresets, presets, presetKey, choose]);

  return {
    presets,
    presetKey,
    instructions,
    edited,
    loaded,
    error,
    choose,
    write,
    reset,
    saveAs,
    update,
    remove,
  };
}
