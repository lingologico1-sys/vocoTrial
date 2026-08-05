export type Provider = 'openai' | 'gemini';

export type SessionStatus = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

export interface TranscriptDelta {
  role: 'user' | 'agent';
  /** Text to append to that role's current turn. */
  text: string;
  /** True when the turn is finished and the next delta starts a new one. */
  done: boolean;
}

export interface SessionHandlers {
  onStatus: (status: SessionStatus, detail?: string) => void;
  onTranscript: (delta: TranscriptDelta) => void;
  /** The agent started or stopped speaking — drives the level indicator. */
  onSpeaking?: (speaking: boolean) => void;
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
export async function mintCredentials(provider: Provider): Promise<SessionCredentials> {
  const response = await fetch(`/api/session/${provider}`, { method: 'POST' });

  if (!response.ok) {
    let message = `Session request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error page — the status alone is the best we can say.
    }
    throw new Error(message);
  }

  return (await response.json()) as SessionCredentials;
}
