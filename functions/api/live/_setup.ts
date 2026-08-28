/**
 * Turns the neutral settings in src/realtime/settings.ts into each provider's
 * own session payload.
 *
 * This lives server-side, beside the relays that send it, for the same reason
 * _resolve.ts does: the browser sends what it wants, and the Worker decides
 * what that means upstream. Keeping the translation here also means each API's
 * spelling — nesting, casing, which knob exists at all — is confined to one
 * file instead of leaking into the UI.
 *
 * IT PREDICTED ITS OWN FUTURE AND THE PREDICTION HELD. This was
 * _providerConfig.ts, translating for two providers; the note left behind when
 * OpenAI Realtime went said that if a second provider ever returned, this is
 * the file that would grow a sibling function rather than the panel growing a
 * branch. That is exactly what `openAiSession` below is.
 *
 * Every branch is conditional. An absent setting produces an absent field, not
 * a field set to a value we believe is the default: see the note on
 * SessionSettings for why that distinction is load-bearing.
 */

import {
  acceptsLanguageCode,
  reasoningEffortFor,
  thinkingLevelFor,
  type SessionSettings,
} from '../../../src/realtime/settings';
import type { LanguageChoice } from '../../../src/realtime/languages';
import type { GoogleModel, OpenAiModel } from '../../../src/realtime/models';
import { PROGRESS_TOOL } from '../../../src/realtime/tutorPrompt';
import { MAX_KEYWORDS } from '../../../src/realtime/vocoSessions';

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
const PROGRESS_DESCRIPTION =
  "Record that one question from the system instructions is finished: the learner has just answered it, in at least a full sentence. Call it at the top of the turn you are taking in response to that answer — not after you have replied, and not in a later turn, which for the last question on the list never comes. Pass that question's number in the list, counting from 1, once per question as you go. Bookkeeping only: it is never spoken about and produces no reply to read out.";

const PROGRESS_ARGUMENT =
  'Which question in the list has been answered, counting from 1.';

function progressDeclaration(model: GoogleModel) {
  return {
    name: PROGRESS_TOOL,
    description: PROGRESS_DESCRIPTION,
    parameters: {
      type: 'OBJECT',
      properties: {
        number: {
          type: 'INTEGER',
          description: PROGRESS_ARGUMENT,
        },
      },
      required: ['number'],
    },
    ...(model.surface === 'aistudio' ? { behavior: 'NON_BLOCKING' } : {}),
  };
}

/**
 * The same tool for OpenAI, which is the same tool and a different spelling.
 *
 * THE DESCRIPTION IS SHARED VERBATIM AND THAT IS DELIBERATE. Everything the
 * long note above argues about where the standard lives and whose behaviour it
 * describes is a fact about how a model reads a tool at the moment it decides
 * to call one. None of it is Google's.
 *
 * WHAT DOES NOT CARRY OVER IS `behavior: 'NON_BLOCKING'`, because there is
 * nothing here for it to unblock. On this API a function call is an item in a
 * response the model has already finished; returning its output never restarts
 * generation on its own. The doubled turn that flag exists to prevent cannot
 * happen, so the flag has no counterpart rather than a renamed one. See the
 * tool handling in src/realtime/openai.ts, which decides whether to ask for a
 * further turn instead of trying to suppress one.
 *
 * Lowercase JSON Schema types, against Gemini's uppercase enum. The one
 * genuinely cosmetic difference between the two, and the one most likely to be
 * copied wrong.
 */
function openAiProgressTool() {
  return {
    type: 'function',
    name: PROGRESS_TOOL,
    description: PROGRESS_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        number: {
          type: 'integer',
          description: PROGRESS_ARGUMENT,
        },
      },
      required: ['number'],
      additionalProperties: false,
    },
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
  model: GoogleModel,
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

/**
 * The rate OpenAI's realtime API accepts raw PCM at, and the only one.
 *
 * Not negotiable and not a preference: `audio/pcm` is documented at 24000 Hz
 * alone, with G.711 at 8000 as the only alternative and no 16000 anywhere. So
 * the microphone runs at a different rate on this provider than on Gemini,
 * which is why MicCapture takes a rate rather than reading a module constant.
 * See INPUT_SAMPLE_RATE in src/realtime/audio.ts.
 */
