import { MODELS } from '../../../src/realtime/models';
import { VERTEX_HOST, VERTEX_KEY_NAMES, vertexKey } from '../_vertex';
import { type GateEnv, json } from '../_middleware';

/**
 * Asks Vertex which model ids it will actually accept.
 *
 * This exists because guessing model ids cost several deploys, and the move to
 * Vertex made the question live again: Vertex spells its Live models
 * differently from AI Studio — the same weights can sit behind
 * `gemini-live-2.5-flash…` on one surface and `gemini-2.5-flash-native-audio…`
 * on the other — so an id confirmed against the old catalogue proves nothing
 * about this one. Nothing else in the chain will tell you: the socket only
 * objects once it is open, and by then the failure looks like a broken relay.
 *
 * Two questions, because Vertex answers them separately:
 *
 *  - `catalogue` lists the publisher models the key can see at all. Express mode
 *    is not obliged to serve this listing; if it refuses, the status says so
 *    rather than the route pretending there are no models.
 *  - `allowlist` fetches each Gemini id in src/realtime/models.ts by name. That
 *    is the question actually worth answering — a 200 means the id exists as a
 *    publisher model on this key, a 404 means the picker is offering something
 *    that cannot work and the entry needs correcting.
 *
 * Neither proves the model supports *bidi* — the old route could filter on
 * `supportedGenerationMethods` and this one has no equivalent field to read. A
 * call that reaches `setupComplete` is still the only proof of that, which is
 * what the unverified flags in models.ts are for.
 *
 * Read-only, same-origin, and returns nothing but public model metadata and
 * HTTP statuses — the key never leaves the Worker.
 */

interface PublisherModel {
  name?: string;
  versionId?: string;
  launchStage?: string;
}

const VERSIONS = ['v1beta1', 'v1'] as const;

/** `publishers/google/models/gemini-x` -> `gemini-x`, for a readable list. */
function shortName(name: string | undefined): string | undefined {
  return name?.replace(/^publishers\/google\/models\//, '');
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  const headers = { 'x-goog-api-key': key };
  const catalogue: Record<string, unknown> = {};

  for (const version of VERSIONS) {
    const url = new URL(`https://${VERTEX_HOST}/${version}/publishers/google/models`);
    url.searchParams.set('pageSize', '1000');

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      // The status alone, never the body: an error can quote the request back,
      // and the request was signed with the account's key.
      catalogue[version] = { error: response.status };
      continue;
    }

    const body = (await response.json()) as { publisherModels?: PublisherModel[] };
    const models = body.publisherModels ?? [];
    catalogue[version] = {
      total: models.length,
      ids: models.map((model) => shortName(model.name)).filter(Boolean),
    };
  }

  // One probe per allowlisted Gemini id, on the version the relay talks to.
  const allowlist = await Promise.all(
    MODELS.filter((model) => model.provider === 'gemini').map(async (model) => {
      const url = `https://${VERTEX_HOST}/v1beta1/publishers/google/models/${encodeURIComponent(model.id)}`;
      try {
        const response = await fetch(url, { headers });
        return { key: model.key, id: model.id, status: response.status };
      } catch {
        return { key: model.key, id: model.id, status: null };
      }
    }),
  );

  return json({ surface: 'vertex', catalogue, allowlist });
}
