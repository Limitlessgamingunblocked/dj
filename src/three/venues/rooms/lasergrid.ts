/*
 * The Laser Grid Room: pitch black, with a grid of beams across the dance
 * floor that people break. Where a beam meets someone it stops on them with a
 * bright dot, and each new break plays a note in the track's key.
 *
 * Safety, as in every venue here: real lasers stay 3 m above people. The grid
 * at body height is narrow light beams (LED light through haze, like a light
 * curtain), not laser light; the room's only lasers fan out overhead.
 *
 *   modes    grid, diagonal, scanner (rows sweep down the room), waves (the
 *            heights follow the melody)
 *   pads     cage (hold: the beams close round the booth), scan, rainbow,
 *            mute the notes, raise (hold: over everyone's heads)
 *   moments  cage (big), scan (big), rise (deep)
 *   stems    the beams' brightness follows the drums, the overhead fan the
 *            vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import { crowdArea, Lasers } from '../fixtures';
import type { CrowdSpot } from '../crowd';
import type { ShowState } from '../show';
import { CrazyRoom, V, roomShow, type RoomAction, type RoomMoment } from './kit';

const W = 8;
const H = 5;
const D = 16;
const ROWS = 10;
const MAX_SEG = 120;
const MAX_DOTS = 80;
/** a body blocks a beam inside this distance of it (m) */
const BODY = 0.2;

/** the scale steps for a key: minor or major pentatonic, so any break sounds right */
export function scaleNote(tonic: number, minor: boolean, step: number): number {
  const pent = minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const oct = Math.floor(step / 5);
  return 60 + tonic + pent[((step % 5) + 5) % 5] + 12 * oct;
}

/** where a beam from a to b (on the floor plan) is blocked by people: the lit pieces, and the points it hits */
export function splitBeam(ax: number, bx: number, z: number, bodies: { x: number; z: number }[], body = BODY): { segs: [number, number][]; hits: number[] } {
  const lo = Math.min(ax, bx);
  const hi = Math.max(ax, bx);
  const cuts = bodies.filter((p) => Math.abs(p.z - z) < body && p.x > lo && p.x < hi).map((p) => p.x).sort((a, b) => a - b);
  const segs: [number, number][] = [];
  const hits: number[] = [];
  let x = lo;
  for (const c of cuts) {
    if (c - body > x) {
      segs.push([x, c - body]);
      hits.push(c - body);
    }
    x = Math.max(x, c + body);
    if (x < hi) hits.push(x);
  }
  if (x < hi) segs.push([x, hi]);
  return { segs, hits };
}

