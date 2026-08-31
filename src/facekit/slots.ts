import type { Viseme } from '../live/visemes';

/**
 * What a face kit is made of, and what to ask a generator for.
 *
 * One slot per image the kit needs. The viseme slots are keyed on the same
 * `Viseme` union the mouth driver classifies into (live/visemes.ts), so a shape
 * cannot exist in one file and be missing from the other — add a viseme there
 * and this file stops compiling until it is authored here.
 *
 * The three that are not visemes are the two closed lids and the smile, and
 * they are alike in the way that matters: no driver ever selects them. The lids
 * answer a blink and the smile answers the page, both from outside the audio
 * altogether, which is why neither belongs in a union the analyser classifies
 * into.
 */

export type SlotId = Viseme | 'smile' | 'eyeLeftClosed' | 'eyeRightClosed';

/**
 * Which of the kit's boxes a slot is cropped to.
 *
 * The eyes are two regions rather than one, and that is not tidiness. A single
 * box wide enough to hold both eyes also holds the bridge and rims of a pair of
 * glasses, and a generator asked to close the eyes inside it will cheerfully
 * restyle the frames on the way past — observed, on this very portrait, coming
 * back with black frames in place of pale olive ones, despite the prompt saying
 * not to — and, when that was observed, despite `input_fidelity` being set as
 * well, which was the strongest keep-what-is-already-there lever either provider
 * offered. It was not enough, which is why the fix below is a crop and not a
 * better sentence.
 *
 * Two boxes sitting inside the lenses fix that by construction rather than by
 * asking nicely: if the frame is outside the crop, a frame the model ruined is
 * discarded along with everything else outside the box.
 *
 * Left and right are the *viewer's*, matching the pixels rather than the
 * subject's anatomy, because what these name is a rectangle on an image.
 */
export type Region = 'mouth' | 'eyeLeft' | 'eyeRight';

/**
 * Every rectangle a kit holds, which is two more than it has regions.
 *
 * The brow boxes are boxes but not regions, and the distinction is the whole
 * design. Nothing is ever generated into them: each is a window onto the base
 * that gets redrawn somewhere else when the voice gets louder, so no model is
 * asked for a raised brow and no model gets the chance to restyle a spectacle
 * frame on the way past.
 *
 * There are two brow boxes for the same reason there are two eye boxes, and it
 * is the same reason again: glasses. A rim runs *diagonally* under the brows, so
 * the lowest row a brow box can safely end on differs between one side of the
 * face and the other — on the portrait in public/faces it differs by six pixels,
 * which is more than the clearance itself. One rectangle spanning both brows
 * has to take the worse of the two ends and smears frame colour under the brow
 * on the better one.
 *
 * There was a third kind, a `head` box, which said which pixels the lift should
 * move so that the background and shoulders could hold still. It is gone, and
 * the reason is written out at length against HeadMotion in live/headMotion.ts:
 * the same-scale trick that works for a brow does not survive being asked to cut
 * across a neck, because a brow can borrow clear skin to fill the gap it leaves
 * and a neck has a collar under it. The head now moves the whole picture. Kits
 * stored with a head box keep it in their JSON, harmlessly — nothing reads it.
 */
export type BoxId = Region | 'browLeft' | 'browRight';

/** The brow boxes, in the order the picker offers them. */
export const BROW_BOXES = ['browLeft', 'browRight'] as const;

export type BrowId = (typeof BROW_BOXES)[number];

export function isBrow(id: BoxId): id is BrowId {
  return id === 'browLeft' || id === 'browRight';
}

/**
 * The boxes no generator ever sees.
 *
 * Worth a predicate of its own rather than two comparisons at each call site,
 * because it is the property that decides the whole of a box's behaviour: a free
 * box never locks, can be dragged after any amount of generation, and is
 * meaningful by its absence. Everything else on the page is a crop, and a crop
 * that moves under artwork already cut to it is silent corruption.
 *
 * Since the head box went, the free boxes are exactly the brows and this answers
 * the same question `isBrow` does. Kept apart anyway: `isBrow` narrows a type and
 * this one states a behaviour, and it is the behaviour the page branches on. A
 * third free box would arrive here and nowhere else.
 */
export function isFreeBox(id: BoxId): boolean {
  return isBrow(id);
}

/**
 * The box across the face from this one, or null for a box that stands alone.
 *
 * Eyes pair with eyes and brows with brows, and the pairing is worth naming
 * because of what a face is: near enough symmetric that a rectangle sized to
 * one eye is very nearly the rectangle the other one wants. Nothing here mirrors
 * a *position* — the two sides of a portrait sit where they sit, and a face at
 * three-quarters would be ruined by a box that assumed otherwise. It is only the
 * size that carries, which is the part that is genuinely the same on both sides.
 *
 * The mouth has no partner, and null says so rather than an exception, because
 * the caller is a drag handler that has whichever box the pointer landed on.
 */
export function partnerBox(id: BoxId): BoxId | null {
  if (id === 'eyeLeft') return 'eyeRight';
  if (id === 'eyeRight') return 'eyeLeft';
  if (id === 'browLeft') return 'browRight';
  if (id === 'browRight') return 'browLeft';
  return null;
}

export interface Slot {
  id: SlotId;
  label: string;
  region: Region;
  /**
   * The pose, described physically.
   *
   * Never by phoneme name. "Generate the EE viseme" gets a shrug from every
   * generator worth using; "lips spread wide, upper teeth showing" gets the
   * pose. The classifier's names are an implementation detail of the audio
   * analysis and mean nothing to an image model.
   *
   * A function of the kit's lash style rather than a plain string, because the
   * eye slots vary with it and a field that is right for the mouth slots and
   * stale for two is a bug waiting for whoever reads it next. Mouth slots take the
   * argument and ignore it, which costs a pair of brackets and means every
   * call site has to have the setting in hand.
   */
  prompt: (lashes: LashStyle, detachedEyewear?: boolean) => string;
}

