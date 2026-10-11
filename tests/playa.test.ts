import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { roomFor } from '../src/audio/room';
import { VENUE_NAME_STYLES } from '../src/name/venueStyles';
import { venueById, VENUES } from '../src/three/venues';
import { MAN, PLAYA_SKY } from '../src/three/venues/burningman';
import { Dresser } from '../src/three/venues/dress';
import { sampleSky } from '../src/three/venues/outdoor';
import { bearingOf, BRC, burnState, CityLights, clockDir, clockOf, clockPos, Fireballs, fireworkSchedule, lanternSpires, poofPlan, ridgeElevation, TheMan } from '../src/three/venues/playa';
import type { ShowState } from '../src/three/venues/show';

// the glow sprites draw on a canvas: a do-nothing one is enough here
const ctx = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx }) };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const show = (o: Partial<ShowState> = {}): ShowState => ({ master: 1, kick: 0, level: 0, beat: 0, beatInBar: 0, bar: 0, peak: 0, dropHit: false, playing: true, reduceFlash: false, colors: [new THREE.Color(1, 0, 0), new THREE.Color(0, 1, 0), new THREE.Color(0, 0, 1)], ...o }) as unknown as ShowState;

describe('Black Rock City’s plan', () => {
  it('uses the city plan’s numbers', () => {
    expect(BRC.esplanade).toBeCloseTo(762, 0);
    expect(BRC.outer * 2).toBeCloseTo(11690 * 0.3048, 0);
    expect(BRC.centerCamp).toBeCloseTo(922.3, 0);
    expect(BRC.perimeter).toBeCloseTo(304.8, 1);
    expect(BRC.lanterns).toBeCloseTo(45.72, 2);
  });

  it('reads the clock round the Man: 12:00 out to the Temple, 3:00 on your right, 6:00 back to the city', () => {
    const man = V(10, 0, 20);
    expect(clockDir(12).z).toBeCloseTo(1, 6);
    expect(clockDir(3).x).toBeCloseTo(-1, 6);
    expect(clockDir(6).z).toBeCloseTo(-1, 6);
    for (const h of [0.5, 2, 4.5, 6, 7.5, 10, 11.75]) {
      const p = clockPos(man, h, 500);
      expect(p.distanceTo(man)).toBeCloseTo(500, 3);
      expect(clockOf(man, p)).toBeCloseTo(h % 12, 4);
    }
  });

  it('points 12:00 north-east, with true north and south along the 4:30 axis', () => {
    expect(bearingOf(clockDir(12))).toBeCloseTo(45, 4);
    expect(bearingOf(clockDir(4.5))).toBeCloseTo(180, 4);
    expect(bearingOf(clockDir(10.5)) % 360).toBeCloseTo(0, 4);
  });

  it('rings the playa with hills, the Granite Range highest, out to the west', () => {
    let top = 0;
    let topAt = 0;
    for (let b = 0; b < 360; b += 1) {
      const e = ridgeElevation(b);
      expect(e).toBeGreaterThan(0.1);
      expect(e).toBeLessThan(7);
      if (e > top) [top, topAt] = [e, b];
    }
    expect(topAt).toBeGreaterThan(240);
    expect(topAt).toBeLessThan(300);
    // the playa runs flat away to the north-east, out behind the Temple at 12:00
    expect(ridgeElevation(bearingOf(clockDir(12)))).toBeLessThan(0.9);
  });

  it('parks you on the burn perimeter, at about 5:30', () => {
    const us = V(0, MAN.y, 0);
    expect(us.distanceTo(MAN)).toBeCloseTo(BRC.perimeter, -1);
    expect(clockOf(MAN, us)).toBeGreaterThan(5.2);
    expect(clockOf(MAN, us)).toBeLessThan(5.8);
  });
});

describe('the city and the promenades', () => {
  it('lights the city only from 2:00 to 10:00, out past the Esplanade', () => {
    const d = new Dresser(1);
    const man = V(0, 0, 0);
    const city = new CityLights(man, { count: 500, maxDist: 1500, seed: 3, night: () => 1, d });
    const pts = city.object.children.find((o) => (o as THREE.Points).isPoints) as THREE.Points;
    const p = pts.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const h = clockOf(man, v);
      expect(h).toBeGreaterThan(1.9);
      expect(h).toBeLessThan(10.1);
      expect(Math.hypot(v.x, v.z)).toBeGreaterThan(BRC.esplanade - 10);
    }
  });

  it('stands a lantern spire every 150 ft down a promenade', () => {
    const d = new Dresser(2);
    const n = lanternSpires(d, V(0, 0, 0), V(0, 0, -BRC.esplanade));
    expect(n).toBe(Math.floor((BRC.esplanade - 1e-6) / BRC.lanterns));
  });
});

