import { describe, expect, it } from 'vitest';
import { Director } from '../src/visualizer/director';
import type { ModeInfo } from '../src/visualizer/kit';
import { describeLook, songLook } from '../src/visualizer/songLook';

const IDS: [string, ModeInfo['energy']][] = [
  ['warp', 'mid'], ['matrix', 'mid'], ['galaxy', 'peak'], ['grid', 'calm'], ['crt', 'calm'], ['lasers', 'peak'], ['kaleido', 'mid'],
  ['strobe', 'peak'], ['chrome', 'calm'], ['fractal', 'peak'], ['plasma', 'calm'], ['cells', 'mid'], ['sonar', 'mid'], ['hyper', 'peak'],
  ['aurora', 'calm'], ['circuit', 'mid'], ['hexfloor', 'peak'], ['mandel', 'mid'], ['caustics', 'calm'], ['rain', 'mid'], ['moire', 'calm'],
  ['echo', 'mid'], ['mosh', 'peak'], ['ink', 'calm'], ['orb', 'peak'], ['city', 'mid'], ['morph', 'mid'], ['nameboard', 'mid'],
];
const MODES: ModeInfo[] = IDS.map(([id, energy]) => ({ id, name: id, blurb: '', energy }));
const energy = (id: string) => MODES.find((m) => m.id === id)!.energy;

describe('song looks', () => {
  it('gives the same song the same look, and different songs different ones', () => {
    const a = songLook({ id: 't1', title: 'One', genre: 'House', key: { root: 9, minor: true }, bpm: 124 }, MODES);
    expect(songLook({ id: 't1', title: 'One', genre: 'House', key: { root: 9, minor: true }, bpm: 124 }, MODES)).toEqual(a);
    const looks = Array.from({ length: 12 }, (_, i) => songLook({ id: `track-${i}`, title: `Song ${i}`, genre: 'House', bpm: 124 }, MODES));
    // colours, opening modes and layer styles all vary across songs
    expect(new Set(looks.map((l) => l.colors.join())).size).toBe(12);
    expect(new Set(looks.map((l) => l.first)).size).toBeGreaterThan(3);
    expect(new Set(looks.map((l) => `${l.drum}/${l.melody}/${l.vocal}`)).size).toBeGreaterThan(3);
    expect(describeLook(a)).toMatch(/^House look · drums: \w+ · melody: \w+ · vocals: \w+$/);
  });

  it('fits the genre: modes, styles and how hard the drums show', () => {
    const techno = songLook({ id: 'x', genre: 'Techno', bpm: 132 }, MODES);
    const ambient = songLook({ id: 'x', genre: 'Ambient', bpm: 80 }, MODES);
    expect(techno.pool.filter((id) => ['strobe', 'moire', 'circuit', 'sonar', 'warp', 'lasers', 'crt', 'echo', 'mosh', 'rain', 'cells', 'hexfloor', 'matrix'].includes(id)).length).toBeGreaterThanOrEqual(6);
    expect(ambient.pool).toContain('aurora');
    // mostly the genre's styles, sometimes another, so songs of one genre still differ
    const share = (genre: string, key: 'drum' | 'melody' | 'vocal', fit: string[]) => {
      const n = 60;
      return Array.from({ length: n }, (_, i) => songLook({ id: `${genre}${i}`, genre }, MODES)[key]).filter((x) => fit.includes(x)).length / n;
    };
    expect(share('Techno', 'drum', ['bars', 'punch'])).toBeGreaterThan(0.65);
    expect(share('Ambient', 'melody', ['aurora', 'orbit'])).toBeGreaterThan(0.65);
    expect(share('Trance', 'vocal', ['rays', 'halo'])).toBeGreaterThan(0.65);
    expect(ambient.drumAmt).toBeLessThan(0.4);
    expect(techno.drumAmt).toBeGreaterThan(0.8);
  });

  it('always has calm, groove and peak modes, and opens on one that isn’t a peak', () => {
    for (const genre of ['Techno', 'House', 'Trance', 'Trap', 'Hip Hop', 'Ambient', 'Polka', undefined]) {
      for (let i = 0; i < 6; i++) {
        const l = songLook({ id: `${genre}-${i}`, genre }, MODES);
        for (const e of ['calm', 'mid', 'peak'] as const) expect(l.pool.filter((id) => energy(id) === e).length, `${genre} ${e}`).toBeGreaterThanOrEqual(2);
        expect(energy(l.first)).not.toBe('peak');
        expect(new Set(l.pool).size).toBe(l.pool.length);
      }
    }
  });

  it('takes its hue from the key: the same key, the same base colour; minor keys deeper', () => {
    const c1 = songLook({ id: 'a', key: { root: 0, minor: false }, genre: 'House' }, MODES).colors[0];
    const c2 = songLook({ id: 'b', key: { root: 0, minor: false }, genre: 'House' }, MODES).colors[0];
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const d = mx - mn || 1;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return ((h * 60) + 360) % 360;
    };
    expect(Math.abs(hue(c1) - hue(c2))).toBeLessThan(15);
  });
});

describe('the auto VJ with a song', () => {
  const feed = (beatCount: number) => ({ beatCount, playing: true, breakdown: 0, drop: 0, dropHit: false, energy: 0.5 });

  it('moves to the new song’s opening mode on the next bar, faded over four beats, then stays in its modes', () => {
    let seed = 1;
    const d = new Director(MODES, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    const look = songLook({ id: 's1', genre: 'Techno' }, MODES);
    d.tick('ink', feed(0));
    d.song(look.pool, look.first);
    const cut = d.tick('ink', feed(4));
    expect(cut).toEqual({ id: look.first, kind: 'fade', beats: 4 });
    let current = look.first;
    const played = new Set<string>();
    for (let b = 8; b < 8 + 4 * 200; b += 4) {
      const c = d.tick(current, feed(b));
      if (c) {
        current = c.id;
        played.add(c.id);
      }
    }
    expect(played.size).toBeGreaterThan(3);
    for (const id of played) expect(look.pool).toContain(id);
  });
});