/**
 * Prepended to every slot prompt.
 *
 * Doing most of the work: what these models are bad at is not drawing a mouth,
 * it is drawing a mouth while leaving the rest of the face alone. Saying so
 * plainly measurably reduces how far the result drifts — though it never
 * reduces it to zero, which is why the result is cropped and composited locally
 * rather than used whole.
 */
export const PREAMBLE = [
  'Edit this portrait illustration.',
  'Keep the identical character, art style, line weight, colour palette, lighting,',
  'hair, glasses, skin tone and head position — change nothing except what is',
  'described next. The head must not move, rotate, or change size.',
].join(' ');

/** Shared instruction for every pose generated behind a detached glasses layer. */
export const GLASSES_FREE_PREAMBLE = [
  'Edit this portrait illustration.',
  'Keep the identical character, art style, line weight, colour palette, lighting,',
  'hair, skin tone and head position — change nothing except what is described next.',
  'This working portrait deliberately wears no glasses. Do not add glasses,',
  'sunglasses, lenses, rims or any other eyewear. The head must not move, rotate,',
  'or change size.',
].join(' ');

/** The one regional edit that makes room for a detachable glasses layer. */
export const REMOVE_GLASSES_PROMPT = [
  'Remove the glasses completely, including the rims, bridge, arms, lens tint,',
  'reflections and shadows cast by the glasses. Reconstruct the same person’s eyes,',
  'eyelids, eyebrows, nose and skin naturally where the glasses hid them. Keep those',
  'features in their original positions and preserve everything else exactly.',
].join(' ');

/** Preamble for removal itself; the ordinary one explicitly preserves glasses. */
export const REMOVE_GLASSES_PREAMBLE = [
  'Edit this portrait illustration.',
  'Keep the identical character, art style, line weight, colour palette, lighting,',
  'hair, skin tone and head position. The head must not move, rotate, or change size.',
  'The only permitted change is the removal and reconstruction described next.',
].join(' ');

/**
 * How much eyelash a closed eye keeps.
 *
 * Named for the mark on the page rather than for the person in the portrait,
 * and that is the same choice the slots make when they are called "Rounded
 * (OH)" instead of a phoneme. A male/female switch was the obvious shape for
 * this and it is the wrong one: what actually decides the answer is whether
 * *this drawing* has defined lashes to preserve, which is a fact about the
 * artwork. Plenty of illustrated men are drawn with a strong lash line and
 * plenty of women, in a flat style, with none at all, so a switch naming the
 * subject would be wrong in both directions on the faces it was meant to fix —
 * and would have nothing to say about a portrait that is neither.
 */
export type LashStyle = 'asDrawn' | 'minimal' | 'none';

export const DEFAULT_LASH_STYLE: LashStyle = 'asDrawn';

export const LASH_STYLES: { id: LashStyle; label: string; hint: string }[] = [
  {
    id: 'asDrawn',
    label: 'As drawn',
    hint: 'Keep whatever lashes the open eye has, and add nothing.',
  },
  { id: 'minimal', label: 'Minimal', hint: 'A thin lash line, no curl or fan.' },
  { id: 'none', label: 'None', hint: 'A bare arc, with no lashes at all.' },
];

/**
 * The lash clause, which is the only part of a closed eye that varies.
 *
 * The default is "as drawn" rather than the wording this prompt carried for its
 * first several months, which asked for "the long eyelashes still curving out
 * from it" on every face it was ever given. That is an instruction to *add*
 * lashes, not to keep them, and a generator handed a portrait with none obliged
 * — the blink grew a pair of lashes the open eye did not have, so the eye
 * changed species every time it closed. Preserving what is there is the only
 * neutral answer; removing and reducing are choices, and choices get a control.
 *
 * Only "as drawn" is allowed to depend on what the input eye shows, because
 * depending on it is the whole of what that option means. The other two name a
 * mark absolutely, and "minimal" had to be rewritten to do so: "keep the lashes
 * minimal" reduces whatever it happens to find, so an eye with the larger fan —
 * or the one whose fan is cut through by the edge of its box, which is a fact
 * about where a rectangle was dragged rather than about the face — keeps more of
 * it, and the two eyes of one portrait came back differently from an identical
 * prompt. Naming the stroke to draw is the same fix the arc and the teeth band
 * each needed, for the same reason.
 */
function lashClause(lashes: LashStyle): string {
  if (lashes === 'none') {
    return 'Draw no eyelashes at all on the closed eye: the arc alone, with nothing curving out from it.';
  }
  if (lashes === 'minimal') {
    return [
      'Draw the closed eye with one thin lash line and nothing more: a single plain',
      'tapered stroke following the arc, with nothing curving out from it along its',
      'length or at the outer corner — no long, curled, fanned, clustered or separately',
      'drawn lashes, whatever the open eye shows.',
    ].join(' ');
  }
  return [
    'Keep exactly the eyelashes the open eye already has, in the same shape and',
    'number — do not add, lengthen, thicken or curl them.',
  ].join(' ');
}

