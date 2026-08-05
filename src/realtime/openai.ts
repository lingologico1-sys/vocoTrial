import { addUsage, emptyUsage, type UsageTotals } from './cost';
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
  /** The conversation item the event belongs to — our transcript turn key. */
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  response?: { usage?: RealtimeUsage };
}

/**
 * What `response.done` reports. `cached_tokens` is a *subset* of the text and
 * audio input counts, not a seventh bucket — see reshapeUsage.
 */
interface RealtimeUsage {
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
    cached_tokens_details?: { text_tokens?: number; audio_tokens?: number };
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

/**
 * Turns one response's usage into disjoint billing buckets.
 *
 * Cached tokens are subtracted out of the counts that contain them, so nothing
 * is priced twice. When the API reports a `cached_tokens` total without the
 * per-modality split, the cached share is apportioned across text and audio in
 * the same ratio as the input itself — guessing "all audio" would misprice a
 * mini call, where cached text and cached audio are 5x apart.
 */
function reshapeUsage(usage: RealtimeUsage): UsageTotals {
  const input = usage.input_token_details ?? {};
  const output = usage.output_token_details ?? {};

  const text = input.text_tokens ?? 0;
  const audio = input.audio_tokens ?? 0;

  let cachedText = input.cached_tokens_details?.text_tokens ?? 0;
  let cachedAudio = input.cached_tokens_details?.audio_tokens ?? 0;

  if (!input.cached_tokens_details && input.cached_tokens) {
    const total = text + audio;
    const audioShare = total > 0 ? audio / total : 0;
    cachedAudio = Math.round(input.cached_tokens * audioShare);
    cachedText = input.cached_tokens - cachedAudio;
  }

  return {
    textInput: Math.max(0, text - cachedText),
    cachedTextInput: Math.min(cachedText, text),
    audioInput: Math.max(0, audio - cachedAudio),
    cachedAudioInput: Math.min(cachedAudio, audio),
    textOutput: output.text_tokens ?? 0,
    audioOutput: output.audio_tokens ?? 0,
  };
}

export async function startOpenAiSession(
  handlers: SessionHandlers,
  modelKey: string,
  language: string,
): Promise<VoiceSession> {
  handlers.onStatus('connecting');

  const { token, model } = await mintCredentials('openai', modelKey, language);

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

  // Kept so mute can put them back — replaceTrack(null) clears sender.track,
  // so the sender stops being its own record of what it was sending.
  const micTracks = mic.getAudioTracks();
  const micSenders = micTracks.map((track) => pc.addTrack(track, mic!));

  // Events (transcripts, turn boundaries, errors) ride this channel. It must
  // exist before the offer, or it will not be in the negotiated SDP.
  const events = pc.createDataChannel('oai-events');

  // Items whose transcript arrived as deltas, so the completion event knows not
  // to append the same words a second time.
  const streamed = new Set<string>();

  /**
   * Summed across responses, which is what the bill does too: every response
   * re-sends the whole conversation as input and is charged for it, discounted
   * where the prefix cached. Reporting only the last response would understate
   * a long call by most of its cost.
   */
  let usage = emptyUsage();

  events.onmessage = (message) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(message.data as string) as RealtimeEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case 'input_audio_buffer.committed':
        // Open the user's turn the moment their audio is closed off, which is
        // before the model starts answering. Transcription runs behind the
        // conversation — whisper-1 says nothing until the utterance is over —
        // so without a slot claimed here their words print under the reply.
        handlers.onTranscript({ id: event.item_id, role: 'user', text: '', done: false });
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (event.item_id) streamed.add(event.item_id);
        handlers.onTranscript({
          id: event.item_id,
          role: 'user',
          text: event.delta ?? '',
          done: false,
        });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        // Streaming models have already sent the words as deltas; whisper-1
        // sends none, and the whole utterance arrives here or not at all.
        handlers.onTranscript({
          id: event.item_id,
          role: 'user',
          text: event.item_id && streamed.has(event.item_id) ? '' : (event.transcript ?? ''),
          done: true,
        });
        break;
      case 'response.output_audio_transcript.delta':
        handlers.onTranscript({
          id: event.item_id,
          role: 'agent',
          text: event.delta ?? '',
          done: false,
        });
        break;
      case 'response.output_audio_transcript.done':
        handlers.onTranscript({ id: event.item_id, role: 'agent', text: '', done: true });
        handlers.onSpeaking?.(false);
        break;
      case 'input_audio_buffer.speech_started':
        // The user cut in; the model stops its own turn server-side.
        handlers.onSpeaking?.(false);
        break;
      case 'response.done':
        if (event.response?.usage) {
          usage = addUsage(usage, reshapeUsage(event.response.usage));
          handlers.onUsage?.(usage);
        }
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
    /**
     * Detaches the track from the sender rather than only disabling it.
     *
     * `track.enabled = false` mutes the *content* — WebRTC keeps the stream up
     * and transmits silence, which OpenAI still consumes and bills as audio
     * input at the full rate. Muting to pause a call therefore used to save
     * nothing. replaceTrack(null) stops the sender transmitting outright, and
     * needs no renegotiation, so the call survives the round trip.
     *
     * The Gemini path already behaved this way: MicCapture simply stops handing
     * chunks to the socket while muted.
     */
    setMuted: (muted) => {
      micSenders.forEach((sender, index) => {
        sender.replaceTrack(muted ? null : micTracks[index]).catch(() => {
          // The connection went away mid-toggle; cleanup handles the rest.
        });
      });
      // Also flip the track itself, so the browser's mic indicator is truthful.
      micTracks.forEach((track) => {
        track.enabled = !muted;
      });
    },
    stop: () => {
      cleanup();
      handlers.onStatus('closed');
    },
  };
}
