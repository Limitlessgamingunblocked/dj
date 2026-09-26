/*
 * IndexedDB persistence (tracks + analysis cache, audio blobs, crates).
 * Falls back to in-memory storage when IndexedDB is unavailable.
 */
const DB_NAME = 'deckhouse';
const DB_VERSION = 1;
const STORES = ['tracks', 'blobs', 'kv'] as const;
type Store = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<Store, Map<string, unknown>>(STORES.map((s) => [s, new Map()]));

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPut(store: Store, key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    memory.get(store)!.set(key, value);
    return;
  }
  try {
    await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
  } catch (err) {
    console.warn('IndexedDB write failed, keeping in memory', err);
    memory.get(store)!.set(key, value);
  }
}

export async function dbGet<T>(store: Store, key: string): Promise<T | undefined> {
  const mem = memory.get(store)!.get(key) as T | undefined;
  if (mem !== undefined) return mem;
  const db = await open();
  if (!db) return undefined;
  try {
    return (await wrap(db.transaction(store).objectStore(store).get(key))) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function dbDelete(store: Store, key: string): Promise<void> {
  memory.get(store)!.delete(key);
  const db = await open();
  if (!db) return;
  try {
    await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
  } catch {
    /* ignore */
  }
}

export async function dbAll<T>(store: Store): Promise<T[]> {
  const out = [...memory.get(store)!.values()] as T[];
  const db = await open();
  if (!db) return out;
  try {
    const vals = (await wrap(db.transaction(store).objectStore(store).getAll())) as T[];
    return [...vals, ...out];
  } catch {
    return out;
  }
}

export async function storageAvailable(): Promise<boolean> {
  return (await open()) !== null;
}
