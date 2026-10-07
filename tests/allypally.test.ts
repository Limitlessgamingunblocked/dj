import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HALL, vault } from '../src/three/venues/allypally';
import { scatter } from '../src/three/venues/farcrowd';
import { fieldStrings, type FieldSpec } from '../src/three/venues/lightfield';

describe('Alexandra Palace Great Hall', () => {
  it('uses the published size', () => {
    expect(HALL.length).toBeCloseTo(116.6);
    expect(HALL.width).toBeCloseTo(55.11);
    // 6,426 m² of floor
    expect(HALL.length * HALL.width).toBeCloseTo(6426, -1);
    expect(HALL.wallHeight).toBe(14);
    expect(HALL.crown).toBe(25);
  });

  it('springs the vault from the tops of the walls and peaks at the crown', () => {
    const hw = HALL.width / 2;
    const v = vault(hw, HALL.wallHeight, HALL.crown);
    // crown: straight up from the centre
    expect(v.centreY + v.radius).toBeCloseTo(HALL.crown, 6);
    // springing: the arc's end points sit on the wall tops
    expect(v.radius * Math.sin(v.halfAngle)).toBeCloseTo(hw, 6);
    expect(v.centreY + v.radius * Math.cos(v.halfAngle)).toBeCloseTo(HALL.wallHeight, 6);
    // a shallow segmental vault, well under a semicircle
    expect(v.halfAngle).toBeLessThan(Math.PI / 2);
  });
});

describe('far crowd scatter', () => {
  it('follows the density map', () => {
    const flat = scatter(0, 40, 0, 40, () => 1.5, 7);
    expect(flat.length).toBeGreaterThan(1600 * 1.5 * 0.95);
    expect(flat.length).toBeLessThan(1600 * 1.5 * 1.05);
    const ramp = scatter(0, 40, 0, 40, (_x, z) => (z < 20 ? 2 : 0.5), 7);
    const front = ramp.filter((p) => p.z < 20).length;
    const back = ramp.length - front;
    expect(front / back).toBeGreaterThan(3.4);
    expect(front / back).toBeLessThan(4.6);
  });

  it('keeps people inside the rectangle and out of the avoid boxes', () => {
    const avoid = [new THREE.Box2(new THREE.Vector2(10, 10), new THREE.Vector2(20, 20))];
    const pts = scatter(0, 30, 0, 30, () => 2, 3, avoid);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(30);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThanOrEqual(30);
      expect(p.x > 10 && p.x < 20 && p.z > 10 && p.z < 20).toBe(false);
    }
  });

  it('is the same crowd every visit', () => {
    expect(scatter(0, 10, 0, 10, () => 1, 42)).toEqual(scatter(0, 10, 0, 10, () => 1, 42));
  });
});

describe('light field', () => {
  const spec: FieldSpec = { x0: -25, x1: 25, z0: -50, z1: 50, spacing: 0.76, bulbs: 5, yLow: 3.5, yHigh: 9.9, origin: new THREE.Vector3(0, 6.5, 0), clear: 4 };

  it('hangs about 43,000 lights over the floor of the Great Hall', () => {
    const n = fieldStrings(spec, 42000).length * spec.bulbs;
    expect(n).toBeGreaterThan(42000);
    expect(n).toBeLessThan(44500);
  });

  it('keeps the strings clear of the booth', () => {
    for (const s of fieldStrings(spec, 42000)) expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(4);
  });
});
