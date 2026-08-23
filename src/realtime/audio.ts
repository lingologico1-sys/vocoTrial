/**
 * The raw-PCM plumbing the Gemini Live socket needs in both directions.
 *
 * A WebRTC transport would do all of this inside the browser for free — which
 * is the trade the relay makes, and why this file exists at all.
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
 * What counts as the microphone hearing a voice, as RMS of full scale.
 *
 * Deliberately generous, because the two ways of being wrong here do not cost
 * the same. A false positive spends one lip press on a cough or a chair, which
 * is a gesture nobody can attribute to anything and nobody notices. A false
 * negative loses the press on somebody's actual answer, which is the whole
 * feature. So this sits low enough that a quiet speaker on a laptop mic clears
 * it, and the tuning that matters is the release below rather than this.
 *
 * getUserMedia is asked for automatic gain control, which does most of the work
 * of making one threshold serve every microphone: the constraint's job is to
 * put speech at a usable level whatever the hardware, and it is the reason a
 * fixed figure can be written down here at all.
 */
const VOICE_RMS = 0.02;

/**
 * How long the mic goes on counting as active after the sound drops, in ms.
 *
 * This is the number that decides whether an utterance is one event or twenty.
 * Speech is mostly silence — every stop consonant is a gap, and the pause
 * between two words is longer than either — so a bare threshold read off 128ms
 * chunks would report a voice starting and stopping several times a sentence.
 * Everything downstream wants "somebody is talking", not "there is energy in
 * this chunk".
 *
 * Sized like PAUSE_HOLD in headMotion.ts and for the same reason, which is
 * worth reading across: about a third of a second is where language stops and
 * hesitation begins, and this sits just past it so that a thinking pause inside
 * an answer does not end the answer. Longer would be safe here too — nothing
 * downstream cares when the voice *stops*, only when it starts, and the cost of
 * releasing late is only that a reply beginning within this window of the last
 * one is read as the same reply.
 */
const VOICE_RELEASE_MS = 600;

