import { json } from '../_middleware';
import { findLanguage } from '../../../src/realtime/languages';
import { MAX_INSTRUCTIONS } from '../../../src/realtime/instructions';
import {
  MAX_SESSION,
  MAX_SESSION_LABEL,
  looksLikeSession,
  type StudentSession,
} from '../../../src/realtime/session';
import { type SessionEnv, writeCurrent, writeSession } from './_library';

/**
 * Publishes one setup, and points the student page at it.
 *
 * Called from studio, which is maintainer UI — there is no teacher page yet.
 * The middleware has already established that the caller knew the site
 * password, so nothing here is a security boundary; what these checks catch is
 * a setup that would fail at the far end, in a browser belonging to somebody
 * who cannot fix it and does not know what a preset is.
 *
 * THE POINTER MOVES ON EVERY PUBLISH. There is one tutor today, so publishing
 * means "this is the one". When join codes arrive, this is the line that grows
 * a condition — the storage underneath it already distinguishes the two.
 *
 * WRITTEN IN THE ORDER THAT SURVIVES A FAILURE: the setup first, the pointer
 * second. A pointer written first can name an object that never landed, which
 * is a student page reading a code and finding nothing; this way round the
 * worst case is a setup nobody is pointed at, which is invisible.
 */

interface PublishBody {
  session?: unknown;
}

export async function onRequestPost(
  context: EventContext<SessionEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.SESSIONS) {
    return json({ error: 'No session library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as PublishBody | null;
  if (!looksLikeSession(body?.session)) {
    return json({ error: 'That is not a session', code: 'bad_session' }, 400);
  }

  const incoming = body.session;

  // Resolved rather than trusted, the rule the live and report paths both
  // follow: a language that is not on the list is one nothing downstream can
  // build a prompt for.
  if (!findLanguage(incoming.language)) {
    return json({ error: 'Unknown language', code: 'bad_language' }, 400);
  }

  /*
   * The same ceiling the live session enforces, checked here instead of there.
   *
   * A prompt that overflows fails at connect time — which on this page would
   * mean a student pressing Commencer and being told the instructions are too
   * long, about a prompt they have never seen and cannot shorten. Refusing the
   * publish puts the error in front of the person who can act on it.
   */
  if (incoming.instructions.length > MAX_INSTRUCTIONS) {
    return json(
      {
        error: `That prompt and persona come to ${incoming.instructions.length} characters together, and a session takes ${MAX_INSTRUCTIONS}.`,
        code: 'too_long',
      },
      400,
    );
  }

  const session: StudentSession = {
    ...incoming,
    label: incoming.label?.trim().slice(0, MAX_SESSION_LABEL) || undefined,
    updatedAt: Date.now(),
  };

  if (JSON.stringify(session).length > MAX_SESSION) {
    return json({ error: 'That setup is too large', code: 'too_large' }, 413);
  }

  await writeSession(env.SESSIONS, session);
  await writeCurrent(env.SESSIONS, session.code);

  return json({ session });
}
