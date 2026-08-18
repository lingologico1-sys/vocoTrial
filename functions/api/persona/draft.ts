import {
  MAX_DRAFT_PROMPT,
  PERSONA_MODEL,
} from '../../../src/facekit/persona';
import { type GateEnv, json } from '../_middleware';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexKey } from '../_vertex';

/**
 * Writes a tutor's background from their portrait: one picture in, text out.
 *
 * A proxy of the same shape as image/generate.ts and for the same reasons — the
 * key stays server-side, and the round trip is short enough that carrying the
 * payload costs nothing anyone can feel. What differs is only the modality, so
 * this route knows nothing about personas beyond the model it spends on: the
 * prompt arrives from the browser, the reply goes back as text, and what shape
 * that text is in is facekit/persona.ts's business. That split is what lets the
 * drafting prompt be reworded on the page it is read on.
 *
 * No model key on the wire, unlike every other spending route here. The rule
 * those follow — the client sends a key, the server resolves it, so a visitor
 * cannot name an arbitrary model and spend the account on it — is satisfied
 * more simply by there being one model and the server naming it. See
 * PERSONA_MODEL for why there is nothing to choose between.
 */

/**
 * A ceiling on the portrait, in base64 characters. The page sends a normalised
 * 1024px square, which lands far under it; this is so a mistake fails at the
 * edge with a message rather than partway through an upstream call.
 */
const MAX_IMAGE_CHARS = 12_000_000;

/** Strips the `data:image/png;base64,` prefix a canvas export carries. */
function rawBase64(value: string): string {
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value;
}

const REASON_LIMIT = 300;

/** The provider's own classification, never its message — see image/generate.ts. */
function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}…` : text;
}

interface Usage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  /** Set by Vertex when part of the prompt was served from an implicit cache. */
  cachedContentTokenCount?: number;
}

/**
 * What the call cost, from what Vertex says it used.
 *
 * Billed from reported tokens rather than estimated from a flat per-call
 * figure, because the input here is a megabyte-scale image and its token count
 * is most of the bill — the very thing the image models' `usdPerImage` has to
 * exclude and admit to excluding. Here the number is reported, so a kit's
 * `spentUsd` can absorb this call honestly instead of quietly missing it.
 *
 * Cached input is priced at the full rate anyway, which is deliberate and is
 * the only place in this app a figure is allowed to read high. Vertex discounts
 * tokens it served from an implicit cache, but by a factor this code has no
 * confirmed number for, and inventing one would put a made-up discount into a
 * running total. Paying the sticker price for them overstates a draft by a
 * fraction of a cent and leaves the kit's total the floor it claims to be,
 * since the image generations either side of it exclude their input entirely.
 *
 * Zero when the fields are absent, which is the same safe direction.
 */
function costUsd(usage: Usage | undefined) {
  const input = usage?.promptTokenCount ?? 0;
  const output = usage?.candidatesTokenCount ?? 0;
  return (
    (input * PERSONA_MODEL.usdPerMillionInput) / 1_000_000 +
    (output * PERSONA_MODEL.usdPerMillionOutput) / 1_000_000
  );
}

interface DraftBody {
  prompt?: unknown;
  image?: unknown;
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  let body: DraftBody | null = null;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return json({ error: 'Malformed request', code: 'bad_body' }, 400);
  }

  if (typeof body?.prompt !== 'string' || !body.prompt.trim()) {
    return json({ error: 'A prompt is required', code: 'bad_prompt' }, 400);
  }
  if (body.prompt.length > MAX_DRAFT_PROMPT) {
    return json({ error: 'That prompt is too long', code: 'prompt_too_long' }, 413);
  }
  if (typeof body.image !== 'string' || !body.image) {
    return json({ error: 'A portrait is required', code: 'bad_image' }, 400);
  }
  if (body.image.length > MAX_IMAGE_CHARS) {
    return json({ error: 'That image is too large to send', code: 'image_too_large' }, 413);
  }

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(vertexGenerateContentUrl(PERSONA_MODEL.id), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // THE PICTURE GOES FIRST, and it is the one ordering decision here.
        //
        // Redrafting is the normal way this route is used: the same portrait
        // goes up again with the prompt reworded, because comparing wordings is
        // what the editable prompt is for. Implicit caching keys on a matching
        // *prefix*, so with the text first every reworded draft invalidates the
        // image behind it and pays for the expensive half twice. Image first
        // and the portrait is the shared prefix, which is the only arrangement
        // where a second draft can be cheaper than the first.
        //
        // Free to arrange and not guaranteed to fire: a hit also needs the
        // prefix to clear the model's minimum, and a 1024px square lands near
        // it rather than safely past it. `cached` in the reply is how you find
        // out whether it did, rather than assuming either way.
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'image/png', data: rawBase64(body.image) } },
              { text: body.prompt.trim() },
            ],
          },
        ],
        // Asked for as JSON because two fields have to come back apart, and a
        // labelled line is the version that fails silently. The client parses
        // tolerantly anyway — the prompt is editable, so this is a request
        // rather than a contract.
        generationConfig: { responseMimeType: 'application/json', temperature: 1 },
      }),
    });
  } catch (error) {
    console.error('persona draft threw', PERSONA_MODEL.id, error);
    return json({ error: 'The draft request failed', code: 'upstream' }, 502);
  }

  if (!upstream.ok) {
    // Body to the log only: an error can quote the request back, and the
    // request was authenticated with the account's own key.
    const detail = await upstream.text();
    console.error('persona draft failed', PERSONA_MODEL.id, upstream.status, detail);

    let reason: string | undefined;
    try {
      const parsed = JSON.parse(detail) as
        | { error?: { status?: string } }
        | { error?: { status?: string } }[];
      reason = trimmed((Array.isArray(parsed) ? parsed[0] : parsed)?.error?.status);
    } catch {
      reason = undefined;
    }

    return json(
      {
        error:
          reason === 'RESOURCE_EXHAUSTED'
            ? `${PERSONA_MODEL.label} has no quota left for now — wait a minute and try again.`
            : reason
              ? `${PERSONA_MODEL.label} declined: ${reason}`
              : `${PERSONA_MODEL.label} could not write that`,
        code: 'upstream',
        status: upstream.status,
        reason: reason ?? null,
      },
      502,
    );
  }

  const answer = (await upstream.json()) as {
    promptFeedback?: { blockReason?: string };
    usageMetadata?: Usage;
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string }[] };
    }[];
  };

  const candidate = answer.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!text) {
    // A refusal on this API is a 200 with no parts and a finishReason, which is
    // indistinguishable from a bug unless the classification is carried out.
    const reason =
      trimmed(answer.promptFeedback?.blockReason) ??
      trimmed(candidate?.finishReason) ??
      'no text and no stated reason';
    console.error('persona draft empty', PERSONA_MODEL.id, JSON.stringify(answer).slice(0, 2000));
    return json({ error: `${PERSONA_MODEL.label} declined: ${reason}`, code: 'upstream', reason }, 502);
  }

  // The cached count travels so a hit is observable rather than assumed. It is
  // reported, not billed on — see costUsd.
  return json({
    text,
    usd: costUsd(answer.usageMetadata),
    cached: answer.usageMetadata?.cachedContentTokenCount ?? 0,
  });
}
