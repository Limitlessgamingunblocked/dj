import { describe, expect, it } from 'vitest';
import { AUTO_GAP, HellYeah, MANUAL_GAP, streakMoment } from '../src/game/hellyeah';
import { hypeLook, hypeSpot } from '../src/three/HypeSquad';

describe('HELL YEAH', () => {
  it('fires from the pad any time, but not twice on top of itself', () => {
    const h = new HellYeah();
    expect(h.ask('pad', 0)).toBe(true);
    expect(h.ask('pad', MANUAL_GAP - 0.5)).toBe(false);
    expect(h.ask('pad', MANUAL_GAP + 0.1)).toBe(true);
  });

  it('fires by itself on big moments, kept well apart, and not at all when switched off', () => {
    const h = new HellYeah();
    expect(h.ask('drop', 10)).toBe(true);
    expect(h.ask('streak', 20)).toBe(false);
    // the pad still works in between
    expect(h.ask('pad', 30)).toBe(true);
    expect(h.ask('encore', 10 + AUTO_GAP + 1)).toBe(true);
    h.auto = false;
    expect(h.ask('raid', 500)).toBe(false);
    expect(h.ask('pad', 500)).toBe(true);
  });

  it('shouts about every fourth clean moment in a row', () => {
    expect([1, 2, 3, 4, 5, 8, 12].filter(streakMoment)).toEqual([4, 8, 12]);
  });
});

describe('the hype dancers', () => {
  it('get a glam look, the same one for the same seed', () => {
    const a = hypeLook(42);
    expect(hypeLook(42)).toEqual(a);
    expect(['crop_top', 'top_sequin']).toContain(a.items.top);
    expect(a.items.bottom?.startsWith('skirt')).toBe(true);
    expect(a.items.headphones).toBeNull();
    expect(a.options.facial_hair).toBe('clean');
    // different seeds, different dancers
    const looks = new Set(Array.from({ length: 8 }, (_, i) => JSON.stringify(hypeLook(i).items) + hypeLook(i).colors.skin));
    expect(looks.size).toBeGreaterThan(4);
  });

  it('stay home from the bedroom and the menus, and dance everywhere else', () => {
    expect(hypeSpot('bedroom')).toBeNull();
    expect(hypeSpot('naming')).toBeNull();
    expect(hypeSpot('warehouse')?.x).toBeGreaterThan(2);
    expect(hypeSpot('basement')).not.toBeNull();
  });
});
