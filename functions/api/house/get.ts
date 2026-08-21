import { json } from '../_middleware';
import { type HouseEnv, readLessonRules, readPerformance, readStyles } from './_library';

/**
 * The house, whole: the tutor styles, the lesson rules and the performance
 * profile.
 *
 * ALL IN ONE READ because the callers want more than one. /teach draws a style
 * picker and wants to say whether an administrator has tuned the faces yet;
 * studio wants to show what a "save as house default" would be replacing, and
 * wants the saved lesson rules in the box it opens on. Three routes would be
 * three round trips to render one panel.
 *
 * AN UNCONFIGURED HOUSE IS NOT AN ERROR. A deployment where no administrator
 * has saved a style is an ordinary state — the state every new install is in —
 * and answering 500 would have /teach render a failure where it should render
 * an empty picker. The missing binding is the one genuine 500, because that is
 * a deployment problem rather than a thing nobody has got round to.
 */
export async function onRequestPost(
  context: EventContext<HouseEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.HOUSE) {
    return json({ error: 'No house library is configured', code: 'no_bucket' }, 500);
  }

  const [styles, performance, lessonRules] = await Promise.all([
    readStyles(env.HOUSE),
    readPerformance(env.HOUSE),
    readLessonRules(env.HOUSE),
  ]);

  return json({ styles, performance, lessonRules });
}
