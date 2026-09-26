import { curbSpot, districtAt, LANE, N, P, zoneAt } from '../core/city';
import { dist, fmtTime, type Vec2 } from '../core/math';
import { CONDITIONS, newPatient, type ConditionId } from '../core/medical';
import type { CertId } from '../core/progression';
import { edgeKey, findPath, type Node } from '../core/route';
import { irange, pick, range, type Rng } from '../core/rng';
import { lanePoint, type Beacon, type Debris } from '../world/Markers';
import type { Car } from '../world/Traffic';
import type { Dest, Pose, Victim } from '../world/Victims';
import type { Game } from './Game';
import type { Mission, MissionDef, MissionResult, MissionStatus } from './types';
import * as THREE from 'three';

export interface VictimSpec {
  condition: ConditionId;
  pos: Vec2;
  road: Vec2;
  heading?: number;
  pose?: Pose;
  child?: boolean;
  name: string;
  age: number;
  scene: string;
  story?: string;
  dest: Dest;
  training?: boolean;
  stability?: number;
}

export interface CareConfig {
  id: string;
  title: string;
  intro: string;
  victims: VictimSpec[];
  timeLimit: number | null;
  par: number;
  traffic?: number;
  reward: number;
  cert?: CertId;
  training?: boolean;
  emergent?: boolean;
  /** Put the player at the training centre before starting. */
  atTraining?: boolean;
}

abstract class BaseMission implements Mission {
  status: MissionStatus = 'running';
  elapsed = 0;
  carHits = 0;
  protected failReason = '';
  abstract readonly id: string;
  abstract readonly title: string;
  constructor(protected g: Game) {}
  abstract start(): void;
  abstract objective(): string;
  abstract gps(): Vec2 | null;
  abstract result(): MissionResult;
  abstract cleanup(): void;
  update(dt: number) {
    this.elapsed += dt;
  }
  timeLeft(): number | null {
    return null;
  }
  timerLabel() {
    return 'Emergency timer';
  }
  onCarHit() {
    this.carHits++;
  }
  protected fail(reason: string) {
    if (this.status !== 'running') return;
    this.status = 'failed';
    this.failReason = reason;
  }
  protected hitPenalty() {
    return this.carHits * 10;
  }
}

/** Treat one or more patients on scene, then transport the ones who need it. */
export class CareMission extends BaseMission {
  readonly id: string;
  readonly title: string;
  victims: Victim[] = [];
  private prevDensity = 1;

  constructor(g: Game, private cfg: CareConfig) {
    super(g);
    this.id = cfg.id;
    this.title = cfg.title;
  }

  start() {
    const g = this.g;
    if (this.cfg.atTraining) g.teleport(g.city.training.bay, -Math.PI / 2);
    for (const s of this.cfg.victims) {
      const patient = newPatient(s.condition, { name: s.name, age: s.age, training: !!s.training, story: s.story, stability: s.stability ?? 70 });
      this.victims.push(g.victims.add({ patient, pos: s.pos, road: s.road, heading: s.heading, dest: s.dest, pose: s.pose, scene: s.scene, child: s.child }));
    }
    this.prevDensity = g.traffic.density;
    if (this.cfg.traffic) g.traffic.density = this.cfg.traffic;
    g.toast(this.cfg.intro, 'dispatch', 6);
  }

  update(dt: number) {
    super.update(dt);
    const lost = this.victims.find((v) => v.state === 'lost');
    if (lost) return this.fail(`${lost.patient.name} deteriorated before reaching definitive care. A backup crew took over.`);
    const limit = this.cfg.timeLimit;
    if (limit !== null && this.elapsed > limit) return this.fail('The emergency timer ran out. Another unit had to take the call.');
    if (this.victims.every((v) => v.state === 'delivered' || v.state === 'released')) this.status = 'success';
  }

  private nearest(list: Victim[]): Victim {
    const p = this.g.playerPos();
    return list.reduce((a, b) => (dist(p, a.pos) <= dist(p, b.pos) ? a : b));
  }

  private destName(v: Victim): string {
    return this.g.placeFor(v.dest, this.g.playerPos())?.name ?? 'the hospital';
  }

