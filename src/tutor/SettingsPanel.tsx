import { MAX_INSTRUCTIONS } from '../realtime/instructions';
import PromptEditor from '../PromptEditor';
import SettingsFields from '../SettingsFields';
import { ACTION_CLASS } from '../controls';
import { fieldsFor, type SessionSettings } from '../realtime/settings';
import type { PromptLibrary } from '../realtime/usePromptLibrary';
import type { ModelChoice } from '../realtime/models';

/**
 * The prompt and the Gemini knobs, for the call you are about to place.
 *
 * BOTH HALVES ARE MOUNTED RATHER THAN WRITTEN HERE NOW. The prompt half became
 * PromptEditor over usePromptLibrary when studio needed the same editor — it
 * publishes what this page writes, and could only pick — and the knobs became
 * SettingsFields when studio needed to publish those too. What is left in this
 * file is what is genuinely the bench's: the summary line, the reset, and the
 * fact that the two halves fold away together behind one summary.
 *
 * Which knobs appear depends on the *model*: native audio takes fields the
 * half-cascade model rejects outright, and a rejected field fails the whole
 * call at connect. See settings.ts.
 */

interface Props {
  model: ModelChoice;
  disabled: boolean;
  library: PromptLibrary;
  settings: SessionSettings;
  onSettings: (next: SessionSettings) => void;
}

export default function SettingsPanel({
  model,
  disabled,
  library,
  settings,
  onSettings,
}: Props) {
  // `settings` is passed so a field whose `requires` is unmet drops out of the
  // panel — the OpenAI VAD sub-fields, which belong to one detector or the
  // other and never to both.
  const fields = fieldsFor(model, settings);

  const changed = Object.values(settings).filter((value) => value !== undefined).length;
  const preset = library.presets.find((option) => option.key === library.presetKey);

  return (
    <details className="rounded-lg border border-slate-800">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500 hover:text-slate-400">
        Instructions &amp; settings
        <span className="ml-2 normal-case tracking-normal text-slate-600">
          {preset?.label ?? 'Custom'}
          {library.edited && ' (edited)'}
          {changed > 0 && ` · ${changed} changed`}
        </span>
      </summary>

      <div className="border-t border-slate-800 px-4 py-3">
        <PromptEditor library={library} disabled={disabled} />

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

        <SettingsFields
          fields={fields}
          model={model}
          settings={settings}
          onSettings={onSettings}
          disabled={disabled}
        />

        {/*
          Settings are kept across a model switch rather than cleared, because
          comparing the two models on the same turn-taking numbers is the point.
          Anything the other model does not accept is dropped in the Worker.
        */}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          Kept when you switch model. Whatever this one does not accept is dropped
          server-side rather than sent. A prompt is limited to {MAX_INSTRUCTIONS} characters.
        </p>
      </div>
    </details>
  );
}
