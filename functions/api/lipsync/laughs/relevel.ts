import { json } from '../../_middleware';
import { type LipsyncEnv, readClips, writeClips } from '../_library';
import { isFailure, validateOriginalMp3 } from './_convert';
import { laughRenderKey } from '../../../../src/lipsync/laughs';

/**
 * The same performance, re-encoded at a different level.
 *
 * WHY THIS EXISTS AT ALL, given that gain is applied at import. Loudness is the one thing
 * about a clip that cannot be judged when it is chosen. It is judged against a line, and
 * the line does not exist yet — so an import-time decision is a guess made in the only
 * place the guess cannot be checked. Without this route, correcting it means deleting the
 * source and importing the file again, which also destroys every conversion made from it:
 * paying ElevenLabs a second time to fix a slider.
 *
 * WHY THE BROWSER SENDS BYTES RATHER THAN A NUMBER. The Worker has no codec. Everything
 * about this feature follows from that — the splice joins frames precisely because it
 * cannot decode them — so a level can only be changed where the samples are, which is the
 * page. This route's job is to check what comes back and swap it in, not to produce it.
 *
 * NOT DESTRUCTIVE IN THE WAY IT LOOKS. Re-levelling an original re-encodes from the WAV,
 * which is kept untouched and is the reason sources are kept at all. Re-levelling a
 * conversion re-encodes the stored MP3, which is lossy a second time — worth knowing, and
 * still far cheaper than another speech-to-speech charge for the same performance.
 */

interface RelevelBody {
  renderId?: string;
  rawMp3Base64?: string;
  /** What the page applied, recorded so the row can show where it currently sits. */
  gainDb?: number;
}

const decode = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  let body: RelevelBody;
  try {
    body = (await request.json()) as RelevelBody;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }

  const renderId = (body.renderId ?? '').trim();
  if (!renderId) return json({ error: 'No clip named', code: 'no_render' }, 400);
  if (!body.rawMp3Base64) return json({ error: 'No audio', code: 'no_audio' }, 400);

  const library = await readClips(env.LIPSYNC);
  const render = library.renders.find((entry) => entry.id === renderId);
  if (!render) return json({ error: 'No such clip', code: 'not_found' }, 404);

  // The same gate the import path uses, and for the same reason: a clip whose format does
  // not match generated speech is skipped silently at splice time, so a bad encode here
  // would present as "the reaction stopped happening" with nothing to see.
  const encoded = validateOriginalMp3(decode(body.rawMp3Base64));
  if (isFailure(encoded)) {
    const { status, ...rest } = encoded;
    return json(rest, status);
  }

  await env.LIPSYNC.put(laughRenderKey(render.id), encoded.bytes, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });

  // Duration is re-read rather than assumed unchanged. A pure gain change should not move
  // it, but LAME's padding can land a frame either way, and this number is what the face's
  // span is built from — so a stale one is a gesture that outlasts its own sound.
  const updated = {
    ...render,
    durationMs: encoded.scan.durationMs,
    bytes: encoded.bytes.length,
    gainDb: typeof body.gainDb === 'number' ? body.gainDb : render.gainDb,
  };

  await writeClips(env.LIPSYNC, {
    sources: library.sources,
    renders: library.renders.map((entry) => (entry.id === render.id ? updated : entry)),
  });

  return json({ render: updated });
}
