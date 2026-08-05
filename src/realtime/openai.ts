import { mintCredentials, type SessionHandlers, type VoiceSession } from './types';

/**
 * OpenAI Realtime over WebRTC.
 *
 * WebRTC does the hard parts for us — mic capture, Opus encoding, jitter
 * buffering, playback — so this file is mostly plumbing: get a token from our
 * Worker, trade an SDP offer for an answer, attach the remote track to an
 * <audio> element. Echo cancellation matters more than it looks: without it
 * the agent hears itself through the speakers and interrupts its own turn.
 */

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
}

export async function startOpenAiSession(
  handlers: SessionHandlers,
  modelKey: string,
): Promise<VoiceSession> {
  handlers.onStatus('connecting');

  const { token, model } = await mintCredentials('openai', modelKey);

  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;

  let mic: MediaStream | null = null;
  let stopped = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    mic?.getTracks().forEach((t) => t.stop());
    pc.close();
    audio.srcObject = null;
  };

  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0];
    handlers.onSpeaking?.(true);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') handlers.onStatus('live');
    if (pc.connectionState === 'failed') {
      handlers.onStatus('error', 'The peer connection failed');
      cleanup();
    }
    if (pc.connectionState === 'closed' && !stopped) {
      handlers.onStatus('closed');
      cleanup();
    }
  };

  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    cleanup();
    throw new Error('Microphone permission denied');
  }

  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

  // Events (transcripts, turn boundaries, errors) ride this channel. It must
  // exist before the offer, or it will not be in the negotiated SDP.
  const events = pc.createDataChannel('oai-events');
  events.onmessage = (message) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message.data as string) as RealtimeEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case 'conversation.item.input_audio_transcription.delta':
        handlers.onTranscript({ role: 'user', text: event.delta ?? '', done: false });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        handlers.onTranscript({ role: 'user', text: '', done: true });
        break;
      case 'response.output_audio_transcript.delta':
        handlers.onTranscript({ role: 'agent', text: event.delta ?? '', done: false });
        break;
      case 'response.output_audio_transcript.done':
        handlers.onTranscript({ role: 'agent', text: '', done: true });
        handlers.onSpeaking?.(false);
        break;
      case 'input_audio_buffer.speech_started':
        // The user cut in; the model stops its own turn server-side.
        handlers.onSpeaking?.(false);
        break;
      case 'error':
        handlers.onStatus('error', event.error?.message ?? 'Realtime error');
        break;
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const answer = await fetch(`${CALLS_URL}?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    body: offer.sdp,
    headers: {
      // The ephemeral secret, not the account key — see functions/api/session/openai.ts.
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/sdp',
    },
  });

  if (!answer.ok) {
    cleanup();
    throw new Error(`OpenAI refused the connection (${answer.status})`);
  }

  await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });

  return {
    provider: 'openai',
    setMuted: (muted) => {
      mic?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    stop: () => {
      cleanup();
      handlers.onStatus('closed');
    },
  };
}
