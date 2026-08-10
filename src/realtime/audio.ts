/**
 * The raw-PCM plumbing the Gemini Live socket needs in both directions.
 *
 * OpenAI's WebRTC transport does all of this inside the browser, which is why
 * only the Gemini path imports this file.
 */

import { Fft } from './fft';

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
  /** Now, on the output graph's clock. The only clock everything here shares. */
  now(): number;
  /**
   * When audio queued at this instant will be heard — the far end of what is
   * already scheduled, or now if the queue has drained.
   */
  scheduledAt(): number;
  /**
   * How long audio takes to get from the graph to the ears.
   *
   * `now()` is the clock the graph renders on, not the clock the listener hears
   * on; the two are this far apart. Small on built-in speakers and very large
   * on Bluetooth, which is why anything claiming to be in sync has to subtract
   * it rather than assume it away.
   */
  outputLatency(): number;

  /** Samples the audible waveform into `out`, as floats in -1..1. */
  readWaveform(out: Float32Array<ArrayBuffer>): void;
  /** Samples its spectrum into `out`, in decibels, DC first. */
  readSpectrumDb(out: Float32Array<ArrayBuffer>): void;
  /** Length readWaveform expects — one entry per sample of the window. */
  readonly waveformSize: number;
  /** Length readSpectrumDb expects — half of waveformSize. */
  readonly binCount: number;
  /** Hz per spectrum bin, for reading a frequency off an index. */
  readonly binHz: number;

  /**
   * The measurement for a given moment of output, or null where no audio is
   * scheduled then.
   *
   * The one thing the analyser reads above cannot do: this can be asked about
   * the future, because the audio it describes has already arrived and is only
   * waiting its turn to play. See PcmPlayer's envelope.
   */
  sampleAt(time: number): EnvelopeSample | null;
}

/** One slice of audio, measured. */
export interface EnvelopeSample {
  /** Root-mean-square amplitude over the slice, 0 to 1. */
  rms: number;
  /** Spectral centroid in Hz, or null when there was too little to place one. */
  centroid: number | null;
}

/**
 * The band a speech centroid is measured over, in Hz.
 *
 * Below it is room rumble and the fundamental; above it is hiss that drags the
 * centroid around without saying anything about the mouth. Lives here rather
 * than with the mouth code because both ways of measuring have to agree on it,
 * or the two drivers would differ by more than the timing they exist to
 * compare.
 */
export const SPEECH_BAND = { lowHz: 200, highHz: 5000 };

/** Envelope resolution: one measurement per hop, over a window this wide. */
const ENVELOPE_HOP = 256;
const ENVELOPE_WINDOW = 512;
/** How much already-played envelope to keep. Only needed for a late lookup. */
const ENVELOPE_HISTORY_SECONDS = 0.5;
/** How far a lookup may miss a frame by before it counts as no audio at all. */
const ENVELOPE_TOLERANCE_SECONDS = 0.05;

interface EnvelopeFrame extends EnvelopeSample {
  /** Output-clock time of the *centre* of the window this measured. */
  t: number;
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

  /**
   * A measurement of every slice of audio, stamped with when it will be heard.
   *
   * Built as chunks arrive rather than as they play, which is what lets the
   * scheduled driver ask about sound that has not happened yet. Windows are
   * stamped at their centre, so a frame means "this is what the audio is doing
   * at that instant" rather than "this is what it has just finished doing".
   */
  private frames: EnvelopeFrame[] = [];
  private readonly fft = new Fft(ENVELOPE_WINDOW);
  private readonly hann = new Float32Array(ENVELOPE_WINDOW);
  private readonly re = new Float32Array(ENVELOPE_WINDOW);
  private readonly im = new Float32Array(ENVELOPE_WINDOW);
  /** Tail of the last chunk, so a window may straddle two of them. */
  private residue: Float32Array | null = null;
  /** Output-clock time of residue[0]. */
  private residueAt = 0;

