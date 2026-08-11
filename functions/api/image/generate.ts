import { findImageModel, type ImageModelChoice } from '../../../src/facekit/imageModels';
import { type GateEnv, json } from '../_middleware';

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
 *    by the prompt alone.
 *
 * Neither difference reaches the browser as anything more than a flag, because
 * neither result is trusted whole: the client crops every result to the slot's
 * box and composites it onto the untouched base itself. See facekit/canvas.ts
 * for why that is not belt-and-braces but the actual mechanism.
 */

const OPENAI_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

type Attempt = { ok: true; image: string } | { ok: false; status: number; detail: string };

/**
 * OpenAI's image edit, with the mask deciding where it may paint.
 *
 * `input_fidelity` is the parameter that matters for this job: it asks the
 * model to hold on to the input's own detail rather than re-imagining it, which
 * is the difference between the same illustrated character and her cousin. It
 * is sent only to the gpt-image-1 family, because a parameter an endpoint does
 * not recognise fails the whole request rather than being ignored.
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
  if (model.id.startsWith('gpt-image-1')) form.append('input_fidelity', 'high');

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
    `${GEMINI_BASE}/${encodeURIComponent(model.id)}:generateContent`,
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
    return { ok: false, status: upstream.status, detail: await upstream.text() };
  }

  const body = (await upstream.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };

  const part = body.candidates?.[0]?.content?.parts?.find((entry) => entry.inlineData?.data);
  if (!part?.inlineData?.data) {
    // Reached when the model answers in text instead of pixels, which is what a
    // refused edit looks like on this API — a 200 with prose in it.
    return { ok: false, status: 502, detail: 'no image in response' };
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

  const key = model.provider === 'openai' ? env.OPENAI_API_KEY : env.GOOGLE_API_KEY;
  if (!key) {
    const name = model.provider === 'openai' ? 'OPENAI_API_KEY' : 'GOOGLE_API_KEY';
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
    // Status out, body to the log only. An upstream error can quote the request
    // back at us, and the request was authenticated with the account's own key.
    console.error('image generate failed', model.id, attempt.status, attempt.detail);
    return json(
      {
        error: `${model.label} could not produce that image`,
        code: 'upstream',
        status: attempt.status,
      },
      502,
    );
  }

  // The rate travels with the image so the page can total a kit as it is built,
  // rather than the browser holding a second copy of the price list.
  return json({ image: attempt.image, model: model.key, usd: model.usdPerImage });
}
