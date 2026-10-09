import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStore, SAVE_PREFIX, SaveSystem, type SaveSpec } from '../src/core/SaveSystem';
import { BOARDS, cleanName, cleanTagline, PROFILE, PROGRESS, RECORDINGS } from '../src/core/models';

/** a made-up kind at version 3, to exercise migrations */
interface Thing {
  title: string;
  count: number;
  tags: string[];
}
const THING: SaveSpec<Thing> = {
  kind: 'thing',
  version: 3,
  migrations: {
    // v1 had `name`; v2 renamed it to `title`
    1: (d) => {
      const o = d as { name?: string; count?: number };
      return { title: o.name ?? '', count: o.count ?? 0 };
    },
    // v3 added tags
    2: (d) => ({ ...(d as object), tags: [] }),
  },
  defaults: () => ({ title: 'new', count: 0, tags: [] }),
  validate: (d) => {
    const o = (d ?? {}) as Partial<Thing>;
    return { title: typeof o.title === 'string' ? o.title : '', count: typeof o.count === 'number' ? Math.max(0, o.count) : 0, tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === 'string') : [] };
  },
};
const env = (version: number, data: unknown, kind = 'thing') => JSON.stringify({ format: 'deckhouse-save', kind, version, savedAt: '2026-01-01T00:00:00.000Z', data });

afterEach(() => vi.useRealTimers());

describe('SaveSystem', () => {
  it('round-trips, and starts fresh when there is nothing saved', () => {
    const s = new SaveSystem(memoryStore());
    const first = s.load(THING);
    expect(first.from).toBe('new');
    expect(first.data.title).toBe('new');
    expect(s.save(THING, { title: 'hello', count: 3, tags: ['a'] })).toBe(true);
    const back = s.load(THING);
    expect(back.from).toBe('save');
    expect(back.data).toEqual({ title: 'hello', count: 3, tags: ['a'] });
  });

  it('upgrades an old save one version at a time', () => {
    const kv = memoryStore();
    kv.set(SAVE_PREFIX + 'thing', env(1, { name: 'old DJ', count: 7 }));
    const r = new SaveSystem(kv).load(THING);
    expect(r.from).toBe('save');
    expect(r.migratedFrom).toBe(1);
    expect(r.data).toEqual({ title: 'old DJ', count: 7, tags: [] });
  });

  it('keeps the previous good save as a backup, and falls back to it when the save is damaged', () => {
    const kv = memoryStore();
    const s = new SaveSystem(kv);
    s.save(THING, { title: 'one', count: 1, tags: [] });
    s.save(THING, { title: 'two', count: 2, tags: [] });
    // the save gets damaged
    kv.set(SAVE_PREFIX + 'thing', '{"format":"deckhouse-save","kind":"thing","vers');
    const r = s.load(THING);
    expect(r.from).toBe('backup');
    expect(r.data.title).toBe('one');
    expect(r.problem).toMatch(/damaged/);
    // saving over a damaged save doesn't overwrite the good backup with junk
    s.save(THING, { title: 'three', count: 3, tags: [] });
    expect(JSON.parse(kv.get(SAVE_PREFIX + 'thing.bak')!).data.title).toBe('one');
    expect(s.load(THING).data.title).toBe('three');
  });

  it('starts fresh, and says why, when both the save and the backup are unusable', () => {
    const kv = memoryStore();
    kv.set(SAVE_PREFIX + 'thing', 'nonsense');
    kv.set(SAVE_PREFIX + 'thing.bak', env(1, null, 'other'));
    const r = new SaveSystem(kv).load(THING);
    expect(r.from).toBe('new');
    expect(r.problem).toMatch(/damaged JSON.*backup/);
  });

  it('reads a save from a newer game but never overwrites it', () => {
    const kv = memoryStore();
    const newer = env(9, { title: 'future', count: 5, tags: [], hover: true });
    kv.set(SAVE_PREFIX + 'thing', newer);
    const s = new SaveSystem(kv);
    const r = s.load(THING);
    expect(r.newer).toBe(true);
    expect(r.data.title).toBe('future');
    expect(s.isReadOnly('thing')).toBe(true);
    expect(s.save(THING, { title: 'mine', count: 0, tags: [] })).toBe(false);
    expect(kv.get(SAVE_PREFIX + 'thing')).toBe(newer);
  });

  it('autosaves once things settle, and flushes on demand', () => {
    vi.useFakeTimers();
    const kv = memoryStore();
    const s = new SaveSystem(kv);
    let n = 0;
    const data = { title: 't', count: 0, tags: [] as string[] };
    for (let i = 0; i < 10; i++) {
      data.count = i;
      s.autosave(THING, () => (n++, { ...data }), 400);
      vi.advanceTimersByTime(100);
    }
    expect(n).toBe(0);
    vi.advanceTimersByTime(400);
    expect(n).toBe(1);
    expect(s.load(THING).data.count).toBe(9);
    s.autosave(THING, () => ({ ...data, count: 42 }));
    s.flush();
    expect(s.load(THING).data.count).toBe(42);
  });

  it('keeps career saves apart from the settings, so a settings reset leaves them', () => {
    expect(SAVE_PREFIX.startsWith('deckhouse:')).toBe(false);
  });
});

