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

/**
 * The knobs a published lesson carries: every session setting but the voice.
 *
 * A TYPE RATHER THAN A LIST OF FIELDS WRITTEN OUT AGAIN, and that is the point
 * of it. `PerformanceProfile` used to declare these eight itself, beside the
 * face's own settings, which meant two files describing the same knobs and
 * nothing making them agree. They agreed for a while and then did not: studio
 * never populated a single one, so every lesson ever handed to a class went out
 * with the block empty and ran on Google's defaults — which settings.ts says at
 * the top of this file are the ones tuned for fluent speakers who do not pause
 * to assemble a clause. The profile extends this now, so a knob added here is a
 * knob a lesson carries.
 *
 * The voice is left out because it is not a house decision: it comes off the
 * face a teacher picks, and the publish route reads it from there.
 */
export type HouseSettings = Omit<SessionSettings, 'voice'>;

/** Those same keys at runtime, for picking the house half out of a settings object. */
const HOUSE_KEYS: Array<keyof HouseSettings> = [
  'temperature',
  'maxOutputTokens',
  'prefixPaddingMs',
  'silenceDurationMs',
  'startSensitivity',
  'endSensitivity',
  'affectiveDialog',
  'proactiveAudio',
];

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
 * Whether this model takes `speechConfig.languageCode`.
 *
 * IT USED TO BE SENT ON NEITHER, and the note that stood here explained why:
 * native audio does not accept the field at all, and languages.ts stored
 * ISO-639-1 where the API wants BCP-47 with a region, which cannot be derived
 * — `fr` -> `fr-FR` is right a dozen times and wrong for en, pt, zh, ar and
 * hi, and a guessed region fails at connect.
 *
 * Both halves have been answered rather than argued away. The second is a
 * `liveCode` on the language, filled in only where Google publishes a
 * spelling and left blank everywhere else, so nothing is ever guessed. The
 * first is this function: the half-cascade model takes the field, native audio
 * does not, and a knob that breaks one of two models is fine as long as it is
 * never handed to that one.
 *
 * WHAT IT BUYS is the transcript rather than the speech. Half-cascade audio
 * goes through a real ASR stage, and an ASR stage told which language it is
 * listening to stops writing Arabic script into French. See `liveCode` in
 * languages.ts for the run that made the case.
 */
export const acceptsLanguageCode = (model: ModelChoice): boolean => !isNativeAudio(model);

/**
 * How long the tutor waits before deciding the learner has finished.
 *
 * A TEACHER'S WORD FOR TWO PROVIDER KNOBS. `endSensitivity` and
 * `silenceDurationMs` are the two settings that decide whether a learner
 * pausing mid-clause to assemble the rest of it gets answered over, and they
 * are exactly the sort of thing /teach must not put in front of a teacher as
 * milliseconds. So the lesson carries one of these words and the publish route
 * spends it. See `patience` on VocoSession.
 *
 * STANDARD SENDS NOTHING, which is not the same as sending a value that happens
 * to match the default — the distinction SessionSettings is built around. It is
 * what every lesson published before this control existed did, and it is what
 * they go on doing.
 *
 * THE NUMBERS ARE A FIRST GUESS AND SHOULD BE TUNED BY EAR. Google publishes no
 * default for `silenceDurationMs`, so there is nothing to reason from — these
 * are the settings panel's own range (200–4000ms) at two points that sounded
 * right for a beginner and a very hesitant beginner. The panel in studio is
 * where a better pair gets found.
 */
export type Patience = 'standard' | 'patient' | 'very-patient';

export const PATIENCE: Array<{
  key: Patience;
  label: string;
  hint: string;
  settings: Pick<SessionSettings, 'endSensitivity' | 'silenceDurationMs'>;
}> = [
  {
    key: 'standard',
    label: 'Standard',
    hint: "Google's own endpointing. What every lesson used before this control existed.",
    settings: {},
  },
  {
    key: 'patient',
    label: 'Patient',
    hint: 'Waits about a second longer. The setting for a class that pauses mid-sentence.',
    settings: { endSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 1200 },
  },
  {
    key: 'very-patient',
    label: 'Very patient',
    hint: 'Waits two seconds. Beginners assembling a sentence a word at a time.',
    settings: { endSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 2200 },
  },
];

/** The turn-taking a lesson's patience asks for. Unknown reads as standard. */
export function patienceSettings(
  patience: string | undefined,
): Pick<SessionSettings, 'endSensitivity' | 'silenceDurationMs'> {
  return (PATIENCE.find((entry) => entry.key === patience) ?? PATIENCE[0]).settings;
}

/**
 * Gemini's prebuilt Live voices. The full catalogue is longer for the
 * half-cascade model, but these eight are the set both models share — and a
 * voice one model does not carry fails the setup rather than falling back.
 *
 * Exported because studio offers the voice on its own, outside the settings
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

/**
 * What studio shows: the same fields, minus the voice.
 *
 * Studio has its own voice picker up beside the face, where it belongs — the
 * voice is half of who is on screen rather than a knob tuned once — so offering
 * it twice on one page would be two controls for one value.
 */
export function houseFieldsFor(model: ModelChoice): SettingField[] {
  return fieldsFor(model).filter((field) => field.key !== 'voice');
}

/**
 * The house half of a settings object, with the unset fields left out.
 *
 * Left out rather than set to undefined, because a profile is spread into a
 * published setup and a key present with an undefined value is a key that gets
 * stored — which would turn "let Google decide" into a pinned nothing. Same
 * distinction the panel's controls are built around; see SessionSettings.
 */
export function houseSettings(settings: SessionSettings): HouseSettings {
  const out: HouseSettings = {};
  for (const key of HOUSE_KEYS) {
    const value = settings[key];
    if (value !== undefined) Object.assign(out, { [key]: value });
  }
  return out;
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
