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
 *
 * The name has been outgrown twice and is kept anyway. The brows have lived here
 * since the blink learned to carry them, and the lips arrived with PRESS — which
 * is not head motion by any reading. What the file actually holds is every
 * movement the face makes that the *sound* does not dictate: the mouth's shape
 * during speech belongs to visemes.ts and always will, and one gesture at the
 * edge of a turn belongs here, with the schedules.
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
 *  - `rise` translates and does not rotate.
 *
 * They are deliberately kept pure and perpendicular — one purely vertical, one
 * purely lateral. An earlier `rise` carried 0.8° of roll alongside its translate,
 * which put a little of each mode into the other and left the switch feeling like
 * two tunings of one setting rather than a choice between two.
 *
 * It was a matter of taste for a long time, and it is not any more. `rise` wins,
 * and the argument that settles it is not about either movement — it is about
 * what drives them. Both are handed the same number, an amplitude envelope, and
 * amplitude means *emphasis*. Emphasis on a real face is vertical: a head lifts
 * or drops on a stressed word. A lateral lean is not an emphasis at all, so a
 * head fed loudness sideways spends the whole sentence weighing what is being
 * said, and reads as a metronome rather than as a person.
 *
 * `swing` is kept, because the objection above is to its *trigger* and not to
 * its geometry — and the geometry turned out to be worth keeping. It moved
 * house rather than being deleted: see TILT_TRIGGERS, which is this rotation
 * fired by a question or a pause instead of by a loud syllable.
 */
export type HeadMotion = 'swing' | 'rise';

export const DEFAULT_HEAD_MOTION: HeadMotion = 'rise';

