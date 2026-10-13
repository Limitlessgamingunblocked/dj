import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DJ_HEAD, easeShot, fovFor, guardScale, landmarkPose, SHOT_ANCHOR, SHOT_IDS, SHOTS, scalePose, venueScale } from '../src/three/shots';

const box = new THREE.Box3(new THREE.Vector3(-0.45, 0.92, -0.05), new THREE.Vector3(0.45, 1.02, 0.35));
const ctx = (scale = 3.4) => ({ box, scale, fov: 40 });
const finite = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('director moves', () => {
  it('every move gives a sane pose all the way through, either way round', () => {
    for (const id of SHOT_IDS)
      for (const side of [1, -1])
        for (const u of [0, 0.25, 0.5, 0.75, 1]) {
          const p = scalePose(SHOTS[id].pose(ctx(), u, side), 1);
          expect(finite(p.pos) && finite(p.target)).toBe(true);
          expect(p.pos.distanceTo(p.target)).toBeGreaterThan(0.3);
          expect(p.fov ?? 40).toBeGreaterThan(5);
          expect(p.fov ?? 40).toBeLessThan(90);
        }
  });

  it('frames the right things: hands close on the board, the shoulder shot behind the DJ looking out, aerials high up', () => {
    const c = box.getCenter(new THREE.Vector3());
    const hands = SHOTS.hands.pose(ctx(), 0.5, 1);
    expect(hands.pos.distanceTo(c)).toBeLessThan(1.2);
    expect(SHOTS.hands.close).toBe(true);
    const ots = SHOTS.ots.pose(ctx(), 0.5, 1);
    expect(ots.pos.z).toBeGreaterThan(DJ_HEAD.z);
    expect(ots.target.z).toBeLessThan(-5);
    const reverse = SHOTS.reverse.pose(ctx(), 0.5, 1);
    expect(reverse.pos.z).toBeLessThan(box.min.z);
    expect(reverse.target.z).toBeLessThan(-5);
    expect(SHOTS.aerial.pose(ctx(8), 0.5, 1).pos.y).toBeGreaterThan(12);
    // the low angle really is low: the camera below the DJ's eyes, looking up
    const hero = SHOTS.hero.pose(ctx(), 0.5, 1);
    expect(hero.pos.y).toBeLessThan(hero.target.y - 0.5);
  });

  it('push in closes in on the DJ and pull back opens out, sized by the venue', () => {
    const a = SHOTS.pushin.pose(ctx(), 0, 1).pos.distanceTo(DJ_HEAD);
    const b = SHOTS.pushin.pose(ctx(), 1, 1).pos.distanceTo(DJ_HEAD);
    expect(b).toBeLessThan(a - 1);
    const small = SHOTS.pullback.pose(ctx(3), 1, 1).pos.distanceTo(DJ_HEAD);
    const big = SHOTS.pullback.pose(ctx(8), 1, 1).pos.distanceTo(DJ_HEAD);
    expect(big).toBeGreaterThan(small * 2);
  });

  it('the long lens keeps the DJ the same size wherever it ends up', () => {
    const p = scalePose(SHOTS.tele.pose(ctx(8), 0, 1), 1);
    const d = p.pos.distanceTo(p.target);
    expect(p.fov).toBeCloseTo(fovFor(2.4, d), 5);
    const pulled = scalePose(SHOTS.tele.pose(ctx(8), 0, 1), 0.5);
    expect(pulled.fov!).toBeGreaterThan(p.fov!);
  });

  it('a wall in the way brings the camera in, one amount for the whole move', () => {
    const poses = [0, 0.5, 1].map((u) => SHOTS.pullback.pose(ctx(8), u, 1));
    // nothing in the way
    expect(guardScale(poses, () => Infinity)).toBe(1);
    // a wall 4 m out from the booth
    const k = guardScale(poses, (from, to) => Math.min(4, from.distanceTo(to) + 10));
    expect(k).toBeLessThan(1);
    for (const p of poses) {
      const q = scalePose({ pos: p.pos.clone(), target: p.target.clone() }, k);
      expect(q.pos.distanceTo(SHOT_ANCHOR)).toBeLessThanOrEqual(4);
    }
  });

  it('landmarks hold or move between their two poses; reach falls back to the crane', () => {
    const l = { label: 'x', from: { pos: new THREE.Vector3(0, 0, 0), target: new THREE.Vector3(0, 0, -10) }, to: { pos: new THREE.Vector3(10, 0, 0), target: new THREE.Vector3(0, 0, -10) }, fov: 30 };
    expect(landmarkPose(l, 0.5).pos.x).toBeCloseTo(5);
    expect(landmarkPose({ ...l, to: undefined }, 0.7).pos.x).toBe(0);
    expect(venueScale(null)).toBe(3.4);
    expect(venueScale({ extra: { crane: { radius: 8, low: 1, high: 2 } } } as never)).toBe(8);
    expect(venueScale({ director: { scale: 5 }, extra: { crane: { radius: 8, low: 1, high: 2 } } } as never)).toBe(5);
    expect(easeShot(-1)).toBe(0);
    expect(easeShot(2)).toBe(1);
    expect(easeShot(0.5)).toBeCloseTo(0.5);
  });
});
