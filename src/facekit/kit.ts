import { CANVAS_EDGE } from './imageModels';
import type { Region, SlotId } from './slots';

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
  /** Where each region sits on the base. Also the generation mask. */
  boxes: Record<Region, Box>;
  /** One PNG data URL per authored slot, already cropped to its region's box. */
  patches: Partial<Record<SlotId, string>>;
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

  const legacy = (kit.boxes as Partial<Record<string, Box>>).eyes;
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
export function defaultBoxes(): Record<Region, Box> {
  const edge = CANVAS_EDGE;
  const eye = {
    y: Math.round(edge * 0.33),
    width: Math.round(edge * 0.16),
    height: Math.round(edge * 0.1),
  };
  return {
    mouth: {
      x: Math.round(edge * 0.33),
      y: Math.round(edge * 0.56),
      width: Math.round(edge * 0.34),
      height: Math.round(edge * 0.22),
    },
    // Narrow enough to sit inside a lens rather than across a frame. Being a
    // little too small is the safe error here: a box that clips the outer
    // corner of an eye still blinks, whereas one that catches the rim invites
    // the model to redesign the glasses.
    eyeLeft: { ...eye, x: Math.round(edge * 0.3) },
    eyeRight: { ...eye, x: Math.round(edge * 0.54) },
  };
}

export function newKit(name: string, base: string): FaceKit {
  return {
    format: KIT_FORMAT,
    id: `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: Date.now(),
    base,
    boxes: defaultBoxes(),
    patches: {},
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