/**
 * Shared by both eye slots, and asking for *both* eyes on purpose.
 *
 * The model redraws the whole face — nothing on this path takes a mask any
 * more — so asking for both means whichever box is then cropped out contains a
 * closed eye. It cost nothing under the masked providers that used to be
 * offered here either: they painted only inside the box they were given, so the
 * other eye went untouched and the second clause was simply unread. One prompt
 * correct under either regime beat two that each assumed one, and what is left
 * is the half that still applies.
 */
const eyesClosedPrompt = (lashes: LashStyle, detachedEyewear = false): string =>
  [
    'Close both eyes.',
    // Naming the mark to draw, rather than the state to depict. Asking for
    // "gentle downward curves" produced creased, wrinkled lids that read as a
    // wince: told only what the eye is doing, the model reached for the shading
    // that would sell a photograph, on a drawing that has no shading anywhere.
    'Draw each closed eye as one smooth clean downward arc, in the same dark line',
    'weight as the eye it replaces.',
    lashClause(lashes),
    'The skin above and around each closed eye stays flat, smooth and exactly the',
    'colour of the surrounding face — no eyelid crease, no fold, no wrinkle, no',
    'extra shading or texture of any kind.',
    'Keep the eyebrows unchanged.',
    detachedEyewear
      ? 'This working portrait deliberately has no glasses. Do not add glasses or any eyewear.'
      : 'Keep any glasses exactly as they are: the same frame colour, thickness and shape. Do not restyle the eyewear.',
  ].join(' ');

/*
 * The clauses every mouth pose is assembled from.
 *
 * Split into named parts rather than written out per slot because they are not
 * all compatible with each other: a pose that presses the lips thinner and a
 * pose that drops the jaw each need one of the guarantees relaxed, and the only
 * honest way to relax one is to say which. A single block appended to
 * everything ends up either forbidding what the pose is for, or permitting it
 * everywhere.
 */

/**
 * True of every mouth pose, however much else it is asked to change.
 *
 * The lids' lesson repeated: told only what the mouth is doing, these models
 * reach for photographic shading and put gradients on a cel-shaded drawing.
 */
const MOUTH_STYLE = [
  'Use flat cel-shaded colour: no gradients, no soft shading, no highlights, no',
  'added creases or wrinkles.',
].join(' ');

/**
 * What the mouth may not do, on every pose but the pressed one.
 *
 * The failure it exists to stop is the mouth changing *size* between poses. An
 * early AA came back so much wider than the rest pose that cycling the two read
 * as the whole mouth inflating rather than as a jaw opening — a real mouth
 * drops its jaw without moving the corners much, and saying so is cheaper than
 * regenerating until one happens to comply.
 *
 * EE was exempted from it for two rounds and is back under it, which is worth
 * recording because the argument for exempting it was a good one. A real /i/
 * does open by pulling the corners apart, and VISEMES.ee is the widest shape in
 * the drawn table, so letting the art spread looked like making the art honest.
 * What came back was a grin — twice, once from asking for width in two places
 * at once and once after that was reduced to bare permission. A generator given
 * any licence over the corners spends all of it.
 *
 * The licence was not needed in any case. It was introduced to separate ee from
 * fv, and what separates them turned out to be the dark strip under the teeth
 * and the thickness of the lower lip, neither of which has anything to do with
 * width. Three words of this clause were also doing quiet work that the
 * replacement dropped: *thickness*. Freed of it, ee redrew its lips thinner
 * than every other pose in the kit, which is exactly the "lips don't shape
 * well" that sent the pose back for a third time.
 */
const CORNERS_FIXED = [
  'Keep the lips the same colour, thickness and line weight as the original, and',
  'keep the outer corners of the mouth in the same place — the mouth opens by',
  'parting the lips, never by growing wider.',
].join(' ');

/**
 * The one pose that is allowed to move its corners inward, and only inward.
 *
 * CORNERS_FIXED cannot be reused here, and that is not a preference. Narrowing is `st`'s
 * entire differentiating cue: what separates it from `ee` is that the mouth is drawn in
 * where `ee` is the widest shape in the kit, and a clause pinning the corners in place
 * forbids the one thing the pose exists to do. So this is CORNERS_FIXED with the
 * direction reversed, in the same way MBP_COMPRESSES and SMILE_SPREADS are — each pose
 * that needs a movement gets a note licensing that movement and no other.
 *
 * THE CAP IS THE WHOLE OF IT, because the warning on CORNERS_FIXED applies with the sign
 * flipped: a generator given any licence over the corners spends all of it. Spent
 * outward that produced a grin, twice. Spent inward it would produce a purse, and a
 * pursed narrow mouth is `oh` — which is the pose sitting closest in width, at w: 12
 * against this one's 17. Hence a tenth, stated as a proportion of something already in
 * the picture rather than as an adjective, and hence the explicit refusal of rounding:
 * the corners come in, the lips do not push forward.
 */
const ST_NARROWS = [
  'Keep the lips the same colour, thickness and line weight as the original, and',
  'keep the mouth centred exactly where it is. The outer corners draw inward a',
  'little — each corner travels inward by at most a tenth of the width of the',
  'closed mouth, and no further — so the mouth ends up slightly narrower than the',
  'closed mouth it was drawn from, never wider. It does not slide, tilt or grow,',
  'and the lips are not pursed, pouted, rounded or pushed forward.',
].join(' ');

