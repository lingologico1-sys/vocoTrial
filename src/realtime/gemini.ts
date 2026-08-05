import { MicCapture, PcmPlayer, decodeBase64, encodeBase64 } from './audio';
import { mintCredentials, type SessionHandlers, type VoiceSession } from './types';

/**
 * Gemini Live over the BidiGenerateContent WebSocket.
 *
 * Unlike the OpenAI path there is no WebRTC doing the media work, so this file
 * owns the whole loop: mic -> int16 -> base64 -> socket, and socket -> base64
 * -> int16 -> scheduled playback. See src/realtime/audio.ts for both halves.
 */

const WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

interface LiveMessage {
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  goAway?: { timeLeft?: string };
}

export async function startGeminiSession(handlers: SessionHandlers): Promise<VoiceSession> {
  handlers.onStatus('connecting');

  const { token, model } = await mintCredentials('gemini');

  const mic = new MicCapture();
  const player = new PcmPlayer();
  // Creating the output context inside the click that started the session is
  // what keeps autoplay policy from suspending it later.
  await player.resume();

  let stopped = false;
  const socket = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(token)}`);
  socket.binaryType = 'arraybuffer';

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    mic.stop();
    player.close();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };

  const ready = new Promise<void>((resolve, reject) => {
    socket.onopen = () => {
      // The model and the rest of the config are already bound to the token
      // server-side (liveConnectConstraints), so setup only has to name the
      // model. If Google ever rejects this as under-specified, mirror the
      // constraint config from functions/api/session/gemini.ts here verbatim —
      // it has to match what the token was minted with, not merely be valid.
      socket.send(JSON.stringify({ setup: { model: `models/${model}` } }));
    };

    socket.onerror = () => {
      reject(new Error('Could not reach the Gemini Live socket'));
    };

    socket.onclose = (event) => {
      if (!stopped) {
        // 1000 is a clean close; anything else ended the call unexpectedly and
        // the reason is the only clue the user gets.
        if (event.code === 1000) handlers.onStatus('closed');
        else handlers.onStatus('error', event.reason || `Socket closed (${event.code})`);
      }
      cleanup();
      reject(new Error(event.reason || 'Socket closed before setup completed'));
    };

    socket.onmessage = async (event) => {
      const raw =
        event.data instanceof Blob
          ? await event.data.text()
          : typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);

      let message: LiveMessage;
      try {
        message = JSON.parse(raw) as LiveMessage;
      } catch {
        return;
      }

      if (message.setupComplete) {
        handlers.onStatus('live');
        resolve();
        return;
      }

      const content = message.serverContent;
      if (!content) return;

      // Barge-in. Everything already queued is audio the user talked over, so
      // dropping it is the whole point — without this the agent keeps talking
      // for seconds after being interrupted.
      if (content.interrupted) {
        player.clear();
        handlers.onSpeaking?.(false);
      }

      if (content.inputTranscription?.text) {
        handlers.onTranscript({ role: 'user', text: content.inputTranscription.text, done: false });
      }

      if (content.outputTranscription?.text) {
        handlers.onTranscript({
          role: 'agent',
          text: content.outputTranscription.text,
          done: false,
        });
      }

      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (!data) continue;
        handlers.onSpeaking?.(true);
        player.enqueue(decodeBase64(data), () => handlers.onSpeaking?.(false));
      }

      if (content.turnComplete) {
        handlers.onTranscript({ role: 'user', text: '', done: true });
        handlers.onTranscript({ role: 'agent', text: '', done: true });
      }
    };
  });

  try {
    await ready;
  } catch (error) {
    cleanup();
    throw error;
  }

  try {
    await mic.start((pcm) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: { mimeType: 'audio/pcm;rate=16000', data: encodeBase64(pcm) },
          },
        }),
      );
    });
  } catch {
    cleanup();
    throw new Error('Microphone permission denied');
  }

  return {
    provider: 'gemini',
    setMuted: (muted) => mic.setMuted(muted),
    stop: () => {
      cleanup();
      handlers.onStatus('closed');
    },
  };
}
