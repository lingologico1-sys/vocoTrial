/**
 * The provider knobs this rig lets you turn, and the only ones it will.
 *
 * vocoTrial exists to compare realtime models as language tutors, so the
 * settings worth exposing are the ones that change how a *conversation* goes:
 * which voice, how long it waits before deciding you have finished a sentence,
 * how it transcribes a hesitant learner. Knobs that belong to some other use of
 * these APIs — image resolution, video framerate, tool wiring — are omitted on
 * purpose rather than forgotten.
 *
 * The two providers are not symmetric and neither are their models, so every
 * field carries an `applies` predicate keyed on the model rather than just the
 * provider. Sending a field a model does not accept is not harmless: the
 * upstream rejects the whole setup, and the call fails at connect time.
 *
 * One schema drives three things — the panel in the browser, the validation in
 * the Worker, and the translation into each provider's payload — so they cannot
 * drift apart. Same reasoning as models.ts and languages.ts.
 *
 * Deliberately free of DOM imports: functions/ compiles against workers-types.
 */

import { type ModelChoice } from './models';

/**
 * Every value is optional, and absent means *do not send the field at all*.
 *
 * That is the difference between "the user chose the provider's default" and
 * "the user chose the value that happens to be the provider's default today".
 * Only the second should appear in a payload; the first must leave the decision
 * upstream, where it can change without this file lying about it.
 */
export interface SessionSettings {
  /** Prebuilt voice name. The vocabularies are per-provider — see VOICES. */
  voice?: string;
  /** Gemini only. OpenAI's GA realtime session object dropped temperature. */
  temperature?: number;
  maxOutputTokens?: number;

  // --- Turn taking. The setting that matters most to a learner, because the
  // --- provider defaults are tuned for fluent speakers who do not pause to
  // --- assemble a clause, and they cut in mid-sentence.
  /** OpenAI: which detector. Semantic waits for a *complete-sounding* turn. */
  vadMode?: 'server_vad' | 'semantic_vad';
  /** OpenAI server_vad: loudness that counts as speech, 0–1. */
  vadThreshold?: number;
  /**
   * OpenAI semantic_vad: how ready it is to answer. `low` waits longer.
   *
   * An enum, not a number. OpenAI's own two pages disagree — the API reference
   * describes a 0–1 float, the VAD guide quotes literal JSON with these four
   * strings — and the guide is the one showing an actual request body.
   */
  vadEagerness?: 'auto' | 'low' | 'medium' | 'high';
  /** Both: audio kept from before speech was detected. */
  prefixPaddingMs?: number;
  /** Both: silence before the turn is closed. The one to raise for a learner. */
  silenceDurationMs?: number;
  /** Gemini: how readily silence *starts* a turn. */
  startSensitivity?: 'START_SENSITIVITY_HIGH' | 'START_SENSITIVITY_LOW';
  /** Gemini: how readily silence *ends* one. LOW is the patient setting. */
  endSensitivity?: 'END_SENSITIVITY_HIGH' | 'END_SENSITIVITY_LOW';

  // --- OpenAI only.
  /** Playback rate for the agent's own voice. Slower is easier to follow. */
  speed?: number;
  /** Input transcription model. See the note in the field list before changing. */
  transcriptionModel?: string;
  /** Whether to send the language hint and sample to the transcriber. */
  transcriptionHint?: boolean;
  noiseReduction?: 'near_field' | 'far_field';

  // --- Gemini native-audio only.
  /** Model adapts its tone to the speaker's. */
  affectiveDialog?: boolean;
  /** Model may decide a given utterance does not deserve an answer. */
  proactiveAudio?: boolean;
}

export interface SettingOption {
  value: string;
  label: string;
}

interface FieldBase {
  key: keyof SessionSettings;
  label: string;
  /** Shown in the panel. Say what the knob does to a *conversation*. */
  hint?: string;
  /** Which models accept the field. A false here means never send it. */
  applies: (model: ModelChoice) => boolean;
  /** Extra condition on the other settings, e.g. a VAD mode's own sub-fields. */
  requires?: (settings: SessionSettings) => boolean;
}

export type SettingField = FieldBase &
  (
    | {
        kind: 'select';
        options: SettingOption[] | ((model: ModelChoice) => SettingOption[]);
      }
    | { kind: 'number'; min: number; max: number; step: number; unit?: string }
    | { kind: 'toggle' }
  );

