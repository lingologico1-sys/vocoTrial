import { json } from '../_middleware';
import { SESSION_CODE } from '../../../src/realtime/session';
import { readCurrent, readSession, type SessionEnv } from './_library';

/**
 * The setup a student page should run.
 *
 * Two ways in, and the second one is not a feature yet. A caller may name a
 * code, which is what a join link will do; with no code this follows the
 * pointer, which is what /eleve does today. Both land in the same read.
 *
 * NOT FINDING ONE IS NOT AN ERROR. A deployment where nobody has published yet
 * is an ordinary state — the first thing a new install is in — and answering
 * 404 would have the page render a failure where it should render an
 * invitation. `{ session: null }` with a 200 is the honest shape: the request
 * worked, and the answer is that there is nothing set up.
 *
 * The one genuine 400 is a code that is not a code, which cannot be a typo the
 * page should paper over — it means a link was mangled, and saying so is more
 * use than pretending nothing was published.
 */

interface GetBody {
  code?: unknown;
}

export async function onRequestPost(
  context: EventContext<SessionEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.SESSIONS) {
    return json({ error: 'No session library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as GetBody | null;
  const asked = body?.code;

  if (asked !== undefined && asked !== null && asked !== '') {
    if (typeof asked !== 'string' || !SESSION_CODE.test(asked)) {
      return json({ error: 'That is not a session code', code: 'bad_code' }, 400);
    }
    return json({ session: await readSession(env.SESSIONS, asked) });
  }

  const current = await readCurrent(env.SESSIONS);
  if (!current) return json({ session: null });

  return json({ session: await readSession(env.SESSIONS, current) });
}