export const OPENAI_INPUT_RATE = 24_000;

/**
 * The rate the tutor's own audio comes back at.
 *
 * REQUIRED, NOT ASSUMED. `audio.output.format` is refused without a `rate` —
 * `Missing required parameter: 'session.audio.output.format.rate'` — so naming
 * the format at all commits us to naming the rate with it, unlike Gemini where
 * the output rate is fixed and unspoken.
 *
 * It is the same 24000 as the input side, but it is a different fact: this one
 * has to equal OUTPUT_SAMPLE_RATE in src/realtime/audio.ts, which is the rate
 * the AudioContext playing these frames was opened at. A mismatch is not an
 * error anywhere — it is a tutor speaking too fast or too slow, at the wrong
 * pitch, with nothing in the log to say why.
 */
export const OPENAI_OUTPUT_RATE = 24_000;


/**
 * Builds the `session.update` payload for OpenAI's realtime API.
 *
 * SENT AFTER THE SOCKET OPENS RATHER THAN WITH IT, which is the one structural
 * difference from Gemini's `setup`. Google takes its configuration as the first
 * frame and refuses everything until it has one; OpenAI opens a session on the
 * model named in the query string and then accepts updates to it. The relay
 * sends this once, immediately, and the effect is the same — see
 * functions/api/live/openai.ts, which also says why the browser may not send
 * one itself.
 *
 * `keywords` carries the words the transcriber should expect. They are separate
 * from `instructions` on purpose: the composed prompt is thousands of
 * characters of style and rules, and keywords drawn from it would be mostly
 * noise. See `keywords` on SessionConfig. Where they land on the wire depends
 * on which transcriber is running — see `takesKeywords` below, which is the
 * difference between a biased transcript and a socket that refuses to open.
 */
