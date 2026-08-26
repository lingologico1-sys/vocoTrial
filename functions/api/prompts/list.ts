import { json } from '../_middleware';
import { type LibraryEnv, readLibrary } from './_library';

/**
 * Every saved prompt, whole.
 *
 * Nothing is stripped: a prompt is a few kilobytes and the picker needs the
 * text itself, both to put it in the box when it is chosen and to work out —
 * on every keystroke — whether what has been typed still matches it. A second
 * route to fetch one by key would have nothing left to fetch.
 *
 * The built-ins are NOT in here. See _library.ts.
 */
export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.PROMPTS) {
    return json({ error: 'No prompt library is configured', code: 'no_bucket' }, 500);
  }

  return json({ prompts: await readLibrary(env.PROMPTS) });
}