const isGemini = (model: ModelChoice) => model.provider === 'gemini';
const isOpenAi = (model: ModelChoice) => model.provider === 'openai';
/**
 * Native audio is its own dialect of Gemini Live: it gains affective dialog and
 * proactivity, and it is the reason no languageCode is sent (see below).
 */
const isNativeAudio = (model: ModelChoice) => model.key === 'gemini-native-audio';

/**
 * NO speechConfig.languageCode, ON EITHER MODEL
 *
 * It is a real field and the half-cascade model does accept it, so its absence
 * is a decision rather than an oversight. Two reasons:
 *
 *  - The native-audio model does not accept it at all; Google documents those
 *    models as choosing the language from the conversation. A knob that breaks
 *    one of the two models offered here is not a knob worth having.
 *  - It takes BCP-47 with a region ("fr-FR"), and languages.ts stores ISO-639-1
 *    ("fr"). There is no safe derivation: the obvious `fr` -> `fr-FR` doubling
 *    is right for a dozen entries and wrong for en, zh, ar, hi, pt and more.
 *    Guessing a region code produces a call that fails at connect.
 *
 * Adding it properly means a `bcp47` field on every LanguageChoice, checked
 * against Google's supported list. Worth doing; not worth guessing.
 */

const VOICES: Record<string, SettingOption[]> = {
  // OpenAI's realtime voices. marin and cedar are the two newest and the ones
  // OpenAI recommends for realtime; marin is this app's long-standing default.
  openai: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'].map(
    (name) => ({ value: name, label: name }),
  ),
  // Gemini's prebuilt Live voices. The full catalogue is longer for the
  // half-cascade model, but these eight are the set both models share.
  gemini: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'].map((name) => ({
    value: name,
    label: name,
  })),
};

