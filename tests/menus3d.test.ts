import { describe, expect, it } from 'vitest';
import { plinthScale, ringTurnFor, slotPosition, wrapIndex } from '../src/three/carousel';
import { arcPoints, cityLatLon, faceTurn, inPolygon, latLonToXYZ, nearestAngle, onLand, spherePoints } from '../src/three/globe';
import { CITIES } from '../src/game/circuit';
import { cityPins, ringRadius, VENUE_PLACES, venueGroup } from '../src/three/venueMap';
import { doorOpen, flashAt, HALL, shotAt, WALK, walkerZ, walkSpeed } from '../src/three/backstage';
import { VENUES } from '../src/three/venues';
import { CRAZY_ROOMS } from '../src/three/venues/rooms';

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

describe('venue globe', () => {
  const secret = new Set(CRAZY_ROOMS.map((v) => v.id));

  it('pins every real club, one pin per city', () => {
    for (const id of Object.keys(VENUE_PLACES)) expect(VENUES.some((v) => v.id === id)).toBe(true);
    const pins = cityPins(VENUES.map((v) => v.id));
    const london = pins.find((p) => p.city === 'London')!;
    expect(london.ids.sort()).toEqual(['allypally', 'allypally-round', 'printworks']);
    expect(london.lat).toBeCloseTo(51.56, 1);
    expect(pins.find((p) => p.city === 'Berlin')!.ids).toEqual(['berghain']);
    // the pin sits where the clubs are: Ibiza in the Med, Black Rock City in Nevada
    expect(pins.find((p) => p.city === 'Ibiza')!.lon).toBeGreaterThan(1);
    expect(pins.find((p) => p.city === 'Black Rock City')!.lon).toBeLessThan(-119);
  });

  it('puts every venue on the planet, in orbit or in the portal ring', () => {
    expect(venueGroup('printworks', secret)).toBe('real');
    expect(venueGroup('bedroom', secret)).toBe('circuit');
    expect(venueGroup('deckhouse', secret)).toBe('circuit');
    expect(venueGroup(CRAZY_ROOMS[0].id, secret)).toBe('secret');
    expect(venueGroup('custom-1', secret)).toBe('yours');
    const groups = VENUES.map((v) => venueGroup(v.id, secret));
    expect(groups.filter((g) => g === 'circuit').length).toBeGreaterThanOrEqual(8);
  });

  it('grows a ring to fit what rides it', () => {
    expect(ringRadius(4, 0.5, 2)).toBe(2);
    expect(ringRadius(60, 0.5, 2)).toBeCloseTo((60 * 0.5) / (Math.PI * 2));
  });
});

describe('walk out to the booth', () => {
  const steps = Array.from({ length: 200 }, (_, i) => (i / 199) * WALK.length);

  it('sets off from a standstill and keeps walking towards the stage', () => {
    expect(walkSpeed(0)).toBe(0);
    expect(walkerZ(0)).toBe(WALK.from);
    expect(walkSpeed(WALK.length)).toBe(WALK.speed);
    for (let i = 1; i < steps.length; i++) expect(walkerZ(steps[i])).toBeLessThanOrEqual(walkerZ(steps[i - 1]));
    // the speed is the slope of the position
    const t = 3;
    expect((walkerZ(t) - walkerZ(t + 0.01)) / 0.01).toBeCloseTo(walkSpeed(t), 2);
  });

  it('opens the door before you get there, and whites out at the end', () => {
    const z = walkerZ(WALK.length);
    expect(z).toBeGreaterThan(HALL.door);
    expect(HALL.door + 2).toBeGreaterThan(z);
    const opened = steps.find((t) => doorOpen(t) > 0.99)!;
    expect(walkerZ(opened)).toBeGreaterThan(HALL.door + 1.5);
    expect(flashAt(0)).toBe(0);
    expect(flashAt(WALK.length)).toBe(1);
  });

  it('keeps the camera inside the corridor and off you', () => {
    for (const t of steps) {
      const { pos, look } = shotAt(t);
      expect(Math.abs(pos[0])).toBeLessThan(HALL.half - 0.2);
      expect(pos[1]).toBeLessThan(HALL.height - 0.3);
      expect(pos[2]).toBeLessThan(HALL.back - 0.3);
      expect(pos[2]).toBeGreaterThan(HALL.door + 0.5);
      const z = walkerZ(t);
      expect(Math.hypot(pos[0], pos[2] - z)).toBeGreaterThan(0.75);
      // it looks somewhere other than where it is
      expect(Math.hypot(look[0] - pos[0], look[1] - pos[1], look[2] - pos[2])).toBeGreaterThan(0.5);
    }
    // in front of you as you set off, behind you at the door
    expect(shotAt(0).pos[2]).toBeLessThan(walkerZ(0));
    expect(shotAt(WALK.length).pos[2]).toBeGreaterThan(walkerZ(WALK.length));
  });
});
