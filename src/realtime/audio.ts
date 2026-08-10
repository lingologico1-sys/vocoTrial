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
 * A read-only window onto the audio the user is hearing right now.
 *
 * Two things need it and neither can get there any other way. The mouth reads
 * the waveform, because the only reading that stays in sync is one taken from
 * the output graph itself — the PCM arrives seconds early (see `playhead`
 * below), so anything measured at arrival would animate ahead of the voice.
 * The transcript reads the clock, for the same reason in reverse: text deltas
 * also arrive early, and `scheduledAt` is what lets them be held back until the
 * audio they describe is actually audible.
 */
export interface AudioTap {
  /** Now, on the output graph's clock. The only clock the other two share. */
  now(): number;
  /**
   * When audio queued at this instant will be heard — the far end of what is
   * already scheduled, or now if the queue has drained.
   */
  scheduledAt(): number;
  /** Samples the audible waveform into `out`, centred on 128. */
  readWaveform(out: Uint8Array<ArrayBuffer>): void;
  /** Samples its spectrum into `out`, one byte per bin, DC first. */
  readSpectrum(out: Uint8Array<ArrayBuffer>): void;
  /** Length readWaveform expects — one byte per sample of the window. */
  readonly waveformSize: number;
  /** Length readSpectrum expects — half of waveformSize. */
  readonly binCount: number;
  /** Hz per spectrum bin, for reading a frequency off an index. */
  readonly binHz: number;
}

/**
 * Plays the 24 kHz int16 stream the model sends back.
 *
 * Chunks arrive faster than real time, so they are scheduled end to end on the
 * AudioContext clock rather than played on arrival — otherwise they overlap
 * into noise. `clear()` exists for barge-in: when the user interrupts, audio
 * already queued is no longer wanted and every pending source is dropped.
 *
 * Sources do not reach the speakers directly: they pass through a mixing node
 * so that an AnalyserNode can sit across the whole output rather than across
 * one chunk of it. Tapping individual sources would go silent in the gaps
 * between them and restart on every chunk boundary.
 */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private mix: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private playhead = 0;
  private sources = new Set<AudioBufferSourceNode>();

  /**
   * Sized for the mouth, which needs frequency resolution more than time
   * resolution: at 24 kHz this is ~23 Hz per bin, enough to place a spectral
   * centroid, over a 43 ms window that a 60 Hz animation frame comfortably
   * outruns.
   */
  private static readonly FFT_SIZE = 1024;

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.mix = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = PcmPlayer.FFT_SIZE;
      // Smoothing is left to the viseme mapper, which wants asymmetric attack
      // and release. Doing it twice, symmetrically, just adds lag.
      this.analyser.smoothingTimeConstant = 0;
      this.mix.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    return this.context;
  }

  /**
   * When audio queued right now will be heard.
   *
   * The queue runs ahead of real time, so this is how far ahead. Anything that
   * has to line up with a sound — the words that go with it, above all — stamps
   * itself with this and waits for the clock to reach it.
   */
  scheduledAt(): number {
    const context = this.context;
    if (!context) return 0;
    return Math.max(context.currentTime, this.playhead);
  }

  /**
   * The tap, or null before the context exists. Bound once and held: the nodes
   * behind it live as long as the player does.
   */
  tap(): AudioTap | null {
    const context = this.context;
    const analyser = this.analyser;
    if (!context || !analyser) return null;

    return {
      now: () => context.currentTime,
      scheduledAt: () => this.scheduledAt(),
      readWaveform: (out) => analyser.getByteTimeDomainData(out),
      readSpectrum: (out) => analyser.getByteFrequencyData(out),
      waveformSize: analyser.fftSize,
      binCount: analyser.frequencyBinCount,
      binHz: context.sampleRate / analyser.fftSize,
    };
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
    source.connect(this.mix ?? context.destination);

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
    this.mix = null;
    this.analyser = null;
  }
}
