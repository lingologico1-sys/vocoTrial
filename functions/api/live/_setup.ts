/**
 * Turns the neutral settings in src/realtime/settings.ts into Gemini Live's own
 * `setup` payload shape.
 *
 * This lives server-side, beside the relay that sends it, for the same reason
 * _resolve.ts does: the browser sends what it wants, and the Worker decides
 * what that means to Google. Keeping the translation here also means the API's
 * spelling — nesting, casing, which knob exists at all — is confined to one
 * file instead of leaking into the UI.
 *
 * It used to translate for two providers and was called _providerConfig.ts.
 * OpenAI Realtime is gone, so the only shape left is this one; if a second
 * provider ever returns, this is the file that grows a sibling function rather
 * than the panel growing a branch.
 *
 * Every branch is conditional. An absent setting produces an absent field, not
 * a field set to a value we believe is the default: see the note on
 * SessionSettings for why that distinction is load-bearing.
 */

import type { SessionSettings } from '../../../src/realtime/settings';

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
