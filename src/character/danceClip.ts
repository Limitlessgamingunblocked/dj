/*
 * Motion-captured dances, moved onto the game's skeleton by
 * scripts/scan/clip.ts: each frame holds every bone's rotation in the body's
 * space (from its rest pose) and the hips' travel. Played on the game's bones,
 * locked to the beat, so a regular on the floor dances like a person does.
 */
import * as THREE from 'three';
import allNight from './dances/all_night.json';
import boom from './dances/boom.json';
import omgGroove from './dances/omg_groove.json';

export interface DanceClip {
  name: string;
  fps: number;
  frames: number;
  bones: string[];
  q: number[];
  hips: number[];
}

export const DANCES: DanceClip[] = [allNight, boom, omgGroove] as DanceClip[];

/** the game's bones above each one (the hips hang off the body) */
const PARENT: Record<string, string | null> = { hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck' };
for (const s of ['l', 'r']) {
  Object.assign(PARENT, {
    [`shoulder_${s}`]: 'chest',
    [`upper_arm_${s}`]: `shoulder_${s}`,
    [`forearm_${s}`]: `upper_arm_${s}`,
    [`hand_${s}`]: `forearm_${s}`,
    [`thigh_${s}`]: 'hips',
    [`shin_${s}`]: `thigh_${s}`,
    [`foot_${s}`]: `shin_${s}`,
  });
}

/** a dance's beat: the clips are danced at about 120 bpm, so a beat of the music is half a second of dance */
export const DANCE_BEAT = 0.5;

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const world = new Map<string, THREE.Quaternion>();
const inv = new THREE.Quaternion();

/** each bone's rotation in body space at time t (looped), slerped between frames */
export function sampleDance(c: DanceClip, t: number, out: Map<string, THREE.Quaternion>, hips: THREE.Vector3): void {
  const len = c.frames / c.fps;
  const ft = ((((t % len) + len) % len) * c.fps) % c.frames;
  const f0 = Math.floor(ft);
  const f1 = (f0 + 1) % c.frames;
  const a = ft - f0;
  const n = c.bones.length;
  c.bones.forEach((b, i) => {
    const i0 = (f0 * n + i) * 4;
    const i1 = (f1 * n + i) * 4;
    qa.set(c.q[i0], c.q[i0 + 1], c.q[i0 + 2], c.q[i0 + 3]);
    qb.set(c.q[i1], c.q[i1 + 1], c.q[i1 + 2], c.q[i1 + 3]);
    let q = out.get(b);
    if (!q) out.set(b, (q = new THREE.Quaternion()));
    q.copy(qa).slerp(qb, a);
  });
  hips.set(
    c.hips[f0 * 3] + (c.hips[f1 * 3] - c.hips[f0 * 3]) * a,
    c.hips[f0 * 3 + 1] + (c.hips[f1 * 3 + 1] - c.hips[f0 * 3 + 1]) * a,
    c.hips[f0 * 3 + 2] + (c.hips[f1 * 3 + 2] - c.hips[f0 * 3 + 2]) * a,
  );
}

const hipsAt = new THREE.Vector3();

/**
 * Pose the game's bones from a dance at time t: each bone's rotation is its
 * body-space turn under its parent's; the hips travel from where they rest.
 */
export function playDance(c: DanceClip, bones: Record<string, THREE.Object3D>, t: number, hipY: number): void {
  sampleDance(c, t, world, hipsAt);
  for (const name of Object.keys(PARENT)) {
    const b = bones[name];
    if (!b) continue;
    const q = world.get(name);
    if (!q) continue;
    let p = PARENT[name];
    while (p && !world.has(p)) p = PARENT[p];
    if (p) b.quaternion.copy(inv.copy(world.get(p)!).invert().multiply(q));
    else b.quaternion.copy(q);
  }
  bones.hips?.position.set(hipsAt.x, hipY + hipsAt.y, hipsAt.z);
}
