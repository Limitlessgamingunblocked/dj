import { describe, expect, it } from 'vitest';
import { BeatClock, type ClockInput } from '../src/core/BeatClock';

/** the clock's input at time t for a track at `bpm` (first beat at 0) */
const at = (t: number, bpm: number, o: Partial<ClockInput> = {}): ClockInput => {
  const b = (t * bpm) / 60;
  return { playing: true, bpm, beatCount: Math.floor(b), beatPhase: b % 1, breakdown: 0, dropHit: false, ...o };
};

function run(clock: BeatClock, secs: number, bpm: number, fps = 60, o: (t: number) => Partial<ClockInput> = () => ({})) {
  for (let i = 0; i <= secs * fps; i++) clock.update(at(i / fps, bpm, o(i / fps)), 1 / fps);
}

describe('BeatClock', () => {
  it('broadcasts every beat, bar and phrase once, in order', () => {
    const c = new BeatClock();
    const beats: number[] = [];
    const bars: number[] = [];
    const phrases: [number, number][] = [];
    c.onBeat((e) => beats.push(e.beat));
    c.onBar((e) => bars.push(e.bar));
    c.onPhrase((e) => phrases.push([e.bar, e.length]));
    // 124 BPM for a little over 64 bars
    run(c, (64 * 4 * 60) / 124 + 0.1, 124);
    expect(beats.length).toBe(257);
    expect(beats.every((b, i) => b === i)).toBe(true);
    expect(bars).toEqual(Array.from({ length: 65 }, (_, i) => i));
    expect(phrases).toEqual([
      [0, 32],
      [8, 8],
      [16, 16],
      [24, 8],
      [32, 32],
      [40, 8],
      [48, 16],
      [56, 8],
      [64, 32],
    ]);
  });

  it('keeps time at a low frame rate and when a stalled tab skips ahead', () => {
    const c = new BeatClock();
    let n = 0;
    c.onBeat(() => n++);
    run(c, 30, 126, 12);
    expect(n).toBe(Math.floor((30 * 126) / 60) + 1);
    // a 10-second stall: catches up a few beats, not a storm of 21
    let after = 0;
    c.onBeat(() => after++);
    c.update(at(40, 126), 10);
    expect(after).toBeLessThanOrEqual(8);
    expect(c.beat).toBe(Math.floor((40 * 126) / 60));
  });

  it('stays quiet when nothing plays and resyncs after a seek', () => {
    const c = new BeatClock();
    let n = 0;
    c.onBeat(() => n++);
    for (let i = 0; i < 120; i++) c.update(at(i / 60, 124, { playing: false }), 1 / 60);
    expect(n).toBe(0);
    expect(c.section).toBe('idle');
    run(c, 2, 124);
    const before = n;
    // jump back 16 beats: no events for the jump itself
    c.update(at(0.2, 124), 1 / 60);
    expect(n).toBe(before);
  });

  it('follows the sections: breakdown, build, drop, back to the groove', () => {
    const c = new BeatClock();
    const log: string[] = [];
    c.onBreakdown(() => log.push('breakdown'));
    c.onBuildStart(() => log.push('build'));
    c.onDrop(() => log.push('drop'));
    const bpm = 120; // a bar every 2 s
    run(c, 8, bpm);
    expect(c.section).toBe('groove');
    // the low end goes for 8 s (breakdown deepens to 1), then the drop
    const t0 = 8;
    for (let i = 1; i <= 8 * 60; i++) c.update(at(t0 + i / 60, bpm, { breakdown: i / 480 }), 1 / 60);
    expect(c.section).toBe('build');
    c.update(at(16.02, bpm, { dropHit: true }), 1 / 60);
    expect(c.section).toBe('drop');
    expect(log).toEqual(['breakdown', 'build', 'drop']);
    // 16 bars later the drop's section is over
    for (let i = 1; i <= 33 * 60; i++) c.update(at(16.02 + i / 60, bpm), 1 / 60);
    expect(c.section).toBe('groove');
  });

  it('a broken listener does not stop the others', () => {
    const c = new BeatClock();
    let ok = 0;
    const spy = console.error;
    console.error = () => {};
    c.onBeat(() => {
      throw new Error('boom');
    });
    c.onBeat(() => ok++);
    run(c, 2, 120);
    console.error = spy;
    expect(ok).toBe(5);
  });
});

import { nextRedline } from '../src/audio/redline';

describe('master redline', () => {
  it('ignores light limiting, rises fast when pushed, lets go slowly', () => {
    let r = 0;
    for (let i = 0; i < 60; i++) r = nextRedline(r, 0.8, 1 / 60);
    expect(r).toBe(0);
    for (let i = 0; i < 12; i++) r = nextRedline(r, 6, 1 / 60);
    expect(r).toBeGreaterThan(0.95);
    for (let i = 0; i < 30; i++) r = nextRedline(r, 0, 1 / 60);
    expect(r).toBeGreaterThan(0.3);
    for (let i = 0; i < 300; i++) r = nextRedline(r, Number.NaN, 1 / 60);
    expect(r).toBeLessThan(0.01);
  });
});
