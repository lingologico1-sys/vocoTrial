import {
  optionsFor,
  type SessionSettings,
  type SettingField,
} from './realtime/settings';
import { SELECT_CLASS } from './controls';

/**
 * The Gemini knobs, rendered from the schema rather than written out by hand.
 *
 * A field added to SETTING_FIELDS appears here, is validated in the Worker and
 * reaches Google without three separate edits. Which fields appear is the
 * caller's decision — it passes the list — because the two pages that mount
 * this want different slices of it: the bench shows everything the chosen model
 * accepts, and studio shows everything except the voice, which has its own
 * picker up beside the face.
 *
 * UNSET IS A REAL THIRD STATE, not a synonym for whatever the default happens
 * to be today. So every control offers it explicitly and an untouched control
 * sends no field at all — including the toggles, which is why they are
 * three-way selects rather than checkboxes. See settings.ts.
 */

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

export default function SettingsFields({
  fields,
  settings,
  onSettings,
  disabled,
}: {
  fields: SettingField[];
  settings: SessionSettings;
  onSettings: (next: SessionSettings) => void;
  disabled: boolean;
}) {
  // Deleting rather than assigning undefined: the payload is built by spreading
  // this object, and a key present with an undefined value is a key that gets
  // sent. See SessionSettings on why that difference is the whole point.
  const set = (key: keyof SessionSettings, value: SessionSettings[keyof SessionSettings]) => {
    const next = { ...settings, [key]: value };
    if (value === undefined) delete next[key];
    onSettings(next);
  };

  return (
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
  );
}
