import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import { convertToVoice, isFailure } from './_convert';
import {
  laughRenderKey,
  laughSourceKey,
  treatmentOf,
  type LaughRender,
  type VoiceGender,
} from '../../../../src/lipsync/laughs';

/**
 * A laugh you already have, performed by a different voice.
 *
 * THIS IS WHY SOURCES ARE KEPT. A converted clip belongs to one voice and cannot be lent to
 * another — speech-to-speech renders into one voice, and a laugh in the wrong one is a
 * stranger interrupting the sentence. But the recording behind it belongs to no voice at
 * all, so adopting a new voice is this route rather than going back to find the original
 * file. The performance you chose once is the performance every voice gets.
 *
 * One at a time, deliberately. Each call spends credits, and a button that converted a
 * library of ten into a new voice at one click would spend them ten at a time on a
 * mis-click. The panel shows which voices a source has and offers the missing one.
 */

interface RenderBody {
  sourceId?: string;
  voiceId?: string;
  voiceName?: string;
  voiceGender?: VoiceGender;
  removeBackgroundNoise?: boolean;
}

export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }
  if (!env.ELEVENLABS_API_KEY) {
    return json(
      { error: 'ELEVENLABS_API_KEY is not configured on this deployment', code: 'no_key' },
      500,
    );
  }

  let body: RenderBody;
  try {
    body = (await request.json()) as RenderBody;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }

  const sourceId = (body.sourceId ?? '').trim();
  const voiceId = (body.voiceId ?? '').trim();
  if (!sourceId) return json({ error: 'No laugh named', code: 'no_source' }, 400);
  if (!voiceId) return json({ error: 'No voice to render into', code: 'no_voice' }, 400);

  const library = await readClips(env.LIPSYNC);
  const source = library.sources.find((s) => s.id === sourceId);
  if (!source) return json({ error: 'No such laugh', code: 'not_found' }, 404);
  if (!source.gender) {
    return json({ error: 'Classify that recording as male or female first', code: 'no_gender' }, 409);
  }
  if (body.voiceGender !== source.gender) {
    return json(
      {
        error: 'A laugh can only be converted into a voice from its own gender pool',
        code: 'gender_mismatch',
      },
      400,
    );
  }

  // Refused rather than made twice. A second render is a second charge for a clip that
  // would be picked at random against the first, so the library would grow a duplicate that
  // makes the same laugh twice as likely as the others — paying to make the variety worse.
  const already = library.renders.find(
    (r) =>
      r.sourceId === sourceId &&
      treatmentOf(r) === 'voice-converted' &&
      r.voiceId === voiceId,
  );
  if (already) {
    return json(
      { error: 'That laugh is already rendered for this voice', code: 'exists' },
      409,
    );
  }

  const object = await env.LIPSYNC.get(laughSourceKey(sourceId));
  if (!object) {
    return json(
      { error: 'The recording behind that laugh has gone', code: 'no_recording' },
      404,
    );
  }
  const wav = new Uint8Array(await object.arrayBuffer());

  const converted = await convertToVoice(
    env.ELEVENLABS_API_KEY,
    voiceId,
    wav,
    body.removeBackgroundNoise !== false,
  );
  if (isFailure(converted)) {
    const { status, ...rest } = converted;
    return json(rest, status);
  }

  const render: LaughRender = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceId,
    treatment: 'voice-converted',
    gender: source.gender,
    // Copied down from the source rather than taken from the request: what kind of laugh a
    // recording is, and what it is called, are facts about the recording and must not drift
    // between one voice's render and another's.
    kind: source.kind,
    label: source.label,
    voiceId,
    voiceName: body.voiceName,
    durationMs: converted.scan.durationMs,
    bytes: converted.bytes.length,
  };

  await env.LIPSYNC.put(laughRenderKey(render.id), converted.bytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });
  // Re-read rather than reusing the copy from above: the conversion is a slow call, and the
  // window between them is long enough for another import to have landed.
  const latest = await readClips(env.LIPSYNC);
  const sources = latest.sources.map((entry) =>
    entry.id === sourceId
      ? {
          ...entry,
          preferredTreatmentByVoice: {
            ...(entry.preferredTreatmentByVoice ?? {}),
            [voiceId]: 'voice-converted' as const,
          },
        }
      : entry,
  );
  await writeClips(env.LIPSYNC, {
    sources,
    renders: [render, ...latest.renders],
  });

  let binary = '';
  for (let i = 0; i < converted.bytes.length; i++) {
    binary += String.fromCharCode(converted.bytes[i]);
  }

  return json({ render, audioBase64: btoa(binary) });
}
