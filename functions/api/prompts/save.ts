import { json } from '../_middleware';
import {
  MAX_PRESET_NAME,
  MAX_PROMPT_TEXT,
  MAX_SAVED_PRESETS,
  type SavedPrompt,
  looksLikeSavedPrompt,
} from '../../../src/realtime/savedPrompts';
import { type LibraryEnv, readLibrary, writeLibrary } from './_library';

/**
 * Writes prompts into the shared library.
 *
 * Keyed by their own key, so saving twice replaces rather than leaving two
 * prompts with one name — what saving should mean for something still being
 * drafted, and what keeps an update from looking like a delete-and-recreate to
 * the pages that remember a key as last-used.
 *
 * IT TAKES A LIST AS WELL AS ONE, which is not generality for its own sake. The
 * many-at-once case is real and arrives exactly once per machine: the migration
 * that lifts a browser's old localStorage prompts into the bucket. Sending
 * those one at a time would be a read-modify-write per prompt against a library
 * assumed to have one writer, and the last one to land would be the only one
 * kept. One request, one write, nothing lost.
 *
 * The checks are shape checks, not a security boundary; the middleware has
 * already established that the caller knew the site password.
 */

interface SaveBody {
  prompt?: unknown;
  prompts?: unknown;
}

export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.PROMPTS) {
    return json({ error: 'No prompt library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as SaveBody | null;
  const incoming = Array.isArray(body?.prompts)
    ? body.prompts
    : body?.prompt !== undefined
      ? [body.prompt]
      : [];

  if (!incoming.length) {
    return json({ error: 'Nothing to save', code: 'no_prompt' }, 400);
  }
  if (!incoming.every(looksLikeSavedPrompt)) {
    return json({ error: 'That is not a saved prompt', code: 'bad_prompt' }, 400);
  }

  const now = Date.now();
  const written: SavedPrompt[] = incoming.map((entry) => ({
    key: entry.key,
    label: entry.label.trim().slice(0, MAX_PRESET_NAME) || 'Untitled prompt',
    text: entry.text,
    savedAt: now,
  }));

  if (written.some((entry) => !entry.text.trim())) {
    return json({ error: 'A prompt with no text is not a prompt', code: 'empty' }, 400);
  }
  if (written.some((entry) => entry.text.length > MAX_PROMPT_TEXT)) {
    return json(
      { error: `A prompt is limited to ${MAX_PROMPT_TEXT} characters`, code: 'too_long' },
      413,
    );
  }

  const existing = await readLibrary(env.PROMPTS);
  const keys = new Set(written.map((entry) => entry.key));
  const kept = existing.filter((entry) => !keys.has(entry.key));

  /*
   * The ceiling counts what the library would end up holding, not what was
   * sent. An update to a prompt already in a full library is not the thing the
   * ceiling exists to stop, and refusing it would strand the fiftieth prompt as
   * uneditable.
   */
  if (kept.length + written.length > MAX_SAVED_PRESETS) {
    return json(
      {
        error: `That is more than ${MAX_SAVED_PRESETS} saved prompts. Delete one first.`,
        code: 'too_many',
      },
      400,
    );
  }

  await writeLibrary(env.PROMPTS, [...written, ...kept]);

  return json({ prompts: written });
}
