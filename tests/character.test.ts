import { describe, expect, it } from 'vitest';
import { HAIR, ITEMS, OUTFIT_SETS, SKIN_TONES, SLIDERS, TATTOOS, ITEM_BY_ID, BROWS } from '../src/character/catalog';
import { defaultLook, dressCodeBonus, LookHistory, option, owned, randomize, resetCategory, unlockText, wearSet, zoneColors } from '../src/character/look';
import { LOOKS, checkLook } from '../src/core/models';
import { memoryStore, SAVE_PREFIX, SaveSystem } from '../src/core/SaveSystem';

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const fresh = { tier: 1, unlocked: [] as string[], sandbox: false, setsPlayed: 0 };

describe('character catalogue', () => {
  it('has what the brief asks for', () => {
    expect(SKIN_TONES).toHaveLength(24);
    expect(HAIR.filter((h) => h.id !== 'bald').length).toBeGreaterThanOrEqual(40);
    expect(BROWS.length).toBeGreaterThanOrEqual(15);
    expect(TATTOOS.length).toBeGreaterThanOrEqual(50);
    expect(OUTFIT_SETS).toHaveLength(12);
    expect(ITEMS.filter((i) => i.slot === 'headphones').length).toBeGreaterThanOrEqual(10);
    // every set's pieces exist and sit in their slot
    for (const s of OUTFIT_SETS) for (const [slot, id] of Object.entries(s.pieces)) expect(ITEM_BY_ID.get(id)?.slot).toBe(slot);
    // slider ids are valid shape-key names, and unique
    const ids = SLIDERS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    for (const k of ['jaw_width', 'nose_bridge', 'lip_fullness', 'height', 'shoulder_width']) expect(ids).toContain(k);
  });
});

