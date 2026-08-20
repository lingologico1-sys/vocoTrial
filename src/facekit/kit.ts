import { CANVAS_EDGE } from './imageModels';
import type { Persona } from './persona';
import {
  DEFAULT_LASH_STYLE,
  isBrow,
  type BoxId,
  type BrowId,
  type LashStyle,
  type Region,
  type SlotId,
} from './slots';

/**
 * What a finished face kit is, in one place.
 *
 * This type is the contract between the three things that touch a kit: the page
 * that authors it, the IndexedDB store it lives in, and the folder it exports
 * to for checking into public/faces/. One shape, so a kit built in the browser
 * and a kit committed to the repo are the same object arriving by two routes.
 */

/** A rectangle in base-image pixels. The base is always CANVAS_EDGE square. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A brow's rectangle, plus the one thing a rectangle cannot say.
 *
 * `headroom` is the clear forehead above the brow, in base pixels, measured down
 * from the box's own top edge to the top of the brow stroke. It is how far that
 * brow is allowed to rise, and it exists because the height of the box was
 * standing in for this and getting it wrong in both directions.
 *
 * The box height was never the travel. A brow box is authored deep — plain
 * forehead above, the last clear row of skin below — so its height is the sum of
 * three unrelated things: the forehead the brow can move into, the brow itself,
 * and the clean skin under it that gets stretched up to fill the gap. Taking a
 * third of that sum was a guess that the brow sits in the middle, and a portrait
 * whose brow sits low in a deep box was refused travel it plainly had. One line
 * dragged to the top of the brow separates the three and says which is which.
 *
 * Optional, and absent is not an error: every kit authored before this has none,
 * and falls back to the guess (see `browHeadroom`). Nothing about a drawn brow
 * needs migrating — the measurement is of the base image, which has not changed,
 * so the honest thing is to keep using the guess until someone drags the line.
 */
export interface BrowBox extends Box {
  headroom?: number;
}

/**
 * The mouth's rectangle, plus the one thing a rectangle cannot say.
 *
 * `chin` is the resting chin's lowest row, in base pixels, measured down from the
 * box's own top edge — the same direction and the same units as a brow's
 * `headroom`, deliberately, because they are the same kind of fact: where the
 * face inside the box actually is, which the four corners cannot state.
 *
 * What it separates is not travel. Above the line is the lower face at rest;
 * below it is clear room the open pose's chin falls into, and that band is the
 * one thing this box needs that no other box does. `defaultBoxes` has asked for
 * it in prose since the box existed and nothing has ever measured it, so a box
 * drawn to the resting chin looked exactly like a box drawn well until an "aa"
 * came back with its chin cropped off above the base's own — two chins, paid for.
 *
 * Optional, and absent means "not measured" rather than a value to guess. See
 * `chinClearance` for why this one is allowed to mean nothing when `headroom` is
 * not.
 */
export interface MouthBox extends Box {
  chin?: number;
}

/**
 * Either box that carries a measurement inside it.
 *
 * For the code that handles both drags at once, which is the picker and the one
 * handler it reports to. Neither of them cares which line is being moved — the
 * pointer capture, the canvas scale and the write-back are identical — and this
 * saves them a union they would only ever widen again.
 */
export type MeasuredBox = BrowBox & MouthBox;

/**
 * The rectangles, with the one optional member spelled out.
 *
 * The three regions are required: a slot is cropped to each of them, and a kit
 * missing one has nowhere to put the artwork it already holds.
 *
 * The brow boxes are optional because absent is a meaningful answer — it means
 * that brow does not move, which is what every kit did before they existed, and
 * the right answer for a portrait whose brows sit hard against a spectacle rim
 * or under a fringe, where there is no clear skin to slide them into. They are
 * independently optional: a face can lift one brow and not the other, because
 * the clearance that decides it is a property of one side of one picture.
 *
 * A `head` box used to live here too. It is gone — see BoxId in slots.ts, and
 * HeadMotion in live/headMotion.ts for the whole story. No migration was written
 * for its removal because none is needed: a stored kit keeps whatever it holds,
 * this type no longer names the key, and nothing reads it. The rectangle is
 * inert data rather than a thing to clean up.
 */
