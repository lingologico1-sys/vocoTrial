/**
 * The raw-PCM plumbing the Gemini Live socket needs in both directions.
 *
 * OpenAI's WebRTC transport does all of this inside the browser, which is why
 * only the Gemini path imports this file.
 */

/** Live API input rate. */
export const INPUT_SAMPLE_RATE = 16_000;
/** Live API output rate — different from the input, and not negotiable. */
export const OUTPUT_SAMPLE_RATE = 24_000;

export function encodeBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  // Chunked because String.fromCharCode(...arr) blows the argument limit on
  // anything longer than ~100 kB.
  const STEP = 0x8000;
  for (let i = 0; i < view.length; i += STEP) {
    binary += String.fromCharCode(...view.subarray(i, i + STEP));
  }
  return btoa(binary);
}

export function decodeBase64(value: string): Int16Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/**
 * Captures the microphone as 16 kHz int16 chunks.
 *
 * Asking the AudioContext for a 16 kHz sample rate makes the browser resample
 * the mic for us. Not every browser honours the request, so the real rate is
 * read back and reported — a mismatch is the first thing to check if the agent
 * hears chipmunks.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private muted = false;

  async start(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    if (this.context.sampleRate !== INPUT_SAMPLE_RATE) {
      console.warn(
        `Mic context runs at ${this.context.sampleRate} Hz, not ${INPUT_SAMPLE_RATE} Hz. ` +
          'Audio sent to Gemini will be pitched wrong.',
      );
    }

    await this.context.audioWorklet.addModule('/worklets/pcm-capture.js');

    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'pcm-capture');
    this.node.port.onmessage = (event) => {
      if (!this.muted) onChunk(event.data as ArrayBuffer);
    };

    source.connect(this.node);
    // The worklet emits nothing, but an unconnected node is not pulled by the
    // graph in every engine, so terminate it at the destination to be sure it
    // runs. It contributes no sound.
    this.node.connect(this.context.destination);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Also stop the track, so the browser's own mic indicator is truthful.
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.node = null;
    this.stream = null;
    this.context = null;
  }
}

/**
 * Plays the 24 kHz int16 stream the model sends back.
 *
 * Chunks arrive faster than real time, so they are scheduled end to end on the
 * AudioContext clock rather than played on arrival — otherwise they overlap
 * into noise. `clear()` exists for barge-in: when the user interrupts, audio
 * already queued is no longer wanted and every pending source is dropped.
 */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }
    return this.context;
  }

  /** Must be called from a user gesture, or playback stays suspended. */
  async resume(): Promise<void> {
    await this.ensureContext().resume();
  }

  enqueue(pcm: Int16Array, onDrained?: () => void): void {
    const context = this.ensureContext();

    const buffer = context.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    // A gap means the previous turn finished playing; restart from now rather
    // than scheduling in the past, which would play everything at once.
    const startAt = Math.max(context.currentTime, this.playhead);
    source.start(startAt);
    this.playhead = startAt + buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) onDrained?.();
    };
  }

  clear(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already ended between the interrupt and this call.
      }
    }
    this.sources.clear();
    this.playhead = 0;
  }

  close(): void {
    this.clear();
    void this.context?.close();
    this.context = null;
  }
}
