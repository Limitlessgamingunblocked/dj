import { describe, expect, it } from 'vitest';
import { available, BARS, Director, IDLE_SECONDS, nextShot, POOLS, sectionOf, SIZE, type CamId, type DirectorInput, type DirectorMenu, type Take } from '../src/three/director';
import { VIEW_LABELS } from '../src/three/CameraRig';
import { SHOTS } from '../src/three/shots';

// a seeded random source so the shot order is repeatable
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const FEST: DirectorMenu = { style: 'festival', open: true, landmarks: 3 };
const CLUB: DirectorMenu = { style: 'stream', open: false, landmarks: 0 };
const FILM: DirectorMenu = { style: 'cinematic', open: true, landmarks: 2 };

type Cut = Take & { t: number; bar: number };

/** play `bars` bars at 120 BPM (2 s a bar), 30 frames a second, with the music from `shape(bar)` */
function run(d: Director, menu: DirectorMenu, bars: number, shape: (bar: number) => Partial<DirectorInput> = () => ({}), startBar = 0): Cut[] {
  const cuts: Cut[] = [];
  for (let f = 0; f < bars * 60; f++) {
    const t = startBar * 2 + f / 30;
    const bar = Math.floor(t / 2);
    const v = d.update({ t, playing: true, bar, build: 0, peak: 0, dropHit: false, ...shape(bar) }, menu);
    if (v) cuts.push({ ...v, t, bar });
  }
  return cuts;
}

describe('auto director: the shot grammar', () => {
  it('reads the part of the track from the light show', () => {
    expect(sectionOf({ playing: false, build: 0.9, peak: 1 })).toBe('idle');
    expect(sectionOf({ playing: true, build: 0, peak: 0.8 })).toBe('peak');
    expect(sectionOf({ playing: true, build: 0.8, peak: 0 })).toBe('build');
    expect(sectionOf({ playing: true, build: 0.4, peak: 0 })).toBe('breakdown');
    expect(sectionOf({ playing: true, build: 0.1, peak: 0 })).toBe('groove');
  });

  it('only uses angles and moves that exist, each with a size', () => {
    const known = [...Object.keys(VIEW_LABELS), ...Object.keys(SHOTS), 'landmark'];
    for (const style of Object.values(POOLS)) for (const pool of Object.values(style)) for (const v of pool) expect(known).toContain(v);
    for (const k of known) expect(SIZE[k as CamId]).toBeDefined();
  });

  it('never repeats the shot on screen or the last few, and mostly changes the size', () => {
    const pool = POOLS.festival.groove;
    let changed = 0;
    for (let i = 0; i < 100; i++) {
      const v = nextShot(pool, 'hands', ['hero', 'tele'], i / 100, FEST);
      expect(['hands', 'hero', 'tele']).not.toContain(v);
      if (SIZE[v] !== 'close') changed++;
    }
    expect(changed).toBeGreaterThan(80);
    // a pool smaller than the history still never repeats the current shot
    expect(nextShot(['fisheye', 'crowd'], 'fisheye', ['crowd'], 0.99, CLUB)).not.toBe('fisheye');
  });

  it('keeps aerials outdoors and landmarks where there are some', () => {
    expect(available('aerial', CLUB)).toBe(false);
    expect(available('landmark', CLUB)).toBe(false);
    expect(available('aerial', FEST)).toBe(true);
    for (let i = 0; i < 50; i++) expect(['aerial', 'landmark']).not.toContain(nextShot(POOLS.festival.breakdown, 'wide', [], i / 50, CLUB));
  });
});

