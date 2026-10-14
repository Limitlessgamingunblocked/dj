import { describe, expect, it } from 'vitest';
import { crowdPerson, PERSON_BONES, personGeometry } from '../src/three/venues/crowd';
import { JOINTS, JOINTS_FEMALE, LANDMARKS, MORPH_ATTRS } from '../src/three/venues/crowdbody';

describe('the realistic crowd', () => {
  it('stands its people 1.75 m tall with the face where the shaders paint it', () => {
    const g = personGeometry(0);
    const pos = g.attributes.position;
    const bone = g.attributes.aBone.array as Float32Array;
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) if (bone[i] !== PERSON_BONES.sign) top = Math.max(top, pos.getY(i));
    // the hair, the hats and the buns sit on top of the crown
    expect(top).toBeGreaterThan(LANDMARKS.headTop);
    expect(top).toBeLessThan(LANDMARKS.headTop + 0.15);
    expect(LANDMARKS.eye[1]).toBeGreaterThan(JOINTS.neck[1]);
    expect(LANDMARKS.mouth[1]).toBeLessThan(LANDMARKS.nose[1]);
    expect(LANDMARKS.chin[1]).toBeLessThan(LANDMARKS.mouth[1]);
  });

  it('carries the shape offsets on every vertex, so one model makes everyone', () => {
    for (const detail of [0, 1] as const) {
      const g = personGeometry(detail);
      for (const a of MORPH_ATTRS) expect(g.attributes[a]?.count, `${a} at detail ${detail}`).toBe(g.attributes.position.count);
      expect(g.attributes.aRig.count).toBe(g.attributes.position.count);
    }
  });

  it('gives women a different skeleton: narrower shoulders, a lower hip', () => {
    expect(JOINTS_FEMALE.shoulder[0]).toBeLessThan(JOINTS.shoulder[0]);
    expect(JOINTS_FEMALE.hip[1]).toBeLessThan(JOINTS.hip[1]);
  });

  it('makes a varied crowd: men and women, builds, ancestries, heights', () => {
    const people = Array.from({ length: 400 }, (_, i) => {
      const seed = [((i * 0.6180339) % 1), ((i * 0.3819661 + 0.2) % 1), ((i * 0.7548777 + 0.1) % 1), ((i * 0.5698403 + 0.3) % 1)];
      return { ...crowdPerson(seed), h: crowdPerson(seed).height(((i * 0.4142135) % 1)) };
    });
    const women = people.filter((p) => p.woman).length;
    expect(women).toBeGreaterThan(140);
    expect(women).toBeLessThan(260);
    const classes = new Set(people.map((p) => Math.floor(p.body[3])));
    expect([...classes].sort()).toEqual([0, 1, 2]);
    const builds = people.map((p) => p.body[1]);
    expect(Math.min(...builds)).toBeLessThan(-0.4);
    expect(Math.max(...builds)).toBeGreaterThan(0.6);
    const hs = people.map((p) => p.h);
    expect(Math.min(...hs)).toBeGreaterThan(1.45);
    expect(Math.max(...hs)).toBeLessThan(1.95);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.25);
  });
});
