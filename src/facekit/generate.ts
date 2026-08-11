import { cropToBox, featherPatch, matchTone, maskFor, normalise } from './canvas';
import { findImageModel } from './imageModels';
import type { Box } from './kit';
import { PREAMBLE } from './slots';

/**
 * One round trip: ask a provider for an edit, come back with a patch.
 *
 * The sequencing here is the whole method, so it is worth naming the steps
 * rather than leaving them as four awaits. Ask for a full frame; normalise it
 * onto the standard square; cut out only the box that was asked about; pull its
 * colour onto the base's. What comes back is a rectangle, never a portrait —
 * the portrait on screen is still the one that was uploaded.
 */

export interface Generated {
  /** The patch, cropped to `box` and tone-matched. A PNG data URL. */
  patch: string;
  /** The provider's whole frame, kept only so the page can show its working. */
  full: string;
  usd: number;
}

interface GenerateArgs {
  modelKey: string;
  base: string;
  box: Box;
  /** The slot's instruction. The shared preamble is added here, not by callers. */
  instruction: string;
  signal?: AbortSignal;
}

async function post(body: unknown, signal?: AbortSignal): Promise<{ image: string; usd: number }> {
  const response = await fetch('/api/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await response.json().catch(() => null)) as {
    image?: string;
    usd?: number;
    error?: string;
  } | null;

  if (!response.ok || !payload?.image) {
    throw new Error(payload?.error ?? `The image request failed (${response.status})`);
  }

  return { image: `data:image/png;base64,${payload.image}`, usd: payload.usd ?? 0 };
}

export async function generatePatch({
  modelKey,
  base,
  box,
  instruction,
  signal,
}: GenerateArgs): Promise<Generated> {
  const model = findImageModel(modelKey);
  if (!model) throw new Error(`Unknown image model "${modelKey}"`);

  const { image, usd } = await post(
    {
      model: modelKey,
      prompt: `${PREAMBLE} ${instruction}`,
      image: base,
      // Sent only where it means something. A provider steered by prompt alone
      // is not handicapped by its absence, because the crop is what actually
      // protects the rest of the face either way.
      mask: model.masked ? maskFor(box) : undefined,
    },
    signal,
  );

  // Crop, then match the seam, then fade it. The order matters: matching before
  // fading measures the real border pixels rather than ones already blended
  // toward transparency, and fading last means the alpha survives into the kit.
  const cropped = await cropToBox(image, box);
  const matched = await matchTone(cropped, base, box);
  return { patch: await featherPatch(matched, box), full: await normalise(image), usd };
}

/**
 * Replaces the base itself rather than producing a patch.
 *
 * The one generation that is allowed to change the whole frame, because its job
 * is to give every later patch something sane to sit on: a closed, neutral
 * mouth. Everything downstream treats whatever this returns as the original.
 */
export async function generateBase(
  modelKey: string,
  base: string,
  instruction: string,
  box: Box,
  signal?: AbortSignal,
): Promise<{ base: string; usd: number }> {
  const model = findImageModel(modelKey);
  if (!model) throw new Error(`Unknown image model "${modelKey}"`);

  const { image, usd } = await post(
    {
      model: modelKey,
      prompt: `${PREAMBLE} ${instruction}`,
      image: base,
      mask: model.masked ? maskFor(box) : undefined,
    },
    signal,
  );

  return { base: await normalise(image), usd };
}
