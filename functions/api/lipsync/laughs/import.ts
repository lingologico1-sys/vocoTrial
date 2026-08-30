import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import {
  convertToVoice,
  isFailure,
  validateOriginalMp3,
  type ConvertFailure,
} from './_convert';
import {
  laughRenderKey,
  laughSourceKey,
  type LaughKind,
  type LaughRender,
  type LaughSource,
  type VoiceGender,
} from '../../../../src/lipsync/laughs';

/** Keep one recording, always raw and spliceable, and optionally re-perform it. */
interface ImportBody {
  audioBase64?: string;
  rawMp3Base64?: string;
  kind?: LaughKind;
  gender?: VoiceGender;
  label?: string;
  voiceId?: string;
  voiceName?: string;
  voiceGender?: VoiceGender;
  convert?: boolean;
  durationMs?: number;
  removeBackgroundNoise?: boolean;
}

const MIN_CLIP_MS = 150;
const MAX_CLIP_MS = 8000;
const decode = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return btoa(binary);
}

export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }

  const kind = body.kind;
  const gender = body.gender;
  const voiceId = (body.voiceId ?? '').trim();
  const wantsConversion = body.convert === true;
  const durationMs = Math.round(body.durationMs ?? 0);

  if (!body.audioBase64) return json({ error: 'No audio', code: 'no_audio' }, 400);
  if (!body.rawMp3Base64) {
    return json({ error: 'No original-performance MP3', code: 'no_original' }, 400);
  }
  if (kind !== 'laughs' && kind !== 'giggles') {
    return json({ error: 'kind must be laughs or giggles', code: 'bad_kind' }, 400);
  }
  if (gender !== 'male' && gender !== 'female') {
    return json({ error: 'gender must be male or female', code: 'bad_gender' }, 400);
  }
  if (wantsConversion && !voiceId) {
    return json({ error: 'No voice to render into', code: 'no_voice' }, 400);
  }
  if (wantsConversion && body.voiceGender !== gender) {
    return json(
      {
        error: 'A laugh can only be converted into a voice from its own gender pool',
        code: 'gender_mismatch',
      },
      400,
    );
  }
  if (durationMs < MIN_CLIP_MS) {
    return json({ error: `A laugh has to be at least ${MIN_CLIP_MS}ms`, code: 'too_short' }, 400);
  }
  if (durationMs > MAX_CLIP_MS) {
    return json(
      { error: `A laugh cannot be longer than ${MAX_CLIP_MS / 1000}s`, code: 'too_long' },
      400,
    );
  }

  const wav = decode(body.audioBase64);
  const originalResult = validateOriginalMp3(decode(body.rawMp3Base64));
  if (isFailure(originalResult)) {
    const { status, ...rest } = originalResult;
    return json(rest, status);
  }
  // LAME adds a fixed encoder delay and a final padded frame. A small overrun is expected;
  // a large one means the WAV, MP3 and claimed selection do not describe the same clip.
  if (Math.abs(originalResult.scan.durationMs - durationMs) > 120) {
    return json(
      {
        error: 'The original-performance MP3 does not match the selected duration',
        code: 'duration_mismatch',
        detail: `selected ${durationMs}ms; encoded ${originalResult.scan.durationMs}ms`,
      },
      400,
    );
  }

  // A failed optional re-performance cannot veto the original performance. Losing a good
  // source because STS handled it badly is precisely the failure this path removes.
  let convertedResult: Awaited<ReturnType<typeof convertToVoice>> | undefined;
  let conversionError: Omit<ConvertFailure, 'status'> | undefined;
  if (wantsConversion) {
    if (!env.ELEVENLABS_API_KEY) {
      conversionError = {
        error: 'The original was kept, but ELEVENLABS_API_KEY is not configured',
        code: 'no_key',
      };
    } else {
      convertedResult = await convertToVoice(
        env.ELEVENLABS_API_KEY,
        voiceId,
        wav,
        body.removeBackgroundNoise !== false,
      );
      if (isFailure(convertedResult)) {
        conversionError = {
          error: convertedResult.error,
          code: convertedResult.code,
          detail: convertedResult.detail,
        };
        convertedResult = undefined;
      }
    }
  }

  const label = (body.label ?? '').trim() || `${kind} ${new Date().toLocaleDateString()}`;
  const source: LaughSource = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    kind,
    gender,
    label,
    durationMs,
    bytes: wav.length,
  };
  const original: LaughRender = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceId: source.id,
    treatment: 'original',
    gender,
    kind,
    label,
    durationMs: originalResult.scan.durationMs,
    bytes: originalResult.bytes.length,
  };
  const converted: LaughRender | undefined = convertedResult && !isFailure(convertedResult)
    ? {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        sourceId: source.id,
        treatment: 'voice-converted',
        gender,
        kind,
        label,
        voiceId,
        voiceName: body.voiceName,
        durationMs: convertedResult.scan.durationMs,
        bytes: convertedResult.bytes.length,
      }
    : undefined;
  if (converted) source.preferredTreatmentByVoice = { [voiceId]: 'voice-converted' };

  await env.LIPSYNC.put(laughSourceKey(source.id), wav, {
    httpMetadata: { contentType: 'audio/wav' },
  });
  await env.LIPSYNC.put(laughRenderKey(original.id), originalResult.bytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });
  if (converted && convertedResult && !isFailure(convertedResult)) {
    await env.LIPSYNC.put(laughRenderKey(converted.id), convertedResult.bytes, {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
  }

  const latest = await readClips(env.LIPSYNC);
  await writeClips(env.LIPSYNC, {
    sources: [source, ...latest.sources],
    renders: [original, ...(converted ? [converted] : []), ...latest.renders],
  });

  const audition = converted && convertedResult && !isFailure(convertedResult)
    ? convertedResult.bytes
    : originalResult.bytes;
  return json({
    source,
    original,
    converted,
    render: converted ?? original,
    conversionError,
    audioBase64: encode(audition),
  });
}
