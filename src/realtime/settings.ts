/**
 * The realtime knobs this rig lets you turn, and the only ones it will.
 *
 * vocoTrial exists to compare realtime models as language tutors, so the
 * settings worth exposing are the ones that change how a *conversation* goes:
 * which voice, how long it waits before deciding you have finished a sentence,
 * how it transcribes a hesitant learner. Knobs that belong to some other use of
 * these APIs — image resolution, video framerate, tool wiring — are omitted on
 * purpose rather than forgotten.
 *
 * No two of the three models are symmetric, so every field carries an `applies`
 * predicate keyed on the model rather than on the provider. Sending a field a
 * model does not accept is not harmless: the upstream rejects the whole setup,
 * and the call fails at connect time.
 *
 * THIS TABLE WAS HALVED WHEN OPENAI REALTIME WENT AND IS WHOLE AGAIN. The
 * knobs that left with it — speaking rate, the two VAD detectors and their
 * sub-fields, the transcription model and its language hint, noise reduction —
 * are back with the wording they had, because they were right the first time
 * and the git history is a better source than a second guess. What is new is
 * that `requires` came back with them: a field that only means something under
 * one VAD mode must vanish under the other, or the panel offers a control the
 * payload will ignore.
 *
 * One schema drives three things — the panel in the browser, the validation in
 * the Worker, and the translation into the setup frame — so they cannot drift
 * apart. Same reasoning as models.ts and languages.ts.
 *
 * Deliberately free of DOM imports: functions/ compiles against workers-types.
 */

