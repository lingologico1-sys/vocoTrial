import type { AudioTap } from '../realtime/audio';

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

/** Below this share of the running peak, treat the frame as silence. */
const SILENCE = 0.12;
/** Openness thresholds, as a share of the running peak. */
const MID = 0.3;
const WIDE = 0.62;

/** Centroid, in Hz, below which a vowel reads as rounded and above as spread. */
const ROUND_BELOW = 900;
const SPREAD_ABOVE = 1150;

/** The band the centroid is measured over. Outside it is rumble and hiss. */
const CENTROID_LO_HZ = 200;
const CENTROID_HI_HZ = 5000;

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
  private readonly waveform: Uint8Array<ArrayBuffer>;
  private readonly spectrum: Uint8Array<ArrayBuffer>;
  private readonly loBin: number;
  private readonly hiBin: number;

  private level = 0;
  private peak = PEAK_FLOOR;
  private shape: LipShape = { ...VISEMES.rest };
  private viseme: Viseme = 'rest';
  /** Sticky, so a centroid hovering on the boundary does not flap the mouth. */
  private rounded = true;
  private heldFor = 0;

  constructor(private readonly tap: AudioTap) {
    this.waveform = new Uint8Array(tap.waveformSize);
    this.spectrum = new Uint8Array(tap.binCount);
    this.loBin = Math.max(1, Math.floor(CENTROID_LO_HZ / tap.binHz));
    this.hiBin = Math.min(tap.binCount - 1, Math.ceil(CENTROID_HI_HZ / tap.binHz));
  }

  /** @param dt Seconds since the previous frame. */
  read(dt: number): MouthFrame {
    this.tap.readWaveform(this.waveform);

    let sum = 0;
    for (let i = 0; i < this.waveform.length; i++) {
      const sample = (this.waveform[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.waveform.length);

    // Rises instantly to a new peak and forgets it slowly, so the reference
    // tracks the voice rather than the loudest moment of the whole call.
    this.peak = Math.max(rms, PEAK_FLOOR, this.peak * (1 - ease(dt, PEAK_RELEASE)));

    const target = Math.min(1, rms / this.peak);
    this.level += (target - this.level) * ease(dt, target > this.level ? ATTACK : RELEASE);

    this.heldFor += dt;
    const next = this.classify();
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

  private classify(): Viseme {
    if (this.level < SILENCE) return 'rest';

    this.rounded = this.readRoundness();

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
  private readRoundness(): boolean {
    this.tap.readSpectrum(this.spectrum);

    let weighted = 0;
    let total = 0;
    for (let i = this.loBin; i <= this.hiBin; i++) {
      const magnitude = this.spectrum[i];
      weighted += magnitude * i * this.tap.binHz;
      total += magnitude;
    }

    // Nothing in the band worth measuring — keep whatever we last decided
    // rather than inventing a centroid out of noise.
    if (total < 1) return this.rounded;

    const centroid = weighted / total;
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
