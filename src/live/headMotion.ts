/**
 * How the head carries the performance, separated from the face that draws it.
 *
 * Its own module for the same reason visemes.ts is: the face renders this, the
 * live page offers it as a control and the kit page offers it as a switch, so a
 * union three files agree on has no business living inside a component. (React
 * fast refresh also declines to reload a file that exports both a component and
 * constants, which is the cheap version of the same argument.)
 *
 * Every number here is in head units — the 200x200 space Face.tsx draws in — and
 * degrees.
 */

/**
 * The two ways the head moves, and why there are two rather than one settled answer.
 *
 * What both have in common is the part that is no longer negotiable: they move
 * the *whole picture*. Scoping the movement to a head-shaped rectangle was tried
 * at length and abandoned, and the reason is worth keeping written down, because
 * it looks like a solvable problem right up until you measure it. A crop that
 * lifts opens a gap at its bottom edge, and the only pixels available to fill
 * that gap are another copy of the same neck a few units away. Cross-fading the
 * two doubles every edge inside the blend — a collar most of all — into a band
 * across the throat, and the head reads as severed. Feathering harder widens the
 * band. Moving the cut lower puts it in the collar; moving it higher puts it on
 * the jaw, which is worse. There is nowhere on a body to hide that cut.
 *
 * What is left to choose is the *character* of the movement, and these two are
 * genuinely different rather than two tunings of one number:
 *
 *  - `swing` rotates and does not translate. The pivot sits low in the frame, so
 *    the foot of the picture stays where it is and the head arcs over it — which
 *    is, near enough, what a neck does. At the radius the face sits at, that arc
 *    is side to side: a fraction of a unit of vertical drop against four of
 *    lateral travel.
 *  - `rise` translates and does not rotate. A frame sliding bodily upward is what
 *    a *camera* does, not a person; it is kept because that is a matter of taste
 *    and the only honest way to settle it is to flip between them on the same
 *    sentence.
 *
 * They are deliberately kept pure and perpendicular — one purely vertical, one
 * purely lateral. An earlier `rise` carried 0.8° of roll alongside its translate,
 * which put a little of each mode into the other and left the switch feeling like
 * two tunings of one setting rather than a choice between two.
 */
export type HeadMotion = 'swing' | 'rise';

export const DEFAULT_HEAD_MOTION: HeadMotion = 'swing';

export const HEAD_MOTIONS: Array<{ id: HeadMotion; label: string; hint: string }> = [
  {
    id: 'swing',
    label: 'Swing',
    hint: 'Rotates about a point low in the frame and does not translate, so the foot of the picture holds still and the head arcs over it.',
  },
  {
    id: 'rise',
    label: 'Rise',
    hint: 'Lifts the whole frame straight up and does not rotate at all. Reads as a camera bump rather than a person.',
  },
];

/**
 * How far each mode goes at full volume: units of translate, degrees of rotate.
 *
 * Exactly one number per mode is non-zero, which is the whole point of the pair.
 *
 * The 4 units of translate are unchanged from the version that shipped for
 * months; what `rise` has lost since is the 0.8° of roll that used to ride along
 * with it. Dropping it costs nothing visible — at that angle the face moves 1.4
 * units laterally, under a third of the translate it was hiding behind, which is
 * why every complaint about the old motion was really a complaint about the
 * translate. It buys a switch whose two positions disagree about direction
 * rather than about proportions.
 *
 * The swing figure is much larger than that 0.8° because rotation is now
 * carrying the whole performance instead of garnishing a translate. Read it
 * together with OVERSCAN below: the two are one setting wearing two names.
 */
export const MOTION: Record<HeadMotion, { rise: number; roll: number }> = {
  swing: { rise: 0, roll: 2.5 },
  rise: { rise: 4, roll: 0 },
};

/**
 * Where the picture turns.
 *
 * Low and centred — down at the base of the neck, which is where a real head is
 * hinged. The height matters more than it looks: the further the pivot sits from
 * the face, the more the rotation reads as the head being swung on the end of
 * something rather than turning on its own joint.
 */
