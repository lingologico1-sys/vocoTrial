import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import { frameAt, frameTimeMs, framesOf, scanMp3 } from '../_mp3';
import { audioKey, packageKey, type LipsyncPackage } from '../../../../src/lipsync/published';
import { laughClipKey, type LaughClip, type LaughKind } from '../../../../src/lipsync/laughs';

/**
 * A laugh cut out of a saved line and kept, to be spliced into later ones.
 *
 * THE HARVEST IS THE WHOLE POINT, and it is why this route exists rather than an upload
 * one. ElevenLabs renders a genuinely good laugh often enough — just not reliably, which
 * is the problem being solved. So the library is built out of the takes where it did: the
 * clip is the same voice on the same endpoint at the same settings as the speech it will
 * later be joined to, which is what makes the splice a byte concatenation instead of a
 * decode, a resample and a re-encode. See _mp3.ts.
 *
 * A file from outside would have none of those guarantees. It would need transcoding, and
 * the Workers runtime has no codec — so accepting one would mean a second service, a
 * second round trip, and a per-clip argument about loudness and timbre that harvesting
 * simply does not have. There is no upload path here on purpose.
 *
 * NOTHING IS RE-ENCODED. The clip is a contiguous run of frames lifted out of the source
 * MP3 and stored as-is, so it is bit-for-bit the audio that was already approved. What
 * that costs is that the in and out points land on frame boundaries, 26ms apart at
 * 44.1kHz; the times actually cut at come back in the response rather than being rounded
 * silently, because a UI showing a waveform should show where the cut really went.
 */

interface CutBody {
  /** The saved line to cut from. Its audio is the only source a clip can have. */
  sourceId?: string;
  kind?: LaughKind;
  startMs?: number;
  endMs?: number;
  label?: string;
}

/**
 * Bounds on a clip, both of which have caught a real mistake in testing.
 *
 * The floor is below the shortest giggle worth keeping and above a mis-click, which
 * otherwise stores a single frame of a consonant and offers it forever as a laugh. The
 * ceiling is not about laughter — some are genuinely long — but about a dragged selection
 * that took the sentence with it, which is indistinguishable from a deliberate cut except
 * by length.
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

  let body: CutBody;
  try {
    body = (await request.json()) as CutBody;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }

  const sourceId = (body.sourceId ?? '').trim();
  const kind = body.kind;
  const startMs = Math.max(0, Math.round(body.startMs ?? -1));
  const endMs = Math.round(body.endMs ?? -1);

  if (!sourceId) return json({ error: 'No line to cut from', code: 'no_source' }, 400);
  if (kind !== 'laughs' && kind !== 'giggles') {
    return json({ error: 'kind must be laughs or giggles', code: 'bad_kind' }, 400);
  }
  if (!(endMs > startMs)) {
    return json({ error: 'That selection has no length', code: 'bad_range' }, 400);
  }

  const [audio, pkgObject] = await Promise.all([
    env.LIPSYNC.get(audioKey(sourceId)),
    env.LIPSYNC.get(packageKey(sourceId)),
  ]);
  if (!audio) return json({ error: 'No audio for that line', code: 'not_found' }, 404);
  if (!pkgObject) return json({ error: 'No such line', code: 'not_found' }, 404);

  const pkg = (await pkgObject.json()) as LipsyncPackage;
  const bytes = new Uint8Array(await audio.arrayBuffer());

  const scan = scanMp3(bytes);
  if (!scan) {
    return json({ error: 'That audio is not an MP3 this can cut', code: 'unreadable' }, 422);
  }

  const from = frameAt(scan, startMs);
  const to = frameAt(scan, endMs);
  const cutFromMs = frameTimeMs(scan, from);
  const cutToMs = frameTimeMs(scan, to);
  const durationMs = cutToMs - cutFromMs;

  if (durationMs < MIN_CLIP_MS) {
    return json(
      { error: `A clip has to be at least ${MIN_CLIP_MS}ms`, code: 'too_short' },
      400,
    );
  }
  if (durationMs > MAX_CLIP_MS) {
    return json(
      { error: `A clip cannot be longer than ${MAX_CLIP_MS / 1000}s`, code: 'too_long' },
      400,
    );
  }

  const clipBytes = framesOf(bytes, scan, from, to);

  const clip: LaughClip = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    kind,
    // From the package rather than from the request. The voice a clip may be spliced
    // into is a fact about where its bytes came from, and letting a caller assert it
    // would make it possible to file a laugh under a voice that never made it.
    voiceId: pkg.voiceId,
    voiceName: pkg.voiceName,
    label: (body.label ?? '').trim() || `${kind} from ${pkg.name}`,
    durationMs,
    bytes: clipBytes.length,
    sourceId,
    sourceName: pkg.name,
  };

  // Audio first, then the index — the order save.ts uses, so an interruption leaves an
  // object nobody lists rather than a listing pointing at nothing.
  await env.LIPSYNC.put(laughClipKey(clip.id), clipBytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });
  const clips = await readClips(env.LIPSYNC);
  await writeClips(env.LIPSYNC, [clip, ...clips]);

  let binary = '';
  for (let i = 0; i < clipBytes.length; i++) binary += String.fromCharCode(clipBytes[i]);

  return json({ clip, audioBase64: btoa(binary), cutFromMs, cutToMs });
}
