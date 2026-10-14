import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AOPass, DepthTap } from '../src/three/ao';
import { QUALITY_STEPS } from '../src/three/quality';
import { REFLECT_LAYER, ReflectPass, isBright, tagBright } from '../src/three/reflect';
import { PERSON_BONES, PERSON_MATS, personGeometry } from '../src/three/venues/crowd';
import { JOINTS } from '../src/three/venues/crowdbody';
import { boneMatrix, posedPerson, type HeldPose } from '../src/three/venues/crowdpose';
import { FAR_POSES, atlasColor, padEdges } from '../src/three/venues/farcrowd';
import { speakerGeometry, truss } from '../src/three/venues/fixtures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const REST: HeldPose = { aL: [0, 0, 0], aR: [0, 0, 0], knee: 0 };

describe('reflections pick out the bright things', () => {
  it('counts lamps, screens and beams as bright, plain surfaces not', () => {
    const geo = new THREE.BoxGeometry();
    const plain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x808080 }));
    const lamp = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ emissive: 0xffffff }));
    const dim = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ emissive: 0x050505 }));
    const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }));
    const screen = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }));
    const hidden = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false, visible: false }));
    expect(isBright(plain)).toBe(false);
    expect(isBright(dim)).toBe(false);
    expect(isBright(lamp)).toBe(true);
    expect(isBright(beam)).toBe(true);
    expect(isBright(screen)).toBe(true);
    expect(isBright(hidden)).toBe(false);
    expect(isBright(new THREE.Group())).toBe(false);
    const root = new THREE.Group().add(plain, lamp, dim, beam, screen, hidden);
    expect(tagBright(root)).toBe(3);
    const probe = new THREE.Layers();
    probe.set(REFLECT_LAYER);
    expect(lamp.layers.test(probe)).toBe(true);
    expect(plain.layers.test(probe)).toBe(false);
  });

  it('builds the passes without a GPU, and takes one or two planes', () => {
    const cam = new THREE.PerspectiveCamera();
    const tap = new DepthTap();
    expect(tap.needsSwap).toBe(false);
    const rf = new ReflectPass(new THREE.Scene(), cam, tap);
    rf.floor = { y: 0, strength: 0.4 };
    expect(rf.planes).toHaveLength(1);
    rf.floor = [
      { y: 0, strength: 0.4 },
      { y: 1.2, strength: 0.3 },
      { y: 3, strength: 0.2 },
    ];
    expect(rf.planes).toHaveLength(2);
    rf.floor = null;
    expect(rf.planes).toHaveLength(0);
    const ao = new AOPass(cam, tap);
    ao.setSize(800, 450);
    expect(ao.needsSwap).toBe(true);
    rf.dispose();
    ao.dispose();
  });

  it('drops AO and reflections at the lower quality steps only', () => {
    expect(QUALITY_STEPS[0].surfaces).toBe(true);
    expect(QUALITY_STEPS[QUALITY_STEPS.length - 1].surfaces).toBe(false);
    // once off, they stay off further down
    const firstOff = QUALITY_STEPS.findIndex((s) => !s.surfaces);
    expect(firstOff).toBeGreaterThan(0);
    expect(QUALITY_STEPS.slice(firstOff).every((s) => !s.surfaces)).toBe(true);
  });
});

describe('modelled trusses and speakers', () => {
  it('shares one geometry between runs of the same length and size', () => {
    const a = truss(V(0, 0, 0), V(0, 6, 0));
    const b = truss(V(5, 0, 0), V(5, 0, 6));
    const c = truss(V(0, 0, 0), V(0, 4, 0));
    expect(a.geometry).toBe(b.geometry);
    expect(a.geometry).not.toBe(c.geometry);
    // a 6 m run lies along its axis, its tubes inside the truss's width
    a.geometry.computeBoundingBox();
    const bb = a.geometry.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeCloseTo(6, 1);
    expect(bb.max.x - bb.min.x).toBeLessThan(0.36);
  });

  it('gives a speaker a shell group and a grille group on its front', () => {
    for (const layout of ['mid', 'sub', 'monitor', 'top'] as const) {
      const g = speakerGeometry(0.6, 0.9, 0.5, layout);
      expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1]);
      const grille = g.groups[1];
      const pos = g.attributes.position;
      for (let i = grille.start; i < grille.start + grille.count; i++) expect(pos.getZ(i)).toBeCloseTo(0.25 - 0.004, 4);
    }
  });
});

