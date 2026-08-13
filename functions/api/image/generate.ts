import { IMAGE_MODELS, findImageModel, type ImageModelChoice } from '../../../src/facekit/imageModels';
import { type GateEnv, json } from '../_middleware';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexKey } from '../_vertex';

/**
 * Generates one face-kit patch, on whichever provider was asked for.
 *
 * Unlike the realtime routes, this one carries the payload rather than minting
 * a credential and stepping out of the way. That is the right trade here: image
 * generation is request/response on a timescale of seconds, so proxying costs
 * nothing a user can feel, and it keeps both keys server-side by construction —
 * the same property functions/api/session/* exists to preserve.
 *
 * The two providers are asked for the same thing in very different shapes:
 *
 *  - OpenAI takes multipart with a real mask image, and paints inside it.
 *  - Gemini takes JSON with the image inline and no mask at all, and is steered
 *    by the prompt alone. It runs on Vertex AI now rather than AI Studio, which
 *    changes the URL, the key and the meter but not the payload — see _vertex.ts.
 *
 * Neither difference reaches the browser as anything more than a flag, because
 * neither result is trusted whole: the client crops every result to the slot's
 * box and composites it onto the untouched base itself. See facekit/canvas.ts
 * for why that is not belt-and-braces but the actual mechanism.
 */

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';

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
  mask?: unknown;
}

/** Strips the `data:image/png;base64,` prefix a canvas export carries. */
function rawBase64(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value;
}

function toBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type Attempt =
  | { ok: true; image: string }
  | { ok: false; status: number; detail: string; reason?: string };

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
 * OpenAI's image edit, with the mask deciding where it may paint.
 *
 * `input_fidelity` is the parameter that matters for this job: it asks the
 * model to hold on to the input's own detail rather than re-imagining it, which
 * is the difference between the same illustrated character and her cousin. It
 * goes only to models flagged for it in imageModels.ts, because a parameter an
 * endpoint does not recognise fails the whole request rather than being
 * ignored — and a wrong guess there is indistinguishable from a wrong model id.
 */
async function generateOpenAi(
  model: ImageModelChoice,
  key: string,
  prompt: string,
  image: Uint8Array,
  mask: Uint8Array | null,
): Promise<Attempt> {
  const form = new FormData();
  form.append('model', model.id);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('image', new Blob([image], { type: 'image/png' }), 'base.png');
  if (mask) form.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
  if (model.highFidelity) form.append('input_fidelity', 'high');

  const upstream = await fetch(OPENAI_EDITS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!upstream.ok) {
    return { ok: false, status: upstream.status, detail: await upstream.text() };
  }

  const body = (await upstream.json()) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) return { ok: false, status: 502, detail: 'no image in response' };

  return { ok: true, image: b64 };
}

/** OpenAI's classification of a failure, without the message that may quote us. */
function openAiReason(detail: string): string | undefined {
  try {
    const parsed = JSON.parse(detail) as { error?: { code?: string; type?: string } };
    return trimmed(parsed.error?.code) ?? trimmed(parsed.error?.type);
  } catch {
    return undefined;
  }
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
): Promise<Attempt> {
  const upstream = await fetch(
    vertexGenerateContentUrl(model.id),
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: image } }],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  );

  if (!upstream.ok) {
    const detail = await upstream.text();
    let reason: string | undefined;
    try {
      // Vertex sometimes wraps the error in a one-element array where AI Studio
      // returned a bare object. Unwrapping it is what keeps RESOURCE_EXHAUSTED
      // legible below rather than collapsing into "could not produce that image".
      const parsed = JSON.parse(detail) as
        | { error?: { status?: string } }
        | { error?: { status?: string } }[];
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      reason = trimmed(first?.error?.status);
    } catch {
      reason = undefined;
    }
    return { ok: false, status: upstream.status, detail, reason };
  }

  const body = (await upstream.json()) as {
    promptFeedback?: { blockReason?: string };
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

  return { ok: true, image: part.inlineData.data };
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
  if (typeof body.mask === 'string' && body.mask.length > MAX_IMAGE_CHARS) {
    return json({ error: 'That mask is too large to send', code: 'image_too_large' }, 413);
  }

  const key = model.provider === 'openai' ? env.OPENAI_API_KEY : vertexKey(env);
  if (!key) {
    const name = model.provider === 'openai' ? 'OPENAI_API_KEY' : VERTEX_KEY_NAMES;
    return json({ error: `${name} is not configured`, code: 'no_key' }, 500);
  }

  const image = rawBase64(body.image);
  const prompt = body.prompt.trim();

  let attempt: Attempt;
  try {
    attempt =
      model.provider === 'openai'
        ? await generateOpenAi(
            model,
            key,
            prompt,
            toBytes(image),
            typeof body.mask === 'string' && body.mask ? toBytes(rawBase64(body.mask)) : null,
          )
        : await generateGemini(model, key, prompt, image);
  } catch (error) {
    console.error('image generate threw', model.id, error);
    return json({ error: 'The image request failed', code: 'upstream' }, 502);
  }

  if (!attempt.ok) {
    // Body to the log only — it can quote the request back, and the request was
    // authenticated with the account's own key. The provider's own short
    // classification travels with the error instead; see the note on Attempt.
    console.error('image generate failed', model.id, attempt.status, attempt.detail);
    const reason =
      attempt.reason ??
      (model.provider === 'openai' ? openAiReason(attempt.detail) : undefined);
    // "Declined: RESOURCE_EXHAUSTED" reads as a judgement about the picture. It
    // is not one — it is the account having nothing left for the moment, which
    // wants entirely different advice from a refusal.
    const exhausted = reason === 'RESOURCE_EXHAUSTED';
    const other = IMAGE_MODELS.find(
      (entry) => entry.provider === model.provider && entry.key !== model.key,
    );

    return json(
      {
        error: exhausted
          ? `${model.label} has no quota left for now — wait, or try ${other?.label ?? 'the other model'}, which has its own allowance.`
          : reason
            ? `${model.label} declined: ${reason}`
            : `${model.label} could not produce that image`,
        code: 'upstream',
        status: attempt.status,
        reason: reason ?? null,
      },
      502,
    );
  }

  // The rate travels with the image so the page can total a kit as it is built,
  // rather than the browser holding a second copy of the price list.
  return json({ image: attempt.image, model: model.key, usd: model.usdPerImage });
}
