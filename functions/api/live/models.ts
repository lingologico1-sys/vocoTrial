import { type GateEnv, json } from '../_middleware';

/**
 * Lists the Gemini models that actually support the Live API.
 *
 * This exists because guessing model ids cost several deploys. Nothing else in
 * the chain will tell you an id is wrong: `auth_tokens` mints against any
 * string, and the Live socket only objects once it is open. So ask Google.
 *
 * Read-only, same-origin, and returns nothing but public model metadata — the
 * key never leaves the Worker.
 */

interface ListedModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
}

const VERSIONS = ['v1beta', 'v1alpha'] as const;

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;

  if (!env.GOOGLE_API_KEY) {
    return json({ error: 'GOOGLE_API_KEY is not configured', code: 'no_key' }, 500);
  }

  const out: Record<string, unknown> = {};

  for (const version of VERSIONS) {
    const url = new URL(`https://generativelanguage.googleapis.com/${version}/models`);
    url.searchParams.set('key', env.GOOGLE_API_KEY);
    url.searchParams.set('pageSize', '1000');

    const response = await fetch(url.toString());
    if (!response.ok) {
      out[version] = { error: response.status };
      continue;
    }

    const body = (await response.json()) as { models?: ListedModel[] };
    const models = body.models ?? [];

    out[version] = {
      total: models.length,
      // The whole point: which ids the Live socket will actually accept.
      live: models
        .filter((m) => m.supportedGenerationMethods?.includes('bidiGenerateContent'))
        .map((m) => m.name?.replace(/^models\//, '')),
    };
  }

  return json(out);
}
