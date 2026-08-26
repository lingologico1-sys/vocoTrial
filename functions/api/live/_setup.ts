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

import {
  acceptsLanguageCode,
  thinkingLevelFor,
  type SessionSettings,
} from '../../../src/realtime/settings';
import type { LanguageChoice } from '../../../src/realtime/languages';
import type { ModelChoice } from '../../../src/realtime/models';
import { PROGRESS_TOOL } from '../../../src/realtime/tutorPrompt';

/**
 * The one tool a tutor has, and the only structured channel into a live call.
 *
 * WHY A TOOL AND NOT THE TRANSCRIPT, and why one call per question rather than
 * one at the end: see PROGRESS_TOOL in tutorPrompt.ts, beside the prompt that
 * tells the model this exists.
 *
 * THE DESCRIPTION CARRIES THE STANDARD, and that is deliberate placement rather
 * than convenience. "Answered in a full sentence and talked about" used to be a
 * rule in the prompt, held for the whole call and applied at the moment a
 * question ended; a model three questions in had stopped applying it. Here it
 * is read at the moment the model is deciding whether to call, which is the
 * only moment it decides anything.
 *
 * WHICH IS ALSO WHY THE STANDARD IS ABOUT THE LEARNER AND NOT THE TUTOR. It
 * used to end "and you have talked about their answer" — a condition on the
 * model's own speech, which read at the moment of deciding describes a turn not
 * yet over, so a model that waits to satisfy it reports every question a turn
 * late. That is invisible until the end of the list, where the turn it is
 * waiting for never comes. What a question being finished actually depends on
 * is the learner having finished answering it, and that has already happened
 * when this is read: the model is generating a turn in response to it. So the
 * condition is theirs, the moment is now, and the full-sentence bar — the part
 * that stops a lesson marching through five questions on five shrugs — is the
 * one that stays. tutorPrompt.ts has the run it was measured on.
 *
 * DECLARED ON EVERY CALL, including the ones with no lesson. The alternative is
 * plumbing a question count from the browser through _resolve.ts to here, to
 * save a few dozen tokens on the minority of calls that are the workshop trying
 * a voice. A tutor with no question list has no list to report against.
 *
 * NON-BLOCKING, AND ONLY WHERE THAT MEANS ANYTHING. Without it the model stops
 * generating until the result arrives, and being unblocked is a fresh turn
 * spoken on top of the one it had already spoken — fourteen doubled turns out
 * of fourteen tool calls, when this was measured. It is a Gemini Developer API
 * feature: AI Studio implements it, Vertex does not, and Vertex does not refuse
 * the field either — it ignores it, which is worse, because it looks like a fix
 * and changes nothing. So it is sent to the surface that honours it and not to
 * the one that would lie about it, and the student page runs on the former.
 * See models.ts, where the surface travels with the model.
 */
function progressDeclaration(model: ModelChoice) {
  return {
    name: PROGRESS_TOOL,
    description:
      "Record that one question from the system instructions is finished: the learner has just answered it, in at least a full sentence. Call it at the top of the turn you are taking in response to that answer — not after you have replied, and not in a later turn, which for the last question on the list never comes. Pass that question's number in the list, counting from 1, once per question as you go. Bookkeeping only: it is never spoken about and produces no reply to read out.",
    parameters: {
      type: 'OBJECT',
      properties: {
        number: {
          type: 'INTEGER',
          description: 'Which question in the list has been answered, counting from 1.',
        },
      },
      required: ['number'],
    },
    ...(model.surface === 'aistudio' ? { behavior: 'NON_BLOCKING' } : {}),
  };
}

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
 * `publishers/google/models/<id>`, and on AI Studio `models/<id>`. The relay
 * builds it from the allowlisted choice (see _vertex.ts and _aistudio.ts).
 * Resolving the name upstream keeps the one field that decides which meter is
 * spent out of reach of both this file and the browser, which is the same
 * reason the key is attached by the relay rather than here.
 *
 * THE CHOICE ITSELF IS PASSED IN ALONGSIDE THE PATH, because two fields below
 * now depend on which model this is rather than on what the caller asked for: a
 * tool behaviour one surface implements, and a language code one model accepts.
 * Both are facts about the model, so both are read from it.
 */
export function geminiSetup(
  model: ModelChoice,
  modelPath: string,
  language: LanguageChoice,
  instructions: string,
  settings: SessionSettings,
): Record<string, unknown> {
  /*
   * The language, where the model takes one and the language has a spelling.
   *
   * Both halves are conditional and neither is guessed. Native audio takes no
   * language code at all; a language whose BCP-47 spelling nobody has confirmed
   * carries no `liveCode`, and an unconfirmed spelling is a call that fails at
   * connect rather than one that mishears a word. Absent on either count means
   * the field is not sent, which is what every call did before this existed.
   * See languages.ts and acceptsLanguageCode in settings.ts.
   */
  const languageCode = acceptsLanguageCode(model) ? language.liveCode : undefined;

  const speechConfig = compact({
    voiceConfig: settings.voice
      ? { prebuiltVoiceConfig: { voiceName: settings.voice } }
      : undefined,
    languageCode,
  });

  const activityDetection = compact({
    startOfSpeechSensitivity: settings.startSensitivity,
    endOfSpeechSensitivity: settings.endSensitivity,
    prefixPaddingMs: settings.prefixPaddingMs,
    silenceDurationMs: settings.silenceDurationMs,
  });

  /*
   * Pinned rather than left to the provider, which is the one place this file
   * does that. The documented default is the value being sent — and the socket
   * disagrees with the documentation, loudly enough that a learner hears it.
   * See `thinkingLevelFor`, which carries the transcript.
   */
  const thinkingLevel = thinkingLevelFor(model);

  return {
    model: modelPath,
    generationConfig: compact({
      responseModalities: ['AUDIO'],
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      speechConfig: present(speechConfig) ? speechConfig : undefined,
      thinkingConfig: thinkingLevel ? { thinkingLevel } : undefined,
    }),
    systemInstruction: { parts: [{ text: instructions }] },
    tools: [{ functionDeclarations: [progressDeclaration(model)] }],
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