import { isGoogle, isOpenAi, type ModelChoice } from './models';

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
  /** Both: audio kept from before speech was detected. */
  prefixPaddingMs?: number;
  /** Both: silence before the turn is closed. The one to raise for a learner. */
  silenceDurationMs?: number;
  /** Gemini: how readily silence *starts* a turn. */
  startSensitivity?: 'START_SENSITIVITY_HIGH' | 'START_SENSITIVITY_LOW';
  /** Gemini: how readily silence *ends* one. LOW is the patient setting. */
  endSensitivity?: 'END_SENSITIVITY_HIGH' | 'END_SENSITIVITY_LOW';
  /**
   * Gemini: whether detected speech cancels the turn the model is speaking.
   *
   * THE KNOB THAT DECIDES WHO WINS A FALSE POSITIVE. Google's default is
   * `START_OF_ACTIVITY_INTERRUPTS`: anything its detector calls speech stops
   * generation dead. That is barge-in, and barge-in is worth having — right up
   * until the detector is wrong, at which point it is a question destroyed
   * mid-word for a noise nobody made.
   *
   * On 2026-08-28 a lesson recorded exactly that: the tutor was cut off at
   * +1:11.4 after "Est-ce que tu es retourné", `interrupted` arrived, and this
   * browser's own voice gate had reported nothing between +1:07.1 and +1:25.0.
   * Same stream, same moment, two detectors disagreeing — and the one that got
   * to act on it was the one the learner could not hear the reason for.
   *
   * `NO_INTERRUPTION` takes that veto away. The model finishes what it is
   * saying and the learner's speech is still heard, still transcribed, still
   * answered on the next turn; what is lost is the ability to stop a tutor
   * mid-sentence by talking over it. See LEARNER_TURN_TAKING for why the
   * student page spends that and the workshop does not.
   */
  activityHandling?: 'START_OF_ACTIVITY_INTERRUPTS' | 'NO_INTERRUPTION';

  // --- OpenAI only.
  /**
   * Which detector decides the learner has finished.
   *
   * THE ONE KNOB HERE WITH NO GEMINI COUNTERPART AT ALL, and the reason this
   * provider was worth wiring up. `server_vad` counts silence, which is what
   * both Gemini models do and what three diagnostics on 2026-08-27 recorded
   * failing a hesitant learner outright. `semantic_vad` asks the model whether
   * what it just heard *sounds finished* — a beginner pausing four seconds
   * mid-clause has not finished, and a stopwatch cannot tell that from a
   * beginner who has.
   */
  vadMode?: 'server_vad' | 'semantic_vad';
  /** OpenAI server_vad: loudness that counts as speech, 0–1. */
  vadThreshold?: number;
  /**
   * OpenAI semantic_vad: how ready it is to answer. `low` waits longer.
   *
   * An enum, not a number, and the API reference agrees now — the two pages
   * that disagreed when this was first written have converged on these four
   * strings.
   */
  vadEagerness?: 'auto' | 'low' | 'medium' | 'high';
  /**
   * Playback rate for the agent's own voice, 0.25–1.5.
   *
   * Not offered to a teacher directly: the lesson's `pace` spends it. See PACE
   * in tutorPrompt.ts, whose own note says a prose instruction is followed
   * rather than obeyed — this is the half that can be read back off a payload.
   */
  speed?: number;
  /**
   * Whether the prompt asserts a native accent, and the one field here that is
   * not sent as a field.
   *
   * It composes prose above the instructions instead — see ACCENT in
   * tutorPrompt.ts and openAiSession in functions/api/live/_setup.ts, which is
   * where it is spent. It lives in this table anyway because this table is what
   * gives a knob a panel, a validator and a published lesson to ride in, and a
   * second mechanism for one select would be a second mechanism to keep honest.
   *
   * ABSENT MEANS `native` HERE, WHICH IS THE OPPOSITE OF EVERY OTHER FIELD
   * ABOVE. There is no provider default to defer to — OpenAI has no accent
   * field of any kind — so "send nothing" is not neutral, it is the American
   * accent. ACCENT's own note has the argument.
   *
   * OpenAI only, because Gemini does not have the problem: it is handed a
   * BCP-47 `liveCode` and sounds French when told to speak French.
   */
  accent?: 'native' | 'off';
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
  'activityHandling',
  'vadMode',
  'vadThreshold',
  'vadEagerness',
  'speed',
  'accent',
  'transcriptionModel',
  'transcriptionHint',
  'noiseReduction',
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
  /**
   * Extra condition on the *other* settings — a VAD mode's own sub-fields.
   *
   * SEPARATE FROM `applies` BECAUSE IT ANSWERS A DIFFERENT QUESTION, and only
   * one of the two may be trusted in the Worker. `applies` is a fact about the
   * model and is what sanitizeSettings enforces; this is a fact about a choice
   * the user has made and can un-make, so it governs what the panel *shows* and
   * nothing else. A silence duration left behind by a switch to semantic VAD is
   * harmless — the setup builder reads only the fields its chosen mode takes —
   * and dropping it would lose the value if they switched back.
   */
  requires?: (settings: SessionSettings) => boolean;
  /**
   * What the panel's blank option says, where "Model default" would be false.
   *
   * It is right for every field but one. `accent` composes prose rather than
   * sending a field, and the model has no accent default to fall back to — so
   * an untouched control there does not defer to anything, it takes *our*
   * default. Labelling that "Model default" is precisely the small lie the
   * comment over that option warns about, and worse than the wording it
   * replaced: it points at the provider for a decision the provider never made.
   */
  unsetLabel?: string;
}

