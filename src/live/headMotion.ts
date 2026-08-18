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
 * The listener's nod — the third answer to the question the idle sway asked.
 *
 * The two above it both move the head while the *face* has something to do: the
 * swing rides the voice, the tilt fires on a question or a handover. Between
 * those moments the head still does nothing, and "those moments" is a smaller
 * share of a conversation than it sounds. For most of a call the user is talking
 * and this face is a photograph with working eyelids.
 *
 * That gap is not a gap in the schedules, it is a gap in what was ever measured.
 * Every channel in this file except the press reads the *agent's* loudness, and
 * the agent's loudness is zero for the whole of the user's turn — so the head has
 * no input at all during the one stretch a real listener is most obviously doing
 * something. What a real listener is most obviously doing is nodding. It is the
 * commonest visual backchannel there is by a distance, ahead of the lean and far
 * ahead of anything the brows do.
 *
 * It clears the sway's bar on the sway's own terms. The cause is not merely
 * present, it is the loudest thing in the room: somebody is talking to this face.
 * `heard` already says so, debounced, and already arrives every frame for the
 * press to take an edge off it.
 *
 * What it does *not* do is follow the user's syllables, and that is a choice
 * rather than a shortcut. It could — MicCapture measures the input's energy
 * already and throws the number away — but a backchannel nod is not phase-locked
 * to the speaker the way the swing is locked to the agent. It arrives every few
 * seconds on the listener's own clock, which is the blink's argument once more,
 * and the cheap version is worth finding wrong before the expensive one is built.
 * If this reads as arbitrary against a real voice, that is the finding, and the
 * level is the thing to reach for.
 */

/**
 * Down, and only down.
 *
 * A nod is a pitch about the neck and a portrait cannot pitch, which is the wall
 * `rise` already hit and settled: on flat artwork a vertical translate is what a
 * nod looks like. The face's emphasis uses the same move, so these are one
 * movement asked for by two different things rather than two inventions.
 *
 * The direction is not symmetric, so the value is unsigned. A nod dips from rest
 * and returns to it; it does not pass above rest on the way. Up first reads as a
 * greeting or as being addressed rather than as agreement, and an overshoot
 * between dips reads as a bounce. So `nod` on Performance runs 0 to 1 meaning
 * *how far down* — alone among these channels in having spent its sign at the
 * point of definition rather than carrying one.
 */

/**
 * How far it dips at full depth, in head units, as a range.
 *
 * The ceiling is 4, which is MOTION.rise's own travel, and the coincidence is
 * not borrowed for tidiness: it is the largest downward translate the shipping
 * OVERSCAN still covers. Measured with requiredOverscan below rather than
 * guessed — 4 units down under a full lean wants the picture drawn at 1.0819
 * against the 1.1 it is drawn at, leaving 1.8 units of clearance, within a
 * whisker of the 2.2 the emphatic swing leaves. Raising this past 4 means
 * raising OVERSCAN with it.
 *
 * For scale, in the units that decide it: the live stage draws this 200-unit
 * head at 160 pixels, so a unit is 0.8 of a pixel.
 *
 *   3u   2.4px   the default below
 *   4u   3.2px   the ceiling, and the whole of what the emphasis travels
 *
 * The default sits near the top of a short range, on the lesson this file has
 * now learned from both directions — the brows shipped at 1.4px and could not be
 * seen, the tilt shipped at 4.9px and was too much. The tilt's argument for
 * staying small does not transfer: that one is a posture with a lateral slide
 * that gives it away, and this is a gesture with nothing to give away.
 */
export const DEFAULT_NOD_DEPTH = 3;
export const NOD_DEPTH_MIN = 0;
export const NOD_DEPTH_MAX = 4;

/**
 * On, which is the opposite of how the tilt shipped and for the press's reason.
 *
 * DEFAULT_TILT_TRIGGERS holds two of three back because the open question there
 * is frequency, and three leans at once is a face that cannot keep still. There
 * is no such question here: one gesture, one trigger, firing only while somebody
 * is talking to the face. What is worth learning is whether a nodding face reads
 * as listening, and nobody learns that from a box they have to find and tick.
 */
