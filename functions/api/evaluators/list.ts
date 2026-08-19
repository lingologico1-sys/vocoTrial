import { json } from '../_middleware';
import { type LibraryEnv, readLibrary } from './_library';

/**
 * Every saved evaluator, whole.
 *
 * Unlike faces/list.ts this does not strip anything: a scale is a few kilobytes
 * and the picker needs its bands to show what is in it before you choose it.
 * There is no second route to fetch one by id, because there would be nothing
 * left for it to fetch.
 *
 * The built-in is NOT in here. It lives in evaluators.ts and is merged in by
 * the browser, so a deployment with no bucket — or one where nobody has
 * authored anything — still has a working scale rather than an empty picker.
 */
export async function onRequestPost(
  context: EventContext<LibraryEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.EVALUATORS) {
    return json({ error: 'No evaluator library is configured', code: 'no_bucket' }, 500);
  }

  return json({ evaluators: await readLibrary(env.EVALUATORS) });
}
