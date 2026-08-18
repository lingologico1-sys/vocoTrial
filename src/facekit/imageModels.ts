/**
 * The image models this app will generate with, and the only ones it will.
 *
 * Same contract as realtime/models.ts, and for the same reason: the browser
 * sends a *key* and the Worker resolves it to a provider model id, so a caller
 * cannot name an arbitrary model and spend the account on it. Both sides import
 * this file, so the picker and the allowlist cannot drift apart.
 *
 * Every model here is Gemini, on Vertex, and there is no `provider` field any
 * more — see the note at the foot of this file for what went and why. What that
 * removed along with it is the mask: no model on this list takes one, so the
 * prompt carries the whole of "and change nothing else" (see PREAMBLE in
 * slots.ts) and the crop carries the rest.
 *
 * The crop is not a stand-in for the missing mask. It would be here either way:
 * a masked edit still re-encodes the whole frame, so "outside the mask is
 * unchanged" is approximately true rather than exactly true, and approximately
 * is what boils at sixty frames a second. Nothing a provider returns is trusted
 * whole — every result is cropped to the slot's box and composited onto the
 * untouched base locally. See facekit/canvas.ts.
 *
 * Deliberately free of imports: functions/ compiles against workers-types with
 * no DOM lib, so this has to stay pure data.
 */

export interface ImageModelChoice {
  /** What the client sends. Stable; the id underneath may change. */
  key: string;
  label: string;
  /**
   * A word for a button, where the full label will not fit.
   *
   * Named per model rather than per family, because the two comparison slots
   * hold two Gemini models now that Gemini is the only family here — Pro
   * against Flash is the comparison left worth making, and "gemini" twice tells
   * you nothing about which button you are pressing.
   */
  short: string;
  /** The provider's own model id. */
  id: string;
  /**
   * USD per generated image at the size this page asks for. A snapshot of list
   * price, not a contract — see the note below.
   */
  usdPerImage: number;
  /** Set when the id or the rate has NOT been confirmed against the provider. */
  unverified?: boolean;
}

/**
 * WHAT "UNVERIFIED" MEANS HERE
 *
 * Unchecked, not suspect — the same meaning realtime/models.ts gives it. Nothing
 * here is flagged today: the id was re-confirmed against Vertex after the move.
 * A model id belongs to a surface, so a flag goes back on any entry whose
 * surface changes — "it returned an image on AI Studio" says nothing about
 * whether Vertex publishes that id. Anything added later starts flagged, because
 * an image endpoint rejects an unknown model only at generation time and there
 * is no earlier check.
 *
 * Clear the flag on an entry once you have seen it generate. Do not clear it
 * because it looks right. The rate stays a read-off-a-page figure either way —
 * clearing the flag records that the id works, not that the price is audited.
 *
 * Worth knowing when adding one: a rejected request bills nothing, so probing a
 * new id is free until the moment it succeeds.
 *
 * WHAT GOES WRONG, AND WHAT IT IS NOT
 *
 * Not quality — quality is why this list is one model long. Reliability, and
 * the cause is quota rather than taste. Vertex meters image generation
 * per-minute against a project-wide shared pool, which punishes bursts
 * specifically; PanelForge paces its batches for exactly that reason. Gemini
 * fails in bursts — a run can lose half its slots and the same slots go through
 * untouched an hour later — and once the error carried a stated reason, the
 * bursts turned out to be RESOURCE_EXHAUSTED rather than the model declining
 * the picture. Worth knowing, because it points somewhere quite different:
 * waiting helps, rewording does not, and a burst says nothing whatever about
 * the prompt.
 *
 * Waiting is now the whole of that advice, where it used to be "wait, or use
 * the other model". There is no other model to move to. That is the standing
 * cost of a one-model list, and it is better read here than discovered halfway
 * through a burst. Rejected requests are not billed, which is what makes
 * waiting it out cheap. The error carries the provider's own stated reason;
 * read it before assuming anything.
 *
 * Rates below are per-image list prices for a single 1024x1024 generation, read
 * off the pricing page. They exclude the input image's tokens, which are billed
 * separately and not reported in a form worth modelling here — so every figure
 * this page shows is a floor, and it says so.
 */
