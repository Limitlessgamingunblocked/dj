import { describe, expect, it } from 'vitest';
import type { Features } from '../src/visualizer/AudioFeatures';
import { avDelay, FeatureDelay } from '../src/visualizer/avsync';

const frame = (time: number, o: Partial<Features> = {}): Features =>
  ({
    spectrum: new Float32Array(256).fill(time),
    waveform: new Float32Array(512),
    time,
    kickHit: false,
    snareHit: false,
    dropHit: false,
    beatPhase: time % 1,
    ...o,
  }) as Features;

describe('AV sync', () => {
  it('delays by the device latency plus the offset, within 0..0.5 s', () => {
    expect(avDelay({ baseLatency: 0.01, outputLatency: 0.15 }, 0)).toBeCloseTo(0.16, 6);
    expect(avDelay({ baseLatency: 0.01, outputLatency: 0.15 }, 40)).toBeCloseTo(0.2, 6);
    expect(avDelay({}, 0)).toBe(0);
    expect(avDelay({ outputLatency: Number.NaN }, -50)).toBe(0);
    expect(avDelay({ outputLatency: 0.4 }, 300)).toBe(0.5);
  });

  it('hands out the frame from the delay ago, copied', () => {
    const d = new FeatureDelay();
    let out: Features | null = null;
    for (let i = 0; i <= 60; i++) out = d.push(i / 60, frame(i / 60), 0.2);
    expect(out!.time).toBeCloseTo(48 / 60, 6);
    expect(out!.spectrum[0]).toBeCloseTo(48 / 60, 6);
    // passes straight through with no delay
    const live = frame(5);
    expect(d.push(5, live, 0)).toBe(live);
  });

  it('carries every hit through exactly once, even when frames are skipped or repeated', () => {
    const d = new FeatureDelay();
    const times = [0, 0.016, 0.05, 0.051, 0.12, 0.121, 0.122, 0.3, 0.31, 0.6, 0.61, 0.62, 0.9, 1.4];
    const hitsAt = new Set([0.016, 0.051, 0.121, 0.122, 0.61]);
    let kicks = 0;
    let drops = 0;
    for (const t of times) {
      const out = d.push(t, frame(t, { kickHit: hitsAt.has(t), dropHit: t === 0.31 }), 0.15);
      if (out.kickHit) kicks++;
      if (out.dropHit) drops++;
    }
    // the frames jump from 0.122 to 0.3, so the first four hits come out together in one
    // frame; the one at 0.61 comes out on its own; none twice
    expect(kicks).toBe(2);
    expect(drops).toBe(1);
    // at a steady 60 fps every hit comes out on its own frame
    const s = new FeatureDelay();
    let n60 = 0;
    for (let i = 0; i < 600; i++) if (s.push(i / 60, frame(i / 60, { kickHit: i % 30 === 0 }), 0.18).kickHit) n60++;
    expect(n60).toBe(20);
    // and a repeated frame doesn't fire twice
    const e = new FeatureDelay();
    e.push(0, frame(0, { kickHit: true }), 0.1);
    let n = 0;
    for (const t of [0.1, 0.105, 0.108]) if (e.push(t, frame(t), 0.1).kickHit) n++;
    expect(n).toBe(1);
  });
});