  objective(): string {
    const g = this.g;
    const waiting = this.victims.filter((v) => v.state === 'waiting');
    const toLoad = this.victims.filter((v) => v.state === 'treated');
    const onboard = this.victims.filter((v) => v.state === 'onboard');
    if (waiting.length) {
      const v = this.nearest(waiting);
      const d = dist(g.playerPos(), v.pos);
      if (g.inVehicle) return d > 28 ? `Respond: ${v.scene} — ${districtAt(g.city, v.pos.x, v.pos.z)}` : 'Stop nearby and step out  [F]';
      return d > 2.6 ? 'Go to the patient (red beacon)' : 'Assess and treat the patient  [E]';
    }
    if (toLoad.length) {
      const v = this.nearest(toLoad);
      if (g.inVehicle) return dist(g.playerPos(), v.pos) > 20 ? 'Bring the ambulance close to the patient' : 'Step out and load the patient  [F] then [E]';
      return 'Load the patient into the ambulance  [E] (or just get in with [F])';
    }
    if (onboard.length) return `Transport to ${this.destName(onboard[0])} — drive smooth, the patient feels every jolt`;
    return 'Patients stable';
  }

  gps(): Vec2 | null {
    // Drive to the curb next to the patient; on foot, walk to the patient.
    const at = (v: Victim) => (this.g.inVehicle ? v.road : v.pos);
    const waiting = this.victims.filter((v) => v.state === 'waiting');
    if (waiting.length) return at(this.nearest(waiting));
    const toLoad = this.victims.filter((v) => v.state === 'treated');
    if (toLoad.length) return at(this.nearest(toLoad));
    const onboard = this.victims.find((v) => v.state === 'onboard');
    if (onboard) return this.g.placeFor(onboard.dest, this.g.playerPos())?.bay ?? null;
    return null;
  }

  timeLeft() {
    return this.cfg.timeLimit === null ? null : this.cfg.timeLimit - this.elapsed;
  }

  result(): MissionResult {
    if (this.status === 'failed') return { merit: 0, lines: [], failReason: this.failReason };
    const n = this.victims.length;
    if (this.cfg.training) {
      return { merit: this.cfg.reward, lines: [`Training scenarios passed: ${n}/${n}`, `Course reward +${this.cfg.reward}`], cert: this.cfg.cert };
    }
    const avg = this.victims.reduce((a, v) => a + v.patient.stability, 0) / n;
    const timeBonus = Math.max(0, Math.round((this.cfg.par - this.elapsed) * 2));
    const care = Math.round(avg * 1.2);
    const pen = this.hitPenalty();
    const merit = Math.max(10, this.cfg.reward + timeBonus + care - pen);
    const lines = [
      `${n === 1 ? 'Patient' : 'Patients'} helped: ${n}`,
      `Call reward +${this.cfg.reward}`,
      `Response time ${fmtTime(this.elapsed)} (par ${fmtTime(this.cfg.par)}) +${timeBonus}`,
      `Patient condition at hand-off ${Math.round(avg)}% +${care}`,
    ];
    if (pen) lines.push(`Contact with civilian traffic ×${this.carHits} −${pen}`);
    return { merit, lines, cert: this.cfg.cert };
  }

  cleanup() {
    for (const v of this.victims) this.g.victims.remove(v);
    this.g.traffic.density = this.prevDensity;
  }
}

/** EVOC: lights-and-siren checkpoints with a training dummy on the stretcher. */
export class CourseMission extends BaseMission {
  readonly id = 'evoc';
  readonly title = 'EVOC Driving Course';
  private points: Vec2[] = [];
  private idx = 0;
  private beacons: Beacon[] = [];
  private dummy!: Victim;
  private hinted = 0;
  private readonly limit = 190;

  start() {
    const g = this.g;
    const path: Node[] = [[8, 6], [7, 6], [6, 6], [6, 5], [6, 4], [7, 4], [8, 4], [8, 3], [8, 2], [9, 2], [9, 3], [9, 4], [9, 5], [9, 6], [8, 6]];
    for (let k = 0; k < path.length - 1; k++) this.points.push(lanePoint(path[k], path[k + 1], 0.5));
    const start = lanePoint([9, 6], [8, 6], 0.5);
    g.teleport(start, -Math.PI / 2);
    this.beacons = this.points.map((p, k) => {
      const b = g.markers.beacon(p, 0x39d0ff, 7, 30);
      b.visible = k < 2;
      return b;
    });
    const patient = newPatient('trauma', { name: 'Rescue Randy (training dummy)', age: 30, stability: 100 });
    patient.treated = true;
    patient.quality = 1;
    this.dummy = g.victims.add({ patient, pos: start, dest: 'none', scene: 'Training dummy', pose: 'lying' });
    g.boardVictim(this.dummy);
    g.toast('EVOC course: hit every checkpoint with the siren on. The dummy on the stretcher records every hard corner and jolt.', 'dispatch', 7);
  }

