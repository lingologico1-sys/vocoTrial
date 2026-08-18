import { loadBundledKit } from './bundled';
import { fetchPublished, listPublished } from './library';
import { migrate, type FaceKit } from './kit';

/**
 * What this browser keeps of the face library, which is a cache and nothing more.
 *
 * There used to be two stores here, and the first one was the point: `kits`
 * held every kit this browser had authored, because IndexedDB was where a kit
 * lived. That is gone. A face authored on one laptop has to reach a student on
 * another, so the bucket became the home — saving *is* publishing now — and a
 * second home in the authoring browser would only be a copy to disagree with
 * it. See functions/api/faces/.
 *
 * What is left is `published`, which holds copies of what the library handed
 * back so that wearing a face costs one small listing request per page load
 * instead of re-downloading megabytes of artwork that has not changed since the
 * last one. Deleting it loses nothing — see publishedKit.
 *
 * IndexedDB rather than the localStorage the rest of the app uses for prefs,
 * and not as a matter of taste: a kit is eight PNGs, and a PNG base64-encoded
 * is a third larger again than the bytes it carries. One kit will not fit in
 * localStorage's five megabytes, let alone the several you want while comparing
 * two models on the same face.
 *
 * Which face is *worn* does stay in localStorage, as a bare string. It is
 * short, it is read on the live page's startup path where an async open would
 * be a nuisance, and losing it costs a re-pick rather than the artwork.
 */

const DB_NAME = 'vocotrial-facekits';
const DB_VERSION = 3;
const CACHE = 'published';
const SELECTED_KEY = 'vocotrial.facekit.face';

/** Where the selection lived while a pick could mean a kit in this browser. */
const LEGACY_SELECTED_KEY = 'vocotrial.facekit.selected';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE)) {
        db.createObjectStore(CACHE, { keyPath: 'id' });
      }
      // Added at version 3, and the only destructive line in this file. The
      // authored kits it drops were copied to the library by whoever published
      // them; anything never published was never reachable from a second
      // machine, which is the thing this whole arrangement exists to fix. The
      // guard is what makes the two upgrade paths — a browser arriving from an
      // older version and one arriving from nothing — run the same line.
      if (db.objectStoreNames.contains('kits')) {
        db.deleteObjectStore('kits');
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

/**
 * Which face is worn, by id, or null for the one this deployment ships with.
 *
 * A bare id, where this used to be a `source:id` pair. The pair existed because
 * the same id could mean two different things — a kit in this browser and a
 * face in the library, which shared an id and were not the same object. With
 * one of the two gone the ambiguity is gone, and so is the prefix.
 *
 * Read from a new key, because a bare id is also what the *oldest* form of the
 * old key looked like and the two cannot be told apart. So the old key is
 * migrated once and removed: a library pick carries over, and a pick of a kit
 * that only ever lived in this browser resolves to null — that kit is not
 * somewhere else now, it is gone, and the honest answer is the default face
 * rather than a dangling id.
 */
export function selectedFace(): string | null {
  try {
    const current = localStorage.getItem(SELECTED_KEY);
    if (current) return current;

    const legacy = localStorage.getItem(LEGACY_SELECTED_KEY);
    if (legacy === null) return null;
    localStorage.removeItem(LEGACY_SELECTED_KEY);

    const id = legacy.startsWith('published:') ? legacy.slice('published:'.length) : null;
    if (id) localStorage.setItem(SELECTED_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export function selectFace(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(SELECTED_KEY);
    else localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // A browser refusing storage is not a reason to fail the page; the face is
    // still worn this session, it just will not be remembered for the next.
  }
}

/**
 * A published face, from the cache when the cache is current.
 *
 * The listing is the authority on what is current, and it is cheap — names,
 * dates and thumbnails, no artwork. `publishedAt` is the whole comparison: a
 * save bumps it, so a stale copy is one that disagrees, and a copy that agrees
 * is byte-identical to what a download would return.
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
 * The face the live page should wear, or nothing.
 *
 * Nothing chosen falls back to whatever is checked into public/faces/, so a
 * fresh browser gets the deployment's own face rather than the placeholder.
 *
 * A chosen face that has gone missing does *not* fall back. That asymmetry is
 * deliberate: an empty selection is the ordinary state of a new visitor, while
 * a dangling one means something was deleted, and quietly substituting a
 * different face there would be a confusing thing to debug from the far side.
 */
export async function activeKit(): Promise<FaceKit | null> {
  const id = selectedFace();
  if (!id) return loadBundledKit();

  try {
    return await publishedKit(id);
  } catch {
    return null;
  }
}