export const DEFAULT_LISTEN_NOD = true;

/**
 * One dip, in seconds, and how many of them a nod is made of.
 *
 * A little over three a second, which is about where real nodding sits, and two
 * or three per firing. The count is diced rather than fixed for the reason the
 * blink's gap is jittered, with one turn of the screw: this is the only gesture
 * here that repeats *within itself*, so it is the only one with a rhythm of its
 * own available to give it away. A listener who always nods exactly twice is a
 * metronome with a face.
 *
 * Two dips comes to 0.64s, which is GESTURE's duration to within a frame. That
 * envelope's comment calls itself "roughly a nod"; this is the guess checked
 * against the thing it was guessing at.
 */
const NOD_BOB = 0.32;
const NOD_BOBS_MIN = 2;
const NOD_BOBS_MAX = 3;

/**
 * How deep the last dip is against the first, as a share of it.
 *
 * Real nods run down rather than repeating at strength, and the tail is most of
 * what separates a nod from a bounce.
 *
 * Stepped per dip rather than faded across the firing, which is the difference
 * between this reading as stated and reading as nearly so. Faded, the depth is
 * already coming down while the first dip is on its way to its peak, and the
 * peak lands at 0.91 of what the caller asked for — the exact fault BROW_PLATEAU
 * had to be measured to find, a ceiling nobody reaches, quietly keeping a tenth
 * of every setting. Stepped, the change happens where the value is zero anyway,
 * so there is nothing to smooth and the first dip is the depth on the slider.
 */
const NOD_DECAY = 0.65;

/**
 * How long the head refuses to nod again, in seconds.
 *
 * Longer than the head's own 2.5 and shorter than the brows' 7. Backchannels
 * come every few seconds in real listening and this is the middle of that, taken
 * from the start of one nod rather than from its end — so the quiet between two
 * runs about three seconds at two dips, with the usual jitter on it.
 */
const NOD_GAP = 3.5;

/**
 * How long somebody has to have been talking before the first nod, in seconds.
 *
 * `heard` goes true on the first syllable, and a face that nods on the first
 * syllable is not agreeing with anything — it has not been told anything yet.
 * Held off by about a word, which also spends nothing on the one-word answers
 * that a tutor's questions mostly get.
 */
const NOD_ONSET = 0.8;

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
 * The nod spends from the same margin in the other direction, and is capped so
 * that it fits: 4 units down wants 1.0819 and leaves 1.8 units spare, which is
 * where NOD_DEPTH_MAX comes from rather than from anything about nodding.
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
      ...Object.values(MOTION).flatMap((travel) => [
        requiredOverscan(travel.roll + TILT_ROLL_MAX, travel.rise),
        // And the nod, which translates the other way and is the one channel
        // that can land *during* a lean — a listening tilt and a listening nod
        // answer the same moment. It does not move the answer today: the lean's
        // lever arm dominates both translates, and the worst case comes out at
        // 1.1583 against the lift's 1.1531, which is the same 1.18 once the
        // margin and the rounding have had it. Included anyway, so that raising
        // NOD_DEPTH_MAX cannot quietly uncover a corner.
        requiredOverscan(travel.roll + TILT_ROLL_MAX, -NOD_DEPTH_MAX),
      ]),
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
 *
 * All of which is reasoning about the wrong case, and the paragraph above is
 * left standing because the error is instructive rather than because it is
 * wrong. Every figure in it compares the flash against *speech* — is it under a
 * full lift, does it compete with what the voice asks for, is it smaller than a
 * stressed syllable. But the frames where the flash is the whole of what the
 * brow does are the frames with no speech in them at all, and against silence
 * none of those comparisons say anything. Worse, they are the frames where the
 * flash is least likely to be hidden: `brow` takes the louder of the two, so
 * while a sentence is running this mostly disappears under the pose, and the
 * moment the sentence stops it is the only thing on the face.
 *
 * So the number that was tuned is the one that is hardly ever seen. What is seen
 * is 0.7 of a full lift arriving in 90ms on a face that is otherwise perfectly
 * still — and an isolated brow raise is not a neutral movement. It means
 * something: surprise, recognition, a greeting. Fired every eight seconds at
 * nothing, it is BROW_FLASH_CHANCE's own complaint about reacting to something
 * you cannot see, at half the rate that comment rejected rather than at none.
 */