  update(dt: number) {
    super.update(dt);
    const g = this.g;
    if (this.elapsed > this.limit) return this.fail('Out of time. Course instructors expect you to keep it moving.');
    if (this.dummy.patient.stability < 35) return this.fail('The ride was too rough — the dummy’s sensors logged injuries a real patient would suffer.');
    const cp = this.points[this.idx];
    if (g.inVehicle && dist(g.playerPos(), cp) < 8.5) {
      if (!g.vehicle.siren) {
        if (this.elapsed - this.hinted > 4) {
          this.hinted = this.elapsed;
          g.toast('Checkpoints only count with lights and siren on — press Q.', 'warn');
        }
        return;
      }
      this.beacons[this.idx].visible = false;
      this.idx++;
      g.audio.good();
      if (this.idx >= this.points.length) {
        this.status = 'success';
        return;
      }
      this.beacons[this.idx].setColor(0x39d0ff);
      if (this.beacons[this.idx + 1]) {
        this.beacons[this.idx + 1].visible = true;
        this.beacons[this.idx + 1].setColor(0x1d5f86);
      }
    }
  }

  objective() {
    return `Checkpoint ${this.idx + 1} of ${this.points.length} — siren on, smooth lines`;
  }

  gps() {
    return this.points[this.idx] ?? null;
  }

  timeLeft() {
    return this.limit - this.elapsed;
  }

  timerLabel() {
    return 'Course timer';
  }

  result(): MissionResult {
    if (this.status === 'failed') return { merit: 0, lines: [], failReason: this.failReason };
    const s = Math.round(this.dummy.patient.stability);
    const bonus = Math.max(0, Math.round(this.limit - this.elapsed));
    const pen = this.hitPenalty();
    return {
      merit: Math.max(50, 150 + bonus + s - pen),
      lines: [`Course time ${fmtTime(this.elapsed)} +${bonus}`, `Dummy ride score ${s}% +${s}`, ...(pen ? [`Contact with traffic ×${this.carHits} −${pen}`] : []), 'Certification earned: EVOC'],
      cert: 'evoc',
    };
  }

  cleanup() {
    for (const b of this.beacons) this.g.markers.removeBeacon(b);
    this.g.victims.remove(this.dummy);
  }
}

/** Escort an organ transport van across town, clearing traffic and debris. */
export class EscortMission extends BaseMission {
  readonly id = 'organ';
  readonly title = 'Organ Convoy';
  private van!: Car;
  private mesh!: THREE.Group;
  private phase: 'meet' | 'escort' = 'meet';
  private debris: Debris[] = [];
  private readonly limit = 240;

  start() {
    const g = this.g;
    const closed = new Set([edgeKey([7, 2], [8, 2])]);
    const path = findPath([2, 5], [8, 2], closed) ?? [[2, 5], [8, 5], [8, 2]];
    const route: Node[] = [[1, 5], ...path, [7, 2]];
    this.van = g.traffic.spawnConvoy(route, P / 2);
    this.mesh = organVanMesh();
    g.scene.add(this.mesh);
    // Debris on the convoy's lane, a few blocks apart.
    const picks = [Math.floor(route.length * 0.3), Math.floor(route.length * 0.55), Math.floor(route.length * 0.8)];
    for (const k of picks) {
      if (k <= 0 || k >= route.length - 1) continue;
      this.debris.push(g.markers.addDebris(lanePoint(route[k], route[k + 1], 0.45)));
    }
    g.toast('Dispatch: a donor heart is leaving St. Grace for the transplant team at Metro Trauma. Meet the transport and clear its path.', 'dispatch', 7);
  }

