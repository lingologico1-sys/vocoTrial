import { ROUNDING_SPLIT_HZ, SPEECH_BAND, type AudioTap } from '../realtime/audio';

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
  /**
   * Share of speech-band magnitude above ROUNDING_SPLIT_HZ, 0 to 1, or null.
   *
   * The second axis the lips need and the centroid cannot supply on its own.
   * See EnvelopeSample.highShare in audio.ts for what it measures and why one
   * number was not enough.
   */
  highShare: number | null;
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
  const split = Math.round(ROUNDING_SPLIT_HZ / tap.binHz);

  return {
    read(): Features {
      tap.readWaveform(waveform);
      let energy = 0;
      for (let i = 0; i < waveform.length; i++) energy += waveform[i] * waveform[i];
      const rms = Math.sqrt(energy / waveform.length);

      tap.readSpectrumDb(spectrum);
      let weighted = 0;
      let total = 0;
      let above = 0;
      for (let i = low; i <= high; i++) {
        // Back to linear magnitude. The analyser reports decibels, and a
        // centroid weighted by decibels is not the same centroid — the log
        // scale lifts quiet high bins until they drag it upwards. The scheduled
        // driver measures linear magnitude, so this has to as well or the two
        // would disagree about roundness for a reason that is not timing.
        //
        // The share below is the same argument a second time, and a sharper one:
        // it is a ratio of two sums over this loop, so a decibel weighting would
        // not merely shift it but invert which side of the split looks heavier.
        const magnitude = 10 ** (spectrum[i] / 20);
        weighted += magnitude * i * tap.binHz;
        total += magnitude;
        if (i >= split) above += magnitude;
      }

      return {
        rms,
        centroid: total > 1e-6 ? weighted / total : null,
        highShare: total > 1e-6 ? above / total : null,
      };
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
      return sample ?? { rms: 0, centroid: null, highShare: null };
    },
  };
}

/**
 * Below this share of the running peak, treat the frame as silence.
 *
 * Exported because the lip press needs the same line drawn in the same place.
 * That gesture may only show while the analyser has nothing to say, and
 * `viseme === 'rest'` is exactly `level < SILENCE` — so reading the constant
 * lets the press fade out at the very threshold the classifier switches on,
 * rather than at a boolean test that would put a cliff a frame either side of
 * it. See PRESS in headMotion.ts, and `pressed` in Face.tsx.
 */
export const SILENCE = 0.12;
/** Openness thresholds, as a share of the running peak. */
const MID = 0.3;
const WIDE = 0.62;

/** Centroid, in Hz, below which a vowel reads as rounded and above as spread. */
const ROUND_BELOW = 900;
const SPREAD_ABOVE = 1150;

/**
 * The two ways of deciding roundness, offered as a switch.
 *
 * `centroid` is what shipped: one number, one pair of thresholds. It is right
 * about English, whose front vowels are all unrounded and whose rounded vowels
 * are all back — one axis genuinely separates them.
 *
 * `both` adds `highShare` as a second opinion where the first one is weak. The
 * case it exists for is the front rounded vowel — French *tu*, German *über*,
 * Turkish *güzel*, Swedish *hus*, Mandarin *nǚ* — which is front and rounded at
 * once and therefore lands in the middle of a scale that assumes those are
 * opposites. Ten of the twenty-eight languages in the picker have them.
 *
 * A switch rather than a replacement for the usual reason, and one better than
 * usual: the thresholds below are derived from published formant tables rather
 * than measured on this system's own audio, so the comparison is not a matter of
 * taste here — it is the only evidence there is that the change is an
 * improvement.
 */
export type RoundnessMode = 'auto' | 'both' | 'centroid';

export const DEFAULT_ROUNDNESS: RoundnessMode = 'auto';

export const ROUNDNESS_MODES: Array<{ id: RoundnessMode; label: string; hint: string }> = [
  {
    id: 'auto',
    label: 'By language',
    hint: 'The second measurement, but only in the languages that have the contrast it exists to resolve. Everywhere else it is switched off, because there it can only turn right answers into wrong ones.',
  },
  {
    id: 'both',
    label: 'Always',
    hint: 'Force the second measurement on regardless of language. Worth trying on English to see the failure it causes: the vowels of father and but read as rounded, because they are dark for a reason that has nothing to do with lips.',
  },
  {
    id: 'centroid',
    label: 'Never',
    hint: 'What shipped: one number and one pair of thresholds. Correct for English, wrong for French tu and German über, and the thing to compare against.',
  },
];