export interface Boxes extends Record<Region, Box> {
  mouth: MouthBox;
  browLeft?: BrowBox;
  browRight?: BrowBox;
}

/**
 * How far this brow may rise, in base pixels.
 *
 * The measurement when there is one, and the old guess when there is not. The
 * guess is half the box height rather than the third it used to be, and the
 * change is deliberate rather than incidental: a third was chosen when the lift
 * asking for it was 3 units, and it capped the default box at 2.9 pixels of
 * travel on a 160-pixel stage. Every kit already authored would have met the new
 * lift with the old ceiling and appeared not to have changed at all, which is the
 * failure this whole exercise is about. Half is still a guess and still
 * conservative — a box drawn as the guidance asks, with the brow low and the
 * forehead above, has more than half its height clear.
 *
 * Clamped to the box, which `clampBox` has already done for anything that reached
 * here through a drag. Repeated because this function is also handed boxes that
 * did not: a manifest in public/faces is hand-edited JSON, and a headroom taller
 * than its own rectangle would otherwise reach the cap as the most generous answer
 * available rather than as the nonsense it is.
 */
export function browHeadroom(box: BrowBox): number {
  return Math.min(box.height, box.headroom ?? box.height / 2);
}

/**
 * Where a mouth box's line sits when nobody has dragged it, as a share of height.
 *
 * Three quarters down, which leaves the bottom quarter as the clear band. It is
 * the shape `defaultBoxes` was already drawing — a box reaching from above the
 * lip to well past the chin — said as a number so the line has somewhere to start
 * and the picker has something to grab.
 */
const CHIN_SHARE = 0.75;

/**
 * The clear band below the resting chin, in base pixels, or null when unmeasured.
 *
 * Null rather than a guess, which is the opposite of what `browHeadroom` does one
 * box over, and the difference is worth stating because it looks like an
 * inconsistency and is not. A brow's cap *has* to exist: there is a lift every
 * frame and something must bound it, so a kit with no measurement gets the old
 * fraction and moves. Nothing here needs a number at all — the two things that
 * read this each have a good answer for "not measured", and in both cases that
 * answer is precisely what the code did before the line existed. Guessing would
 * change how every kit already in the store feathers on the strength of a line
 * nobody drew, which is a worse failure than the one it would be guessing at.
 *
 * Clamped at both ends for `browHeadroom`'s reason exactly, and at both ends
 * because a subtraction fails in two directions where a cap fails in one: a
 * manifest in public/faces is hand-edited JSON, so a `chin` below its own
 * rectangle would report negative clearance, and one above the top edge would
 * report more room than the box has — a figure over 100% of the box, on a page
 * whose whole purpose is to say what is really there.
 */
export function chinClearance(box: MouthBox): number | null {
  if (box.chin === undefined) return null;
  return box.height - chinLine(box);
}

/**
 * Where to draw the chin line, which is not the same question as the one above.
 *
 * That one asks what has been measured and is entitled to answer "nothing". This
 * one is asked by a picker that has to put a draggable line *somewhere*, and for
 * an unmeasured box the honest thing to offer is the default position — an offer,
 * not a reading, which is why the picker says so underneath rather than printing
 * a clearance figure nobody stood behind.
 *
 * Splitting them is what lets absent keep meaning absent. One function doing both
 * would have to pick a number for the feather to use, and picking one there is the
 * failure `chinClearance` exists to avoid.
 */
export function chinLine(box: MouthBox): number {
  return Math.min(box.height, Math.max(0, box.chin ?? box.height * CHIN_SHARE));
}

