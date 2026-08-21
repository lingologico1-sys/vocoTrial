import { json } from '../_middleware';
import { MAX_LESSON_RULES } from '../../../src/realtime/house';
import { type HouseEnv, writeLessonRules } from './_library';

/**
 * Saves the house lesson rules: how every published tutor works its list.
 *
 * ONE OBJECT, OVERWRITTEN, and no id — performance-save.ts’s lifecycle, for the
 * reason DEFAULT_LESSON_RULES gives: which manner a tutor has is a teacher’s
 * choice per lesson, and whether a turn may carry two questions is a property
 * of how this deployment runs lessons. An administrator writes it once and the
 * next write replaces it.
 *
 * IT TAKES EFFECT ON THE NEXT PUBLISH, NOT ON THE NEXT CALL, which is the rule
 * every house value follows: a published setup carries a frozen copy, so
 * rewriting this cannot reach a class mid-lesson. Republishing is what carries
 * it to them, and a code handed out this morning keeps the block it went out
 * with.
 *
 * BLANK IS A SAVE AND NOT A REFUSAL. Clearing the box is how an administrator
 * says "go back to the build’s own text", and it has to be expressible —
 * otherwise the only way out of a bad rewrite is to guess at the original and
 * retype it. The composer reads blank as absent; see composeTutorPrompt.
 *
 * The ceiling is the one real check. A block this long is not a security
 * problem — the gate is — but it is a prompt the model will not hold to the end
 * of a call, and failing here puts that in front of the person who wrote it.
 */

interface SaveBody {
  rules?: unknown;
}

export async function onRequestPost(
  context: EventContext<HouseEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.HOUSE) {
    return json({ error: 'No house library is configured', code: 'no_bucket' }, 500);
  }

  const incoming = (await request.json().catch(() => null)) as SaveBody | null;
  if (typeof incoming?.rules !== 'string') {
    return json({ error: 'That is not a block of lesson rules', code: 'bad_rules' }, 400);
  }

  /*
   * The ceiling checked here rather than through `looksLikeLessonRules`, which
   * is the same check and would narrow the string to `never` on this branch —
   * leaving the message with no length to report. The guard earns its keep on
   * the read side, where what comes back from R2 has no type at all.
   */
  const rules = incoming.rules.trim();
  if (rules.length > MAX_LESSON_RULES) {
    return json(
      {
        error: `Lesson rules are limited to ${MAX_LESSON_RULES} characters, and that is ${rules.length}.`,
        code: 'too_long',
      },
      400,
    );
  }
  await writeLessonRules(env.HOUSE, rules);

  return json({ lessonRules: rules });
}
