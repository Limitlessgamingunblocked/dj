import { describe, expect, it } from 'vitest';
import { cutEvery, Director, nextShot, sectionOf, SHOT_SIZE, SHOTS, type DirectorInput } from '../src/three/director';
import { VIEW_LABELS } from '../src/three/CameraRig';

// a seeded random source so the shot order is repeatable
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** play `bars` bars at 120 BPM (2 s a bar), 30 frames a second, with the section from `shape(bar)` */
function run(d: Director, bars: number, shape: (bar: number) => Partial<DirectorInput> = () => ({}), startBar = 0) {
  const cuts: { t: number; bar: number; view: string; style: string; moment: string }[] = [];
  let view = 'perf';
  for (let f = 0; f < bars * 60; f++) {
    const t = startBar * 2 + f / 30;
    const bar = Math.floor(t / 2);
    const v = d.update({ t, playing: true, bar, build: 0, peak: 0, dropHit: false, ...shape(bar) }, view as never);
    if (v) {
      cuts.push({ t, bar, ...v });
      view = v.view;
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
    for (const pool of Object.values(SHOTS)) for (const v of Object.keys(pool)) expect(Object.keys(VIEW_LABELS)).toContain(v);
    for (const v of Object.keys(VIEW_LABELS)) expect(SHOT_SIZE).toHaveProperty(v);
    for (let i = 0; i < 50; i++) {
      const r = i / 50;
      const v = nextShot('groove', 'crowd', ['perf', 'booth'], r);
      expect(SHOTS.groove).toHaveProperty(v);
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

  it('cuts faster as a build climbs: every 4 bars, then 2, then every bar on close-ups', () => {
    expect([cutEvery('build', 0.65), cutEvery('build', 0.8), cutEvery('build', 0.95), cutEvery('peak', 0), cutEvery('groove', 0)]).toEqual([4, 2, 1, 4, 8]);
    const early = run(new Director(seeded(3)), 17, () => ({ build: 0.65 }));
    expect(early.slice(1).map((c) => c.bar)).toEqual([4, 8, 12, 16]);
    for (const c of early) expect(SHOTS.build).toHaveProperty(c.view);
    const late = run(new Director(seeded(3)), 9, () => ({ build: 0.8 }));
    expect(late.slice(1).map((c) => c.bar)).toEqual([2, 4, 6, 8]);
    // the last bars before the drop: a tight shot every bar
    const tension = run(new Director(seeded(11)), 6, () => ({ build: 0.95 }));
    expect(tension.slice(1).map((c) => c.bar)).toEqual([1, 2, 3, 4, 5]);
    for (const c of tension.slice(1)) {
      expect(c.moment).toBe('tension');
      expect(SHOTS.tension).toHaveProperty(c.view);
    }
    const peak = run(new Director(seeded(4)), 9, () => ({ peak: 1 }));
    expect(peak.slice(1).map((c) => c.bar)).toEqual([4, 8]);
  });

  it('goes wide, close and medium in turn: the next shot is a different size when it can be', () => {
    for (const moment of ['groove', 'peak', 'drop', 'breakdown'] as const) {
      for (const cur of ['wide', 'hero', 'hands'] as const) {
        for (let i = 0; i < 20; i++) expect(SHOT_SIZE[nextShot(moment, cur, [], i / 20)]).not.toBe(SHOT_SIZE[cur]);
      }
    }
    const cuts = run(new Director(seeded(12)), 80);
    for (let i = 1; i < cuts.length; i++) expect(SHOT_SIZE[cuts[i].view as never]).not.toBe(SHOT_SIZE[cuts[i - 1].view as never]);
  });

  it('cuts hard on the beat, and only dips through black in the breakdown and between tracks', () => {
    const groove = run(new Director(seeded(13)), 33);
    expect(groove[0].style).toBe('dip');
    for (const c of groove.slice(1)) expect(c.style).toBe('cut');
    const bd = run(new Director(seeded(14)), 17, () => ({ build: 0.4 }));
    for (const c of bd) expect(c.style).toBe('dip');
  });

  it('gives the drop its own hard cut to a payoff shot, even right after a phrase cut, and holds it 4 bars', () => {
    const d = new Director(seeded(5));
    const cuts = run(d, 17, (bar) => (bar < 16 ? { build: 0.95 } : { peak: 1 }));
    const view = cuts[cuts.length - 1].view;
    const r = d.update({ t: 32 + 2 / 30 + 10, playing: true, bar: 21, build: 0, peak: 1, dropHit: true }, view as never);
    expect(SHOTS.drop).toHaveProperty(r!.view);
    expect(r!.style).toBe('cut');
    const d2 = new Director(seeded(6));
    d2.update({ t: 0, playing: true, bar: 0, build: 0.95, peak: 0, dropHit: false }, 'perf');
    d2.update({ t: 16, playing: true, bar: 8, build: 0.95, peak: 0, dropHit: false }, 'perf');
    const drop = d2.update({ t: 16.05, playing: true, bar: 8, build: 0, peak: 1, dropHit: true }, 'perf');
    expect(drop!.moment).toBe('drop');
    // the payoff holds through bar 12, then the peak cuts on its 4-bar line
    const after = run(d2, 8, () => ({ peak: 1 }), 9).map((c) => c.bar);
    expect(after[0]).toBe(12);
  });

  it('goes to the hands when a blend starts, and back and forth while it lasts', () => {
    const d = new Director(seeded(15));
    const cuts = run(d, 24, (bar) => ({ mixing: bar >= 5 && bar < 21 }));
    const mix = cuts.filter((c) => c.moment === 'mix');
    // the blend starts in bar 5: the hands on the next bar line
    expect(cuts.find((c) => c.bar === 6)?.moment).toBe('mix');
    for (const c of mix) expect(SHOTS.mix).toHaveProperty(c.view);
    expect(mix.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the venue when a new track takes over', () => {
    const d = new Director(seeded(16));
    const cuts = run(d, 20, (bar) => ({ track: bar < 10 ? 'a' : 'b' }));
    const c = cuts.find((x) => x.bar === 11);
    expect(c?.moment).toBe('track');
    expect(SHOTS.track).toHaveProperty(c!.view);
    // the first track (when it's switched on) isn't a change
    expect(cuts.filter((x) => x.moment === 'track')).toHaveLength(1);
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