export const SETTING_FIELDS: SettingField[] = [
  {
    key: 'voice',
    label: 'Voice',
    kind: 'select',
    applies: () => true,
    options: (model) => VOICES[model.provider] ?? [],
  },
  {
    key: 'speed',
    label: 'Speaking rate',
    hint: 'Slowing the agent down is the cheapest comprehension aid there is.',
    kind: 'number',
    min: 0.6,
    max: 1.4,
    step: 0.05,
    applies: isOpenAi,
  },
  {
    key: 'silenceDurationMs',
    label: 'Silence before replying',
    hint: 'Raise it if the agent cuts in while the learner is still assembling a sentence.',
    kind: 'number',
    min: 200,
    max: 4000,
    step: 100,
    unit: 'ms',
    applies: () => true,
    // OpenAI's semantic detector takes neither this nor the padding below — it
    // decides on meaning, not on a clock — so both vanish when it is selected.
    requires: (settings) => settings.vadMode !== 'semantic_vad',
  },
  {
    key: 'prefixPaddingMs',
    label: 'Audio kept before speech starts',
    hint: 'Guards the first syllable against being clipped off.',
    kind: 'number',
    min: 0,
    max: 1500,
    step: 50,
    unit: 'ms',
    applies: () => true,
    requires: (settings) => settings.vadMode !== 'semantic_vad',
  },
  {
    key: 'vadMode',
    label: 'Turn detection',
    hint: 'Semantic waits for a turn that sounds finished, not merely quiet.',
    kind: 'select',
    applies: isOpenAi,
    options: [
      { value: 'server_vad', label: 'Server VAD (silence)' },
      { value: 'semantic_vad', label: 'Semantic VAD (meaning)' },
    ],
  },
  {
    key: 'vadThreshold',
    label: 'Speech threshold',
    hint: 'Higher ignores more background noise, at the cost of a quiet talker.',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    applies: isOpenAi,
    requires: (settings) => settings.vadMode !== 'semantic_vad',
  },
  {
    key: 'vadEagerness',
    label: 'Eagerness',
    hint: 'Low gives the learner longer to finish the thought.',
    kind: 'select',
    applies: isOpenAi,
    requires: (settings) => settings.vadMode === 'semantic_vad',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'low', label: 'Low — waits longest' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High — answers soonest' },
    ],
  },
  {
    key: 'startSensitivity',
    label: 'Start-of-speech sensitivity',
    kind: 'select',
    applies: isGemini,
    options: [
      { value: 'START_SENSITIVITY_HIGH', label: 'High — starts a turn readily' },
      { value: 'START_SENSITIVITY_LOW', label: 'Low — needs clearer speech' },
    ],
  },
  {
    key: 'endSensitivity',
    label: 'End-of-speech sensitivity',
    hint: 'Low is the patient setting, and the one to try first for a learner.',
    kind: 'select',
    applies: isGemini,
    options: [
      { value: 'END_SENSITIVITY_HIGH', label: 'High — ends a turn readily' },
      { value: 'END_SENSITIVITY_LOW', label: 'Low — waits longer' },
    ],
  },
  {
    key: 'transcriptionModel',
    label: 'Input transcription',
    /**
     * whisper-1 is the default for a reason documented at length in
     * functions/api/session/openai.ts: it transcribes the whole utterance, so
     * the end of a sentence can disambiguate its start, which is exactly where
     * a learner's speech is hardest to read. The streaming models put words on
     * screen sooner and commit to each guess before hearing what follows.
     * The knob exists so that trade can be measured, not so it can be assumed.
     */
    hint: 'whisper-1 waits for the whole utterance and is the most accurate on hesitant speech.',
    kind: 'select',
    applies: isOpenAi,
    options: [
      { value: 'whisper-1', label: 'whisper-1 (batch, most accurate)' },
      { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (streaming)' },
      { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe (streaming)' },
    ],
  },
  {
    key: 'transcriptionHint',
    label: 'Send the language hint',
    hint: 'Stops the transcriber hedging between languages. Turn off to see it guess.',
    kind: 'toggle',
    applies: isOpenAi,
  },
  {
    key: 'noiseReduction',
    label: 'Noise reduction',
    kind: 'select',
    applies: isOpenAi,
    options: [
      { value: 'near_field', label: 'Near field (headset)' },
      { value: 'far_field', label: 'Far field (laptop mic)' },
    ],
  },
  {
    key: 'temperature',
    label: 'Temperature',
    hint: "Gemini only — OpenAI's GA realtime session object no longer takes one.",
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    applies: isGemini,
  },
  {
    key: 'maxOutputTokens',
    label: 'Max output tokens',
    hint: 'A hard stop on a rambling turn. Audio tokens count, so keep it generous.',
    kind: 'number',
    min: 64,
    max: 8192,
    step: 64,
    applies: () => true,
  },
  {
    key: 'affectiveDialog',
    label: 'Affective dialogue',
    hint: 'Native audio only. The model matches the tone it hears.',
    kind: 'toggle',
    applies: isNativeAudio,
  },
  {
    key: 'proactiveAudio',
    label: 'Proactive audio',
    hint: 'Native audio only. Lets the model stay silent when nothing needs saying.',
    kind: 'toggle',
    applies: isNativeAudio,
  },
];

/** What the panel shows for a given model, in order. */
export function fieldsFor(model: ModelChoice): SettingField[] {
  return SETTING_FIELDS.filter((field) => field.applies(model));
}

export function optionsFor(field: SettingField, model: ModelChoice): SettingOption[] {
  if (field.kind !== 'select') return [];
  return typeof field.options === 'function' ? field.options(model) : field.options;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reduces whatever the client sent to a payload this model will actually accept.
 *
 * Runs in the Worker, on the far side of the network, so it treats the input as
 * unknown even though our own page is what usually produces it. Numbers are
 * clamped rather than rejected and unrecognised keys are dropped, because the
 * failure this prevents is a 400 from the provider halfway through connecting,
 * where the user has no idea which of a dozen knobs was at fault.
 */
export function sanitizeSettings(raw: unknown, model: ModelChoice): SessionSettings {
  const input: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};

  for (const field of SETTING_FIELDS) {
    if (!field.applies(model)) continue;

    const value = input[field.key];
    // Absent, or the panel's "provider default" — leave the field unsent.
    if (value === undefined || value === null || value === '') continue;

    if (field.kind === 'toggle') {
      if (typeof value === 'boolean') out[field.key] = value;
      continue;
    }

    if (field.kind === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) continue;
      // Integers where the unit is discrete; the step tells us which those are.
      const rounded = Number.isInteger(field.step) ? Math.round(numeric) : numeric;
      out[field.key] = clamp(rounded, field.min, field.max);
      continue;
    }

    if (typeof value !== 'string') continue;
    if (optionsFor(field, model).some((option) => option.value === value)) {
      out[field.key] = value;
    }
  }

  // Second pass: a sub-field is only meaningful once the field it hangs off has
  // been resolved, so `requires` is checked against the sanitised result.
  const settings = out as SessionSettings;
  for (const field of SETTING_FIELDS) {
    if (field.requires && !field.requires(settings)) delete out[field.key];
  }

  return settings;
}