export const PIVOT_X = 100;
export const PIVOT_Y = 180;

/**
 * How much larger than the frame the artwork is drawn, as a multiplier.
 *
 * The cost of rotating a square picture: turn it about any point on its lower
 * half and one bottom corner swings upward out of frame, uncovering a wedge of
 * whatever is behind. Six units of it at full volume, against the dark panel the
 * preview sits in — small, and the sort of small the eye finds immediately,
 * because it is a hard-edged triangle appearing in a corner on the beat.
 *
 * So the picture is drawn a tenth larger than it needs to be and the frame crops
 * the difference, which is what overscan has always been for.
 *
 * Ten percent is sized to the numbers above and the headroom is thinner than it
 * looks, so here is the measurement rather than a reassurance: at the shipping
 * 2.5° the nearest frame corner clears the artwork by 2.2 units, at 3° by 0.7,
 * and somewhere around 3.2° it stops clearing at all — after which the top-left
 * corner of the frame is uncovered and a wedge of panel shows through on every
 * stressed syllable. Raising the swing angle means raising this too. The pair
 * are one setting wearing two names, and only one of them fails loudly.
 *
 * Applied to the group rather than to the base image, so the mouth patches, the
 * lids and the brow crops scale with the picture they are registered to. Scaling
 * only the base would slide every patch off the face it belongs to.
 */
export const OVERSCAN = 1.1;

/**
 * *When* the head and brows move, as against which way the head goes.
 *
 * A second axis, and genuinely perpendicular to HeadMotion above rather than a
 * finer grade of it: that one picks a direction, this one picks a schedule.
 * Every combination is legal, and neither is hiding a tuning of the other.
 *
 * The complaint that produced it is worth writing down, because it was not a
 * complaint about any of the numbers. Everything this face does except blink is
 * a direct function of the loudness of the current frame — and loudness peaks
 * once per stressed syllable, so on an ordinary sentence the head nods four or
 * five times and the brows jump with it. A person does it once, if at all.
 *
 * What makes the blink read as life is not its size, it is its schedule: its own
 * clock, a fixed duration whatever provoked it, and a jittered gap that no
 * amount of talking can hurry. These are attempts to give the head and the brows
 * the same, and they are offered as a switch for the reason the swing/rise
 * switch exists — the only honest way to have an opinion is to flip between them
 * on the same sentence.
 *
 *  - `syllable` is what shipped. Kept as the thing to compare against, not
 *    because anyone is expected to choose it.
 *  - `phrase` follows the shape of the sentence instead of the syllables inside
 *    it: the same movement, arriving once per phrase rather than once per stress.
 *  - `gesture` does nothing at all for most of a sentence, punctuates its loudest
 *    moment, then refuses to move again for seconds however loud things get.
 *
 * The last two sound alike and do not feel alike, so: `phrase` is *smoother*,
 * `gesture` is *rarer*. `phrase` moves whenever there is sound. `gesture` mostly
 * does not move, and occasionally does something definite.
 */
export type MotionCadence = 'syllable' | 'phrase' | 'gesture';

/**
 * Phrase by default, as the conservative half of the improvement.
 *
 * It fixes the thing complained about — the per-syllable twitch — without also
 * introducing a face that can be silent and motionless through a whole sentence,
 * which is a bigger change of character than anyone has agreed to yet. `gesture`
 * is one click away and is the more interesting answer; this is the one that is
 * hard to dislike.
 */
export const DEFAULT_CADENCE: MotionCadence = 'phrase';