/**
 * Captures the microphone as 16 kHz int16 chunks, and says when it hears a voice.
 *
 * Asking the AudioContext for a 16 kHz sample rate makes the browser resample
 * the mic for us. Not every browser honours the request, so the real rate is
 * read back and reported — a mismatch is the first thing to check if the agent
 * hears chipmunks.
 *
 * The voice detection is a second job bolted to the first, and it is here
 * because this is the only place in the app that touches the input signal at
 * all. Every analyser in audio.ts and visemes.ts sits across the *output* graph,
 * measuring the agent; nothing measured the user until the face wanted to react
 * to them. Rather than open a second graph on the same stream, this reads the
 * chunks already passing through on their way to the socket — which costs one
 * pass over 2048 samples every 128ms and needs no new node, no new permission
 * and nothing from the provider.
 *
 * It reports a boolean rather than a level, and only when that boolean changes.
 * A level would be a value arriving eight times a second for the whole of a
 * call, and everything downstream of here is React state feeding a face that
 * goes to some trouble not to re-render while it has nothing to do.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private muted = false;
  private onVoice: ((active: boolean) => void) | null = null;
  /** Whether the last thing reported was a voice. */
  private voice = false;
  /** Milliseconds of chunks under VOICE_RMS since the last one over it. */
  private quietFor = 0;

  async start(
    onChunk: (pcm: ArrayBuffer) => void,
    onVoice?: (active: boolean) => void,
  ): Promise<void> {
    this.onVoice = onVoice ?? null;
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
      if (this.muted) return;
      const pcm = event.data as ArrayBuffer;
      // Measured before it is handed on, which is safe only because nothing
      // downstream detaches it — encodeBase64 copies. If that ever stops being
      // true this has to move ahead of the send rather than merely before it.
      this.listen(pcm);
      onChunk(pcm);
    };

    source.connect(this.node);
    // The worklet emits nothing, but an unconnected node is not pulled by the
    // graph in every engine, so terminate it at the destination to be sure it
    // runs. It contributes no sound.
    this.node.connect(this.context.destination);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // A muted mic hears nothing by definition, and saying so is not optional:
    // chunks stop arriving the moment this is set, so a gate left true would
    // stay true for the rest of the call with nothing able to lower it.
    if (muted) this.report(false);
    // Also stop the track, so the browser's own mic indicator is truthful.
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  stop(): void {
    this.report(false);
    this.onVoice = null;
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.node = null;
    this.stream = null;
    this.context = null;
  }

  /** One chunk's worth of "is anyone talking", with the release above on it. */
  private listen(pcm: ArrayBuffer): void {
    const samples = new Int16Array(pcm);
    if (samples.length === 0) return;

    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = Math.sqrt(energy / samples.length) / 0x8000;

    // Off the context's real rate rather than off INPUT_SAMPLE_RATE, because
    // the two differ on any browser that declined the constructor's request —
    // the same mismatch start() warns about, which would otherwise quietly
    // rescale the release.
    const chunkMs = (samples.length / (this.context?.sampleRate ?? INPUT_SAMPLE_RATE)) * 1000;

    if (rms >= VOICE_RMS) {
      this.quietFor = 0;
      this.report(true);
      return;
    }

    this.quietFor += chunkMs;
    if (this.quietFor >= VOICE_RELEASE_MS) this.report(false);
  }

  /** Reports a change and nothing else. */
  private report(active: boolean): void {
    if (active === this.voice) return;
    this.voice = active;
    this.onVoice?.(active);
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
   * already scheduled, or a prime ahead of now if the queue has drained.
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
  /**
   * The share of speech-band magnitude sitting above ROUNDING_SPLIT_HZ, 0 to 1.
   *
   * Null on the same terms as the centroid: no measurable sound, no share.
   *
   * A second opinion about the lips, and it exists because one number cannot
   * hold two articulations. Roundness and frontness move independently, and the
   * centroid collapses them onto one axis — so a front rounded vowel, /y/ in
   * French *tu* or German *über*, lands between /i/ and /u/ and gets read as
   * spread when it is the most protruded sound in the language. No threshold on
   * the centroid fixes that, because moving one to catch /y/ also catches /e/.
   *
   * What separates them is the third formant. Rounding drags F3 down hard — /y/
   * sits near 2100 where /e/ is near 2600 — so a split at 2.4 kHz puts the whole
   * of a rounded vowel's energy below it and leaves an unrounded one straddling.
   * This is that split, as a ratio rather than as a formant, because a ratio of
   * two sums is arithmetic already being done and formant tracking is not.
   *
   * Magnitude rather than energy, because the centroid beside it is
   * magnitude-weighted and one window should not be summed two ways.
   */
  highShare: number | null;
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

/**
 * Where the band is cut in two for `highShare`, in Hz.
 *
 * Sited above a rounded vowel's F3 and below an unrounded one's, which is the
 * whole trick — see EnvelopeSample.highShare. It lives beside SPEECH_BAND and
 * for the identical reason: both ways of measuring have to agree on it, or the
 * two drivers would differ by more than the timing they exist to compare.
 */
export const ROUNDING_SPLIT_HZ = 2400;

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
 * How far ahead of the clock a dry queue restarts, in seconds.
 *
 * Chunks were scheduled at `currentTime` itself the moment the queue ran dry,
 * which is a pipeline with no slack anywhere in it: a chunk arriving even
 * slightly later than the queue could cover became exactly that much silence in
 * the middle of a word. Worse, the playhead then re-anchored to now, so the
 * stream carried on with no lead at all and the next hiccup cost the same
 * again — which is why one audible seam in a call tends to mean several.
 *
 * This is the cushion that absorbs them, paid whenever the queue is empty: at
 * the start of a turn, and again after any hiccup that did get through. That
 * second case is the one that matters, because it makes a lost lead a rebuilt
 * lead rather than a lead gone for the rest of the call.
 *
 * The size is a straight trade of responsiveness for continuity, settled for a
 * tutor rather than for a conversation. A fifth of a second before the agent
 * starts talking is not something a learner can pick out; a seam in the middle
 * of the sentence they are trying to parse very much is. It is the number to
 * raise if a line turns out to need more, and the underrun logging below is
 * what says whether it does.
 */
const PRIME_SECONDS = 0.18;

/**
 * The longest dry spell still read as starvation rather than as a new turn.
 *
 * Only the logging needs the distinction — the schedule primes either way — but
 * an empty queue means opposite things either side of this, and a diagnostic
 * that cries starvation every time the learner takes their turn is worse than
 * no diagnostic. `endTurn` separates the two properly where it is called; this
 * is the backstop for a turn that ended some other way.
 */
const UNDERRUN_GAP_SECONDS = 1;

/** How much lower a lead must be than the last low-water mark to be worth a line. */
const LOW_WATER_STEP_SECONDS = 0.02;

/**
 * The lead below which a thinning queue is worth telling somebody about.
 *
 * Every drop goes to the console, because a developer with devtools open wants
 * the whole descent. The account of the call is read by somebody who is not a
 * developer and is looking for a fault, so it gets only the part that is one:
 * half the cushion eaten means the next hiccup is likely to be audible, and
 * that is worth a line whether or not anything has broken yet.
 */
const THIN_LEAD_SECONDS = PRIME_SECONDS / 2;

/**
 * A report that the output queue is running out, or has.
 *
 * IT EXISTS BECAUSE THE CONSOLE IS NOT WHERE THE FAULT IS SEEN. A pause in the
 * middle of the tutor's sentence is something the learner hears and nobody else
 * does — the student page has no devtools, and the person who could read a
 * console line is not the person in the room. So this goes out as an event on
 * the call's own timeline instead, where it lands *beside the turn it spoilt*
 * and reaches whoever reads the diagnostic afterwards. See CallEvent's `audio`
 * kind, and diagnostic.ts on why the timeline is the point.
 *
 * The two cases are one subject and opposite urgencies. `starved` already
 * happened and the learner heard it. `thin` has not happened yet and is the
 * warning that it is about to — which is the more useful of the two, because it
 * is the one that arrives while there is still a cushion to raise.
 */
export type AudioGap =
  | {
      /** The queue emptied mid-speech and the voice broke off. */
      kind: 'starved';
      /** How long the silence lasted, in ms. */
      ms: number;
      /** How many times this has happened so far in the call. */
      count: number;
    }
  | {
      /** The queue is still ahead, but by less than half the cushion. */
      kind: 'thin';
      /** The lead that is left, in ms. */
      ms: number;
    };

/**
 * Plays the 24 kHz int16 stream the model sends back.
 *
 * Chunks arrive faster than real time, so they are scheduled end to end on the
 * AudioContext clock rather than played on arrival — otherwise they overlap
 * into noise. Mostly faster, anyway: an empty queue starts a cushion ahead of
 * the clock rather than at it, so that the times they do not arrive in time are
 * absorbed instead of heard. See PRIME_SECONDS, and `watch` for how to tell
 * whether that is what you are hearing. `clear()` exists for barge-in: when the
 * user interrupts, audio already queued is no longer wanted and every pending
 * source is dropped.
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

  /** Whether the next chunk to arrive opens a new turn. Diagnostics only. */
  private awaitingTurn = true;
  /** How many times the queue has been starved mid-speech this call. */
  private underruns = 0;
  /**
   * The smallest lead seen all call, in seconds. Console only, and monotonic.
   *
   * Goes to zero and stays there once the queue has actually run dry, which is
   * correct for a worst-of-the-call mark and is also why it cannot be the thing
   * that decides whether to warn — see `episodeLow`.
   */
  private worstLead = Infinity;
  /**
   * The smallest lead since the queue was last at a full cushion, in seconds.
   *
   * THE WARNING NEEDS A MARK THAT CAN RISE AGAIN and the one above cannot. The
   * first version warned off the call's worst lead, which reads sensibly and is
   * silent for the rest of the call the moment anything goes wrong: an underrun
   * puts the worst mark on the floor, and nothing afterwards can ever be lower
   * than the floor. The first diagnostic taken with it had nine `starved` lines
   * and not one `thin`, because the warning that was supposed to arrive *before*
   * the trouble had been switched off by the trouble.
   *
   * So this resets whenever the queue gets back to a full cushion, and a
   * thinning that follows is a new episode with its own line. A queue hovering
   * below the prime does not spam, because it only resets on recovery.
   */
  private episodeLow = Infinity;

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

  /**
   * @param report Told when the queue thins or runs dry. Optional, and the
   * player works identically without it — a call with nobody listening is still
   * played correctly, it is only unexplained afterwards.
   */
  constructor(private readonly report?: (gap: AudioGap) => void) {
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
    return this.nextStart(context);
  }

  /**
   * When audio handed over right now would be heard.
   *
   * The single place the schedule is decided, which is what keeps the words on
   * the sound: the transcript stamps itself with `scheduledAt` and the audio is
   * started at this, so a prime that only one of them knew about would put the
   * first line of every turn on screen a fifth of a second early.
   */
  private nextStart(context: AudioContext): number {
    return this.playhead > context.currentTime
      ? this.playhead
      : context.currentTime + PRIME_SECONDS;
  }

  /**
   * Says the model has stopped speaking, so the next chunk opens a new turn.
   *
   * Only the diagnostics want this. The schedule does not care where a turn
   * begins — a dry queue is primed the same either way — but "empty because the
   * learner is talking" and "empty because the audio did not arrive in time"
   * are one measurement and opposite findings, and this is the bit that tells
   * them apart.
   */
  endTurn(): void {
    this.awaitingTurn = true;
  }

  /**
   * Notes what the queue looked like just before a chunk was scheduled.
   *
   * Nothing here changes a sample that is played. It is here because a pause
   * heard mid-sentence has three quite different causes and one measurement
   * separates them. A starved queue means the hole is ours — the network, the
   * relay hop, or a main thread too busy to hand the chunk over — and is worth
   * a louder prime. A queue that still had a healthy lead means the silence was
   * in the audio Google sent, and no amount of buffering will touch it.
   */
  private watch(context: AudioContext): void {
    // Nothing has played yet, or a barge-in threw the queue away.
    if (this.playhead === 0) return;

    // A turn boundary is an empty queue on purpose, and says nothing about the
    // transport. Spent whether or not this chunk turns out to have been late.
    const boundary = this.awaitingTurn;
    this.awaitingTurn = false;

    const lead = this.playhead - context.currentTime;
    if (lead >= 0) {
      const ms = Math.round(lead * 1000);

      // The whole descent, for a developer with devtools open.
      if (lead < this.worstLead - LOW_WATER_STEP_SECONDS) {
        console.info(`PcmPlayer: lead low-water ${ms}ms`);
      }
      this.worstLead = Math.min(this.worstLead, lead);

      // Back to a full cushion: whatever was happening is over, and the next
      // dip is a new episode that has earned a line of its own.
      if (lead >= PRIME_SECONDS) {
        this.episodeLow = Infinity;
        return;
      }

      // Only the part that is a fault reaches the call's account — see
      // THIN_LEAD_SECONDS.
      if (lead < THIN_LEAD_SECONDS && lead < this.episodeLow - LOW_WATER_STEP_SECONDS) {
        this.report?.({ kind: 'thin', ms });
      }
      this.episodeLow = Math.min(this.episodeLow, lead);
      return;
    }

    const gap = -lead;
    if (boundary || gap > UNDERRUN_GAP_SECONDS) return;

    this.underruns++;
    this.worstLead = 0;
    // The episode is over the moment it costs a hole: the queue re-primes from
    // here, and the descent that follows is worth warning about again.
    this.episodeLow = Infinity;
    const ms = Math.round(gap * 1000);
    console.warn(
      `PcmPlayer: underrun #${this.underruns} — queue dry for ${ms}ms ` +
        'mid-speech; that is the pause you heard.',
    );
    this.report?.({ kind: 'starved', ms, count: this.underruns });
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
    // Copied field by field rather than returned whole: an EnvelopeFrame also
    // carries the playback time it was measured at, which is this method's own
    // business and not something a mouth should be able to read.
    return { rms: best.rms, centroid: best.centroid, highShare: best.highShare };
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
    const split = Math.round(ROUNDING_SPLIT_HZ / binHz);

    let weighted = 0;
    let total = 0;
    let above = 0;
    for (let i = low; i <= high; i++) {
      const magnitude = Math.hypot(this.re[i], this.im[i]);
      weighted += magnitude * i * binHz;
      total += magnitude;
      if (i >= split) above += magnitude;
    }

    return {
      t,
      rms: Math.sqrt(energy / ENVELOPE_WINDOW),
      centroid: total > 1e-6 ? weighted / total : null,
      highShare: total > 1e-6 ? above / total : null,
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

    // Measured before it is decided, so the lead reported is the one this chunk
    // actually found rather than the one it is about to create.
    this.watch(context);
    // A dry queue restarts a cushion ahead of the clock rather than at it — see
    // PRIME_SECONDS. Anything still playing is simply followed on from.
    const startAt = this.nextStart(context);
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
    // A barge-in ends the turn as surely as finishing it does, and whatever the
    // model says next starts a new one from an empty queue on purpose.
    this.awaitingTurn = true;

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
