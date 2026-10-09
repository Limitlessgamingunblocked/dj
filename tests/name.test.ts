import { describe, expect, it } from 'vitest';
import { fold, isBlocked, setBlockedWords } from '../src/name/filter';
import { layoutName } from '../src/name/layout';
import { NameReactor, type ReactorInput } from '../src/name/reactor';

/** a fake measurer: every character 0.6 em wide, spaces 0.3 */
const measure = (s: string) => [...s].reduce((w, c) => w + (c === ' ' ? 0.3 : 0.6), 0);

describe('fitting the name', () => {
  const inside = (l: ReturnType<typeof layoutName>) => l.boxes.every((b) => b.x0 >= -1e-9 && b.x1 <= 1 + 1e-9 && b.y0 >= -1e-9 && b.y1 <= 1 + 1e-9);

  it('a one-letter name fills the sign without spilling', () => {
    const l = layoutName('X', 1024, 256, measure);
    expect(l.lines).toEqual(['X']);
    expect(l.boxes).toHaveLength(1);
    expect(inside(l)).toBe(true);
    // limited by the height, so it's big
    expect(l.size * 1.1).toBeGreaterThan(256 * 0.8);
  });

  it('a 20-character name shrinks or wraps, and never loses a letter', () => {
    const name = 'THE MIDNIGHT SELECTA';
    for (const [w, h] of [
      [1024, 256],
      [512, 512],
      [2048, 128],
    ]) {
      const l = layoutName(name, w, h, measure);
      expect(l.boxes).toHaveLength(name.replace(/ /g, '').length);
      expect(inside(l)).toBe(true);
      expect(l.lines.join(' ')).toBe(name);
    }
    // on a square it goes onto two lines, on a long strip it stays on one
    expect(layoutName(name, 512, 512, measure).lines).toHaveLength(2);
    expect(layoutName(name, 2048, 128, measure).lines).toHaveLength(1);
  });

  it('a name with no spaces stays on one line however long', () => {
    const l = layoutName('ABCDEFGHIJKLMNOPQRST', 300, 300, measure);
    expect(l.lines).toHaveLength(1);
    expect(inside(l)).toBe(true);
  });

  it('tracking widens the letters but still fits', () => {
    const l = layoutName('SUNRISE', 1024, 256, measure, { tracking: 0.4 });
    expect(inside(l)).toBe(true);
    expect(l.boxes[1].x0 - l.boxes[0].x1).toBeGreaterThan(0.01);
  });

  it('nothing to lay out without a name', () => {
    expect(layoutName('   ', 100, 100, measure).boxes).toEqual([]);
  });
});

describe('the name filter', () => {
  it('sees through spacing, swaps and accents, and keeps whole-word checks whole', () => {
    // placeholder words stand in for the real list (which is supplied separately)
    setBlockedWords({ anywhere: ['badword'], whole: ['zap'] });
    expect(fold('B4DW0RD')).toBe('badword');
    expect(isBlocked('DJ Badword')).toBe(true);
    expect(isBlocked('b.a.d w o r d')).toBe(true);
    expect(isBlocked('B4DWÖRD')).toBe(true);
    expect(isBlocked('ZAP')).toBe(true);
    expect(isBlocked('z a p')).toBe(true);
    // a whole-word entry inside an innocent word is fine
    expect(isBlocked('Zappa Nights')).toBe(false);
    expect(isBlocked('Kiki Volt')).toBe(false);
    setBlockedWords({});
    expect(isBlocked('DJ Badword')).toBe(false);
  });
});

describe('the name moves with the music', () => {
  const base: ReactorInput = { playing: true, section: 'groove', beat: 0, bar: 1, kick: 0, depth: 0, dropHit: false, reduceFlash: false };

  it('pulses with the kick and breathes in a breakdown', () => {
    const r = new NameReactor();
    expect(r.update({ ...base, kick: 0.8 }, 1 / 60).kick).toBeCloseTo(0.8);
    let fx = r.fx;
    for (let i = 0; i < 120; i++) fx = r.update({ ...base, section: 'breakdown' }, 1 / 60);
    expect(fx.breath).toBeGreaterThan(0.95);
  });

  it('chases the letters faster as the build tightens', () => {
    const r = new NameReactor();
    const passes = (depth: number) => {
      let wraps = 0;
      let last = 0;
      for (let b = 0; b < 16; b += 1 / 32) {
        const c = r.update({ ...base, section: 'build', depth, beat: b }, 1 / 60).chase;
        if (c < last) wraps++;
        last = c;
      }
      return wraps;
    };
    expect(passes(0.86)).toBeLessThan(passes(1));
    expect(r.update({ ...base, section: 'groove' }, 1 / 60).chase).toBe(1);
  });

  it('strobes then glitches on the drop, and stays under 3 flashes a second with reduce flashing', () => {
    for (const reduce of [false, true]) {
      const r = new NameReactor();
      r.update({ ...base, dropHit: true, reduceFlash: reduce }, 1 / 60);
      let flashes = 0;
      let was = false;
      let maxGlitch = 0;
      for (let i = 0; i < 120; i++) {
        const fx = r.update({ ...base, reduceFlash: reduce }, 1 / 60);
        if (fx.flash > 0 && !was) flashes++;
        was = fx.flash > 0;
        maxGlitch = Math.max(maxGlitch, fx.glitch);
      }
      if (reduce) expect(flashes).toBeLessThanOrEqual(2);
      else expect(flashes).toBeGreaterThanOrEqual(4);
      expect(maxGlitch).toBeGreaterThan(0.9);
      // reassembled by 2 s
      expect(r.fx.glitch).toBe(0);
    }
  });

  it('puts the name on the LED walls after a drop and through builds', () => {
    const r = new NameReactor();
    for (let i = 0; i < 60; i++) r.update({ ...base, bar: 9 }, 1 / 60);
    expect(r.fx.screen).toBeLessThan(0.05);
    r.update({ ...base, bar: 9, dropHit: true }, 1 / 60);
    for (let i = 0; i < 60; i++) r.update({ ...base, bar: 9 }, 1 / 60);
    expect(r.fx.screen).toBeGreaterThan(0.9);
  });
});

import { nameStyleFor, VENUE_NAME_STYLES } from '../src/name/venueStyles';

describe('name styles per venue', () => {
  it('every career venue in the brief has its look', () => {
    expect(VENUE_NAME_STYLES.bedroom.booth).toBe('marker');
    expect(VENUE_NAME_STYLES.basement.sign).toBe('neon_red');
    expect(VENUE_NAME_STYLES.rooftop.sign).toBe('neon_script');
    expect(VENUE_NAME_STYLES.warehouse.screen).toBe('chrome_led');
    expect(VENUE_NAME_STYLES.beach.booth).toBe('handpainted');
    expect(VENUE_NAME_STYLES.festival.screen).toBe('pixel_led');
    expect(VENUE_NAME_STYLES.sunrise.booth).toBe('white_install');
    for (const id of ['dc10', 'boilerroom', 'berghain', 'printworks', 'allypally', 'allypally-round']) expect(VENUE_NAME_STYLES[id]).toBeTruthy();
    expect(nameStyleFor('somewhere-new').booth).toBe('chrome_led');
  });
});
