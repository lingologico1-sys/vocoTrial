import { IMAGE_MODELS, findImageModel, type ImageModelChoice } from '../../../src/facekit/imageModels';
import { type GateEnv, json } from '../_middleware';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexKey } from '../_vertex';

/**
 * Generates one face-kit patch, on whichever model was asked for.
 *
 * Unlike the realtime routes, this one carries the payload rather than minting
 * a credential and stepping out of the way. That is the right trade here: image
 * generation is request/response on a timescale of seconds, so proxying costs
 * nothing a user can feel, and it keeps the key server-side by construction —
 * the same property functions/api/session/* exists to preserve.
 *
 * One shape now, where there were two. Gemini takes JSON with the image inline
 * and no mask at all, and is steered by the prompt alone; it runs on Vertex AI
 * rather than AI Studio, which changes the URL, the key and the meter but not
 * the payload — see _vertex.ts. The OpenAI branch that used to sit beside it
 * took multipart with a real mask and painted inside it, and is gone along with
 * the models that used it; see the foot of facekit/imageModels.ts.
 *
 * The absent mask reaches the browser as nothing at all, because no result is
 * trusted whole either way: the client crops every result to the slot's box and
 * composites it onto the untouched base itself. See facekit/canvas.ts for why
 * that is not belt-and-braces but the actual mechanism.
 */

/**
 * A ceiling on what the browser may push through here, in base64 characters.
 *
 * The page normalises every portrait to a 1024px square before sending, which
 * lands far under this. The limit is not for that path — it is so a mistake, or
 * a tab left open on a 40-megapixel drop, fails at the edge with a message
 * rather than as an opaque platform error partway through an upstream call.
 */
const MAX_IMAGE_CHARS = 12_000_000;

interface GenerateBody {
  model?: unknown;
  prompt?: unknown;
  image?: unknown;
  imageFirst?: unknown;
}

/** Strips the `data:image/png;base64,` prefix a canvas export carries. */
function rawBase64(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value;
}

type Attempt =
  | { ok: true; image: string; cached?: number }
  | { ok: false; status: number; detail: string; reason?: string; retryAfterMs?: number };

/**
 * The provider's own words for why it declined, and nothing else.
 *
 * The rule everywhere else here is that an upstream error body goes to the log
 * and never to the browser, because an error can quote the request back and the
 * request was signed with the account's key. That rule stays. What comes back
 * through this is a short allowlist of *classifications* the provider produced —
 * a finishReason enum, a block reason, an error code, or the prose the model
 * replied with instead of an image. None of those is our request echoed.
 *
 * Worth the care because the alternative was on display: an opaque 502 for both
 * "the model declined this picture" and "the request was malformed" sends you
 * hunting for a bug in the wrong half of the system.
 */
