import { CANVAS_EDGE } from './imageModels';
import type { Box } from './kit';

/**
 * The pixel work, and the reason this page can produce a face that does not
 * boil.
 *
 * The central claim: no generator's output is used whole. Every result is cut
 * down to the slot's box and drawn onto the *original* base here, in the
 * browser. Outside that box the kit is bit-identical to the base — not because
 * a provider promised to leave it alone, but because those pixels were never
 * replaced. The generator regenerates the entire frame on every call — as did
 * the masked one that used to sit beside it, mask or no mask — and at sixty
 * frames a second the difference between "almost unchanged" and "unchanged" is
 * the difference between a face and a shimmer.
 *
 * Three things happen on the way in, in this order, and each fixes a distinct
 * failure you can see with your own eyes if you turn it off:
 *
 *   normalise    every image becomes the same square, so a result that came
 *                back at a different resolution still lines up with the boxes
 *   tone match   the patch is shifted onto the base's own colour, so the
 *                rectangle does not announce itself as a lighter chin
 *   feather      the patch's edge is faded out, so what survives tone matching
 *                is spread over a dozen pixels instead of landing on one line
 */

function context(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser gave no 2D canvas context');
  return ctx;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be decoded'));
    image.src = src;
  });
}

/**
 * Fits any image onto the one square everything else assumes.
 *
 * Contain rather than cover, and centred: cropping to fill would quietly cut
 * the top off a head, which is the single most common way an automated crop
 * ruins a portrait. Padding stays transparent, so a cut-out portrait keeps its
 * cut-out edges and a full-bleed one is unaffected.
 */
