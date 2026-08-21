import { blobToDataUrl } from './canvas';
import { KIT_FORMAT, migrate, type Boxes, type FaceKit } from './kit';
import type { Persona } from './persona';
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

/**
 * The id a bundled kit takes, stated so that other code can ask for it by name.
 *
 * It has to be derivable rather than random, because the library keys on it:
 * importing the shipped face twice must replace one entry rather than grow a
 * second, and faceKit has to be able to ask "is it already in there" without
 * having fetched the manifest first.
 */
export function bundledId(name = 'face'): string {
  return `bundled-${name}`;
}

interface BundledManifest {
  format?: number;
  name?: string;
  base?: string;
  boxes?: Boxes;
  patches?: Partial<Record<SlotId, string>>;
  lashes?: LashStyle;
  /**
   * Carried through like the rest of the manifest, and it is the one member
   * here that is not about pixels. A committed face is the one every fresh
   * browser wears, so it is the face most in need of somebody to be — and
   * dropping it here would quietly make the two routes into a kit disagree.
   */
  persona?: Persona;
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
      id: bundledId(name),
      name: manifest.name ?? name,
      createdAt: 0,
      base: `${dir}/${manifest.base}`,
      boxes: manifest.boxes,
      patches,
      lashes: manifest.lashes,
      persona: manifest.persona,
      spentUsd: 0,
    });
  } catch {
    return null;
  }
}

/**
 * The same kit with its artwork inlined, ready for the library.
 *
 * The one difference between a bundled kit and an authored one is how the
 * images are addressed — paths here, data URLs there — and nothing that *wears*
 * a face cares, which is why loadBundledKit does not do this. What cares is
 * publishing. A kit in the bucket is the only copy of itself, so one holding
 * `/faces/face/base.png` would be the single entry in the library that is not
 * bytes: it would break the day the deployment stopped shipping that folder,
 * and it would break differently on a browser reading the library from a domain
 * that serves no such path. Importing the shipped face means importing it, not
 * filing a reference to it.
 *
 * Data URLs are passed through untouched, so this is safe to run on a kit that
 * has already been through it, and cheap on one that never had paths.
 */
export async function inlineKit(kit: FaceKit): Promise<FaceKit> {
  const inline = async (src: string): Promise<string> => {
    if (src.startsWith('data:')) return src;
    const response = await fetch(src);
    if (!response.ok) throw new Error(`${src} could not be read`);
    return blobToDataUrl(await response.blob());
  };

  const patches: Partial<Record<SlotId, string>> = {};
  for (const [slot, src] of Object.entries(kit.patches)) {
    if (typeof src === 'string') patches[slot as SlotId] = await inline(src);
  }

  return { ...kit, base: await inline(kit.base), patches };
}