/**
 * The ceiling, stated once, applied to every mouth pose.
 *
 * CORNERS_FIXED already forbids widening, so this looks redundant and is not. That
 * clause is a *prohibition on movement* — corners stay where they are — which a
 * generator satisfies by not consciously moving them, and which says nothing at all
 * about the shape that comes back. This is a *measurement on the result*, checkable
 * against something already in the picture. The note under ee explains why that
 * distinction earns its words: a proportion the generator can measure off its own
 * output beats an adjective it has to interpret.
 *
 * The evidence that adjectives do not hold is the whole history of this file. `aa`
 * inflated until it was given a number — no wider than the closed mouth — and stopped.
 * `ee` was handed licence over the corners and came back a grin, twice. `laugh` asked
 * for a "broad" mouth with corners "outward" and got one stretched across the face.
 * Three poses, three roads to the same failure, and only the pose carrying an actual
 * measurement ever held. So the measurement goes on all of them rather than being
 * rediscovered one pose at a time.
 *
 * ONE REFERENCE, USED EVERYWHERE: the closed mouth. It is the right one because it is
 * the base every patch is generated from, so it is on screen while the model works, and
 * because it is what the kit cross-fades through — a pose wider than the closed mouth
 * is a pose that inflates on the way in, which is the artefact all of this exists to
 * stop.
 */
const WIDTH_CAP = [
  'Measured from one outer corner to the other, the mouth is no wider than the closed',
  'mouth it was drawn from — the same width or narrower, never wider, whatever else it',
  'is doing.',
].join(' ');

/**
 * The same ceiling for the two poses that genuinely do spread.
 *
 * A pressed lip and a smile both widen a little in life, and mbp and smile say so on
 * purpose — mbp's seam grows "longer and flatter", and a smile whose corners cannot move
 * outward at all is most of the way to being no smile. Handing those two a flat
 * prohibition would put the note in contradiction with the prompt above it, and a
 * contradictory prompt is worse than an uncapped one: the generator picks a side and
 * there is no telling which.
 *
 * So they get a bound rather than a ban, and the bound is a fraction rather than an
 * adverb, for WIDTH_CAP's reason. "Very slightly" and "a little" are what these two
 * poses said before, and they are exactly the kind of licence the CORNERS_FIXED note
 * describes a generator spending all of.
 */
const WIDTH_CAP_SLIGHT = [
  'The mouth may end up very slightly wider than the closed mouth it was drawn from, and',
  'no more: each corner travels outward by at most a tenth of the width of the closed',
  'mouth, and it does not spread beyond that.',
].join(' ');

/**
 * The compression exemption, for the poses defined by it.
 *
 * Everything CORNERS_FIXED protects is protected here too — colour, line
 * weight, the mouth staying put — except the thickness, which is the single
 * property the pose is about. A prompt that asks for lips squeezed thinner
 * while forbidding any change of thickness is arguing with itself.
 *
 * Shared with `fv`, which thins the lower lip alone rather than both, and gets
 * the difference said in its own prompt instead of in a third constant: the
 * exemption either applies or it does not, and here it does.
 */
const MBP_COMPRESSES = [
  'Keep the lips the same colour and line weight as the original, and keep the',
  'mouth centred exactly where it is: the corners may travel outward very',
  'slightly with the compression, but the mouth does not slide, tilt or grow.',
].join(' ');


/**
 * How teeth are drawn, on the poses that show any.
 *
 * "A clean row of upper teeth as one simple white shape" was meant to say this
 * and does not: a row of teeth *is* a row, so a generator drawing each tooth
 * with its own outline and a scalloped edge between them has honoured every word
 * of it. Nothing there constrains the lower edge, so the edge came back straight
 * on some runs and jagged on others — and since the shapes are cut from separate
 * generations, the two land in the same kit and the mouth grows and loses its
 * teeth as it talks.
 *
 * So the band is described as the mark it is rather than as the anatomy it
 * depicts, which is the same lesson the closed eye taught in eyesClosedPrompt.
 * A single flat white shape is also simply what this art style would draw: the
 * portrait has no line work fine enough to separate one tooth from the next, and
 * at the size a mouth patch occupies there is no room for it.
 */
const TEETH_BAND = [
  'Draw the teeth as one single unbroken white band with a flat, straight lower',
  'edge: no individual teeth, no dividing lines, outlines or gaps between them,',
  'and no scalloped, wavy, pointed or jagged edge anywhere along it.',
  'The band is the same plain white across its whole width.',
].join(' ');

/**
 * The same rule for the one pose that shows two rows instead of one.
 *
 * Everything after the opening clause is TEETH_BAND verbatim, and deliberately so: what
 * that note argues — that the band is a mark rather than anatomy, and that this art style
 * has no line work fine enough to separate one tooth from the next — is not about how
 * many rows there are. Only the count changes.
 *
 * It is a separate constant rather than a parameter because TEETH_BAND's first six words
 * are load-bearing in the other direction: "one single unbroken white band" is what stops
 * `ee` and `aa` drawing a second row they should not have. Softening it to "one or two"
 * everywhere would trade this pose's problem for theirs.
 */
const TEETH_ROWS = [
  'Draw each row of teeth as one single unbroken white band with a flat, straight',
  'edge: no individual teeth, no dividing lines, outlines or gaps between them,',
  'and no scalloped, wavy, pointed or jagged edge anywhere along either.',
  'Both bands are the same plain white across their whole width.',
].join(' ');

/** What holds still when the jaw holds still, which is most of the time. */
const FACE_FIXED = 'Do not change the nose, chin, cheeks or jawline.';

/**
 * What holds still when the jaw does not, which is the wide-open pose only.
 *
 * A dropped jaw moves the chin — that is what a dropped jaw *is* — so a pose
 * asked to drop one while holding the chin still can only comply by cutting a
 * hole in a face that is otherwise at rest, and a hole is what it looks like in
 * motion. Everything above the mouth stays put, because none of it moves when
 * a real jaw opens either.
 *
 * The crop is what makes this safe to permit, and also what bounds it: a chin
 * that travels below the mouth box is cut off there, leaving the patch's
 * lowered chin sitting above the base's original one. kit.ts already asks for a
 * box tall enough to clear the dropped jaw for this reason — it now has to
 * clear the dropped *chin* as well, which is a few pixels lower again.
 */