/**
 * The languages whose vowels need a second opinion, by ISO-639-1 code.
 *
 * Every one of them has a front rounded vowel — /y/, /ø/, or both — and that is
 * the entire membership test. It is not a list of languages the mouth is good
 * at; it is a list of languages containing a contrast one number cannot carry.
 *
 * The gating is not a hedge, and the measurements are worth writing down because
 * they say something the reasoning did not. Synthesised vowels put the centroids
 * of English *father* (936) and *but* (936) squarely between German *schön*
 * (945) and French *su* (1136) — so the contested band genuinely contains both
 * dark unrounded vowels and front rounded ones, and no threshold on the centroid
 * can pull them apart.
 *
 * The share cannot pull them apart either, which is the finding that produced
 * this list. Sweeping the split from 1.8 to 3 kHz, the best separation available
 * anywhere is a *negative* gap — the rounded set reaches 0.53 of the average
 * while the unrounded set comes down to 0.51. They overlap at every frequency.
 * The reason is that /ɑ/ and /y/ are dark for unrelated reasons: /y/ because
 * rounding drags F3 down onto F2, /ɑ/ because F2 is simply very low to begin
 * with. One ratio cannot tell those apart, and pretending otherwise cost English
 * two vowels it had been getting right.
 *
 * So the honest scope is per-language. Where a language has no front rounded
 * vowel there is nothing in the contested band but unrounded sounds, and asking
 * a second question can only do harm; where it has one, the second question is
 * the only thing that answers it. On synthesised vowel sets that lands at 0
 * wrong of 9 for French, 0 of 7 for German and 0 of 9 for English, against 3, 2
 * and 0 for the centroid alone.
 *
 * Turkish keeps one error either way — *kız*, a close back *unrounded* vowel
 * whose centroid falls under ROUND_BELOW. That one is the centroid's own
 * failure and predates all of this.
 */
const FRONT_ROUNDED_LANGUAGES = new Set(['fr', 'de', 'nl', 'sv', 'no', 'da', 'fi', 'hu', 'tr', 'zh']);

/**
 * Above this centroid the first opinion is decisive and the second is not asked.
 *
 * Sits well above SPREAD_ABOVE, and the gap between them is the whole of what
 * `both` changes. Under `centroid` the region from 900 to 1150 is merely sticky
 * — whatever was decided last frame stands. Under `both` the contested region
 * runs to 1600 and is settled on evidence instead, because that is where the
 * front rounded vowels actually sit: /y/ and /ø/ have F2 around 1500 to 1900,
 * which puts them above any threshold that still lets /u/ read as rounded.
 *
 * Past 1600 there is nothing to arbitrate. That is /i/, /e/ and the sibilants,
 * all of them unrounded, and asking a second question there could only turn a
 * right answer into a wrong one.
 */
const SPREAD_CERTAIN_ABOVE = 1600;

/**
 * How far under this voice's own average the share must fall to read as rounded.
 *
 * Ratios rather than absolute shares, and the reason is the same one PEAK_FLOOR
 * and PEAK_RELEASE exist for a few lines up. Loudness is read against a running
 * peak so that a quiet voice and a loud one both use the mouth's full range;
 * brightness has exactly the same problem and had been getting away without a
 * solution. How much magnitude sits above 2.4 kHz depends on the speaker's
 * vocal tract, on how breathy the voice is and on where the codec gave up —
 * none of which say anything about the lips. What *does* say something about
 * the lips is which of this voice's own vowels are darker than its others.
 *
 * The separation this leans on is large. Synthesised from published French
 * formants — a pole filter whose source tilt was calibrated so the vowel set's
 * mean centroid lands between ROUND_BELOW and SPREAD_ABOVE, which is by
 * construction where real audio has to sit for those two to mean anything — the
 * rounded set /y ø œ o u/ comes out between 0.07 and 0.29 of the average, and
 * the unrounded /i e ɛ a/ between 0.74 and 3.1. Nothing lands in between.
 *
 * These sit in that gap rather than at its edges. /a/ is what decides the upper
 * one and what stops it being generous: an open unrounded vowel is much darker
 * than /i/ — F2 near 1350 against 2250 — so it is the unrounded sound most
 * likely to be mistaken for a rounded one, and 0.74 is how close it comes.
 *
 * The same model is why these are ratios rather than the absolute pair they
 * started as. Before calibration it put every synthetic vowel between 0.001 and
 * 0.06, nowhere near the 0.22 first guessed for real speech — the ordering it
 * predicts is trustworthy and the scale it predicts is not, so only the ordering
 * is used and the scale is measured per voice at run time.
 */
const ROUND_SHARE_RATIO = 0.45;
const SPREAD_SHARE_RATIO = 0.6;

/**
 * How fast the brightness reference forgets, in seconds.
 *
 * Much slower than the loudness peak's 1.5, because they are averaging different
 * things. That one tracks the loudest recent moment and has to follow a voice
 * that drops to a murmur. This one wants the voice's habitual brightness across
 * a whole sentence, which is only meaningful once several vowels have gone past
 * — at three or four syllables a second, four seconds is a dozen or so.
 *
 * Too short and it chases the vowel it is meant to be judging: a run of rounded
 * vowels would drag the average down to meet them and the last of them would
 * read as spread relative to its own neighbours.
 */
