import type { Provider } from './models';
import type { SessionSettings } from './settings';
import type { UsageTotals } from './cost';
import { UnauthorizedError, reportExpired } from './auth';

export type { Provider };

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
}

export interface SessionHandlers {
  onStatus: (status: SessionStatus, detail?: string) => void;
  onTranscript: (delta: TranscriptDelta) => void;
  /** The agent started or stopped speaking — drives the level indicator. */
  onSpeaking?: (speaking: boolean) => void;
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