describe('the crowd model', () => {
  it('keeps the low-detail model well under the close-up one, with the same parts', () => {
    const hi = personGeometry(0);
    const lo = personGeometry(1);
    expect(lo.index!.count).toBeLessThan(hi.index!.count * 0.6);
    const mats = (g: THREE.BufferGeometry) => new Set(Array.from(g.attributes.aMat.array as Float32Array));
    for (const m of [PERSON_MATS.longHair, PERSON_MATS.cap, PERSON_MATS.shin]) {
      expect(mats(hi).has(m)).toBe(true);
      expect(mats(lo).has(m)).toBe(true);
    }
    expect(Math.max(...mats(hi))).toBe(PERSON_MATS.pony);
  });

  it('stays inside its vertex budget at both levels of detail', () => {
    expect(personGeometry(0).attributes.position.count).toBeLessThan(4000);
    expect(personGeometry(1).attributes.position.count).toBeLessThan(1300);
  });

  it('builds the body as one closed skin, open only at the ankles inside the shoes', () => {
    // count each edge by where its ends are, so the copies of a vertex at a material seam count as joined
    const key = (pos: THREE.BufferAttribute, i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const openEdges = (g: THREE.BufferGeometry, keep: (m: number) => boolean) => {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const mat = g.attributes.aMat.array as Float32Array;
      const idx = g.index!.array;
      const e = new Map<string, number>();
      for (let k = 0; k < idx.length; k += 3) {
        if (!keep(mat[idx[k]])) continue;
        const ks = [key(pos, idx[k]), key(pos, idx[k + 1]), key(pos, idx[k + 2])];
        if (ks[0] === ks[1] || ks[1] === ks[2] || ks[0] === ks[2]) continue;
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [2, 0],
        ]) {
          const s = ks[a] < ks[b] ? `${ks[a]}|${ks[b]}` : `${ks[b]}|${ks[a]}`;
          e.set(s, (e.get(s) ?? 0) + 1);
        }
      }
      return [...e].filter(([, c]) => c !== 2).map(([s]) => s.split('|')[0].split(',').map((n) => Number(n) / 1e4));
    };
    const body = new Set([PERSON_MATS.skin, PERSON_MATS.top, PERSON_MATS.bottoms, PERSON_MATS.sleeveUp, PERSON_MATS.sleeveLo, PERSON_MATS.shin]);
    for (const detail of [0, 1] as const) {
      const g = personGeometry(detail);
      const open = openEdges(g, (m) => body.has(m));
      expect(open.length, `detail ${detail}`).toBeGreaterThan(0);
      // (the simplest model's thin parts, the fingers and the ears, can be pinched together by the simplifier, leaving an
      // edge or two there; the close-up model has none)
      const above = open.filter((p) => p[1] >= 0.15);
      expect(above.length, `detail ${detail}`).toBeLessThan(detail === 0 ? 1 : 8);
      expect(openEdges(g, (m) => m === PERSON_MATS.shoes).length, `shoes at detail ${detail}`).toBe(0);
    }
  });

  it('poses nothing in the rest pose', () => {
    for (const b of Object.values(PERSON_BONES)) expect(boneMatrix(b, REST).equals(new THREE.Matrix4())).toBe(true);
  });

  it('bends the joints the way the crowd shader does', () => {
    const J = (j: readonly number[]) => V(j[0], j[1], j[2]);
    const sh = J(JOINTS.shoulder);
    const el = J(JOINTS.elbow);
    // an arm straight up (out to the side by 180°): the elbow goes as far above the shoulder as it hung below
    const up = boneMatrix(PERSON_BONES.upperR, { ...REST, aR: [Math.PI, 0, 0] });
    const elbow = el.clone().applyMatrix4(up);
    expect(elbow.distanceTo(sh.clone().multiplyScalar(2).sub(el))).toBeLessThan(1e-5);
    // round the shoulder a point takes only its share of the turn
    const half = el.clone().applyMatrix4(boneMatrix(PERSON_BONES.upperR, { ...REST, aR: [Math.PI, 0, 0] }, 0.5));
    expect(half.y).toBeCloseTo(sh.y, 1);
    expect(half.x).toBeGreaterThan(sh.x + 0.2);
    // the elbow bend swings the hand forward, the elbow stays put
    const fore = boneMatrix(PERSON_BONES.foreR, { ...REST, aR: [0, 0, Math.PI / 2] });
    expect(el.clone().applyMatrix4(fore).distanceTo(el)).toBeLessThan(1e-6);
    expect(el.clone().add(V(0, -0.3, 0)).applyMatrix4(fore).z).toBeCloseTo(el.z + 0.3, 5);
    // bent knees: the hips drop, the ankles stay on the floor
    const k = 0.6;
    const hip = J(JOINTS.hip).applyMatrix4(boneMatrix(PERSON_BONES.thighR, { ...REST, knee: k }));
    const ankle = J(JOINTS.ankle).applyMatrix4(boneMatrix(PERSON_BONES.shinR, { ...REST, knee: k }));
    expect(hip.y).toBeLessThan(JOINTS.hip[1] - 0.05);
    expect(ankle.y).toBeCloseTo(JOINTS.ankle[1], 5);
  });

  it('leaves the props out of the far crowd unless asked', () => {
    const mats = (o?: { phone?: boolean; longHair?: boolean }) => new Set(posedPerson(REST, o).map((t) => t.mat));
    const plain = mats();
    for (const m of [PERSON_MATS.cup, PERSON_MATS.phone, PERSON_MATS.signFace, PERSON_MATS.towel, PERSON_MATS.cap, PERSON_MATS.longHair]) expect(plain.has(m)).toBe(false);
    expect(plain.has(PERSON_MATS.skin) && plain.has(PERSON_MATS.top) && plain.has(PERSON_MATS.shin)).toBe(true);
    expect(mats({ phone: true }).has(PERSON_MATS.screen)).toBe(true);
    expect(mats({ longHair: true }).has(PERSON_MATS.longHair)).toBe(true);
  });

  it('keeps every far pose inside its 1 m × 2 m card', () => {
    for (const p of FAR_POSES) {
      const box = new THREE.Box3();
      for (const t of posedPerson(p, { phone: p.phone, longHair: true })) for (const q of t.p) box.expandByPoint(q);
      expect(box.min.x).toBeGreaterThan(-0.5);
      expect(box.max.x).toBeLessThan(0.5);
      expect(box.max.y).toBeLessThan(1.98);
      // the toes of a bent leg dip a little under the floor line, as they do in the shader
      expect(box.min.y).toBeGreaterThan(-0.07);
    }
  });

  it('writes the atlas data the far crowd shader decodes', () => {
    const front = V(0, 0, 1);
    const back = V(0, 0, -1);
    const [skinR, skinG] = atlasColor(PERSON_MATS.skin, front);
    expect(skinR).toBe(255);
    expect(skinG).toBe(255);
    expect(atlasColor(PERSON_MATS.hair, front)[0]).toBe(128);
    expect(atlasColor(PERSON_MATS.longHair, front)[0]).toBe(128);
    expect(atlasColor(PERSON_MATS.top, front).slice(0, 2)).toEqual([0, 255]);
    expect(atlasColor(PERSON_MATS.sleeveUp, front)[1]).toBe(255);
    expect(atlasColor(PERSON_MATS.bottoms, front)[1]).toBe(100);
    expect(atlasColor(PERSON_MATS.shin, front)[1]).toBe(100);
    expect(atlasColor(PERSON_MATS.screen, front).slice(0, 2)).toEqual([0, 0]);
    // facing the light is brighter than facing away
    expect(atlasColor(PERSON_MATS.top, front)[2]).toBeGreaterThan(atlasColor(PERSON_MATS.top, back)[2] + 100);
  });

  it('pads colour out past the outline without covering anything', () => {
    const w = 5;
    const px = new Uint8Array(w * w * 4);
    const at = (x: number, y: number) => (y * w + x) * 4;
    px.set([200, 100, 50, 255], at(2, 2));
    padEdges(px, w, w, 2);
    expect(Array.from(px.subarray(at(3, 2), at(3, 2) + 4))).toEqual([200, 100, 50, 0]);
    expect(Array.from(px.subarray(at(2, 0), at(2, 0) + 4))).toEqual([200, 100, 50, 0]);
    // three steps away: out of reach of two passes
    expect(px[at(0, 0)]).toBe(0);
    expect(px[at(2, 2) + 3]).toBe(255);
  });
});

describe('the crowd shader', () => {
  it('declares each of its pose variables once (a clash fails to compile and the crowd vanishes)', async () => {
    const { VERT_HEAD } = await import('../src/three/venues/crowd');
    const body = VERT_HEAD.slice(VERT_HEAD.indexOf('void computePose()'));
    // top-level statements of computePose sit at four spaces; inner blocks are deeper
    const names = [...body.matchAll(/^ {4}(?:float|vec2|vec3|vec4|mat3)\s+(\w+)\s*[=;]/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(20);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});
