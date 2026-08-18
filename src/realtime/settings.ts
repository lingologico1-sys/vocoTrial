/**
 * The Gemini Live knobs this rig lets you turn, and the only ones it will.
 *
 * vocoTrial exists to compare realtime models as language tutors, so the
 * settings worth exposing are the ones that change how a *conversation* goes:
 * which voice, and how long it waits before deciding you have finished a
 * sentence. Knobs that belong to some other use of the API — image resolution,
 * video framerate, tool wiring — are omitted on purpose rather than forgotten.
 *
 * Google's two Live models are not symmetric, so every field carries an
 * `applies` predicate keyed on the model. Sending a field a model does not
 * accept is not harmless: the upstream rejects the whole setup, and the call
 * fails at connect time.
 *
 * This table used to be twice the size, because it also carried OpenAI
 * Realtime's knobs — speaking rate, the two VAD detectors and their sub-fields,
 * the input transcription model and its language hint, noise reduction. That
 * provider is gone and so are they. What survives is either shared by both
 * Gemini models or gated to native audio.
 *
 * One schema drives three things — the panel in the browser, the validation in
 * the Worker, and the translation into the setup frame — so they cannot drift
 * apart. Same reasoning as models.ts and languages.ts.
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
  /** Prebuilt voice name. See VOICES. */
  voice?: string;
  temperature?: number;
  maxOutputTokens?: number;

  // --- Turn taking. The setting that matters most to a learner, because the
  // --- provider defaults are tuned for fluent speakers who do not pause to
  // --- assemble a clause, and they cut in mid-sentence.
  /** Audio kept from before speech was detected. */
  prefixPaddingMs?: number;
  /** Silence before the turn is closed. The one to raise for a learner. */
  silenceDurationMs?: number;
  /** How readily silence *starts* a turn. */
  startSensitivity?: 'START_SENSITIVITY_HIGH' | 'START_SENSITIVITY_LOW';
  /** How readily silence *ends* one. LOW is the patient setting. */
  endSensitivity?: 'END_SENSITIVITY_HIGH' | 'END_SENSITIVITY_LOW';

  // --- Native-audio only.
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
}

export type SettingField = FieldBase &
  (
    /**
     * The options used to be resolvable from the model, because the voice
     * vocabularies were per-provider and nothing else could express that. One
     * provider, one vocabulary — so a plain list says everything it needs to.
     */
    | { kind: 'select'; options: SettingOption[] }
    | { kind: 'number'; min: number; max: number; step: number; unit?: string }
    | { kind: 'toggle' }
  );

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

/**
 * Gemini's prebuilt Live voices. The full catalogue is longer for the
 * half-cascade model, but these eight are the set both models share — and a
 * voice one model does not carry fails the setup rather than falling back.
 *
 * Exported because liveTrial offers the voice on its own, outside the settings
 * panel: that page spends its screen on the character rather than on the knobs,
 * and which voice the character has is part of the character.
 *
 * WHERE THE (m)/(f) COMES FROM
 *
 * Not from Google. The docs give each voice an adjective — Puck is "upbeat",
 * Charon "informative", Kore "firm", Aoede "breezy" — and no gender field, on
 * either surface, in any response. So the letters here are what the voices
 * sound like, agreed across every third-party listing that bothers to say and
 * confirmed by ear, and they are a hint to whoever is picking rather than a
 * property the API will ever confirm.
 *
 * Worth having anyway, because it is the first thing anybody wants to know and
 * the names give nothing away: seven of the eight are Greek or Norse figures
 * most people have not met, and the eighth is misleading — Zephyr was a wind
 * god and the voice is a woman's. Guessing from mythology gets that one wrong.
 *
 * The letter lives in the label and never in the value: the wire carries the
 * bare name, so a re-lettering here cannot invalidate a saved pick.
 */
const VOICE_NAMES: Array<[name: string, sex: 'm' | 'f']> = [
  ['Puck', 'm'],
  ['Charon', 'm'],
  ['Kore', 'f'],
  ['Fenrir', 'm'],
  ['Aoede', 'f'],
  ['Leda', 'f'],
  ['Orus', 'm'],
  ['Zephyr', 'f'],
];

export const VOICES: SettingOption[] = VOICE_NAMES.map(([name, sex]) => ({
  value: name,
  label: `${name} (${sex})`,
}));

export const SETTING_FIELDS: SettingField[] = [
  {
    key: 'voice',
    label: 'Voice',
    kind: 'select',
    applies: () => true,
    options: VOICES,
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
  },
  {
    key: 'startSensitivity',
    label: 'Start-of-speech sensitivity',
    kind: 'select',
    applies: () => true,
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
    applies: () => true,
    options: [
      { value: 'END_SENSITIVITY_HIGH', label: 'High — ends a turn readily' },
      { value: 'END_SENSITIVITY_LOW', label: 'Low — waits longer' },
    ],
  },
  {
    key: 'temperature',
    label: 'Temperature',
    hint: 'Lower keeps the tutor on the prompt; higher lets it improvise.',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    applies: () => true,
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

export function optionsFor(field: SettingField): SettingOption[] {
  return field.kind === 'select' ? field.options : [];
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
    // Absent, or the panel's "Google default" — leave the field unsent.
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
    if (optionsFor(field).some((option) => option.value === value)) {
      out[field.key] = value;
    }
  }

  return out as SessionSettings;
}
