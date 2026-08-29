import { json } from '../_middleware';
import { type LipsyncEnv, readIndex, writeIndex } from './_library';
import {
  alignmentKey,
  audioKey,
  packageKey,
  summarise,
  type LipsyncPackage,
} from '../../../src/lipsync/published';

/**
 * Keeps a package that was worth keeping.
 *
 * Separate from generate.ts because generating is cheap to repeat and storing is not
 * cheap to undo: tuning a voice takes ten attempts, and nine of them are rubbish. The
 * same author-then-publish split faceKit uses, and for the same reason.
 *
 * Written in dependency order -- audio and alignment first, then the package that names
 * them, then the index. An interruption therefore leaves an orphaned object rather than
 * an index entry pointing at nothing, which is the failure a reader can survive.
 */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.LIPSYNC) {
    return json({ error: 'No lip-sync library is configured', code: 'no_bucket' }, 500);
  }

  let body: { package?: LipsyncPackage; audioBase64?: string; alignment?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }

  const pkg = body.package;
  if (!pkg?.id || !Array.isArray(pkg.marks)) {
    return json({ error: 'That is not a package', code: 'bad_package' }, 400);
  }
  if (!body.audioBase64) {
    return json({ error: 'A package without its audio is not playable', code: 'no_audio' }, 400);
  }

  const audio = Uint8Array.from(atob(body.audioBase64), (c) => c.charCodeAt(0));
  await env.LIPSYNC.put(audioKey(pkg.id), audio, {
    httpMetadata: { contentType: 'audio/mpeg' },
  });

  if (body.alignment) {
    await env.LIPSYNC.put(alignmentKey(pkg.id), JSON.stringify(body.alignment), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  await env.LIPSYNC.put(packageKey(pkg.id), JSON.stringify(pkg), {
    httpMetadata: { contentType: 'application/json' },
  });

  const lines = await readIndex(env.LIPSYNC);
  await writeIndex(env.LIPSYNC, [
    summarise(pkg),
    ...lines.filter((l) => l.id !== pkg.id),
  ]);

  return json({ line: summarise(pkg) });
}
