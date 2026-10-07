import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HALL, vault } from '../src/three/venues/allypally';
import { autoLook, LASER_PATTERNS, type LookInput } from '../src/three/venues/laserlooks';
import { clampAboveAudience, hitDistance, type AudienceZone, type RoomProxy } from '../src/three/venues/lasers';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const hw = HALL.width / 2;
const vt = vault(hw, HALL.wallHeight, HALL.crown);
// the Great Hall with its floor at y = 0, stage wall at z = 10
const hall: RoomProxy = { floorY: 0, x0: -hw, x1: hw, z0: 10 - HALL.length, z1: 10, vault: { centreY: vt.centreY, radius: vt.radius } };

describe('beams against the hall', () => {
  it('stops at the crown of the vault going straight up', () => {
    expect(hitDistance(V(0, 2, 0), V(0, 1, 0), hall)).toBeCloseTo(HALL.crown - 2, 5);
  });

  it('stops on the far end wall going down the hall', () => {
    expect(hitDistance(V(0, 5, 0), V(0, 0, -1), hall)).toBeCloseTo(HALL.length - 10, 5);
  });

  it('stops on a side wall below the springing, and on the vault above it', () => {
    expect(hitDistance(V(0, 5, -20), V(1, 0, 0), hall)).toBeCloseTo(hw, 5);
    // aimed up and sideways: the hit point lies on the vault, inside the walls and above the springing
    const d = V(1, 1, 0).normalize();
    const t = hitDistance(V(0, 5, -20), d, hall);
    const p = V(0, 5, -20).addScaledVector(d, t);
    expect(Math.hypot(p.x, p.y - vt.centreY)).toBeCloseTo(vt.radius, 4);
    expect(p.x).toBeLessThan(hw);
    expect(p.y).toBeGreaterThan(HALL.wallHeight);
  });

  it('stops on the floor going down', () => {
    expect(hitDistance(V(0, 8, 0), V(0, -1, 0), hall)).toBeCloseTo(8, 5);
  });

  it('stops on a solid in the way, not the wall behind it', () => {
    const wall = new THREE.Box3(V(-10, 0, -30.5), V(10, 8, -30));
    const t = hitDistance(V(0, 4, 0), V(0, 0, -1), { ...hall, solids: [wall] });
    expect(t).toBeCloseTo(30, 5);
    // a beam passing over the solid carries on to the end wall
    expect(hitDistance(V(0, 9, 0), V(0, 0, -1), { ...hall, solids: [wall] })).toBeCloseTo(HALL.length - 10, 5);
  });
});

describe('keeping beams above the crowd', () => {
  const zone: AudienceZone = { floorY: 0, x0: -20, x1: 20, z0: -80, z1: -5 };
  const heightAt = (o: THREE.Vector3, d: THREE.Vector3, z: number) => o.y + (d.y / -d.z) * (o.z - z);

  it('lifts a flat beam from the stage lip so it is 3 m up when it reaches the front row', () => {
    const o = V(0, 1.5, -2);
    const d = V(0, 0, -1);
    expect(clampAboveAudience(o, d, zone)).toBe(true);
    expect(d.length()).toBeCloseTo(1, 6);
    expect(heightAt(o, d, -5)).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(heightAt(o, d, -80)).toBeGreaterThan(3);
  });

  it('leaves a beam that is already high enough alone', () => {
    const d = V(0, 0.02, -1).normalize();
    const before = d.clone();
    expect(clampAboveAudience(V(0, 4, -2), d, zone)).toBe(false);
    expect(d.equals(before)).toBe(true);
  });

  it('stops a beam from a truss being aimed down into the crowd', () => {
    const o = V(0, 10, -30);
    const d = V(0, -0.5, -1).normalize();
    expect(clampAboveAudience(o, d, zone)).toBe(true);
    // the far edge of the audience along its path is still at least 3 m up
    expect(heightAt(o, d, -80)).toBeGreaterThanOrEqual(3 - 1e-6);
  });

  it('sends a beam from the middle of the crowd steeply up', () => {
    const o = V(0, 1.5, -40);
    const d = V(1, 0, 0);
    clampAboveAudience(o, d, zone);
    expect(d.y).toBeGreaterThan(0.8);
  });

  it('ignores beams that never cross the audience', () => {
    const d = V(0, -0.2, 1).normalize();
    expect(clampAboveAudience(V(0, 1, -2), d, zone)).toBe(false);
  });
});

describe('automatic laser looks', () => {
  const base: LookInput = { build: 0, peak: 0, bar: 0, energy: 0.7, peakBars: 0, accent: 0 };

  it('bursts on the drop and on a hook line landing', () => {
    expect(autoLook({ ...base, peakBars: 16, peak: 1 })).toBe('burst');
    expect(autoLook({ ...base, accent: 0.9 })).toBe('burst');
  });

  it('follows the build: liquid sky, then a tunnel, then everything closing in', () => {
    expect(autoLook({ ...base, build: 0.4 })).toBe('liquid');
    expect(autoLook({ ...base, build: 0.7 })).toBe('tunnel');
    expect(autoLook({ ...base, build: 0.95 })).toBe('converge');
  });

  it('changes every 4 bars through the peak and every 8 bars otherwise', () => {
    const peak = (bar: number) => autoLook({ ...base, peak: 1, peakBars: 8, bar });
    for (let b = 0; b < 32; b++) expect(peak(b)).toBe(peak(b - (b % 4)));
    expect(new Set(Array.from({ length: 8 }, (_, k) => peak(k * 4))).size).toBeGreaterThan(5);
    const cruise = (bar: number) => autoLook({ ...base, bar });
    for (let b = 0; b < 64; b++) expect(cruise(b)).toBe(cruise(b - (b % 8)));
  });

  it('stays slow and sparse in quiet stretches', () => {
    for (let b = 0; b < 32; b++) expect(['stars', 'rotate']).toContain(autoLook({ ...base, energy: 0.3, bar: b }));
  });

  it('only ever picks looks the desk knows', () => {
    for (let b = -8; b < 64; b++)
      for (const st of [base, { ...base, peak: 1, peakBars: 4 }, { ...base, energy: 0.2 }]) expect(LASER_PATTERNS).toContain(autoLook({ ...st, bar: b }));
  });
});
