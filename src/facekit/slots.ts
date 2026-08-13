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
 * Every rectangle a kit holds, which is two more than it has regions.
 *
 * The brow boxes are boxes but not regions, and the distinction is the whole
 * design. Nothing is ever generated into them: each is a window onto the base
 * that gets redrawn a few pixels higher when the voice gets louder, so no model
 * is asked for a raised brow and no model gets the chance to restyle a
 * spectacle frame on the way past.
 *
 * There are two of them for the same reason there are two eye boxes, and it is
 * the same reason again: glasses. A rim runs *diagonally* under the brows, so
 * the lowest row a brow box can safely end on differs between one side of the
 * face and the other — on the portrait in public/faces it differs by six pixels,
 * which is more than the clearance itself. One rectangle spanning both brows
 * has to take the worse of the two ends and smears frame colour under the brow
 * on the better one.
 */
export type BoxId = Region | 'browLeft' | 'browRight';

/** The brow boxes, in the order the picker offers them. */
export const BROW_BOXES = ['browLeft', 'browRight'] as const;

export type BrowId = (typeof BROW_BOXES)[number];

export function isBrow(id: BoxId): id is BrowId {
  return id === 'browLeft' || id === 'browRight';
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
   */
  prompt: string;
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
 * Shared by both eye slots, and asking for *both* eyes on purpose.
 *
 * A masked provider paints only inside the one box it was given, so the other
 * eye is untouched and the instruction costs nothing. An unmasked one redraws
 * the whole face, and asking for both means whichever box is then cropped out
 * contains a closed eye. One prompt that is correct under either regime beats
 * two that each assume one.
 */
const EYES_CLOSED_PROMPT = [
  'Close both eyes.',
  // Naming the mark to draw, rather than the state to depict. Asking for
  // "gentle downward curves" produced creased, wrinkled lids that read as a
  // wince: told only what the eye is doing, the model reached for the shading
  // that would sell a photograph, on a drawing that has no shading anywhere.
  'Draw each closed eye as one smooth clean downward arc, in the same dark line',
  'weight as the original lashes, with the long eyelashes still curving out from it.',
  'The skin above and around each closed eye stays flat, smooth and exactly the',
  'colour of the surrounding face — no eyelid crease, no fold, no wrinkle, no',
  'extra shading or texture of any kind.',
  'Keep the eyebrows unchanged, and keep any glasses exactly as they are: the same',
  'frame colour, thickness and shape. Do not restyle the eyewear.',
].join(' ');

/**
 * Appended to every mouth pose, and doing the same job the eyelid prompt's
 * second half does.
 *
 * The failure it exists to stop is the mouth changing *size* between poses. An
 * early AA came back so much wider than the rest pose that cycling the two read
 * as the whole mouth inflating rather than as a jaw opening — a real mouth
 * drops its jaw without moving the corners much, and saying so is cheaper than
 * regenerating until one happens to comply.
 *
 * The flat-colour clause is the lids' lesson repeated: told only what the mouth
 * is doing, these models reach for photographic shading and put gradients on a
 * cel-shaded drawing.
 */
const MOUTH_NOTE = [
  'Keep the lips the same colour, thickness and line weight as the original, and',
  'keep the outer corners of the mouth in the same place — only the opening',
  'between the lips changes, never the width of the mouth itself.',
  'Use flat cel-shaded colour: no gradients, no soft shading, no highlights, no',
  'added creases or wrinkles.',
  'Do not change the nose, chin, cheeks or jawline.',
].join(' ');

const mouth = (shape: string): string => `${shape} ${MOUTH_NOTE}`;

export const SLOTS: Slot[] = [
  {
    id: 'rest',
    label: 'Rest',
    region: 'mouth',
    prompt: mouth(
      'Close the mouth into a relaxed neutral expression: the lips together in a single soft line, no teeth and no gap.',
    ),
  },
  {
    id: 'mbp',
    label: 'M / B / P',
    region: 'mouth',
    prompt: mouth(
      'Press the lips together into one firm, slightly compressed straight line, as when beginning to say "m". No teeth and no opening at all.',
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
    prompt: EYES_CLOSED_PROMPT,
  },
  {
    id: 'eyeRightClosed',
    label: 'Right eye closed',
    region: 'eyeRight',
    prompt: EYES_CLOSED_PROMPT,
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
