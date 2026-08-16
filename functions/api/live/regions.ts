import { IMAGE_MODELS } from '../../../src/facekit/imageModels';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexHost, vertexKey } from '../_vertex';
import { type GateEnv, json } from '../_middleware';

/**
 * Asks every Vertex region the same two questions, for nothing.
 *
 * WHY THIS EXISTS
 *
 * Image generation on this key fails in bursts of RESOURCE_EXHAUSTED — see the
 * long note in facekit/imageModels.ts. There are two candidate explanations and
 * they want opposite responses:
 *
 *   - Dynamic shared quota. Capacity for these models is pooled per *region*
 *     across everyone using it, so a 429 means the region was full at that
 *     instant, not that this project spent an allowance. Another region is a
 *     real fix.
 *   - A cap on the project — express tier, or a per-project ceiling. That
 *     applies everywhere at once, and another region is a prettier hostname
 *     attached to the identical error.
 *
 * Nothing in the error text tells the two apart, because both arrive as the
 * same code with the same message. What tells them apart is asking two regions
 * during the same burst: if one answers while the other refuses, the pool is
 * regional; if they refuse together, it is the project. That comparison is the
 * whole point of this route, and the reason it takes a `regions` narrowing
 * below — during a burst you want to re-ask two hosts immediately, not walk the
 * full candidate list.
 *
 * WHY IT IS FREE
 *
 * The same principle live/models.ts runs on: a rejected request is not billed.
 * Each phase uses whichever probe body is proven to produce a rejection for the
 * question it is asking, and neither ever reaches generation.
 *
 *   Phase 1, "does this host take the key at all" — a *bogus* model id with a
 *   well-formed body. The model in the URL is resolved during routing, so the
 *   answer is 404 long before the body matters. This is the probe the README
 *   already documents for verifying a fresh key, pointed at each host in turn.
 *   404 means the key authenticated and only the fake id was refused; 401 means
 *   this host will not take an express key; 403 means restriction or a disabled
 *   API.
 *
 *   Phase 2, "does this region serve our actual image models" — the *real* ids
 *   with a deliberately empty `contents`, which is invalid. A model that is not
 *   published in the region still 404s during routing; one that is published
 *   gets as far as validating the body and answers 400. So 400 is the hit here,
 *   and no image is ever generated to be charged for.
 *
 * A 429 in either phase is the thing actually being hunted, and it is worth
 * more than the phase it appears in: quota is checked at admission, before
 * either the body or the model id gets a look, so a region can refuse a probe
 * it would otherwise have rejected for free. That is the signal — it means this
 * region's pool is empty right now.
 */

/**
 * Where to look. Not exhaustive, and not meant to be: a geographic spread of
 * the regions Vertex most commonly publishes Gemini to, kept short because
 * every entry costs subrequests in both phases and a Worker's budget is finite.
 *
 * `undefined` is the global endpoint — the one everything generates through
 * today, included as the control. Phase 1 reports which region it lands on,
 * which is worth knowing on its own: express mode chooses that region silently
 * and the only evidence of the choice is the path quoted back in an error.
 */
const CANDIDATES: (string | undefined)[] = [
  undefined,
  'us-central1',
  'us-east4',
  'us-east5',
  'us-west1',
  'us-west4',
  'northamerica-northeast1',
  'europe-west1',
  'europe-west4',
  'asia-northeast1',
  'asia-southeast1',
  'australia-southeast1',
];

/**
 * A ceiling on how many hosts one call will touch.
 *
 * Both phases fan out, so the worst case is roughly `hosts × (1 + models)`
 * subrequests against a per-invocation limit. The candidate list sits well
 * inside it; this exists so a hand-passed `regions` array cannot blow past it.
 */
const MAX_HOSTS = 14;

/**
 * A region name goes into a hostname, so it is validated rather than trusted.
 *
 * The gate in _middleware.ts means only someone with the site password reaches
 * this, which makes it a low-stakes check — but interpolating caller-supplied
 * text into the host of a request carrying the account's key is not a thing to
 * do on trust at any stakes. Google's own region names are lowercase letters,
 * digits and hyphens, so anything else is refused rather than sanitised.
 */
const REGION_PATTERN = /^[a-z0-9-]+$/;

/** Well-formed, so the bogus id in the URL is what gets refused. */
const ROUTING_PROBE = JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: 'probe' }] }],
  generationConfig: { maxOutputTokens: 1 },
});

/**
 * Invalid on purpose: a real model id has to survive routing to reach the
 * complaint about it, which is exactly the distinction phase 2 is drawing.
 */
const VALIDATION_PROBE = JSON.stringify({ contents: [] });

/** An id no publisher has, borrowed from the README's key-verification probe. */
const BOGUS_MODEL = 'gemini-no-such-model-probe';