  update(dt: number) {
    super.update(dt);
    const g = this.g;
    this.mesh.position.set(this.van.x, 0, this.van.z);
    this.mesh.rotation.y = this.van.heading;
    const lights = this.mesh.userData.lights as THREE.MeshStandardMaterial[];
    lights.forEach((m, k) => (m.emissiveIntensity = Math.floor(this.elapsed * 6 + k) % 2 ? 3 : 0.2));
    if (this.elapsed > this.limit) return this.fail('The organ’s safe transport window closed.');
    if (this.phase === 'meet') {
      this.van.speed = 0;
      this.van.bumpT = 1;
      if (dist(g.playerPos(), this.van) < 35) {
        this.phase = 'escort';
        this.van.bumpT = 0;
        g.toast('Convoy rolling. Stay close with your siren on so traffic clears for the van.', 'dispatch');
      }
    }
    if (this.van.arrived) this.status = 'success';
  }

  private blockingDebris(): Debris | null {
    for (const d of this.debris) {
      const moved = Math.hypot(d.x - d.home.x, d.z - d.home.z);
      if (moved < 5 && Math.hypot(d.x - this.van.x, d.z - this.van.z) < 30) return d;
    }
    return null;
  }

  objective() {
    if (this.phase === 'meet') return 'Meet the organ transport at St. Grace Medical Center';
    const d = dist(this.g.playerPos(), this.van);
    if (this.blockingDebris()) return 'Debris blocks the convoy — shove it out of the lane!';
    if (this.van.blocked) return 'The convoy is stuck — clear the way (siren on, get in front)';
    if (d > 70) return 'Get back to the convoy — traffic only yields when you are near';
    return 'Escort the organ transport to Metro Trauma Center';
  }

  gps() {
    if (this.phase === 'meet') return { x: this.van.x, z: this.van.z };
    const deb = this.blockingDebris();
    if (deb) return deb;
    return dist(this.g.playerPos(), this.van) > 70 ? { x: this.van.x, z: this.van.z } : this.g.city.hospitals[1].bay;
  }

  /** The van counts as an obstacle for cross traffic. */
  obstacles() {
    return this.g.traffic.circles(this.van);
  }

  timeLeft() {
    return this.limit - this.elapsed;
  }

  timerLabel() {
    return 'Organ viability';
  }

  result(): MissionResult {
    if (this.status === 'failed') return { merit: 0, lines: [], failReason: this.failReason };
    const left = Math.max(0, Math.round(this.limit - this.elapsed));
    const pen = this.hitPenalty();
    return {
      merit: Math.max(100, 500 + left * 2 - pen),
      lines: ['Donor heart delivered to the transplant team', `Viability window left ${fmtTime(left)} +${left * 2}`, ...(pen ? [`Contact with traffic ×${this.carHits} −${pen}`] : [])],
    };
  }

  cleanup() {
    this.g.traffic.remove(this.van);
    this.g.scene.remove(this.mesh);
    this.g.markers.clearDebris();
  }
}

function organVanMesh(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f3f0, roughness: 0.4, metalness: 0.2 });
  const green = new THREE.MeshStandardMaterial({ color: 0x14a36b, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.1, metalness: 0.6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.BoxGeometry(2.05, 2.3, 5.4), white, 0, 1.55, 0);
  add(new THREE.BoxGeometry(2.07, 0.3, 5.3), green, 0, 1.3, 0);
  add(new THREE.BoxGeometry(1.9, 0.7, 0.1), glass, 0, 2.1, 2.72);
  const lights: THREE.MeshStandardMaterial[] = [];
  for (const x of [-0.6, 0.6]) {
    const m = new THREE.MeshStandardMaterial({ color: 0x664400, emissive: 0xffaa00, emissiveIntensity: 0 });
    lights.push(m);
    add(new THREE.BoxGeometry(0.5, 0.18, 0.3), m, x, 2.8, 1.8);
  }
  const tyre = new THREE.MeshStandardMaterial({ color: 0x18191b });
  for (const [x, z] of [[1, 1.7], [-1, 1.7], [1, -1.7], [-1, -1.7]]) add(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12).rotateZ(Math.PI / 2), tyre, x, 0.4, z);
  g.userData.lights = lights;
  return g;
}

