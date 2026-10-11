import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HoloScrim, KineticRig, kineticHeight, kineticShapeFor, projectOnto, sectionMix, WINCH_SPEED, Wristbands, type KineticShape } from '../src/three/venues/showfx';
import type { ShowState } from '../src/three/venues/show';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const show = (o: Partial<ShowState> = {}): ShowState =>
  ({ t: 0, master: 1, intensity: 1, kick: 0, level: 0, energy: 0.5, hype: 0.5, beat: 0, beatInBar: 0, bar: 0, build: 0, peak: 0, dropHit: false, playing: true, reduceFlash: false, colors: [new THREE.Color(1, 0, 0), new THREE.Color(0, 1, 0), new THREE.Color(0, 0, 1)], ...o }) as unknown as ShowState;

describe('the parts of a track the effects follow', () => {
  it('always adds up to the whole show', () => {
    for (const build of [0, 0.3, 0.7, 1]) {
      for (const peak of [0, 0.5, 1]) {
        const m = sectionMix({ playing: true, build, peak });
        expect(m.groove + m.calm + m.rush + m.peak).toBeCloseTo(1, 5);
      }
    }
    expect(sectionMix({ playing: true, build: 0.95, peak: 0 }).rush).toBeGreaterThan(0.9);
    expect(sectionMix({ playing: true, build: 0.35, peak: 0 }).calm).toBeGreaterThan(0.4);
    expect(sectionMix({ playing: true, build: 0, peak: 1 }).peak).toBe(1);
  });
});

describe('kinetic lights', () => {
  const shapes: KineticShape[] = ['wave', 'ripple', 'tilt', 'dome', 'high', 'descend', 'v'];

  it('keeps every element between the lowest and highest point, in every formation', () => {
    for (const s of shapes) for (let u = -1; u <= 1; u += 0.25) for (let v = -1; v <= 1; v += 0.25) for (const t of [0, 3, 17]) {
      const y = kineticHeight(s, u, v, t, 0.8);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it('flies the formation the music asks for', () => {
    const at = (o: Partial<ShowState>, since = 99, drops = 0, phrase = 0) => kineticShapeFor({ playing: true, build: 0, peak: 0, ...o }, phrase, since, drops);
    expect(at({}, 2, 0)).toBe('v');
    expect(at({}, 2, 1)).toBe('dome');
    expect(at({ peak: 0.8 })).toBe('ripple');
    expect(at({ build: 0.8 })).toBe('descend');
    expect(at({ build: 0.4 })).toBe('high');
    expect(new Set([0, 1, 2, 3].map((p) => at({}, 99, 0, p))).size).toBe(4);
    expect(kineticShapeFor({ playing: false, build: 0, peak: 0 }, 0, 99, 0)).toBe('high');
    // a build brings them down
    expect(kineticHeight('descend', 0, 0, 0, 1)).toBeLessThan(kineticHeight('descend', 0, 0, 0, 0));
  });

  it('moves no faster than a real winch', () => {
    const rig = new KineticRig({ x0: -5, x1: 5, z0: -10, z1: -2, nx: 4, nz: 3, top: 10, low: 3, high: 9 });
    const balls = rig.object.children[1] as THREE.InstancedMesh;
    const y0 = new THREE.Matrix4();
    balls.getMatrixAt(0, y0);
    const before = new THREE.Vector3().setFromMatrixPosition(y0).y;
    // the drop: a V, low in the middle; one frame of a tenth of a second
    rig.update(show({ dropHit: true }), 0.1);
    const after = new THREE.Matrix4();
    let moved = 0;
    for (let i = 0; i < 12; i++) {
      balls.getMatrixAt(i, after);
      moved = Math.max(moved, Math.abs(new THREE.Vector3().setFromMatrixPosition(after).y - before));
    }
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(WINCH_SPEED * 0.1 + 1e-6);
  });
});

describe('LED wristbands', () => {
  it('puts one band on each person and lights them with the show', () => {
    const spots = Array.from({ length: 50 }, (_, i) => ({ x: (i % 10) - 5, z: -5 - Math.floor(i / 10), y: -2 }));
    const w = new Wristbands(spots, { origin: new THREE.Vector2(0, 0) });
    expect((w.object.geometry.attributes.position as THREE.BufferAttribute).count).toBe(50);
    w.update(show({ dropHit: true }), 0.016);
    const u = (w.object.material as THREE.ShaderMaterial).uniforms;
    expect(u.uDrop.value).toBe(0);
    w.update(show(), 0.5);
    expect(u.uDrop.value).toBeCloseTo(0.5);
    // reduce flashing: the shader halves the beat swaps and holds back the drop's white
    w.update(show({ reduceFlash: true }), 0.016);
    expect(u.uSafe.value).toBe(1);
    // daylight: the venue fades them out
    w.amount = 0;
    w.update(show(), 0.016);
    expect(w.object.visible).toBe(false);
  });
});

describe('the holographic gauze', () => {
  it('projects from front of house: a point on the gauze stays put, one behind it closes in on the eye line', () => {
    const eye = V(0, -8, -40);
    const on = projectOnto(V(3, 2, 0), eye)!;
    expect(on.x).toBeCloseTo(3);
    expect(on.y).toBeCloseTo(2);
    const behind = projectOnto(V(3, 2, 10), eye)!;
    expect(Math.abs(behind.x)).toBeLessThan(3);
    expect(projectOnto(V(0, 0, -45), eye)).toBeNull();
  });

  it('shows a solid in the groove, a tunnel through the build, nothing with the lights out', () => {
    const g = new HoloScrim([30, 16], V(0, 8, -2), V(0, -0.7, -45));
    const u = (g.object.material as THREE.ShaderMaterial).uniforms;
    g.update(show({ energy: 0.7 }), 0.016);
    expect(u.uSegN.value).toBeGreaterThan(5);
    expect(u.uRingN.value).toBe(0);
    g.update(show({ build: 0.95, t: 3 }), 0.016);
    expect(u.uRingN.value).toBeGreaterThan(3);
    g.update(show({ master: 0 }), 0.016);
    expect(g.object.visible).toBe(false);
    // the drop flashes the gauze, but not with Reduce flashing
    g.update(show({ dropHit: true, reduceFlash: true }), 0.016);
    expect(u.uFlash.value).toBe(0);
  });
});