  constructor() {
    for (let i = 0; i < ENVELOPE_WINDOW; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (ENVELOPE_WINDOW - 1)));
    }
  }

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
      outputLatency: () => context.outputLatency || 0,
      readWaveform: (out) => analyser.getFloatTimeDomainData(out),
      readSpectrumDb: (out) => analyser.getFloatFrequencyData(out),
      waveformSize: analyser.fftSize,
      binCount: analyser.frequencyBinCount,
      binHz: context.sampleRate / analyser.fftSize,
      sampleAt: (time) => this.sampleAt(time),
    };
  }

  /**
   * The measured frame nearest `time`, or null when nothing is scheduled there.
   *
   * Null is not an error — it is silence. Asking past the end of the queue is
   * the normal case between turns, and a mouth given null closes.
   */
  private sampleAt(time: number): EnvelopeSample | null {
    const frames = this.frames;
    if (frames.length === 0) return null;

    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (frames[mid].t < time) low = mid + 1;
      else high = mid;
    }

    // `low` is the first frame at or after the time asked for; the one before it
    // may still be the closer of the two.
    const after = frames[low];
    const before = low > 0 ? frames[low - 1] : null;
    const best =
      before && Math.abs(before.t - time) < Math.abs(after.t - time) ? before : after;

    if (Math.abs(best.t - time) > ENVELOPE_TOLERANCE_SECONDS) return null;
    return { rms: best.rms, centroid: best.centroid };
  }

  /**
   * Measures a chunk into overlapping windows and files them by playback time.
   *
   * The tail that does not fill a window is held over, so a window may span two
   * chunks — otherwise every chunk boundary would drop up to 21 ms of audio out
   * of the envelope, and Gemini sends a great many boundaries.
   */
  private measure(samples: Float32Array, startAt: number): void {
    const rate = OUTPUT_SAMPLE_RATE;

    let source = samples;
    let sourceAt = startAt;

    // Only join the tail on if this chunk really does continue the last one. A
    // gap means the queue drained or was cleared, and splicing across it would
    // date every frame that followed.
    const residue = this.residue;
    if (residue && Math.abs(this.residueAt + residue.length / rate - startAt) < 1e-6) {
      source = new Float32Array(residue.length + samples.length);
      source.set(residue, 0);
      source.set(samples, residue.length);
      sourceAt = this.residueAt;
    }

    let offset = 0;
    while (offset + ENVELOPE_WINDOW <= source.length) {
      const centre = sourceAt + (offset + ENVELOPE_WINDOW / 2) / rate;
      this.frames.push(this.analyse(source, offset, centre));
      offset += ENVELOPE_HOP;
    }

    this.residue = source.slice(offset);
    this.residueAt = sourceAt + offset / rate;

    const cutoff = (this.context?.currentTime ?? 0) - ENVELOPE_HISTORY_SECONDS;
    let stale = 0;
    while (stale < this.frames.length && this.frames[stale].t < cutoff) stale++;
    if (stale > 0) this.frames.splice(0, stale);
  }

  /** One window: loudness from the samples, brightness from their spectrum. */
  private analyse(source: Float32Array, offset: number, t: number): EnvelopeFrame {
    let energy = 0;
    for (let i = 0; i < ENVELOPE_WINDOW; i++) {
      const sample = source[offset + i];
      energy += sample * sample;
      // Windowed for the transform, but the loudness is taken off the raw
      // samples: a Hann window would quietly shrink every reading by a third.
      this.re[i] = sample * this.hann[i];
      this.im[i] = 0;
    }

    this.fft.transform(this.re, this.im);

    const binHz = OUTPUT_SAMPLE_RATE / ENVELOPE_WINDOW;
    const low = Math.max(1, Math.floor(SPEECH_BAND.lowHz / binHz));
    const high = Math.min(ENVELOPE_WINDOW / 2 - 1, Math.ceil(SPEECH_BAND.highHz / binHz));

    let weighted = 0;
    let total = 0;
    for (let i = low; i <= high; i++) {
      const magnitude = Math.hypot(this.re[i], this.im[i]);
      weighted += magnitude * i * binHz;
      total += magnitude;
    }

    return {
      t,
      rms: Math.sqrt(energy / ENVELOPE_WINDOW),
      centroid: total > 1e-6 ? weighted / total : null,
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
    // Measured before it is scheduled, so the envelope is ready the moment the
    // audio is — a lookahead that arrived after the sound would be no lookahead.
    this.measure(channel, startAt);
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

    // Everything measured beyond now describes audio that was just thrown away
    // unplayed. Leaving it would let the mouth go on speaking the interrupted
    // sentence — the same mistake, in pictures, that reveal.ts avoids in words.
    const now = this.context?.currentTime ?? 0;
    let keep = this.frames.length;
    while (keep > 0 && this.frames[keep - 1].t > now) keep--;
    this.frames.length = keep;
    this.residue = null;
  }

  close(): void {
    this.clear();
    void this.context?.close();
    this.context = null;
    this.mix = null;
    this.analyser = null;
    this.frames = [];
    this.residue = null;
  }
}
