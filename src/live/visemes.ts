import { SPEECH_BAND, type AudioTap } from '../realtime/audio';

/**
 * Turning the sound of a voice into a mouth shape.
 *
 * The whole method rests on one property: it listens to audio and never reads
 * text. No letters, no phonemes, no per-language tables — so English, French
 * and Spanish work identically, and a language nobody planned for works too.
 * The mouth is only ever as good as the voice; it is never worse because of
 * what language the voice is speaking.
 *
 * Two measurements drive it, on the theory that a mouth does two things:
 *
 *   how far it opens   <- loudness (RMS)
 *   how round it is    <- brightness (spectral centroid)
 *
 * Three openings times two roundnesses is six shapes, which is the sweet spot:
 * expressive enough to read as speech, coarse enough that the measurement can
 * actually tell the states apart. It collapses to loudness-only when the
 * spectrum is too quiet to trust, and the six names below are standard visemes,
 * so hand-drawn art can replace the generated shapes without touching any of
 * this.
 */

export type Viseme = 'rest' | 'mbp' | 'ee' | 'uh' | 'aa' | 'oh';

/**
 * A mouth as three numbers, in the coordinate space of MOUTH_BOX.
 *
 * Parameters rather than path strings because two shapes built the same way can
 * be interpolated between, and a mouth that eases between targets looks far
 * more like speech than one that snaps. The six named entries are still the
 * only states the analyser reports — the easing is presentation.
 */
export interface LipShape {
  /** Half the mouth's width. */
  w: number;
  /** How far the upper lip rises above the centre line. */
  up: number;
  /** How far the lower lip drops below it. */
  down: number;
}

/**
 * The box every mouth is drawn in, and the contract for replacing them.
 *
 * Art authored to these bounds — same size, same alignment, mouth centred —
 * drops straight into the face with no repositioning, which is the whole reason
 * the number is written down rather than inlined into the path maths.
 */
export const MOUTH_BOX = { width: 80, height: 50 };

const CX = MOUTH_BOX.width / 2;
const CY = MOUTH_BOX.height / 2;

export const VISEMES: Record<Viseme, LipShape> = {
  /** Silence. Closed, faintly upturned, so a listening face is not a dead one. */
  rest: { w: 19, up: 1.4, down: 2.8 },
  /** The closed consonants. Wider and flatter than rest — lips pressed, not slack. */
  mbp: { w: 23, up: 0.9, down: 1.6 },
  /** Spread and half open: "ee", and the sibilants that share its brightness. */
  ee: { w: 27, up: 4, down: 5.5 },
  /** Rounded and half open: "uh", "l". */
  uh: { w: 15, up: 6, down: 7.5 },
  /** Spread and wide: "aa". */
  aa: { w: 23, up: 10, down: 14 },
  /** Rounded and wide: "oh", "oo". */
  oh: { w: 12, up: 12, down: 15 },
};

/** Magic constant for approximating a quarter ellipse with a cubic Bézier. */
const KAPPA = 0.5523;

/**
 * A lip shape as an SVG path.
 *
 * Four cubics — left corner, top, right corner, bottom — so every shape has an
 * identical command structure. That is what lets one shape be interpolated into
 * another without the path re-parsing into something else halfway.
 */
export function lipPath({ w, up, down }: LipShape): string {
  const kw = w * KAPPA;
  const ku = up * KAPPA;
  const kd = down * KAPPA;
  const r = (n: number) => Math.round(n * 100) / 100;

  return [
    `M ${r(CX - w)} ${r(CY)}`,
    `C ${r(CX - w)} ${r(CY - ku)} ${r(CX - kw)} ${r(CY - up)} ${r(CX)} ${r(CY - up)}`,
    `C ${r(CX + kw)} ${r(CY - up)} ${r(CX + w)} ${r(CY - ku)} ${r(CX + w)} ${r(CY)}`,
    `C ${r(CX + w)} ${r(CY + kd)} ${r(CX + kw)} ${r(CY + down)} ${r(CX)} ${r(CY + down)}`,
    `C ${r(CX - kw)} ${r(CY + down)} ${r(CX - w)} ${r(CY + kd)} ${r(CX - w)} ${r(CY)}`,
    'Z',
  ].join(' ');
}