export const HEAD_MOTIONS: Array<{ id: HeadMotion; label: string; hint: string }> = [
  {
    id: 'rise',
    label: 'Rise',
    hint: 'Lifts the whole frame straight up and does not rotate at all. Vertical is what emphasis looks like on a real face, which is what the loudness driving this actually measures.',
  },
  {
    id: 'swing',
    label: 'Swing',
    hint: 'Rotates about a point low in the frame and does not translate, so the foot of the picture holds still and the head arcs over it. Kept to compare against: a sideways lean per stressed syllable reads as weighing every word. The same rotation on a signal that warrants it is under Tilt.',
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
 * The tilt: the same rotation as `swing`, fired by something other than loudness.
 *
 * The switch above asks which way the head should go when the voice gets louder,
 * and `rise` wins that on the only argument that matters — loudness means
 * *emphasis*, and emphasis on a real face is vertical. The head lifts or drops
 * on a stressed word. It does not lean sideways, and a head that leans sideways
 * once per phrase is weighing everything the speaker says.
 *
 * But a lateral tilt is not therefore wrong. It is a real thing faces do, driven
 * by a signal the amplitude envelope cannot see. Roll in conversation marks
 * uncertainty, a question, sympathy, a concession, the moment a speaker hands
 * the floor back — every one of them a matter of *stance*, and every one of them
 * attached to a boundary rather than to a peak. So the tilt keeps swing's
 * geometry and throws away its trigger. See TILT_TRIGGERS.
 *
 * This is also the second answer to the question the dead idle sway asked and
 * failed. That comment's conclusion was that a head has no reason to move on its
 * own, so movement with no cause reads as drift. A tilt has a cause: a question
 * was asked, the speaker stopped, the turn ended. It is the head's version of
 * what the brow flash found on the blink — motion that something in the world
 * accounts for.
 */

/**
 * Which events are allowed to fire one, offered as a set rather than a choice.
 *
 * Every other switch in this file is a radio because its options are rival
 * answers to one question. These are not rivals: a face could plausibly tilt at
 * all three moments, at none, or at any pair, and the thing actually in doubt is
 * *how many of them at once* stops reading as a person and starts reading as a
 * face that cannot keep still. That question cannot be asked one option at a
 * time, so the control is three boxes.
 *
 *  - `question` is the strongest of them and the cheapest. It is not measured off
 *    the audio at all — it reads the agent's own transcript, held back by
 *    RevealQueue until the words are audible, and fires when a sentence that
 *    ends in a question mark is heard. Precise, because it is the literal
 *    linguistic feature the gesture encodes, and rare, because questions are.
 *  - `hesitation` fires on a gap *inside* a turn: the voice goes quiet for
 *    PAUSE_HOLD while the audio is still playing. This is the thinking tilt.
 *  - `listening` fires when the agent's audio ends and the floor goes back to
 *    the user. It is the only one that does anything during the long stretches
 *    when the face is not talking, which is most of a conversation.
 *
 * `hesitation` and `listening` are kept apart by `speaking` rather than by their
 * timers, and they would otherwise be the same trigger firing twice: a turn
 * ending is also a silence. Gating the first on audio still playing makes the
 * pair disjoint, so turning both on is a real question about frequency and not
 * an accident of which clock won.
 */
export type TiltTrigger = 'question' | 'hesitation' | 'listening';

/**
 * Questions only, to start with.
 *
 * The rarest and most defensible of the three, and the one whose signal is not
 * an inference. Shipping the feature switched off entirely would be the same as
 * not shipping it — nobody forms an opinion about a box they have to find and
 * tick — and shipping all three at once would answer the frequency question in
 * advance, in the direction this whole change exists to argue against.
 */
export const DEFAULT_TILT_TRIGGERS: readonly TiltTrigger[] = ['question'];

export const TILT_TRIGGERS: Array<{ id: TiltTrigger; label: string; hint: string }> = [
  {
    id: 'question',
    label: 'Questions',
    hint: 'Fires when a sentence ending in a question mark becomes audible, read off the tutor’s own transcript rather than measured from the sound. The tilt lands as the question finishes and is held through the silence after it, which is the posture a person actually waits in.',
  },
  {
    id: 'hesitation',
    label: 'Hesitations',
    hint: 'Fires when the voice goes quiet for about half a second in the middle of a turn — a gap the speaker has not finished talking through. The thinking tilt.',
  },
  {
    id: 'listening',
    label: 'Listening',
    hint: 'Fires when the tutor stops and the floor goes back to you. The only one that does anything while the face is not speaking, which is most of a conversation.',
  },
];

/**
 * An event on its way to the face, for the two triggers that are not measurable.
 *
 * `hesitation` is absent from `kind` on purpose, and the absence is the point:
 * that one is a property of the sound and HeadPerformer can see it for itself.
 * These two cannot be found in the audio at any price — one lives in the
 * transcript, the other in whether the transport has more audio queued — so they
 * come down from the page as events.
 *
 * A React prop rather than a method call because the face owns the performer and
 * the page does not. `seq` is what makes two cues of the same kind different
 * objects, which is what the effect watching this actually keys on; it is spelled
 * out rather than left to `{}` identity so that the contract is legible instead
 * of incidental.
 */
export interface TiltCue {
  kind: Extract<TiltTrigger, 'question' | 'listening'>;
  seq: number;
}

/**
 * How far a tilt leans, in degrees — a range, because it turned out to be taste.
 *
 * It shipped as a fixed 3.5, on the argument that a real conversational tilt is
 * ten degrees and more and that a pose, being looked at rather than glimpsed, can
 * afford to be larger than a transient. Both halves of that are true and the
 * conclusion was still wrong: at 3.5 the movement reads as pronounced and odd
 * rather than as a lean, and the first thing said about it on a real call was
 * that it wanted to be far more subtle.
 *
 * The reason is in the pivot rather than in the angle, which is worth knowing
 * before reaching for the slider. Rotating the whole picture about a point 100
 * units below the face means most of what the eye actually sees is not rotation
 * at all — at 3.5° the face slides 6.1 units sideways and tips three and a half
 * degrees, so a big tilt reads as the head being moved rather than turning. Small
 * angles keep the slide beneath notice and leave the roll doing the talking,
 * which is why the useful part of this range is the bottom of it.
 *
 * For scale, in the units that decide it: the live stage draws this 200-unit head
 * at 160 pixels, so a degree is about 1.4 pixels of lateral travel at the face.
 *
 *   3.5°  6.1u  4.9px   what shipped, and too much
 *   2.5°  4.4u  3.5px   the same lateral travel as a full emphatic swing
 *   1.2°  2.1u  1.7px   the default below
 *
 * The ceiling is the emphatic swing's own 2.5° and is a real limit rather than a
 * round number: the tilt is a background posture and the swing is a foreground
 * beat, and a posture that travels further than the emphasis it sits under has
 * the two the wrong way round.
 */
export const DEFAULT_TILT_ROLL = 1.2;
export const TILT_ROLL_MIN = 0.2;
export const TILT_ROLL_MAX = MOTION.swing.roll;

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
 *
 * The head got a second chance on the same terms, and it is worth reading the
 * two together: TILT_TRIGGERS moves the whole picture between turns, which is
 * exactly what failed here. What is different is not the movement, it is that
 * something asked for it — a question was heard, the voice stopped, the turn
 * ended. Cause was the missing ingredient, not size.
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
 * The measurement above, as arithmetic rather than as a remembered figure.
 *
 * Written out because the tilt needs the same answer for angles nobody has stood
 * in front of a screen with a ruler for, and a second set of hand-measured
 * numbers in a comment is a second set of numbers that can go quietly stale. It
 * reproduces the ones already recorded up there exactly — 2.5° wants 1.0776, so
 * 2.2 units spare at 1.1; 3° wants 1.0928, so 0.7; and it crosses 1.1 at 3.2°,
 * which is where the comment says it stops clearing.
 *
 * Undoes `move` on each corner of the frame and asks how far outside the
 * unscaled artwork the corner lands, expressed as the scale that would just
 * reach it. The largest of the four is what the picture has to be drawn at.
 *
 * One sign of roll is enough: the frame's corners are mirror-symmetric about the
 * pivot's own x, the translate is purely vertical, and the answer is taken as a
 * distance from the centre — so leaning the other way lands on the mirrored
 * corner with the identical figure.
 */
function requiredOverscan(roll: number, rise: number): number {
  const theta = (roll * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let needed = 1;

  for (const cornerX of [0, 200]) {
    for (const cornerY of [0, 200]) {
      // The translate first, then the rotation — `move` applies them the other
      // way round, and this is undoing it.
      const dx = cornerX - PIVOT_X;
      const dy = cornerY + rise - PIVOT_Y;
      const x = PIVOT_X + cos * dx + sin * dy;
      const y = PIVOT_Y - sin * dx + cos * dy;
      needed = Math.max(needed, Math.abs(x - 100) / 100, Math.abs(y - 100) / 100);
    }
  }

  return needed;
}

/**
 * How much clearance to leave past the corner that only just makes it.
 *
 * The same 2-odd units the shipping overscan happens to leave at 2.5°, kept
 * rather than shaved because the corner it protects is a hard-edged triangle of
 * background appearing on a beat, which is the single most visible way any of
 * this can fail.
 */
const OVERSCAN_MARGIN = 0.02;

/**
 * What the picture has to be drawn at once a tilt can land on top of the motion.
 *
 * Works out at 1.18 against the shipping 1.1, and the cost is real and worth
 * stating plainly: the frame crops a further twelfth into every portrait, so a
 * kit sits slightly larger and slightly tighter the moment any tilt trigger is
 * ticked.
 *
 * Sized from TILT_ROLL_MAX and never from the angle actually selected, which is
 * the load-bearing part now that the angle is a slider. A scale that followed the
 * setting would zoom the head while the slider was being dragged — and the thing
 * being judged is how far the head leans, which is not a question anyone can
 * answer while the head is also growing. So the whole range is paid for up front
 * and the framing holds still across every position of it.
 *
 * It is deliberately not sensitive to which HeadMotion is selected either, for
 * the same reason one step further out: a direction switch that also changed the
 * framing would be a switch nobody could use, because half of what changed on
 * screen would be the zoom. The one seam left is turning the feature on, which is
 * a moment the picture is expected to change anyway.
 *
 * The maximum runs over MOTION rather than assuming the swing is the worst case.
 * It is today — a rotation about a pivot 180 units off the top edge has a much
 * longer lever arm than 4 units of translate — but that is a fact about the
 * current numbers, not a rule, and this way changing them cannot silently
 * uncover a corner.
 */
export const TILT_OVERSCAN =
  Math.ceil(
    (Math.max(
      ...Object.values(MOTION).map((travel) =>
        requiredOverscan(travel.roll + TILT_ROLL_MAX, travel.rise),
      ),
    ) +
      OVERSCAN_MARGIN) *
      100,
  ) / 100;

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
    hint: 'The head follows the arc of the whole sentence rather than the syllables in it — one unhurried lean per phrase. The brows take the arc as a pose and keep the syllables on top of it, so they rise while there is speaking to do and dip back toward rest on the unstressed words. Still moves whenever there is sound.',
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
 * What the phrase envelope actually reaches on speech, and what is left over.
 *
 * Two measured facts, and the pair of them is why the brows spent months looking
 * like they did not move. Everything above treats `phrase` as a 0-to-1 fraction
 * and it is nothing of the sort. Run an ordinary sentence — mixed stress, a comma,
 * a full stop — through MouthAnalyser and then through the constants above, and
 * the envelope lives between 0.26 and 0.78 while there is speaking to do. It
 * cannot reach 1 and is not supposed to: a 0.9s release cannot fall between
 * syllables 0.25s apart.
 *
 * The damning figure is not the ceiling, though. It is that the mean across that
 * sentence is 0.57 — *74% of the envelope's own peak*. A signal whose average is
 * three quarters of its maximum is not a movement, it is an offset with a wobble
 * on it. For the head that is exactly right and exactly what was asked for: one
 * unhurried lean that arrives and stays for the sentence. For the brows it meant
 * they rose once per turn and then sat there.
 *
 * So the envelope is read against its own ceiling rather than against 1, and the
 * *residual* — how far this syllable sits above or below the phrase around it —
 * becomes the second signal. Measured on the same sentence it runs from -0.55 to
 * +0.81, which is a great deal more range than the envelope has and is the whole
 * reason it is worth reading: the syllables were never missing from the audio,
 * only from the brows.
 *
 * Both are properties of the constants above and of speech, so they move only if
 * PHRASE_ATTACK or PHRASE_RELEASE moves. Neither is a tuning knob, and both were
 * wrong on the first attempt: guessed at 0.65 and 0.4 from arithmetic rather than
 * measured through the shipping analyser, which understated the residual by half
 * and made the beat hot enough to put the brows on the floor for 30% of every
 * sentence — the per-syllable twitch this cadence exists to remove, reintroduced
 * by the thing meant to enrich it. Measure these; do not derive them.
 */
const PHRASE_FULL = 0.75;
const BEAT_FULL = 0.8;

/**
 * How a brow divides that between holding a pose and marking a syllable.
 *
 * The brows' reading of `phrase` is not the head's, and this is where the two
 * channels part company. A head following the arc of a sentence is the whole of
 * what that cadence promised, and it delivered it. The same treatment left the
 * brows parked: on the measured sentence, at the lift and the cap that shipped,
 * they sat between 0.6 and 1.9 pixels and moved 1.3 of them across four seconds
 * of speech. A brow raised a pixel and a half for the length of a turn is not an
 * expression, it is a face mildly surprised by everything.
 *
 * The fix is to keep both signals rather than to choose between them. The plateau
 * is the pose — brows up while there is speaking to do — and the beat is the
 * syllable riding on top of it, signed, so an unstressed word pulls the brow back
 * *down* toward where the artwork drew it. That is what a real brow does under
 * emphasis, and it is the whole of what "up and down" requires: no crop travels
 * below its box, because the sum is clamped at zero and zero is the drawn
 * position.
 *
 * Weighted seven to three, and the weighting is the part that had to be measured
 * rather than reasoned about. The pose is what says *speaking* and the beat is
 * what says *this word*, so the pose has to dominate — at six to four the brow
 * reached the floor on 6% of speaking frames and the accent stopped reading as an
 * accent, because a beat that can travel the whole range is not a beat, it is the
 * `syllable` cadence with extra steps. At seven to three the brow rides between
 * 0.15 and 0.78 of the lift and never touches bottom while the voice is going:
 * 0.7 to 3.7 pixels at the default, moving 3.0 of them. Against the 1.3 above,
 * and with the dips now landing on the unstressed words rather than at the ends
 * of turns.
 *
 * The two sum to 1, so the lift a caller asks for is what a stressed syllable at
 * the top of a loud phrase would reach. Approached rather than promised — the two
 * peaks need not coincide, and 0.78 is as close as that sentence gets. Stated
 * plainly because the alternative is what went wrong here twice: a ceiling nobody
 * reaches, quietly keeping a quarter of every raise.
 */
const BROW_PLATEAU = 0.7;
const BROW_BEAT = 0.3;

/**
 * How far a kit's brows travel at full lift, in head units, as a range.
 *
 * A slider for the reason DEFAULT_TILT_ROLL is one, and the argument is stronger
 * here because it has already been lost twice. This number was 1.8, and was
 * raised to 3 on the finding that 1.8 units is 1.4 pixels of travel on the stage
 * that draws it — below the size of the thing drawing it, which is what "the
 * brows do not appear to move" looks like from the inside. The raise did not land
 * either, because the driver above was quietly keeping a third of it, and nobody
 * could tell which of the two was wrong from a constant in a file.
 *
 * For scale, in the units that decide it: the live stage draws this 200-unit head
 * at 160 pixels, so a unit is 0.8 pixels.
 *
 *   3u   2.4px   what shipped, of which 1.9px was ever reached
 *   6u   4.8px   the default below, of which 3.7px is reached
 *  12u   9.6px   the ceiling, and further than most portraits have forehead for
 *
 * Six is also about what anatomy asks for: a real brow raise runs five to ten
 * millimetres on a head two hundred tall, which is three to five percent of it,
 * and 6 of 200 units is three. The old 3u was one and a half — subliminal by
 * construction, whatever the driver did with it.
 *
 * The ceiling is not a round number either. Past about 12 units the crop's top
 * edge is travelling further above its box than any brow box on a portrait with
 * a fringe has clear forehead to spare, so the cap in Face.tsx would be doing all
 * the deciding and the slider would stop responding — a control that goes dead in
 * its last third is worse than one that stops there.
 */
export const DEFAULT_BROW_LIFT = 6;
export const BROW_LIFT_MIN = 0;
export const BROW_LIFT_MAX = 12;

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
 *
 * Which is exactly what had happened, unnoticed, for as long as this existed. The
 * share is measured against the *nominal* lift, and speaking only ever reached
 * 0.64 of that — so 0.7 was not a restrained fraction of the voice's movement, it
 * was larger than the largest lift any sentence produced. The one brow movement
 * with no cause but a blink was the biggest one on the face. It reads as under a
 * full lift again now that a stressed syllable gets to 0.78, and that ordering is
 * the thing to preserve if either number is touched: see BROW_PLATEAU.
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
 * The shape of a tilt, and the one envelope here that is a pose rather than a beat.
 *
 * Read against GESTURE, which it is deliberately unlike in all three terms. The
 * attack is more than twice as slow because a tilt settles into place — a head
 * that snaps sideways in 120ms has been startled, not made thoughtful. The hold
 * is nearly six times as long, which is the whole of what makes it a pose: it is
 * meant to still be there while the silence it was fired by plays out. And the
 * release is slower again than the attack, because a tilt unwinding faster than
 * it arrived reads as the head being let go of.
 *
 * Two seconds all told. That is long enough to be caught leaving as well as
 * arriving, and short enough that the face cannot be found frozen at an angle
 * thirty seconds into somebody else's turn — which is the failure mode of the
 * obvious alternative, holding it until the agent speaks again.
 */
const TILT: Envelope = { attack: 0.28, hold: 1, release: 0.8 };

/**
 * How long the tilt refuses to fire again, in seconds.
 *
 * Between the head's 2.5 and the brows' 7, and nearer the brows on purpose: this
 * is a bigger, slower and more meaningful movement than a nod, and the whole
 * argument for it is that it is rare. It also has to absorb the case where two
 * triggers are ticked and both have something to say about the same moment —
 * the end of a question is a silence too — so that turning on a second trigger
 * costs at most a different tilt rather than a second one.
 */
const TILT_LOCKOUT = 5;

/**
 * The lips closing as a turn begins — the mouth's one movement that is not speech.
 *
 * It is the question the idle sway asked and lost, put to the feature where
 * losing it would cost the most. A mouth is what the eye watches for speech, so
 * anything it does without sound reads as an *attempt* to speak: on a timer that
 * is a face muttering to itself, and during the user's turn it is a face
 * interrupting. The sway's verdict holds here with the volume up — what fails an
 * idle movement is not its size, it is the absence of a cause.
 *
 * So this one is not idle at all, and the cause it waits for was already written
 * down a few dozen lines below, as an obstacle. `heardThisTurn` exists because
 * the quiet a turn *begins* with runs longer than PAUSE_HOLD: the transport
 * flips `speaking` the moment it queues audio, which is better than 450ms before
 * anyone hears any. That window is a nuisance to the pause detector and a gift
 * to this — closing the lips in it is what a person does before they start
 * talking, and it is the rare case where the honest gesture and the free one are
 * the same gesture.
 *
 * Under a third of a second all told, which is sized to fit inside that window
 * rather than chosen for its shape. Being caught still releasing as the first
 * syllable lands is not a failure, though, and is the reason the release is the
 * longest of the three terms: lips parting into a sound is what the end of a
 * press is *for*, and the only thing that must be over by then is the closing.
 *
 * The channel it borrows is the one genuinely contended thing here. Brow and
 * blink combine with a max because they are magnitudes; the viseme is a single
 * discrete slot the analyser owns on every frame it has anything to say. The
 * press never argues for it — see PRESS_DEPTH for how much it asks, and
 * `pressed` in Face.tsx for how it hands the slot back.
 */
const PRESS: Envelope = { attack: 0.1, hold: 0.08, release: 0.16 };

/**
 * How far toward `mbp` a press goes, as a share of the whole pose.
 *
 * All the way, and it shipped at 0.6 on an argument that measurement did not
 * support. The argument was BROW_FLASH_LIFT's, which is a good one in general: an
 * idle movement that reaches what speech reaches has stopped being idle, and
 * `mbp` is a real viseme, so a press driven the whole way would be
 * indistinguishable from a consonant with no sound under it.
 *
 * What that reasoning assumed is that `mbp` looks like something. It does not.
 * Running patchDivergence over the shipped kit — the share of centre pixels that
 * differ visibly, which is what the twin check on the kit page already uses —
 * puts `rest` against `mbp` at 7.9%, the *closest* pair in the set by some way:
 *
 *   rest / mbp    7.9%     this gesture, at full travel
 *   rest / oh    11.8%
 *   rest / ee    15.2%
 *   rest / uh    20.8%
 *   rest / aa    34.0%
 *   aa   / oh    37.8%     the widest the mouth ever moves
 *
 * So the ordering the brow flash exists to protect is not in danger at any
 * setting: a full press is already the smallest movement this mouth can make,
 * a fifth of what a vowel change does. Six tenths of it came to under 5% of the
 * pixels changing for a third of a second, which is not a subtle gesture — it is
 * an invisible one, and that is exactly how it was reported.
 *
 * Which leaves the artwork as the real ceiling, and worth stating plainly because
 * no number here can lift it. Both poses are a closed mouth, and a model asked to
 * close a mouth that is already closed has little to do — slots.ts records the
 * sharper version of this, where the two came back identical. 7.9% is the whole
 * budget this gesture has to spend, and the only way to raise it is to draw an
 * `mbp` that sits further from `rest`.
 */
const PRESS_DEPTH = 1;

/**
 * How long a press refuses to fire again, in seconds.
 *
 * Insurance rather than pacing, unlike every other lockout here. Turns are
 * seconds apart by their nature, so nothing about a conversation needs this —
 * what needs it is that `speaking` is a prop from the transport rather than a
 * clock in this file, and a prop that flickers false and true between queued
 * chunks would spend a press on each flicker. Two seconds is longer than any
 * such flicker and shorter than any real gap between turns.
 */
const PRESS_LOCKOUT = 2;

/**
 * What counts as the voice having stopped, and for how long, in share and seconds.
 *
 * The threshold sits just under the mouth's own SILENCE of 0.12, so the lips are
 * already closed by the time the head is willing to call it a gap — a head that
 * leaned on a sound the mouth was still shaping would be reacting to a
 * measurement rather than to a pause.
 *
 * The hold is what separates a pause from a plosive. Ordinary speech is full of
 * gaps a hundred milliseconds wide and every stop consonant is one of them, so
 * anything under about a third of a second is not hesitation, it is language.
 * At 0.45 the trigger wants a gap roughly four times the width of the longest
 * of those.
 *
 * Deliberately read off the raw level rather than off the phrase envelope, which
 * is the near-miss worth writing down: `phrase` releases with a 0.9s time
 * constant, so it takes about 800ms to fall from speaking to ARM_LOW whatever
 * the sound does. Timed off that, every pause would be found at the same
 * apparent length, and a breath would be indistinguishable from a thought.
 */
const PAUSE_SILENCE = 0.1;
const PAUSE_HOLD = 0.45;

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

/** What everything but the spoken mouth is doing this frame. */
export interface Performance {
  /** The head, as a multiplier on MOTION. */
  head: number;
  /**
   * Never negative, and now guaranteed rather than merely observed.
   *
   * A brow at rest is already as low as that face's brow goes — zero is the
   * position the artwork was drawn in, not a midpoint. This used to be true for
   * free, every signal feeding it being non-negative. It is now true because it
   * is clamped: under `phrase` the brows carry a signed per-syllable beat that
   * genuinely asks to go below rest, and what it gets instead is the drawn
   * position. See BROW_PLATEAU for why the downward half is worth having anyway.
   */
  brow: number;
  /**
   * The tilt, as a share of whatever angle the face is set to — and signed,
   * alone among these.
   *
   * The other two channels have a direction built into the number they scale.
   * This one does not, because a tilt that always went the same way would be the
   * single most mechanical thing this face does: nobody watching would be able
   * to say what was wrong, and everybody would notice.
   */
  tilt: number;
  /**
   * How far the lips are closed toward `mbp`, 0 to 1, and 0 for nearly all of a
   * call.
   *
   * The odd one out in what it describes. The other three are multipliers on a
   * transform — how far to lift, to lean, to raise — and mean nothing without the
   * number they scale. This one names a pose the mouth already has, and says how
   * far along the way to it the lips have got. See PRESS.
   */
  press: number;
}

/** What the caller knows about the moment that the loudness cannot tell it. */
export interface CueInput {
  /** Which events may fire a tilt. Empty is that feature switched off. */
  triggers: readonly TiltTrigger[];
  /**
   * True while the agent's audio is playing, gaps inside it included.
   *
   * The one thing separating a hesitation from a handover, and the reason it is
   * a prop rather than something inferred here: from inside this file a pause
   * mid-sentence and the end of a turn are the same silence, and only the
   * transport knows whether more audio is queued behind it.
   *
   * Two features read it now and they want opposite things from it. The tilt
   * wants to know whether a silence sits *inside* a turn. The press wants the
   * rising edge — the frame the transport first admits a turn is coming, which
   * arrives before there is anything to hear.
   */
  speaking: boolean;
  /** Whether the lips close as a turn begins. See PRESS. */
  press: boolean;
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
  private justStarted = false;

  constructor(
    private readonly shape: Envelope,
    private readonly lockout = 0,
  ) {
    this.span = total(shape);
    this.since = this.span;
  }

  /**
   * Whether the last `advance` was the frame this took the trigger.
   *
   * Asking is not the same as watching the value leave zero, which is the
   * tempting cheaper version: a movement that has just fired is at zero for that
   * frame — the envelope is read after `since` is reset, and smooth(0) is 0 — so
   * the two differ by a frame. That gap does not matter for anything reading the
   * height, and matters entirely for the tilt, which has to choose a side before
   * there is any height to give a side to.
   */
  get started(): boolean {
    return this.justStarted;
  }

  advance(dt: number, trigger: boolean): number {
    this.since += dt;
    this.locked = Math.max(0, this.locked - dt);
    this.justStarted = false;

    if (trigger && this.locked === 0 && this.since >= this.span) {
      this.since = 0;
      this.justStarted = true;
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
  private readonly tiltChannel = new Channel(TILT, TILT_LOCKOUT);
  private readonly pressChannel = new Channel(PRESS, PRESS_LOCKOUT);
  /**
   * Whether a turn was running last frame, so the press can take the rising edge.
   *
   * Found here rather than pushed in like `blinked`, `heardQuestion` and
   * `yielded`, and the difference is not inconsistency. Those three report things
   * this file cannot see at any price — a clock it does not own, a transcript it
   * never reads. This one is already arriving on every frame as `speaking`, and a
   * second copy of it as an event would be a second thing to keep in step with
   * the first.
   */
  private wasSpeaking = false;
  /** Set by `blinked`, spent by the next `read`. */
  private flashPending = false;
  /** Set by `heardQuestion` and `yielded`, spent by the next `read`. */
  private questionPending = false;
  private yieldPending = false;
  /**
   * Which way the next tilt goes.
   *
   * Strictly alternating, and randomly seeded so that neither the first tilt of
   * a session nor two faces sharing a page can be relied on to lean the same
   * way. Strict rather than diced because the thing being avoided is a run of
   * tilts to one side, and at one every five seconds and up there is no rhythm
   * for the alternation itself to fall into — a viewer would have to hold two
   * gestures half a minute apart in their head to notice it was regular.
   */
  private tiltSide = Math.random() < 0.5 ? 1 : -1;
  /** Seconds the voice has been under PAUSE_SILENCE. */
  private quietFor = 0;
  /**
   * Whether this turn has actually made a sound yet.
   *
   * Without it the pause detector fires on the wrong edge. `speaking` goes true
   * the moment audio is queued, which is a fraction before there is anything in
   * it to hear, so the run of quiet that a turn *begins* with is longer than
   * PAUSE_HOLD — and the face would lean into every sentence just as it started
   * rather than where it faltered.
   */
  private heardThisTurn = false;
  /** Spent once per gap, so one pause cannot fire on every frame it lasts. */
  private pauseSpent = false;

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
   * A sentence ending in a question mark has just become audible.
   *
   * Pushed in for the blink's reason and one more of its own. The blink's: the
   * clock belongs to whoever owns it, and a second copy in here would drift.
   * This one's: the signal is not in the audio at all. It is in the transcript,
   * which arrives on the socket seconds ahead of the sound that carries it and
   * is held back to match — so the only place that knows when a question was
   * *heard* is the thing doing the holding. Nothing measurable from this side
   * would distinguish the end of a question from the end of any other sentence.
   *
   * No dice here, unlike `blinked`. A question is already rare, and thinning it
   * further would leave the most defensible of the three triggers firing least
   * often — which is the wrong way round for the one the feature ships on.
   */
  heardQuestion(): void {
    this.questionPending = true;
  }

  /** The agent's audio has ended and the floor is back with the user. */
  yielded(): void {
    this.yieldPending = true;
  }

  /**
   * @param dt Seconds since the previous frame.
   * @param level Smoothed loudness from the mouth analyser, 0 to 1.
   */
  read(dt: number, level: number, cadence: MotionCadence, cue: CueInput): Performance {
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

    // The lips, closing before the voice arrives. The edge is taken whether or
    // not the box is ticked, so that ticking it mid-call cannot inherit a turn
    // that started before it — the promise the lockouts above make about
    // switching cadence, owed here for the same reason.
    const turnStarting = cue.speaking && !this.wasSpeaking;
    this.wasSpeaking = cue.speaking;
    const press = this.pressChannel.advance(dt, turnStarting && cue.press) * PRESS_DEPTH;

    // The gap detector. Runs whether or not `hesitation` is ticked, so that
    // ticking it mid-call does not inherit a pause that started a minute ago —
    // the same promise the lockouts above make about switching cadence.
    if (!cue.speaking) {
      this.heardThisTurn = false;
      this.quietFor = 0;
      this.pauseSpent = false;
    } else if (level >= PAUSE_SILENCE) {
      this.heardThisTurn = true;
      this.quietFor = 0;
      this.pauseSpent = false;
    } else {
      this.quietFor += dt;
    }

    const inPause = this.heardThisTurn && !this.pauseSpent && this.quietFor >= PAUSE_HOLD;
    if (inPause) this.pauseSpent = true;

    // Each trigger asked twice: once whether it happened, once whether it is
    // wanted. Both events are cleared either way, for the flash's reason —
    // banked and cashed in later, a question would tilt the head at a moment
    // with nothing in the conversation to account for it.
    const wanted = (id: TiltTrigger) => cue.triggers.includes(id);
    const fireTilt =
      (this.questionPending && wanted('question')) ||
      (this.yieldPending && wanted('listening')) ||
      (inPause && wanted('hesitation'));
    this.questionPending = false;
    this.yieldPending = false;

    const leaning = this.tiltChannel.advance(dt, fireTilt);
    if (this.tiltChannel.started) this.tiltSide = -this.tiltSide;

    const head =
      cadence === 'syllable' ? level : cadence === 'phrase' ? this.phrase : headGesture;
    /*
      The brows take the same three cadences and read the middle one differently,
      which is the one place these two channels disagree about what a setting
      means. Under `syllable` and `gesture` they are already getting the whole of
      a signal — the raw loudness, or a self-contained envelope — and there is
      nothing for a plateau to add. Under `phrase` the head wants the arc and the
      brows want the arc *and* the syllables on it. See BROW_PLATEAU.
    */
    const spoken =
      cadence === 'syllable'
        ? level
        : cadence === 'phrase'
          ? // Clamped at both ends, and the lower clamp is load-bearing rather
            // than defensive: the beat is signed, so an unstressed syllable early
            // in a phrase asks for a negative lift. Zero is where the artwork
            // drew the brow, and no brow goes below its own drawing.
            Math.max(
              0,
              Math.min(
                1,
                BROW_PLATEAU * Math.min(1, this.phrase / PHRASE_FULL) +
                  BROW_BEAT * ((level - this.phrase) / BEAT_FULL),
              ),
            )
          : browGesture;

    // The louder of the two rather than their sum, and it matters most in the
    // case that looks harmless: a blink landing mid-phrase. Summed, the brows go
    // somewhere neither movement asked for and the lift reads as surprise; taken
    // as a maximum, the flash is simply invisible whenever the voice is already
    // asking for more, which is the correct thing for the smaller movement to do.
    const brow = Math.max(spoken, flash);

    return { head, brow, tilt: leaning * this.tiltSide, press };
  }
}
