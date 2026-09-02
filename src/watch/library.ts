import { migrate, type FaceKit } from '../facekit/kit';
import { reposed } from '../live/visemeTable';
import type { LipsyncPackage } from '../lipsync/published';

/**
 * The only two calls a visitor with no password makes.
 *
 * Separate from lipsync/library.ts rather than folded into it, because that module is
 * the authoring surface: it can generate, save, delete and spend. Nothing on this page
 * should be able to reach any of that even by a typo in a route name, and the cheapest
 * way to guarantee it is a module whose base path cannot address those routes at all.
 */

async function post<T>(route: string, token: string): Promise<T> {
  const response = await fetch(`/api/share/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ t: token }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? 'That link is not valid');
  }
  return (await response.json()) as T;
}

/**
 * The take, with its poses re-resolved on the way in.
 *
 * `reposed` for the same reason fetchLine does it: a package was baked against the
 * viseme table as it stood the day it was made, and this build is entitled to a current
 * opinion about what each identifier should look like.
 */
export async function fetchShared(
  token: string,
): Promise<{ package: LipsyncPackage; audioBase64?: string }> {
  const got = await post<{ package: LipsyncPackage; audioBase64?: string }>('take', token);
  return { ...got, package: { ...got.package, marks: reposed(got.package.marks) } };
}

/**
 * The face that link was made with, or null for the deployment's own.
 *
 * Null is not a failure — see functions/api/share/face.ts. The caller falls back to the
 * bundled kit, which is what an empty selection has always meant.
 */
export async function fetchSharedFace(token: string): Promise<FaceKit | null> {
  const got = await post<FaceKit | { kit: null }>('face', token);
  return got && 'kit' in got && got.kit === null ? null : migrate(got as FaceKit);
}