describe('looks', () => {
  it('starts as Afterhours Classic and wears any set', () => {
    const l = defaultLook();
    expect(l.items.top).toBe('tee_vintage');
    expect(l.items.eyewear).toBe('shades_oval');
    const tk = wearSet(l, OUTFIT_SETS.find((s) => s.id === 'terrace_king')!);
    expect(tk.items.top).toBe('shirt_linen');
    expect(tk.items.hair).toBe('crop');
    const bl = wearSet(l, OUTFIT_SETS.find((s) => s.id === 'bedroom_legend')!);
    expect(option(bl, 'phones_wear')).toBe('neck');
    expect(zoneColors(tk, 'top')).toEqual(ITEM_BY_ID.get('shirt_linen')!.colors);
  });

  it('owns start items, venue items once the tier opens them, and everything in sandbox', () => {
    expect(owned('start', fresh)).toBe(true);
    expect(owned('warehouse', fresh)).toBe(false);
    expect(owned('warehouse', { ...fresh, tier: 3 })).toBe(true);
    expect(owned('milestone:acid', { ...fresh, tier: 7 })).toBe(false);
    expect(owned('milestone:acid', { ...fresh, unlocked: ['milestone:acid'] })).toBe(true);
    expect(owned('festival', { ...fresh, sandbox: true })).toBe(true);
  });

  it('randomises within what the player owns, one category at a time', () => {
    const base = defaultLook();
    for (let seed = 1; seed < 40; seed++) {
      const r = randomize(base, 'all', rng(seed), fresh);
      for (const slot of Object.keys(r.items)) {
        const id = r.items[slot];
        if (!id || slot === 'hair') continue;
        expect(owned(ITEM_BY_ID.get(id)!.unlock, fresh)).toBe(true);
      }
      expect(owned(HAIR.find((h) => h.id === r.items.hair)!.unlock, fresh)).toBe(true);
      for (const v of Object.values(r.sliders)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    const hairOnly = randomize(base, 'hair', rng(7), fresh);
    expect(hairOnly.items.top).toBe(base.items.top);
    expect(hairOnly.colors.skin).toBe(base.colors.skin);
    const reset = resetCategory(randomize(base, 'body', rng(3), fresh), 'body');
    expect(Object.keys(reset.sliders).filter((k) => ['height', 'waist'].includes(k))).toEqual([]);
  });

  it('undoes and redoes', () => {
    const h = new LookHistory(defaultLook());
    const a = h.push({ ...h.look, name: 'A' });
    h.push({ ...a, name: 'B' });
    expect(h.undo().name).toBe('A');
    expect(h.undo().name).toBe('My look');
    expect(h.canUndo).toBe(false);
    expect(h.redo().name).toBe('A');
    h.push({ ...h.look, name: 'C' });
    expect(h.canRedo).toBe(false);
  });

  it('gives a small dress-code lift for dressing the part', () => {
    const l = defaultLook();
    const ghost = wearSet(l, OUTFIT_SETS.find((s) => s.id === 'warehouse_ghost')!);
    const atWarehouse = dressCodeBonus(ghost, 'warehouse');
    expect(atWarehouse.bonus).toBeGreaterThan(0.05);
    expect(atWarehouse.bonus).toBeLessThanOrEqual(0.1);
    expect(dressCodeBonus(ghost, 'beach').bonus).toBe(0);
    const linen = wearSet(l, OUTFIT_SETS.find((s) => s.id === 'terrace_king')!);
    expect(dressCodeBonus(linen, 'beach').bonus).toBeGreaterThan(dressCodeBonus(linen, 'warehouse').bonus);
  });

  it('saves version 2 and upgrades a version 1 save', () => {
    const kv = memoryStore();
    kv.set(SAVE_PREFIX + 'looks', JSON.stringify({ format: 'deckhouse-save', kind: 'looks', version: 1, savedAt: '2026-10-01T00:00:00Z', data: { items: [{ id: 'l1', name: 'Old', sliders: { height: 0.4 }, colors: {}, items: { top: 'tee_plain' } }], current: 'l1' } }));
    const r = new SaveSystem(kv).load(LOOKS);
    expect(r.migratedFrom).toBe(1);
    expect(r.data.items[0]).toMatchObject({ id: 'l1', sliders: { height: 0.4 }, options: {}, tattoos: [], piercings: [] });
    const t = checkLook({ id: 'x', tattoos: [{ design: 'flash_rose', place: 'forearm_l', size: 9, color: 'red' }, { place: 'neck' }], piercings: ['nose_stud', 'nose_stud', 'bad id!'] })!;
    expect(t.tattoos).toEqual([{ design: 'flash_rose', place: 'forearm_l', size: 1.5, rot: 0, color: '#1a1a1a' }]);
    expect(t.piercings).toEqual(['nose_stud']);
  });
});

describe('the career keeps your looks', () => {
  it('saves, wears, deletes and comes back after a reload', async () => {
    const { Career } = await import('../src/game/Career');
    const kv = memoryStore();
    const c = new Career(new SaveSystem(kv));
    // nothing saved yet: you wear the starter look
    expect(c.looks.items).toHaveLength(0);
    expect(c.look.items.top).toBe('tee_vintage');
    const seen: string[] = [];
    c.changed.on('look', (l) => seen.push(l.id));
    const a = { ...defaultLook('look_1', 'Basement'), items: { ...defaultLook().items, hair: 'locs' } };
    c.saveLook(a);
    const b = { ...defaultLook(c.newLookId(), 'Terrace') };
    expect(b.id).toBe('look_2');
    c.saveLook(b, false);
    expect(c.looks.items.map((l) => l.name)).toEqual(['Basement', 'Terrace']);
    expect(c.look.id).toBe('look_1');
    c.wearLook('look_2');
    expect(c.look.name).toBe('Terrace');
    // changing a saved look keeps its place in the wardrobe
    c.saveLook({ ...a, name: 'Basement 2' }, false);
    expect(c.looks.items.map((l) => l.name)).toEqual(['Basement 2', 'Terrace']);
    expect(seen).toEqual(['look_1', 'look_2']);
    c.saves.flush();
    const again = new Career(new SaveSystem(kv));
    expect(again.look.name).toBe('Terrace');
    expect(again.looks.items[0].items.hair).toBe('locs');
    // deleting the one you wear falls back to the first
    again.deleteLook('look_2');
    expect(again.look.id).toBe('look_1');
    again.erase();
    expect(again.looks.items).toHaveLength(0);
  });

  it('says how locked things unlock', () => {
    expect(unlockText('start')).toBe('Starter');
    expect(unlockText('warehouse')).toBe('Play the Warehouse');
    expect(unlockText('beach')).toBe('Play the Beach Club');
    expect(unlockText('milestone:acid')).toBe('Milestone: acid');
    expect(unlockText('rival:kiki_volt')).toBe('Great chemistry with KIKI VOLT in a B2B');
    expect(unlockText('set:6')).toBe('Play 6 sets');
  });
});

describe('the avatar draws the whole catalogue', () => {
  it('has a shape for every hair style and draws every outfit slot', async () => {
    const src = (await import('../src/character/Avatar.ts?raw')).default;
    for (const h of HAIR) if (h.id !== 'bald') expect(src, h.id).toContain(`case '${h.id}'`);
    for (const slot of new Set(ITEMS.map((i) => i.slot))) expect(src, slot).toMatch(new RegExp(`items\\.${slot}\\b|item\\('${slot}'\\)`));
  });
});

describe('the dressing room', () => {
  it("keeps the club-strobe preview under 3 flashes a second, slower still with reduce flashing", async () => {
    const { previewFlash } = await import('../src/three/venues/dressingroom');
    const rate = (reduce: boolean, bpm: number) => {
      let n = 0;
      let on = false;
      for (let t = 0; t < 10; t += 1 / 240) {
        const lit = previewFlash((t * bpm) / 60, reduce) > 0.2;
        if (lit && !on) n++;
        on = lit;
      }
      return n / 10;
    };
    expect(rate(false, 132)).toBeLessThan(3);
    expect(rate(true, 132)).toBeLessThan(1.2);
    expect(rate(true, 124)).toBeGreaterThan(0.8);
  });
});