const JAW_DROPS = [
  'The chin and the skin between the lower lip and the chin travel downward with',
  'the jaw, as far as the jaw opens and no further, so the lower face lengthens',
  'the way a real jaw drop lengthens it.',
  'Do not change the nose or the cheeks, and do not move the sides of the face or',
  'the outer edges of the jaw.',
].join(' ');

/**
 * The corner exemption, for the one pose that is made of corners.
 *
 * The exact inverse of CORNERS_FIXED, and it has to be: everything that clause
 * protects the speech poses from is what a smile *is*. A mouth that opens by
 * parting the lips cannot smile, so the licence is granted here and nowhere
 * else, and it is granted narrowly — the corners lift, the seam curves, and the
 * mouth still does not slide, tilt or change colour.
 *
 * The cheeks are the deliberate omission. FACE_FIXED holds them still for every
 * speech pose because a jaw drop has no business moving them; a smile lifts the
 * skin just outside the corners and a drawing that refuses to reads as a mouth
 * pasted onto a straight face. The crop is what makes that safe to allow — the
 * mouth box reaches a little past the corners and no further, so whatever the
 * model does to the cheekbones is discarded on the way out.
 */
const SMILE_SPREADS = [
  'The corners of the mouth lift and travel outward a little, and the line where',
  'the lips meet curves upward along its whole length rather than only at the',
  'ends. Keep the lips the same colour, thickness and line weight as the',
  'original, and keep the mouth centred exactly where it is: it does not slide,',
  'tilt or move up or down the face. Do not change the nose or the jawline, and',
  'add no dimples or creases.',
].join(' ');

/**
 * The one pose that drops the jaw AND curves the lip line.
 *
 * Every other note forbids one or the other, and for good reasons that only half stop
 * applying here. SMILE_SPREADS grants the corners but assumes lips that stay shut, and a
 * closed-mouth laugh is a stifled one. CORNERS_FIXED, though, still applies in full: it
 * exists because a mouth that grows wider between poses reads as inflating, and that is
 * as true of a laugh as of a speech pose.
 *
 * SO THE LICENCE IS VERTICAL ONLY. Repeating "laugh", "wide" and "broad" — even in
 * prohibitions — continued to pull generations toward the model's stock wide-grin
 * image. This version names the drawing as a compact open smile and constrains the
 * visible opening directly: seventy percent of the closed lip line, approximately as
 * tall as it is wide. That is a feature the model can inspect in the supplied neutral
 * portrait, unlike a comparison to the separately generated `aa` pose it cannot see.
 *
 * Unlike the abandoned constrained-insert experiment, this remains an ordinary full
 * generation followed by the established crop. Holding the surrounding contours in
 * the prompt therefore does not introduce another scaled jaw inside the mouth box.
 */
const LAUGH_OPENS = [
  'Edit only the lips, teeth and immediate expression lines to create a compact open smile.',
  'Keep the two outer lip corners at exactly the same horizontal positions as in the',
  'source; lift them vertically without moving either corner outward.',
  'Centre the dark mouth opening beneath the nose. The dark opening and each tooth band',
  'span approximately seventy percent of the original closed-mouth width.',
  'Open primarily downward, making the visible opening approximately as tall as it is wide.',
  'Keep the lips the same colour, thickness and line weight as the source.',
  'Keep the cheeks, jaw outline, chin, nose, face width and surrounding skin contours',
  'unchanged.',
].join(' ');

/** Flat source style, with the two small expression marks this pose needs retained. */
const LAUGH_STYLE = [
  'Use flat cel-shaded colour: no gradients, soft shading or highlights.',
  'Draw one short, simple curved smile line immediately beside each lifted mouth corner.',
  'Keep those two marks small and add no other creases or wrinkles.',
].join(' ');

/**
 * TEETH_BAND's rules, applied to two rows instead of one.
 *
 * Separate from TEETH_BAND rather than replacing it because every other toothy pose
 * shows the upper row alone, and rightly — `aa` and `ee` and `fv` are speech, and speech
 * does not bare the lower teeth. This pose does, and here it is also load-bearing. A
 * compact opening can otherwise collapse toward `aa`; the second band is the difference
 * that does not cost size. It reads at a glance, separates the two in the contact sheet,
 * and is what the expression actually shows.
 *
 * The flat-edge clause is stated for each band in the direction that band needs it —
 * the upper row's straight edge is its bottom, the lower row's is its top — because
 * "flat lower edge" applied to a bottom row asks for the wrong thing.
 */
const LAUGH_TEETH = [
  'Draw the upper teeth as one single unbroken white band along the top of the opening',
  'with a flat, straight lower edge, and the lower teeth as a second, shallower unbroken',
  'white band along the bottom of the opening with a flat, straight upper edge, with a',
  'plain dark interior between the two bands.',
  'In both bands: no individual teeth, no dividing lines, outlines or gaps between them,',
  'and no scalloped, wavy, pointed or jagged edge anywhere along either.',
  'Each band is the same plain white across its whole width.',
].join(' ');

/*
 * Every note carries a width cap, and it is the strict one unless the pose has a
 * stated reason to spread. mbp and smile are the two that do; fv takes the strict cap
 * despite sharing MBP_COMPRESSES with mbp, because its own prompt already insists the
 * mouth "stays as wide as it was" — the cap makes the note agree with the prompt
 * instead of quietly licensing what the prompt forbids.
 */
