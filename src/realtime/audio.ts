/**
 * The raw-PCM plumbing both live sockets need in both directions.
 *
 * A WebRTC transport would do all of this inside the browser for free — which
 * is the trade both relays make, and why this file exists at all. See
 * functions/api/live/openai.ts, which had the WebRTC option and declined it
 * because every instrument in here reads the samples.
 */

import { Fft } from './fft';

/**
 * Gemini Live's input rate.
 *
 * IT USED TO BE THE INPUT RATE, FULL STOP, and the rename is the whole of what
 * changed here. Gemini takes `audio/pcm;rate=16000`; OpenAI documents
 * `audio/pcm` at 24000 alone, with G.711 at 8000 as the only alternative and no
 * 16000 anywhere. So the rate is a property of the session rather than of this
 * module, and MicCapture is told which one it is running at.
 */
export const GEMINI_INPUT_RATE = 16_000;

/** Both providers emit 24 kHz. Different from Gemini's input, and not negotiable. */
export const OUTPUT_SAMPLE_RATE = 24_000;

/**
 * Bytes of microphone audio that carry one second of speech, at a given rate.
 *
 * The worklet emits mono int16 — two bytes a sample, one channel — so this is
 * the exact divisor that turns a byte count back into seconds. Used for the
 * sent-audio accounting, which is the only honest way to compare "how long the
 * microphone was open" against "how much of it actually left this browser".
 * See pcm-capture.js for the int16, and MicSpan for what it is compared with.
 */
