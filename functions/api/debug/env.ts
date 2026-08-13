import { json } from '../_middleware';

/**
 * TEMPORARY. Answers two questions nothing outside the Worker can answer, and
 * comes out again once they are answered.
 *
 * 1. What is bound? Names and value *lengths* only — never a value, never a
 *    prefix. This is what established that GEMINI_API_KEY is present and
 *    well-formed rather than empty or misnamed.
 *
 * 2. Which surface does each key actually work on? Vertex refuses the key with
 *    401 UNAUTHENTICATED, and an AI Studio key and a Vertex key are the same
 *    39 characters of AIza… — indistinguishable by eye. So ask each surface.
 *
 * Both probes are free and read-only, which is the point of their shape:
 *
 *  - Vertex is asked to generate on a model id that does not exist. A good
 *    credential gets 404 NOT_FOUND (the model), a bad one 401 UNAUTHENTICATED
 *    (the caller) — and a rejected request is not billed, so this distinguishes
 *    auth from everything else without spending anything.
 *  - AI Studio is asked to list models, which costs nothing either.
 *
 * Statuses only. An upstream error body can quote the request back, and the
 * request was signed with the key.
 */

const NO_SUCH_MODEL = 'gemini-no-such-model-probe';

async function status(request: Promise<Response>): Promise<number | string> {
  try {
    const response = await request;
    return response.status;
  } catch (error) {
    return `threw: ${error instanceof Error ? error.name : 'unknown'}`;
  }
}

async function probe(key: string): Promise<Record<string, unknown>> {
  const vertex = status(
    fetch(
      `https://aiplatform.googleapis.com/v1/publishers/google/models/${NO_SUCH_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'probe' }] }] }),
      },
    ),
  );

  const aiStudio = status(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${key}`),
  );

  return {
    vertex: await vertex,
    aiStudio: await aiStudio,
  };
}

export async function onRequestPost(
  context: EventContext<Record<string, unknown>, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;

  const shape = Object.keys(env)
    .sort()
    .map((name) => {
      const value = env[name];
      return {
        name,
        type: typeof value,
        length: typeof value === 'string' ? value.length : null,
      };
    });

  const credentials: Record<string, unknown> = {};
  for (const name of ['GEMINI_API_KEY', 'GEMINI_API_KEY2', 'GOOGLE_API_KEY']) {
    const value = env[name];
    if (typeof value === 'string' && value) credentials[name] = await probe(value);
  }

  return json({
    shape,
    // 401 on vertex = this key is not a Vertex credential.
    // 404 on vertex = it is, and only the probe's model id was fake.
    // 200 on aiStudio = it is an AI Studio key.
    credentials,
  });
}