const MOUTH_NOTE = [CORNERS_FIXED, WIDTH_CAP, MOUTH_STYLE, FACE_FIXED].join(' ');
const SMILE_NOTE = [SMILE_SPREADS, WIDTH_CAP_SLIGHT, MOUTH_STYLE].join(' ');
const MBP_NOTE = [MBP_COMPRESSES, WIDTH_CAP_SLIGHT, MOUTH_STYLE, FACE_FIXED].join(' ');
const TEETH_NOTE = [CORNERS_FIXED, WIDTH_CAP, MOUTH_STYLE, TEETH_BAND, FACE_FIXED].join(' ');
/** The one pose that both shows teeth and thins a lip. */
const FV_NOTE = [MBP_COMPRESSES, WIDTH_CAP, MOUTH_STYLE, TEETH_BAND, FACE_FIXED].join(' ');
/** The one pose that narrows, and the only one showing both rows of teeth. */
const ST_NOTE = [ST_NARROWS, WIDTH_CAP, MOUTH_STYLE, TEETH_ROWS, FACE_FIXED].join(' ');
const OPEN_NOTE = [CORNERS_FIXED, WIDTH_CAP, MOUTH_STYLE, TEETH_BAND, JAW_DROPS].join(' ');
const LAUGH_NOTE = [LAUGH_OPENS, LAUGH_STYLE, LAUGH_TEETH].join(' ');

const mouth =
  (shape: string, note: string = MOUTH_NOTE) =>
  (): string =>
    `${shape} ${note}`;

