import { loadBundledKit } from './bundled';
import { fetchPublished, listPublished } from './library';
import { migrate, type FaceKit } from './kit';

/**
 * Where kits live between visits.
 *
 * IndexedDB rather than the localStorage the rest of the app uses for prefs,
 * and not as a matter of taste: a kit is eight PNGs, and a PNG base64-encoded
 * is a third larger again than the bytes it carries. One kit will not fit in
 * localStorage's five megabytes, let alone the several you want while
 * comparing two models on the same face.
 *
 * Two stores, and the second is a cache rather than a home. `kits` holds what
 * this browser authored; `published` holds copies of what the shared library
 * handed back, so that wearing a published face costs one small listing request
 * per page load instead of re-downloading megabytes of artwork that has not
 * changed since the last one. Deleting it loses nothing — see publishedKit.
 *
 * Which kit is *in use* does stay in localStorage, as a bare string. It is
 * short, it is read on the live page's startup path where an async open would
 * be a nuisance, and losing it costs a re-pick rather than the artwork.
 */

const DB_NAME = 'vocotrial-facekits';
const DB_VERSION = 2;
const STORE = 'kits';
const CACHE = 'published';
const SELECTED_KEY = 'vocotrial.facekit.selected';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      // Added at version 2. Guarded the same way as the first, so the two
      // upgrade paths — a browser arriving from version 1 and one arriving from
      // nothing — run the same line and neither needs a version to branch on.
      if (!db.objectStoreNames.contains(CACHE)) {
        db.createObjectStore(CACHE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open'));
  });
}

function run<T>(
  name: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const request = work(tx.objectStore(name));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('That store request failed'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export function saveKit(kit: FaceKit): Promise<unknown> {
  return run(STORE, 'readwrite', (store) => store.put(kit));
}

export function deleteKit(id: string): Promise<unknown> {
  return run(STORE, 'readwrite', (store) => store.delete(id));
}

// Everything leaves the store already brought forward, so nothing downstream
// has to know that older kits exist. Migration is not written back on read: a
// kit is saved when it is next edited, and rewriting the store from a getter
// would turn opening the page into a write.
export async function loadKit(id: string): Promise<FaceKit | undefined> {
  const kit = await run<FaceKit | undefined>(STORE, 'readonly', (store) => store.get(id));
  return kit ? migrate(kit) : undefined;
}

export async function listKits(): Promise<FaceKit[]> {
  const kits = await run<FaceKit[]>(STORE, 'readonly', (store) => store.getAll());
  return kits.map(migrate).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Which kit is worn, and which of the two places it came from.
 *
 * The source is part of the selection because the same id can mean two
 * different things: a published face keeps the id of the kit it was published
 * from, so "wear kit X" is ambiguous the moment X exists both in this browser
 * and in the library. Storing which one was picked is the difference between a
 * page that re-fetches a face you already have locally and one that does not.
 */
export type KitSource = 'local' | 'published';

export interface KitRef {
  source: KitSource;
  id: string;
}

/**
 * A value with no colon is a kit id written before sources existed, and means
 * local — the only thing it could have meant. No migration is needed beyond
 * reading it that way, and the next pick writes the new form over it.
 */
export function selectedKit(): KitRef | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return null;
    const split = raw.indexOf(':');
    if (split < 0) return { source: 'local', id: raw };
    const source = raw.slice(0, split);
    if (source !== 'local' && source !== 'published') return null;
    return { source, id: raw.slice(split + 1) };
  } catch {
    return null;
  }
}

export function selectKit(ref: KitRef | null): void {
  try {
    if (ref === null) localStorage.removeItem(SELECTED_KEY);
    else localStorage.setItem(SELECTED_KEY, `${ref.source}:${ref.id}`);
  } catch {
    // A browser refusing storage is not a reason to fail the page; the kit is
    // still usable this session, it just will not be remembered for the next.
  }
}

/**
 * A published face, from the cache when the cache is current.
 *
 * The listing is the authority on what is current, and it is cheap — names,
 * dates and thumbnails, no artwork. `publishedAt` is the whole comparison: a
 * republish bumps it, so a stale copy is one that disagrees, and a copy that
 * agrees is byte-identical to what a download would return.
 *
 * Cache failures are swallowed on both sides. A browser in private mode, or one
 * out of quota, should be slower than a browser that can cache — not broken.
 */
export async function publishedKit(id: string): Promise<FaceKit | null> {
  const entry = (await listPublished()).find((face) => face.id === id);
  if (!entry) return null;

  const cached = await run<{ publishedAt: number; kit: FaceKit } | undefined>(
    CACHE,
    'readonly',
    (store) => store.get(id),
  ).catch(() => undefined);

  if (cached && cached.publishedAt === entry.publishedAt) return migrate(cached.kit);

  const kit = await fetchPublished(id);
  await run(CACHE, 'readwrite', (store) =>
    store.put({ id, publishedAt: entry.publishedAt, kit }),
  ).catch(() => undefined);

  return kit;
}

/**
 * The kit the live page should wear, or nothing.
 *
 * Nothing chosen falls back to whatever is checked into public/faces/, so a
 * fresh browser gets the deployment's own face rather than the placeholder.
 *
 * A chosen kit that has gone missing does *not* fall back. That asymmetry is
 * deliberate: an empty selection is the ordinary state of a new visitor, while
 * a dangling one means something was deleted or unpublished, and quietly
 * substituting a different face there would be a confusing thing to debug from
 * the far side.
 */
export async function activeKit(): Promise<FaceKit | null> {
  const ref = selectedKit();
  if (!ref) return loadBundledKit();

  try {
    if (ref.source === 'published') return await publishedKit(ref.id);
    return (await loadKit(ref.id)) ?? null;
  } catch {
    return null;
  }
}