export const bytesPerSecondAt = (rate: number): number => rate * 2;

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
 * Captures the microphone as int16 chunks at the rate it is told, and says when
 * it hears a voice.
 *
 * Asking the AudioContext for a sample rate makes the browser resample the mic
 * for us. Not every browser honours the request, so the real rate is read back
 * and reported — a mismatch is the first thing to check if the agent hears
 * chipmunks. Worth knowing that the two rates are not equally likely to be
 * honoured: 24 kHz is far closer to what hardware actually runs at than 16 kHz,
 * so the OpenAI path asks for less than the Gemini one does.
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
  /**
   * The rate this capture was asked for, which is not necessarily the one it
   * got — see `bytesPerSecond`, which prefers the rate the context actually
   * runs at.
   */
  constructor(private readonly rate: number) {}

  /**
   * The divisor that turns this capture's byte count into seconds of speech.
   *
   * OFF THE CONTEXT'S REAL RATE WHEREVER THERE IS ONE, for the reason `listen`
   * below reads it: a browser that declined the constructor's request is
   * producing samples at a rate this module did not choose, and a byte count
   * divided by the rate we asked for would be wrong by exactly the ratio the
   * warning is about. The requested rate is the fallback for the window before
   * the context exists, where no bytes have been counted anyway.
   */
  get bytesPerSecond(): number {
    return bytesPerSecondAt(this.context?.sampleRate ?? this.rate);
  }

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private muted = false;
  /**
   * Whether the uplink is shut because the tutor is the one talking.
   *
   * NOT `muted`, AND THE DIFFERENCE IS THE WHOLE REASON THERE ARE TWO. A mute
   * is a statement about the microphone: the track is disabled, the browser's
   * own indicator goes out, and `listen` below never runs, so the voice gate
   * reports silence for as long as it lasts. That is right for the end of a
   * lesson, which is the only thing that mutes.
   *
   * This is a statement about the *socket*. The capture keeps running and keeps
   * being measured — `call.heard` is load-bearing while a call is live, and the
   * quiet check that closes a finished lesson waits on it — and the only thing
   * withheld is the frame that would have gone to the provider. What the
   * learner said over the tutor is therefore still visible to this page and
   * still invisible to the model, which is exactly the asymmetry wanted: the
   * stray word cannot become their answer, and the face still knows they spoke.
   *
   * WHY NOT DISABLE THE TRACK. Two reasons, and the second is the one that
   * would have hurt. The mic indicator flickering on and off through every
   * question reads as a bug; and the browser's echo canceller loses its
   * reference signal when the track goes, so the first frames after each
   * question would arrive uncancelled — which is the failure this gate is
   * being built to prevent, reintroduced at the one moment it matters most.
   */
  private gated = false;
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

    this.context = new AudioContext({ sampleRate: this.rate });
    if (this.context.sampleRate !== this.rate) {
      console.warn(
        `Mic context runs at ${this.context.sampleRate} Hz, not ${this.rate} Hz. ` +
          'Audio sent to the model will be pitched wrong.',
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
      // Above the gate on purpose: a gated chunk is still heard by this page,
      // and only the provider is spared it. See `gated`.
      if (this.gated) return;
      onChunk(pcm);
    };

    source.connect(this.node);
    // The worklet emits nothing, but an unconnected node is not pulled by the
    // graph in every engine, so terminate it at the destination to be sure it
    // runs. It contributes no sound.
    this.node.connect(this.context.destination);
  }

  /**
   * Shuts or opens the uplink, leaving the capture itself alone.
   *
   * Idempotent, and called that way — the close arrives once per audio chunk
   * off the socket and the open once per turn, and neither caller tracks which
   * of those it has already said.
   */
  setGated(gated: boolean): void {
    this.gated = gated;
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

    // Off the context's real rate rather than off the requested one, because
    // the two differ on any browser that declined the constructor's request —
    // the same mismatch start() warns about, which would otherwise quietly
    // rescale the release.
    const chunkMs = (samples.length / (this.context?.sampleRate ?? this.rate)) * 1000;

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
 * tutor rather than for a conversation. A third of a second before the agent
 * starts talking is not something a learner can pick out; a seam in the middle
 * of the sentence they are trying to parse very much is.
 *
 * This is only where a call *starts*, though. It was a fifth of a second and a
 * constant, and the logging it was written to invite came back and said so: one
 * lesson over the relay produced eight `starved` lines, several of them most of
 * a second long, on a path that never once got the queue back to a full
 * cushion. A fixed cushion is a bet on how bad the worst hop of the call will
 * be, and there is no figure that both wins that bet on a Chromebook in
 * Vancouver relayed through us-central1 and stays out of the way on a good
 * line. So the bet is not made: this is the opening guess, and PRIME_STEP_SECONDS
 * is how it is corrected by what actually happens.
 *
 * IT WENT 0.18 TO 0.32 TO 0.6 AND BACK, AND THE REVERSAL IS THE ENTRY WORTH
 * READING. The 06:54 diagnostic on 2026-08-28 was diagnosed correctly and
 * treated wrongly: a clean path underneath — the relay leg 14ms at best and
 * 20ms at worst over 19 samples — four starvations anyway, and `thin` lines
 * descending gradually (79, 120, 61, 187, 235, 80) rather than falling off a
 * cliff. That reading still stands. A gradual descent is a supply rate a
 * little under playback, not a main thread that hitched.
 *
 * THE ERROR WAS ANSWERING IT WITH A WIDER CUSHION. A cushion buys cover against
 * a chunk that arrives *late*; against a supply rate under playback it is spent
 * and gone, and all it decides is how far into the turn the first hole falls.
 * The 14:08 run the same day settled it outright. The cushion was 600ms and the
 * queue ran dry three times anyway — 348ms, 355ms and 512ms — every hole
 * smaller than the lead that was supposed to absorb it. Jitter of that size
 * against 600ms of slack is not audible at all; these were, because the slack
 * had already been eaten by the time they arrived. One sentence came out in
 * four fragments.
 *
 * So the cushion goes back to about where it was before any of this, and the
 * deficit case is handed to the instrument that can actually see it: the
 * ratchet now fires only on the cliff, and this is the opening guess for a path
 * whose jitter is unknown. What a cushion cannot do is manufacture audio that
 * was never sent, and no figure here will make a model that speaks slower than
 * real time speak faster.
 */
const BASE_PRIME_SECONDS = 0.3;

/**
 * How much the cushion grows each time the queue is starved mid-speech.
 *
 * A hole in the audio *can* be the transport saying the cushion was too small,
 * and where it is, this is the correction: each such starvation adds this to
 * the prime for the rest of the call, so a path that stalls once has more slack
 * the next time and a path that stalls repeatedly climbs until it stops.
 *
 * ONLY WHERE IT IS, THOUGH, WHICH IS THE PART THAT WAS MISSING. A hole can also
 * be the model supplying audio slower than it is played, and the two want
 * opposite treatments: widening the cushion against a deficit makes every later
 * hole bigger and every turn start later while absorbing nothing. `watch` is
 * where they are told apart, and it is the only caller of this. See the cliff
 * test there, and BASE_PRIME_SECONDS for the run that forced the distinction.
 *
 * It never comes back down inside a call. A quiet stretch is not evidence the
 * path improved, only that nothing has been asked of it lately, and lowering
 * the cushion on that reasoning is how you arrive back at the hole you just
 * paid for. The price of holding a cushion that turned out to be generous is a
 * slightly later start to each turn, which nobody hears; the price of dropping
 * it too early is another seam mid-sentence, which everybody does.
 *
 * A WHOLE CALL IS A DIFFERENT MATTER, and `close` spends one step of this back.
 * See learnedPrimeSeconds: a quiet stretch proves nothing, but a call that ran
 * start to finish without a hole is the strongest evidence about this path
 * available anywhere in the app.
 */
const PRIME_STEP_SECONDS = 0.16;

/**
 * Where the growth stops.
 *
 * Past about a second the cushion has stopped being latency the learner
 * tolerates and started being a tutor that seems not to have heard them. A path
 * this bad is a fault to report rather than one to buffer around, and the
 * timeline is already reporting it — every step of the climb is on the call's
 * account, in `starved` lines that say what the cushion was raised to.
 */
const MAX_PRIME_SECONDS = 1;

/**
 * The widest cushion any call on this page has had to buy, in seconds.
 *
 * THE CLIMB USED TO DIE WITH THE CALL AND THE PATH DID NOT. Every player began
 * at BASE_PRIME_SECONDS on the reasoning that "the thing being measured is this
 * connection on this evening and not the browser" — which is right about what
 * the measurement *means* and wrong about when it stops being true. A learner
 * who redials after a bad call is on the same Chromebook, the same school
 * uplink and the same region, thirty seconds later. Starting the guess over
 * makes them pay for the same three or four audible holes again to relearn a
 * number the last call already worked out.
 *
 * So the ratchet outlives the player. It is bounded by MAX_PRIME_SECONDS, and
 * — now that the climb answers jitter alone rather than any hole at all — what
 * it carries between calls is a fact about this uplink, which is exactly the
 * kind of fact that survives a redial.
 *
 * IT IS NO LONGER MONOTONIC, AND THAT IS THE 14:08 LESSON. The first version
 * only ever rose, and on 2026-08-28 it climbed 600 → 760 → 920 → 1000ms inside
 * a single turn, thirty seconds into a lesson, off three sub-second holes that
 * were a supply deficit and not jitter at all. From there every remaining turn
 * of the tab — including any redial — would have opened on a full second of
 * silence, with nothing in the app able to lower it short of a page reload.
 * Narrowing the climb to the cliff case fixes most of that; a value that can
 * only ever rise fixes none of it, because one bad minute still pins the tab.
 *
 * So `close` gives a step back after any call that never starved. That is not
 * the "quiet stretch" PRIME_STEP_SECONDS refuses to read anything into — it is
 * a complete call, the largest sample this app ever takes of a path, and a
 * cushion this app cannot climb down from is worse than one that guesses low
 * and is corrected within the turn.
 *
 * MODULE STATE AND NOT STORAGE, DELIBERATELY. It lasts as long as the tab, so a
 * lesson dialled again after a stall inherits it and a fresh visit tomorrow
 * does not. Persisting it would be claiming that a bad evening predicts a bad
 * morning, and nothing here has ever measured that.
 */
let learnedPrimeSeconds = BASE_PRIME_SECONDS;

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
 *
 * A fraction rather than a figure, because the cushion moves. What counts as a
 * thin queue on a path that has already been given a second of slack is not
 * what counts as one at the opening prime, and a fixed threshold would go
 * quiet exactly as the cushion grew past it.
 */
const THIN_LEAD_FRACTION = 0.5;

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
      /**
       * The cushion the queue will restart on from here, in ms.
       *
       * Reported because the climb is the interesting part of a bad call: three
       * starvations at a cushion that never moved and three at a cushion that
       * doubled between them are different faults, and only this tells them
       * apart on a timeline read after the fact.
       */
      primeMs: number;
      /**
       * Which of the two faults this hole was, as `watch` read it.
       *
       * THE QUESTION A READER OF THIS TIMELINE ACTUALLY HAS. `jitter` is a
       * chunk that did not turn up in time — ours, in the sense that the path
       * or the browser is where it went wrong, and the cushion above is the
       * answer to it. `supply` is the model handing back audio slower than it
       * is played, which no cushion reaches; the lead was already thin when the
       * hole arrived, and the cushion deliberately does not move.
       *
       * It is on the wire rather than inferred from `primeMs` standing still,
       * because a cushion already at MAX_PRIME_SECONDS also stands still and
       * the two mean opposite things. Without this the timeline can show a
       * stalling lesson and not say whose fault it is, which is the single most
       * useful thing it knows.
       */
      cause: 'jitter' | 'supply';
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
 * absorbed instead of heard. See BASE_PRIME_SECONDS, and `watch` for how to tell
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
  /**
   * When the turn now being spoken was scheduled to *start*, on the context
   * clock, and how much of it has been queued since. See `heardMs`.
   */
  private turnStartAt = 0;
  private turnSeconds = 0;
  private sources = new Set<AudioBufferSourceNode>();

  /** Whether the next chunk to arrive opens a new turn. Diagnostics only. */
  private awaitingTurn = true;
  /** How many times the queue has been starved mid-speech this call. */
  private underruns = 0;
  /**
   * The cushion a dry queue currently restarts on, in seconds.
   *
   * Climbs by PRIME_STEP_SECONDS with every starvation, to MAX_PRIME_SECONDS.
   * It opens at whatever the last call on this tab had to climb to rather than
   * at BASE_PRIME_SECONDS — see `learnedPrimeSeconds`, which is where the
   * reasoning for outliving one player is.
   */
  private prime = learnedPrimeSeconds;
  /**
   * The smallest lead seen all call, in seconds. Console only, and monotonic.
   *
   * Goes to zero and stays there once the queue has actually run dry, which is
   * correct for a worst-of-the-call mark and is also why it cannot be the thing
   * that decides whether to warn — see `episodeLow`.
   */
  private worstLead = Infinity;
  /**
   * The lead the chunk before this one found, in seconds. The cliff test.
   *
   * WHAT SEPARATES A LATE CHUNK FROM A SLOW SUPPLY, and the whole reason the
   * ratchet can now decline to fire. Both end in an empty queue and they sound
   * identical to the learner, but the approach differs completely: a supply
   * rate under playback eats the lead a little at a time, so the chunk before
   * the hole already found a thin queue, while a chunk that was simply late
   * arrives after a healthy one. One measurement tells them apart, and it is
   * this one.
   *
   * Infinity at the start of a call is read as healthy on purpose. No previous
   * chunk means no evidence of a descent, and the ratchet's own bound is what
   * limits the cost of guessing wrong once.
   */
  private lastLead = Infinity;
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
      : context.currentTime + this.prime;
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
   * How much of the turn now being spoken has actually been heard, in ms.
   *
   * WHAT IT IS FOR IS TELLING THE MODEL WHAT IT ACTUALLY SAID. OpenAI's
   * `conversation.item.truncate` takes the point in an assistant turn that the
   * listener got to, and cuts its own record there. Without it the model's
   * memory of the conversation contains every sentence it generated, including
   * the two seconds still sitting in this queue when the learner talked over
   * it — so a tutor asks "as I was saying about the weekend" about a clause
   * nobody heard, and no amount of prompting fixes it because the transcript it
   * is reasoning from is wrong.
   *
   * GEMINI HAS NO SUCH MESSAGE, which is why this did not exist until there was
   * a second provider. Its `interrupted` frame is the server telling us it has
   * already decided; there is no channel back. That is a real difference in how
   * accurate a long lesson's context stays, and it is invisible until you look
   * for it.
   *
   * CLAMPED AT BOTH ENDS, because both ends happen. Below zero while the
   * cushion is still ahead of the clock — a barge-in during the prime means
   * nothing was heard at all — and above the queued length if this is somehow
   * called after the turn drained, where the honest answer is "all of it".
   */
  heardMs(): number {
    const context = this.context;
    if (!context || !this.turnStartAt) return 0;
    const played = context.currentTime - this.turnStartAt;
    return Math.round(Math.min(Math.max(played, 0), this.turnSeconds) * 1000);
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
    // Read before it is overwritten, and overwritten on every path out of here:
    // the cliff test below is a comparison between this chunk and the one
    // before it, so the record has to advance whether or not anything is wrong.
    const previous = this.lastLead;
    this.lastLead = lead;

    if (lead >= 0) {
      const ms = Math.round(lead * 1000);

      // The whole descent, for a developer with devtools open.
      if (lead < this.worstLead - LOW_WATER_STEP_SECONDS) {
        console.info(`PcmPlayer: lead low-water ${ms}ms`);
      }
      this.worstLead = Math.min(this.worstLead, lead);

      // Back to a full cushion: whatever was happening is over, and the next
      // dip is a new episode that has earned a line of its own.
      if (lead >= this.prime) {
        this.episodeLow = Infinity;
        return;
      }

      // Only the part that is a fault reaches the call's account — see
      // THIN_LEAD_FRACTION.
      const thin = this.prime * THIN_LEAD_FRACTION;
      if (lead < thin && lead < this.episodeLow - LOW_WATER_STEP_SECONDS) {
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

    /*
     * Whether this hole is the transport's or the model's.
     *
     * A CLIFF IS A CHUNK THAT DID NOT TURN UP: the queue was healthy right up
     * to the moment it was empty, which is jitter, and jitter is the one thing
     * a cushion can actually absorb. A hole reached down a queue that was
     * already thin is the other case — the lead was being eaten steadily, which
     * is a supply rate under playback, and no cushion covers a deficit that
     * never stops accumulating.
     *
     * THE SAME THRESHOLD THE WARNING USES, deliberately. `thin` is already this
     * file's statement of "low enough that the next hiccup will be heard", and
     * a second threshold here would be a second opinion about the same queue
     * that could disagree with the line already on the learner's timeline.
     */
    const cliff = previous >= this.prime * THIN_LEAD_FRACTION;

    /**
     * The correction, and the only place the cushion ever climbs.
     *
     * IT IS PAID FOR JITTER AND NOT FOR A DEFICIT, which is what `cliff` above
     * decides. A cushion is cover against a chunk that arrives late; against a
     * model supplying audio slower than it is played it is spent before the
     * hole arrives, buys nothing, and costs the width of every later hole plus
     * a later start to every turn. On 2026-08-28 at 14:08 that bill came in
     * full: 600ms of cushion, three holes anyway at 348, 355 and 512ms — each
     * one smaller than the lead that was supposed to absorb it — and a climb to
     * the 1000ms ceiling inside a single turn, thirty seconds into the lesson.
     *
     * So a hole approached down a thinning queue changes nothing. It is still
     * counted, still warned about, still on the call's timeline where somebody
     * can read it; it simply is not evidence about the cushion, because the
     * cushion is not what failed.
     *
     * The climb, when it does happen, is applied *before* the chunk that found
     * the queue dry is scheduled — `watch` runs first in `enqueue` for exactly
     * this reason — so the audio that resumes after the hole already resumes on
     * the wider cushion. Waiting until the next dry queue would spend the whole
     * of this turn proving the old cushion wrong a second time.
     */
    if (cliff) {
      this.prime = Math.min(MAX_PRIME_SECONDS, this.prime + PRIME_STEP_SECONDS);
      // Carried past the end of this call, so the next one on this tab opens
      // where this one finished rather than paying for the climb again.
      learnedPrimeSeconds = Math.max(learnedPrimeSeconds, this.prime);
    }

    const ms = Math.round(gap * 1000);
    const primeMs = Math.round(this.prime * 1000);
    const cause = cliff ? 'jitter' : 'supply';
    console.warn(
      `PcmPlayer: underrun #${this.underruns} — queue dry for ${ms}ms ` +
        `mid-speech; that is the pause you heard. ${
          cliff
            ? `A chunk arrived late off a healthy queue, so the cushion is now ${primeMs}ms.`
            : `The queue was already thin, so this is supply and not jitter; the ` +
              `cushion stays at ${primeMs}ms because widening it would not have helped.`
        }`,
    );
    this.report?.({ kind: 'starved', ms, count: this.underruns, primeMs, cause });
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
    // BASE_PRIME_SECONDS. Anything still playing is simply followed on from.
    // The `watch` above is what may just have widened that cushion, so the
    // order of these two lines is the adaptation: this chunk resumes on the
    // corrected prime rather than on the one that failed.
    const startAt = this.nextStart(context);
    // The first chunk after a turn boundary anchors the turn's own clock; the
    // rest only extend its length. `awaitingTurn` is read here before `watch`
    // above has a chance to matter, and cleared by `watch` itself — so this
    // reads it off the queue instead: an empty queue is a new turn.
    if (this.sources.size === 0) {
      this.turnStartAt = startAt;
      this.turnSeconds = 0;
    }
    this.turnSeconds += buffer.duration;
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
    // Read before this by whoever is about to send a truncate — see heardMs.
    this.turnStartAt = 0;
    this.turnSeconds = 0;
    // A barge-in ends the turn as surely as finishing it does, and whatever the
    // model says next starts a new one from an empty queue on purpose.
    this.awaitingTurn = true;
    // The lead measured before a queue that was thrown away says nothing about
    // the one that replaces it, and the cliff test would read it as a descent.
    this.lastLead = Infinity;

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
    /*
     * A whole call without a hole gives a step of the cushion back.
     *
     * THE ONE PLACE THE RATCHET DESCENDS, and the sample is what earns it.
     * PRIME_STEP_SECONDS refuses to read anything into a quiet stretch mid-call
     * — rightly, since nothing may have been asked of the path lately — but a
     * call that ran start to finish and never once ran dry is the largest
     * measurement this app ever takes of a connection, and treating it as no
     * evidence at all is what left `learnedPrimeSeconds` pinned at its ceiling
     * for the life of a tab off three sub-second holes.
     *
     * ONE STEP AND NOT A RESET. The climb is bounded and slow on the way up, so
     * the way down is too: a path that really is bad reaches its cushion again
     * in a hole or two, and a path that has recovered walks back to the base
     * over a few calls rather than losing everything it learned at the first
     * quiet lesson.
     */
    if (this.underruns === 0) {
      learnedPrimeSeconds = Math.max(BASE_PRIME_SECONDS, learnedPrimeSeconds - PRIME_STEP_SECONDS);
    }
    this.clear();
    void this.context?.close();
    this.context = null;
    this.mix = null;
    this.analyser = null;
    this.frames = [];
    this.residue = null;
  }
}