export async function normalise(src: string): Promise<string> {
  const image = await loadImage(src);
  const scale = Math.min(CANVAS_EDGE / image.width, CANVAS_EDGE / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  const ctx = context(CANVAS_EDGE, CANVAS_EDGE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, (CANVAS_EDGE - width) / 2, (CANVAS_EDGE - height) / 2, width, height);
  return ctx.canvas.toDataURL('image/png');
}

/**
 * Any blob, as a data URL, with its bytes untouched.
 *
 * A straight read rather than a canvas round trip, which matters where this is
 * used on artwork that is already correct: drawing a PNG onto a canvas and
 * asking for it back re-encodes it, and a kit's patches are pixels somebody
 * generated and cropped deliberately. Nothing here should be paying for a
 * second encode to change a string's prefix.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read'));
    reader.readAsDataURL(blob);
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return blobToDataUrl(file);
}

/**
 * The whole square, as a box.
 *
 * So that the one operation that works on a full frame rather than a slot can
 * use the same clipping code as everything else instead of a near-copy of it.
 */
export const FULL_FRAME: Box = { x: 0, y: 0, width: CANVAS_EDGE, height: CANVAS_EDGE };

/**
 * Whether an image has anything less than fully opaque in it.
 *
 * The gate on both of the cut-out compensations below. A portrait with a real
 * photographed background is the ordinary case and must cost nothing extra —
 * in particular it must not be re-encoded through a canvas for a correction
 * that would change no pixel.
 */
async function hasAlpha(src: string, box?: Box): Promise<boolean> {
  const image = await loadImage(src);
  const region = box ?? { x: 0, y: 0, width: CANVAS_EDGE, height: CANVAS_EDGE };
  const ctx = context(region.width, region.height);
  ctx.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  const { data } = ctx.getImageData(0, 0, region.width, region.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Puts an opaque backdrop behind a cut-out portrait, for sending only.
 *
 * A portrait with no background is a shape these models handle badly. Nothing
 * in the provider's contract says what happens to the alpha channel of an
 * input image, and what it does with it in practice is decide: the frame comes
 * back opaque either way, so somewhere in there the transparency was resolved
 * against a colour nobody chose. Resolved against black — which is the common
 * choice — the model is looking at a face lit from nothing, and it returns a
 * mouth shaded for that scene. The patch is then dark at the edges in a way
 * tone matching has to spend its whole budget undoing.
 *
 * White because it is the background these models have seen most portraits on,
 * and the goal is to hand them something ordinary rather than something clever.
 * It never reaches the kit: `clipToBase` puts the hole back afterwards, so the
 * backdrop exists only for the length of one request.
 */
export async function flattenBackground(src: string, colour = '#ffffff'): Promise<string> {
  if (!(await hasAlpha(src))) return src;
  const image = await loadImage(src);
  const ctx = context(CANVAS_EDGE, CANVAS_EDGE);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, CANVAS_EDGE, CANVAS_EDGE);
  ctx.drawImage(image, 0, 0, CANVAS_EDGE, CANVAS_EDGE);
  return ctx.canvas.toDataURL('image/png');
}

/**
 * Cuts a result back to the base's own silhouette.
 *
 * The failure this exists for is the one a cut-out portrait produces and a
 * full-bleed one never can. Every generator returns an opaque frame: asked to
 * edit a head floating on nothing, it invents something to put behind the head.
 * Crop a box out of that and the parts of the box that lie *outside* the jaw —
 * which on a tight mouth box is most of its lower corners — come back as solid
 * invented background. Composited onto a base that is transparent there, the
 * result is a pale rectangle hanging off the chin, and it appears and vanishes
 * as the mouth changes shape. On a page with a coloured backdrop behind the
 * face it is the most visible artefact this pipeline can produce.
 *
 * The correction is to multiply the result's alpha by the base's, so a pixel
 * the portrait did not cover cannot be painted no matter what came back. That
 * is `destination-in`, which is doing real work rather than thresholding: an
 * anti-aliased silhouette edge is half-transparent for a pixel or two, and
 * multiplying keeps that softness instead of trading it for a staircase.
 *
 * Applied before tone matching, so the seam ring is measured on pixels that
 * will actually survive, and well before feathering, so the two alphas compose
 * rather than fight.
 */
export async function clipToBase(patch: string, base: string, box: Box): Promise<string> {
  if (!(await hasAlpha(base, box))) return patch;

  const [patchImage, baseImage] = await Promise.all([loadImage(patch), loadImage(base)]);

  const stencil = context(box.width, box.height);
  stencil.drawImage(baseImage, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

  const ctx = context(box.width, box.height);
  ctx.drawImage(patchImage, 0, 0, box.width, box.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(stencil.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return ctx.canvas.toDataURL('image/png');
}

/*
 * maskFor(box) was here — the mask OpenAI's edit endpoint wanted, transparent
 * where the model was allowed to paint and opaque black everywhere else. It
 * went with the models that took one; `git log` has it if a masked provider is
 * ever added back. Nothing below changes in that event: the crop was never the
 * mask's understudy, for the reason at the top of this file.
 */

/**
 * Cuts a box out of a generated result, having first put it on the same grid.
 *
 * The normalise step is what makes this safe against a provider that returns a
 * size nobody asked for: the head is framed identically, so scaling the whole
 * frame back to the standard square puts the mouth back under the mouth box.
 */
export async function cropToBox(src: string, box: Box): Promise<string> {
  const square = await loadImage(await normalise(src));
  const ctx = context(box.width, box.height);
  ctx.drawImage(square, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return ctx.canvas.toDataURL('image/png');
}

/**
 * The middle value of a list, which this is allowed to reorder.
 *
 * In place because the only caller builds the array for this and throws it away,
 * and a copy of every seam sample per channel is real work for no reader's
 * benefit. Said out loud rather than left to be discovered.
 */
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = values.length >> 1;
  return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

/**
 * Shifts a patch onto the base's colour, measured at the seam itself.
 *
 * The comparison is made on a ring of pixels around the patch's own border and
 * the base pixels underneath that same ring — the two things that will end up
 * touching. Matching there rather than over the whole box is what makes this
 * safe: the middle of the patch is *supposed* to differ, since a new mouth is
 * the entire point, and including that would drag the correction toward
 * whatever colour the new teeth happen to be.
 *
 * The *median* of the ring, not its mean, and that distinction is the whole
 * correctness of this function on the one pose that most needs it.
 *
 * The ring was chosen on the argument that the middle of a patch may differ and
 * its border may not. Only half of that is true. A border pixel is unchanged on
 * most poses and on some it is not: "aa" is allowed to take the chin down with
 * the jaw (JAW_DROPS in slots.ts), so the bottom of its box is new artwork by
 * design, and a jaw wide enough to need that box also reshades the cheeks either
 * side of it. Measured on the shipped default kit, "aa" leaves 6% of its ring
 * visibly changed where "rest" leaves none — and the changed part is not spread
 * evenly, it sits on whole edges. The four edges of that ring disagreed by
 * sixteen levels: top and bottom about +5 against the base, left and right about
 * -10.
 *
 * A mean averages those into cancellation and then some. It reported the patch
 * as roughly one level darker than the base — so the correction *lightened* an
 * "aa" whose skin was already seven levels too light, every single time, which
 * is why regenerating the pose never fixed it. The median reports +5 and takes
 * most of it back out. Neither statistic can fully answer a drift that is a
 * gradient rather than an offset, but one of them at least fits the majority of
 * the ring instead of a point no part of it occupies.
 *
 * Nothing regresses on the poses that were already right: across the other five
 * mouth slots of that kit the two statistics agree to within a level, because
 * with a clean ring there is nothing for the median to be robust against.
 *
 * Only opaque patch pixels are counted, and the shift is skipped entirely when
 * too few of them exist to measure honestly.
 */
export async function matchTone(patch: string, base: string, box: Box): Promise<string> {
  const [patchImage, baseImage] = await Promise.all([loadImage(patch), loadImage(base)]);

  const patchCtx = context(box.width, box.height);
  patchCtx.drawImage(patchImage, 0, 0, box.width, box.height);
  const patchData = patchCtx.getImageData(0, 0, box.width, box.height);

  const baseCtx = context(box.width, box.height);
  baseCtx.drawImage(baseImage, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const baseData = baseCtx.getImageData(0, 0, box.width, box.height);

  /** How deep into the patch the seam ring reaches. */
  const ring = Math.max(2, Math.round(Math.min(box.width, box.height) * 0.06));

  /** Every seam sample, kept per channel so each can be sorted on its own. */
  const drift: [number[], number[], number[]] = [[], [], []];

  for (let y = 0; y < box.height; y++) {
    const vertical = y < ring || y >= box.height - ring;
    for (let x = 0; x < box.width; x++) {
      if (!vertical && x >= ring && x < box.width - ring) continue;
      const i = (y * box.width + x) * 4;
      // A transparent patch pixel has no colour to compare, and a transparent
      // base pixel is outside the cut-out portrait entirely.
      if (patchData.data[i + 3] < 250 || baseData.data[i + 3] < 250) continue;
      drift[0].push(patchData.data[i] - baseData.data[i]);
      drift[1].push(patchData.data[i + 1] - baseData.data[i + 1]);
      drift[2].push(patchData.data[i + 2] - baseData.data[i + 2]);
    }
  }

  if (drift[0].length < 64) return patch;

  const shift = drift.map(median);
  // Under a quantisation step there is nothing to correct, and applying it
  // anyway would re-encode the patch for no gain.
  if (shift.every((value) => Math.abs(value) < 1)) return patch;

  for (let i = 0; i < patchData.data.length; i += 4) {
    if (patchData.data[i + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel++) {
      const corrected = patchData.data[i + channel] - shift[channel];
      patchData.data[i + channel] = corrected < 0 ? 0 : corrected > 255 ? 255 : corrected;
    }
  }

  patchCtx.putImageData(patchData, 0, 0);
  return patchCtx.canvas.toDataURL('image/png');
}

/**
 * Fades a patch's outer edge to nothing, across exactly `radius` pixels.
 *
 * Tone matching gets the seam close; this stops whatever it could not reach
 * from arriving as a straight line, which the eye finds far faster than it
 * finds a gradient of the same magnitude.
 *
 * Built from four linear gradients rather than a blurred rectangle, and the
 * difference is not stylistic. `filter: blur(Npx)` sets a standard deviation of
 * N, so its visible spread runs to about three times that: a nominal 10px
 * feather was leaving the outer *thirty-odd* pixels of every patch partly
 * transparent. On a wide-open mouth the lower lip sits in exactly that band and
 * faded out into the chin — the artwork was present and correct, and being
 * erased on the way in.
 *
 * A gradient says what it means. Alpha is zero at the boundary and solid by
 * `radius`, with nothing beyond it touched.
 */
function feather(
  source: CanvasImageSource,
  box: Box,
  radius: number,
  bottom = radius,
): HTMLCanvasElement {
  const ctx = context(box.width, box.height);
  ctx.drawImage(source, 0, 0, box.width, box.height);

  const { width, height } = box;
  const stencil = context(width, height);
  stencil.fillStyle = '#fff';
  stencil.fillRect(0, 0, width, height);

  // Each edge erased by a ramp running inward. Corners are crossed by two of
  // them and so fade a little faster, which is what a corner should do anyway.
  //
  // The bottom takes a depth of its own because it is the only edge with
  // something underneath it that has to survive the journey — see featherPatch.
  stencil.globalCompositeOperation = 'destination-out';
  const edges: [number, number, number, number, number, number, number, number][] = [
    [0, 0, radius, 0, 0, 0, radius, height], // left
    [width, 0, width - radius, 0, width - radius, 0, radius, height], // right
    [0, 0, 0, radius, 0, 0, width, radius], // top
  ];
  // Pushed rather than always present, so a depth of zero means no ramp instead
  // of a ramp whose ends coincide. The spec says such a gradient paints nothing,
  // which happens to be the right answer — but arriving at it by accident is not
  // the same as asking for it.
  if (bottom > 0) {
    edges.push([0, height, 0, height - bottom, 0, height - bottom, width, bottom]);
  }

  for (const [gx0, gy0, gx1, gy1, x, y, w, h] of edges) {
    const ramp = stencil.createLinearGradient(gx0, gy0, gx1, gy1);
    ramp.addColorStop(0, 'rgba(0,0,0,1)');
    ramp.addColorStop(1, 'rgba(0,0,0,0)');
    stencil.fillStyle = ramp;
    stencil.fillRect(x, y, w, h);
  }
  stencil.globalCompositeOperation = 'source-over';

  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(stencil.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return ctx.canvas;
}

/** The fade every patch edge gets, before either ceiling below is applied. */
export const PATCH_FEATHER = 10;

/**
 * How deep this box's patches actually fade, in base pixels.
 *
 * Exported because the picker needs the same number to say whether a mouth box
 * has room for its own seam, and a warning computing the depth separately is a
 * warning that goes quietly wrong the day the ceiling changes.
 *
 * A tenth of the shorter side, at most. The ramp means what it says, so this
 * ceiling is about proportion rather than damage control: on a short box a fixed
 * ten pixels is a larger share of the artwork than it looks.
 */
export function featherDepth(box: Box, radius = PATCH_FEATHER): number {
  const limit = Math.floor(Math.min(box.width, box.height) / 10);
  return Math.max(0, Math.min(radius, limit));
}

/**
 * Bakes the fade into the patch, once, on the way into the kit.
 *
 * Feathering used to happen at assembly time, which was wrong in a way worth
 * recording: the preview composited on a canvas and the live face draws an
 * <image> in an SVG, so a fade applied only by the compositor would have shown
 * up in the filmstrip and not in the thing being previewed. A kit whose patches
 * carry their own alpha looks the same however it is drawn, which is the only
 * way "what plays here is the artwork" can be true.
 *
 * `clearance` is the clear band below the resting chin, on a mouth box that has
 * been measured (`chinClearance`), and it caps the bottom ramp alone. What it
 * prevents is the fade climbing over face: the bottom edge is the one the lower
 * lip and chin sit nearest, and a box drawn tight to the resting chin has the
 * ramp eating the chin the portrait wears when it is *not* speaking — which then
 * ghosts on every pose at once, since all of them carry it.
 *
 * This is the same family as the blur that once erased a lower lip, and it is
 * worth being clear about how it differs, because the earlier fix does not cover
 * it. That one was a bug in the ramp: a nominal ten pixels spreading over thirty.
 * This is a correct ten-pixel ramp landing on artwork, and no radius is small
 * enough to fix it, because the distance that matters is not a property of the
 * patch at all — it is how far below the chin somebody dragged the bottom edge.
 * Only the box knows that, so only the box can bound it.
 *
 * What it does not promise: that a *generated* chin is untouched. The line is a
 * measurement of the base at rest, and how far an open pose's jaw actually fell
 * is a fact about an image that does not exist yet. The guarantee is the one that
 * can be made from here — no fade over the resting face, and none at all where
 * there is no room to fade in. Unmeasured boxes are left exactly as they were:
 * absent means nothing is known, and a bottom ramp is what this did before.
 */
export async function featherPatch(
  patch: string,
  box: Box,
  radius = PATCH_FEATHER,
  clearance?: number | null,
): Promise<string> {
  const image = await loadImage(patch);
  const applied = featherDepth(box, radius);
  if (applied === 0) return patch;
  const bottom =
    clearance === undefined || clearance === null
      ? applied
      : Math.min(applied, Math.floor(Math.max(0, clearance)));
  return feather(image, box, applied, bottom).toDataURL('image/png');
}

/**
 * How much of two patches actually differ, as a share of the area compared.
 *
 * For catching the failure that is invisible in a contact sheet and fatal in
 * motion: a pose that came back as a copy of one already in the kit. Two closed
 * mouths are the usual pair, because a model asked to close a mouth that is
 * already closed has nothing to do and returns what it was given — but any two
 * slots can collide, and a kit whose "uh" and "ee" are the same drawing plays as
 * a mouth that stops moving on half the vowels.
 *
 * Counted rather than averaged, and that is the whole reason this reads
 * cleanly. A mean difference over the box is dominated by the pixels that are
 * *supposed* to match — the chin and cheeks around the lips are identical
 * between every pose by construction — so two genuinely different mouths and
 * two identical ones separate by very little, and the threshold ends up sitting
 * in resampling noise. Asking instead what share of pixels differ *visibly*
 * puts a real pose change up in the tens of percent and leaves noise at
 * approximately zero, which is a gap you can put a number in the middle of.
 *
 * Measured over the middle of the box only. The outer quarter is feathered to
 * transparency and holds the face around the mouth rather than the mouth, so
 * including it would dilute every comparison by the one region that can never
 * disagree.
 */
export async function patchDivergence(a: string, b: string, box: Box): Promise<number> {
  const [first, second] = await Promise.all([loadImage(a), loadImage(b)]);

  const read = (image: HTMLImageElement) => {
    const ctx = context(box.width, box.height);
    ctx.drawImage(image, 0, 0, box.width, box.height);
    return ctx.getImageData(0, 0, box.width, box.height).data;
  };

  const one = read(first);
  const two = read(second);

  const insetX = Math.round(box.width * 0.25);
  const insetY = Math.round(box.height * 0.25);

  /** A per-channel step below which two pixels are the same colour to the eye. */
  const VISIBLE = 24;

  let compared = 0;
  let differing = 0;

  for (let y = insetY; y < box.height - insetY; y++) {
    for (let x = insetX; x < box.width - insetX; x++) {
      const i = (y * box.width + x) * 4;
      // Transparent on either side is outside the artwork on that side, and a
      // pixel with nothing drawn in it cannot disagree about what is drawn.
      if (one[i + 3] < 250 || two[i + 3] < 250) continue;
      compared++;
      const gap = Math.max(
        Math.abs(one[i] - two[i]),
        Math.abs(one[i + 1] - two[i + 1]),
        Math.abs(one[i + 2] - two[i + 2]),
      );
      if (gap >= VISIBLE) differing++;
    }
  }

  // Nothing overlapping to compare is not agreement; reporting it as a total
  // difference keeps the caller from flagging a pair it never actually saw.
  return compared === 0 ? 1 : differing / compared;
}

export interface Overlay {
  patch: string;
  box: Box;
}

/**
 * The base with some patches on it — the operation everything else is built on.
 *
 * Used for the export, for the preview, and for the cycling filmstrip that
 * catches flicker. All three go through here so what you judge on screen is
 * exactly what the kit will produce, rather than a near-enough approximation
 * that hides the artefact you were looking for.
 */
export async function composite(base: string, overlays: Overlay[]): Promise<string> {
  const baseImage = await loadImage(base);
  const ctx = context(CANVAS_EDGE, CANVAS_EDGE);
  ctx.drawImage(baseImage, 0, 0, CANVAS_EDGE, CANVAS_EDGE);

  // No shaping here: a patch arrives already feathered, so this is a plain draw
  // and the result is exactly what the live face will show.
  for (const overlay of overlays) {
    const image = await loadImage(overlay.patch);
    ctx.drawImage(image, overlay.box.x, overlay.box.y, overlay.box.width, overlay.box.height);
  }

  return ctx.canvas.toDataURL('image/png');
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',');
  const type = /:(.*?);/.exec(header)?.[1] ?? 'image/png';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