export function openAiSession(
  model: OpenAiModel,
  language: LanguageChoice,
  instructions: string,
  settings: SessionSettings,
  keywords: string[] = [],
): Record<string, unknown> {
  /*
   * The hint is on unless it was explicitly turned off. `language` stops the
   * transcriber hedging between languages, which is the failure that costs a
   * learner the most: a hesitant French sentence decoded as English comes back
   * as plausible nonsense rather than as a mistake they can see. `prompt` is a
   * style hint conditioned on as though it were the transcript leading up to
   * the audio — see `sample` in languages.ts, which was kept through the last
   * removal for exactly this field.
   *
   * PLAIN ISO-639-1, AND THAT IS THE WHOLE OF THE SPELLING PROBLEM HERE. The
   * Gemini side needs BCP-47 with a region and carries a `liveCode` filled in
   * only where Google publishes one, because a guessed region fails at connect.
   * This takes the code every LanguageChoice already has.
   */
  const hinted = settings.transcriptionHint !== false;

  /*
   * WHICH TRANSCRIBER IS RUNNING DECIDES WHERE THE LESSON'S WORDS GO.
   *
   * `keywords` is a field on the diarizing transcriber alone. Sent to
   * whisper-1 or to either gpt-4o-transcribe, the session update comes back
   * `The 'keywords' parameter is not supported for this model.` and the socket
   * never goes live — the whole lesson is lost, not the bias. That is what
   * happened on 2026-08-28: five dials, five errors, a learner talking into a
   * page with nothing on the other end.
   *
   * So the words are folded into `prompt` instead wherever `keywords` is not
   * accepted. That is not a downgrade to a second-best field: `prompt`
   * conditions the transcriber as though it were the transcript leading up to
   * the audio, so a line of the lesson's own vocabulary is exactly the bias
   * `keywords` was asked for — see `sample` in languages.ts, whose style hint
   * leads the same string.
   */
  const transcriptionModel = settings.transcriptionModel ?? 'whisper-1';
  const takesKeywords = transcriptionModel.includes('diarize');
  const words = keywords.slice(0, MAX_KEYWORDS);

  /*
   * The sample first, the lesson's words after it, and either half alone is a
   * usable hint. The diarizing transcriber takes no prompt at all, so it gets
   * none — its words went to `keywords` above.
   */
  const prompt = takesKeywords
    ? undefined
    : [hinted ? language.sample : '', words.join(', ')]
        .filter((part) => part.length > 0)
        .join(' ') || undefined;

  const transcription = compact({
    /*
     * whisper-1 unless asked otherwise, and it is a pin rather than a default
     * left upstream — the exception this file otherwise does not make.
     *
     * Input transcription has to be configured at all or the API returns audio
     * with no record of what the learner said, and the transcript pane, the
     * vocabulary list and the end-of-lesson report all read that record. Since
     * something must be named, the batch model is named: it transcribes the
     * whole utterance, so the end of a sentence can disambiguate its start,
     * which is precisely where a learner is hardest to read. The streaming
     * models show words sooner and commit to each guess before hearing what
     * follows. TranscriptDelta carries an `id` for exactly this reason — a
     * transcript arriving after the tutor has already answered still lands in
     * the turn it belongs to.
     */
    model: transcriptionModel,
    language: hinted ? language.code : undefined,
    prompt,
    keywords: takesKeywords && words.length ? words : undefined,
  });

  /*
   * One detector or the other, never fields from both.
   *
   * Semantic VAD takes no threshold and no clocks — it decides on whether the
   * turn sounds finished — so sending them alongside it would be describing a
   * mechanism that is not running. The panel already hides them (see `requires`
   * in settings.ts); this is the half that matters, because a published lesson
   * can carry values pinned before the mode was switched.
   */
  const turnDetection =
    settings.vadMode === 'semantic_vad'
      ? compact({ type: 'semantic_vad', eagerness: settings.vadEagerness })
      : compact({
          type: 'server_vad',
          threshold: settings.vadThreshold,
          prefix_padding_ms: settings.prefixPaddingMs,
          silence_duration_ms: settings.silenceDurationMs,
        });

  /*
   * A bare `{ type: 'server_vad' }` carries no information the default does not
   * already, so it is only worth sending once something else is set with it.
   * `standard` patience sends nothing at all, and this is what keeps that true.
   */
  const sendTurnDetection =
    settings.vadMode !== undefined ||
    settings.vadEagerness !== undefined ||
    settings.vadThreshold !== undefined ||
    settings.prefixPaddingMs !== undefined ||
    settings.silenceDurationMs !== undefined;

  const input = compact({
    format: { type: 'audio/pcm', rate: OPENAI_INPUT_RATE },
    transcription: present(transcription) ? transcription : undefined,
    noise_reduction: settings.noiseReduction ? { type: settings.noiseReduction } : undefined,
    turn_detection: sendTurnDetection ? turnDetection : undefined,
  });

  const output = compact({
    format: { type: 'audio/pcm', rate: OPENAI_OUTPUT_RATE },
    voice: settings.voice,
    /*
     * The lesson's pace, as a rate rather than as a request. PACE in
     * tutorPrompt.ts composes prose asking the tutor to slow down, and its own
     * note states the limitation plainly: an instruction is followed rather
     * than obeyed, and you cannot read a payload back to check it took. This
     * can be read back. Both go out — the prose shortens sentences and
     * simplifies words, which a playback rate cannot — and the publish route is
     * what turns one teacher control into the two of them.
     */
    speed: settings.speed,
  });

  const effort = reasoningEffortFor(model);

  return {
    type: 'realtime',
    model: model.id,
    instructions,
    // Audio only, matching Gemini's responseModalities. The API refuses both at
    // once, and a text turn is a turn the learner cannot hear.
    output_modalities: ['audio'],
    audio: compact({
      input: present(input) ? input : undefined,
      output: present(output) ? output : undefined,
    }),
    tools: [openAiProgressTool()],
    tool_choice: 'auto',
    ...compact({
      reasoning: effort ? { effort } : undefined,
      max_output_tokens: settings.maxOutputTokens,
    }),
  };
}
