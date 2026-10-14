import { describe, expect, it } from 'vitest';
import { plinthScale, ringTurnFor, slotPosition, wrapIndex } from '../src/three/carousel';
import { arcPoints, cityLatLon, faceTurn, inPolygon, latLonToXYZ, nearestAngle, onLand, spherePoints } from '../src/three/globe';
import { CITIES } from '../src/game/circuit';

/** rotate a point by the globe's turn: yaw about y first, then tilt about x */
function turned([x, y, z]: [number, number, number], yaw: number, tilt: number): [number, number, number] {
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return [x1, y * Math.cos(tilt) - z1 * Math.sin(tilt), y * Math.sin(tilt) + z1 * Math.cos(tilt)];
}

describe('board showroom ring', () => {
  it('wraps indexes both ways', () => {
    expect(wrapIndex(-1, 8)).toBe(7);
    expect(wrapIndex(8, 8)).toBe(0);
    expect(wrapIndex(3, 8)).toBe(3);
  });

  it('turns the chosen slot to the front, the short way round', () => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const turn = ringTurnFor(i, n, 0);
      const [x, z] = slotPosition(i, n, 3);
      // the ring's turn about y: the slot ends at x = 0, in front (z > 0)
      const fx = x * Math.cos(turn) + z * Math.sin(turn);
      const fz = -x * Math.sin(turn) + z * Math.cos(turn);
      expect(fx).toBeCloseTo(0, 6);
      expect(fz).toBeCloseTo(3, 6);
      expect(Math.abs(turn)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
    // from slot 7 to slot 0 is one step, not seven
    const from = ringTurnFor(7, n, 0);
    expect(Math.abs(ringTurnFor(0, n, from) - from)).toBeCloseTo((Math.PI * 2) / n, 6);
  });

  it('keeps boards at real size unless they are too wide', () => {
    expect(plinthScale(0.7, 1.25)).toBe(1);
    expect(plinthScale(2.5, 1.25)).toBeCloseTo(0.5);
  });
});

describe('tour globe', () => {
  it('reads cities back to their real places', () => {
    const london = cityLatLon(CITIES.find((c) => c.id === 'london')!);
    expect(london[0]).toBeCloseTo(51.5, 0);
    expect(london[1]).toBeCloseTo(0, 0);
    const sydney = cityLatLon(CITIES.find((c) => c.id === 'sydney')!);
    expect(sydney[0]).toBeLessThan(-30);
    expect(sydney[1]).toBeGreaterThan(145);
  });

  it('puts points on the sphere and 90° W in front', () => {
    const p = latLonToXYZ(0, -90, 2);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(2, 6);
    expect(latLonToXYZ(90, 0)[1]).toBeCloseTo(1, 6);
    const q = latLonToXYZ(37, 120, 1.5);
    expect(Math.hypot(...q)).toBeCloseTo(1.5, 6);
  });

  it('turns every city round to face the camera', () => {
    for (const c of CITIES) {
      const [lat, lon] = cityLatLon(c);
      const { yaw, tilt } = faceTurn(lat, lon);
      const [x, y, z] = turned(latLonToXYZ(lat, lon), yaw, tilt);
      expect(x).toBeCloseTo(0, 6);
      expect(y).toBeCloseTo(0, 6);
      expect(z).toBeCloseTo(1, 6);
    }
  });

  it('takes the short way round', () => {
    expect(nearestAngle(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 6);
    const r = nearestAngle(10, 0);
    expect(Math.abs(r - 10)).toBeLessThanOrEqual(Math.PI);
    expect(Math.cos(r)).toBeCloseTo(1, 6);
  });

  it('flies arcs from city to city, higher in the middle for longer hops', () => {
    const a = latLonToXYZ(51.5, 0);
    const b = latLonToXYZ(40.7, -74);
    const pts = arcPoints(a, b, 0.24, 32);
    expect(pts).toHaveLength(33);
    pts[0].forEach((v, i) => expect(v).toBeCloseTo(a[i], 6));
    pts[32].forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
    const mid = Math.hypot(...pts[16]);
    expect(mid).toBeGreaterThan(1.1);
    const short = arcPoints(latLonToXYZ(51.5, 0), latLonToXYZ(52.4, 4.9), 0.24, 32);
    expect(Math.hypot(...short[16])).toBeLessThan(mid);
  });

  it('spreads land dots over the continents and not the sea', () => {
    const pts = spherePoints(4000);
    expect(pts).toHaveLength(4000);
    const land = pts.filter(([lat, lon]) => onLand(lat, lon)).length;
    // about a quarter of the world, by these rough outlines
    expect(land / pts.length).toBeGreaterThan(0.15);
    expect(land / pts.length).toBeLessThan(0.4);
    expect(onLand(48.8, 2.3)).toBe(true); // Paris
    expect(onLand(30, -40)).toBe(false); // the mid-Atlantic
    expect(inPolygon(0.5, 0.5, [[0, 0], [0, 1], [1, 1], [1, 0]])).toBe(true);
  });
});