export const MOTION_CADENCES: Array<{ id: MotionCadence; label: string; hint: string }> = [
  {
    id: 'syllable',
    label: 'Every syllable',
    hint: 'What shipped: head and brows follow the loudness of the current frame, so they move on each stressed syllable — four or five times in an ordinary sentence.',
  },
  {
    id: 'phrase',
    label: 'Every phrase',
    hint: 'The same movement, following the arc of the whole sentence rather than the syllables in it. One unhurried lean per phrase. Still moves whenever there is sound.',
  },
  {
    id: 'gesture',
    label: 'Occasional',
    hint: 'Still for most of a sentence, then one definite move on its loudest moment, then locked out for a few seconds — the brows for much longer. The blink’s schedule, applied to the head.',
  },
];

/**
 * How fast the phrase envelope opens and closes, in seconds.
 *
 * Read against the mouth's own 0.015 and 0.09 in visemes.ts: this is roughly
 * sixteen times slower to rise and ten times slower to fall, which is the whole
 * of the difference between following syllables and following sentences. The
 * release is much the longer of the two on purpose — a head that snapped back
 * between phrases would have reintroduced the twitch at a lower rate.
 */
const PHRASE_ATTACK = 0.25;
const PHRASE_RELEASE = 0.9;

/**
 * The shape of one gesture, in seconds: up, held, down.
 *
 * About two thirds of a second in total, which is roughly a nod. Its duration is
 * its own rather than the syllable's — this is the property the blink has and
 * the old motion did not, and it is most of why one reads as a decision and the
 * other as a reflex.
 */
const GESTURE_ATTACK = 0.12;
const GESTURE_HOLD = 0.18;
const GESTURE_RELEASE = 0.35;
const GESTURE_TOTAL = GESTURE_ATTACK + GESTURE_HOLD + GESTURE_RELEASE;

/**
 * What arms a gesture and what fires it, as shares of full volume.
 *
 * Two thresholds rather than one, for the reason the viseme classifier keeps its
 * roundness sticky: a single threshold with a signal hovering on it fires over
 * and over. The level has to fall back under ARM_LOW before ARM_HIGH can mean
 * anything again, so one phrase can spend at most one gesture.
 */
const ARM_LOW = 0.25;
const ARM_HIGH = 0.55;

/**
 * How long each channel refuses to move again, in seconds.
 *
 * The brows wait almost three times as long as the head, because they are the
 * part that was most obviously wrong: a head that punctuates every other phrase
 * reads as engaged, and brows that do it read as astonished. At these figures a
 * brow lands about once every three or four sentences.
 */
const HEAD_LOCKOUT = 2.5;
const BROW_LOCKOUT = 7;

/**
 * How far a lockout is spread either side of its length.
 *
 * The blink's own reason, in one line: a face that punctuates on a fixed period
 * is more unsettling than one that never punctuates at all.
 */
const LOCKOUT_JITTER = 0.4;

/**
 * The idle sway: how far, and how slowly.
 *
 * Small enough to be deniable — at the shipping swing angle this is 0.45° — and
 * the point is that it is *never* off. Between turns the face is otherwise a
 * photograph that blinks, and the rarer the speaking gestures become the more
 * that shows. Two frequencies rather than one, at a ratio that is not a whole
 * number, so the pair drift against each other and the sway never settles into a
 * period you can predict. MotionPreview's loop is built out of the same trick
 * for the same reason.
 */
const IDLE_SWAY = 0.18;
const IDLE_SLOW_HZ = 0.13;
const IDLE_FAST_HZ = 0.31;

/** Frame-rate independent approach, as in visemes.ts. */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

