import { json } from '../_middleware';

/**
 * TEMPORARY. Reports the *shape* of the Worker's environment, to settle a
 * question nothing outside the Worker can answer: `GEMINI_API_KEY` is listed as
 * a project secret and a deployment was built after it was added, yet
 * `env.GEMINI_API_KEY` is falsy while `env.OPENAI_API_KEY` in the very same
 * request is not.
 *
 * Names and value *lengths* only — never a value, never a prefix. A name is
 * already public in this repo, and a length distinguishes the two remaining
 * explanations: a binding that is present but empty, versus a name that differs
 * from what the code reads by whitespace or a lookalike character (both of
 * which print identically in `wrangler pages secret list`).
 *
 * Delete this route once the answer is in. It is behind the password gate like
 * everything else under /api/*, but a route that enumerates the environment has
 * no business outliving the question it was added to answer.
 */
export async function onRequestPost(
  context: EventContext<Record<string, unknown>, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;

  const shape = Object.keys(env)
    .sort()
    .map((name) => {
      const value = env[name];
      return {
        // JSON quotes the name, so stray whitespace in it is visible on sight.
        name,
        type: typeof value,
        length: typeof value === 'string' ? value.length : null,
      };
    });

  return json({ shape });
}
