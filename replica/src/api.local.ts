import { ApiError, type Api, type Goal, type SavedModel, type User } from './apiTypes';

/**
 * Accounts and saved models kept in this browser (IndexedDB), for the single-file preview that
 * has no server. Passwords are hashed with PBKDF2. Falls back to memory when storage is blocked.
 */

interface StoredUser extends User {
  passwordHash: string;
  createdAt: number;
}
interface StoredModel extends SavedModel {
  userId: number;
}

type StoreName = 'users' | 'models' | 'stls' | 'kv';

interface KeyValueStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  all<T>(store: StoreName): Promise<T[]>;
}

function memoryStore(): KeyValueStore {
  const maps = new Map<StoreName, Map<string, unknown>>();
  const m = (s: StoreName) => {
    if (!maps.has(s)) maps.set(s, new Map());
    return maps.get(s)!;
  };
  return {
    async get<T>(s: StoreName, k: string) {
      return m(s).get(k) as T | undefined;
    },
    async put(s, k, v) {
      m(s).set(k, v);
    },
    async delete(s, k) {
      m(s).delete(k);
    },
    async all<T>(s: StoreName) {
      return [...m(s).values()] as T[];
    },
  };
}

function idbStore(): Promise<KeyValueStore> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('replica-preview', 1);
    req.onupgradeneeded = () => {
      for (const s of ['users', 'models', 'stls', 'kv']) req.result.createObjectStore(s);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
    req.onsuccess = () => {
      const db = req.result;
      const run = <T>(s: StoreName, mode: IDBTransactionMode, op: (os: IDBObjectStore) => IDBRequest) =>
        new Promise<T>((ok, fail) => {
          const tx = db.transaction(s, mode);
          const r = op(tx.objectStore(s));
          tx.oncomplete = () => ok(r.result as T);
          tx.onerror = () => fail(tx.error);
          tx.onabort = () => fail(tx.error ?? new Error('Storage is full.'));
        });
      resolve({
        get: (s, k) => run(s, 'readonly', (os) => os.get(k)),
        put: (s, k, v) => run(s, 'readwrite', (os) => os.put(v, k)),
        delete: (s, k) => run(s, 'readwrite', (os) => os.delete(k)),
        all: (s) => run(s, 'readonly', (os) => os.getAll()),
      });
    };
  });
}

let storePromise: Promise<KeyValueStore> | null = null;
const store = () =>
  (storePromise ??= (async () => {
    try {
      return await idbStore();
    } catch {
      return memoryStore();
    }
  })());

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITERATIONS = 210000;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split('$');
  if (kind !== 'pbkdf2') return false;
  const actual = await derive(password, unb64(salt), Number(iter));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = ({ id, name, email, goal }: StoredUser): User => ({ id, name, email, goal });
const publicModel = ({ userId: _userId, ...m }: StoredModel): SavedModel => m;

async function currentUser(): Promise<StoredUser | null> {
  const s = await store();
  const email = await s.get<string>('kv', 'session');
  return email ? ((await s.get<StoredUser>('users', email)) ?? null) : null;
}

async function requireUser(): Promise<StoredUser> {
  const u = await currentUser();
  if (!u) throw new ApiError('Please log in.', 401);
  return u;
}

export const localApi: Api = {
  async me() {
    const u = await currentUser();
    return u ? publicUser(u) : null;
  },

  async signup(name, email, password, goal) {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName || cleanName.length > 80) throw new ApiError('Please enter your name (up to 80 characters).', 400);
    if (cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) throw new ApiError('Please enter a valid email address.', 400);
    if (password.length < 8) throw new ApiError('Your password needs at least 8 characters.', 400);
    if (password.length > 200) throw new ApiError('That password is too long (200 characters max).', 400);
    const s = await store();
    if (await s.get('users', cleanEmail)) throw new ApiError('An account with that email already exists. Try logging in.', 409);
    const user: StoredUser = {
      id: Date.now(),
      name: cleanName,
      email: cleanEmail,
      goal: goal ?? null,
      passwordHash: await hashPassword(password),
      createdAt: Date.now(),
    };
    await s.put('users', cleanEmail, user);
    await s.put('kv', 'session', cleanEmail);
    return publicUser(user);
  },

  async login(email, password, goal) {
    if (!email || !password) throw new ApiError('Enter your email and password.', 400);
    const s = await store();
    const cleanEmail = email.trim().toLowerCase();
    const user = await s.get<StoredUser>('users', cleanEmail);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError('That email and password don’t match an account.', 401);
    }
    if (goal && goal !== user.goal) {
      user.goal = goal;
      await s.put('users', cleanEmail, user);
    }
    await s.put('kv', 'session', cleanEmail);
    return publicUser(user);
  },

  async logout() {
    await (await store()).delete('kv', 'session');
    return { ok: true };
  },

  async setGoal(goal: Goal) {
    const user = await requireUser();
    user.goal = goal;
    await (await store()).put('users', user.email, user);
    return publicUser(user);
  },

  async listModels() {
    const user = await requireUser();
    const all = await (await store()).all<StoredModel>('models');
    return all
      .filter((m) => m.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(publicModel);
  },

  async saveModel(meta, stl) {
    const user = await requireUser();
    const s = await store();
    const model: StoredModel = { ...meta, id: crypto.randomUUID(), stlBytes: stl.byteLength, createdAt: Date.now(), userId: user.id };
    try {
      await s.put('stls', model.id, stl.slice(0));
      await s.put('models', model.id, model);
    } catch {
      throw new ApiError('Your browser is out of storage space for saved models. Delete some and try again.', 507);
    }
    return publicModel(model);
  },

  async modelStl(id) {
    const user = await requireUser();
    const s = await store();
    const m = await s.get<StoredModel>('models', id);
    const stl = m && m.userId === user.id ? await s.get<ArrayBuffer>('stls', id) : undefined;
    if (!stl) throw new ApiError('Couldn’t load that model.', 404);
    return stl;
  },

  async deleteModel(id) {
    const user = await requireUser();
    const s = await store();
    const m = await s.get<StoredModel>('models', id);
    if (!m || m.userId !== user.id) throw new ApiError('Model not found.', 404);
    await s.delete('models', id);
    await s.delete('stls', id);
    return { ok: true };
  },
};
