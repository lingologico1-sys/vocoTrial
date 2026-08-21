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
import { ANSWERED_TOOL } from '../../../src/realtime/vocoSessions';

/**
 * The one tool a tutor has, and the only structured channel into a live call.
 *
 * WHY A TOOL AND NOT THE TRANSCRIPT. The student page shows how many questions
 * are left, and nothing else could tell it. The transcript is untyped text, so
 * counting from it means guessing; a spoken marker is a marker the tutor
 * eventually says out loud. A function call is the only thing the model can
 * emit that is addressed to the program rather than to the learner.
 *
 * DECLARED ON EVERY CALL, including the ones with no lesson. The alternative is
 * plumbing a question count from the browser through _resolve.ts to here, to
 * save a few dozen tokens on the minority of calls that are the workshop trying
 * a voice. A tutor with no question list has nothing to report and never calls
 * it.
 *
 * INTEGER, NOT STRING, and required. A model handed an optional argument omits
 * it, and a model handed a string sends "the second one".
 *
 * NON_BLOCKING, AND THAT IS THE WHOLE POINT OF IT. A tool declared the default
 * way is blocking: the model stops generating when it calls one and waits for
 * the result, and the result arriving is what starts it up again. For a tool
 * whose result is genuinely wanted that is the correct trade. This one's result
 * is `{ ok: true }` — the model has nothing to learn from it, and the restart it
 * buys is a fresh turn generated on top of a turn already spoken. That is what
 * made the tutor ask the same question twice: it said "qu'est-ce qui te met de
 * si bonne humeur ?", reported the question done, and was handed a reason to
 * speak again, so it said it a second time and ran on into the next question.
 * Non-blocking means the call never pauses generation, so nothing has to be
 * restarted and there is no second turn to collide with the first. See the
 * matching `scheduling: 'SILENT'` on the response in src/realtime/gemini.ts —
 * the two halves only work together, and either one alone still doubles.
 */
const ANSWERED_DECLARATION = {
  name: ANSWERED_TOOL,
  behavior: 'NON_BLOCKING',
  description:
    'Record that one of the numbered questions in the system instructions has been answered by the learner and discussed. Bookkeeping only: it is never spoken about and produces no reply to read out.',
  parameters: {
    type: 'OBJECT',
    properties: {
      number: {
        type: 'INTEGER',
        description: "The question's position in the list, counting from 1.",
      },
    },
    required: ['number'],
  },
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
    tools: [{ functionDeclarations: [ANSWERED_DECLARATION] }],
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