export interface FaceKit {
  /** Bumped when this shape changes in a way an older kit cannot satisfy. */
  format: number;
  id: string;
  name: string;
  createdAt: number;
  /**
   * The neutral portrait every patch composites onto, as a PNG data URL.
   *
   * Always CANVAS_EDGE square. Not the file that was uploaded: that one is
   * normalised on the way in, and usually neutralised by a generation pass as
   * well, because a portrait supplied mid-smile is the wrong thing to build a
   * closed mouth on top of.
   */
  base: string;
  /**
   * The portrait as uploaded, before any generation touched it.
   *
   * Kept so that neutralising is repeatable rather than cumulative. Running it
   * against `base` meant a second press edited the first press's output, and a
   * third edited the second — each one a further generation away from the
   * drawing that arrived, in a direction nobody chose. Pressing it again should
   * mean "try that again", not "and again on top".
   *
   * Optional because kits authored before it existed have no copy to offer;
   * those fall back to `base` and behave as they always did.
   */
  original?: string;
  /** Where each region sits on the base. Also the generation mask. */
  boxes: Boxes;
  /** One PNG data URL per authored slot, already cropped to its region's box. */
  patches: Partial<Record<SlotId, string>>;
  /**
   * How much eyelash the closed-eye prompt asks for.
   *
   * An authoring setting rather than a rendering one: it is read when an eye is
   * generated and never again, so changing it leaves any eye already in the kit
   * exactly as it was — the new answer applies to the next generation, which is
   * what a prompt knob can honestly promise.
   *
   * Optional, and absent means the default, so no format bump: a kit written
   * before this existed holds artwork that is already drawn, and there is
   * nothing about it for a migration to bring forward.
   */
  lashes?: LashStyle;
  /**
   * Who this face is, when anyone has said.
   *
   * The only member here that is never drawn and never measured — it is prompt
   * text, and it rides on the kit because identity travels with a face rather
   * than with a session. A kit published to the library carries it (unlike
   * `original`, which is stripped): a browser that never authored the portrait
   * needs the person more than it needs the authoring history.
   *
   * Optional, and absent is the ordinary state rather than a gap to fill: it
   * means this face says nothing about itself, which is exactly what every kit
   * did before the field existed and what studio sends when the persona is
   * switched off. No format bump for the same reason `lashes` needed none —
   * nothing already drawn has to be brought forward.
   */
  persona?: Persona;
  /** What the kit has cost to generate so far, in USD. A floor — see below. */
  spentUsd: number;
}

export const KIT_FORMAT = 2;

/**
 * Brings a format 1 kit forward.
 *
 * Format 1 had one box spanning both eyes. Splitting it down the middle gives
 * two boxes that are roughly right and certainly draggable, which is a better
 * starting position than none. The old closed-eyes patch is dropped rather than
 * carried: it was cut to a box that no longer exists, and on a face wearing
 * glasses it was the patch that came back with the frames restyled — the very
 * problem the split exists to solve.
 */
export function migrate(kit: FaceKit): FaceKit {
  if (kit.format >= KIT_FORMAT) return kit;

  // Through `unknown` because `Boxes` names its members and `eyes` is not one
  // of them — that is the point of the migration, and the cast is how a shape
  // the type system has already forgotten gets read one last time.
  const legacy = (kit.boxes as unknown as Partial<Record<string, Box>>).eyes;
  const boxes = { ...defaultBoxes(), mouth: kit.boxes.mouth ?? defaultBoxes().mouth };

  if (legacy) {
    const half = Math.round(legacy.width / 2);
    const inset = Math.round(half * 0.12);
    boxes.eyeLeft = clampBox({ ...legacy, width: half - inset });
    boxes.eyeRight = clampBox({ ...legacy, x: legacy.x + half + inset, width: half - inset });
  }

  const patches = { ...kit.patches };
  delete (patches as Record<string, unknown>).eyesClosed;

  return { ...kit, format: KIT_FORMAT, boxes, patches };
}

/**
 * Opening guesses, placed where a face usually keeps its features.
 *
 * They exist so the page has something to drag rather than something to draw,
 * and they are wrong for every portrait — the point is that being wrong by a
 * little is a much easier starting position than an empty canvas.
 */
