/**
 * Mic capture for the Gemini Live socket.
 *
 * The Live API wants raw 16-bit PCM at 16 kHz. The resampling is not done
 * here — the AudioContext is constructed at 16 kHz so the browser's own
 * resampler handles it — leaving this worklet one job: float32 to int16.
 *
 * It batches into ~128 ms chunks before posting. A worklet fires every 128
 * samples (8 ms at 16 kHz), and one WebSocket frame per 8 ms is enough
 * overhead to be visible in latency; this trades a little delay for far
 * fewer frames.
 *
 * Lives in public/ rather than src/ because addModule() loads it by URL at
 * runtime, so it must be a real file on the origin, not a bundled module.
 */

const CHUNK_SAMPLES = 2048;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // No input yet (or the track was disabled) — keep the processor alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // Clamp before scaling: values outside [-1, 1] are legal in Web Audio
      // and would wrap around into loud noise once truncated to int16.
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      if (this.filled === CHUNK_SAMPLES) {
        // Copy, because the transfer detaches the buffer we keep writing into.
        const chunk = this.buffer.slice(0);
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
