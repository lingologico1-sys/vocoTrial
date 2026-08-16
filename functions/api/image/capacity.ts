import { findImageModel } from '../../../src/facekit/imageModels';
import { type GateEnv, json } from '../_middleware';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexKey } from '../_vertex';

/**
 * Whether a Gemini image model can serve anything right now, asked for nothing.
 *
 * The trick is the one live/regions.ts established and a burst confirmed: quota
 * is checked at admission, ahead of both the model lookup and the body, so a
 * deliberately invalid request comes back 429 when the pool is empty and 400
 * when it is not. Neither generates, so neither is billed — which is what makes
 * it reasonable to ask this repeatedly while a retry schedule runs.
 *
 * Measured, not assumed: during a real burst this returned 429 for
 * gemini-3-pro-image and 400 for gemini-2.5-flash-image in the same second, on
 * the same key and the same endpoint. That is also the evidence that the pools
 * are per-model rather than per-project.
 *
 * WHAT THIS IS NOT
 *
 * Not a prediction. It reports the pool at the instant it is asked, and a pool
 * that has room now can be empty by the time a real request lands a second
 * later. It earns its place only after a wait, where the alternative is
 * spending a slow, expensive call to learn the same thing — see postWithRetry
 * in facekit/generate.ts, which is the only caller and never asks before its
 * first attempt.
 *
 * Gemini only. The probe is a Vertex behaviour, and OpenAI's 429 means
 * something different enough that guessing at an equivalent would be worse than
 * not answering — so an OpenAI model is refused here rather than approximated,
 * and the client leaves its retry path alone.
 */

/** Invalid on purpose: routing and quota both answer before anyone reads it. */
const PROBE = JSON.stringify({ contents: [] });

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  const body = (await request.json().catch(() => null)) as { model?: unknown } | null;
  if (typeof body?.model !== 'string' || !body.model) {
    return json({ error: 'A model key is required', code: 'bad_model' }, 400);
  }

  const model = findImageModel(body.model);
  if (!model) {
    return json({ error: `Unknown model "${body.model}"`, code: 'bad_model' }, 400);
  }
  if (model.provider !== 'gemini') {
    return json({ error: 'Only Gemini models can be probed', code: 'unsupported' }, 400);
  }

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(vertexGenerateContentUrl(model.id), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: PROBE,
    });
  } catch (error) {
    // A probe that cannot be sent must not become a new way for a generation to
    // fail. The client treats a missing verdict as "go and find out properly".
    console.error('capacity probe threw', model.id, error);
    return json({ model: model.key, exhausted: null, code: 'unreachable' });
  }

  const detail = upstream.ok ? '' : await upstream.text();
  console.error('capacity probe', model.id, upstream.status, detail);

  let reason: string | undefined;
  try {
    const parsed = JSON.parse(detail) as { error?: { status?: string } } | { error?: { status?: string } }[];
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof first?.error?.status === 'string') reason = first.error.status;
  } catch {
    reason = undefined;
  }

  // 400 is the healthy answer — it means the request got far enough to be
  // judged on its contents. 429 is the pool. Anything else is a question this
  // probe was not built to answer, and is reported as such rather than guessed:
  // a 404 here would mean the id is not published, which is a different bug
  // entirely and one that waiting will never fix.
  const exhausted =
    upstream.status === 429 ? true : upstream.status === 400 ? false : null;

  return json({
    model: model.key,
    exhausted,
    status: upstream.status,
    reason: reason ?? null,
    // Nothing was generated, whatever the answer. Stated so a caller reading
    // this response cannot talk itself into thinking a check costs something.
    billed: false,
  });
}
