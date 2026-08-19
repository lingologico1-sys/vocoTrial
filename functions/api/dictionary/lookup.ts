import { type GateEnv, json } from '../_middleware';
import { resolveL1 } from '../../../src/realtime/l1';
import {
  DICTIONARY_MODEL,
  DICTIONARY_SCHEMA,
  DICTIONARY_SHOT_MODEL,
  DICTIONARY_SHOT_USER,
  MAX_CONTEXT,
  MAX_TERM,
  dictionaryInstruction,
  looksLikeDictionaryResult,
} from '../../../src/realtime/dictionary';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexKey } from '../_vertex';

/**
 * One word looked up, for the student page.
 *
 * A proxy of the same shape as report/analyse.ts and for the same reason — the
 * key stays server-side — and like that route it owns its own prompt rather
 * than taking one from the browser. The caller here is a student, who authors
 * neither prompts nor models.
 *
 * THE L1 IS RESOLVED, NOT TRUSTED. It arrives as a code and is looked up in
 * l1.ts before anything is built from it, because it lands in a *system*
 * prompt: a caller who could post the language name inline could post
 * instructions instead. Unknown codes fall back to English rather than
 * refusing, which is the difference between this and the report route — a
 * lookup answered in the wrong language is a smaller failure than a lookup that
 * does not happen, and the code came from our own picker.
 *
 * THE TERM CANNOT BE RESOLVED against anything, since the whole point is that
 * it is a word nobody has seen before. It travels as user content rather than
 * inside the instruction, and the instruction says what it is.
 */

interface LookupBody {
  term?: unknown;
  l1?: unknown;
  context?: unknown;
}

const REASON_LIMIT = 300;

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}…` : text;
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  const body = (await request.json().catch(() => null)) as LookupBody | null;

  const term = typeof body?.term === 'string' ? body.term.trim() : '';
  if (!term) {
    return json({ error: 'A word is required', code: 'no_term' }, 400);
  }
  if (term.length > MAX_TERM) {
    return json({ error: 'That is longer than a word', code: 'term_too_long' }, 400);
  }

  const l1 = resolveL1(typeof body?.l1 === 'string' ? body.l1 : undefined);

  // Truncated rather than refused. Context is a nicety — it disambiguates and
  // finds idioms — and a long one should cost the tail of a sentence, not the
  // lookup.
  const spoken = typeof body?.context === 'string' ? body.context.trim().slice(0, MAX_CONTEXT) : '';

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  const ask = spoken
    ? `Look up: "${term}" in context: "${spoken}" (French → ${l1.name})`
    : `Look up: "${term}" (French → ${l1.name})`;

  let upstream: Response;
  try {
    upstream = await fetch(vertexGenerateContentUrl(DICTIONARY_MODEL.id), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: dictionaryInstruction(l1.name) }] },
        contents: [
          { role: 'user', parts: [{ text: DICTIONARY_SHOT_USER }] },
          { role: 'model', parts: [{ text: DICTIONARY_SHOT_MODEL }] },
          { role: 'user', parts: [{ text: ask }] },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: DICTIONARY_SCHEMA,
          /*
           * No temperature, following LingoLecto's own finding: Gemini 3
           * recommends leaving it at the default, and values below 1.0 can
           * cause looping or degraded output. Measured there at 0.3 against the
           * default — identical results and latency, so there is nothing traded
           * away by complying.
           */
        },
      }),
    });
  } catch (error) {
    console.error('dictionary lookup threw', DICTIONARY_MODEL.id, error);
    return json({ error: 'The lookup failed', code: 'upstream' }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text();
    console.error('dictionary lookup failed', DICTIONARY_MODEL.id, upstream.status, detail);

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
            ? 'The dictionary is busy right now. Try again in a moment.'
            : 'The lookup failed',
        code: 'upstream',
      },
      502,
    );
  }

  let text: string | undefined;
  try {
    const answer = (await upstream.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    text = answer.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
  } catch {
    text = undefined;
  }

  if (!text) {
    return json({ error: 'The dictionary said nothing', code: 'empty' }, 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: 'The dictionary answered in the wrong shape', code: 'bad_json' }, 502);
  }

  if (!looksLikeDictionaryResult(parsed)) {
    return json({ error: 'The dictionary answered in the wrong shape', code: 'bad_shape' }, 502);
  }

  return json({ result: parsed });
}