/** Industrial fire: treat smoke victims, evacuate residents and drop relief supplies. */
export class DisasterMission extends BaseMission {
  readonly id = 'disaster';
  readonly title = 'Community Disaster Response';
  private smoke: Victim[] = [];
  private evac: Victim[] = [];
  private aid: { pos: Vec2; beacon: Beacon; done: boolean; hold: number }[] = [];
  private readonly limit = 480;
  private prevDensity = 1;

  start() {
    const g = this.g;
    const fireBlock = g.city.blocks[7][3];
    g.markers.fire({ x: (fireBlock.x0 + fireBlock.x1) / 2 + 10, z: (fireBlock.z0 + fireBlock.z1) / 2 - 8 });
    // Close the streets along the burning block's north and east sides.
    for (const [a, b] of [[[7, 3], [8, 3]], [[8, 3], [8, 4]]] as [Node, Node][]) {
      g.closed.add(edgeKey(a, b));
      g.markers.roadblock(a, b);
    }
    g.traffic.clearClosed(g.closed);
    this.prevDensity = g.traffic.density;
    g.traffic.density = 0.8;
    const names = ['Dana Ruiz', 'Sam Okafor', 'Lee Park', 'Rosa Mendes', 'Ari Cohen', 'Jo Nakamura', 'Mika Laine', 'Theo Grant'];
    const spot = (bi: number, bj: number, side: number, t: number) => curbSpot(g.city.blocks[bi][bj], side, t);
    const smokeSpots = [spot(7, 3, 3, 0.4), spot(7, 3, 2, 0.6)];
    smokeSpots.forEach((s, k) => {
      const patient = newPatient('smoke', { name: names[k], age: 30 + k * 17, stability: 65 });
      this.smoke.push(g.victims.add({ patient, pos: s.walk, road: s.road, dest: 'none', pose: 'sitting', scene: 'Smoke inhalation near the fire' }));
    });
    const evacSpots = [spot(6, 3, 1, 0.3), spot(6, 3, 1, 0.34), spot(7, 4, 0, 0.5), spot(7, 4, 0, 0.55), spot(6, 2, 2, 0.7), spot(6, 2, 2, 0.74)];
    evacSpots.forEach((s, k) => {
      const patient = newPatient('evacuee', { name: names[k + 2], age: 20 + k * 9 });
      this.evac.push(g.victims.add({ patient, pos: s.walk, road: s.road, dest: 'safety', pose: 'standing', scene: 'Residents waiting for evacuation' }));
    });
    const aidPoints: Vec2[] = [lanePoint([6, 4], [6, 3], 0.5), lanePoint([7, 5], [7, 4], 0.5), lanePoint([5, 3], [5, 2], 0.5)];
    this.aid = aidPoints.map((pos) => ({ pos, beacon: g.markers.beacon(pos, 0xffd21f, 6, 35), done: false, hold: 0 }));
    g.toast('Major incident: chemical fire in Ironworks. Treat smoke victims, evacuate residents to Civic Stadium and drop relief supplies. Roads around the fire are closed.', 'dispatch', 8);
  }

  update(dt: number) {
    super.update(dt);
    const g = this.g;
    if (this.elapsed > this.limit) return this.fail('The incident commander reassigned the remaining tasks — the clock ran out.');
    const lost = this.smoke.find((v) => v.state === 'lost');
    if (lost) return this.fail(`${lost.patient.name} needed oxygen sooner.`);
    for (const a of this.aid) {
      if (a.done) continue;
      const near = g.inVehicle && dist(g.playerPos(), a.pos) < 7 && Math.abs(g.vehicle.state.speed) < 3;
      a.hold = near ? a.hold + dt : 0;
      if (a.hold > 1.2) {
        a.done = true;
        g.markers.removeBeacon(a.beacon);
        g.audio.good();
        g.toast('Relief supplies dropped: water, blankets and first-aid kits.', 'good');
      }
    }
    const smokeDone = this.smoke.every((v) => v.state === 'released');
    const evacDone = this.evac.every((v) => v.state === 'delivered');
    if (smokeDone && evacDone && this.aid.every((a) => a.done)) this.status = 'success';
  }

  private counts() {
    return {
      smoke: this.smoke.filter((v) => v.state === 'released').length,
      evac: this.evac.filter((v) => v.state === 'delivered').length,
      aboard: this.evac.filter((v) => v.state === 'onboard').length,
      aid: this.aid.filter((a) => a.done).length,
    };
  }

