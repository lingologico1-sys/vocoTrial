import { useState } from 'react';
import { MAX_INSTRUCTIONS } from './realtime/instructions';
import { MAX_PRESET_NAME } from './realtime/presets';
import { SELECT_CLASS, ACTION_CLASS } from './controls';
import type { PromptLibrary } from './realtime/usePromptLibrary';

/**
 * The prompt, and the library it is picked out of.
 *
 * MOUNTED ON BOTH PAGES THAT SPEND A PROMPT, which is why it is here rather
 * than inside tutorBench's settings panel where it started. Studio used to
 * offer a picker and no textarea, so the only way to shorten an over-long
 * prompt it was about to publish as a manner was to leave for the bench and
 * come back — and studio's own warning said exactly that, which is a page
 * admitting it is missing a control. Both pages write the same R2 library, so
 * one editor over one hook is what that always should have been.
 *
 * WHAT IS NOT SHARED is what the two pages do with the text afterwards: the
 * bench dials it, studio publishes it under a name. Neither belongs in here.
 *
 * The name box is this component's own state — the small amount of editing
 * state a list you can add to and delete from needs, and nothing above it does.
 */

interface Props {
  library: PromptLibrary;
  disabled: boolean;
}

export default function PromptEditor({ library, disabled }: Props) {
  const {
    presets,
    presetKey,
    instructions,
    edited,
    choose,
    write,
    reset,
    saveAs,
    update,
    remove,
  } = library;

  /**
   * The name box, open or shut. Null is shut — distinct from an empty string,
   * which is a box that is open and has not been typed into yet.
   */
  const [naming, setNaming] = useState<string | null>(null);

  const preset = presets.find((option) => option.key === presetKey);
  const overLimit = instructions.length > MAX_INSTRUCTIONS;
  const saved = presets.filter((option) => !option.builtIn);
  const editingSaved = preset !== undefined && !preset.builtIn;

  const commitName = async () => {
    if (naming === null) return;
    // The library is in R2 now, so this is a round trip rather than a write to
    // this browser. Still reported the same way: false keeps the name box open
    // over the error rather than making somebody retype a name they gave.
    if (await saveAs(naming)) setNaming(null);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">Prompt</span>
        {/*
          Two groups rather than one flat list, because the two halves behave
          differently — a built-in follows the language picker and cannot be
          deleted, a saved one is fixed text and can. Nothing in a dropdown
          row itself can carry that, so the grouping is doing the work.
        */}
        <select
          value={presetKey}
          disabled={disabled}
          onChange={(event) => choose(event.target.value)}
          className={SELECT_CLASS}
        >
          <optgroup label="Built in">
            {presets
              .filter((option) => option.builtIn)
              .map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="Saved">
              {saved.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {preset && <p className="mt-1 text-xs text-slate-600">{preset.blurb}</p>}

      <textarea
        value={instructions}
        disabled={disabled}
        onChange={(event) => write(event.target.value)}
        rows={10}
        spellCheck={false}
        className="mt-2 w-full resize-y rounded-md border border-slate-800 bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-slate-700 disabled:opacity-40"
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span className={overLimit ? 'text-rose-400' : 'text-slate-600'}>
          {instructions.length} / {MAX_INSTRUCTIONS}
        </span>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {edited && (
            <button
              type="button"
              onClick={reset}
              disabled={disabled}
              title={
                editingSaved
                  ? 'Puts back the text this preset was saved with'
                  : 'Puts back the built-in wording, in the language selected above'
              }
              className={ACTION_CLASS}
            >
              Revert
            </button>
          )}

          {/*
            Only for a saved preset that has been changed. Updating a built-in
            is not a missing feature — they are rendered from code, and the
            way to keep a change to one is to save it as your own.
          */}
          {editingSaved && edited && (
            <button
              type="button"
              onClick={update}
              disabled={disabled}
              title={`Writes this text over “${preset.label}”`}
              className={ACTION_CLASS}
            >
              Update
            </button>
          )}

          <button
            type="button"
            onClick={() => setNaming(naming === null ? '' : null)}
            disabled={disabled || overLimit || !instructions.trim()}
            title={
              overLimit
                ? 'Too long to save'
                : 'Keeps the text above in the shared library, on every machine'
            }
            className={ACTION_CLASS}
          >
            Save as new
          </button>

          {editingSaved && (
            <button
              type="button"
              onClick={remove}
              disabled={disabled}
              className="text-rose-500/80 underline-offset-2 hover:text-rose-400 hover:underline disabled:opacity-40"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {naming !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            autoFocus
            value={naming}
            maxLength={MAX_PRESET_NAME}
            placeholder="Name this prompt"
            onChange={(event) => setNaming(event.target.value)}
            // Enter saves and Escape backs out, because a two-field row that
            // only answers the mouse is the kind that gets abandoned half-done.
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitName();
              }
              if (event.key === 'Escape') setNaming(null);
            }}
            className={`${SELECT_CLASS} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => void commitName()}
            disabled={!naming.trim()}
            className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setNaming(null)}
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      {/*
        The prompt tracks the language picker until it is edited, at which
        point it stops — silently rewriting someone's prompt because they
        switched language would be worse than letting it go stale. A saved
        preset never tracked it in the first place; see presets.ts.
      */}
      {edited && preset?.builtIn && (
        <p className="mt-1 text-xs text-slate-600">
          Edited, so it no longer follows the language picker.
        </p>
      )}

    </>
  );
}