export const IMAGE_RATES_READ_ON = '2026-08-11';

export const IMAGE_MODELS: ImageModelChoice[] = [
  {
    key: 'gemini-image-pro',
    label: 'Gemini 3 Pro Image (Nano Banana Pro)',
    short: 'pro',
    id: 'gemini-3-pro-image',
    usdPerImage: 0.134,
    // Confirmed on Vertex: /api/live/models probed generateContent and it
    // generated. The preview endpoint was the leading suspect for why Pro
    // exhausted so much sooner than Flash — same model, thinner capacity — so
    // watch whether that survived the move to the GA id and GCP quota.
    //
    // Partly answered, and not in favour of the preview theory: this model is
    // published on Vertex's *global* endpoint and on no regional host at all
    // (404 on eleven, us-central1 included), while Flash was served by seven of
    // them. One pool and no fallback is a better explanation for exhausting
    // first than anything about the id. It also means Pro cannot be moved off a
    // busy region, because it is not in one — see the warning in _vertex.ts
    // before adding a region to the generating path.
  },
];

/**
 * The model the neutralising pass runs on, and the only one it will.
 *
 * Pinned rather than taken from the picker, because the base pass is not one
 * generation among ten — it is the one every other generation then sits on. It
 * redraws the whole frame, every later patch is cropped from it and clipped to
 * its alpha, and a base that came back subtly off-model takes the kit with it
 * in a way that only shows up slots later. That is worth the most capable model
 * on the list every time, at a price paid once per kit rather than once per
 * slot.
 *
 * A named key rather than "whatever is first", because the day a cheaper Flash
 * lands back on this list (see the foot of this file) is exactly the day the
 * distinction starts to matter, and a rule that quietly stops holding is worse
 * than no rule. Enforced in generateBase() rather than at the route: the Worker
 * cannot tell a base pass from a patch — both arrive as a prompt and a picture
 * — and this is a judgement about which model to spend on, not a gate against a
 * caller.
 */
export const NEUTRALISE_MODEL_KEY = 'gemini-image-pro';

/*
 * WHAT USED TO BE HERE
 *
 * GPT Image 1 and GPT Image 1 Mini, and with them a whole `provider` axis: an
 * OpenAI branch in the route, a multipart request, an `input_fidelity`
 * parameter, a real mask painted by canvas.ts, and a second API key. All gone.
 * `git log` is the reference if any of it comes back.
 *
 * The reason is that it lost, and had lost for some time. On an illustrated
 * portrait Gemini beat OpenAI on every slot of a full kit generated from the
 * same prompts — closer lip colour, cleaner cel shading, and eyelids that kept
 * their lashes, which no amount of prompting got out of gpt-image-1. OpenAI's
 * poses came back flatter and more photographic. It stayed on the list after
 * that as the second half of an A/B and as somewhere to go during a Gemini
 * quota burst, which is a real use and still not enough: a fallback whose
 * output nobody would keep is a slow way to spend money on a slot that gets
 * rejected anyway.
 *
 * Gemini 2.5 Flash Image (gemini-2.5-flash-image, $0.039) went earlier, and for
 * a reason the price list could not have shown: it could not draw teeth. Not
 * once in a run of attempts across the poses that show any — it returned a full
 * grin where the prompt asked for a strip, or a scalloped row of separate teeth
 * where TEETH_BAND asks in four clauses for one unbroken white shape. Which is
 * a fair summary of what it was cheap for: it reads the sentence about the
 * mouth and not the four sentences constraining how the mouth is drawn, and the
 * whole of this page's method is those four sentences.
 *
 * So the comparison this page runs is currently no comparison at all — one
 * model, named in both slots, offering one button. The A/B machinery is kept
 * because the open question is still which *Gemini* to spend on, and answering
 * it needs two slots the moment there is a second model to put in one. If a
 * third Gemini image model is ever wanted, gemini-3.1-flash-image exists on
 * this same project — PanelForge's Flash entry names it — and is a different
 * model from the one removed here. It has not been tried against these prompts.
 */

export function findImageModel(key: string): ImageModelChoice | undefined {
  return IMAGE_MODELS.find((model) => model.key === key);
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