  objective() {
    const c = this.counts();
    const aid = this.aid.find((a) => !a.done && dist(this.g.playerPos(), a.pos) < 12);
    const extra = aid ? ' — stop here to unload supplies' : c.aboard ? ` — ${c.aboard} aboard, take them to Civic Stadium` : '';
    return `Smoke victims ${c.smoke}/2 · Evacuated ${c.evac}/6 · Aid drops ${c.aid}/3${extra}`;
  }

  gps(): Vec2 | null {
    const g = this.g;
    const p = g.playerPos();
    const c = this.counts();
    const waitingEvac = this.evac.filter((v) => v.state === 'treated');
    if (c.aboard && (c.aboard >= g.vehicle.spec.capacity || !waitingEvac.length)) return g.city.stadium.bay;
    const targets: Vec2[] = [
      ...this.smoke.filter((v) => v.state === 'waiting').map((v) => v.road),
      ...waitingEvac.map((v) => v.road),
      ...this.aid.filter((a) => !a.done).map((a) => a.pos),
    ];
    if (!targets.length) return c.aboard ? g.city.stadium.bay : null;
    return targets.reduce((a, b) => (dist(p, a) <= dist(p, b) ? a : b));
  }

  timeLeft() {
    return this.limit - this.elapsed;
  }

  timerLabel() {
    return 'Incident clock';
  }

  result(): MissionResult {
    if (this.status === 'failed') return { merit: 0, lines: [], failReason: this.failReason };
    const left = Math.max(0, Math.round(this.limit - this.elapsed));
    const pen = this.hitPenalty();
    return {
      merit: Math.max(150, 750 + left - pen),
      lines: ['2 smoke inhalation patients treated', '6 residents evacuated to the safety zone', '3 relief drops delivered', `Time left ${fmtTime(left)} +${left}`, ...(pen ? [`Contact with traffic ×${this.carHits} −${pen}`] : [])],
    };
  }

  cleanup() {
    const g = this.g;
    for (const v of [...this.smoke, ...this.evac]) g.victims.remove(v);
    for (const a of this.aid) g.markers.removeBeacon(a.beacon);
    g.markers.clearFires();
    g.markers.clearRoadblocks();
    g.closed.clear();
    g.traffic.density = this.prevDensity;
  }
}

// ---------------------------------------------------------------------------------------------
// Mission catalogue

export interface MissionEntry extends MissionDef {
  create(g: Game): Mission;
}

const trainingSpot = (g: Game, dx: number): { pos: Vec2; road: Vec2 } => {
  const b = g.city.training.block;
  return { pos: { x: b.x0 + 30 + dx, z: b.z1 - 16 }, road: g.city.training.bay };
};

