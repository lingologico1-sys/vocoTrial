import { json } from '../_middleware';
import { listSetups, type SessionEnv } from './_library';

/**
 * What has been published, newest first.
 *
 * FOR THE TEACHER, NOT THE STUDENT. A code read off a board on Monday is a code
 * somebody will have lost by Thursday, and without this the only way back to it
 * is to publish again and hand out a different one. So /teach keeps a list of
 * what it has sent out.
 *
 * It carries no prompts, no questions and no face — a code, a name, a date, and
 * which tutor protocol the prompt behind it was composed against, all assembled
 * from the object listing rather than by reading every setup in the bucket. See
 * listSetups on why the metadata lives where it does.
 *
 * That last one is the only field here the teacher could not have worked out
 * themselves, and it is why the list is worth more than a record of what went
 * out: a code published before a protocol change still opens and starts teaching
 * badly, and nothing about the code, the name or the date says so. See
 * PROMPT_COMPOSER_VERSION in src/realtime/vocoSessions.ts.
 *
 * THIS IS THE ROUTE THAT WOULD LEAK A CLASS LIST if the deployment ever grew
 * more than one teacher behind one password. It is behind the site password
 * like everything else, which today means every teacher can see every teacher's
 * codes. That is the shared-password edge the README already records, not a new
 * one — but this is the route where it stops being theoretical, and it is the
 * first thing to gate when roles arrive.
 */
export async function onRequestPost(
  context: EventContext<SessionEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.SESSIONS) {
    return json({ error: 'No session library is configured', code: 'no_bucket' }, 500);
  }

  return json({ setups: await listSetups(env.SESSIONS) });
}
