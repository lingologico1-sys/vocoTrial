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

/*
 * There was an idle head sway here — two detuned sines drifting the whole
 * picture between turns, on the theory that a face which only ever moves when
 * it speaks is a photograph the rest of the time. The theory still looks right.
 * The head was the wrong part of the face to test it on.
 *
 * It failed twice, and the second failure is the instructive one. First it was
 * sized as a fraction of the speaking travel, which at `rise` worked out to
 * half a pixel on a 160-pixel stage — running the whole time, invisible the
 * whole time. Then it was given its own table and made plainly visible, and the
 * verdict on seeing it was that a head drifting with nobody talking does not
 * read as a person waiting. It reads as a picture that will not sit still.
 *
 * The trouble is that a head has no reason to move on its own. It moves because
 * a person is doing something, so movement with no cause behind it reads as
 * drift rather than as life. The blink escapes this because a blink is its own
 * cause — eyes need blinking whatever else is going on. So does a brow: brows
 * fire with the lids, and a face that lifts them a little as it blinks is doing
 * something people actually do. That is where the idle life went. See
 * BROW_FLASH below, and `blinked` on HeadPerformer.
 */

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

/** One movement's shape, in seconds: up, held, down. */
interface Envelope {
  attack: number;
  hold: number;
  release: number;
}

const total = (shape: Envelope) => shape.attack + shape.hold + shape.release;

/**
 * The shape of one gesture.
 *
 * About two thirds of a second in total, which is roughly a nod. Its duration is
 * its own rather than the syllable's — this is the property the blink has and
 * the old motion did not, and it is most of why one reads as a decision and the
 * other as a reflex.
 */
const GESTURE: Envelope = { attack: 0.12, hold: 0.18, release: 0.35 };

/**
 * The shape of a brow lifting with a blink.
 *
 * The attack is set against the blink's own 120ms rather than against the
 * gesture above: the brow arrives while the eyes are still shut, so the two
 * land as one event instead of as a brow answering a blink. What follows is
 * deliberately slower than the lids. A blink is over in a tenth of a second and
 * a brow is not — half a second is what the movement takes on a real face, and
 * a brow that snapped back on the blink's schedule would read as a twitch.
 *
 * The whole thing lasts a little longer than a gesture, which is the right way
 * round: this is the smaller movement and the more frequent one, so it has to
 * be the one that does not punctuate.
 */
const BROW_FLASH: Envelope = { attack: 0.09, hold: 0.14, release: 0.34 };

/**
 * How far a blink lifts the brows, as a share of a full speaking lift.
 *
 * Under a full lift because a blink is not an emphasis. It is the movement a
 * face makes while waiting, and the moment it competes with the one the voice
 * asks for, the voice has stopped being what drives the face.
 */
const BROW_FLASH_LIFT = 0.7;

/**
 * How many blinks carry one, as a probability.
 *
 * Not all of them. Blinks land every four seconds or so, and brows moving that
 * often is the exact failure BROW_LOCKOUT exists to prevent — a face that lifts
 * its brows every four seconds is not waiting, it is reacting to something you
 * cannot see. At a half the flashes land about eight seconds apart, which is
 * BROW_LOCKOUT's seven arrived at from the other direction.
 *
 * Rolled per blink rather than scheduled, so it inherits the blink's jitter for
 * free and cannot fall into a rhythm of its own.
 */
const BROW_FLASH_CHANCE = 0.5;

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
  head: number;
  /** Never negative: a brow at rest is already as low as that face's brow goes. */
  brow: number;
}

/**
 * One movement channel: an envelope that plays out, and a refusal to start again.
 *
 * Stateful for the reason MouthAnalyser is — a schedule is memory of what has
 * already happened, and it is the entire difference between this and reading a
 * number off the current frame.
 *
 * The lockout defaults to none, which is the brow flash's case rather than an
 * omission: that channel is fired by the blink, and the blink's own jittered
 * gap is already a lockout that nothing can hurry. Two would only argue.
 */
class Channel {
  /** Seconds since this fired. Starts past the end, so nothing is playing. */
  private since: number;
  /** Seconds still to wait. */
  private locked = 0;
  private readonly span: number;

  constructor(
    private readonly shape: Envelope,
    private readonly lockout = 0,
  ) {
    this.span = total(shape);
    this.since = this.span;
  }

  advance(dt: number, trigger: boolean): number {
    this.since += dt;
    this.locked = Math.max(0, this.locked - dt);

    if (trigger && this.locked === 0 && this.since >= this.span) {
      this.since = 0;
      this.locked = this.lockout * (1 - LOCKOUT_JITTER + Math.random() * 2 * LOCKOUT_JITTER);
    }

    const { attack, hold, release } = this.shape;
    if (this.since >= this.span) return 0;
    if (this.since < attack) return smooth(this.since / attack);
    if (this.since < attack + hold) return 1;
    return 1 - smooth((this.since - attack - hold) / release);
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
  private readonly headChannel = new Channel(GESTURE, HEAD_LOCKOUT);
  private readonly browChannel = new Channel(GESTURE, BROW_LOCKOUT);
  private readonly flashChannel = new Channel(BROW_FLASH);
  /** Set by `blinked`, spent by the next `read`. */
  private flashPending = false;

  /**
   * A blink just started; the brows may care.
   *
   * An event pushed in rather than a schedule kept here, because the blink's
   * clock belongs to the component that draws the lids and there must be
   * exactly one of it. A second timer in here agreeing with that one most of
   * the time would be worse than no coupling at all — the whole point is that
   * the brow and the lids are one movement, and two clocks would put them a
   * few tens of milliseconds apart at random, which is precisely how a face
   * stops looking like it means it.
   *
   * The dice live here rather than at the call site so that everything
   * deciding how brows behave is in one file. The caller's job is to report
   * that an eye closed.
   */
  blinked(): void {
    if (Math.random() < BROW_FLASH_CHANCE) this.flashPending = true;
  }

  /**
   * @param dt Seconds since the previous frame.
   * @param level Smoothed loudness from the mouth analyser, 0 to 1.
   */
  read(dt: number, level: number, cadence: MotionCadence): Performance {
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

    // Advanced every frame like the two above, and spent whether or not it
    // fires, so a blink cannot be banked while the envelope is already busy and
    // cashed in a second later with nothing to explain it.
    const flash = this.flashChannel.advance(dt, this.flashPending) * BROW_FLASH_LIFT;
    this.flashPending = false;

    const head =
      cadence === 'syllable' ? level : cadence === 'phrase' ? this.phrase : headGesture;
    const spoken =
      cadence === 'syllable' ? level : cadence === 'phrase' ? this.phrase : browGesture;

    // The louder of the two rather than their sum, and it matters most in the
    // case that looks harmless: a blink landing mid-phrase. Summed, the brows go
    // somewhere neither movement asked for and the lift reads as surprise; taken
    // as a maximum, the flash is simply invisible whenever the voice is already
    // asking for more, which is the correct thing for the smaller movement to do.
    const brow = Math.max(spoken, flash);

    return { head, brow };
  }
}
