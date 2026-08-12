/**
 * The image models this app will generate with, and the only ones it will.
 *
 * Same contract as realtime/models.ts, and for the same reason: the browser
 * sends a *key* and the Worker resolves it to a provider model id, so a caller
 * cannot name an arbitrary model and spend the account on it. Both sides import
 * this file, so the picker and the allowlist cannot drift apart.
 *
 * Deliberately free of imports: functions/ compiles against workers-types with
 * no DOM lib, so this has to stay pure data.
 */

export type ImageProvider = 'openai' | 'gemini';

export interface ImageModelChoice {
  /** What the client sends. Stable; the id underneath may change. */
  key: string;
  provider: ImageProvider;
  label: string;
  /** The provider's own model id. */
  id: string;
  /**
   * Whether the provider accepts a real mask and paints only inside it.
   *
   * This decides what the client sends, not how much the result is trusted.
   * Nothing here is trusted: every result is cropped to the slot's box and
   * composited onto the untouched base locally (see facekit/canvas.ts), because
   * a masked edit still re-encodes the whole frame and "outside the mask is
   * unchanged" is approximately true rather than exactly true. Approximately is
   * what boils at sixty frames a second.
   */
  masked: boolean;
  /**
   * USD per generated image at the size this page asks for. A snapshot of list
   * price, not a contract — see the note below.
   */
  usdPerImage: number;
  /**
   * Whether to ask the provider to hold on to the input's own detail.
   *
   * Per-model rather than per-provider, and not a guess: an unrecognised
   * parameter fails the whole request rather than being ignored, so this can
   * only be set on a model observed to accept it.
   */
  highFidelity?: boolean;
  /** Set when the id or the rate has NOT been confirmed against the provider. */
  unverified?: boolean;
}

/**
 * WHAT "UNVERIFIED" MEANS HERE
 *
 * Unchecked, not suspect — the same meaning realtime/models.ts gives it. No
 * entry carries the flag today: all four have returned an image from a real
 * call. Anything added later starts flagged, because an image endpoint rejects
 * an unknown model only at generation time and there is no earlier check.
 *
 * Clear the flag on an entry once you have seen it generate. Do not clear it
 * because it looks right. The rate stays a read-off-a-page figure either way —
 * clearing the flag records that the id works, not that the price is audited.
 *
 * Worth knowing when adding one: a rejected request bills nothing, so probing a
 * new id is free until the moment it succeeds.
 *
 * Rates below are per-image list prices for a single 1024x1024 generation, read
 * off each provider's pricing page. They exclude the input image's tokens,
 * which both providers bill separately and neither reports in a form worth
 * modelling here — so every figure this page shows is a floor, and it says so.
 */
export const IMAGE_RATES_READ_ON = '2026-08-11';

// First entry per provider is that provider's default.
export const IMAGE_MODELS: ImageModelChoice[] = [
  {
    key: 'openai-image',
    provider: 'openai',
    label: 'GPT Image 1',
    id: 'gpt-image-1',
    masked: true,
    usdPerImage: 0.07,
    // Confirmed the only way it can be: a real call came back with an image,
    // in about sixteen seconds, with input_fidelity accepted.
    highFidelity: true,
  },
  {
    key: 'openai-image-mini',
    provider: 'openai',
    label: 'GPT Image 1 Mini',
    id: 'gpt-image-1-mini',
    masked: true,
    usdPerImage: 0.02,
    // Confirmed by a call that returned an image, in about thirty-five seconds
    // — slower than the full model, oddly, so the saving here is money and not
    // time. Deliberately without highFidelity: this model rejects the parameter
    // with a 400, which is how the flag came to be per-model rather than
    // per-family. See the note on highFidelity above.
  },
  {
    key: 'gemini-image-pro',
    provider: 'gemini',
    label: 'Gemini 3 Pro Image (Nano Banana Pro)',
    id: 'gemini-3-pro-image-preview',
    masked: false,
    usdPerImage: 0.134,
    // Confirmed by a call that returned an image, in about forty-seven seconds:
    // the slowest of the four, and the most expensive.
  },
  {
    key: 'gemini-image-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Image (Nano Banana)',
    id: 'gemini-2.5-flash-image',
    masked: false,
    usdPerImage: 0.039,
    // Confirmed by a call that returned an image, in about eleven seconds.
  },
];

export function findImageModel(key: string): ImageModelChoice | undefined {
  return IMAGE_MODELS.find((model) => model.key === key);
}

export function defaultImageModelKey(provider: ImageProvider): string {
  const first = IMAGE_MODELS.find((model) => model.provider === provider);
  if (!first) throw new Error(`No image model for provider "${provider}"`);
  return first.key;
}

/**
 * The edge length every image in this page is worked at.
 *
 * Fixing it removes a whole class of alignment bugs. The source portrait is
 * normalised to this square on upload, every generation is asked for at this
 * size, and every box is expressed in these pixels — so a patch cropped from a
 * result lands exactly where it was cut from, with no rescaling step in which
 * a jaw can shift by three pixels.
 */
export const CANVAS_EDGE = 1024;