const REASON_LIMIT = 300;

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}…` : text;
}

/**
 * When the provider says to come back, in milliseconds.
 *
 * Worth carrying through rather than guessing at, because the guess is the part
 * of the retry that is hardest to get right: the client's quota schedule waits
 * seventy seconds because that is the shortest window a provider is likely to
 * meter against, not because anything told it so. A stated delay replaces an
 * assumption with a fact, and usually a shorter one.
 *
 * Two sources, both optional and neither reliable. Google puts a RetryInfo in
 * the error's `details` — a protobuf duration, so "27s" or "1.5s" rather than a
 * number. Both providers may also send a Retry-After header. Whatever turns up
 * first is used; when neither does, the caller keeps its own schedule.
 */
function durationMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const seconds = Number(value.endsWith('s') ? value.slice(0, -1) : value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

function retryAfterHeader(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  // The header's other legal form is an HTTP date.
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function googleRetryDelayMs(body: unknown): number | undefined {
  const error = (Array.isArray(body) ? body[0] : body) as
    | { error?: { details?: { '@type'?: string; retryDelay?: string }[] } }
    | undefined;
  const info = error?.error?.details?.find((entry) =>
    entry?.['@type']?.endsWith('google.rpc.RetryInfo'),
  );
  return durationMs(info?.retryDelay);
}

/**
 * Gemini's image edit: the picture and the instruction as two parts of one turn.
 *
 * There is no mask to send, so the prompt is carrying the whole burden of "and
 * change nothing else" — see PREAMBLE in facekit/slots.ts. It does not fully
 * succeed, which is expected and does not matter, because only the pixels
 * inside the slot's box survive the trip back.
 */
async function generateGemini(
  model: ImageModelChoice,
  key: string,
  prompt: string,
  image: string,
  imageFirst: boolean,
): Promise<Attempt> {
  /*
   * WHICH PART GOES FIRST, and why it is a switch rather than a decision.
   *
   * Implicit caching keys on a matching prefix, and the base image is the one
   * thing every generation on a kit sends identically — nine slots, one
   * portrait, a different instruction each time. Image first makes that
   * portrait a shared prefix and the instruction the only thing that varies,
   * which is the arrangement where a cache can help; text first, as this route
   * has always sent, puts the varying part in front and forecloses it.
   *
   * Not simply switched over, because these prompts are tuned and this reorders
   * the turn they are read in. The page can send it both ways and put the two
   * results side by side, which is the only argument this repo accepts about a
   * generated picture. See `imageFirst` in FaceKit.tsx.
   */
  const parts = imageFirst
    ? [{ inline_data: { mime_type: 'image/png', data: image } }, { text: prompt }]
    : [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: image } }];

  const upstream = await fetch(
    vertexGenerateContentUrl(model.id),
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  );

  if (!upstream.ok) {
    const detail = await upstream.text();
    let reason: string | undefined;
    let stated: number | undefined;
    try {
      // Vertex sometimes wraps the error in a one-element array where AI Studio
      // returned a bare object. Unwrapping it is what keeps RESOURCE_EXHAUSTED
      // legible below rather than collapsing into "could not produce that image".
      const parsed = JSON.parse(detail) as
        | { error?: { status?: string } }
        | { error?: { status?: string } }[];
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      reason = trimmed(first?.error?.status);
      stated = googleRetryDelayMs(parsed);
    } catch {
      reason = undefined;
    }
    return {
      ok: false,
      status: upstream.status,
      detail,
      reason,
      retryAfterMs: stated ?? retryAfterHeader(upstream),
    };
  }

  const body = (await upstream.json()) as {
    promptFeedback?: { blockReason?: string };
    /** Reported so the ordering above can be judged on evidence, not on theory. */
    usageMetadata?: { cachedContentTokenCount?: number };
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string; inlineData?: { data?: string } }[] };
    }[];
  };

  const candidate = body.candidates?.[0];
  const part = candidate?.content?.parts?.find((entry) => entry.inlineData?.data);

  if (!part?.inlineData?.data) {
    // A refusal on this API is a 200 with prose in it, or with a finishReason
    // and no parts at all. Both are indistinguishable from a bug unless the
    // classification is carried out, which is what these three fields are for.
    const spoken = candidate?.content?.parts?.find((entry) => entry.text)?.text;
    const reason =
      trimmed(body.promptFeedback?.blockReason) ??
      trimmed(candidate?.finishReason) ??
      trimmed(spoken) ??
      'no image and no stated reason';
    return { ok: false, status: 502, detail: JSON.stringify(body).slice(0, 2000), reason };
  }

  return {
    ok: true,
    image: part.inlineData.data,
    cached: body.usageMetadata?.cachedContentTokenCount ?? 0,
  };
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  let body: GenerateBody | null = null;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return json({ error: 'Malformed request', code: 'bad_body' }, 400);
  }

  if (typeof body?.model !== 'string' || !body.model) {
    return json({ error: 'A model key is required', code: 'bad_model' }, 400);
  }
  const model = findImageModel(body.model);
  if (!model) {
    return json({ error: `Unknown model "${body.model}"`, code: 'bad_model' }, 400);
  }

  // Free text on purpose, and for the same reason instructions are on the
  // realtime routes: this rig exists to compare what different wordings
  // produce, and a server-owned prompt would defeat the page's whole point.
  // The password gate is what keeps strangers off the account.
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return json({ error: 'A prompt is required', code: 'bad_prompt' }, 400);
  }

  if (typeof body.image !== 'string' || !body.image) {
    return json({ error: 'A source image is required', code: 'bad_image' }, 400);
  }
  if (body.image.length > MAX_IMAGE_CHARS) {
    return json({ error: 'That image is too large to send', code: 'image_too_large' }, 413);
  }

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  const image = rawBase64(body.image);
  const prompt = body.prompt.trim();

  let attempt: Attempt;
  try {
    attempt = await generateGemini(model, key, prompt, image, body.imageFirst === true);
  } catch (error) {
    console.error('image generate threw', model.id, error);
    return json({ error: 'The image request failed', code: 'upstream' }, 502);
  }

  if (!attempt.ok) {
    // Body to the log only — it can quote the request back, and the request was
    // authenticated with the account's own key. The provider's own short
    // classification travels with the error instead; see the note on Attempt.
    console.error('image generate failed', model.id, attempt.status, attempt.detail);
    const reason = attempt.reason;
    // "Declined: RESOURCE_EXHAUSTED" reads as a judgement about the picture. It
    // is not one — it is the account having nothing left for the moment, which
    // wants entirely different advice from a refusal.
    const exhausted = reason === 'RESOURCE_EXHAUSTED';
    // Named only if there is one. Every model on the list has its own pool, so
    // pointing at another is genuinely useful advice — but the list is one
    // model long today, and inviting someone to "try the other model" when
    // there is no other model sends them looking for a button that is not
    // there. Then the only honest advice left is to wait, which is also the
    // advice that works. See imageModels.ts.
    const other = IMAGE_MODELS.find((entry) => entry.key !== model.key);

    return json(
      {
        error: exhausted
          ? other
            ? `${model.label} has no quota left for now — wait, or try ${other.label}, which has its own allowance.`
            : `${model.label} has no quota left for now, and it is the only image model here — wait a minute or two and try again. Nothing was billed.`
          : reason
            ? `${model.label} declined: ${reason}`
            : `${model.label} could not produce that image`,
        code: 'upstream',
        status: attempt.status,
        reason: reason ?? null,
        // Absent unless the provider actually said one. The client treats it as
        // a replacement for its own schedule, so an invented figure here would
        // be worse than none — see postWithRetry in facekit/generate.ts.
        retryAfterMs: attempt.retryAfterMs ?? null,
      },
      502,
    );
  }

  // The rate travels with the image so the page can total a kit as it is built,
  // rather than the browser holding a second copy of the price list. `cached` is
  // reported and not priced: `usdPerImage` is a flat per-image list figure that
  // already excludes the input's own tokens, so there is nothing here for a
  // cache discount to come off. It is on the wire to be read, not to be billed.
  return json({
    image: attempt.image,
    model: model.key,
    usd: model.usdPerImage,
    cached: attempt.cached ?? 0,
  });
}
