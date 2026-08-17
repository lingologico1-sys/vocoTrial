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
  /** The agent's audio output, for anything that has to move in time with it. */
  readonly tap?: AudioTap | null;
}
