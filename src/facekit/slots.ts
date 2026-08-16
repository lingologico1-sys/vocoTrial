import type { Viseme } from '../live/visemes';

/**
 * What a face kit is made of, and what to ask a generator for.
 *
 * One slot per image the kit needs. The viseme slots are keyed on the same
 * `Viseme` union the mouth driver classifies into (live/visemes.ts), so a shape
 * cannot exist in one file and be missing from the other — add a viseme there
 * and this file stops compiling until it is authored here.
 */

export type SlotId = Viseme | 'eyeLeftClosed' | 'eyeRightClosed';

/**
 * Which of the kit's boxes a slot is cropped to.
 *
 * The eyes are two regions rather than one, and that is not tidiness. A single
 * box wide enough to hold both eyes also holds the bridge and rims of a pair of
 * glasses, and a generator asked to close the eyes inside it will cheerfully
 * restyle the frames on the way past — observed, on this very portrait, coming
 * back with black frames in place of pale olive ones, despite the prompt saying
 * not to and input_fidelity being set.
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
 * Every rectangle a kit holds, which is three more than it has regions.
 *
 * The brow and head boxes are boxes but not regions, and the distinction is the
 * whole design. Nothing is ever generated into them: each is a window onto the
 * base that gets redrawn somewhere else when the voice gets louder, so no model
 * is asked for a raised brow and no model gets the chance to restyle a spectacle
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
 * The head box is the same mechanism at the other end of the scale, and it
 * exists to answer a complaint about the lift: with no head box the whole
 * picture translates and rolls, which reads as the camera moving rather than the
 * person. That is fine for a head floating on nothing and wrong the moment the
 * base has a background, a crop edge and a pair of shoulders in it — those are
 * fixed context, and moving them moves the world. Saying where the head ends
 * lets the lift move the head and leave the world alone.
 */
export type BoxId = Region | 'browLeft' | 'browRight' | 'head';

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
 */
export function isFreeBox(id: BoxId): boolean {
  return isBrow(id) || id === 'head';
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
 * The mouth and the head have no partner, and null says so rather than an
 * exception, because the caller is a drag handler that has whichever box the
 * pointer landed on.
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
   * eye slots vary with it and a field that is right for six slots and stale
   * for two is a bug waiting for whoever reads it next. Mouth slots take the
   * argument and ignore it, which costs a pair of brackets and means every
   * call site has to have the setting in hand.
   */
  prompt: (lashes: LashStyle) => string;
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
 */
function lashClause(lashes: LashStyle): string {
  if (lashes === 'none') {
    return 'Draw no eyelashes at all on the closed eye: the arc alone, with nothing curving out from it.';
  }
  if (lashes === 'minimal') {
    return [
      'Keep the lashes on the closed eye minimal: a thin lash line only, with no long,',
      'curled, fanned or separately drawn lashes.',
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
 * A masked provider paints only inside the one box it was given, so the other
 * eye is untouched and the instruction costs nothing. An unmasked one redraws
 * the whole face, and asking for both means whichever box is then cropped out
 * contains a closed eye. One prompt that is correct under either regime beats
 * two that each assume one.
 */
const eyesClosedPrompt = (lashes: LashStyle): string =>
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
    'Keep the eyebrows unchanged, and keep any glasses exactly as they are: the same',
    'frame colour, thickness and shape. Do not restyle the eyewear.',
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
 */
const CORNERS_FIXED = [
  'Keep the lips the same colour, thickness and line weight as the original, and',
  'keep the outer corners of the mouth in the same place — the mouth opens by',
  'parting the lips, never by growing wider.',
].join(' ');

/**
 * The compression exemption, for the one pose that is defined by it.
 *
 * Everything CORNERS_FIXED protects is protected here too — colour, line
 * weight, the mouth staying put — except the thickness, which is the single
 * property the pose is about. A prompt that asks for lips squeezed thinner
 * while forbidding any change of thickness is arguing with itself.
 */
const MBP_COMPRESSES = [
  'Keep the lips the same colour and line weight as the original, and keep the',
  'mouth centred exactly where it is: the corners may travel outward very',
  'slightly with the compression, but the mouth does not slide, tilt or grow.',
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

const MOUTH_NOTE = [CORNERS_FIXED, MOUTH_STYLE, FACE_FIXED].join(' ');
const MBP_NOTE = [MBP_COMPRESSES, MOUTH_STYLE, FACE_FIXED].join(' ');
const OPEN_NOTE = [CORNERS_FIXED, MOUTH_STYLE, JAW_DROPS].join(' ');

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
  {
    id: 'ee',
    label: 'Spread (EE)',
    region: 'mouth',
    prompt: mouth(
      'Open the lips into a wide, shallow slot showing a clean row of upper teeth as one simple white shape. The jaw stays almost closed, so the opening is wide but not tall.',
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
      'Drop the jaw to open the mouth into a rounded oval about as tall as the closed mouth is wide, and no wider than the closed mouth. Show one simple row of upper teeth along the top and a plain dark interior below.',
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

export function slot(id: SlotId): Slot {
  const found = SLOTS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No slot "${id}"`);
  return found;
}