/** What the analyser reports each frame. */
export interface MouthFrame {
  /** Which of the six states the sound is in. The part hand-drawn art replaces. */
  viseme: Viseme;
  /** That state's shape, eased toward rather than snapped to. */
  shape: LipShape;
  /** Smoothed loudness, 0 to 1, for anything that should move with emphasis. */
  level: number;
}

/**
 * The two measurements a mouth is made of, however they were obtained.
 *
 * Everything downstream — the running peak, the smoothing, the thresholds, the
 * hold — works off this pair and nothing else. That is what makes the two
 * drivers below comparable: they differ in *when* the numbers describe, and in
 * nothing else.
 */
export interface Features {
  /** Root-mean-square amplitude, 0 to 1. */
  rms: number;
  /** Spectral centroid in Hz, or null when there was too little to place one. */
  centroid: number | null;
}

export interface FeatureSource {
  read(): Features;
}

export type MouthDriver = 'reactive' | 'scheduled';

/**
 * Reactive: measure the audio as it goes past.
 *
 * An AnalyserNode across the output, read once per animation frame. Simple, and
 * it needs to know nothing about how the audio got there — it would work
 * unchanged on a WebRTC stream. Its limit is structural: the window it reports
 * on has already been rendered, so the reading is of sound that has happened,
 * and it can never be asked about sound that has not.
 */
export function reactiveFeatures(tap: AudioTap): FeatureSource {
  const waveform = new Float32Array(tap.waveformSize);
  const spectrum = new Float32Array(tap.binCount);
  const low = Math.max(1, Math.floor(SPEECH_BAND.lowHz / tap.binHz));
  const high = Math.min(tap.binCount - 1, Math.ceil(SPEECH_BAND.highHz / tap.binHz));

  return {
    read(): Features {
      tap.readWaveform(waveform);
      let energy = 0;
      for (let i = 0; i < waveform.length; i++) energy += waveform[i] * waveform[i];
      const rms = Math.sqrt(energy / waveform.length);

      tap.readSpectrumDb(spectrum);
      let weighted = 0;
      let total = 0;
      for (let i = low; i <= high; i++) {
        // Back to linear magnitude. The analyser reports decibels, and a
        // centroid weighted by decibels is not the same centroid — the log
        // scale lifts quiet high bins until they drag it upwards. The scheduled
        // driver measures linear magnitude, so this has to as well or the two
        // would disagree about roundness for a reason that is not timing.
        const magnitude = 10 ** (spectrum[i] / 20);
        weighted += magnitude * i * tap.binHz;
        total += magnitude;
      }

      return { rms, centroid: total > 1e-6 ? weighted / total : null };
    },
  };
}

/**
 * Scheduled: measure the audio before it plays, and read it back on the clock.
 *
 * The envelope is computed in PcmPlayer as chunks arrive, stamped with when
 * each slice will be heard. This looks the current moment up in it, which buys
 * two things the analyser cannot offer. The reading is centred on the instant
 * asked about rather than trailing it, and the instant asked about may be in
 * the future — so the mouth can begin a shape before the sound arrives, which
 * is what real articulation does and what animators do by hand.
 *
 * `outputLatency` is subtracted because `now()` is when the graph renders, not
 * when anyone hears it. Left in, the mouth would lead by however far the
 * speakers are behind — a few milliseconds wired, a great deal over Bluetooth.
 *
 * @param lookahead Seconds to run ahead by, read fresh so it can be tuned live.
 */
export function scheduledFeatures(tap: AudioTap, lookahead: () => number): FeatureSource {
  return {
    read(): Features {
      const sample = tap.sampleAt(tap.now() - tap.outputLatency() + lookahead());
      // Nothing scheduled at that moment is not a failure; it is silence.
      return sample ?? { rms: 0, centroid: null };
    },
  };
}

/** Below this share of the running peak, treat the frame as silence. */
const SILENCE = 0.12;
/** Openness thresholds, as a share of the running peak. */
const MID = 0.3;
const WIDE = 0.62;

/** Centroid, in Hz, below which a vowel reads as rounded and above as spread. */
const ROUND_BELOW = 900;
const SPREAD_ABOVE = 1150;

/**
 * Time constants, in seconds. A mouth opens far faster than it closes, and
 * matching the two makes speech look like chewing.
 */
const ATTACK = 0.015;
const RELEASE = 0.09;
/** How fast the loudness reference forgets a loud passage. */
const PEAK_RELEASE = 1.5;
/** How fast the drawn shape chases the target shape. */
const SHAPE_TAU = 0.035;