const SHARE_TAU = 4;

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
  /**
   * This voice's habitual brightness, as a running mean of `highShare`.
   *
   * Null until a vowel has been heard, which is not the same as zero: a mean of
   * zero would make the first sound of a call infinitely bright by comparison
   * and purse the lips on it. Until it is seeded, `both` behaves as `centroid`.
   */
  private shareMean: number | null = null;

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

  /**
   * @param dt Seconds since the previous frame.
   * @param roundness Which evidence the lips are decided on. See RoundnessMode.
   * @param language ISO-639-1 code, consulted only to resolve `auto`.
   */
  read(
    dt: number,
    roundness: RoundnessMode = DEFAULT_ROUNDNESS,
    language = '',
  ): MouthFrame {
    const useShare =
      roundness === 'both' || (roundness === 'auto' && FRONT_ROUNDED_LANGUAGES.has(language));
    const { rms, centroid, highShare } = this.source.read();

    // Rises instantly to a new peak and forgets it slowly, so the reference
    // tracks the voice rather than the loudest moment of the whole call.
    this.peak = Math.max(rms, PEAK_FLOOR, this.peak * (1 - ease(dt, PEAK_RELEASE)));

    const target = Math.min(1, rms / this.peak);
    this.level += (target - this.level) * ease(dt, target > this.level ? ATTACK : RELEASE);

    // Vowel frames only, and that qualification is the point rather than a
    // saving. A sibilant puts nearly all of its magnitude above the split, so
    // averaging one in would lift the reference every time the voice said "s"
    // and leave the vowel after it looking dark enough to purse the lips. MID is
    // already the line between a mouth half open and barely open, which is close
    // enough to the line between a vowel and a consonant for this purpose.
    if (highShare !== null && this.level >= MID) {
      this.shareMean =
        this.shareMean === null
          ? highShare
          : this.shareMean + (highShare - this.shareMean) * ease(dt, SHARE_TAU);
    }

    this.heldFor += dt;
    const next = this.classify(centroid, highShare, useShare);
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

  private classify(centroid: number | null, highShare: number | null, useShare: boolean): Viseme {
    if (this.level < SILENCE) return 'rest';

    this.rounded = this.readRoundness(centroid, highShare, useShare);

    if (this.level >= WIDE) return this.rounded ? 'oh' : 'aa';
    if (this.level >= MID) return this.rounded ? 'uh' : 'ee';
    // Audible but barely open: lips together, which is where the closed
    // consonants live.
    return 'mbp';
  }

  /**
   * True when the lips are rounded, on whichever evidence is being used.
   *
   * The first question is unchanged in both modes: a low centre of mass is what
   * a rounded mouth does to a voice, because protruding the lips lengthens the
   * front cavity and drops every resonance in it. Bright sounds — ee, s, sh —
   * sit high and read as spread. Where the two modes part is what happens when
   * that question does not have a clear answer.
   *
   * Under `centroid` the undecided band is simply sticky, which is a way of
   * declining to answer: whatever the last frame thought, this frame thinks too.
   * That is the right behaviour for a signal hovering on a threshold and the
   * wrong one for a vowel that genuinely lives there, because a front rounded
   * vowel is not noise around a boundary — it is a third thing the scale has no
   * room for, and stickiness hands it whichever answer preceded it.
   *
   * Under `both` that band is widened to where those vowels actually sit and
   * settled on the second measurement instead. The extremes are untouched in
   * either mode, deliberately: the centroid is not weak out there, and a second
   * opinion can only turn a right answer into a wrong one.
   */
  private readRoundness(
    centroid: number | null,
    highShare: number | null,
    useShare: boolean,
  ): boolean {
    // Nothing worth measuring — keep whatever we last decided rather than
    // inventing a centroid out of noise.
    if (centroid === null) return this.rounded;
    if (centroid < ROUND_BELOW) return true;

    if (!useShare || highShare === null || this.shareMean === null) {
      if (centroid > SPREAD_ABOVE) return false;
      return this.rounded;
    }

    if (centroid > SPREAD_CERTAIN_ABOVE) return false;
    if (highShare < this.shareMean * ROUND_SHARE_RATIO) return true;
    if (highShare > this.shareMean * SPREAD_SHARE_RATIO) return false;
    return this.rounded;
  }

  /** Two openness levels at once — worth breaking the hold for. */
  private isJump(next: Viseme): boolean {
    const rank: Record<Viseme, number> = { rest: 0, mbp: 1, ee: 2, uh: 2, aa: 3, oh: 3 };
    return Math.abs(rank[next] - rank[this.viseme]) >= 2;
  }
}