export function defaultBoxes(): Boxes {
  const edge = CANVAS_EDGE;
  const mouthHeight = Math.round(edge * 0.27);
  const eye = {
    y: Math.round(edge * 0.33),
    width: Math.round(edge * 0.16),
    height: Math.round(edge * 0.1),
  };
  return {
    // Taller than the closed mouth needs, because the box is where every pose
    // gets cropped and the open one is the tall one. A box drawn snugly round
    // the lips of a resting face silently guillotines the dropped jaw of an
    // "aa" — the patch looks fine in the picker and wrong in motion.
    //
    // It has to reach past the chin, not just past the lips: the open pose is
    // allowed to take the chin down with the jaw (see JAW_DROPS in slots.ts),
    // so a box ending at the resting chin leaves the lowered one cropped off
    // above the original, which reads as two chins. This default is a starting
    // position to drag, and on most portraits it wants dragging lower.
    //
    // The `chin` is stated for `defaultBrowBox`'s reason: absent means "this kit
    // predates the measurement", and a box being placed for the first time today
    // is not that. It is the same number `chinLine` would have offered anyway, so
    // a box placed now and one placed before the line existed start in the same
    // place — the difference is that this one has been measured, badly, by a
    // default that has never seen the portrait, and says so by holding a value.
    mouth: {
      x: Math.round(edge * 0.33),
      y: Math.round(edge * 0.54),
      width: Math.round(edge * 0.34),
      height: mouthHeight,
      chin: Math.round(mouthHeight * CHIN_SHARE),
    },
    // Narrow enough to sit inside a lens rather than across a frame. Being a
    // little too small is the safe error here: a box that clips the outer
    // corner of an eye still blinks, whereas one that catches the rim invites
    // the model to redesign the glasses.
    eyeLeft: { ...eye, x: Math.round(edge * 0.3) },
    eyeRight: { ...eye, x: Math.round(edge * 0.54) },
  };
}

/**
 * A starting rectangle for one brow, offered rather than assumed.
 *
 * Deliberately not part of `defaultBoxes`, so that neither a new kit nor an
 * older one migrating forward silently acquires brow motion at a guessed
 * position. A guessed mouth box is obvious the moment you look at the picker; a
 * guessed brow box does nothing at all until the face speaks, and then slides a
 * rectangle of forehead around for reasons nobody chose. Placing it is a press.
 *
 * Deep rather than snug, because the top of the box wants to be up in plain
 * forehead where a seam has nothing to catch on, and because the forehead inside
 * it is what the brow has to move into.
 *
 * The opening `headroom` is half the height, which is deliberately the same
 * number `browHeadroom` guesses when there is none — so a box placed today and a
 * box placed before the line existed start in exactly the same place, and the only
 * difference between them is that this one has a line to drag. It is stated rather
 * than left absent because absent means "this kit predates the measurement", and a
 * box being placed for the first time today is not that. A line drawn at a visible
 * starting position is also how anyone finds out it is there.
 */
export function defaultBrowBox(which: BrowId): BrowBox {
  const edge = CANVAS_EDGE;
  const height = Math.round(edge * 0.055);
  return {
    x: Math.round(edge * (which === 'browLeft' ? 0.35 : 0.53)),
    y: Math.round(edge * 0.29),
    width: Math.round(edge * 0.12),
    height,
    headroom: Math.round(height / 2),
  };
}

/**
 * The size a box of this kind is handed when nobody has said otherwise.
 *
 * Read by the picker to answer a question it cannot ask directly: whether a
 * box's size was chosen or merely given. A kit that has been saved and reopened
 * has forgotten which of its boxes were dragged, and a box still sitting at the
 * exact pixel dimensions of the opening guess is the one it is safe to resize on
 * the owner's behalf. It is possible to drag a box back to precisely these
 * numbers and lose that distinction; the cost of being wrong is a box that
 * follows its partner one more time, on a kit with nothing cut to it yet.
 */