/**
 * The quietest sound allowed to serve as the loudness reference.
 *
 * Levels are read against a running peak rather than against fixed thresholds,
 * so that a quiet voice and a loud one both use the mouth's full range. The
 * floor is what stops that from also amplifying the near-silence between words
 * into a fully open mouth.
 */
const PEAK_FLOOR = 0.02;

/** How long a shape must hold before another may replace it, in seconds. */
const MIN_HOLD = 0.07;

/** Frame-rate independent approach: the fraction of the remaining gap to close. */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

/**
 * Reads a tap and reports a mouth, one frame at a time.
 *
 * Stateful on purpose — smoothing, hysteresis and the hold timer are all memory
 * of the previous frames, and they are most of what separates a mouth that
 * looks like speech from one that flickers.
 */
export class MouthAnalyser {
  private level = 0;
  private peak = PEAK_FLOOR;
  private shape: LipShape = { ...VISEMES.rest };
  private viseme: Viseme = 'rest';
  /** Sticky, so a centroid hovering on the boundary does not flap the mouth. */
  private rounded = true;
  private heldFor = 0;

  constructor(private source: FeatureSource) {}

  /**
   * Swaps where the numbers come from, keeping everything learned so far.
   *
   * Replacing the analyser outright would reset the running peak and the
   * smoothing, so every switch would be followed by a second of the mouth
   * finding its feet — which is exactly the moment someone comparing the two
   * drivers is watching.
   */
  setSource(source: FeatureSource): void {
    this.source = source;
  }

  /** @param dt Seconds since the previous frame. */
  read(dt: number): MouthFrame {
    const { rms, centroid } = this.source.read();

    // Rises instantly to a new peak and forgets it slowly, so the reference
    // tracks the voice rather than the loudest moment of the whole call.
    this.peak = Math.max(rms, PEAK_FLOOR, this.peak * (1 - ease(dt, PEAK_RELEASE)));

    const target = Math.min(1, rms / this.peak);
    this.level += (target - this.level) * ease(dt, target > this.level ? ATTACK : RELEASE);

    this.heldFor += dt;
    const next = this.classify(centroid);
    // A big jump — silence straight to a shout — is a real event and jumps the
    // queue; everything else waits out the hold so the shape cannot flicker.
    if (next !== this.viseme && (this.heldFor >= MIN_HOLD || this.isJump(next))) {
      this.viseme = next;
      this.heldFor = 0;
    }

    const goal = VISEMES[this.viseme];
    const k = ease(dt, SHAPE_TAU);
    this.shape = {
      w: this.shape.w + (goal.w - this.shape.w) * k,
      up: this.shape.up + (goal.up - this.shape.up) * k,
      down: this.shape.down + (goal.down - this.shape.down) * k,
    };

    return { viseme: this.viseme, shape: this.shape, level: this.level };
  }

  /** Snaps shut. For the end of a turn, and for barge-in. */
  silence(): MouthFrame {
    this.level = 0;
    this.viseme = 'rest';
    this.shape = { ...VISEMES.rest };
    return { viseme: 'rest', shape: this.shape, level: 0 };
  }

  private classify(centroid: number | null): Viseme {
    if (this.level < SILENCE) return 'rest';

    this.rounded = this.readRoundness(centroid);

    if (this.level >= WIDE) return this.rounded ? 'oh' : 'aa';
    if (this.level >= MID) return this.rounded ? 'uh' : 'ee';
    // Audible but barely open: lips together, which is where the closed
    // consonants live.
    return 'mbp';
  }

  /**
   * True when the spectrum's centre of mass is low, which is what a rounded
   * mouth does to a voice — it lengthens the front cavity and drops the
   * resonance. Bright sounds (ee, s, sh) sit high and read as spread.
   */
  private readRoundness(centroid: number | null): boolean {
    // Nothing worth measuring — keep whatever we last decided rather than
    // inventing a centroid out of noise.
    if (centroid === null) return this.rounded;
    if (centroid < ROUND_BELOW) return true;
    if (centroid > SPREAD_ABOVE) return false;
    return this.rounded;
  }

  /** Two openness levels at once — worth breaking the hold for. */
  private isJump(next: Viseme): boolean {
    const rank: Record<Viseme, number> = { rest: 0, mbp: 1, ee: 2, uh: 2, aa: 3, oh: 3 };
    return Math.abs(rank[next] - rank[this.viseme]) >= 2;
  }
}
