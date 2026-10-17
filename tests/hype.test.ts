import { describe, expect, it } from 'vitest';
import { hypeLook, hypeSpot, SIDE_DANCERS, sideDancerLook } from '../src/three/HypeSquad';

describe('the side dancers', () => {
  it('get a glam look, the same one for the same seed', () => {
    const a = hypeLook(42);
    expect(hypeLook(42)).toEqual(a);
    expect(['crop_top', 'top_sequin', 'tank_mesh']).toContain(a.items.top);
    expect(a.items.bottom).toBeTruthy();
    expect(a.items.headphones).toBeNull();
    expect(a.options.facial_hair).toBe('clean');
    // different seeds, different dancers
    const looks = new Set(Array.from({ length: 8 }, (_, i) => JSON.stringify(hypeLook(i).items) + hypeLook(i).colors.skin));
    expect(looks.size).toBeGreaterThan(4);
    // and code-built, not the DJ's scanned body
    expect(a.options.scan).toBeUndefined();
  });

  it('are the realistic women from the floor, never the DJ, and never the same woman twice in a venue', () => {
    for (let seed = 0; seed < 6; seed++) {
      const [l, r] = [sideDancerLook(seed, 0), sideDancerLook(seed, 1)];
      for (const d of [l, r]) {
        expect(d.options.scan).toMatch(/^character_scan_/);
        expect(d.options.scan).not.toBe('character_scan_minimal_01');
      }
      expect(l.options.scan).not.toBe(r.options.scan);
    }
    expect(SIDE_DANCERS.length).toBeGreaterThanOrEqual(2);
    // (not the disco one: her scan's hands are crumpled)
    expect(SIDE_DANCERS).not.toContain('disco_revival');
  });

  it('stay home from the bedroom and the menus, and dance everywhere else', () => {
    expect(hypeSpot('bedroom')).toBeNull();
    expect(hypeSpot('naming')).toBeNull();
    expect(hypeSpot('warehouse')?.x).toBeGreaterThan(2);
    expect(hypeSpot('basement')).not.toBeNull();
  });
});
