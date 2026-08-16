import type { GateEnv } from './_middleware';

/**
 * Where every Google call in this app now goes: Vertex AI, in express mode.
 *
 * Express mode is the surface that takes a plain API key in `x-goog-api-key`
 * (or `?key=` on the socket) and infers the project from the key, so nothing
 * here needs an OAuth exchange, a service-account JWT, or a project id in the
 * URL. That is what makes it usable from a Worker at all — a Pages Function has
 * no ambient Google credential and no cheap way to sign one.
 *
 * The keys are PanelForge's, in the next repo over: GEMINI_API_KEY with
 * GEMINI_API_KEY2 behind it, both bound to the same GCP project and billed
 * through Cloud Billing rather than AI Studio. Same codes, same meter — which
 * is the point of the move, and also the reason the old GOOGLE_API_KEY is gone
 * rather than kept as a fallback. An AI Studio key is not merely a worse key
 * here; it is refused by aiplatform.googleapis.com outright, and a silent
 * fallback onto one would turn a missing-secret mistake into a 403 from Google
 * that reads like a broken model id.
 */

export const VERTEX_HOST = 'aiplatform.googleapis.com';

/** Named in error messages, so a missing secret says which one to go and set. */
export const VERTEX_KEY_NAMES = 'GEMINI_API_KEY / GEMINI_API_KEY2';

/**
 * The Vertex key, primary then fallback — the same order PanelForge uses.
 *
 * The second key is a spare for when the first is exhausted or rotated, not a
 * second account: both are keys onto one project, so falling back changes which
 * credential is presented and nothing about what is billed.
 */
export function vertexKey(env: GateEnv): string | undefined {
  return env.GEMINI_API_KEY || env.GEMINI_API_KEY2;
}

/**
 * How Vertex names a model, and the one real difference from the old surface.
 *
 * On generativelanguage.googleapis.com a model is `models/<id>`. On Vertex it
 * is a publisher resource, and in express mode it carries no project or
 * location prefix — those are the key's to supply. The fully-qualified
 * `projects/…/locations/…/publishers/google/models/<id>` form belongs to the
 * OAuth surface and is rejected here.
 */
export function vertexModel(id: string): string {
  return `publishers/google/models/${id}`;
}

/** REST generateContent, the endpoint PanelForge has been generating on. */
export function vertexGenerateContentUrl(id: string): string {
  return `https://${VERTEX_HOST}/v1/publishers/google/models/${encodeURIComponent(id)}:generateContent`;
}

/**
 * The region this key's models live in.
 *
 * Express mode infers it rather than taking it in a URL, and says so when it
 * refuses: a bad model id comes back naming
 * `projects/…/locations/us-central1/publishers/…`. It is a constant here only
 * because the Live socket has to name it (see below); REST never does.
 */
export const VERTEX_LOCATION = 'us-central1';

/**
 * The Live socket, on Vertex's bidi service rather than Google AI's.
 *
 * https, not wss, for the reason live/gemini.ts sets out at length: a Worker
 * opens an outbound socket by fetching with an Upgrade header, and the Fetch
 * API refuses any scheme but http(s).
 *
 * REGIONAL, unlike everything else here, and that is the whole trick. The
 * global host serves REST generateContent perfectly well but has no bidi
 * service behind it, and it does not say so — it closes the socket with 1007
 * "Invalid resource field value in the request" for a `publishers/…` model, or
 * 1008 "Publisher model … was not found" for a fully-qualified one. Both read
 * as "your model id is wrong" and neither is: the same frames reach
 * `setupComplete` against us-central1-aiplatform.googleapis.com, on v1 and
 * v1beta1 alike and with either spelling of the model path.
 *
 * Verified by a real handshake, which is the only thing that verifies a Live
 * endpoint. If it ever stops, check the region before the model id.
 */
export const VERTEX_LIVE_URL =
  `https://${VERTEX_LOCATION}-${VERTEX_HOST}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
