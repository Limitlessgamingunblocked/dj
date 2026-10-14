import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { frontGeometry, facePoints, FRONT_MATS, FRONT_VIS } from '../src/three/venues/frontrow';
import { PERSON_BONES, PERSON_MATS, personGeometry, VERT_HEAD } from '../src/three/venues/crowd';

describe('the front row model', () => {
  it('stays inside its triangle budget', () => {
    const tris = frontGeometry().index!.count / 3;
    expect(tris).toBeGreaterThan(personGeometry(0).index!.count / 3);
    expect(tris).toBeLessThan(6200);
  });

  it('uses the crowd skeleton and every material the crowd shader colours, plus its own', () => {
    const g = frontGeometry();
    const bones = new Set(Array.from(g.attributes.aBone.array as Float32Array));
    for (const b of bones) expect(Object.values(PERSON_BONES)).toContain(b);
    const mats = new Set(Array.from(g.attributes.aMat.array as Float32Array));
    for (const m of [...Object.values(PERSON_MATS), ...Object.values(FRONT_MATS)]) expect(mats.has(m), `material ${m}`).toBe(true);
    // the same attributes as the crowd's model, so the one shader draws both
    expect(Object.keys(g.attributes).sort()).toEqual(Object.keys(personGeometry(0).attributes).sort());
  });

  it('keeps the joints where the crowd pose expects them', () => {
    const g = frontGeometry();
    const pos = g.attributes.position;
    const bone = g.attributes.aBone.array as Float32Array;
    const box = (b: number) => {
      const bx = new THREE.Box3();
      for (let i = 0; i < pos.count; i++) if (bone[i] === b) bx.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
      return bx;
    };
    // the shins stay below the knee (plus the knee cap), the hands hang below the elbow
    expect(box(PERSON_BONES.shinR).max.y).toBeLessThan(0.6);
    expect(box(PERSON_BONES.thighR).min.y).toBeGreaterThan(0.4);
    const fore = box(PERSON_BONES.foreR);
    expect(fore.max.y).toBeLessThan(1.2);
    expect(fore.min.y).toBeGreaterThan(0.2);
  });

  it('puts the eyes in the face', () => {
    const f = facePoints();
    expect(f.eye.y).toBeCloseTo(1.603, 3);
    expect(f.eye.z).toBeGreaterThan(0.06);
    expect(f.eye.z).toBeLessThan(0.1);
  });

  it('slots its kit into the crowd pose code', () => {
    expect(VERT_HEAD).toContain('/*FRONT_VIS*/');
    expect(FRONT_VIS).toContain('poseMouth');
  });
});