const BROW_FLASH_LIFT = 0.7;

/**
 * And how far one lifts them with nobody speaking, which is the case that
 * matters.
 *
 * A quarter, against the speaking 0.7, and it is meant to sit near the edge of
 * visibility rather than comfortably above it. The job of this movement when the
 * face is silent is not to be a brow raise — it is to stop the blink reading as
 * a shutter closing on a photograph. A real brow travels a millimetre or so with
 * an ordinary blink and nobody watching could tell you it happened; they could
 * tell you the blink looked wrong without it.
 *
 * At the default travel that is 1.5 units, 1.2 pixels on the live stage. This
 * file has called that figure invisible twice, and both times it was right and
 * about something else: a brow *gesture* at 1.2px is a gesture nobody can see,
 * and a brow *accompanying a blink* at 1.2px is doing exactly what it should.
 * The two share a slider and want opposite things from it, which is why they no
 * longer share a constant.
 *
 * Latched when the flash fires rather than read per frame — see `flashLift`. A
 * turn beginning halfway through a flash would otherwise step the brow from a
 * quarter to seven tenths between two frames, which is the one way this can
 * produce a movement nothing accounts for.
 */
const BROW_FLASH_LIFT_IDLE = 0.25;

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
 * Which moments close the lips, offered as a set for TILT_TRIGGERS' reason.
 *
 * Both are the same gesture on the same channel, and they differ only in whose
 * turn is beginning:
 *
 *  - `turn` is the original, and it is the face's own preparation. It fires on
 *    the rising edge of `speaking` — the window between the transport queueing
 *    audio and the first sound of it arriving. See PRESS.
 *  - `reply` is the face reacting to being answered. It fires when the mic first
 *    hears a voice with the agent silent, so the lips close as the user starts
 *    talking rather than as the tutor stops. See `heard` on CueInput.
 *  - `waiting` is the odd one, and the only movement on this face that happens
 *    with nobody talking at all. See WAIT_ONSET.
 *
 * The pair reads very differently and only one of them is about attention.
 * `turn` is self-directed: the mouth getting ready to use itself, which is
 * honest and says nothing about the listener. `reply` is the one that looks like
 * noticing — a mouth that shuts the moment somebody else starts is a mouth
 * declining the floor, and that is the whole content of the gesture.
 *
 * Ticking both does not press twice as often, which is worth knowing before
 * reading it as a frequency setting. The two moments bracket the user's turn:
 * `reply` at the start of it, `turn` at the end when the answer comes back. A
 * short exchange puts them inside PRESS_LOCKOUT of each other and the second is
 * swallowed, so the pair costs at most one press per exchange either way — it
 * changes which end of the user's turn gets the gesture, not how much there is.
 */
export type PressTrigger = 'turn' | 'reply' | 'waiting';

/**
 * Both, which is the opposite of how the tilt shipped and for a reason.
 *
 * DEFAULT_TILT_TRIGGERS holds one of three back because the open question there
 * is frequency — three leans at once is a face that cannot keep still, and
 * shipping all of them would answer that question in the wrong direction before
 * anyone had looked. This set cannot ask that question: the lockout above means
 * two ticks and one tick produce the same number of presses in any exchange
 * short enough for it to matter. What the second box buys is *which* moment,
 * and there is nothing to learn from withholding it.
 */
export const DEFAULT_PRESS_TRIGGERS: readonly PressTrigger[] = ['turn', 'reply', 'waiting'];