class LaserGrid extends CrazyRoom {
  readonly modes = ['Grid', 'Diagonal', 'Scanner', 'Waves'];
  readonly actions: RoomAction[] = [
    { id: 'cage', label: 'Cage', kind: 'hold' },
    { id: 'scan', label: 'Scan', kind: 'hit' },
    { id: 'rainbow', label: 'Rainbow', kind: 'toggle' },
    { id: 'mute', label: 'Mute notes', kind: 'toggle' },
    { id: 'raise', label: 'Raise', kind: 'hold' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'cage', label: 'The beams close into a cage round the booth', energy: 'big' },
    { id: 'scan', label: 'A wall of light sweeps the room', energy: 'big' },
    { id: 'rise', label: 'The grid lifts over the crowd', energy: 'deep' },
  ];
  private beams: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private dots: THREE.InstancedMesh;
  private bodies: CrowdSpot[];
  private broken = new Set<string>();
  private lastNote = 0;
  private cage = 0;
  private rise = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private c = new THREE.Color();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    super({ roomId: 'lasergrid', roomName: 'Laser Grid Room', w: W, h: H, d: D, back: 3, fog: 0x010103, fogDensity: 0.03, hemi: 0.05, booth: { strip: '#3dff7a' } });
    this.ambient = 0.15;
    const black = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), black);
    black.side = THREE.BackSide;
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.beams = new THREE.InstancedMesh(cyl, beamMat, MAX_SEG);
    this.glow = new THREE.InstancedMesh(cyl, glowMat, MAX_SEG);
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_DOTS);
    for (const m of [this.beams, this.glow, this.dots]) {
      m.frustumCulled = false;
      m.count = 0;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
    }
    // the only lasers: a fan overhead, kept 3 m above the crowd
    this.add(
      new Lasers([{ pos: V(0, H - 0.3, -D + 0.6), dir: V(0, -0.02, 1), beams: 16, length: 30 }], {
        room: { floorY: 0, x0: -W, x1: W, z0: -D, z1: 3, ceilY: H },
        audience: { floorY: 0, x0: -W, x1: W, z0: -D, z1: -1 },
        haze: [0.5, H],
      }),
    );
    // the beams know where everyone stands: the crowd is built from the same spots
    this.bodies = crowdArea(this.x0 + 1, this.x1 - 1, -1.8, this.z0 + 1.4, 0.75, 1501);
    this.people(0, 1501, { spots: this.bodies, phones: 0.15, clothes: ['#f2f2f2', '#101114', '#2b2d33', '#d8d0c0', '#16171a', '#3dff7a'] }).uv = 0.25;
  }

  private seg(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, col: THREE.Color): void {
    this.a.set(ax, ay, az);
    this.b.set(bx, by, bz);
    const len = this.a.distanceTo(this.b);
    this.q.setFromUnitVectors(this.up, this.b.clone().sub(this.a).normalize());
    this.m4.compose(this.a.add(this.b).multiplyScalar(0.5), this.q, new THREE.Vector3(r, len, r));
    this.beams.setMatrixAt(i, this.m4);
    this.beams.setColorAt(i, col);
    this.m4.compose(this.a, this.q, new THREE.Vector3(r * 6, len, r * 6));
    this.glow.setMatrixAt(i, this.m4);
    this.glow.setColorAt(i, col);
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const mode = this.look.mode;
    const t = this.time;
    const cageWant = Math.max(this.on('cage') ? 1 : 0, this.momentK('cage'));
    this.cage += (cageWant - this.cage) * Math.min(1, dt * 3);
    const riseWant = Math.max(this.on('raise') ? 1 : 0, this.momentK('rise'));
    this.rise += (riseWant - this.rise) * Math.min(1, dt * 1.5);
    const level = (0.35 + this.drive.floor * 1.4) * (0.4 + 0.6 * s.master);
    const scanAt = this.since('scan') < 2 ? this.since('scan') / 2 : this.moment?.id === 'scan' ? (this.moment.t % 2) / 2 : -1;
    let n = 0;
    let dn = 0;
    const nowBroken = new Set<string>();
    const rainbow = this.on('rainbow');
    for (let r = 0; r < ROWS && n < MAX_SEG - 8; r++) {
      // where this row's beam runs
      let z = -2.2 - r * ((D - 4) / ROWS);
      if (mode === 2) z = -2.2 - (((r / ROWS + t * 0.05) % 1) * (D - 4));
      let y = [0.95, 1.35, 1.7][r % 3];
      if (mode === 3) y = 1.3 + 0.45 * Math.sin(t * 1.2 + r * 0.7) * (0.4 + (this.parts?.melody ?? 0.5));
      y += this.rise * (2.4 - y + (r % 3) * 0.2);
      const slant = mode === 1 ? (r % 2 ? 1 : -1) * 3 : 0;
      this.c.copy(rainbow ? new THREE.Color().setHSL((r / ROWS + t * 0.1) % 1, 1, 0.55) : this.cols[r % 2 ? 1 : 0]);
      // a scan pulse: the beam it's passing lights up
      const pulse = scanAt >= 0 ? Math.exp(-Math.pow((r / ROWS - scanAt) * 6, 2)) * 2 : 0;
      this.c.multiplyScalar((level + pulse) * (1 - this.cage) * 1.6);
      const ax = this.x0 + 0.2;
      const bx = this.x1 - 0.2;
      // a slanted beam's z changes along it: test bodies against the line's z at their x
      const bodies = slant ? this.bodies.map((p) => ({ x: p.x, z: p.z - (slant * (p.x - ax)) / (bx - ax) })) : this.bodies;
      const { segs, hits } = this.rise > 0.5 ? { segs: [[ax, bx] as [number, number]], hits: [] as number[] } : splitBeam(ax, bx, z, bodies);
      for (const [x0, x1] of segs) {
        if (n >= MAX_SEG) break;
        const z0 = z + (slant * (x0 - ax)) / (bx - ax);
        const z1 = z + (slant * (x1 - ax)) / (bx - ax);
        this.seg(n++, x0, y, z0, x1, y, z1, 0.008, this.c);
      }
      for (const hx of hits) {
        if (dn >= MAX_DOTS) break;
        const hz = z + (slant * (hx - ax)) / (bx - ax);
        this.m4.compose(V(hx, y, hz), this.q.identity(), new THREE.Vector3(0.035, 0.035, 0.035));
        this.dots.setMatrixAt(dn, this.m4);
        this.dots.setColorAt(dn++, this.c.clone().multiplyScalar(2.5));
        const key = `${r}:${Math.round(hx * 4)}`;
        nowBroken.add(key);
        // a new break: a note in the track's key
        if (!this.broken.has(key) && s.playing && !this.on('mute') && roomShow.sounds && t - this.lastNote > 0.12 && this.cage < 0.5) {
          this.lastNote = t;
          roomShow.note?.(scaleNote(roomShow.key.tonic, roomShow.key.minor, (r % 5) + Math.floor(y > 1.5 ? 5 : 0)), 0.5);
        }
      }
    }
    this.broken = nowBroken;
    // the cage: upright bars of light in a ring round the booth
    if (this.cage > 0.02) {
      const bars = 24;
      const cc = this.c.copy(this.cols[0]).multiplyScalar(this.cage * (1 + s.kick) * 1.6);
      for (let i = 0; i < bars && n < MAX_SEG; i++) {
        const a = Math.PI + (i / (bars - 1)) * Math.PI;
        const rr = 2.6 + (1 - this.cage) * 6;
        const x = Math.cos(a) * rr;
        const z = 0.2 + Math.sin(a) * rr;
        this.seg(n++, x, 0.05, z, x, 3.6 + this.cage * 1, z, 0.012, cc);
      }
    }
    this.beams.count = n;
    this.glow.count = n;
    this.dots.count = dn;
    for (const m of [this.beams, this.glow, this.dots]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.lookUp = Math.max(this.rise, this.cage * 0.4);
  }
}

export const laserGrid: VenueDef = {
  id: 'lasergrid',
  name: 'Laser Grid Room',
  short: 'Laser Grid',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Pitch black, with a grid of beams the crowd dances through. Every break plays a note in key.',
  palette: ['#3dff7a', '#ff2e88', '#3dd6ff'],
  ui: '#3dff7a',
  capacity: '180',
  build: () => new LaserGrid(),
  thumb(g, w, h) {
    g.fillStyle = '#010103';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      g.strokeStyle = i % 2 ? '#ff2e88' : '#3dff7a';
      g.globalAlpha = 0.9;
      g.lineWidth = 1.5;
      const y = h * (0.35 + i * 0.07);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w * 0.3 + i * 9, y);
      g.moveTo(w * 0.36 + i * 9, y);
      g.lineTo(w, y);
      g.stroke();
      g.fillStyle = '#ffffff';
      g.fillRect(w * 0.3 + i * 9, y - 1.5, 3, 3);
    }
    g.globalAlpha = 1;
  },
};
