import { json } from '../_middleware';
import {
  BUILTIN_EVALUATOR_ID,
  MAX_BANDS,
  MAX_EVALUATOR,
  type Evaluator,
  looksLikeEvaluator,
} from '../../../src/realtime/evaluators';
import { type LibraryEnv, readLibrary, writeLibrary } from './_library';

/**
 * Writes one evaluator into the shared library.
 *
 * Keyed by its own id, so saving twice replaces rather than leaving two scales
 * with one name — what saving should mean for something you are still drafting.
 *
 * The checks are shape checks, not a security boundary; the middleware has
 * already established that the caller knew the site password. What they catch
 * is a malformed scale reaching the report prompt, where a band with no
 * description produces a diagnosis against a rung that says nothing.
 */

interface SaveBody {
  evaluator?: unknown;
}

export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.EVALUATORS) {
    return json({ error: 'No evaluator library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as SaveBody | null;
  if (!looksLikeEvaluator(body?.evaluator)) {
    return json({ error: 'That is not an evaluator', code: 'bad_evaluator' }, 400);
  }

  const incoming = body.evaluator;

  /*
   * The built-in's id is refused rather than allowed through as an override.
   *
   * Letting a save land on it would put a second evaluator with the same id in
   * the bucket, and the browser merges the two lists — so the picker would show
   * one entry whose contents depend on which list won. Shadowing the shipped
   * scale is a reasonable thing to want; doing it by collision is not the way,
   * and a copy under a new id is one button away.
   */
  if (incoming.id === BUILTIN_EVALUATOR_ID) {
    return json({ error: 'The built-in scale cannot be overwritten', code: 'builtin' }, 400);
  }

  if (incoming.bands.length > MAX_BANDS) {
    return json({ error: `That is more than ${MAX_BANDS} bands`, code: 'too_many_bands' }, 400);
  }

  const evaluator: Evaluator = {
    id: incoming.id,
    name: incoming.name.trim() || 'Untitled scale',
    note: typeof incoming.note === 'string' ? incoming.note.trim() : '',
    bands: incoming.bands,
    updatedAt: Date.now(),
  };

  const serialised = JSON.stringify(evaluator);
  if (serialised.length > MAX_EVALUATOR) {
    return json({ error: 'That scale is too long', code: 'too_large' }, 413);
  }

  const existing = await readLibrary(env.EVALUATORS);
  const without = existing.filter((entry) => entry.id !== evaluator.id);
  await writeLibrary(env.EVALUATORS, [evaluator, ...without]);

  return json({ evaluator });
}
