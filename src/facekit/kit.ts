import { CANVAS_EDGE } from './imageModels';
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
 * The head box is optional for a blunter reason: absent is what every kit
 * authored before it existed says, and those kits must keep animating exactly as
 * they did. Absent means the lift moves the whole picture, background and all.
 * Present means it moves only what is inside this rectangle.
 */
export interface Boxes extends Record<Region, Box> {
  browLeft?: Box;
  browRight?: Box;
  head?: Box;
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
    mouth: {
      x: Math.round(edge * 0.33),
      y: Math.round(edge * 0.54),
      width: Math.round(edge * 0.34),
      height: Math.round(edge * 0.27),
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
 * Deep rather than snug, because the height is the travel budget — the lift is
 * capped at a third of it — and because the top of the box wants to be up in
 * plain forehead where a seam has nothing to catch on.
 */
export function defaultBrowBox(which: BrowId): Box {
  const edge = CANVAS_EDGE;
  return {
    x: Math.round(edge * (which === 'browLeft' ? 0.35 : 0.53)),
    y: Math.round(edge * 0.29),
    width: Math.round(edge * 0.12),
    height: Math.round(edge * 0.055),
  };
}

/**
 * A starting rectangle for the head, offered on the same terms as the brows.
 *
 * Not in `defaultBoxes` for the same reason and one more: placing it *changes
 * what the lift does*. A kit that acquired one by default would quietly stop
 * moving its background, which is the correct behaviour but not one to impose on
 * a kit whose owner never asked for it.
 *
 * Full-bleed on three sides, and that is the considered default rather than a
 * lazy one. Top and sides are hard cuts — see Face.tsx on why only the bottom is
 * feathered — and a hard cut is invisible in exactly two places: somewhere the
 * pixels either side of it are the same flat colour, or the edge of the canvas,
 * where there is nothing beside it at all. Inset sides looked like the tidier
 * answer and were tried first; on a portrait cropped anywhere near the hair they
 * put a straight vertical line down a head of curls the moment it moved, because
 * a box that clears the hair on that kind of crop does not exist.
 *
 * So the sides go to the edge, and what that costs is the background inside the
 * box moving with the head. On flat white it costs nothing. Pull them in for a
 * portrait with a patterned or vignetted background to hold still — and then the
 * hair has to clear them, which is a constraint on the portrait as much as on
 * the box.
 *
 * The bottom is the only edge placed with care by default: low, across the chest
 * below the chin, which is where the one soft edge belongs.
 */
export function defaultHeadBox(): Box {
  const edge = CANVAS_EDGE;
  return { x: 0, y: 0, width: edge, height: Math.round(edge * 0.81) };
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
  const box = isBrow(id)
    ? defaultBrowBox(id)
    : id === 'head'
      ? defaultHeadBox()
      : defaultBoxes()[id];
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
export function resizeAbout(box: Box, size: { width: number; height: number }): Box {
  return clampBox({
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

/** Keeps a box on the canvas and above a size the drag handles can survive. */
export function clampBox(box: Box): Box {
  const min = 48;
  const width = Math.min(CANVAS_EDGE, Math.max(min, Math.round(box.width)));
  const height = Math.min(CANVAS_EDGE, Math.max(min, Math.round(box.height)));
  return {
    width,
    height,
    x: Math.min(CANVAS_EDGE - width, Math.max(0, Math.round(box.x))),
    y: Math.min(CANVAS_EDGE - height, Math.max(0, Math.round(box.y))),
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
