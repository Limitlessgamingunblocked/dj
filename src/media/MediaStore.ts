/*
 * Where recordings live (Section 11.6): their audio, video, cover art and
 * thumbnails as Blobs in IndexedDB, in a database of their own (the music
 * library's database is left alone). The list of sets, with titles,
 * tracklists and grades, is a career save (core/models.ts → RECORDINGS);
 * this holds the files it points at.
 */

export interface StoredFile {
  id: string;
  blob: Blob;
  size: number;
  type: string;
  created: number;
}

const DB = 'deckhouse-media';
const STORE = 'files';

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('No IndexedDB here'));
        return;
      }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the recordings store'));
    });
    opening.catch(() => (opening = null));
  }
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
        tx.onerror = () => reject(tx.error ?? new Error('Storage failed'));
        tx.onabort = () => reject(tx.error ?? new Error('Storage was refused (out of space?)'));
      }),
  );
}

export const mediaStore = {
  async put(id: string, blob: Blob): Promise<void> {
    await run('readwrite', (s) => s.put({ id, blob, size: blob.size, type: blob.type, created: Date.now() } satisfies StoredFile));
  },

  async get(id: string): Promise<Blob | null> {
    const r = await run<StoredFile | undefined>('readonly', (s) => s.get(id));
    return r?.blob ?? null;
  },

  async delete(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await run('readwrite', (s) => {
      for (const id of ids) s.delete(id);
    });
  },

  /** every file's id and size (not the data) */
  async sizes(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    await run('readonly', (s) => {
      const req = s.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        const v = c.value as StoredFile;
        out.set(v.id, v.size);
        c.continue();
      };
      return req;
    });
    return out;
  },
};

/** how much the browser lets this page store, and how much is used (all of the app's storage) */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** ask the browser not to clear recordings under storage pressure */
export async function persistStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(n >= 100 << 20 ? 0 : 1)} MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))} KB`;
  return `${n} B`;
}
