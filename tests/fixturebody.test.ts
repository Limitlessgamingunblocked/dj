import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blinder, LENS_Y, movingHead, strobeBar } from '../src/three/venues/fixturebody';

const tris = (g: THREE.BufferGeometry) => g.attributes.position.count / 3;
const box = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe('fixture bodies', () => {
  it('keeps a moving head under its triangle budget', () => {
    const h = movingHead();
    expect(tris(h.head) + tris(h.yoke) + tris(h.base) + tris(h.ring)).toBeLessThan(1800);
    // shared: every rig instances the same geometry
    expect(movingHead().head).toBe(h.head);
  });

  it('stacks base over yoke over head, so the head can tilt clear of the crossbar', () => {
    const h = movingHead();
    const head = box(h.head);
    const yoke = box(h.yoke);
    const base = box(h.base);
    // the head's highest point stays below the yoke's crossbar
    expect(head.max.y).toBeLessThan(0.16);
    expect(yoke.max.y).toBeLessThanOrEqual(base.min.y + 1e-3);
    // the arms reach down to the tilt pivot at the origin
    expect(yoke.min.y).toBeLessThan(0);
    // the head fits between the arms
    expect(head.max.x).toBeLessThan(yoke.max.x);
  });

  it('puts the pixel ring round the lens, facing down the beam', () => {
    const ring = movingHead().ring;
    const pos = ring.attributes.position;
    const nrm = ring.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(LENS_Y - 0.004, 5);
      expect(nrm.getY(i)).toBeCloseTo(-1, 5);
      expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeGreaterThan(0.099);
    }
    // a comet of brightness round the ring
    const col = ring.attributes.color;
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < col.count; i++) {
      lo = Math.min(lo, col.getX(i));
      hi = Math.max(hi, col.getX(i));
    }
    expect(hi).toBeCloseTo(1, 3);
    expect(lo).toBeLessThan(0.2);
  });

  it('builds strobe bars to size with the tube inside the end caps', () => {
    const a = strobeBar([0.6, 0.16, 0.1]);
    expect(strobeBar([0.6, 0.16, 0.1])).toBe(a);
    expect(strobeBar([1, 0.1, 0.1])).not.toBe(a);
    const frame = box(a.frame);
    const tube = box(a.tube);
    expect(frame.max.x - frame.min.x).toBeGreaterThanOrEqual(0.6);
    expect(tube.max.x).toBeLessThan(0.3);
    expect(tube.max.y).toBeLessThan(0.08);
  });

  it('stands a blinder lamp proud of the housing, facing the room (−Z)', () => {
    const b = blinder();
    const lamp = box(b.lamp);
    const body = box(b.body);
    expect(lamp.min.z).toBeLessThan(-0.05);
    expect(lamp.min.z).toBeGreaterThan(body.min.z - 0.01);
    expect(tris(b.body) + 2 * tris(b.lamp)).toBeLessThan(1000);
  });
});
