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