export const SLOTS: Slot[] = [
  /*
   * The two closed poses are written against each other, and that is not
   * stylistic. Both are generated from a base that has usually just been
   * neutralised into a closed, relaxed mouth — so an instruction that merely
   * describes a closed mouth is already satisfied by the input, and an
   * instruct-edit model handed a request it considers met returns the input.
   * That is how rest and mbp came back indistinguishable: neither prompt asked
   * for a change, so neither got one.
   *
   * The fix is to name the *difference* rather than the state, and to push the
   * two descriptions apart at both ends — full and softly curved here, thin and
   * flat there — so that each prompt describes something its input demonstrably
   * is not. Stated as a contrast with "a relaxed closed mouth" rather than with
   * "the mouth in this picture", because the picture is only reliably relaxed
   * after a neutralising pass and the wording has to hold either way.
   */
  {
    id: 'rest',
    label: 'Rest',
    region: 'mouth',
    prompt: mouth(
      'Close the mouth into a relaxed neutral expression: the lips together in a single soft line, no teeth and no gap. The lips keep their full natural thickness and the line between them curves gently, lifting a touch at the corners — a mouth simply at rest, not a mouth being held shut.',
    ),
  },
  {
    id: 'mbp',
    label: 'M / B / P',
    region: 'mouth',
    prompt: mouth(
      'Press the lips firmly together so that they roll slightly inward, as when beginning to say "m". Compared with a relaxed closed mouth, the coloured area of both lips must end up visibly thinner — the lower lip most of all — and the line where they meet must become straighter, flatter and a little longer, reaching very slightly wider, with a small tuck of tension at each corner. The result has to be plainly distinguishable from a relaxed closed mouth: thinner lips, a longer and flatter seam. No teeth and no opening at all, and no pursing, pouting or dimples.',
      MBP_NOTE,
    ),
  },
  /*
   * The pose no call will ever show, generated anyway.
   *
   * Nothing in the live path can select it — the audio analyser classifies into
   * a grid this does not sit on, and the note on Viseme in live/visemes.ts says
   * why it never could. It is here because the thing that will select it reads
   * text rather than sound, and the cost of adding it then is not one prompt
   * but every kit made before it, generated again, judged again.
   *
   * The expected collision was with mbp, both being lips gone thin without the
   * jaw moving. It was with ee instead, and at 2.8% — the two came back as the
   * same picture. Read together the reason is not subtle: the first draft asked
   * for teeth under a lifted upper lip and said nothing about what sits below
   * them, and ee asked for teeth in a parted mouth and said nothing either. Two
   * prompts describing a white band between two lips get one white band between
   * two lips.
   *
   * So they are now written against each other, the way rest and mbp are, and
   * on two cues rather than one, because a single cue is a single thing for a
   * generator to miss:
   *
   *   the gap    ee is parted and dark below the teeth; fv has nothing dark in
   *              it anywhere, the teeth sitting straight on the lip
   *   the lip    ee keeps its lower lip whole; fv thins it, which is the half
   *              of the mouth a labiodental consumes
   *
   * Neither one is a shading detail — they are the two largest shapes in the
   * patch — and either alone is enough to tell the poses apart in motion.
   *
   * The dark is a *strip*, and that qualification is load-bearing. Asked for
   * "a clear dark opening" with nothing said about its height, ee came back as
   * a tall rounded cavity — separated from fv, certainly, but by then halfway
   * to aa, and a mouth that opens that far on every "ee" reads as shouting. So
   * the height is pinned against a shape already in the picture, the way the
   * teeth are described as a band rather than as teeth: shorter than the white
   * above it, no taller than the upper lip is thick. A proportion the generator
   * can measure off its own output beats an adjective it has to interpret.
   */
  {
    id: 'fv',
    label: 'F / V',
    region: 'mouth',
    prompt: mouth(
      'Rest the upper front teeth directly on the lower lip, as when beginning to say "f". Compared with a relaxed closed mouth, the upper lip lifts only slightly, uncovering a narrow strip of upper teeth, and the lower lip draws back and tucks in under that strip so that its coloured area ends up clearly thinner than the upper lip\'s. The teeth sit against the lip along their whole width, and the mouth is not open: there is no dark gap, no dark opening and no dark shadow anywhere between the teeth and the lower lip, and no part of the inside of the mouth is visible. The mouth also stays as wide as it was, with the corners where they were and no smile or spread. The result has to be plainly distinguishable from a parted mouth with teeth showing: the only shapes here are lip, teeth and lip, with nothing dark between them.',
      FV_NOTE,
    ),
  },
  /*
   * The pose added because a number was wrong rather than because a shape was missing.
   *
   * `ee` was on screen for 41% of an English lesson and worn by half its marks — see the
   * note on Viseme in live/visemeTable.ts for the measurement. A quarter of those marks
   * are `s` and `t`, and this is where they went.
   *
   * WRITTEN AGAINST TWO NEIGHBOURS, NOT ONE, and that is the whole risk of the pose. It
   * lands in the crowded end of the range — rest, mbp, fv and ee are all near-closed, and
   * the entire measured spread from rest to ee is 15.2% of centre pixels — so the fv/ee
   * collision recorded above is not a cautionary tale here, it is the default outcome.
   * Both of those prompts described a white band between two lips, and both got one.
   *
   * So, on two cues each, against both:
   *
   *   vs ee    the width, and the shape count. ee is the widest thing in the kit and
   *            spreads; this draws in. ee is one white band over a dark strip over lip;
   *            this is two white bands with a hairline between them.
   *   vs fv    what sits below the upper teeth. On fv that is lip, thinned and tucked,
   *            with nothing dark anywhere. Here it is a second row of teeth, and the
   *            lower lip keeps its full thickness.
   *
   * Width is the cue worth having because nothing else in the kit uses it: mbp and fv
   * both hold their width or gain a trace, ee spreads, and only oh is narrower — and oh
   * is a rounded hole with no teeth in it at all. See ST_NARROWS for why the licence to
   * narrow is capped rather than open.
   *
   * NO TONGUE, and that is not a style note. A tongue tip showing between the teeth is
   * ð/θ, and this pose is worn on every /s/ — a visible tongue here would draw a face
   * that lisps its way through every sentence. It is also why `T` stays on ee rather than
   * following `t` down here.
   */
  {
    id: 'st',
    label: 'Narrow (S / T)',
    region: 'mouth',
    prompt: mouth(
      'Bring the teeth together and narrow the mouth a little, as when saying "s". Both rows of front teeth show as two white bands meeting edge to edge across the whole width of the opening, separated only by a hairline of dark no thicker than the line the lips are drawn with. The jaw barely moves and the corners draw inward slightly, so the mouth ends up clearly narrower than a spread one. Both lips keep their full natural thickness and their existing shape, and neither is drawn back, tucked or thinned. The result has to be plainly distinguishable from a spread mouth showing one band of teeth, because there are two white bands here and the mouth is narrower rather than wider; and from teeth resting on the lower lip, because the shape directly below the upper teeth is a second row of teeth and not lip. Show no tongue anywhere, and no dark cavity or opening beyond that single hairline.',
      ST_NOTE,
    ),
  },
  {
    id: 'ee',
    label: 'Spread (EE)',
    region: 'mouth',
    prompt: mouth(
      'Part the lips into a shallow slot, as when saying "ee". The jaw barely moves: the opening is at least four times as wide as it is tall, and its whole height is no more than the thickness of the upper lip. The upper teeth show as one simple white band along the top of the opening, and directly below that band lies a narrow dark strip running the full width of the opening — clearly shorter from top to bottom than the white band above it, a dark line rather than a cavity. Both lips keep their full natural thickness and their existing shape, and the lower lip is not drawn back, tucked or thinned. The result has to be plainly distinguishable from teeth resting on the lip, because that dark strip separates the teeth from the lower lip along the whole width; and from a wide open mouth, because the opening is a shallow slot with no rounding to it, showing no tongue and no lower teeth.',
      TEETH_NOTE,
    ),
  },
  {
    id: 'uh',
    label: 'Neutral open (UH)',
    region: 'mouth',
    prompt: mouth(
      'Part the lips into a small soft oval opening, about a third as tall as it is wide, with one plain dark shape inside. The jaw drops only slightly.',
    ),
  },
  {
    id: 'aa',
    label: 'Open (AA)',
    region: 'mouth',
    prompt: mouth(
      'Drop the jaw to open the mouth into a rounded oval about as tall as the closed mouth is wide, and no wider than the closed mouth. Show the upper teeth as one simple white shape along the top, and a plain dark interior below.',
      OPEN_NOTE,
    ),
  },
  {
    id: 'oh',
    label: 'Rounded (OH)',
    region: 'mouth',
    prompt: mouth(
      'Purse the lips into a small rounded O, slightly taller than it is wide, with a plain dark opening in the middle. The lips stay full and clearly outlined and the jaw stays mostly closed.',
    ),
  },
  /*
   * The pose the conversation never selects, and the only one a learner sees
   * while nothing is happening.
   *
   * It is worn at the two ends of a call — before the tutor has said anything
   * and after its goodbye has finished playing — and at no other moment. Both
   * are moments the mouth is otherwise at rest, which is what makes a pose the
   * right shape for this and a second base the wrong one: painted at the mouth
   * box over `rest`, it dissolves in and out exactly the way the lip press
   * does, and nothing outside that rectangle can drift. See `smiling` in
   * live/Face.tsx.
   *
   * CLOSED LIPS, ON PURPOSE, where the base pass is deliberately left to choose.
   * A smile is held here for as long as the page is idle, which is a length of
   * time no speech pose is ever asked to survive: teeth showing for a second
   * reads as warmth, teeth showing for a minute reads as a rictus. Closed lips
   * are also what dissolves cleanly to and from `rest`, which is a closed mouth
   * — a pose that has to grow teeth on the way in cannot cross-fade, it can only
   * cut.
   *
   * Written against a relaxed closed mouth for the reason the note above rest
   * and mbp gives at length: this is generated from a base that has usually just
   * been neutralised into one, and a prompt a generator considers already
   * satisfied comes back as its input. The difference is named twice — corners
   * higher, seam curved along its length — because "smile" alone is exactly the
   * kind of instruction a face already faintly upturned can claim to have met.
   */
  /*
   * The pose no phone can select, and the second one generated for a driver rather
   * than for a sound. `fv` was the first; the note above it explains why carrying a
   * slot early is cheaper than adding it later, and this is that argument used again.
   *
   * WRITTEN TO STAY BETWEEN ITS TWO NEIGHBOURS, because they are what it will collapse
   * into if the prompt is loose, and they are neighbours in different directions:
   *
   *   aa     the same jaw and the same width, corners level and the lower teeth hidden.
   *          An open mouth with level corners is alarm, not delight, and an `aa`
   *          returned for this slot makes a laughing face look like a screaming one.
   *   smile  the same corners, lips shut. A closed-mouth laugh is a stifled one, and
   *          slots.ts keeps smile closed on purpose — see the note on that slot.
   *
   * Both halves are asked for explicitly and neither is left to be inferred. The prompt
   * deliberately avoids the old superlatives and their negations; it describes a compact
   * open smile, measures the visible opening against the source the model can see, and
   * lets LAUGH_TEETH keep the result distinct from `aa` without purchasing that
   * distinction with extra width.
   */
  {
    id: 'laugh',
    label: 'Laugh',
    region: 'mouth',
    prompt: mouth(
      'Create a compact open smile that reads as delighted rather than surprised. Communicate the expression with lifted corners and two visible tooth bands while keeping the visible opening compact.',
      LAUGH_NOTE,
    ),
  },
  {
    id: 'smile',
    label: 'Smile',
    region: 'mouth',
    prompt: mouth(
      'Curve the closed lips into a gentle, warm smile. Compared with a relaxed closed mouth, both corners sit clearly higher and slightly further apart, and the line where the lips meet becomes one continuous upward curve instead of a level line. The lips stay together along their whole length: no gap, no teeth and no opening anywhere. The result has to be plainly distinguishable from a mouth at rest — a smile that reads from across a room — while staying an easy closed smile rather than a grin.',
      SMILE_NOTE,
    ),
  },
  {
    id: 'eyeLeftClosed',
    label: 'Left eye closed',
    region: 'eyeLeft',
    prompt: eyesClosedPrompt,
  },
  {
    id: 'eyeRightClosed',
    label: 'Right eye closed',
    region: 'eyeRight',
    prompt: eyesClosedPrompt,
  },
];

