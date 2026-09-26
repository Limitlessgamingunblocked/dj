import * as THREE from 'three';
import { isOnRoad } from '../core/city';
import type { Vec2 } from '../core/math';
import type { Patient } from '../core/medical';
import { CURB } from './cityMesh';
import type { Beacon, Markers } from './Markers';
import { personMesh } from './Walker';

export type VictimState = 'waiting' | 'treated' | 'onboard' | 'delivered' | 'released' | 'lost';
/** Where a patient needs to go: any hospital, a specific one, or the safety zone. */
export type Dest = 'hospital' | 'stgrace' | 'metro' | 'safety' | 'none';
export type Pose = 'lying' | 'sitting' | 'standing';

export interface Victim {
  id: number;
  patient: Patient;
  pos: Vec2;
  heading: number;
  state: VictimState;
  dest: Dest;
  pose: Pose;
  mirror: boolean;
  /** Short scene description shown in triage. */
  scene: string;
  /** Lane point next to the patient, used for GPS. */
  road: Vec2;
  group: THREE.Group;
  beacon: Beacon;
}

const CLOTHES = [0x3d5a80, 0xb23a48, 0x4a7c59, 0xe0a458, 0x6d597a, 0x2b2d42, 0xf4f1de];
const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc68642, 0x8d5524, 0xffdbac];

export const VICTIM_COLORS = { waiting: 0xff3b3b, treated: 0xffb52e, evac: 0x3aa0ff } as const;

export class Victims {
  readonly list: Victim[] = [];
  readonly group = new THREE.Group();
  private nextId = 1;

  constructor(private markers: Markers) {}

  add(opts: { patient: Patient; pos: Vec2; road?: Vec2; heading?: number; dest: Dest; pose?: Pose; scene: string; child?: boolean }): Victim {
    const id = this.nextId++;
    const clothes = CLOTHES[id % CLOTHES.length];
    const skin = SKIN[(id * 3) % SKIN.length];
    const group = personMesh(clothes, skin);
    if (opts.child) group.scale.setScalar(0.68);
    const pose = opts.pose ?? 'lying';
    if (pose === 'lying') {
      group.rotation.x = -Math.PI / 2;
      group.position.y = 0.25;
    } else if (pose === 'sitting') {
      for (const c of group.children) if (c.name.startsWith('leg')) c.rotation.x = -Math.PI / 2;
    }
    const holder = new THREE.Group();
    holder.add(group);
    holder.position.set(opts.pos.x, isOnRoad(opts.pos.x, opts.pos.z) ? 0 : CURB, opts.pos.z);
    holder.rotation.y = opts.heading ?? 0;
    this.group.add(holder);
    const evac = opts.patient.condition === 'evacuee';
    const beacon = this.markers.beacon(opts.pos, evac ? VICTIM_COLORS.evac : VICTIM_COLORS.waiting, 2.2, 45);
    const v: Victim = {
      id,
      patient: opts.patient,
      pos: { ...opts.pos },
      heading: opts.heading ?? 0,
      state: evac ? 'treated' : 'waiting',
      dest: opts.dest,
      pose,
      mirror: id % 2 === 0,
      scene: opts.scene,
      road: opts.road ?? { ...opts.pos },
      group: holder,
      beacon,
    };
    this.list.push(v);
    return v;
  }

  remove(v: Victim) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    this.group.remove(v.group);
    this.markers.removeBeacon(v.beacon);
  }

  clear() {
    for (const v of [...this.list]) this.remove(v);
  }

  /** Marks a patient as treated; they stand up if they no longer need transport. */
  setState(v: Victim, s: VictimState) {
    v.state = s;
    const inner = v.group.children[0] as THREE.Group;
    if (s === 'released') {
      inner.rotation.x = 0;
      inner.position.y = 0;
      for (const c of inner.children) if (c.name.startsWith('leg')) c.rotation.x = 0;
    }
    v.group.visible = s !== 'onboard' && s !== 'delivered';
    v.beacon.visible = s === 'waiting' || s === 'treated';
    if (s === 'treated') v.beacon.setColor(v.patient.condition === 'evacuee' ? VICTIM_COLORS.evac : VICTIM_COLORS.treated);
  }

  update(time: number) {
    for (const v of this.list) {
      if (v.state === 'waiting' && v.pose !== 'lying') {
        // A little distress motion.
        const inner = v.group.children[0];
        inner.rotation.z = Math.sin(time * 3 + v.id) * 0.05;
      }
    }
  }
}