describe('save models', () => {
  it('cleans DJ names and taglines to the rules', () => {
    expect(cleanName('  dj   shadow<script>  ')).toBe('dj shadowscript');
    expect(cleanName("Kiki & the B-Side's")).toBe("Kiki & the B-Side's");
    expect(cleanName('Ñandú 9')).toBe('Ñandú 9');
    expect(cleanName('A'.repeat(40))).toHaveLength(20);
    expect(cleanName('🔥🔥')).toBe('');
    expect(cleanTagline('ALL NIGHT LONG!!')).toBe('ALL NIGHT LONG!!');
    expect(cleanTagline('x'.repeat(50))).toHaveLength(30);
    expect(PROFILE.validate({ name: 'DJ X', extra: 1 })).toEqual({ name: 'DJ X', tagline: '', uppercase: true, createdAt: null });
  });

  it('repairs progress instead of rejecting it', () => {
    const p = PROGRESS.validate({ tier: 99, fame: -5, cash: '100', unlocked: ['rooftop', 'rooftop', 5, 'basement'], reputation: 'villain', sandbox: 'yes' });
    expect(p.tier).toBe(7);
    expect(p.fame).toBe(0);
    expect(p.cash).toBe(0);
    expect(p.unlocked).toEqual(['rooftop', 'basement']);
    expect(p.reputation).toBeNull();
    expect(p.sandbox).toBe(false);
  });

  it('moves v1 boards into the v2 list, their files waiting for the media store', () => {
    const v1 = { items: [{ id: 'b1', name: 'Chaos', components: [{ id: 'c1', type: 'fader', pos: [0, 0, 0] }] }, { id: 'bad id!' }], current: 'b1' };
    const v2 = BOARDS.validate(BOARDS.migrations[1](v1));
    expect(v2.items.map((b) => b.id)).toEqual(['b1']);
    expect(v2.items[0]).toMatchObject({ name: 'Chaos', parts: 1, source: 'mine', rating: 0 });
    expect(v2.current).toBe('b1');
    expect(v2.pending.b1).toMatchObject({ format: 'deckhouse-board', id: 'b1', name: 'Chaos' });
  });

  it('checks the board list: duplicates, bad ratings and a current board that is gone', () => {
    const b = BOARDS.validate({
      items: [{ id: 'b1', name: 'One', rating: 9, source: 'alien' }, { id: 'b1', name: 'Dupe' }, { id: 'b2' }],
      current: 'gone',
      currentFile: { id: 'gone' },
      favParts: ['knob', 'knob', 'Not A Type', 'lava_lamp'],
      ratings: { showcase_club: 4, showcase_x: 11 },
    });
    expect(b.items.map((x) => x.name)).toEqual(['One', 'My board']);
    expect(b.items[0].rating).toBe(5);
    expect(b.items[0].source).toBe('mine');
    expect(b.current).toBeNull();
    expect(b.currentFile).toBeNull();
    expect(b.favParts).toEqual(['knob', 'lava_lamp']);
    expect(b.ratings).toEqual({ showcase_club: 4 });
    // the current board's file is kept only when it is that board
    expect(BOARDS.validate({ items: [{ id: 'b1' }], current: 'b1', currentFile: { id: 'b1', components: [] } }).currentFile).toEqual({ id: 'b1', components: [] });
  });

  it('skips broken recordings and keeps good ones', () => {
    const r = RECORDINGS.validate({ items: [{ id: 'r1', date: '2026-10-08T21:00:00Z', kind: 'video', seconds: 1800, grade: 'S', tracklist: [{ at: 0, title: 'Low Ceiling Theory', artist: 'Mira Solen' }, 7] }, { id: 'bad id!', date: 'x' }] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].tracklist).toHaveLength(1);
    expect(r.items[0].grade).toBe('S');
  });
});