export const MISSIONS: MissionEntry[] = [
  {
    id: 'evoc',
    title: 'EVOC Driving Course',
    kind: 'training',
    blurb: 'Emergency Vehicle Operator Course. Lights-and-siren run through 14 checkpoints with a sensor dummy on the stretcher.',
    requires: [],
    grants: 'evoc',
    reward: 150,
    create: (g) => new CourseMission(g),
  },
  {
    id: 'responder',
    title: 'First Responder Course',
    kind: 'training',
    blurb: 'Triage three training dummies: allergic reaction, asthma and a bleeding wound. Check the signs, pick the right gear, place it precisely.',
    requires: [],
    grants: 'responder',
    reward: 120,
    create: (g) =>
      new CareMission(g, {
        id: 'responder',
        title: 'First Responder Course',
        intro: 'Instructor: “Three dummies, three emergencies. Check their signs before you reach for gear.” Walk up to each and press E.',
        atTraining: true,
        training: true,
        cert: 'responder',
        timeLimit: null,
        par: 0,
        reward: 120,
        victims: [
          { condition: 'anaphylaxis', ...trainingSpot(g, 0), name: 'Dummy A', age: 9, child: true, scene: 'Training: collapsed after a snack', dest: 'none', training: true },
          { condition: 'asthma', ...trainingSpot(g, 8), name: 'Dummy B', age: 24, pose: 'sitting', scene: 'Training: short of breath', dest: 'none', training: true },
          { condition: 'trauma', ...trainingSpot(g, 16), name: 'Dummy C', age: 45, scene: 'Training: glass door accident', dest: 'none', training: true },
        ],
      }),
  },
  {
    id: 'als',
    title: 'ALS & AED Course',
    kind: 'training',
    blurb: 'Advanced Life Support. Place defibrillator pads and time the shock on a cardiac arrest manikin. Unlocks the AED.',
    requires: ['responder'],
    grants: 'als',
    reward: 150,
    create: (g) =>
      new CareMission(g, {
        id: 'als',
        title: 'ALS & AED Course',
        intro: 'Instructor: “No pulse, no breathing — pads on, charge, everyone clear, shock.” The AED is on your wheel for this course.',
        atTraining: true,
        training: true,
        cert: 'als',
        timeLimit: null,
        par: 0,
        reward: 150,
        victims: [{ condition: 'cardiac', ...trainingSpot(g, 8), name: 'Manikin', age: 55, scene: 'Training: cardiac arrest', dest: 'none', training: true }],
      }),
  },
  {
    id: 'anaphylaxis',
    title: 'Anaphylaxis Emergency',
    kind: 'scenario',
    blurb: 'A child at Maple Park ate something with peanuts at a picnic. Find them with the beacon, give epinephrine, then take them to St. Grace.',
    requires: ['responder'],
    reward: 300,
    create: (g) => {
      const park = g.city.blocks[1][1];
      const cx = (park.x0 + park.x1) / 2;
      return new CareMission(g, {
        id: 'anaphylaxis',
        title: 'Anaphylaxis Emergency',
        intro: 'Dispatch: child in distress at the Maple Park picnic area — possible allergic reaction. Parents are with them.',
        timeLimit: 170,
        par: 90,
        reward: 300,
        victims: [
          {
            condition: 'anaphylaxis',
            pos: { x: cx + 4, z: park.z1 - 5 },
            road: { x: cx + 4, z: (park.bj + 1) * P - LANE },
            child: true,
            name: 'Maya',
            age: 8,
            pose: 'sitting',
            scene: 'Child in distress at the picnic area',
            dest: 'stgrace',
            stability: 72,
          },
        ],
      });
    },
  },
  {
    id: 'traumaDash',
    title: 'Trauma Center Dash',
    kind: 'scenario',
    blurb: 'Rush hour. A farm worker in remote Pinecrest Hollow is bleeding badly. Control the bleeding, then cross the whole city to Metro Trauma Center.',
    requires: ['evoc', 'responder'],
    reward: 420,
    create: (g) => {
      const s = curbSpot(g.city.blocks[0][9], 0, 0.6);
      return new CareMission(g, {
        id: 'traumaDash',
        title: 'Trauma Center Dash',
        intro: 'Dispatch: serious laceration at a farm in Pinecrest Hollow. Patient needs a surgeon — Metro Trauma Center only. It’s rush hour.',
        timeLimit: 260,
        par: 170,
        traffic: 2.1,
        reward: 420,
        victims: [{ condition: 'trauma', pos: s.walk, road: s.road, name: 'Eli Brandt', age: 37, scene: 'Farm worker with a deep laceration', dest: 'metro', stability: 68 }],
      });
    },
  },
  {
    id: 'codeBlue',
    title: 'Code Blue Downtown',
    kind: 'scenario',
    blurb: 'Someone collapsed outside an office tower. Every second without a shock counts — pads, clear, shock, then transport.',
    requires: ['als'],
    reward: 450,
    create: (g) => {
      const s = curbSpot(g.city.blocks[5][4], 2, 0.45);
      return new CareMission(g, {
        id: 'codeBlue',
        title: 'Code Blue Downtown',
        intro: 'Dispatch: adult down outside an office tower on 5th — not breathing. Bystander CPR in progress.',
        timeLimit: 150,
        par: 80,
        reward: 450,
        victims: [{ condition: 'cardiac', pos: s.walk, road: s.road, name: 'Gordon Hale', age: 58, scene: 'Adult collapsed outside an office tower', dest: 'hospital', stability: 75 }],
      });
    },
  },
  {
    id: 'organ',
    title: 'Organ Convoy',
    kind: 'scenario',
    blurb: 'Escort a donor heart from St. Grace to Metro Trauma. The van can’t use a siren — you clear intersections and shove debris aside.',
    requires: ['evoc'],
    reward: 500,
    create: (g) => new EscortMission(g),
  },
  {
    id: 'disaster',
    title: 'Community Disaster Response',
    kind: 'scenario',
    blurb: 'Chemical fire in Ironworks. Treat smoke victims, shuttle six residents to the Civic Stadium safety zone and drop relief supplies.',
    requires: ['evoc', 'responder'],
    reward: 750,
    create: (g) => new DisasterMission(g),
  },
];

