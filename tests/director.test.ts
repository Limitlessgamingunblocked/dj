import { describe, expect, it } from 'vitest';
import { Director, nextShot, sectionOf, SHOTS, type DirectorInput } from '../src/three/director';
import { VIEW_LABELS } from '../src/three/CameraRig';

// a seeded random source so the shot order is repeatable
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** play `bars` bars at 120 BPM (2 s a bar), 30 frames a second, with the section from `shape(bar)` */
function run(d: Director, bars: number, shape: (bar: number) => Partial<DirectorInput> = () => ({}), startBar = 0) {
  const cuts: { t: number; bar: number; view: string }[] = [];
  let view = 'perf';
  for (let f = 0; f < bars * 60; f++) {
    const t = startBar * 2 + f / 30;
    const bar = Math.floor(t / 2);
    const v = d.update({ t, playing: true, bar, build: 0, peak: 0, dropHit: false, ...shape(bar) }, view as never);
    if (v) {
      cuts.push({ t, bar, view: v });
      view = v;
    }
  }
  return cuts;
}

describe('auto director', () => {
  it('reads the part of the track from the light show', () => {
    expect(sectionOf({ playing: false, build: 0.9, peak: 1 })).toBe('idle');
    expect(sectionOf({ playing: true, build: 0, peak: 0.8 })).toBe('peak');
    expect(sectionOf({ playing: true, build: 0.8, peak: 0 })).toBe('build');
    expect(sectionOf({ playing: true, build: 0.4, peak: 0 })).toBe('breakdown');
    expect(sectionOf({ playing: true, build: 0.1, peak: 0 })).toBe('groove');
  });

  it('only uses angles that exist, and never repeats the shot on screen or the last few', () => {
    for (const pool of Object.values(SHOTS)) for (const v of pool) expect(Object.keys(VIEW_LABELS)).toContain(v);
    for (let i = 0; i < 50; i++) {
      const r = i / 50;
      const v = nextShot('groove', 'crowd', ['perf', 'booth'], r);
      expect(SHOTS.groove).toContain(v);
      expect(['crowd', 'perf', 'booth']).not.toContain(v);
    }
    // a pool smaller than the history still never repeats the current shot
    expect(nextShot('drop', 'fisheye', ['drone', 'crowd', 'camcorder'], 0.99)).not.toBe('fisheye');
  });

  it('cuts straight away when switched on, then on every 8-bar line in the groove', () => {
    const cuts = run(new Director(seeded()), 33);
    expect(cuts[0].t).toBe(0);
    expect(cuts.slice(1).map((c) => c.bar)).toEqual([8, 16, 24, 32]);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].view).not.toBe(cuts[i - 1].view);
  });

  it('cuts every 4 bars through a build and the peak, with build and peak shots', () => {
    const build = run(new Director(seeded(3)), 17, () => ({ build: 0.8 }));
    expect(build.slice(1).map((c) => c.bar)).toEqual([4, 8, 12, 16]);
    for (const c of build) expect(SHOTS.build).toContain(c.view);
    const peak = run(new Director(seeded(4)), 9, () => ({ peak: 1 }));
    expect(peak.slice(1).map((c) => c.bar)).toEqual([4, 8]);
  });

  it('gives the drop its own shot, even right after a phrase cut', () => {
    const d = new Director(seeded(5));
    const cuts = run(d, 17, (bar) => (bar < 16 ? { build: 0.95 } : { peak: 1 }));
    // the phrase cut lands on bar 16; the drop a frame later replaces it
    const view = cuts[cuts.length - 1].view;
    const r = d.update({ t: 32 + 2 / 30 + 10, playing: true, bar: 21, build: 0, peak: 1, dropHit: true }, view as never);
    expect(SHOTS.drop).toContain(r!);
    const d2 = new Director(seeded(6));
    d2.update({ t: 0, playing: true, bar: 0, build: 0.95, peak: 0, dropHit: false }, 'perf');
    d2.update({ t: 16, playing: true, bar: 8, build: 0.95, peak: 0, dropHit: false }, 'perf');
    const drop = d2.update({ t: 16.05, playing: true, bar: 8, build: 0, peak: 0, dropHit: true }, 'perf');
    expect(SHOTS.drop).toContain(drop!);
  });

  it('holds a shot at least a few seconds, and cuts slowly when nothing is playing', () => {
    const d = new Director(seeded(8));
    d.update({ t: 0, playing: true, bar: 7, build: 0, peak: 0, dropHit: false }, 'perf');
    // bar 8 arrives 1 s later: too soon after the first cut
    expect(d.update({ t: 1, playing: true, bar: 8, build: 0, peak: 0, dropHit: false }, 'perf')).toBeNull();
    const idle = new Director(seeded(9));
    let n = 0;
    for (let f = 0; f < 60 * 30; f++) if (idle.update({ t: f / 30, playing: false, bar: 0, build: 0, peak: 0, dropHit: false }, 'perf')) n++;
    // one on switching on, then one every 14 s or so over a minute
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(6);
  });

  it('decides once per show frame', () => {
    const d = new Director(seeded(10));
    expect(d.update({ t: 5, playing: true, bar: 2, build: 0, peak: 0, dropHit: false }, 'perf')).not.toBeNull();
    d.reset();
    // the same show time again (the club wasn't drawn): no decision
    expect(d.update({ t: 5, playing: true, bar: 2, build: 0, peak: 0, dropHit: false }, 'perf')).toBeNull();
  });
});
