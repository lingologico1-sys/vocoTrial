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
  /**
   * A word for a button, where the full label will not fit.
   *
   * Named per model rather than per provider because the two comparison slots
   * can now hold two models from the same provider — Pro against Flash is the
   * comparison worth making once one provider has won outright, and "gemini"
   * twice tells you nothing about which button you are pressing.
   */
  short: string;
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
 * Unchecked, not suspect — the same meaning realtime/models.ts gives it. Nothing
 * here is flagged today: both Gemini ids were re-confirmed against Vertex after
 * the move, and both OpenAI ids were never affected by it. A model id belongs to
 * a surface, so a flag goes back on any entry whose surface changes — "it
 * returned an image on AI Studio" says nothing about whether Vertex publishes
 * that id. Anything added later starts flagged, because an image endpoint
 * rejects an unknown model only at generation time and there is no earlier check.
 *
 * Clear the flag on an entry once you have seen it generate. Do not clear it
 * because it looks right. The rate stays a read-off-a-page figure either way —
 * clearing the flag records that the id works, not that the price is audited.
 *
 * Worth knowing when adding one: a rejected request bills nothing, so probing a
 * new id is free until the moment it succeeds.
 *
 * WHICH ONE TO REACH FOR
 *
 * On an illustrated portrait, Gemini beat OpenAI on every slot of a full kit
 * generated from the same prompts — closer lip colour, cleaner cel shading, and
 * eyelids that kept their lashes, which no amount of prompting got out of
 * gpt-image-1. OpenAI's poses came back flatter and more photographic.
 *
 * The counterweight is reliability rather than quality, and the reason is quota
 * rather than taste — and the quota is now GCP's rather than AI Studio's, so
 * the shape of the bursts described below may change. Vertex meters image
 * generation per-minute against a project-wide shared pool, which punishes
 * bursts specifically; PanelForge paces its batches for exactly that reason.
 * Gemini fails in bursts — a run can lose half its slots and
 * the same slots go through untouched an hour later — and once the error
 * carried a stated reason, the bursts turned out to be RESOURCE_EXHAUSTED
 * rather than the model declining the picture. Worth knowing, because it points
 * somewhere quite different: waiting or changing model helps, rewording does
 * not, and a burst says nothing whatever about the prompt.
 *
 * Pro exhausts far sooner than Flash, which is the practical argument for
 * Flash beyond its being a third of the price.
 *
 * Rejected requests are not billed, which is what makes waiting it out cheap.
 * The error carries the provider's own stated reason; read it before assuming
 * anything.
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
    short: 'gpt',
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
    short: 'gpt mini',
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
    short: 'pro',
    id: 'gemini-3-pro-image',
    masked: false,
    usdPerImage: 0.134,
    // Confirmed on Vertex: /api/live/models probed generateContent and it
    // generated. The preview endpoint was the leading suspect for why Pro
    // exhausted so much sooner than Flash — same model, thinner capacity — so
    // watch whether that survived the move to the GA id and GCP quota.
    //
    // Partly answered, and not in favour of the preview theory: this model is
    // published on Vertex's *global* endpoint and on no regional host at all
    // (404 on eleven, us-central1 included), while Flash is served by seven of
    // them. One pool and no fallback is a better explanation for exhausting
    // first than anything about the id. It also means Pro cannot be moved off a
    // busy region, because it is not in one — see the warning in _vertex.ts
    // before adding a region to the generating path.
    //
    // What the preview id did, for comparison once this one has run: returned an
    // image in about forty-seven seconds, the slowest of the four and the most
    // expensive.
  },
  {
    key: 'gemini-image-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Image (Nano Banana)',
    short: 'flash',
    id: 'gemini-2.5-flash-image',
    masked: false,
    usdPerImage: 0.039,
    // Confirmed twice over: an image in about eleven seconds on AI Studio, and
    // a generateContent probe on Vertex after the move. Worth knowing that
    // PanelForge's own Flash entry names a different model on this same project
    // (gemini-3.1-flash-image), which also exists here — a candidate to add if
    // this rig ever wants a third Gemini image model to compare.
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
