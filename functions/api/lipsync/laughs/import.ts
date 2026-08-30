import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import { convertToVoice, isFailure } from './_convert';
import {
  laughRenderKey,
  laughSourceKey,
  type LaughRender,
  type LaughSource,
  type LaughKind,
} from '../../../../src/lipsync/laughs';

/**
 * A laugh you provided, kept as a recording and rendered into the voice in hand.
 *
 * WHY IMPORT DOES BOTH. A source with no render is not yet usable for anything, and a
 * render with no source cannot be carried to another voice — so the first render is part of
 * importing rather than a second step somebody has to know to take. Every render after the
 * first is `render.ts`, which is the same conversion against a source that already exists.
 *
 * THE FILE ARRIVES ALREADY TRIMMED, as 16-bit mono PCM WAV cut in the browser. That is not
 * an arbitrary division of labour: the Workers runtime has no codec, so it cannot open an
 * m4a or find where a laugh starts, whereas a browser has already decoded the file to
 * samples in order to draw the trim. See src/lipsync/audioTrim.ts. What arrives here is
 * therefore exactly the selection, and this route never has to interpret audio at all —
 * it hands the bytes to ElevenLabs and checks what comes back.
 *
 * Written in dependency order, the order save.ts uses: the source object, then the render
 * object, then the index naming both. An interruption leaves an object nobody lists rather
 * than a listing that points at nothing.
 */

interface ImportBody {
  /** The trimmed selection, WAV, base64. */
  audioBase64?: string;
  kind?: LaughKind;
  label?: string;
  /** The voice to render into first. The one the page currently has loaded. */
  voiceId?: string;
  voiceName?: string;
  /** How long the selection is, measured in the browser where the samples were. */
  durationMs?: number;
  removeBackgroundNoise?: boolean;
}

/**
 * Bounds on what is worth importing.
 *
 * The floor is below the shortest giggle and above a mis-drag that selected nothing. The
 * ceiling is not a claim about laughter — some are long — but about a selection that took
 * the whole recording with it, which is indistinguishable from a deliberate one except by
 * length, and which would be charged for as a conversion either way.
 */
const MIN_CLIP_MS = 150;
const MAX_CLIP_MS = 8000;

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

  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }

  const kind = body.kind;
  const voiceId = (body.voiceId ?? '').trim();
  const durationMs = Math.round(body.durationMs ?? 0);

  if (!body.audioBase64) return json({ error: 'No audio', code: 'no_audio' }, 400);
  if (kind !== 'laughs' && kind !== 'giggles') {
    return json({ error: 'kind must be laughs or giggles', code: 'bad_kind' }, 400);
  }
  if (!voiceId) return json({ error: 'No voice to render into', code: 'no_voice' }, 400);
  if (durationMs < MIN_CLIP_MS) {
    return json(
      { error: `A laugh has to be at least ${MIN_CLIP_MS}ms`, code: 'too_short' },
      400,
    );
  }
  if (durationMs > MAX_CLIP_MS) {
    return json(
      { error: `A laugh cannot be longer than ${MAX_CLIP_MS / 1000}s`, code: 'too_long' },
      400,
    );
  }

  const wav = Uint8Array.from(atob(body.audioBase64), (c) => c.charCodeAt(0));

  // Converted BEFORE anything is stored, so a conversion that fails leaves no orphan
  // source behind for somebody to wonder about later. The recording is only worth keeping
  // once it is known to be convertible.
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

  const label = (body.label ?? '').trim() || `${kind} ${new Date().toLocaleDateString()}`;

  const source: LaughSource = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    kind,
    label,
    durationMs,
    bytes: wav.length,
  };

  const render: LaughRender = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    sourceId: source.id,
    kind,
    label,
    voiceId,
    voiceName: body.voiceName,
    // The converted length, not the selection's. Speech-to-speech re-performs rather than
    // transforms, so what comes back is close to the input but not identical to it — and
    // it is this number the face's laugh is fitted to.
    durationMs: converted.scan.durationMs,
    bytes: converted.bytes.length,
  };

  await env.LIPSYNC.put(laughSourceKey(source.id), wav, {
    httpMetadata: { contentType: 'audio/wav' },
  });
  await env.LIPSYNC.put(laughRenderKey(render.id), converted.bytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });

  const library = await readClips(env.LIPSYNC);
  await writeClips(env.LIPSYNC, {
    sources: [source, ...library.sources],
    renders: [render, ...library.renders],
  });

  let binary = '';
  for (let i = 0; i < converted.bytes.length; i++) {
    binary += String.fromCharCode(converted.bytes[i]);
  }

  // The rendered audio comes straight back so it can be auditioned without a second
  // round trip. Whether the conversion is any good is the only question that matters
  // here, and it should be answerable the instant the button stops spinning.
  return json({ source, render, audioBase64: btoa(binary) });
}
