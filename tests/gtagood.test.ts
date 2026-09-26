import { describe, expect, it } from 'vitest';
import { scoreShot, scoreTiming, procedureFor, timingMarker } from '../gta-good/src/core/aim';
import { createCity, curbSpot, insideBuilding, isOnRoad, LANE, N, P, SHOULDER } from '../gta-good/src/core/city';
import { newPatient, rideDamage, treat, updatePatient, vitalsOf, G_LIMIT } from '../gta-good/src/core/medical';
import { buyUpgrade, buyVehicle, earn, hasCerts, newProfile, parseProfile, sirenRange } from '../gta-good/src/core/progression';
import { edgeKey, findPath, polylineLength, route, type Node } from '../gta-good/src/core/route';
import { newVehicleState, stepVehicle, vehicleById } from '../gta-good/src/core/vehicle';
import { Traffic } from '../gta-good/src/world/Traffic';

describe('GTA Good city', () => {
  const city = createCity(7);

  it('is deterministic for a seed', () => {
    const again = createCity(7);
    expect(again.buildings.length).toBe(city.buildings.length);
    expect(again.buildings[10]).toEqual(city.buildings[10]);
  });

  it('puts hospital bays, the stadium and the training centre on open road', () => {
    for (const place of [...city.hospitals, city.stadium, city.training]) {
      expect(isOnRoad(place.bay.x, place.bay.z)).toBe(true);
      expect(insideBuilding(city, place.bay.x, place.bay.z, 2)).toBe(false);
    }
  });

  it('gives every curb spot a sidewalk point and a lane point next to it', () => {
    for (const col of city.blocks) {
      for (const b of col) {
        for (let side = 0; side < 4; side++) {
          const s = curbSpot(b, side, 0.5);
          expect(isOnRoad(s.road.x, s.road.z)).toBe(true);
          expect(isOnRoad(s.walk.x, s.walk.z)).toBe(false);
          expect(insideBuilding(city, s.walk.x, s.walk.z)).toBe(false);
        }
      }
    }
  });
});

describe('GTA Good routing', () => {
  it('finds a shortest grid path', () => {
    const path = findPath([0, 0], [3, 2])!;
    expect(path[0]).toEqual([0, 0]);
    expect(path.at(-1)).toEqual([3, 2]);
    expect(path.length).toBe(6);
  });

  it('detours around closed streets', () => {
    const closed = new Set([edgeKey([1, 0], [2, 0]), edgeKey([1, 1], [2, 1])]);
    const path = findPath([0, 0], [3, 0], closed)!;
    for (let k = 1; k < path.length; k++) expect(closed.has(edgeKey(path[k - 1], path[k]))).toBe(false);
    expect(path.length).toBeGreaterThan(4);
  });

  it('returns null when the goal is cut off', () => {
    const corner: Node = [0, 0];
    const closed = new Set([edgeKey(corner, [1, 0]), edgeKey(corner, [0, 1])]);
    expect(findPath([5, 5], corner, closed)).toBeNull();
  });

  it('builds a polyline from point to point along streets', () => {
    const from = { x: 150, z: P * 2 + LANE };
    const to = { x: P * 6 + LANE, z: 750 };
    const r = route(from, to);
    expect(r[0]).toEqual(from);
    expect(r.at(-1)).toEqual(to);
    expect(polylineLength(r)).toBeGreaterThanOrEqual(Math.abs(to.x - from.x) + Math.abs(to.z - from.z) - 1);
    expect(N).toBe(10);
  });
});

describe('GTA Good medicine', () => {
  it('deteriorates untreated patients and stops once treated well', () => {
    const p = newPatient('anaphylaxis', { stability: 70 });
    updatePatient(p, 10);
    expect(p.stability).toBeCloseTo(70 - 12.5, 5);
    const res = treat(p, 'epi', 1);
    expect(res.ok).toBe(true);
    expect(p.stability).toBeGreaterThan(90);
    const before = p.stability;
    updatePatient(p, 10);
    expect(before - p.stability).toBeLessThan(1);
  });

  it('penalises the wrong tool and explains why', () => {
    const p = newPatient('asthma', { stability: 60 });
    const res = treat(p, 'epi', 1);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/asthma/i);
    expect(p.stability).toBe(52);
    expect(p.treated).toBe(false);
  });

  it('leaves training dummies alone', () => {
    const p = newPatient('cardiac', { training: true, stability: 50 });
    updatePatient(p, 60);
    treat(p, 'oxygen', 1);
    expect(p.stability).toBe(50);
  });

  it('hurts patients only above the g-force limit, and on impacts', () => {
    expect(rideDamage({ gLat: G_LIMIT * 0.9, gLong: 0, jolt: 0, comfort: 1 }, 1)).toBe(0);
    expect(rideDamage({ gLat: 1, gLong: 0, jolt: 0, comfort: 1 }, 1)).toBeGreaterThan(5);
    expect(rideDamage({ gLat: 0, gLong: 0, jolt: 10, comfort: 1 }, 1 / 60)).toBeGreaterThan(10);
    expect(rideDamage({ gLat: 1, gLong: 0, jolt: 0, comfort: 0.5 }, 1)).toBeCloseTo(rideDamage({ gLat: 1, gLong: 0, jolt: 0, comfort: 1 }, 1) / 2);
  });

  it('marks a patient lost at zero and shows cardiac arrest as VF', () => {
    const p = newPatient('cardiac', { stability: 5 });
    expect(vitalsOf(p).rhythm).toBe('vf');
    updatePatient(p, 10);
    expect(p.lost).toBe(true);
    expect(vitalsOf(p).rhythm).toBe('flat');
  });
});

