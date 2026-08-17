import type { Provider } from './models';
import type { SessionSettings } from './settings';
import type { UsageTotals } from './cost';
import type { AudioTap } from './audio';
import { UnauthorizedError, reportExpired } from './auth';

export type { Provider };
export type { AudioTap };

/**
 * What the user configured, on its way to a provider.
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
   * Only the agent side, and only where the transport schedules its own
   * playback — which today means Gemini. Its audio is queued seconds ahead of
   * real time, and the transcript arrives on the same socket without waiting
   * for it, so text rendered on arrival races the voice. A consumer that wants
   * them together holds each delta until `tap.now()` reaches this.
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
   * only one measured locally rather than reported by the provider. Neither
   * provider offers it in a usable form: OpenAI's `speech_started` is tied to
   * its server VAD committing a buffer, and Gemini says nothing at all about
   * input until the transcript arrives, which is after the utterance rather
   * than at the start of it. See MicCapture, which measures the chunks already
   * on their way out.
   *
   * Debounced at the source — see VOICE_RELEASE_MS — so this is "somebody is
   * talking" and not "there is energy in this chunk". Absent on transports that
   * never see the input samples, which today means the WebRTC path.
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
   * Running totals for the call so far, pushed every time the provider reports
   * usage rather than once at the end. A call that dies mid-flight never sends
   * a final figure, so the last push is the only record we get to keep.
   */
  onUsage?: (usage: UsageTotals) => void;
}

/**
 * What both providers reduce to. OpenAI rides WebRTC and Gemini rides a
 * WebSocket, but App.tsx only ever holds one of these.
 */
export interface VoiceSession {
  readonly provider: Provider;
  setMuted: (muted: boolean) => void;
  stop: () => void;
  /**
   * The agent's audio output, for anything that has to move in time with it.
   * Absent on transports that play their own audio out of reach — WebRTC hands
   * the stream to an element, so the OpenAI path has nothing to offer here.
   */
  readonly tap?: AudioTap | null;
}

export interface SessionCredentials {
  token: string;
  model: string;
  expiresAt: number | null;
}

/**
 * Asks our own Pages Function for a short-lived credential. Neither provider
 * key exists in this bundle; this is the only way the client gets to speak to
 * either API.
 */
export async function mintCredentials(
  provider: Provider,
  modelKey: string,
  language: string,
  config: SessionConfig = {},
): Promise<SessionCredentials> {
  const response = await fetch(`/api/session/${provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Keys for the model and the language, never the ids themselves — the
    // Worker owns both mappings. See models.ts and languages.ts. The prompt and
    // the settings do travel as written, and are validated on arrival by
    // functions/api/session/_resolve.ts.
    body: JSON.stringify({ model: modelKey, language, ...config }),
  });

  if (!response.ok) {
    let message = `Session request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error page — the status alone is the best we can say.
    }

    // The cookie lapsed or was cleared. Send the user back to the gate rather
    // than reporting this as a session failure they can do nothing about.
    if (response.status === 401) {
      reportExpired();
      throw new UnauthorizedError(message);
    }

    throw new Error(message);
  }

  return (await response.json()) as SessionCredentials;
}
