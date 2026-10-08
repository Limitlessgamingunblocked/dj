/*
 * Saving the career: the profile, progress, looks, boards, crates, bookings
 * and the recordings list. Each kind of data is saved on its own, in an
 * envelope with a format version:
 *   { format: 'deckhouse-save', kind, version, savedAt, data }
 *   – loading an older version runs its migrations one version at a time,
 *     then the kind's validator (unknown fields dropped, numbers clamped,
 *     bad values back to defaults), so an old or hand-edited save can't
 *     break the game
 *   – every write first copies the previous good save to a backup slot; a
 *     save that won't parse or validate falls back to that backup, then to a
 *     fresh start, and says so
 *   – a save written by a newer version of the game is read as well as it
 *     can be and never overwritten
 * Career saves live under their own prefix, so "reset settings" doesn't wipe
 * a career. Storage is localStorage by default; tests pass an in-memory one.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const SAVE_PREFIX = 'deckhouse-save:';
export const SAVE_FORMAT = 'deckhouse-save';

/** localStorage, guarded: private windows and sandboxes can refuse it (then the career only lasts the session) */
export const browserStore: KeyValueStore = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* full or unavailable */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* unavailable */
    }
  },
};

export function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

export interface SaveSpec<T> {
  /** what this is: 'profile', 'progress', 'looks'… (also its storage key) */
  kind: string;
  /** the current format version */
  version: number;
  /** migrations[v] turns version v data into version v + 1 */
  migrations: Record<number, (data: unknown) => unknown>;
  /** checks and repairs data of the current version; never throws for bad values, only for hopeless input */
  validate(data: unknown): T;
  defaults(): T;
}

export interface Envelope {
  format: typeof SAVE_FORMAT;
  kind: string;
  version: number;
  savedAt: string;
  data: unknown;
}

export interface Loaded<T> {
  data: T;
  /** where it came from: the save, its backup, or a fresh start */
  from: 'save' | 'backup' | 'new';
  /** the version it was saved at, if migrated */
  migratedFrom?: number;
  /** written by a newer game: read as best we can, and never overwritten */
  newer?: boolean;
  /** what went wrong, if the save couldn't be used */
  problem?: string;
}

export class SaveSystem {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, () => void>();
  private readOnly = new Set<string>();

  constructor(
    private store: KeyValueStore = browserStore,
    private prefix = SAVE_PREFIX,
    private now: () => Date = () => new Date(),
  ) {}

  private key(kind: string, backup = false): string {
    return this.prefix + kind + (backup ? '.bak' : '');
  }

  /** Read and upgrade one envelope; throws with a reason when it can't be used. */
  private decode<T>(spec: SaveSpec<T>, raw: string): Omit<Loaded<T>, 'from'> {
    let env: Partial<Envelope>;
    try {
      env = JSON.parse(raw) as Partial<Envelope>;
    } catch {
      throw new Error('not readable (damaged JSON)');
    }
    if (!env || typeof env !== 'object' || env.format !== SAVE_FORMAT) throw new Error('not a DeckHouse save');
    if (env.kind !== spec.kind) throw new Error(`holds ${String(env.kind)}, not ${spec.kind}`);
    const v = env.version;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('has no valid version');
    if (v > spec.version) return { data: spec.validate(env.data), newer: true };
    let data = env.data;
    for (let at = v; at < spec.version; at++) {
      const step = spec.migrations[at];
      if (!step) throw new Error(`can't be upgraded from version ${at}`);
      data = step(data);
    }
    return { data: spec.validate(data), migratedFrom: v < spec.version ? v : undefined };
  }

  load<T>(spec: SaveSpec<T>): Loaded<T> {
    const main = this.store.get(this.key(spec.kind));
    let problem: string | undefined;
    if (main !== null) {
      try {
        const r = this.decode(spec, main);
        if (r.newer) this.readOnly.add(spec.kind);
        else this.readOnly.delete(spec.kind);
        return { ...r, from: 'save' };
      } catch (e) {
        problem = `The ${spec.kind} save is ${(e as Error).message}.`;
      }
    }
    const bak = this.store.get(this.key(spec.kind, true));
    if (bak !== null) {
      try {
        const r = this.decode(spec, bak);
        if (r.newer) this.readOnly.add(spec.kind);
        return { ...r, from: 'backup', problem: problem ?? `The ${spec.kind} save was missing; the backup was used.` };
      } catch (e) {
        problem = (problem ? problem + ' ' : '') + `Its backup is ${(e as Error).message}.`;
      }
    }
    return { data: spec.defaults(), from: 'new', problem };
  }

  /**
   * Write now. The previous save, if it's good, becomes the backup first.
   * Returns false when it couldn't (a newer game's save is never overwritten).
   */
  save<T>(spec: SaveSpec<T>, data: T): boolean {
    this.cancel(spec.kind);
    if (this.readOnly.has(spec.kind)) return false;
    const k = this.key(spec.kind);
    const prev = this.store.get(k);
    if (prev !== null) {
      let good = false;
      try {
        good = !this.decode(spec, prev).newer;
      } catch {
        good = false;
      }
      if (good) this.store.set(this.key(spec.kind, true), prev);
    }
    const env: Envelope = { format: SAVE_FORMAT, kind: spec.kind, version: spec.version, savedAt: this.now().toISOString(), data };
    let text: string;
    try {
      text = JSON.stringify(env);
    } catch {
      return false;
    }
    this.store.set(k, text);
    return this.store.get(k) === text;
  }

  /** Save after things settle (`ms` after the last change): call on every change. */
  autosave<T>(spec: SaveSpec<T>, get: () => T, ms = 400): void {
    this.cancel(spec.kind);
    const run = () => {
      this.timers.delete(spec.kind);
      this.pending.delete(spec.kind);
      this.save(spec, get());
    };
    this.pending.set(spec.kind, run);
    this.timers.set(spec.kind, setTimeout(run, ms));
  }

  /** write every pending autosave now (on page hide, at the end of a set) */
  flush(): void {
    for (const run of [...this.pending.values()]) run();
  }

  /** Is this kind locked because the save on disk is from a newer game? */
  isReadOnly(kind: string): boolean {
    return this.readOnly.has(kind);
  }

  /** Delete a kind's save and its backup (a new career). */
  erase(kind: string): void {
    this.cancel(kind);
    this.readOnly.delete(kind);
    this.store.remove(this.key(kind));
    this.store.remove(this.key(kind, true));
  }

  private cancel(kind: string): void {
    const t = this.timers.get(kind);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(kind);
    this.pending.delete(kind);
  }
}