describe('the burn', () => {
  it('runs arms up, fireworks, fire, the fall, then a glow that lasts', () => {
    expect(burnState(-1).arms).toBe(0);
    expect(burnState(6).arms).toBeCloseTo(1, 6);
    expect(burnState(4).fireworks).toBe(false);
    expect(burnState(10).fireworks).toBe(true);
    expect(burnState(30).fireworks).toBe(false);
    expect(burnState(10).base).toBe(0);
    expect(burnState(40).base).toBeGreaterThan(0.9);
    expect(burnState(50).body).toBeGreaterThan(0.9);
    expect(burnState(60).fall).toBe(0);
    expect(burnState(80).fall).toBe(1);
    // long after, the base still glows but he's gone
    const late = burnState(600);
    expect(late.body).toBe(0);
    expect(late.base).toBeGreaterThan(0.2);
    expect(late.glow).toBe(1);
  });

  it('schedules the fireworks inside the show, never more bursts a second than allowed', () => {
    for (const per of [3, 1.8]) {
      const t = fireworkSchedule(36, 18, per, 23);
      expect(t.length).toBe(36);
      for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(1 / per - 1e-9);
      expect(t[t.length - 1]).toBeLessThanOrEqual(Math.max(18, (36 - 1) / per) + 1e-6);
    }
  });

  it('raises the Man’s arms at the shoulders and tips him away from the crowd when he falls', () => {
    const man = new TheMan(V(0, 0, 0));
    expect(man.firePoints.length).toBeGreaterThan(4);
    man.setArms(1);
    const arms = man.figure.children.filter((c) => c instanceof THREE.Group) as THREE.Group[];
    expect(arms.length).toBe(2);
    expect(Math.abs(arms[0].rotation.z)).toBeGreaterThan(2);
    expect(Math.sign(arms[0].rotation.z)).toBe(-Math.sign(arms[1].rotation.z));
    man.setFall(1);
    // tipped over towards +Z: away from the crowd, who are towards −Z of the Man
    const head = new THREE.Vector3(0, man.height, 0).applyEuler(man.figure.rotation);
    expect(head.z).toBeGreaterThan(man.height * 0.9);
  });
});

describe('poofers', () => {
  it('all fire on the drop, half at a time through the peak, none in the groove', () => {
    expect(poofPlan(show({ dropHit: true }), 0, -100, 4)).toEqual([0, 1, 2, 3]);
    expect(poofPlan(show({ peak: 0.2 }), 8, -100, 4)).toEqual([]);
    const peak = poofPlan(show({ peak: 0.9, beatInBar: 0 }), 8, -100, 4);
    expect(peak.length).toBe(2);
    expect(poofPlan(show({ peak: 0.9, beatInBar: 1 }), 9, -100, 4)).toEqual([]);
    expect(poofPlan(show({ playing: false, dropHit: true }), 0, -100, 4)).toEqual([]);
  });

  it('fires at most once a bar with reduce flashing, twice a bar otherwise', () => {
    for (const reduceFlash of [false, true]) {
      let last = -100;
      let bursts = 0;
      for (let beat = 0; beat < 64; beat++) {
        const plan = poofPlan(show({ peak: 0.9, beatInBar: beat % 4, reduceFlash }), beat, last, 6);
        if (plan.length) {
          bursts++;
          last = beat;
        }
      }
      expect(bursts).toBe(reduceFlash ? 16 : 32);
    }
  });

  it('lights a fireball for about a second and a half after a burst', () => {
    const f = new Fireballs([V(0, 4, 0), V(2, 4, 0)]);
    f.update(show({ playing: false }), 0.016);
    f.fire([0, 1]);
    f.update(show({ playing: false }), 0.2);
    const age = (f.object.children[0] as THREE.InstancedMesh).geometry.attributes.iAge.array as Float32Array;
    expect(age[0]).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) f.update(show({ playing: false }), 0.02);
    expect(age[0]).toBe(0);
  });
});

describe('the venue', () => {
  it('is in the catalogue, with its name style, flyer and a dry desert sound', () => {
    expect(venueById('burningman').id).toBe('burningman');
    expect(VENUES.filter((v) => v.id === 'burningman').length).toBe(1);
    expect(VENUE_NAME_STYLES.burningman).toBeTruthy();
    expect(roomFor('burningman').wet).toBeLessThan(roomFor('festival').wet);
    expect(venueById('burningman').note).toMatch(/not affiliated/i);
  });

  it('runs from the dark to sunrise', () => {
    expect(sampleSky(PLAYA_SKY, 0).night).toBe(1);
    expect(sampleSky(PLAYA_SKY, 0).stars).toBe(1);
    expect(sampleSky(PLAYA_SKY, 1).sun).toBeGreaterThan(0);
    let last = 2;
    for (let k = 0; k <= 1; k += 0.05) {
      const n = sampleSky(PLAYA_SKY, k).night;
      expect(n).toBeLessThanOrEqual(last + 1e-9);
      last = n;
    }
  });
});
