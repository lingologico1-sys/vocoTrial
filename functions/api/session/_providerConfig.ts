/**
 * Turns the neutral settings in src/realtime/settings.ts into each provider's
 * own payload shape.
 *
 * This lives server-side, and both routes go through it, for the same reason
 * _resolve.ts does: the browser sends what it wants, and the Worker decides
 * what that means to a provider. Keeping the translation here also means the
 * two APIs' disagreements — nesting, casing, which knob exists at all — are
 * confined to one file instead of leaking into the UI.
 *
 * Every branch is conditional. An absent setting produces an absent field, not
 * a field set to a value we believe is the default: see the note on
 * SessionSettings for why that distinction is load-bearing.
 */

import type { SessionSettings } from '../../../src/realtime/settings';
import type { LanguageChoice } from '../../../src/realtime/languages';

/** Drops undefined entries so an object literal can be built conditionally. */
function compact<T extends Record<string, unknown>>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** True when an object has anything left in it after compaction. */
function present(object: Record<string, unknown>): boolean {
  return Object.keys(object).length > 0;
}

/**
 * Builds the `session` body for OpenAI's client-secrets endpoint.
 *
 * Input transcription is always requested: without it the API returns audio
 * only and the transcript pane has nothing to show for what the user said.
 * Which model does it, and whether it gets a language hint, are the parts the
 * settings control.
 */
export function openAiSession(
  model: string,
  instructions: string,
  language: LanguageChoice,
  settings: SessionSettings,
): Record<string, unknown> {
  /**
   * The hint is on unless it was explicitly turned off. `language` stops the
   * transcriber hedging between languages, which is the failure that costs a
   * learner the most: a hesitant French sentence decoded as English comes back
   * as plausible nonsense rather than as a mistake they can see. `prompt` is a
   * style hint — see languages.ts.
   */
  const hinted = settings.transcriptionHint !== false;

  const transcription = compact({
    model: settings.transcriptionModel ?? 'whisper-1',
    language: hinted ? language.code : undefined,
    prompt: hinted ? language.sample : undefined,
  });

  const turnDetection =
    settings.vadMode === 'semantic_vad'
      ? compact({ type: 'semantic_vad', eagerness: settings.vadEagerness })
      : compact({
          type: 'server_vad',
          threshold: settings.vadThreshold,
          prefix_padding_ms: settings.prefixPaddingMs,
          silence_duration_ms: settings.silenceDurationMs,
        });

  // A bare `{ type: 'server_vad' }` carries no information the default does not
  // already, so it is only worth sending once something else is set with it.
  const sendTurnDetection =
    settings.vadMode !== undefined ||
    settings.vadEagerness !== undefined ||
    settings.vadThreshold !== undefined ||
    settings.prefixPaddingMs !== undefined ||
    settings.silenceDurationMs !== undefined;

  const input = compact({
    transcription,
    noise_reduction: settings.noiseReduction ? { type: settings.noiseReduction } : undefined,
    turn_detection: sendTurnDetection ? turnDetection : undefined,
  });

  const output = compact({
    voice: settings.voice,
    speed: settings.speed,
  });

  return {
    type: 'realtime',
    model,
    instructions,
    audio: compact({
      input: present(input) ? input : undefined,
      output: present(output) ? output : undefined,
    }),
    ...compact({ max_output_tokens: settings.maxOutputTokens }),
  };
}

/**
 * Builds the `setup` frame for Gemini Live.
 *
 * The model arrives as a full resource name, not a bare id: on Vertex that is
 * `publishers/google/models/<id>`, and the relay builds it from the allowlisted
 * choice (see _vertex.ts). Resolving the name upstream keeps the one field that
 * decides which meter is spent out of reach of both this file and the browser,
 * which is the same reason the key is attached by the relay rather than here.
 *
 * No speechConfig.languageCode is sent, on either model — settings.ts explains
 * at length why that field is absent rather than forgotten.
 */
export function geminiSetup(
  modelPath: string,
  instructions: string,
  settings: SessionSettings,
): Record<string, unknown> {
  const speechConfig = settings.voice
    ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } } }
    : undefined;

  const activityDetection = compact({
    startOfSpeechSensitivity: settings.startSensitivity,
    endOfSpeechSensitivity: settings.endSensitivity,
    prefixPaddingMs: settings.prefixPaddingMs,
    silenceDurationMs: settings.silenceDurationMs,
  });

  return {
    model: modelPath,
    generationConfig: compact({
      responseModalities: ['AUDIO'],
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      speechConfig,
    }),
    systemInstruction: { parts: [{ text: instructions }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    ...compact({
      realtimeInputConfig: present(activityDetection)
        ? { automaticActivityDetection: activityDetection }
        : undefined,
      // Native-audio only, and rejected by the half-cascade model — the
      // applicability rules in settings.ts are what keep them off it.
      enableAffectiveDialog: settings.affectiveDialog,
      proactivity: settings.proactiveAudio === undefined
        ? undefined
        : { proactiveAudio: settings.proactiveAudio },
    }),
  };
}
