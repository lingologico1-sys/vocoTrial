import { json } from '../_middleware';
import { type SheetEnv, readSheets } from './_library';

/**
 * Every saved sheet, whole.
 *
 * Like evaluators/list.ts this strips nothing: a sheet is a few hundred bytes
 * and the picker needs its questions to show what is in it before you choose
 * it. There is no second route to fetch one by id, because there would be
 * nothing left for it to fetch.
 *
 * There is no built-in to merge in on the way out, unlike evaluators — see the
 * header in sheets.ts on why "no sheet" is a supported answer here. An empty
 * list is a working deployment nobody has written a lesson for yet.
 */
export async function onRequestPost(
  context: EventContext<SheetEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.SHEETS) {
    return json({ error: 'No sheet library is configured', code: 'no_bucket' }, 500);
  }

  return json({ sheets: await readSheets(env.SHEETS) });
}