/** Eases both ends of a ramp, so a gesture does not start or stop abruptly. */
function smooth(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** What the head and brows are doing this frame, as multipliers on MOTION. */
export interface Performance {
  /**
   * Signed, unlike everything it replaced.
   *
   * The idle sway goes both ways, and a head that could only ever move one way
   * from rest would sway by leaning and returning rather than by swaying. The
   * negative excursion is small — under a fifth of full — so it stays a long way
   * inside the corner clearance measured against OVERSCAN above.
   */
  head: number;
  /** Never negative: a brow at rest is already as low as that face's brow goes. */
  brow: number;
}

/**
 * One gesture channel: an envelope that plays out, and a refusal to start again.
 *
 * Stateful for the reason MouthAnalyser is — a schedule is memory of what has
 * already happened, and it is the entire difference between this and reading a
 * number off the current frame.
 */
class Channel {
  /** Seconds since this gesture fired. Starts past the end, so nothing is playing. */
  private since = GESTURE_TOTAL;
  /** Seconds still to wait. */
  private locked = 0;

  constructor(private readonly lockout: number) {}

  advance(dt: number, trigger: boolean): number {
    this.since += dt;
    this.locked = Math.max(0, this.locked - dt);

    if (trigger && this.locked === 0 && this.since >= GESTURE_TOTAL) {
      this.since = 0;
      this.locked = this.lockout * (1 - LOCKOUT_JITTER + Math.random() * 2 * LOCKOUT_JITTER);
    }

    if (this.since >= GESTURE_TOTAL) return 0;
    if (this.since < GESTURE_ATTACK) return smooth(this.since / GESTURE_ATTACK);
    if (this.since < GESTURE_ATTACK + GESTURE_HOLD) return 1;
    return 1 - smooth((this.since - GESTURE_ATTACK - GESTURE_HOLD) / GESTURE_RELEASE);
  }
}

/**
 * Turns a per-frame loudness into a performance, on whichever schedule is asked
 * for.
 *
 * Deliberately one object for all three cadences rather than three: the phrase
 * envelope is kept up to date whatever the setting, so flipping the switch
 * mid-sentence changes what the face is doing without a second of it finding its
 * feet. That is the same promise SpeakingFace makes about the mouth driver, and
 * it matters here for the same reason — the switch is only worth anything if the
 * comparison happens on one sentence.
 */
export class HeadPerformer {
  private phrase = 0;
  private armed = true;
  private elapsed = 0;
  private readonly headChannel = new Channel(HEAD_LOCKOUT);
  private readonly browChannel = new Channel(BROW_LOCKOUT);

  /**
   * @param dt Seconds since the previous frame.
   * @param level Smoothed loudness from the mouth analyser, 0 to 1.
   */
  read(dt: number, level: number, cadence: MotionCadence, idle: boolean): Performance {
    this.elapsed += dt;
    this.phrase += (level - this.phrase) * ease(dt, level > this.phrase ? PHRASE_ATTACK : PHRASE_RELEASE);

    // Fired from the phrase envelope rather than from `level`, which is what
    // makes the trigger worth having: a cough, a chair, or one clipped
    // consonant all put the raw loudness over any threshold you like for a few
    // milliseconds, and none of them survive a quarter-second attack.
    if (this.phrase < ARM_LOW) this.armed = true;
    const fire = this.armed && this.phrase >= ARM_HIGH;
    if (fire) this.armed = false;

    // Advanced every frame whatever the cadence, so the lockouts keep running
    // down while another schedule is on screen and switching back does not find
    // a gesture owed from a minute ago.
    const headGesture = this.headChannel.advance(dt, fire);
    const browGesture = this.browChannel.advance(dt, fire);

    const head =
      cadence === 'syllable' ? level : cadence === 'phrase' ? this.phrase : headGesture;
    const brow =
      cadence === 'syllable' ? level : cadence === 'phrase' ? this.phrase : browGesture;

    // Receding rather than added: the sway is what the head does when nothing
    // else is asking it to move, so it gets out of the way of anything that is.
    // Adding the two outright would push a loud gesture past the clearance the
    // overscan was measured against.
    const sway = idle ? this.sway() * (1 - Math.min(1, head)) : 0;

    return { head: head + sway, brow };
  }

  /** Two slow waves at an irrational-ish ratio, summing to at most IDLE_SWAY. */
  private sway(): number {
    const slow = Math.sin(2 * Math.PI * IDLE_SLOW_HZ * this.elapsed);
    const fast = Math.sin(2 * Math.PI * IDLE_FAST_HZ * this.elapsed + 1.7);
    return IDLE_SWAY * (0.6 * slow + 0.4 * fast);
  }
}
