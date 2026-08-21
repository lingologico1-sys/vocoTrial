import type { SessionSettings } from './settings';
import type { UsageTotals } from './cost';
import type { AudioTap } from './audio';

export type { AudioTap };

/**
 * What the user configured, on its way to Google.
 *
 * Both fields are optional and both are the client's to write — see
 * instructions.ts on why the prompt is no longer server-only. Neither one
 * chooses a model or a language: those still travel as keys the Worker looks
 * up, because they are what decide the spend.
 */
export interface SessionConfig {
  instructions?: string;
  settings?: SessionSettings;
}

export type SessionStatus = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

export interface TranscriptDelta {
  role: 'user' | 'agent';
  /**
   * Which turn the text belongs to. Transcription can lag well behind the
   * conversation — a batch model only transcribes the user once they stop
   * talking, by which point the agent has answered — so a delta carrying an id
   * lands in that turn wherever it already sits in the log. Without one it can
   * only extend the turn still open at the end.
   */
  id?: string;
  /** Text to append to that turn. */
  text: string;
  /** True when the turn is finished and the next delta starts a new one. */
  done: boolean;
  /**
   * When this text will be *heard*, on the session's AudioTap clock.
   *
   * Only the agent side. Its audio is queued seconds ahead of real time, and
   * the transcript arrives on the same socket without waiting for it, so text
   * rendered on arrival races the voice. A consumer that wants them together
   * holds each delta until `tap.now()` reaches this.
   *
   * Absent means "no better information than now": render it immediately.
   */
  at?: number;
}

export interface SessionHandlers {
  onStatus: (status: SessionStatus, detail?: string) => void;
  onTranscript: (delta: TranscriptDelta) => void;
  /** The agent started or stopped speaking — drives the level indicator. */
  onSpeaking?: (speaking: boolean) => void;
  /**
   * The microphone started or stopped hearing a voice.
   *
   * The one signal here that describes the user rather than the agent, and the
   * only one measured locally rather than reported upstream. Google offers
   * nothing usable: it says nothing at all about input until the transcript
   * arrives, which is after the utterance rather than at the start of it. See
   * MicCapture, which measures the chunks already on their way out.
   *
   * Debounced at the source — see VOICE_RELEASE_MS — so this is "somebody is
   * talking" and not "there is energy in this chunk".
   */
  onVoice?: (active: boolean) => void;
  /**
   * The user talked over the agent, and every unplayed sound was dropped.
   *
   * Distinct from onSpeaking(false), which also fires when a turn simply ends.
   * Anything holding agent output back to match the audio — see `at` above —
   * has to discard what it was holding here, or it will go on to display words
   * that were cut off and never spoken.
   */
  onInterrupted?: () => void;
  /**
   * Running totals for the call so far, pushed every time Google reports usage
   * rather than once at the end. A call that dies mid-flight never sends a
   * final figure, so the last push is the only record we get to keep.
   */
  onUsage?: (usage: UsageTotals) => void;
  /**
   * The model called a tool — any tool, by whatever name, before anything has
   * been made of it.
   *
   * THE RAW EVENT, AND THAT IS THE ENTIRE POINT. `onQuestionDone` below is an
   * interpretation: it fires for one name and is silent for every other, which
   * means a model calling a tool this build does not implement produces no
   * signal anywhere. That is not a hypothetical gap. A prompt that asks for a
   * tool which no longer exists gets called anyway, every call is answered
   * because an unanswered one leaves a tutor silent, and on a surface without
   * non-blocking calls each answer restarts the model into a turn spoken on top
   * of the last — so the learner hears every question twice, and nothing in the
   * account of the call says why.
   *
   * Fires for every call in the frame, including the recognised one, so the
   * account carries what actually arrived rather than what was understood. What
   * is done about a call is a separate line in the log from the call itself, and
   * a gap between the two is exactly the sort of thing worth being able to see.
   *
   * `args` is whatever the model sent, unvalidated. It is for reading, not for
   * acting on: a diagnostic that can print `questionDone {"number":1}` twice in
   * four seconds has answered the question a transcript cannot.
   */
  onToolCall?: (name: string, args?: Record<string, unknown>) => void;
  /**
   * The tutor reported that one more question on its list has been answered.
   *
   * The only structured thing a call ever says about its own progress — see
   * _setup.ts on why it is a tool rather than something read out of the
   * transcript, and PROGRESS_TOOL in tutorPrompt.ts on why there is one of
   * these per question rather than a single claim at the end.
   *
   * THE TUTOR'S CLAIM AND NOT A FACT, and this is the layer that says so
   * loudest: it fires for whatever the model sent, unfiltered and uncounted.
   * A model can report a question the learner deflected, report the same one
   * twice, report five in a single turn, or send a number that is not on the
   * list at all. Deciding which of those to believe is useVoiceCall's job —
   * see `acceptProgress` — and the separation is deliberate, because the run
   * that prompted it was a lesson ended by one unexamined tool call.
   *
   * `number` is the question's position in the list, counting from 1, or
   * undefined when the model called the tool without one.
   */
  onQuestionDone?: (number: number | undefined) => void;
}

/**
 * The handle a page holds on a running call.
 *
 * There is one implementation — startGeminiSession. It stayed an interface
 * after OpenAI Realtime was removed because two pages consume it and neither
 * should have to know how the socket works, not because a second transport is
 * expected back.
 */
export interface VoiceSession {
  setMuted: (muted: boolean) => void;
  stop: () => void;
  /**
   * Says something to the tutor as though the learner had said it, without it
   * appearing in the transcript.
   *
   * The only way to steer a call already in progress. The clock lives in the
   * page — a model cannot see one and invents elapsed time when asked to — so
   * when the lesson's minutes are up, the page is what tells the tutor to
   * close. See LESSON_DONE_SIGNAL and TIME_UP_SIGNAL in tutorPrompt.ts.
   *
   * Not shown to the learner and not recorded: the transcript is built from
   * `inputTranscription`, which is what the microphone heard, and this never
   * goes near the microphone. So the report reads a conversation that ended
   * naturally rather than one with a stage direction in the middle of it.
   */
  say: (text: string) => void;
  /** The agent's audio output, for anything that has to move in time with it. */
  readonly tap?: AudioTap | null;
}
