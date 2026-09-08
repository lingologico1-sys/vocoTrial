import type { GateEnv } from './_middleware';
import { accessToken, parseServiceAccount, type ServiceAccount } from './_google-auth';

/**
 * Where every Google call in this app goes: Vertex AI, on a service account.
 *
 * THIS USED TO BE EXPRESS MODE, and the difference is worth knowing because the
 * error messages do not explain themselves. Express mode took a plain API key in
 * `x-goog-api-key`, inferred the project from the key, and named a model as a
 * bare `publishers/google/models/<id>` with no project and no location. It was
 * chosen because a Worker has no ambient Google credential and signing one
 * looked expensive.
 *
 * It turned out not to be: _google-auth.ts mints an OAuth token from a
 * service-account key in WebCrypto, with no dependency and no Node. So the app
 * now presents `Authorization: Bearer` and names models in full —
 * `projects/<id>/locations/<loc>/publishers/google/models/<id>`. Both halves had
 * to change together; each surface rejects the other's pairing.
 *
 * WHY BOTHER. Three service accounts in three separate GCP projects, rather than
 * two API keys onto one. Quota on these models is per project, so the pool is
 * three times the headroom and a billing problem on one project leaves the other
 * two answering. The express keys could never be that: both named the same
 * project, so falling back changed which credential was presented and nothing
 * about what was billed.
 *
 * VERIFIED BY A REAL HANDSHAKE, which is the only thing that verifies a Live
 * endpoint — `npm run vertex:sa -- --live` mints a token, proves it on REST
 * against a model id that cannot exist, and then opens the bidi socket and waits
 * for `setupComplete`. Run it before believing anything here.
 */

export const VERTEX_HOST = 'aiplatform.googleapis.com';

/** Named in error messages, so a missing secret says which one to go and set. */
export const VERTEX_CRED_NAMES = 'GEMINI_JSON01 / GEMINI_JSON02 / GEMINI_JSON03';

/** How many GEMINI_JSON<n> secrets are looked for. Cheap to raise. */
const POOL_SIZE = 5;

/**
 * The host for a region, or the global one when no region is named.
 *
 * Both forms exist because Vertex serves the same API from a global endpoint and
 * from a per-region one, and they differ in what they decide rather than in what
 * they accept. Worth having as a lever rather than a constant because quota for
 * these models is metered per region. When a burst of RESOURCE_EXHAUSTED is
 * regional contention it clears by asking a different region; when it is a cap
 * on the project it does not, and asking is how you find out which.
 *
 * DO NOT PIN A REGION ON THE GENERATING PATH WITHOUT READING THIS.
 *
 * The two are not interchangeable, and the sweep that established it is in the
 * README. `gemini-3-pro-image` is published on the *global* endpoint only — it
 * 404s on all eleven regional hosts probed, us-central1 included, which is the
 * very region the global endpoint names in its own error text. Global is a
 * routing layer, not an alias for a region.
 *
 * So a region is safe to pass for Flash, which seven regions serve, and takes
 * Pro out entirely. The failure would arrive as a 404 that reads exactly like a
 * wrong model id — the same confusion the note on VERTEX_LIVE_URL describes.
 */
export function vertexHost(region?: string): string {
  return region ? `${region}-${VERTEX_HOST}` : VERTEX_HOST;
}

/**
 * The region the Live socket is served from, and the location named in its model
 * path. REST does not use it — see the `global` default in `url()` below.
 */
export const VERTEX_LOCATION = 'us-central1';

/**
 * The Live socket, on Vertex's bidi service rather than Google AI's.
 *
 * https, not wss, for the reason live/gemini.ts sets out at length: a Worker
 * opens an outbound socket by fetching with an Upgrade header, and the Fetch API
 * refuses any scheme but http(s). That is also what lets the token ride in a
 * header at all — a browser's WebSocket cannot set one, and this is not a
 * browser.
 *
 * REGIONAL, unlike REST, and that is the whole trick. The global host serves
 * generateContent perfectly well but has no bidi service behind it, and it does
 * not say so — it closes the socket with 1007 "Invalid resource field value in
 * the request", or 1008 "Publisher model … was not found". Both read as "your
 * model id is wrong" and neither is.
 *
 * Unchanged by the move off express mode: this URL never carried a credential or
 * a project. What changed is the model path in the setup frame, which is now
 * fully qualified — see `model()` below. Confirmed against a service account by
 * a real handshake on 2026-09-08; if it ever stops, check the region and the
 * model path before the model id.
 */