describe('GTA Good targeting', () => {
  it('scores placement by distance from the zone centre', () => {
    const z = procedureFor('epi', false).zones[0];
    expect(scoreShot(z.x, z.y, z).grade).toBe('Perfect');
    expect(scoreShot(z.x + z.r * 0.9, z.y, z).hit).toBe(true);
    expect(scoreShot(z.x + z.r * 2, z.y, z).hit).toBe(false);
  });

  it('needs two pads and a timed shock for the AED', () => {
    const p = procedureFor('aed', false);
    expect(p.zones).toHaveLength(2);
    const t = p.timing!;
    expect(scoreTiming((t.from + t.to) / 2, t).grade).toBe('Perfect');
    expect(scoreTiming(t.from - 0.05, t).hit).toBe(false);
    expect(timingMarker(0, 1)).toBe(0);
    expect(timingMarker(1.5, 1)).toBeCloseTo(0.5);
  });
});

describe('GTA Good progression', () => {
  it('buys vehicles and upgrades only with enough merit', () => {
    const p = newProfile();
    expect(buyVehicle(p, 'suv')).toBe(false);
    earn(p, 700);
    expect(buyVehicle(p, 'suv')).toBe(true);
    expect(p.merit).toBe(100);
    expect(p.totalMerit).toBe(700);
    const r0 = sirenRange(p);
    earn(p, 300);
    expect(buyUpgrade(p, 'siren')).toBe(true);
    expect(sirenRange(p)).toBeGreaterThan(r0);
  });

  it('sanitises saved data', () => {
    const p = parseProfile({ merit: -5, certs: ['evoc', 'hacker'], vehicles: ['interceptor', 'tank'], vehicle: 'tank', upgrades: { steady: 99 } });
    expect(p.merit).toBe(0);
    expect(p.certs).toEqual(['evoc']);
    expect(p.vehicles).toEqual(['van', 'interceptor']);
    expect(p.vehicle).toBe('van');
    expect(p.upgrades.steady).toBe(3);
    expect(hasCerts(p, ['evoc'])).toBe(true);
    expect(hasCerts(p, ['evoc', 'als'])).toBe(false);
    expect(parseProfile('nonsense')).toEqual(newProfile());
  });
});

describe('GTA Good driving model', () => {
  const spec = vehicleById('van');
  const run = (seconds: number, input: Parameters<typeof stepVehicle>[2], s = newVehicleState(0, 0, 0)) => {
    for (let k = 0; k < seconds * 60; k++) stepVehicle(s, spec, input, 1 / 60);
    return s;
  };

  it('accelerates towards top speed and brakes to a stop', () => {
    const s = run(20, { throttle: 1, brake: 0, steer: 0, handbrake: false });
    expect(s.speed).toBeGreaterThan(spec.maxSpeed * 0.85);
    expect(s.speed).toBeLessThanOrEqual(spec.maxSpeed);
    let steps = 0;
    while (s.speed > 0.4 && steps < 600) {
      stepVehicle(s, spec, { throttle: 0, brake: 1, steer: 0, handbrake: false }, 1 / 60);
      steps++;
    }
    expect(steps / 60).toBeLessThan(2.5);
    // Keep holding brake and it backs up.
    run(1, { throttle: 0, brake: 1, steer: 0, handbrake: false }, s);
    expect(s.speed).toBeLessThan(-1);
  });

  it('keeps cornering force within tyre grip', () => {
    const s = run(6, { throttle: 1, brake: 0, steer: 0, handbrake: false });
    let peak = 0;
    for (let k = 0; k < 120; k++) {
      stepVehicle(s, spec, { throttle: 1, brake: 0, steer: 1, handbrake: false }, 1 / 60);
      peak = Math.max(peak, Math.abs(s.gLat));
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1.3);
  });
});

describe('GTA Good traffic', () => {
  it('pulls over and stops for a siren nearby, then moves again', () => {
    const t = new Traffic();
    t.baseCount = 60;
    for (let k = 0; k < 60; k++) t.spawnRandom();
    const player = { x: 500, z: 500 };
    const env = (siren: boolean, time: number) => ({ time, player, sirenOn: siren, sirenRange: 70, obstacles: [], closed: new Set<string>() });
    for (let k = 0; k < 600; k++) t.update(1 / 60, env(true, k / 60));
    const near = t.cars.filter((c) => !c.turning && Math.hypot(c.x - player.x, c.z - player.z) < 40);
    expect(near.length).toBeGreaterThan(0);
    for (const c of near) expect(c.speed).toBeLessThan(0.5);
    expect(near.some((c) => c.offset > (LANE + SHOULDER) / 2)).toBe(true);
    const moved = t.cars.map((c) => ({ c, x: c.x, z: c.z }));
    for (let k = 0; k < 600; k++) t.update(1 / 60, env(false, 10 + k / 60));
    expect(moved.filter(({ c, x, z }) => Math.hypot(c.x - x, c.z - z) > 5).length).toBeGreaterThan(moved.length / 2);
  });

  it('drives a convoy along its route to the goal on empty streets', () => {
    const t = new Traffic();
    t.baseCount = 0;
    const van = t.spawnConvoy([[1, 5], [2, 5], [2, 4], [3, 4]], P / 2);
    const env = { time: 0, player: { x: 0, z: 0 }, sirenOn: false, sirenRange: 0, obstacles: [], closed: new Set<string>() };
    for (let k = 0; k < 60 * 60 && !van.arrived; k++) t.update(1 / 60, env);
    expect(van.arrived).toBe(true);
    expect(van.x).toBeCloseTo(2 * P + P / 2, 0);
    expect(van.z).toBeCloseTo(4 * P + LANE, 0);
  });
});