/**
 * The one generation that is not a patch.
 *
 * Kept separate because it replaces the base rather than being composited onto
 * it: a portrait supplied mid-smile with teeth showing is the wrong rest pose,
 * and every mouth patch drawn over it has to be opaque enough to bury the
 * original. Neutralising the base first makes that a much easier ask.
 */
export const NEUTRALISE_BASE_PROMPT =
  'Close the mouth into a relaxed, neutral, closed-lip expression with no teeth visible. Keep everything else about the portrait identical.';

/**
 * The other base pass: the face's portrait, which is a different job entirely.
 *
 * It began as an alternative rest pose and is not one any more. The rest pose a
 * call wears is the `smile` slot above — a patch at the mouth box, cut from the
 * neutral base like every other pose — and this pass is what is left once that
 * moved out: a whole-frame picture of the same person smiling, which nothing is
 * ever composited onto and which no call ever displays. It is the thumbnail. See
 * publishKit in library.ts, which is its only reader.
 *
 * WHICH IS WHY IT ASKS FOR MORE THAN THE POSE DOES. Every constraint on the
 * `smile` slot comes from the same two facts — that it has to dissolve against
 * `rest`, and that it is held for as long as a page sits idle. Neither applies
 * to a still picture in a picker, seen for a moment beside a dozen others and
 * competing with them. Teeth are welcome here, the cheeks and eyes may go with
 * it, and "gentle" would be the wrong word: a thumbnail that hedges is a
 * thumbnail nobody picks.
 *
 * The one thing held is identity, and the sentence saying so is doing real work
 * — a model given a free hand with a warm smile will happily return a warmer
 * *person*. "Change nothing else" turns out not to cover *adding*: asked for a
 * friendly face, a model will hand back one wearing glasses it invented, so the
 * accessories are refused by name as well.
 */
export const SMILE_BASE_PROMPT =
  'Give this person a broad, warm, genuine smile, as if greeting someone they are pleased to see: the mouth clearly smiling and the cheeks and eyes going with it. Change nothing else about the portrait — the same face, the same hair, the same clothes, the same drawing style, the same pose, the same background. Add nothing that is not already in the picture: if the person is not wearing glasses, do not draw glasses on them, and likewise add no sunglasses, hat, headband, earrings, jewellery, makeup or facial hair that is not there now. Anything of that kind already in the picture stays exactly as it is.';

export function slot(id: SlotId): Slot {
  const found = SLOTS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No slot "${id}"`);
  return found;
}