// ---------------------------------------------------------------------------------------------
// Emergent calls

const FIRST = ['Alex', 'Jordan', 'Priya', 'Tomás', 'Aisha', 'Chen', 'Noa', 'Kwame', 'Ingrid', 'Mateo', 'Yuki', 'Fatima', 'Owen', 'Leila', 'Ravi', 'Sofia'];
const LAST = ['Rivera', 'Singh', 'Kowalski', 'Nguyen', 'Adeyemi', 'Hart', 'Moreau', 'Silva', 'Brooks', 'Tanaka', 'Haddad', 'Lindqvist'];

const SCENES: Record<Exclude<ConditionId, 'evacuee' | 'smoke'>, string[]> = {
  asthma: ['Jogger struggling to breathe', 'Student wheezing at a bus stop', 'Shopper short of breath'],
  hypoglycemia: ['Confused cyclist', 'Office worker acting disoriented', 'Delivery driver sweating and dazed'],
  trauma: ['Fall from a ladder, heavy bleeding', 'Cut from a shattered shop window', 'Skateboarder with a deep gash'],
  anaphylaxis: ['Diner with a swelling face', 'Bee sting, throat tightening', 'Allergic reaction at a food stall'],
  cardiac: ['Person collapsed on the sidewalk', 'Man down outside a gym', 'Woman collapsed at a crosswalk'],
};

export interface CallOffer {
  cfg: CareConfig;
  pos: Vec2;
  label: string;
}

/** Makes a random street emergency somewhere in town, away from the player. */
export function makeCall(g: Game, r: Rng, hasAls: boolean): CallOffer {
  const conds: Exclude<ConditionId, 'evacuee' | 'smoke'>[] = ['asthma', 'hypoglycemia', 'trauma', 'anaphylaxis', 'asthma', 'trauma'];
  if (hasAls) conds.push('cardiac');
  const cond = pick(r, conds);
  const p = g.playerPos();
  let spot = curbSpot(g.city.blocks[4][4], 0, 0.5);
  for (let tries = 0; tries < 30; tries++) {
    const bi = irange(r, 0, N - 1);
    const bj = irange(r, 0, N - 1);
    const z = zoneAt(bi, bj);
    if (z === 'hospital' || z === 'training' || z === 'stadium') continue;
    const s = curbSpot(g.city.blocks[bi][bj], irange(r, 0, 3), range(r, 0.2, 0.8));
    const d = dist(p, s.road);
    if (d < 150 || d > 650) continue;
    spot = s;
    break;
  }
  const c = CONDITIONS[cond];
  const scene = pick(r, SCENES[cond]);
  const d = dist(p, spot.road);
  const limit = Math.round(75 + d / 9 + (c.transport ? 70 : 0));
  const reward = Math.round(70 + d / 8 + (c.transport ? 60 : 0) + (cond === 'cardiac' ? 60 : 0));
  const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
  const area = districtAt(g.city, spot.walk.x, spot.walk.z);
  return {
    pos: spot.road,
    label: `${scene} — ${area}`,
    cfg: {
      id: 'call',
      title: 'Street call',
      intro: `Responding: ${scene.toLowerCase()} in ${area}.`,
      emergent: true,
      timeLimit: limit,
      par: Math.round(limit * 0.6),
      reward,
      victims: [
        {
          condition: cond,
          pos: spot.walk,
          road: spot.road,
          pose: cond === 'asthma' || cond === 'hypoglycemia' ? 'sitting' : 'lying',
          name,
          age: irange(r, 16, 82),
          scene,
          dest: c.transport ? 'hospital' : 'none',
          stability: range(r, 62, 80),
        },
      ],
    },
  };
}

export const missionById = (id: string) => MISSIONS.find((m) => m.id === id);
