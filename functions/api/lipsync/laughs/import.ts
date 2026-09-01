import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import {
  convertToVoice,
  isFailure,
  validateOriginalMp3,
  type ConvertFailure,
} from './_convert';
import { REACTION_CLIP_KINDS } from '../../../../src/lipsync/tags';
import {
  laughRenderKey,
  laughSourceKey,
  type ReactionClipKind,
  type ReactionRender,
  type ReactionSource,
  type VoiceGender,
} from '../../../../src/lipsync/laughs';

/** Keep one recording, always raw and spliceable, and optionally re-perform it. */
interface ImportBody {
  audioBase64?: string;
  rawMp3Base64?: string;
  kind?: ReactionClipKind;
  gender?: VoiceGender;
  label?: string;
  voiceId?: string;
  voiceName?: string;
  voiceGender?: VoiceGender;
  convert?: boolean;
  durationMs?: number;
  removeBackgroundNoise?: boolean;
  /**
   * The level the page applied before encoding, and the peak it ended at.
   *
   * RECORDED BECAUSE IT CANNOT BE RECOVERED. Once samples are scaled and encoded there is
   * nothing in the bytes that says what they were scaled by, so without this every clip
   * arrives claiming an unknown level and the row's control has no reference point to
   * count from. The peak is what tells that control whether the clip can go up at all.
   */
  gainDb?: number;
  peak?: number;
}

/**
 * The shortest clip worth keeping, lowered from 150ms when the six new kinds arrived.
 *
 * A laugh is never this short and a gulp routinely is: swallowing is a single throat
 * click, and 150ms would have refused good ones. Below 100ms there is not enough for the
 * frame quantisation in _mp3.ts to place meaningfully — a cut lands within ~13ms of where
 * it was asked for, which at that length is most of the sound.
 */
const MIN_CLIP_MS = 100;
const MAX_CLIP_MS = 8000;

/**
 * How far the LAME encode may differ from the selection before the two are not the same
 * clip, as a fraction of the selection with an absolute floor.
 *
 * FLAT ±120ms WAS WRONG AT BOTH ENDS, and only the short end was ever exercised. LAME adds
 * a fixed encoder delay and a padded final frame, so the overhead does not scale with the
 * clip — which made 120ms a sane bound against a 1.5s laugh and a meaningless one against
 * a 150ms gulp, where it is 80% of the whole recording and would wave through an encode of
 * almost anything. The floor still covers the fixed overhead; the proportional term stops
 * the check going slack on exactly the lengths these new kinds live at.
 */
const DURATION_FLOOR_MS = 60;
const DURATION_TOLERANCE = 0.15;
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
  if (!kind || !(REACTION_CLIP_KINDS as string[]).includes(kind)) {
    return json(
      { error: `kind must be one of ${REACTION_CLIP_KINDS.join(', ')}`, code: 'bad_kind' },
      400,
    );
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
        error: 'A clip can only be converted into a voice from its own gender pool',
        code: 'gender_mismatch',
      },
      400,
    );
  }
  if (durationMs < MIN_CLIP_MS) {
    return json({ error: `A clip has to be at least ${MIN_CLIP_MS}ms`, code: 'too_short' }, 400);
  }
  if (durationMs > MAX_CLIP_MS) {
    return json(
      { error: `A clip cannot be longer than ${MAX_CLIP_MS / 1000}s`, code: 'too_long' },
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
  // See DURATION_TOLERANCE for why this is not the flat bound it used to be.
  const allowed = Math.max(DURATION_FLOOR_MS, Math.round(durationMs * DURATION_TOLERANCE));
  const off = Math.abs(originalResult.scan.durationMs - durationMs);
  if (off > allowed) {
    return json(
      {
        error: 'The original-performance MP3 does not match the selected duration',
        code: 'duration_mismatch',
        // Which bound applied, because "off by 90ms" reads very differently against a
        // 3s yawn and a 200ms sniff, and the reader cannot tell which without it.
        detail:
          `selected ${durationMs}ms; encoded ${originalResult.scan.durationMs}ms; ` +
          `off by ${off}ms, allowed ${allowed}ms`,
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
  const source: ReactionSource = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    kind,
    gender,
    label,
    durationMs,
    bytes: wav.length,
  };
  const level = {
    ...(typeof body.gainDb === 'number' ? { gainDb: body.gainDb } : {}),
    ...(typeof body.peak === 'number' ? { peak: body.peak } : {}),
  };
  const original: ReactionRender = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceId: source.id,
    treatment: 'original',
    gender,
    kind,
    label,
    durationMs: originalResult.scan.durationMs,
    bytes: originalResult.bytes.length,
    ...level,
  };
  const converted: ReactionRender | undefined = convertedResult && !isFailure(convertedResult)
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
        // The same level, because the WAV it was made from carried it. The peak is NOT
        // copied: speech-to-speech renders at the target voice's own level, so what came
        // back has a ceiling of its own that nothing here has measured. Absent reads as
        // unknown, and the page measures it on first use.
        ...(typeof body.gainDb === 'number' ? { gainDb: body.gainDb } : {}),
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