/**
 * How long nobody has to have said anything before the lips move on their own,
 * and how long between them after that, in seconds.
 *
 * This is the idle sway's question a third time, and it is the first time the
 * answer has been anything but no. The sway lost because a head has no reason to
 * move on its own; the blink survives because eyes need blinking whatever else
 * is going on. A lip press is on the blink's side of that line rather than the
 * head's — lips dry, part, and get re-seated, and a mouth that closes and
 * settles while its owner waits is doing maintenance rather than performing
 * patience. Nothing has to be happening in the conversation for it to be honest.
 *
 * It also inherits PRESS's own exemption, which is what makes it admissible at
 * all: this gesture travels *toward* closed, and a mouth that shuts cannot be
 * read as a mouth trying to speak. The rule against idle mouth movement stands
 * and this is the same one exception, now claimed twice.
 *
 * The onset is four seconds because turn-taking is faster than that. The gap
 * between the tutor finishing and the user answering is a second or two, and it
 * already has a tilt landing in it; four seconds of nothing is not a handover,
 * it is a learner who is stuck — which is both the moment worth having a face
 * for and the moment there is least else on screen. Fourteen seconds between
 * them makes this comfortably the rarest thing the face does: the blink is four,
 * the flash eight, the nod three and a half. Both are jittered like every other
 * schedule here.
 *
 * Unlike the second trigger, this one *is* a frequency change and not merely a
 * choice of moment — DEFAULT_PRESS_TRIGGERS' argument that ticking two costs no
 * more than ticking one does not extend to it, because it fires in a state
 * neither of the others can reach. It ships on anyway. The thing worth learning
 * is whether a waiting face should move at all, and that is not learned from a
 * box nobody ticks.
 */
const WAIT_ONSET = 4;
const WAIT_GAP = 14;

export const PRESS_TRIGGERS: Array<{ id: PressTrigger; label: string; hint: string }> = [
  {
    id: 'turn',
    label: 'Before speaking',
    hint: 'Closes the lips as the tutor’s turn begins, in the gap between its audio being queued and the first sound of it arriving — which is what a person does just before they start talking.',
  },
  {
    id: 'reply',
    label: 'As you answer',
    hint: 'Closes the lips when your microphone first hears you with the tutor silent, about a quarter of a second into your first word. The face registering that you have started, rather than waiting to be told the turn is over.',
  },
  {
    id: 'waiting',
    label: 'While waiting',
    hint: 'Closes them once every fourteen seconds or so through a silence nobody is filling — after four seconds of it, so an ordinary gap between turns never gets one. The only thing this face does with no conversation to hang it on, and the rarest movement on it.',
  },
];

