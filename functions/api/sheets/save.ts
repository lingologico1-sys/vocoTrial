import { json } from '../_middleware';
import {
  MAX_BRIEF,
  MAX_QUESTIONS,
  MAX_SHEET,
  MAX_TARGETS,
  type QuestionSheet,
  looksLikeSheet,
} from '../../../src/realtime/sheets';
import { type SheetEnv, readSheets, writeSheets } from './_library';

/**
 * Writes one question sheet into the shared library.
 *
 * Keyed by its own id, so saving twice replaces rather than leaving two sheets
 * with one name — what saving should mean for something still being drafted.
 *
 * The checks are shape checks, not a security boundary; the middleware has
 * already established the caller knew the site password. What they catch is a
 * malformed sheet reaching two prompts at once: the questions land in a live
 * system prompt and the targets land in the report's, and an empty entry in
 * either produces a tutor asking a blank question or a report grading against
 * nothing.
 *
 * There is no built-in id to refuse, unlike evaluators/save.ts. Nothing ships,
 * so nothing can be shadowed by collision.
 */

interface SaveBody {
  sheet?: unknown;
}

/** Blank entries dropped rather than rejected — see the note in the header. */
const clean = (entries: string[], limit: number): string[] =>
  entries.map((entry) => entry.trim()).filter(Boolean).slice(0, limit);

export async function onRequestPost(
  context: EventContext<SheetEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.SHEETS) {
    return json({ error: 'No sheet library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as SaveBody | null;
  if (!looksLikeSheet(body?.sheet)) {
    return json({ error: 'That is not a question sheet', code: 'bad_sheet' }, 400);
  }

  const incoming = body.sheet;

  const questions = clean(incoming.questions, MAX_QUESTIONS + 1);
  if (!questions.length) {
    return json({ error: 'A sheet needs at least one question', code: 'no_questions' }, 400);
  }
  if (questions.length > MAX_QUESTIONS) {
    return json(
      { error: `That is more than ${MAX_QUESTIONS} questions`, code: 'too_many_questions' },
      400,
    );
  }

  const targets = clean(incoming.targets, MAX_TARGETS + 1);
  if (targets.length > MAX_TARGETS) {
    return json({ error: `That is more than ${MAX_TARGETS} targets`, code: 'too_many_targets' }, 400);
  }

  const brief = incoming.brief.trim();
  if (brief.length > MAX_BRIEF) {
    return json({ error: `A consigne takes ${MAX_BRIEF} characters`, code: 'brief_too_long' }, 400);
  }

  const sheet: QuestionSheet = {
    id: incoming.id,
    name: incoming.name.trim() || 'Untitled sheet',
    note: typeof incoming.note === 'string' ? incoming.note.trim() : '',
    brief,
    targets,
    questions,
    updatedAt: Date.now(),
  };

  const serialised = JSON.stringify(sheet);
  if (serialised.length > MAX_SHEET) {
    return json({ error: 'That sheet is too long', code: 'too_large' }, 413);
  }

  const existing = await readSheets(env.SHEETS);
  const without = existing.filter((entry) => entry.id !== sheet.id);
  await writeSheets(env.SHEETS, [sheet, ...without]);

  return json({ sheet });
}