/**
 * The region Google names in an error, and nothing else from that error.
 *
 * The message quotes the resource back as
 * `projects/<PROJECT_ID>/locations/<REGION>/publishers/…`, which carries the
 * project id — so the body goes to the log and only this one token comes back,
 * the same rule image/generate.ts follows for the same reason.
 */
function servedRegion(detail: string): string | undefined {
  return /locations\/([a-z0-9-]+)/.exec(detail)?.[1];
}

/** Google's own classification: NOT_FOUND, RESOURCE_EXHAUSTED, and so on. */
function statusName(detail: string): string | undefined {
  try {
    const parsed = JSON.parse(detail) as { error?: { status?: string } } | { error?: { status?: string } }[];
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return typeof first?.error?.status === 'string' ? first.error.status : undefined;
  } catch {
    return undefined;
  }
}

interface Probe {
  status: number | null;
  reason?: string;
  verdict: string;
  servedBy?: string;
}

async function ask(url: string, key: string, body: string): Promise<{ status: number; detail: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body,
  });
  return { status: response.status, detail: response.ok ? '' : await response.text() };
}

/** Phase 1: is this host reachable with this key, and which region answers? */
async function probeHost(region: string | undefined, key: string): Promise<Probe> {
  try {
    const { status, detail } = await ask(
      vertexGenerateContentUrl(BOGUS_MODEL, region),
      key,
      ROUTING_PROBE,
    );
    console.error('region probe', vertexHost(region), status, detail);

    const verdict =
      status === 404
        ? 'usable — key accepted, only the fake id refused'
        : status === 401
          ? 'refuses this key'
          : status === 403
            ? 'blocked — key restriction or the API is off here'
            : status === 429
              ? 'EXHAUSTED at admission — no capacity right now'
              : status === 400
                ? 'reached, but rejected the probe body'
                : status < 300
                  ? 'generated on a model id that should not exist'
                  : 'other';

    return { status, reason: statusName(detail), verdict, servedBy: servedRegion(detail) };
  } catch (error) {
    // A region that does not exist fails in DNS rather than with a status.
    return {
      status: null,
      verdict: `unreachable: ${error instanceof Error ? error.name : 'unknown'}`,
    };
  }
}

/** Phase 2: is this model published in this region? 400 is the hit. */
async function probeModel(id: string, region: string | undefined, key: string): Promise<Probe> {
  try {
    const { status, detail } = await ask(
      vertexGenerateContentUrl(id, region),
      key,
      VALIDATION_PROBE,
    );
    console.error('region model probe', vertexHost(region), id, status, detail);

    const verdict =
      status === 400
        ? 'served here'
        : status === 404
          ? 'not published here'
          : status === 429
            ? 'EXHAUSTED — capacity, which says nothing about availability'
            : status < 300
              ? 'generated, and therefore billed — the probe body stopped being invalid'
              : 'other';

    return { status, reason: statusName(detail), verdict };
  } catch (error) {
    return {
      status: null,
      verdict: `unreachable: ${error instanceof Error ? error.name : 'unknown'}`,
    };
  }
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  // Optional narrowing, which is what makes this usable as an A/B during a
  // burst: `{"regions":["us-central1","europe-west4"]}` asks two hosts the same
  // question inside the same few seconds. "global" names the endpoint that has
  // no region in its hostname, so it can be asked for by name like the others.
  let wanted: (string | undefined)[] = CANDIDATES;
  const body = (await request.json().catch(() => null)) as { regions?: unknown } | null;
  if (Array.isArray(body?.regions)) {
    const named = body.regions.filter((entry): entry is string => typeof entry === 'string');
    const bad = named.filter((entry) => entry !== 'global' && !REGION_PATTERN.test(entry));
    if (bad.length) {
      return json({ error: `Not region names: ${bad.join(', ')}`, code: 'bad_region' }, 400);
    }
    if (named.length) wanted = named.map((entry) => (entry === 'global' ? undefined : entry));
  }

  if (wanted.length > MAX_HOSTS) {
    return json({ error: `At most ${MAX_HOSTS} regions per call`, code: 'too_many' }, 400);
  }

  const hosts = await Promise.all(
    wanted.map(async (region) => ({ region, probe: await probeHost(region, key) })),
  );

  // Only regions that took the key are worth asking about models — everywhere
  // else the answer would be the 401 we already have, at the cost of a
  // subrequest each. A 429 counts as taking the key: it got past authentication
  // to reach a quota check, and its models are the ones most worth listing.
  const ids = IMAGE_MODELS.filter((model) => model.provider === 'gemini').map((model) => model.id);
  const results = await Promise.all(
    hosts.map(async ({ region, probe }) => {
      const reachable = probe.status === 404 || probe.status === 429;
      const models = reachable
        ? Object.fromEntries(
            await Promise.all(
              ids.map(async (id) => [id, await probeModel(id, region, key)] as const),
            ),
          )
        : undefined;
      return { region: region ?? 'global', host: vertexHost(region), ...probe, models };
    }),
  );

  return json({ surface: 'vertex', billed: false, regions: results });
}
