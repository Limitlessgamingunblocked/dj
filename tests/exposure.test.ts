import { describe, expect, it } from 'vitest';
import { decodeHighlights, DEFAULT_EXPOSURE, nextExposure } from '../src/three/exposure';

const enc = (lin: number) => Math.round(((Math.log2(Math.max(lin, 1 / 4096)) + 12) / 16) * 255);

describe('auto exposure', () => {
  it('stops down when the highlights blow out and stays open in a dark club', () => {
    let e = 1;
    for (let i = 0; i < 120; i++) e = nextExposure(e, 1.6, 1 / 60);
    expect(e).toBeCloseTo(Math.max(DEFAULT_EXPOSURE.min, DEFAULT_EXPOSURE.key / 1.6), 2);
    let m = 1;
    for (let i = 0; i < 120; i++) m = nextExposure(m, 0.5, 1 / 60);
    expect(m).toBeCloseTo(DEFAULT_EXPOSURE.key / 0.5, 2);
    let d = 1;
    // opening up is slow on purpose: give it ten seconds
    for (let i = 0; i < 600; i++) d = nextExposure(d, 0.05, 1 / 60);
    expect(d).toBeCloseTo(DEFAULT_EXPOSURE.max, 3);
  });

  it('never leaves its range', () => {
    let e = 1;
    for (let i = 0; i < 600; i++) e = nextExposure(e, 400, 1 / 60);
    expect(e).toBeGreaterThanOrEqual(DEFAULT_EXPOSURE.min - 1e-9);
  });

  it('stops down faster than it opens up, so a hit still lands before it adapts', () => {
    const down = nextExposure(1, 1.28, 0.1); // wants 0.25 → clamped to min
    const up = nextExposure(0.35, 0.01, 0.1);
    const stopsDown = Math.log2(1 / down);
    const stopsUp = Math.log2(up / 0.35);
    expect(stopsDown).toBeGreaterThan(stopsUp);
    // and the first frame of a hit is barely touched (under a tenth of a stop)
    expect(Math.log2(1 / nextExposure(1, 1.6, 1 / 60))).toBeLessThan(0.1);
  });

  it('ignores a broken measurement', () => {
    expect(nextExposure(0.8, Number.NaN, 0.1)).toBe(0.8);
    expect(nextExposure(0.8, 0, 0.1)).toBe(0.8);
  });

  it('reads the highlight level as the 80th-percentile cell', () => {
    const cells = 144;
    const bytes = new Uint8Array(cells * 4);
    // 70 % dark crowd, 30 % blown-out beams
    for (let i = 0; i < cells; i++) bytes[i * 4] = enc(i < cells * 0.7 ? 0.01 : 3);
    expect(decodeHighlights(bytes, cells)).toBeCloseTo(3, 0);
    // all dark
    for (let i = 0; i < cells; i++) bytes[i * 4] = enc(0.02);
    expect(decodeHighlights(bytes, cells)).toBeCloseTo(0.02, 2);
  });
});
