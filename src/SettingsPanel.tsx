import { INSTRUCTION_PRESETS, MAX_INSTRUCTIONS } from './realtime/instructions';
import {
  fieldsFor,
  optionsFor,
  type SessionSettings,
  type SettingField,
} from './realtime/settings';
import type { ModelChoice } from './realtime/models';

/**
 * The prompt and the provider knobs, for the call you are about to place.
 *
 * Everything here is rendered from the schema in realtime/settings.ts rather
 * than written out by hand, so a field added there appears in the panel, is
 * validated in the Worker and reaches the provider without three separate
 * edits. Which fields appear depends on the *model*, not just the provider:
 * native audio takes knobs the half-cascade model rejects outright, and a
 * rejected field fails the whole call at connect.
 *
 * Unset means "leave it to the provider", and that is a real third state, not a
 * synonym for whatever the default happens to be today. So every control offers
 * it explicitly and an untouched control sends no field at all — including the
 * toggles, which is why they are three-way selects rather than checkboxes.
 */

interface Props {
  model: ModelChoice;
  disabled: boolean;
  presetKey: string;
  onPreset: (key: string) => void;
  instructions: string;
  onInstructions: (text: string) => void;
  /** True once the prompt stops tracking the preset, which unlocks Reset. */
  edited: boolean;
  onResetInstructions: () => void;
  settings: SessionSettings;
  onSettings: (next: SessionSettings) => void;
}

const SELECT_CLASS =
  'rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-200 outline-none disabled:opacity-40';

/** The panel's own vocabulary for "send no value for this field". */
const UNSET = '';

function Field({
  field,
  model,
  value,
  disabled,
  onChange,
}: {
  field: SettingField;
  model: ModelChoice;
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
        <option value={UNSET}>Provider default</option>
        {field.kind === 'toggle' ? (
          <>
            <option value="true">On</option>
            <option value="false">Off</option>
          </>
        ) : (
          optionsFor(field, model).map((option) => (
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
  presetKey,
  onPreset,
  instructions,
  onInstructions,
  edited,
  onResetInstructions,
  settings,
  onSettings,
}: Props) {
  // `requires` is what hides a sub-knob whose parent rules it out — OpenAI's
  // semantic detector takes no silence duration, so showing one would invite
  // someone to tune a number that is never sent.
  const fields = fieldsFor(model).filter((field) => !field.requires || field.requires(settings));

  const changed = Object.values(settings).filter((value) => value !== undefined).length;
  const preset = INSTRUCTION_PRESETS.find((option) => option.key === presetKey);
  const overLimit = instructions.length > MAX_INSTRUCTIONS;

  const set = (key: keyof SessionSettings, value: SessionSettings[keyof SessionSettings]) => {
    const next = { ...settings, [key]: value };
    if (value === undefined) delete next[key];
    onSettings(next);
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
          <select
            value={presetKey}
            disabled={disabled}
            onChange={(event) => onPreset(event.target.value)}
            className={SELECT_CLASS}
          >
            {INSTRUCTION_PRESETS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
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

        <div className="flex items-center justify-between text-xs">
          <span className={overLimit ? 'text-rose-400' : 'text-slate-600'}>
            {instructions.length} / {MAX_INSTRUCTIONS}
          </span>
          {edited && (
            <button
              type="button"
              onClick={onResetInstructions}
              disabled={disabled}
              className="text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline disabled:opacity-40"
            >
              Reset to preset
            </button>
          )}
        </div>

        {/*
          The prompt tracks the language picker until it is edited, at which
          point it stops — silently rewriting someone's prompt because they
          switched language would be worse than letting it go stale.
        */}
        {edited && (
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
              className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline disabled:opacity-40"
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
              model={model}
              value={settings[field.key]}
              disabled={disabled}
              onChange={(next) => set(field.key, next)}
            />
          ))}
        </div>

        {/*
          Settings are kept across a model switch rather than cleared, because
          comparing two models on the same turn-taking numbers is the point.
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