/**
 * The lips closing at the edge of a turn — the mouth's one movement that is not
 * speech.
 *
 * It is the question the idle sway asked and lost, put to the feature where
 * losing it would cost the most. A mouth is what the eye watches for speech, so
 * anything it does without sound reads as an *attempt* to speak: on a timer that
 * is a face muttering to itself, and during the user's turn it is a face
 * interrupting. The sway's verdict holds here with the volume up — what fails an
 * idle movement is not its size, it is the absence of a cause.
 *
 * That second clause is also the objection `reply` had to clear, since it puts
 * the mouth in motion during exactly the stretch named there as the worst place
 * for it. It clears it on the one property no other mouth movement has: this
 * gesture travels *toward* closed. `rest` to `mbp` is the lips coming together,
 * and a mouth that shuts cannot be read as a mouth trying to speak — it is the
 * shape of declining the floor. The rule stands and this is its one exception.
 *
 * So neither trigger is idle, and the cause `turn` waits for was already written
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
 * `reply` inherits that envelope and has no window to fit inside, which makes
 * one term read differently rather than wrongly. It fires while the face is
 * silent and stays silent, so nothing is racing the release and the whole shape
 * is simply seen — where `turn` is a gesture caught in the act of being
 * interrupted by speech, this one plays to the end. If the two ever want
 * different envelopes it is the hold that would move, because a reaction can
 * afford to be looked at and a preparation cannot. They share one for now on the
 * grounds that nothing has yet been observed that asks them to differ, and a
 * second envelope is a second thing to tune.
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
 * It began as insurance rather than pacing, unlike every other lockout here.
 * Turns are seconds apart by their nature, so nothing about a conversation
 * needed it — what needed it is that `speaking` is a prop from the transport
 * rather than a clock in this file, and a prop that flickers false and true
 * between queued chunks would spend a press on each flicker. Two seconds is
 * longer than any such flicker and shorter than any real gap between turns.
 *
 * `reply` gave it a second job, and this one is pacing in earnest. The mic gate
 * releases after VOICE_RELEASE_MS, so an answer with a thinking pause longer
 * than that arrives here as two utterances rather than one — and without a
 * lockout the face would close its lips again every time the user resumed. That
 * is the failure the whole feature is built to avoid, one gesture short of it:
 * a mouth moving repeatedly through somebody else's turn stops being a reaction
 * and becomes the muttering PRESS argues against. Two seconds does not cover
 * every long answer, and does not need to — it has to be longer than the gaps
 * *inside* a sentence, which VOICE_RELEASE_MS has already absorbed, and the
 * press that survives it is a face re-engaging after a genuine silence.
 *
 * It is also what makes ticking both triggers cheap. The two moments sit at
 * either end of the user's turn, so a short exchange has them inside this of
 * each other and the second is simply refused. See PressTrigger.
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

/** That jitter applied to a duration, since four schedules now want it. */
const jittered = (seconds: number) =>
  seconds * (1 - LOCKOUT_JITTER + Math.random() * 2 * LOCKOUT_JITTER);

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
  /**
   * How far the head is dipped for a listener's nod, 0 to 1, and 0 for the whole
   * of any turn this face is taking.
   *
   * Unsigned where `tilt` is signed, and the asymmetry belongs to the gestures
   * rather than to this interface: a lean has no natural side and a nod has a
   * natural direction. See the nod block above.
   *
   * Deliberately not folded into `head`, which it can never overlap with anyway.
   * That number is multiplied by MOTION[motion], so under `swing` a nod routed
   * through it would come out as a roll — and a nod that leans sideways is not a
   * nod. No switch about how the head carries *speech* has any business changing
   * what agreement looks like.
   */
  nod: number;
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
   * Three features read it now and they want different things from it. The tilt
   * wants to know whether a silence sits *inside* a turn. `turn` wants the
   * rising edge — the frame the transport first admits a turn is coming, which
   * arrives before there is anything to hear. `reply` wants it false, as the
   * proof that the voice in the microphone is not this face's own.
   */
  speaking: boolean;
  /**
   * Whether the microphone is hearing a voice right now.
   *
   * A state rather than an event, and shaped after `speaking` deliberately: the
   * performer takes its rising edge itself, exactly as it does for that one, and
   * for the reason written on `wasSpeaking` below — a second copy of a fact that
   * is already arriving every frame is a second thing to keep in step with the
   * first.
   *
   * Debounced well before it gets here. What arrives is "somebody is talking",
   * held across the gaps inside a sentence by VOICE_RELEASE_MS, which is what
   * lets this be read as an edge at all: the raw threshold it is derived from
   * rises and falls several times a sentence.
   *
   * False on any face with no call behind it, which is every preview. There is
   * no microphone on the kit page and nothing there for one to hear.
   */
  heard: boolean;
  /** Which moments close the lips. Empty is that feature off. See PressTrigger. */
  press: readonly PressTrigger[];
  /**
   * Whether the head may nod while the microphone hears a voice.
   *
   * A boolean where the tilt and the press take sets, because there is one
   * moment this can fire on and no second candidate to weigh it against. See
   * DEFAULT_LISTEN_NOD.
   */
  nod: boolean;
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
      this.locked = jittered(this.lockout);
    }

    const { attack, hold, release } = this.shape;
    if (this.since >= this.span) return 0;
    if (this.since < attack) return smooth(this.since / attack);
    if (this.since < attack + hold) return 1;
    return 1 - smooth((this.since - attack - hold) / release);
  }
}

