import { loadBundledKit } from './bundled';
import { migrate, type FaceKit } from './kit';

/**
 * Where kits live between visits.
 *
 * IndexedDB rather than the localStorage the rest of the app uses for prefs,
 * and not as a matter of taste: a kit is eight PNGs, and a PNG base64-encoded
 * is a third larger again than the bytes it carries. One kit will not fit in
 * localStorage's five megabytes, let alone the several you want while
 * comparing two providers on the same face.
 *
 * Which kit is *in use* does stay in localStorage, as a bare id. It is a single
 * short string, it is read on the live page's startup path where an async open
 * would be a nuisance, and losing it costs a re-pick rather than the artwork.
 */

const DB_NAME = 'vocotrial-facekits';
const DB_VERSION = 1;
const STORE = 'kits';
const SELECTED_KEY = 'vocotrial.facekit.selected';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('That store request failed'));
        tx.oncomplete = () => db.close();
      }),
  );
}

export function saveKit(kit: FaceKit): Promise<unknown> {
  return run('readwrite', (store) => store.put(kit));
}

export function deleteKit(id: string): Promise<unknown> {
  return run('readwrite', (store) => store.delete(id));
}

// Everything leaves the store already brought forward, so nothing downstream
// has to know that older kits exist. Migration is not written back on read: a
// kit is saved when it is next edited, and rewriting the store from a getter
// would turn opening the page into a write.
export async function loadKit(id: string): Promise<FaceKit | undefined> {
  const kit = await run<FaceKit | undefined>('readonly', (store) => store.get(id));
  return kit ? migrate(kit) : undefined;
}

export async function listKits(): Promise<FaceKit[]> {
  const kits = await run<FaceKit[]>('readonly', (store) => store.getAll());
  return kits.map(migrate).sort((a, b) => b.createdAt - a.createdAt);
}

export function selectedKitId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function selectKit(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(SELECTED_KEY);
    else localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // A browser refusing storage is not a reason to fail the page; the kit is
    // still usable this session, it just will not be remembered for the next.
  }
}

/**
 * The kit the live page should wear, or nothing.
 *
 * Nothing chosen falls back to whatever is checked into public/faces/, so a
 * fresh browser gets the deployment's own face rather than the placeholder.
 *
 * A chosen kit that has gone missing does *not* fall back. That asymmetry is
 * deliberate: an empty selection is the ordinary state of a new visitor, while
 * a dangling one means something was deleted, and quietly substituting a
 * different face there would be a confusing thing to debug from the far side.
 */
export async function activeKit(): Promise<FaceKit | null> {
  const id = selectedKitId();
  if (!id) return loadBundledKit();
  try {
    return (await loadKit(id)) ?? null;
  } catch {
    return null;
  }
}
