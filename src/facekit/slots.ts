import type { Viseme } from '../live/visemes';

/**
 * What a face kit is made of, and what to ask a generator for.
 *
 * One slot per image the kit needs. The viseme slots are keyed on the same
 * `Viseme` union the mouth driver classifies into (live/visemes.ts), so a shape
 * cannot exist in one file and be missing from the other — add a viseme there
 * and this file stops compiling until it is authored here.
 */

export type SlotId = Viseme | 'eyesClosed';

/** Which of the kit's two boxes a slot is cropped to. */
export type Region = 'mouth' | 'eyes';

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

export const SLOTS: Slot[] = [
  {
    id: 'rest',
    label: 'Rest',
    region: 'mouth',
    prompt: 'Close the mouth into a relaxed neutral expression. Lips together, no teeth visible, faint natural smile at most.',
  },
  {
    id: 'mbp',
    label: 'M / B / P',
    region: 'mouth',
    prompt: 'Press the lips firmly together into a closed line, as when starting to say "m". No teeth, no gap.',
  },
  {
    id: 'ee',
    label: 'Spread (EE)',
    region: 'mouth',
    prompt: 'Spread the lips wide and slightly apart, corners pulled outward, upper teeth showing. The jaw stays nearly closed.',
  },
  {
    id: 'uh',
    label: 'Neutral open (UH)',
    region: 'mouth',
    prompt: 'Part the lips into a small relaxed opening, jaw slightly dropped, corners neutral. A little darkness visible inside.',
  },
  {
    id: 'aa',
    label: 'Open (AA)',
    region: 'mouth',
    prompt: 'Drop the jaw into a wide open mouth, lips relaxed and oval, upper teeth and dark mouth interior visible.',
  },
  {
    id: 'oh',
    label: 'Rounded (OH)',
    region: 'mouth',
    prompt: 'Purse the lips into a small rounded circle pushed slightly forward, as when whistling. Jaw mostly closed.',
  },
  {
    id: 'eyesClosed',
    label: 'Eyes closed',
    region: 'eyes',
    prompt: 'Close both eyes into gentle downward curves with the lashes resting on the cheeks. Keep the eyebrows, the glasses and their frames exactly as they are.',
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