/**
 * The nod's own channel, because a nod is not one movement with three phases.
 *
 * Channel above plays an Envelope — up, held, down — which is the shape of every
 * other gesture here and the wrong shape for this one. A nod repeats inside
 * itself, and the repetition is the signal: one dip is a flinch, and it is the
 * second that means yes. No choice of attack, hold and release expresses that,
 * so this keeps the interface and throws the shape away.
 *
 * A raised cosine rather than a sine, which is what makes the dips *dips*. It
 * leaves rest and returns to it with zero slope at both ends and never crosses
 * it, so the head settles at neutral between nods with nothing to taper and no
 * upward overshoot to account for. The length varies per firing because the dip
 * count does; the rate does not.
 */
class NodChannel {
  /** Seconds since this fired. Level with `span` means nothing is playing. */
  private since = 0;
  private locked = 0;
  /** Zero until the first nod, which is what makes a fresh channel idle. */
  private span = 0;
  private bobs = 0;

  advance(dt: number, trigger: boolean): number {
    this.since += dt;
    this.locked = Math.max(0, this.locked - dt);

    if (trigger && this.locked === 0 && this.since >= this.span) {
      this.bobs = NOD_BOBS_MIN + Math.floor(Math.random() * (NOD_BOBS_MAX - NOD_BOBS_MIN + 1));
      this.span = this.bobs * NOD_BOB;
      this.since = 0;
      this.locked = jittered(NOD_GAP);
    }

    if (this.since >= this.span) return 0;

    // Which dip is being drawn, and how deep that one goes. The step lands on a
    // multiple of NOD_BOB, which is exactly where the cosine below is at rest —
    // so a change of depth is never visible as a change of position. See
    // NOD_DECAY.
    const dip = Math.floor(this.since / NOD_BOB);
    const depth = this.bobs > 1 ? 1 - ((1 - NOD_DECAY) * dip) / (this.bobs - 1) : 1;
    return (depth * (1 - Math.cos((2 * Math.PI * this.since) / NOD_BOB))) / 2;
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
  private readonly nodChannel = new NodChannel();
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
  /**
   * And whether the microphone was hearing a voice, for `reply`'s edge.
   *
   * Tracked unconditionally, including through the agent's own turn when the
   * edge cannot be used. That is what makes the echo case fail quiet rather than
   * loud. A microphone hears the tutor through the speakers, and while echo
   * cancellation removes most of it, what matters is what happens to whatever
   * gets through: tracked this way it has already set the flag by the time the
   * turn ends, so there is no rising edge waiting at the handover and no press
   * fires with nobody talking. The cost is that a user who answers within
   * VOICE_RELEASE_MS of the tutor stopping is heard as a continuation of the
   * echo and gets no press. Losing the gesture on the fastest answers is a much
   * better failure than spending it on silence.
   */
  private wasHeard = false;
  /**
   * Seconds the user has been talking without a break, for NOD_ONSET.
   *
   * Reset rather than paused whenever that stops being true, so the delay is
   * asked of every turn afresh: somebody who says two words, stops, and starts
   * again has begun a new thing to agree with, and the second start deserves the
   * same beat of listening before the head answers it.
   */
  private listeningFor = 0;
  /**
   * Seconds nobody at all has been talking, and the reading of it at which the
   * next waiting press is due.
   *
   * A deadline rather than a countdown, so the onset and the gap can differ
   * without a second clock: the first is due at WAIT_ONSET and each one after it
   * pushes the mark another WAIT_GAP out. Reset together the moment anybody
   * speaks, which is what makes the four seconds mean four seconds of *this*
   * silence rather than four seconds accumulated across a conversation.
   */
  private waitingFor = 0;
  private waitPressDue = 0;
  /** Set by `blinked`, spent by the next `read`. */
  private flashPending = false;
  /**
   * How far the flash on screen is lifting, fixed when it fired.
   *
   * Latched for `tiltSide`'s reason: the value depends on something that can
   * change while the movement is playing. A brow flash outlasts its blink by
   * four hundred milliseconds and a turn can begin inside that window, so read
   * per frame this would step from BROW_FLASH_LIFT_IDLE to BROW_FLASH_LIFT
   * between two frames — a brow jumping on the first sound of a sentence, which
   * is a movement the sentence did not ask for and cannot explain.
   */
  private flashLift = BROW_FLASH_LIFT_IDLE;
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
    const flashing = this.flashChannel.advance(dt, this.flashPending);
    // Fixed on the frame it fires, and only there. See `flashLift`.
    if (this.flashChannel.started) {
      this.flashLift = cue.speaking ? BROW_FLASH_LIFT : BROW_FLASH_LIFT_IDLE;
    }
    const flash = flashing * this.flashLift;
    this.flashPending = false;

    // The lips, closing at whichever edge of the turn is ticked. Both edges are
    // taken whether or not their box is, so that ticking one mid-call cannot
    // inherit a turn that started before it — the promise the lockouts above
    // make about switching cadence, owed here for the same reason.
    const turnStarting = cue.speaking && !this.wasSpeaking;
    const replyStarting = cue.heard && !this.wasHeard;
    this.wasSpeaking = cue.speaking;
    this.wasHeard = cue.heard;
    /*
      And the third moment, which is the absence of the other two. Run whether or
      not its box is ticked, for the reason every other schedule here is: ticking
      it mid-call must not cash in a silence that began a minute ago.

      Note that the deadline is pushed forward when it comes due rather than when
      a press actually results. The two differ only if PRESS_LOCKOUT were to
      swallow one, which at fourteen seconds against two it cannot — but spending
      the moment either way is the rule the flash and the tilt already follow, and
      the failure it prevents is the same one: a gesture banked during a silence
      and produced later, with nothing left to account for it.
    */
    const waiting = !cue.speaking && !cue.heard;
    if (!waiting) {
      this.waitingFor = 0;
    } else {
      if (this.waitingFor === 0) this.waitPressDue = jittered(WAIT_ONSET);
      this.waitingFor += dt;
    }
    const waitPressing = waiting && this.waitingFor >= this.waitPressDue;
    if (waitPressing) this.waitPressDue = this.waitingFor + jittered(WAIT_GAP);

    const wantsPress = (id: PressTrigger) => cue.press.includes(id);
    /*
      `reply` is gated on the agent being silent, and the gate is not merely
      belt-and-braces for the echo the flag above absorbs. It is what keeps the
      press off a barge-in. A user talking over the tutor produces this edge
      mid-sentence, and the mouth is drawing visemes at that moment — the press
      would be scaled to nothing by `pressed` in Face.tsx and invisible, but it
      would still be *spent*, and the lockout would then swallow the honest
      press waiting at the other end of the interruption. Refused here, the
      channel is still loaded when it is wanted.
    */
    const pressing =
      (turnStarting && wantsPress('turn')) ||
      (replyStarting && !cue.speaking && wantsPress('reply')) ||
      (waitPressing && wantsPress('waiting'));
    const press = this.pressChannel.advance(dt, pressing) * PRESS_DEPTH;

    /*
      The nod, on the one conjunction that means somebody is talking *to* this
      face. Both halves carry weight. `heard` is the cause the idle sway never
      had, and `!speaking` is what stops the face nodding along with itself — a
      microphone hears the tutor through the speakers, and echo cancellation only
      removes most of it. That is the gate `reply` already stands behind, which
      is why this needs no defence of its own.

      Note what is *not* here: no lockout of its own beyond the channel's, and no
      thinning by dice. The tilt and the brow flash are both rationed because
      they fire on moments that recur inside a turn, and this one fires on a
      state that lasts as long as somebody is talking. Its frequency is NOD_GAP
      and nothing else decides it.
    */
    const listening = cue.heard && !cue.speaking;
    this.listeningFor = listening ? this.listeningFor + dt : 0;
    const nod = this.nodChannel.advance(dt, cue.nod && this.listeningFor >= NOD_ONSET);

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

    return { head, brow, tilt: leaning * this.tiltSide, press, nod };
  }
}
