import { useState } from 'react';
import { MAX_INSTRUCTIONS } from '../realtime/instructions';
import { MAX_PRESET_NAME, type Preset } from '../realtime/presets';
import {
  fieldsFor,
  optionsFor,
  type SessionSettings,
  type SettingField,
} from '../realtime/settings';
import type { ModelChoice } from '../realtime/models';

/**
 * The prompt and the Gemini knobs, for the call you are about to place.
 *
 * The knobs are rendered from the schema in realtime/settings.ts rather than
 * written out by hand, so a field added there appears in the panel, is
 * validated in the Worker and reaches Google without three separate edits.
 * Which fields appear depends on the *model*: native audio takes knobs the
 * half-cascade model rejects outright, and a rejected field fails the whole
 * call at connect.
 *
 * Unset means "leave it to Google", and that is a real third state, not a
 * synonym for whatever the default happens to be today. So every control offers
 * it explicitly and an untouched control sends no field at all — including the
 * toggles, which is why they are three-way selects rather than checkboxes.
 *
 * The prompt half is the other kind of control entirely: the presets are a list
 * you can add to and delete from, so this panel owns a small amount of editing
 * state (the name box) that the rest of it does not need.
 */

interface Props {
  model: ModelChoice;
  disabled: boolean;
  presets: Preset[];
  presetKey: string;
  onPreset: (key: string) => void;
  instructions: string;
  onInstructions: (text: string) => void;
  /** True once the prompt stops tracking the preset, which unlocks Reset. */
  edited: boolean;
  onResetInstructions: () => void;
  /**
   * Saves the textarea's contents as a new preset under this name, reporting
   * whether it took. False keeps the name box open over the error rather than
   * making the user retype a name they already gave.
   */
  onSavePreset: (label: string) => boolean;
  /** Writes the textarea over the selected saved preset. */
  onUpdatePreset: () => void;
  onDeletePreset: () => void;
  settings: SessionSettings;
  onSettings: (next: SessionSettings) => void;
}

const SELECT_CLASS =
  'rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-200 outline-none disabled:opacity-40';

const ACTION_CLASS =
  'text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline disabled:opacity-40 disabled:no-underline disabled:hover:text-slate-500';

/** The panel's own vocabulary for "send no value for this field". */
const UNSET = '';

function Field({
  field,
  value,
  disabled,
  onChange,
}: {
  field: SettingField;
  value: SessionSettings[keyof SessionSettings];
  disabled: boolean;
  onChange: (next: SessionSettings[keyof SessionSettings]) => void;
}) {
  const control =
    field.kind === 'number' ? (
      <input
        type="number"
        // An empty box is the unset state, which is why this is a number input
        // and not a slider: a slider has no position that means "unset", and
        // parking the handle at the midpoint to stand for one would be a lie.
        value={value === undefined ? '' : String(value)}
        placeholder="default"
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
        className={`${SELECT_CLASS} w-28 text-right`}
      />
    ) : (
      <select
        value={value === undefined ? UNSET : String(value)}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === UNSET) return onChange(undefined);
          onChange(field.kind === 'toggle' ? raw === 'true' : raw);
        }}
        className={SELECT_CLASS}
      >
        <option value={UNSET}>Google default</option>
        {field.kind === 'toggle' ? (
          <>
            <option value="true">On</option>
            <option value="false">Off</option>
          </>
        ) : (
          optionsFor(field).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))
        )}
      </select>
    );

  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm text-slate-300">
          {field.label}
          {field.kind === 'number' && field.unit ? (
            <span className="text-slate-600"> ({field.unit})</span>
          ) : null}
        </div>
        {field.hint && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{field.hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export default function SettingsPanel({
  model,
  disabled,
  presets,
  presetKey,
  onPreset,
  instructions,
  onInstructions,
  edited,
  onResetInstructions,
  onSavePreset,
  onUpdatePreset,
  onDeletePreset,
  settings,
  onSettings,
}: Props) {
  /**
   * The name box, open or shut. Null is shut — distinct from an empty string,
   * which is a box that is open and has not been typed into yet.
   */
  const [naming, setNaming] = useState<string | null>(null);

  const fields = fieldsFor(model);

  const changed = Object.values(settings).filter((value) => value !== undefined).length;
  const preset = presets.find((option) => option.key === presetKey);
  const overLimit = instructions.length > MAX_INSTRUCTIONS;
  const saved = presets.filter((option) => !option.builtIn);
  const editingSaved = preset !== undefined && !preset.builtIn;

  const set = (key: keyof SessionSettings, value: SessionSettings[keyof SessionSettings]) => {
    const next = { ...settings, [key]: value };
    if (value === undefined) delete next[key];
    onSettings(next);
  };

  const commitName = () => {
    if (naming === null) return;
    if (onSavePreset(naming)) setNaming(null);
  };

  return (
    <details className="rounded-lg border border-slate-800">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500 hover:text-slate-400">
        Instructions &amp; settings
        <span className="ml-2 normal-case tracking-normal text-slate-600">
          {preset?.label ?? 'Custom'}
          {edited && ' (edited)'}
          {changed > 0 && ` · ${changed} changed`}
        </span>
      </summary>

      <div className="border-t border-slate-800 px-4 py-3">
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
            onChange={(event) => onPreset(event.target.value)}
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
          onChange={(event) => onInstructions(event.target.value)}
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
                onClick={onResetInstructions}
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
                onClick={onUpdatePreset}
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
                  : 'Keeps the text above as a preset of your own, in this browser'
              }
              className={ACTION_CLASS}
            >
              Save as new
            </button>

            {editingSaved && (
              <button
                type="button"
                onClick={onDeletePreset}
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
                  commitName();
                }
                if (event.key === 'Escape') setNaming(null);
              }}
              className={`${SELECT_CLASS} min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={commitName}
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

        <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            {model.label}
          </span>
          {changed > 0 && (
            <button
              type="button"
              onClick={() => onSettings({})}
              disabled={disabled}
              className={ACTION_CLASS}
            >
              Reset all
            </button>
          )}
        </div>

        <div className="divide-y divide-slate-800/60">
          {fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={settings[field.key]}
              disabled={disabled}
              onChange={(next) => set(field.key, next)}
            />
          ))}
        </div>

        {/*
          Settings are kept across a model switch rather than cleared, because
          comparing the two models on the same turn-taking numbers is the point.
          Anything the other model does not accept is dropped in the Worker.
        */}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          Kept when you switch model. Whatever this one does not accept is dropped
          server-side rather than sent.
        </p>
      </div>
    </details>
  );
}
