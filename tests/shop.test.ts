import { describe, expect, it } from 'vitest';
import { PROGRESS, type Progress } from '../src/core/models';
import { ITEMS, OUTFIT_SETS } from '../src/character/catalog';
import { defaultLook, ownedThing } from '../src/character/look';
import { homeOf } from '../src/game/home';
import { applySet, newUnlocks } from '../src/game/progression';
import { buy, cantBuy, focusOf, forSale, isOwned, priceFor, shopAction, shopCatalog, tryOn, wearing } from '../src/game/shop';

const fresh = (o: Partial<Progress> = {}): Progress => ({ ...PROGRESS.defaults(), ...o });
const entry = (key: string) => shopCatalog().find((e) => e.key === key)!;

describe('the shop', () => {
  it('sells tier and set-count pieces, never milestone, rival or secret-room ones', () => {
    expect(forSale('warehouse')).toBe(true);
    expect(forSale('set:4')).toBe(true);
    expect(forSale('start')).toBe(false);
    expect(forSale('milestone:acid')).toBe(false);
    expect(forSale('rival:marlowe')).toBe(false);
    expect(forSale('outfit:uv')).toBe(false);
    const keys = new Set(shopCatalog().map((e) => e.key));
    expect(keys.size).toBe(shopCatalog().length);
    expect(keys.has('set:acid_smiley')).toBe(false);
    expect(keys.has('set:warehouse_ghost')).toBe(true);
    expect(keys.has('home:1') && keys.has('home:2')).toBe(true);
  });

  it('prices further-off pieces higher, and sets above single pieces', () => {
    expect(priceFor('item', 'rooftop')).toBeLessThan(priceFor('item', 'warehouse'));
    expect(priceFor('item', 'warehouse')).toBeLessThan(priceFor('item', 'sunrise'));
    expect(priceFor('set', 'warehouse')).toBeGreaterThan(priceFor('item', 'warehouse'));
    for (const e of shopCatalog()) expect(e.price % 10).toBe(0);
  });

  it('won’t sell what you can’t afford or already own', () => {
    const e = entry('set:warehouse_ghost');
    expect(cantBuy(e, fresh({ cash: 0 }))).toMatch(/short/);
    expect(buy(fresh({ cash: 0 }), e).ok).toBe(false);
    expect(cantBuy(e, fresh({ cash: 1e6, tier: 3 }))).toBe('Owned');
  });

  it('buying a set takes the cash, owns the set and its pieces, and counts the spend', () => {
    const e = entry('set:warehouse_ghost');
    const p = fresh({ cash: e.price + 25 });
    const r = buy(p, e);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = { ...p, ...r.patch };
    expect(after.cash).toBe(25);
    expect(after.stats.shop_spent).toBe(e.price);
    const set = OUTFIT_SETS.find((s) => s.id === 'warehouse_ghost')!;
    expect(ownedThing('set', set, after)).toBe(true);
    for (const id of Object.values(set.pieces)) expect(ownedThing('item', ITEMS.find((i) => i.id === id)!, after)).toBe(true);
    expect(isOwned(e, after)).toBe(true);
    // fame reaching the warehouse later doesn't announce what you already bought
    const news = newUnlocks(after, { ...after, tier: 3 }).map((n) => n.label);
    expect(news.some((l) => l.startsWith('Warehouse Ghost'))).toBe(false);
  });

  it('moves you home early: the studio first, then the penthouse', () => {
    const p = fresh({ cash: 10_000 });
    expect(homeOf(p)).toBe(0);
    expect(cantBuy(entry('home:2'), p)).toMatch(/studio first/);
    const r1 = buy(p, entry('home:1'));
    if (!r1.ok) throw new Error(r1.why);
    const p1 = { ...p, ...r1.patch };
    expect(homeOf(p1)).toBe(1);
    const r2 = buy(p1, entry('home:2'));
    if (!r2.ok) throw new Error(r2.why);
    expect(homeOf({ ...p1, ...r2.patch })).toBe(2);
    // fame still moves you for free
    expect(homeOf(fresh({ tier: 5 }))).toBe(2);
    expect(isOwned(entry('home:1'), fresh({ tier: 3 }))).toBe(true);
  });

  it('keeps purchases through a save round trip', () => {
    const e = entry('item:' + ITEMS.find((i) => i.unlock === 'festival')!.id);
    const r = buy(fresh({ cash: 5000 }), e);
    if (!r.ok) throw new Error(r.why);
    const saved = PROGRESS.validate(JSON.parse(JSON.stringify({ ...fresh({ cash: 5000 }), ...r.patch })));
    expect(isOwned(e, saved)).toBe(true);
  });

  it('tries pieces on without touching the look it was given', () => {
    const base = defaultLook();
    const before = JSON.stringify(base);
    const item = ITEMS.find((i) => forSale(i.unlock) && base.items[i.slot] !== i.id)!;
    const e = entry(`item:${item.id}`);
    const on = tryOn(base, e)!;
    expect(on.items[item.slot]).toBe(item.id);
    expect(wearing(on, e)).toBe(true);
    expect(wearing(base, e)).toBe(false);
    expect(JSON.stringify(base)).toBe(before);
    // a set puts on all of its pieces
    const set = entry('set:warehouse_ghost');
    const dressed = tryOn(base, set)!;
    for (const id of set.pieces!) expect(Object.values(dressed.items)).toContain(id);
    expect(wearing(dressed, set)).toBe(true);
    // a haircut and an iris
    const hair = shopCatalog().find((x) => x.kind === 'hair')!;
    expect(tryOn(base, hair)!.items.hair).toBe(hair.id);
    const iris = shopCatalog().find((x) => x.kind === 'iris')!;
    expect(wearing(tryOn(base, iris)!, iris)).toBe(true);
    // a home isn't worn
    expect(tryOn(base, entry('home:1'))).toBeNull();
  });

  it('frames each entry on the part of you it goes on', () => {
    expect(focusOf(entry('home:1'))).toBe('home');
    expect(focusOf(entry('set:warehouse_ghost'))).toBe('full');
    expect(focusOf(shopCatalog().find((x) => x.kind === 'hair')!)).toBe('head');
    expect(focusOf(shopCatalog().find((x) => x.kind === 'iris')!)).toBe('eyes');
    const shoes = shopCatalog().find((x) => x.kind === 'item' && ITEMS.find((i) => i.id === x.id)?.slot === 'shoes');
    if (shoes) expect(focusOf(shoes)).toBe('feet');
  });

  it('the one button: buy, then confirm, then wear (or why not)', () => {
    const e = entry('set:warehouse_ghost');
    const look = defaultLook();
    expect(shopAction(e, fresh({ cash: 0 }), look, false)).toEqual({ label: expect.stringMatching(/short/), act: null });
    const rich = fresh({ cash: e.price });
    expect(shopAction(e, rich, look, false)).toEqual({ label: `Buy $${e.price.toLocaleString()}`, act: 'buy' });
    expect(shopAction(e, rich, look, true)).toEqual({ label: `Confirm $${e.price.toLocaleString()}`, act: 'confirm' });
    const r = buy(rich, e);
    if (!r.ok) throw new Error(r.why);
    const after = { ...rich, ...r.patch };
    expect(shopAction(e, after, look, false).act).toBe('wear');
    expect(shopAction(e, after, tryOn(look, e)!, false)).toEqual({ label: 'Wearing', act: null });
    expect(shopAction(entry('home:1'), fresh({ tier: 5 }), look, false)).toEqual({ label: 'Owned', act: null });
  });

  it('sets still pay as before alongside it', () => {
    const p = fresh();
    const out = applySet(p, { venue: 'basement', slot: 'peak', minutes: 10, grade: 'C', average: 0.5, encore: false, full: true, transitions: 2, bassSwaps: 0, longBlends: 0, filterFades: 0, echoOuts: 0, perfect: 0, keyMixes: 0, drops: 1, mistakes: 1, slotMatch: 0.6, avgEnergy: 0.5, fullMinute: false, peakVibe: 0.6, board: 'starter2' });
    expect(out.patch.stats?.cash_earned).toBe(out.rewards.cash);
  });
});
