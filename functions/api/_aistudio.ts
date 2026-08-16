import type { GateEnv } from './_middleware';

/**
 * Google's other API: AI Studio, on generativelanguage.googleapis.com.
 *
 * Everything here was the whole of this app's Google integration until the move
 * to Vertex, and it came back for one reason — 3.1 Flash Live is published here
 * and nowhere else. See the Surface type in src/realtime/models.ts: a model is
 * reachable on the surface that carries it, so this is not a fallback for when
 * Vertex fails and must never be used as one. A Vertex model that errors is a
 * Vertex problem; retrying it here would spend a different account's money on a
 * model this catalogue may not even have.
 *
 * Billed to the AI Studio account rather than the GCP project, on GOOGLE_API_KEY
 * — an ordinary API key, and the one credential in this repo that is *not*
 * service-account-bound. That is not an oversight: AI Studio has no notion of
 * one, which is exactly why Vertex refuses these keys.
 */

export const AISTUDIO_KEY_NAME = 'GOOGLE_API_KEY';

export function aiStudioKey(env: GateEnv): string | undefined {
  return env.GOOGLE_API_KEY;
}

/**
 * How AI Studio names a model: `models/<id>`, with no publisher and no project.
 *
 * Shorter than Vertex's `publishers/google/models/<id>` and not interchangeable
 * with it — each surface rejects the other's spelling, which is one of the ways
 * a mis-routed model announces itself.
 */
export function aiStudioModel(id: string): string {
  return `models/${id}`;
}

/**
 * The Live socket. https rather than wss for the reason live/gemini.ts gives:
 * a Worker opens an outbound socket by fetching with an Upgrade header, and the
 * Fetch API refuses any other scheme.
 *
 * Global, unlike Vertex's bidi service, which is regional. v1alpha rather than
 * v1beta — this is the path that reached setupComplete twelve times out of
 * twelve before the move, and the one 3.1 Flash Live answers on.
 */
export const AISTUDIO_LIVE_URL =
  'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
