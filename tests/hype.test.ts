import { describe, expect, it } from 'vitest';
import { hypeLook, hypeSpot } from '../src/three/HypeSquad';

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
