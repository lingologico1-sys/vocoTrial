import { KIT_FORMAT, migrate, type Boxes, type FaceKit } from './kit';
import type { LashStyle, SlotId } from './slots';

/**
 * The kit checked into public/faces/, for a browser that has never authored one.
 *
 * The same manifest /facekit exports, read back — which is the point of the two
 * routes sharing a format. What differs is only how the images are addressed:
 * a stored kit inlines them as data URLs, because IndexedDB has nowhere to put
 * a file, while a bundled one keeps them as paths. Nothing downstream cares.
 * Both `<image href>` in the live face and `loadImage` in the compositor take a
 * URL, and a same-origin path needs no CORS consideration.
 *
 * A missing or malformed bundle is not an error worth surfacing: it means this
 * deployment ships no default face, and the drawn placeholder is the right thing
 * to fall back to.
 */

const BUNDLED_DIR = '/faces';

interface BundledManifest {
  format?: number;
  name?: string;
  base?: string;
  boxes?: Boxes;
  patches?: Partial<Record<SlotId, string>>;
  lashes?: LashStyle;
}

export async function loadBundledKit(name = 'face'): Promise<FaceKit | null> {
  const dir = `${BUNDLED_DIR}/${name}`;

  try {
    const response = await fetch(`${dir}/manifest.json`);
    if (!response.ok) return null;

    const manifest = (await response.json()) as BundledManifest;
    if (!manifest.base || !manifest.boxes) return null;

    const patches: Partial<Record<SlotId, string>> = {};
    for (const [slot, file] of Object.entries(manifest.patches ?? {})) {
      if (typeof file === 'string') patches[slot as SlotId] = `${dir}/${file}`;
    }

    // Through the same migration a stored kit gets, so a bundle committed
    // against an older format is not a second thing to remember to update.
    return migrate({
      format: manifest.format ?? KIT_FORMAT,
      id: `bundled-${name}`,
      name: manifest.name ?? name,
      createdAt: 0,
      base: `${dir}/${manifest.base}`,
      boxes: manifest.boxes,
      patches,
      lashes: manifest.lashes,
      spentUsd: 0,
    });
  } catch {
    return null;
  }
}
