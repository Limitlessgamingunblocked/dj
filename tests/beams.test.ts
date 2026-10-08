import { describe, expect, it } from 'vitest';
import { coneInterval, goboFor, prismFacets } from '../src/three/venues/beams';

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** brute force: is point p inside the truncated cone (lens radius r0, far radius r1, length len)? */
function inside(p: V3, lens: V3, axis: V3, r0: number, r1: number, len: number): boolean {
  const rel: V3 = [p[0] - lens[0], p[1] - lens[1], p[2] - lens[2]];
  const h = rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2];
  if (h < 0 || h > len) return false;
  const r = Math.hypot(rel[0] - h * axis[0], rel[1] - h * axis[1], rel[2] - h * axis[2]);
  return r <= r0 + ((r1 - r0) * h) / len;
}

describe('beam volume: ray against the cone', () => {
  const lens: V3 = [0, 8, 0];
  const axis = norm([0.3, -1, 0.2]);
  const r0 = 0.05;
  const r1 = 0.9;
  const len = 12;
  // pseudo-random rays from cameras all round the beam, including from inside it
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  it('finds exactly the stretch of each ray that is inside the beam', () => {
    let hits = 0;
    for (let n = 0; n < 400; n++) {
      const inBeam = n % 10 === 0;
      const ro: V3 = inBeam ? [lens[0] + axis[0] * 6, lens[1] + axis[1] * 6, lens[2] + axis[2] * 6] : [rnd() * 20 - 10, rnd() * 10, rnd() * 20 - 10];
      // aim near a point on the beam so most rays hit
      const h = rnd() * len;
      const target: V3 = [lens[0] + axis[0] * h + (rnd() - 0.5), lens[1] + axis[1] * h + (rnd() - 0.5), lens[2] + axis[2] * h + (rnd() - 0.5)];
      const rd = norm([target[0] - ro[0], target[1] - ro[1], target[2] - ro[2]]);
      const iv = coneInterval(ro, rd, lens, axis, r0, r1, len);
      // sample the ray finely and compare
      let first = -1;
      let last = -1;
      for (let t = 0; t < 40; t += 0.005) {
        if (inside([ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t], lens, axis, r0, r1, len)) {
          if (first < 0) first = t;
          last = t;
        }
      }
      if (first < 0) {
        // a miss (or a graze thinner than the sampling)
        if (iv) expect(iv[1] - iv[0]).toBeLessThan(0.02);
        continue;
      }
      hits++;
      expect(iv).not.toBeNull();
      expect(iv![0]).toBeCloseTo(first, 1);
      expect(iv![1]).toBeCloseTo(last, 1);
    }
    expect(hits).toBeGreaterThan(150);
  });

  it('starts at the camera when the camera is inside the beam', () => {
    const ro: V3 = [lens[0] + axis[0] * 5, lens[1] + axis[1] * 5, lens[2] + axis[2] * 5];
    const iv = coneInterval(ro, axis, lens, axis, r0, r1, len);
    expect(iv![0]).toBe(0);
    expect(iv![1]).toBeCloseTo(7, 4);
  });
});

describe('gobos and the prism', () => {
  const base = { build: 0, peak: 0, bar: 0, beat: 0, playing: true };
  it('turns slow dots in a breakdown, spins spokes up through a build, opens with the prism at the peak', () => {
    expect(goboFor({ ...base, build: 0.4 }, 0).gobo).toBe(2);
    const early = goboFor({ ...base, build: 0.65, beat: 10 }, 0);
    const late = goboFor({ ...base, build: 0.95, beat: 10 }, 0);
    expect(early.gobo).toBe(1);
    expect(Math.abs(late.spin)).toBeGreaterThan(Math.abs(early.spin));
    expect(late.prism).toBe(true);
    expect(goboFor({ ...base, peak: 1 }, 0).prism).toBe(true);
  });
  it('turns alternate heads the other way, and changes texture every 8 bars of the groove', () => {
    expect(Math.sign(goboFor({ ...base, beat: 4 }, 0).spin)).toBe(-Math.sign(goboFor({ ...base, beat: 4 }, 1).spin));
    const seen = new Set([0, 8, 16, 24].map((bar) => goboFor({ ...base, bar }, 0).gobo));
    expect(seen.size).toBe(4);
  });
  it('spreads the three prism beams evenly round the axis', () => {
    const f = prismFacets(0.3);
    expect(f).toHaveLength(3);
    expect(f[1][0] - f[0][0]).toBeCloseTo((Math.PI * 2) / 3, 6);
    expect(f[2][0] - f[1][0]).toBeCloseTo((Math.PI * 2) / 3, 6);
  });
});
