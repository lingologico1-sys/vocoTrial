import { MODELS } from '../../../src/realtime/models';
import { IMAGE_MODELS } from '../../../src/facekit/imageModels';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexKey } from '../_vertex';
import { type GateEnv, json } from '../_middleware';

/**
 * Asks Vertex which model ids it will actually serve this key.
 *
 * The obvious way to ask — list the publisher catalogue, or GET a model by
 * name — does not work here and cannot be made to. Those are metadata
 * endpoints, and the credential is an API key bound to a service account and
 * restricted to aiplatform.googleapis.com; Vertex answers 401 to every one of
 * them. The only question this key may ask is `generateContent`.
 *
 * Which turns out to be enough, because the *failures* are informative and free
 * (a rejected request is not billed):
 *
 *   404  no such publisher model in this key's region — the id is wrong
 *   400  the id exists, but does not do generateContent. For a Live model that
 *        is the expected answer and the one worth having: it is bidi-only.
 *   200  the id exists and generated something. Only image and text models
 *        should ever land here, and maxOutputTokens keeps that cheap.
 *
 * So a Live id that answers 400 is confirmed to exist, and nothing else in the
 * chain can tell you that. It is still not proof the *socket* will accept it —
 * only a call that reaches `setupComplete` is — but it separates "wrong id"
 * from "right id, something else is broken", which is exactly the confusion
 * that has cost this project several deploys.
 *
 * Candidates below deliberately include spellings we do not use. Vertex names
 * its Live models differently from AI Studio, and the whole point is to find
 * out how rather than to confirm what we already believe.
 */

/** Vertex Live spellings worth trying, beyond whatever models.ts holds today. */
const LIVE_CANDIDATES = [
  'gemini-live-3.1-flash-preview',
  'gemini-live-3.1-flash',
  'gemini-live-2.5-flash',
  'gemini-live-2.5-flash-preview',
  'gemini-live-2.5-flash-preview-native-audio',
  'gemini-live-2.5-flash-preview-native-audio-09-2025',
  'gemini-2.0-flash-live-preview-04-09',
];

/** Image spellings, including the one PanelForge generates with on Vertex. */
const IMAGE_CANDIDATES = ['gemini-3.1-flash-image'];

/** Cheapest possible request: it exists to be rejected, not to produce text. */
const PROBE_BODY = JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: 'probe' }] }],
  generationConfig: { maxOutputTokens: 1 },
});

async function probe(id: string, key: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(vertexGenerateContentUrl(id), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: PROBE_BODY,
    });

    // 404 and 400 both mean "not billed"; 400 additionally means the id is real.
    const verdict =
      response.status === 404
        ? 'no such model'
        : response.status === 400
          ? 'exists, not a generateContent model'
          : response.ok
            ? 'exists and generated'
            : 'other';

    return { id, status: response.status, verdict };
  } catch (error) {
    return { id, status: null, verdict: `threw: ${error instanceof Error ? error.name : 'unknown'}` };
  }
}

export async function onRequestPost(
  context: EventContext<GateEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  // Whatever the pickers offer today, plus the spellings worth discovering.
  const live = [...MODELS.map((model) => model.id), ...LIVE_CANDIDATES];
  const image = [
    ...IMAGE_MODELS.filter((model) => model.provider === 'gemini').map((model) => model.id),
    ...IMAGE_CANDIDATES,
  ];

  const unique = (ids: string[]) => [...new Set(ids)];

  const [liveResults, imageResults] = await Promise.all([
    Promise.all(unique(live).map((id) => probe(id, key))),
    Promise.all(unique(image).map((id) => probe(id, key))),
  ]);

  return json({ surface: 'vertex', live: liveResults, image: imageResults });
}