export function defaultBoxSize(id: BoxId): { width: number; height: number } {
  const box = isBrow(id) ? defaultBrowBox(id) : defaultBoxes()[id];
  return { width: box.width, height: box.height };
}

/**
 * The same box at a new size, pinned by its centre.
 *
 * Centre rather than corner, because this is used to carry a size from one eye
 * to the other and the thing that must not move is what the box is over. Growing
 * a box from its top-left corner slides it off the eye it was placed on and
 * makes the owner re-place a box they never asked to have resized.
 */
export function resizeAbout<T extends Box>(box: T, size: { width: number; height: number }): T {
  return clampBox({
    ...box,
    x: box.x + (box.width - size.width) / 2,
    y: box.y + (box.height - size.height) / 2,
    width: size.width,
    height: size.height,
  });
}

export function newKit(name: string, base: string): FaceKit {
  return {
    format: KIT_FORMAT,
    id: `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: Date.now(),
    base,
    original: base,
    boxes: defaultBoxes(),
    patches: {},
    lashes: DEFAULT_LASH_STYLE,
    spentUsd: 0,
  };
}

/**
 * Keeps a box on the canvas and above a size the drag handles can survive.
 *
 * Generic, and spreading the box it was given rather than building a fresh one
 * from four fields. That is not tidiness: this runs on every frame of every drag,
 * so a rectangle rebuilt from its own corners is a rectangle that silently loses
 * anything else it was carrying. A brow's `headroom` would have survived being
 * placed and vanished the first time the box was nudged, which is the kind of bug
 * that looks like the feature never worked.
 *
 * And having carried it, this is also the place that has to keep it inside the
 * rectangle, because this is the only place the height changes. A measurement of
 * the space above a brow cannot outlive being told the box is shorter than the
 * measurement — and the failure is worse than nonsense, it is *permissive*: a
 * headroom at or past the bottom edge reads as a box that is clear forehead all
 * the way down, which is the largest travel the cap can grant. Dragging the north
 * handle down over the line would have quietly maximised the very number it was
 * shrinking. Pulled along with the edge instead, so the line stays on the last row
 * the box still contains and the number never says more than the rectangle does.
 *
 * The mouth's `chin` gets the same treatment because it is the same measurement
 * pointing the other way, but note that its permissive direction is the opposite
 * one: clearance is what is left *below* the line, so a box dragged shorter than
 * its own chin line would report no room rather than all of it. That is the safe
 * error of the two — it warns and it shrinks the fade — and clamping still beats
 * it, because a line sitting under the box it belongs to is not a measurement of
 * anything.
 *
 * Left absent when it was absent, which the conditional spreads are doing rather
 * than defaulting: absent is the load-bearing state for both. On a brow it means
 * this kit predates the measurement and wants the guess (`browHeadroom`); on the
 * mouth it means nothing has been measured and nothing should be inferred
 * (`chinClearance`).
 */
export function clampBox<T extends Box>(box: T): T {
  const min = 48;
  const width = Math.min(CANVAS_EDGE, Math.max(min, Math.round(box.width)));
  const height = Math.min(CANVAS_EDGE, Math.max(min, Math.round(box.height)));
  const { headroom, chin } = box as MeasuredBox;
  return {
    ...box,
    width,
    height,
    x: Math.min(CANVAS_EDGE - width, Math.max(0, Math.round(box.x))),
    y: Math.min(CANVAS_EDGE - height, Math.max(0, Math.round(box.y))),
    ...(headroom === undefined ? {} : { headroom: Math.min(headroom, height) }),
    ...(chin === undefined ? {} : { chin: Math.min(chin, height) }),
  };
}

/**
 * The filename a slot's patch takes when the kit is exported.
 *
 * Region-prefixed rather than bare, because the region is what decides which
 * box a patch is cropped to, and a folder someone is reading by eye should not
 * make them look that up in a manifest.
 */
export function patchFilename(id: SlotId, region: Region): string {
  return `${region}-${id}.png`;
}
