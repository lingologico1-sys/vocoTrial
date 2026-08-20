import { json } from '../_middleware';
import { normaliseLessonCode } from '../../../src/realtime/lessonCodes';
import { readSetup, type SessionEnv } from './_library';

/**
 * The setup a student page should run, by code.
 *
 * A CODE IS NOW REQUIRED. This route used to answer a codeless request by
 * following a pointer at whichever setup was published last, because /eleve had
 * no way to ask for one. That is gone: the pointer made the second teacher to
 * publish silently replace the first for every student in the deployment, and
 * codes exist now. A request with no code is a student who has not typed one
 * yet, which the page handles by asking.
 *
 * NOT FINDING ONE IS NOT AN ERROR. A code that resolves to nothing is an
 * ordinary state — a typo, or a lesson deleted since — and answering 404 would
 * have the page render a failure where it should render "check that code".
 * `{ setup: null }` with a 200 is the honest shape: the request worked, and the
 * answer is that there is nothing under that code.
 *
 * The one genuine 400 is a code that is not a code, which is a different thing
 * to say: not "no lesson here" but "that is not the right number of characters
 * to be a code at all", which tells a student to look at what they typed rather
 * than to ask their teacher.
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
  const code = normaliseLessonCode(body?.code);
  if (!code) {
    return json({ error: 'That is not a lesson code', code: 'bad_code' }, 400);
  }

  return json({ setup: await readSetup(env.SESSIONS, code) });
}
