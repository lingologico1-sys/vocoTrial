import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import { isFailure, validateOriginalMp3 } from './_convert';
import {
  laughRenderKey,
  originalFor,
  type LaughRender,
  type VoiceGender,
} from '../../../../src/lipsync/laughs';

/** Add a splice-ready original to a source imported before originals existed. */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  let body: { sourceId?: string; gender?: VoiceGender; rawMp3Base64?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }
  const sourceId = (body.sourceId ?? '').trim();
  if (!sourceId) return json({ error: 'No laugh named', code: 'no_source' }, 400);
  if (body.gender !== 'male' && body.gender !== 'female') {
    return json({ error: 'gender must be male or female', code: 'bad_gender' }, 400);
  }
  if (!body.rawMp3Base64) return json({ error: 'No original MP3', code: 'no_audio' }, 400);

  const library = await readClips(env.LIPSYNC);
  const source = library.sources.find((entry) => entry.id === sourceId);
  if (!source) return json({ error: 'No such laugh', code: 'not_found' }, 404);
  if (source.gender && source.gender !== body.gender) {
    return json({ error: 'That source is already in the other gender pool', code: 'gender_locked' }, 409);
  }
  if (originalFor(library.renders, sourceId)) {
    return json({ error: 'That laugh already has an original-performance clip', code: 'exists' }, 409);
  }

  const bytes = Uint8Array.from(atob(body.rawMp3Base64), (c) => c.charCodeAt(0));
  const checked = validateOriginalMp3(bytes);
  if (isFailure(checked)) {
    const { status, ...rest } = checked;
    return json(rest, status);
  }
  const render: LaughRender = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceId,
    treatment: 'original',
    gender: body.gender,
    kind: source.kind,
    label: source.label,
    durationMs: checked.scan.durationMs,
    bytes: checked.bytes.length,
  };

  await env.LIPSYNC.put(laughRenderKey(render.id), checked.bytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });
  const latest = await readClips(env.LIPSYNC);
  await writeClips(env.LIPSYNC, {
    sources: latest.sources.map((entry) =>
      entry.id === sourceId ? { ...entry, gender: body.gender } : entry,
    ),
    renders: [render, ...latest.renders],
  });
  return json({ render, gender: body.gender });
}
