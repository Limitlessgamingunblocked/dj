import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Dresser } from '../src/three/venues/dress';
import { Aircraft, Birds, burner, FerrisWheel, headland, Lighthouse, thinFog, wheelBulb } from '../src/three/venues/landmarks';
import type { ShowState } from '../src/three/venues/show';

// the landmarks' glow sprites draw on a canvas: a do-nothing one is enough here
const ctx = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx }) };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const show = (o: Partial<ShowState> = {}): ShowState => ({ master: 1, kick: 0, reduceFlash: false, colors: [new THREE.Color(1, 0, 0), new THREE.Color(0, 1, 0), new THREE.Color(0, 0, 1)], ...o }) as unknown as ShowState;

/** how many times a 0..1 signal rises through `at` over the samples */
const rises = (xs: number[], at: number) => xs.filter((x, i) => i > 0 && xs[i - 1] < at && x >= at).length;

describe('the big wheel', () => {
  it('keeps every bulb lit between off and full, in one of the fairground colours', () => {
    for (let pattern = 0; pattern < 3; pattern++)
      for (let i = 0; i < 400; i++) {
        const b = wheelBulb(pattern, (i * 0.37) % (Math.PI * 2), (i % 9) / 8, i * 0.13, 1.2);
        expect(b.lit).toBeGreaterThanOrEqual(0);
        expect(b.lit).toBeLessThanOrEqual(1);
        expect(b.hue).toBeGreaterThanOrEqual(0);
        expect(b.hue).toBeLessThan(6);
      }
  });

  it('pulses a bulb no faster than it is allowed, slower still with reduce flashing', () => {
    for (let pattern = 0; pattern < 3; pattern++)
      for (const hz of [1.2, 0.35]) {
        const xs: number[] = [];
        for (let t = 0; t < 20; t += 1 / 120) xs.push(wheelBulb(pattern, 1.1, 0.5, t, hz).lit);
        const lo = Math.min(...xs);
        const hi = Math.max(...xs);
        if (hi - lo < 1e-6) continue;
        expect(rises(xs, (lo + hi) / 2), `pattern ${pattern} at ${hz} Hz`).toBeLessThanOrEqual(Math.ceil(hz * 20) + 1);
      }
  });

  it('turns, with the cars hanging level on the rim, and puts its legs in the venue set', () => {
    const d = new Dresser(5);
    const wheel = new FerrisWheel(V(-100, 0, -150), 0.8, { radius: 18, night: () => 1, d });
    d.done();
    expect(d.object.children.length).toBeGreaterThan(0);
    const s = show();
    for (let i = 0; i < 30; i++) wheel.update(s, 1 / 30);
    const cars = wheel.object.children.find((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh)!;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const hub = 18 + 4.2;
    for (let i = 0; i < cars.count; i++) {
      cars.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      expect(Math.hypot(p.x, p.y - hub)).toBeCloseTo(18, 4);
      // a car at the bottom clears the platform (0.9 m), and none tilt more than a few degrees
      expect(p.y - 2.75).toBeGreaterThan(0.9);
      expect(new THREE.Euler().setFromQuaternion(q).z).toBeLessThan(0.06);
    }
    // the bulbs' colours stay finite and lit after dark
    const bulbs = wheel.object.children[0].children.find((o) => (o as THREE.Mesh).geometry?.attributes.color) as THREE.Mesh;
    const col = bulbs.geometry.attributes.color.array as Float32Array;
    expect(col.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    expect(Math.max(...col)).toBeGreaterThan(0.5);
  });
});

describe('balloons, birds, aircraft', () => {
  it('fires a burner in soft bursts: off most of the time, never a jump', () => {
    for (const slow of [false, true]) {
      const xs: number[] = [];
      for (let t = 0; t < 120; t += 1 / 60) xs.push(burner(t, 8, slow));
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeCloseTo(1, 2);
      expect(xs.filter((x) => x > 0.5).length / xs.length).toBeLessThan(0.4);
      const step = Math.max(...xs.slice(1).map((x, i) => Math.abs(x - xs[i])));
      expect(step).toBeLessThan(slow ? 0.04 : 0.12);
      // a burst every few seconds at most
      expect(rises(xs, 0.5)).toBeLessThanOrEqual(120 / 9 + 1);
    }
  });

  it('keeps the flock out of sight until it is light, and finite once it flies', () => {
    let light = 0;
    const birds = new Birds({ count: 12, center: V(0, 20, 60), radius: V(40, 4, 20), speed: 8, size: 1, color: '#111', seed: 3, visible: () => light });
    birds.update(show(), 0.016);
    expect(birds.object.visible).toBe(false);
    light = 1;
    for (let i = 0; i < 50; i++) birds.update(show(), 0.016);
    expect(birds.object.visible).toBe(true);
    const pos = birds.object.geometry.attributes.position.array as Float32Array;
    expect(pos.length).toBe(12 * 12 * 3);
    expect(pos.every(Number.isFinite)).toBe(true);
    // every bird is near the flock's loop
    for (let i = 0; i < pos.length; i += 3) expect(Math.abs(pos[i + 1] - 20)).toBeLessThan(12);
  });

  it('flies an airliner from one end of its path to the other, its strobe well under the flash limit', () => {
    const from = V(-500, 300, 0);
    const to = V(500, 300, 0);
    for (const reduceFlash of [false, true]) {
      const plane = new Aircraft({ from, to, period: 100, night: () => 1 });
      const body = plane.object.children[0];
      const xs: number[] = [];
      const lights = (body.children[0] as THREE.Points).geometry.attributes.color as THREE.BufferAttribute;
      for (let t = 0; t < 20; t += 1 / 60) {
        plane.update(show({ reduceFlash }), 1 / 60);
        xs.push(lights.getX(1) > 3 ? 1 : 0);
      }
      expect(body.position.x).toBeCloseTo(-500 + 1000 * 0.2, 0);
      expect(rises(xs, 0.5) / 20).toBeLessThan(reduceFlash ? 0.5 : 0.8);
    }
  });
});

describe('the coast', () => {
  it('runs a headland down into the sea at both ends', () => {
    const path = [new THREE.Vector2(0, 0), new THREE.Vector2(0, 100), new THREE.Vector2(20, 200)];
    const mesh = headland(path, 40, () => 20, { y0: -1, seed: 1, color: '#333' });
    const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
    let top = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      if (z < 0.5 || z > 199.5) expect(p.getY(i)).toBeLessThanOrEqual(-1 + 1e-6);
      top = Math.max(top, p.getY(i));
    }
    expect(top).toBeGreaterThan(15);
  });

  it('sweeps the lighthouse beams after dark, the lantern blazing as one swings past you', () => {
    let night = 0;
    const d = new Dresser(2);
    const lh = new Lighthouse(V(0, 10, 0), { height: 26, night: () => night, d, period: 12 });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(300, 20, 0);
    const beams = lh.object.children.find((o) => o instanceof THREE.Group)!;
    const beamMat = (beams.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const glare = lh.object.children.find((o): o is THREE.Sprite => (o as THREE.Sprite).isSprite)!;
    lh.update(show(), 0.016, camera);
    expect(beamMat.opacity).toBe(0);
    night = 1;
    const sizes: number[] = [];
    for (let t = 0; t < 12; t += 1 / 30) {
      lh.update(show(), 1 / 30, camera);
      sizes.push(glare.scale.x);
    }
    expect(beamMat.opacity).toBeGreaterThan(0.2);
    // two beams, so two blazes a turn
    const mid = (Math.min(...sizes) + Math.max(...sizes)) / 2;
    expect(rises(sizes, mid)).toBe(2);
    expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes) * 4);
  });

  it('thins the haze on a material by scaling its fog', () => {
    const m = thinFog(new THREE.MeshStandardMaterial(), 0.45);
    const sh = { fragmentShader: 'void main() {\n#include <fog_fragment>\n}' } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    expect(sh.fragmentShader).toContain('fogFactor * 0.450');
    expect(sh.fragmentShader).not.toContain('#include <fog_fragment>');
    expect(m.customProgramCacheKey()).toContain('0.45');
  });
});