export type SettingField = FieldBase &
  (
    /**
     * The options are resolvable from the model again, and for the reason they
     * originally were: the voice vocabularies are per-provider, and nothing
     * else can express that. It went to a plain list while there was one
     * provider and one vocabulary. There are two of each again.
     */
    | { kind: 'select'; options: SettingOption[] | ((model: ModelChoice) => SettingOption[]) }
    | {
        kind: 'number';
        min: number;
        max: number;
        step: number;
        unit?: string;
        /**
         * Bounds that differ by model, where they do. Only maxOutputTokens does:
         * Gemini takes up to 8192 and OpenAI's GA session object caps at 4096,
         * and a value over the cap is a 400 at connect rather than a clamp.
         */
        limits?: (model: ModelChoice) => { min: number; max: number };
      }
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
export const acceptsLanguageCode = (model: ModelChoice): boolean =>
  isGoogle(model) && !isNativeAudio(model);

/**
 * The same job on the other provider, done by a different field.
 *
 * OpenAI has no `speechConfig.languageCode`: the language of the *speech* comes
 * from the instructions, and the language of the *transcript* is set on the
 * transcriber directly. That second half is the half that mattered — the field
 * above exists because an ASR stage not told the language wrote Arabic script
 * into a French transcript — and OpenAI's takes plain ISO-639-1, which is what
 * languages.ts has stored all along. So the field with the awkward spelling
 * problem is the one this provider does not have.
 */
export const acceptsTranscriptionLanguage = (model: ModelChoice): boolean => isOpenAi(model);

/**
 * The thinking level this rig pins, on the models that have one.
 *
 * A PINNED VALUE RATHER THAN AN ABSENT FIELD, which is this file's one rule
 * broken on purpose and for the reason `PATIENCE` breaks it: the default is not
 * what the documentation says it is. Google publishes `minimal` as the default
 * for gemini-3.1-flash-live-preview, chosen for latency. Sending no
 * `thinkingConfig`, a probe run of an ordinary five-question lesson had four
 * turns speak their reasoning out loud, in English, into the audio:
 *
 *   "Based on the user's brief response, I interpret that they have completed
 *    their answer to the first question. I will call questionDone with number
 *    1. ... I must adhere strictly to speaking French. Ah, super ! Quel âge
 *    as-tu ?"
 *
 * A learner hears all of that. Pinning the value the docs call the default took
 * it to zero across the runs after, which is the whole argument: an absent
 * field is only "the provider's default" when the provider agrees, and this one
 * does not. Run `THINKING=… npm run probe` to check it again on a new model.
 *
 * IT IS NOT A SETTING AND MUST NOT BECOME ONE without evidence. There is no
 * SETTING_FIELDS entry, nothing on /teach and nothing in the house profile: a
 * knob offered to a teacher is a knob somebody has to understand, and nothing
 * measured so far says a room ever wants this turned up. If a run ever shows
 * the protocol handled better at `low` than at `minimal`, that is the evidence,
 * and this is where it would start.
 *
 * ABSENT ON NATIVE AUDIO, which is a 2.5 model: those take `thinkingBudget` as
 * a token count and reject a level outright, and sending both is a 400. Nothing
 * has measured a leak there, so nothing is sent there.
 */
export const thinkingLevelFor = (model: ModelChoice): string | undefined =>
  isGoogle(model) && !isNativeAudio(model) ? 'minimal' : undefined;

/**
 * The same pin, on the model that spells it differently.
 *
 * gpt-realtime-2.1 is a reasoning model and takes `reasoning.effort`. Pinned to
 * `minimal` for exactly the reason above rather than by analogy: the failure
 * being guarded against is a tutor speaking its deliberation out loud to a
 * beginner, and it is a failure this project has actually had. Latency is the
 * second argument and the smaller one.
 *
 * NOT A SETTING, on the same terms as `thinkingLevelFor`. If a run ever shows
 * the progress protocol handled better at `low`, that is the evidence, and this
 * is where it would start.
 */
export const reasoningEffortFor = (model: ModelChoice): string | undefined =>
  isOpenAi(model) ? 'minimal' : undefined;

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

/**
 * ONE TEACHER'S WORD, TWO QUITE DIFFERENT MECHANISMS UNDERNEATH IT.
 *
 * On Gemini, patience is a longer stopwatch: wait more milliseconds of silence
 * before calling the turn over. That is the only instrument either Google model
 * offers, and the numbers below are the settings panel's own range at two
 * points that sounded right for a beginner.
 *
 * On OpenAI it is not a stopwatch at all. `semantic_vad` hands the question to
 * the model — does what I just heard sound like a finished thought? — and
 * `eagerness` is how much benefit of the doubt to give. That is a better answer
 * to the actual failure than any silence duration, because the failure was
 * never that the clock was too short in general: a learner who pauses four
 * seconds mid-clause and a learner who has finished produce the same silence,
 * and only one of them should be answered.
 *
 * SO THE TWO COLUMNS ARE NOT A TRANSLATION AND MUST NOT BE READ AS ONE. A
 * lesson run at `patient` on both models is not a controlled comparison of the
 * two tutors; it is a comparison of two endpointing strategies as well. That is
 * the right trade for a teacher, who wants the best lesson rather than a clean
 * experiment, and the wrong one for the bench — which is why the bench keeps
 * sending nothing. See LEARNER_TURN_TAKING.
 *
 * STANDARD SENDS NOTHING ON EITHER, which is the rule this whole file is built
 * around and is preserved deliberately across the new column.
 */
export const PATIENCE: Array<{
  key: Patience;
  label: string;
  hint: string;
  /** Gemini's stopwatch. */
  settings: Pick<SessionSettings, 'endSensitivity' | 'silenceDurationMs'>;
  /** OpenAI's judgement. */
  openAi: Pick<SessionSettings, 'vadMode' | 'vadEagerness'>;
}> = [
  {
    key: 'standard',
    label: 'Standard',
    hint: "The provider's own endpointing. What every lesson used before this control existed.",
    settings: {},
    openAi: {},
  },
  {
    key: 'patient',
    label: 'Patient',
    hint: 'Gives the learner longer to finish. The setting for a class that pauses mid-sentence.',
    settings: { endSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 1200 },
    openAi: { vadMode: 'semantic_vad', vadEagerness: 'medium' },
  },
  {
    key: 'very-patient',
    label: 'Very patient',
    hint: 'Waits longest. Beginners assembling a sentence a word at a time.',
    settings: { endSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 2200 },
    openAi: { vadMode: 'semantic_vad', vadEagerness: 'low' },
  },
];

/**
 * The turn-taking /eleve sends when the lesson pinned nothing, filled under
 * whatever the teacher did pin.
 *
 * A SECOND DELIBERATE BREAK OF THE ABSENT-MEANS-UPSTREAM RULE, argued the same
 * way as `thinkingLevelFor`: the provider's default is measurably wrong for
 * this page's speaker. Three diagnostics on 2026-08-27 showed Google's own
 * detection failing a hesitant learner outright — one answer retried seven
 * times over 47 seconds before a turn was committed, and one ten-second answer
 * to the last question that was never committed at all, which stranded the
 * lesson one question short. The common thread was the setup sending none of
 * these fields, so the sensitivity in force was one tuned for fluent speakers.
 *
 * The prefix padding guards the first syllable of an utterance the detector was
 * slow to believe; LOW end sensitivity with an explicit silence duration makes
 * the commit deterministic instead of whatever the provider felt like. The
 * silence duration sits under the `patient` preset's 1200ms on purpose: a
 * teacher who chose a patience chose those two fields, and this only speaks
 * where they said nothing.
 *
 * THE START SENSITIVITY WAS HIGH AND IS NOW LOW, WHICH IS A REVERSAL AND NOT A
 * TUNING. HIGH was the direct answer to speech never starting a turn, and
 * against that failure it worked. What it cost only became visible once there
 * was an instrument for it: on 2026-08-28 the tutor was cut off mid-word at
 * +1:11.4 — "Est-ce que tu es retourné", then nothing — with `interrupted` on
 * the wire and this browser's own voice gate silent from +1:07.1 to +1:25.0.
 * Google's detector called speech on audio our RMS gate did not, and under the
 * default activity handling that call cancels the turn.
 *
 * HIGH AND `END_SENSITIVITY_LOW` TOGETHER ARE THE WORST PAIR AVAILABLE: latch
 * onto any noise, then be reluctant to let go of it. While the detector
 * believes the learner is mid-utterance the model does not generate, which is
 * the shape of every long stall in that lesson — 20s, 15s and 42s of dead air
 * against 5.7s and 1.3s on the turns that went normally. LOW start with the
 * padding above is the pair that answers both failures: clearer evidence
 * before a turn opens, and the syllable that evidence costs put back.
 *
 * `NO_INTERRUPTION` IS THE BELT TO THAT BRACE, and it is the one line here a
 * teacher might reasonably want back. It gives up barge-in: a learner talking
 * over the tutor no longer stops it, they are simply heard and answered next
 * turn. For a beginner on a three-minute cap that is the cheaper loss — the
 * lesson above spent 85 of its 181 seconds with the learner waiting — but it
 * is a judgement about the room, so it is a knob on the panel and not a
 * constant. See `activityHandling`.
 *
 * FOR THE STUDENT PAGE ONLY. The workshop pages keep sending nothing, because
 * comparing models includes comparing their defaults, and a bench that
 * silently pins five fields is a bench lying about what it measured.
 */
export const LEARNER_TURN_TAKING: Pick<
  SessionSettings,
  | 'startSensitivity'
  | 'endSensitivity'
  | 'silenceDurationMs'
  | 'prefixPaddingMs'
  | 'activityHandling'
> = {
  startSensitivity: 'START_SENSITIVITY_LOW',
  endSensitivity: 'END_SENSITIVITY_LOW',
  silenceDurationMs: 1000,
  prefixPaddingMs: 300,
  activityHandling: 'NO_INTERRUPTION',
};

/**
 * The same judgement for OpenAI, and it is one field rather than four.
 *
 * All four above are Gemini spellings with no counterpart here, so this is not
 * a translation of them — it is the same argument reached again. The evidence
 * was that Google's own detection failed a hesitant learner outright, with one
 * answer retried seven times over 47 seconds and one ten-second answer never
 * committed at all; the four fields above are the best a stopwatch can do about
 * that. `semantic_vad` is the instrument built for it, so on this provider the
 * student page starts there rather than tuning thresholds.
 *
 * `medium` and not `low` because this is the floor a lesson gets when the
 * teacher pinned nothing, and it sits under `very-patient` for the same reason
 * the 1000ms above sits under `patient`'s 1200: this only speaks where they
 * said nothing.
 */
export const LEARNER_TURN_TAKING_OPENAI: Pick<SessionSettings, 'vadMode' | 'vadEagerness'> = {
  vadMode: 'semantic_vad',
  vadEagerness: 'medium',
};

/**
 * Those defaults underneath whatever was pinned: a set field always wins, and
 * a field absent from both stays absent (there are none such today, but the
 * spread keeps that true if the default set ever shrinks).
 */
export function withLearnerTurnTaking(
  settings: SessionSettings,
  model: ModelChoice,
): SessionSettings {
  const base = isOpenAi(model) ? LEARNER_TURN_TAKING_OPENAI : LEARNER_TURN_TAKING;
  return { ...base, ...settings };
}

/** The turn-taking a lesson's patience asks for. Unknown reads as standard. */
export function patienceSettings(
  patience: string | undefined,
  model: ModelChoice,
): Pick<SessionSettings, 'endSensitivity' | 'silenceDurationMs' | 'vadMode' | 'vadEagerness'> {
  const entry = PATIENCE.find((item) => item.key === patience) ?? PATIENCE[0];
  return isOpenAi(model) ? entry.openAi : entry.settings;
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

/**
 * OpenAI's realtime voices, with the same caveat about the letters.
 *
 * `marin` and `cedar` are the two OpenAI recommends for realtime and the two
 * that shipped with gpt-realtime; the other eight predate it. `marin` is the
 * fallback for a face that has not been given one — see `openAiVoice` on
 * Persona — because it was this app's default the last time it spoke to this
 * provider at all.
 *
 * NO OVERLAP WITH THE LIST ABOVE, AND NO MAPPING BETWEEN THEM. A face carries
 * one name per provider rather than one name translated, because "Kore sounds
 * like marin" is a claim about two voices that neither API will ever confirm
 * and that nobody would agree with twice. Studio asks instead.
 */
const OPENAI_VOICE_NAMES: Array<[name: string, sex: 'm' | 'f']> = [
  ['marin', 'f'],
  ['cedar', 'm'],
  ['alloy', 'f'],
  ['ash', 'm'],
  ['ballad', 'm'],
  ['coral', 'f'],
  ['echo', 'm'],
  ['sage', 'f'],
  ['shimmer', 'f'],
  ['verse', 'm'],
];

export const OPENAI_VOICES: SettingOption[] = OPENAI_VOICE_NAMES.map(([name, sex]) => ({
  value: name,
  label: `${name} (${sex})`,
}));

/** The default voice for an OpenAI call whose face has not named one. */
export const DEFAULT_OPENAI_VOICE = 'marin';

/** The voice vocabulary a model draws from. */
export function voicesFor(model: ModelChoice): SettingOption[] {
  return isOpenAi(model) ? OPENAI_VOICES : VOICES;
}

export const SETTING_FIELDS: SettingField[] = [
  {
    key: 'voice',
    label: 'Voice',
    kind: 'select',
    applies: () => true,
    options: voicesFor,
  },
  {
    key: 'speed',
    label: 'Speaking rate',
    hint: 'Slowing the agent down is the cheapest comprehension aid there is.',
    kind: 'number',
    min: 0.25,
    max: 1.5,
    step: 0.05,
    applies: isOpenAi,
  },
  {
    key: 'accent',
    label: 'Accent',
    /**
     * THE BLANK OPTION DOES NOT MEAN "SEND NOTHING" ON THIS ONE FIELD, and the
     * hint has to say so, because everywhere else on this panel it does. There
     * is no provider default behind this control to fall back to — OpenAI has
     * no accent field — so leaving it alone gets the native block, and turning
     * it off is the deliberate act. See `accent` on SessionSettings.
     */
    hint: 'On unless you turn it off. French speaks Parisian; see `variety` in languages.ts.',
    kind: 'select',
    applies: isOpenAi,
    unsetLabel: 'Native speaker (default)',
    /*
     * ONE OPTION, BECAUSE THERE IS ONLY ONE CHOICE TO MAKE. `native` is not
     * listed beside `off` even though the type has it: the blank option above
     * already means native, and offering both would put two entries that do
     * the identical thing in one dropdown, which reads as a difference nobody
     * can find. Turning it off is the only decision available here, so it is
     * the only one shown. The value stays in the type because probe.ts and a
     * published lesson can still say it out loud, and sanitizeSettings dropping
     * an unlisted `native` lands on the same prompt anyway.
     *
     * NO LIST OF REGIONS EITHER, because which variety a language defaults to
     * is a fact about the language and lives on it. A knob offering Parisian
     * against Quebecois is worth adding the day somebody wants to teach the
     * other one, and not before.
     */
    options: [{ value: 'off', label: 'Say nothing about it' }],
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
    key: 'transcriptionModel',
    label: 'Input transcription',
    /**
     * whisper-1 is the batch option and the one to reach for on hesitant
     * speech: it transcribes the whole utterance, so the end of a sentence can
     * disambiguate its start, which is exactly where a learner is hardest to
     * read. The streaming models put words on screen sooner and commit to each
     * guess before hearing what follows. The knob exists so that trade can be
     * measured, not so it can be assumed — which is why nothing is pinned here
     * and an untouched control sends no field at all.
     */
    hint: 'whisper-1 waits for the whole utterance. Only the two newest take the word list.',
    kind: 'select',
    applies: isOpenAi,
    /**
     * THE LIST IS TWO GENERATIONS AND THEY DIFFER IN MORE THAN ACCURACY. Only
     * gpt-live-transcribe and gpt-transcribe accept `keywords`, so only they
     * can be handed the lesson's vocabulary as a list; on the older three it
     * goes into `prompt` instead and biases more softly. That routing lives in
     * openAiSession in functions/api/live/_setup.ts, and it is not cosmetic —
     * sending the field to a transcriber that has never heard of it refuses the
     * whole session, which is how a learner ends up talking into a dead page.
     */
    options: [
      { value: 'whisper-1', label: 'whisper-1 (batch, most accurate)' },
      { value: 'gpt-live-transcribe', label: 'gpt-live-transcribe (streaming, takes keywords)' },
      { value: 'gpt-transcribe', label: 'gpt-transcribe (batch, takes keywords)' },
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
    hint: 'Far field is the one for a classroom of laptops.',
    kind: 'select',
    applies: isOpenAi,
    options: [
      { value: 'near_field', label: 'Near field (headset)' },
      { value: 'far_field', label: 'Far field (laptop mic)' },
    ],
  },
  {
    key: 'startSensitivity',
    label: 'Start-of-speech sensitivity',
    kind: 'select',
    applies: isGoogle,
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
    applies: isGoogle,
    options: [
      { value: 'END_SENSITIVITY_HIGH', label: 'High — ends a turn readily' },
      { value: 'END_SENSITIVITY_LOW', label: 'Low — waits longer' },
    ],
  },
  {
    key: 'activityHandling',
    label: 'Barge-in',
    hint: 'No-interrupt stops a noisy room cancelling the tutor mid-question.',
    kind: 'select',
    applies: isGoogle,
    options: [
      { value: 'START_OF_ACTIVITY_INTERRUPTS', label: 'Speech interrupts the tutor' },
      { value: 'NO_INTERRUPTION', label: 'Let the tutor finish' },
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
    applies: isGoogle,
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
    // The one field whose ceiling is a fact about the provider rather than a
    // judgement about lessons. Over the cap is a 400 at connect, not a clamp.
    limits: (model) => (isOpenAi(model) ? { min: 64, max: 4096 } : { min: 64, max: 8192 }),
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

/**
 * What the panel shows for a given model, in order.
 *
 * `settings` is optional and only the panel passes it. With it, a field whose
 * `requires` is unmet is hidden; without it, every field the model accepts is
 * listed — which is what the diagnostic wants, since a value pinned under the
 * other VAD mode is still a value somebody set and still worth printing.
 */
export function fieldsFor(model: ModelChoice, settings?: SessionSettings): SettingField[] {
  return SETTING_FIELDS.filter(
    (field) =>
      field.applies(model) && (!settings || !field.requires || field.requires(settings)),
  );
}

/**
 * What studio shows: the same fields, minus the voice.
 *
 * Studio has its own voice picker up beside the face, where it belongs — the
 * voice is half of who is on screen rather than a knob tuned once — so offering
 * it twice on one page would be two controls for one value.
 */
export function houseFieldsFor(model: ModelChoice, settings?: SessionSettings): SettingField[] {
  return fieldsFor(model, settings).filter((field) => field.key !== 'voice');
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

export function optionsFor(field: SettingField, model: ModelChoice): SettingOption[] {
  if (field.kind !== 'select') return [];
  return typeof field.options === 'function' ? field.options(model) : field.options;
}

/** A number field's range for this model, which is usually the declared one. */
export function boundsFor(
  field: SettingField,
  model: ModelChoice,
): { min: number; max: number } {
  if (field.kind !== 'number') return { min: 0, max: 0 };
  return field.limits ? field.limits(model) : { min: field.min, max: field.max };
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
      // This model's range, not the field's declared one — see `limits`.
      const { min, max } = boundsFor(field, model);
      out[field.key] = clamp(rounded, min, max);
      continue;
    }

    if (typeof value !== 'string') continue;
    if (optionsFor(field, model).some((option) => option.value === value)) {
      out[field.key] = value;
    }
  }

  return out as SessionSettings;
}
