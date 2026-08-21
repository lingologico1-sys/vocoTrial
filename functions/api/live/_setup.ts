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
import { COMPLETE_TOOL } from '../../../src/realtime/vocoSessions';

/**
 * The one tool a tutor has, and the only structured channel into a live call.
 *
 * WHY A TOOL AND NOT THE TRANSCRIPT. The student page has to know when the
 * lesson is over, and nothing else could tell it. The transcript is untyped
 * text, so reading it means guessing; a spoken marker is a marker the tutor
 * eventually says out loud. A function call is the only thing the model can
 * emit that is addressed to the program rather than to the learner.
 *
 * DECLARED ON EVERY CALL, including the ones with no lesson. The alternative is
 * plumbing a question count from the browser through _resolve.ts to here, to
 * save a few dozen tokens on the minority of calls that are the workshop trying
 * a voice. A tutor with no question list has no list to finish and never calls
 * it.
 *
 * NO ARGUMENTS, AND CALLED ONCE. It used to take the number of the question
 * just finished and be called all through the lesson; that is what made the
 * tutor repeat itself, because on Vertex every tool call is blocking and being
 * unblocked is a fresh turn spoken on top of the last one. COMPLETE_TOOL in
 * src/realtime/vocoSessions.ts carries the evidence and what it cost to change.
 * An argument would only invite the model to call it early to report progress,
 * which is the habit being removed.
 *
 * NO `behavior: 'NON_BLOCKING'`, WHICH WOULD BE THE OBVIOUS FIX AND DOES NOT
 * WORK HERE. It is a Gemini Developer API feature. Vertex — which is the
 * surface this model is served from, see models.ts — does not implement it:
 * Google's own SDK refuses the field with "behavior parameter is not supported
 * in Vertex AI", and the raw socket used here quietly ignores it instead, which
 * is worse, because it looks like a fix and changes nothing. It was tried, it
 * was measured, and the doubling did not move. Do not add it back without
 * moving the model to the AI Studio surface first.
 */
const COMPLETE_DECLARATION = {
  name: COMPLETE_TOOL,
  description:
    'Record that the last question in the system instructions has now been answered by the learner and discussed, so the whole list is finished. Call once per conversation, at the end. Bookkeeping only: it is never spoken about and produces no reply to read out.',
  parameters: { type: 'OBJECT', properties: {} },
};

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
    tools: [{ functionDeclarations: [COMPLETE_DECLARATION] }],
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