describe('auto director: cutting with the music', () => {
  it('opens on the place, then cuts on every 8-bar line in a festival groove', () => {
    const cuts = run(new Director(seeded()), FEST, 33);
    expect(cuts[0].t).toBe(0);
    expect(POOLS.festival.open).toContain(cuts[0].id);
    expect(cuts.slice(1).map((c) => c.bar)).toEqual([8, 16, 24, 32]);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].id === 'landmark' || cuts[i].id !== cuts[i - 1].id).toBe(true);
  });

  it('a club stream holds its shots for 16 bars (after an 8-bar opener)', () => {
    const cuts = run(new Director(seeded(2)), CLUB, 49);
    expect(cuts.slice(1).map((c) => c.bar)).toEqual([8, 24, 40]);
    expect(cuts.every((c) => c.cut === 'hard')).toBe(true);
  });

  it('a build opens on a push in, then cuts every 4 bars (festival)', () => {
    const cuts = run(new Director(seeded(3)), FEST, 25, (bar) => ({ build: bar >= 8 ? 0.8 : 0 }));
    const inBuild = cuts.filter((c) => c.bar >= 8);
    expect(inBuild[0].bar).toBe(8);
    expect(inBuild[0].id).toBe('pushin');
    // the push in is paced to run its 4 bars
    expect(inBuild[0].seconds).toBeCloseTo(8, 0);
    expect(inBuild.map((c) => c.bar)).toEqual([8, 12, 16, 20, 24]);
    for (const c of inBuild) expect(POOLS.festival.build).toContain(c.id);
  });

  it('gives the drop its shot on the beat, then three quick one-bar cuts, then the peak', () => {
    const d = new Director(seeded(5));
    run(d, FEST, 16, () => ({ build: 0.95 }));
    const drop = d.update({ t: 32.01, playing: true, bar: 16, build: 0, peak: 1, dropHit: true }, FEST)!;
    expect(POOLS.festival.drop).toContain(drop.id);
    expect(drop.cut).toBe('hard');
    const after = run(d, FEST, 14, () => ({ peak: 1 }), 16).filter((c) => c.t > 32.01);
    // bars 17, 18, 19: the montage; then four-bar (sometimes two-bar) peak cuts on the grid
    expect(after.slice(0, 3).map((c) => c.bar)).toEqual([17, 18, 19]);
    for (const c of after.slice(0, 3)) expect(POOLS.festival.burst).toContain(c.id);
    const rest = after.slice(3);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest[0].bar - 19).toBeGreaterThanOrEqual(2);
    for (const c of rest) expect(c.bar % 2).toBe(0);
  });

  it('with less motion asked for, the drop gets one shot and no montage', () => {
    const d = new Director(seeded(6));
    run(d, { ...FEST, calm: true }, 16, () => ({ build: 0.95 }));
    expect(d.update({ t: 32.01, playing: true, bar: 16, build: 0, peak: 1, dropHit: true }, { ...FEST, calm: true })).not.toBeNull();
    const after = run(d, { ...FEST, calm: true }, 4, () => ({ peak: 1 }), 16).filter((c) => c.t > 32.01);
    expect(after).toHaveLength(0);
  });

  it('a mix goes to the hands on the decks on the next bar', () => {
    const cuts = run(new Director(seeded(8)), FEST, 14, (bar) => ({ mixing: bar >= 5 && bar < 13 }));
    const mix = cuts.find((c) => c.bar >= 5 && c.bar < 13);
    expect(mix).toBeDefined();
    expect(mix!.id).toBe('hands');
    // after a bar of both decks, not on the first frame of it
    expect(mix!.bar).toBe(6);
  });

  it('breakdowns show the place: landmarks come round in turn', () => {
    const cuts = run(new Director(seeded(9)), FILM, 160, () => ({ build: 0.4 }));
    const marks = cuts.filter((c) => c.id === 'landmark');
    expect(marks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(marks.map((c) => c.landmark)).size).toBe(2);
    // cinematic: long shots, through a dip
    expect(cuts.slice(1).every((c) => c.bar % 4 === 0 && c.cut === 'dip')).toBe(true);
    expect(BARS.cinematic.breakdown).toBe(16);
  });

  it('holds a shot at least a few seconds, and cuts slowly when nothing is playing', () => {
    const d = new Director(seeded(10));
    d.update({ t: 0, playing: true, bar: 7, build: 0, peak: 0, dropHit: false }, FEST);
    // a section change at bar 8 arrives 1 s later: too soon after the first cut
    expect(d.update({ t: 1, playing: true, bar: 8, build: 0.8, peak: 0, dropHit: false }, FEST)).toBeNull();
    const idle = new Director(seeded(11));
    let n = 0;
    for (let f = 0; f < 60 * 30; f++) if (idle.update({ t: f / 30, playing: false, bar: 0, build: 0, peak: 0, dropHit: false }, FEST)) n++;
    // one on switching on, then one every 14 s or so over a minute
    expect(n).toBeGreaterThanOrEqual(Math.floor(60 / IDLE_SECONDS));
    expect(n).toBeLessThanOrEqual(6);
  });

  it('measures the bar and decides once per show frame', () => {
    const d = new Director(seeded(12));
    run(d, FEST, 12);
    expect(d.barSeconds).toBeCloseTo(2, 1);
    expect(d.update({ t: 504, playing: true, bar: 252, build: 0, peak: 0, dropHit: false }, FEST)).not.toBeNull();
    d.reset();
    // the same show time again (the club wasn't drawn): no decision
    expect(d.update({ t: 504, playing: true, bar: 252, build: 0, peak: 0, dropHit: false }, FEST)).toBeNull();
  });
});