export const VERTEX_LIVE_URL =
  `https://${vertexHost(VERTEX_LOCATION)}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;

/** One authenticated credential, and every way this app needs to spend it. */
export interface VertexAuth {
  /** `Authorization: Bearer …`, ready to spread into a fetch's headers. */
  headers: Record<string, string>;
  /**
   * The bare token, for scrubbing it back out of anything about to be logged.
   * Exposed only for that — build requests from `headers`, so there is one place
   * the credential is spelled.
   */
  token: string;
  /** The account this token belongs to. For logs — never for the client. */
  account: string;
  /** The GCP project the model paths below name. */
  projectId: string;
  /** A fully-qualified model path, for a setup frame or a URL. */
  model(id: string, location?: string): string;
  /** The generateContent endpoint for a model. */
  url(id: string, region?: string): string;
}

/** Every service-account secret present, in name order. */
function credentials(env: GateEnv): ServiceAccount[] {
  const found: ServiceAccount[] = [];
  for (let i = 1; i <= POOL_SIZE; i++) {
    const name = `GEMINI_JSON${String(i).padStart(2, '0')}` as keyof GateEnv;
    const parsed = parseServiceAccount(env[name] as string | undefined);
    if (parsed) found.push(parsed);
  }
  return found;
}

function build(sa: ServiceAccount, token: string): VertexAuth {
  const projectId = sa.project_id as string;
  const model = (id: string, location = 'global') =>
    `projects/${projectId}/locations/${location}/publishers/google/models/${id}`;

  return {
    headers: { Authorization: `Bearer ${token}` },
    token,
    account: sa.client_email as string,
    projectId,
    model,
    /*
     * `global` rather than a region, matching what the global host is for and
     * what PanelForge generates on. Express mode inferred us-central1 from the
     * key; there is no inference left to do, so the location has to be named —
     * and naming a region here would take `gemini-3-pro-image` out entirely,
     * per the note on vertexHost above. A caller that wants a region passes one,
     * and then it is named in both the host and the path, which is the only
     * combination the API accepts.
     */
    url: (id: string, region?: string) =>
      `https://${vertexHost(region)}/v1/${model(id, region ?? 'global')}:generateContent`,
  };
}

/**
 * A usable credential from the pool, or null when none is configured.
 *
 * STARTS SOMEWHERE RANDOM, ON PURPOSE. Quota is per project and the accounts sit
 * in three of them, so spreading requests across the pool is most of what the
 * pool is for — always starting at GEMINI_JSON01 would put every request on one
 * project's quota and keep the other two as cold spares.
 *
 * A credential that cannot mint a token is skipped and the next tried, so a
 * revoked key or a disabled account costs one wasted exchange rather than an
 * outage. What this deliberately does NOT do is retry after the *model* call
 * fails: a 429 from Google still reaches the caller as a 429. Spreading the load
 * makes that rarer, not impossible, and a real retry would have to live at all
 * nine call sites. Worth adding if quota errors show up in the logs — they have
 * somewhere to go now, which they did not when both keys named one project.
 *
 * Returns null only when nothing is configured at all. That is the one case
 * callers report as `no_key`, because it is the one a person fixes by setting a
 * secret.
 */
export async function vertexAuth(env: GateEnv): Promise<VertexAuth | null> {
  const pool = credentials(env);
  if (pool.length === 0) return null;

  const start = Math.floor(Math.random() * pool.length);
  let lastError: unknown = null;

  for (let n = 0; n < pool.length; n++) {
    const sa = pool[(start + n) % pool.length];
    try {
      return build(sa, await accessToken(sa));
    } catch (error) {
      lastError = error;
      console.error('vertex credential unusable', sa.client_email, error);
    }
  }

  // Every account is present but none would mint. Not `no_key` — the secrets
  // exist — so it is thrown rather than returned, and reaches the caller's
  // existing upstream-failure handling.
  throw new Error(
    `No Vertex credential could mint a token (${pool.length} tried): ${String(lastError)}`,
  );
}
