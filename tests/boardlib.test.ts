import { describe, expect, it } from 'vitest';
import '../src/board/build';
import { BOARDS } from '../src/core/models';
import { memoryStore, SaveSystem } from '../src/core/SaveSystem';
import { allDefs } from '../src/board/catalog';
import { BoardLibrary, isoWeek, SHOWCASE, unlocked, type BlobStore } from '../src/board/library';
import { emptyBoard } from '../src/board/format';
import { make } from '../src/board/templates';

function blobs(): BlobStore & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>();
  return {
    map,
    put: async (id, b) => void map.set(id, b),
    get: async (id) => map.get(id) ?? null,
    delete: async (ids) => ids.forEach((i) => map.delete(i)),
  };
}

function board(id: string) {
  const b = emptyBoard(id, 'Test rig');
  b.components.push(make('knob', [0.1, 0, 0], { material: 'gloss' }), make('lava_lamp', [-0.2, 0, 0.1]));
  return b;
}

describe('board library', () => {
  it('saves to the store, lists it, loads it back and keeps the current one in the save', async () => {
    const kv = memoryStore();
    const store = blobs();
    const lib = new BoardLibrary(new SaveSystem(kv), store);
    const b = board(lib.newId());
    await lib.save(b);
    expect(lib.items).toHaveLength(1);
    expect(lib.items[0]).toMatchObject({ name: 'Test rig', parts: 2, source: 'mine' });
    expect(store.map.has(`board:${b.id}`)).toBe(true);
    lib.setCurrent(b);
    // a fresh library (another session) reads the list from the save and the file from the store
    const saves = new SaveSystem(kv);
    lib['saves'].flush();
    const again = new BoardLibrary(saves, store);
    expect(again.items.map((x) => x.id)).toEqual([b.id]);
    expect(again.currentFile()?.components.map((c) => c.type)).toEqual(['knob', 'lava_lamp']);
    const loaded = (await again.load(b.id))!;
    expect(loaded.components[0].props.material).toBe('gloss');
  });

  it('remixes (a new board pointing at the old), imports codes and files with fresh ids, rates and removes', async () => {
    const store = blobs();
    const lib = new BoardLibrary(new SaveSystem(memoryStore()), store);
    const r = (await lib.remix('showcase_club'))!;
    expect(r.name).toBe('Friday Standard (remix)');
    expect(lib.get(r.id)).toMatchObject({ source: 'remix', remixOf: 'showcase_club' });
    const code = await lib.code(r);
    const fromCode = (await lib.importCode(code))!;
    expect(fromCode.id).not.toBe(r.id);
    expect(lib.get(fromCode.id)?.source).toBe('code');
    const fromFile = (await lib.importFile(lib.exportText(r)))!;
    expect(fromFile.components.length).toBe(r.components.length);
    expect(await lib.importFile('not json')).toBeNull();
    expect(await lib.importCode('DH1.nope')).toBeNull();
    lib.rate(r.id, 4);
    lib.rate('showcase_pro', 5);
    expect(lib.ratingOf(r.id)).toBe(4);
    expect(lib.ratingOf('showcase_pro')).toBe(5);
    await lib.remove(r.id);
    expect(lib.get(r.id)).toBeUndefined();
    expect(store.map.has(`board:${r.id}`)).toBe(false);
  });

  it('moves files from an old save into the store', async () => {
    const kv = memoryStore();
    new SaveSystem(kv).save(BOARDS, { ...BOARDS.defaults(), items: [{ id: 'b1', name: 'Old', created: new Date(0).toISOString(), updated: new Date(0).toISOString(), parts: 1, rating: 0, remixOf: null, source: 'mine', plays: 0, favorite: false }], pending: { b1: { id: 'b1', name: 'Old', components: [{ id: 'k', type: 'knob' }] } } });
    const store = blobs();
    const lib = new BoardLibrary(new SaveSystem(kv), store);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.map.has('board:b1')).toBe(true);
    expect(Object.keys(lib.data.pending)).toHaveLength(0);
    expect((await lib.load('b1'))!.components[0].type).toBe('knob');
  });

  it('Board of the Week turns over weekly and includes your best-rated boards', async () => {
    const lib = new BoardLibrary(new SaveSystem(memoryStore()), blobs());
    const a = lib.boardOfTheWeek(new Date('2026-10-05T12:00:00Z'));
    const sameWeek = lib.boardOfTheWeek(new Date('2026-10-11T12:00:00Z'));
    const next = lib.boardOfTheWeek(new Date('2026-10-12T12:00:00Z'));
    expect(sameWeek.id).toBe(a.id);
    expect(next.id).not.toBe(a.id);
    expect(isoWeek(new Date('2026-10-12T00:00:00Z')) - isoWeek(new Date('2026-10-05T00:00:00Z'))).toBe(1);
    const mine = board(lib.newId());
    await lib.save(mine);
    lib.rate(mine.id, 5);
    const seen = new Set<string>();
    for (let w = 0; w < SHOWCASE.length + 1; w++) seen.add(lib.boardOfTheWeek(new Date(Date.UTC(2026, 9, 5 + w * 7))).id);
    expect(seen.has(mine.id)).toBe(true);
  });

  it('parts unlock by fame tier or milestone, and sandbox opens everything', () => {
    const locked = allDefs().filter((d) => d.unlock);
    expect(locked.length).toBeGreaterThan(5);
    const tier3 = locked.find((d) => d.unlock?.tier === 3)!;
    const ms = locked.find((d) => d.unlock?.milestone)!;
    expect(unlocked(tier3, { tier: 2, milestones: [], sandbox: false })).toBe(false);
    expect(unlocked(tier3, { tier: 3, milestones: [], sandbox: false })).toBe(true);
    expect(unlocked(ms, { tier: 7, milestones: [], sandbox: false })).toBe(false);
    expect(unlocked(ms, { tier: 1, milestones: [ms.unlock!.milestone!], sandbox: false })).toBe(true);
    expect(locked.every((d) => unlocked(d, { tier: 1, milestones: [], sandbox: true }))).toBe(true);
  });
});
