import { json } from '../_middleware';
import {
  MAX_STYLE_NAME,
  MAX_STYLE_TEXT,
  MAX_STYLES,
  type TutorStyle,
  looksLikeStyle,
} from '../../../src/realtime/house';
import { type HouseEnv, readStyles, writeStyles } from './_library';

/**
 * Writes one tutor style into the house library.
 *
 * Keyed by its own id, so saving twice replaces rather than leaving two styles
 * with one name.
 *
 * THE TEXT IS ALREADY RENDERED when it gets here. Studio composes its current
 * preset against the language picker and sends the result, because a preset key
 * names a prompt in one browser's localStorage — the same reason publishing
 * sends composed instructions rather than a style id. What arrives is prose,
 * and the only thing worth checking about prose is that there is some and not
 * too much.
 *
 * THE CEILING IS ON THE LIBRARY, NOT JUST THE STYLE. Twelve is a picker a
 * teacher can read; beyond that the choice stops being a choice. Refused rather
 * than silently dropping the oldest, because an administrator who has hit the
 * ceiling should decide which manner the deployment no longer needs.
 */

interface SaveBody {
  style?: unknown;
}

export async function onRequestPost(
  context: EventContext<HouseEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.HOUSE) {
    return json({ error: 'No house library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as SaveBody | null;
  if (!looksLikeStyle(body?.style)) {
    return json({ error: 'That is not a tutor style', code: 'bad_style' }, 400);
  }

  const incoming = body.style;
  const text = incoming.text.trim();
  if (text.length > MAX_STYLE_TEXT) {
    return json(
      { error: `A style takes ${MAX_STYLE_TEXT} characters`, code: 'text_too_long' },
      400,
    );
  }

  const style: TutorStyle = {
    id: incoming.id,
    name: incoming.name.trim().slice(0, MAX_STYLE_NAME) || 'Untitled style',
    note: typeof incoming.note === 'string' ? incoming.note.trim() : '',
    text,
    language: incoming.language,
    updatedAt: Date.now(),
  };

  const existing = await readStyles(env.HOUSE);
  const without = existing.filter((entry) => entry.id !== style.id);
  if (without.length >= MAX_STYLES) {
    return json(
      { error: `The house holds ${MAX_STYLES} styles. Delete one first.`, code: 'too_many_styles' },
      400,
    );
  }

  await writeStyles(env.HOUSE, [style, ...without]);

  return json({ style });
}
