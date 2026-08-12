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
 * replaced. Both providers regenerate the entire frame on every call, mask or
 * no mask, and at sixty frames a second the difference between "almost
 * unchanged" and "unchanged" is the difference between a face and a shimmer.
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

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read'));
    reader.readAsDataURL(file);
  });
}

/**
 * The mask OpenAI's edit endpoint wants: transparent where it may paint.
 *
 * Inverted from the intuition most people bring to it — the hole is the
 * subject, not the protection. Everything outside the box is opaque black,
 * which is the instruction to leave it be.
 */
export function maskFor(box: Box): string {
  const ctx = context(CANVAS_EDGE, CANVAS_EDGE);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CANVAS_EDGE, CANVAS_EDGE);
  ctx.clearRect(box.x, box.y, box.width, box.height);
  return ctx.canvas.toDataURL('image/png');
}

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
 * Shifts a patch onto the base's colour, measured at the seam itself.
 *
 * The comparison is made on a ring of pixels around the patch's own border and
 * the base pixels underneath that same ring — the two things that will end up
 * touching. Matching there rather than over the whole box is what makes this
 * safe: the middle of the patch is *supposed* to differ, since a new mouth is
 * the entire point, and averaging that in would drag the correction toward
 * whatever colour the new teeth happen to be.
 *
 * Only opaque patch pixels are counted, and the shift is skipped entirely when
 * too few of them exist to average honestly.
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

  let counted = 0;
  const drift = [0, 0, 0];

  for (let y = 0; y < box.height; y++) {
    const vertical = y < ring || y >= box.height - ring;
    for (let x = 0; x < box.width; x++) {
      if (!vertical && x >= ring && x < box.width - ring) continue;
      const i = (y * box.width + x) * 4;
      // A transparent patch pixel has no colour to compare, and a transparent
      // base pixel is outside the cut-out portrait entirely.
      if (patchData.data[i + 3] < 250 || baseData.data[i + 3] < 250) continue;
      drift[0] += patchData.data[i] - baseData.data[i];
      drift[1] += patchData.data[i + 1] - baseData.data[i + 1];
      drift[2] += patchData.data[i + 2] - baseData.data[i + 2];
      counted++;
    }
  }

  if (counted < 64) return patch;

  const shift = drift.map((total) => total / counted);
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
function feather(source: CanvasImageSource, box: Box, radius: number): HTMLCanvasElement {
  const ctx = context(box.width, box.height);
  ctx.drawImage(source, 0, 0, box.width, box.height);

  const { width, height } = box;
  const stencil = context(width, height);
  stencil.fillStyle = '#fff';
  stencil.fillRect(0, 0, width, height);

  // Each edge erased by a ramp running inward. Corners are crossed by two of
  // them and so fade a little faster, which is what a corner should do anyway.
  stencil.globalCompositeOperation = 'destination-out';
  const edges: [number, number, number, number, number, number, number, number][] = [
    [0, 0, radius, 0, 0, 0, radius, height], // left
    [width, 0, width - radius, 0, width - radius, 0, radius, height], // right
    [0, 0, 0, radius, 0, 0, width, radius], // top
    [0, height, 0, height - radius, 0, height - radius, width, radius], // bottom
  ];

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

/**
 * Bakes the fade into the patch, once, on the way into the kit.
 *
 * Feathering used to happen at assembly time, which was wrong in a way worth
 * recording: the preview composited on a canvas and the live face draws an
 * <image> in an SVG, so a fade applied only by the compositor would have shown
 * up in the filmstrip and not in the thing being previewed. A kit whose patches
 * carry their own alpha looks the same however it is drawn, which is the only
 * way "what plays here is the artwork" can be true.
 */
export async function featherPatch(patch: string, box: Box, radius = 10): Promise<string> {
  const image = await loadImage(patch);
  // A tenth of the shorter side, at most. The ramp now means what it says, so
  // this ceiling is about proportion rather than damage control: on a short box
  // a fixed ten pixels is a larger share of the artwork than it looks.
  const limit = Math.floor(Math.min(box.width, box.height) / 10);
  const applied = Math.max(0, Math.min(radius, limit));
  if (applied === 0) return patch;
  return feather(image, box, applied).toDataURL('image/png');
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
