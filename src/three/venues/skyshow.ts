/*
 * The sky show over the open-air venues:
 *   - a drone light show: hundreds of drones behind the stage that fly from
 *     formation to formation (a grid, a sphere turning, a ring pulsing on the
 *     beat, your DJ name, a heart, a star), at the peak of the night, after
 *     dark, or from the Show tab;
 *   - fireworks for the finale (the last track at the festival, the beach and
 *     the boat, or the pad): shells climb and burst into spheres of sparks
 *     that fall and fade, a volley on every drop.
 * Both follow Reduce flashing (no bursts brighter than the rest, slower volleys).
 */
import * as THREE from 'three';
import { nameService } from '../../name/NameService';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';

/** what's asked of the sky (the app and the Show tab set it) */
export const skyCue = {
  /** the drone show: auto (the peak, after dark), on or off */
  drones: 'auto' as 'auto' | 'on' | 'off',
  /** fireworks running until this many seconds from now */
  fireworksFor: 0,
  /** a volley right now (a pad press) */
  volley: 0,
  /** fireworks from the pad: anywhere under the open sky, for this many seconds */
  padFor: 0,
};

export const DRONES = 360;
const SPARKS = 3000;

export type Formation = 'grid' | 'sphere' | 'ring' | 'name' | 'heart' | 'star';
export const FORMATIONS: Formation[] = ['grid', 'sphere', 'ring', 'name', 'heart', 'star'];

/** points of a formation, in a unit box (x -1..1, y -1..1, z small), for n drones */
export function formation(kind: Formation, n: number, t: number, beat: number, name = 'DJ'): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const pulse = 1 + 0.12 * Math.pow(1 - (((beat % 1) + 1) % 1), 3);
  if (kind === 'grid') {
    const cols = Math.ceil(Math.sqrt(n * 2));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) out.push(new THREE.Vector3(((i % cols) / (cols - 1)) * 2 - 1, (Math.floor(i / cols) / Math.max(1, rows - 1)) * 1.2 - 0.6, Math.sin(i * 0.3 + t) * 0.05));
  } else if (kind === 'sphere') {
    const g = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const a = i * g + t * 0.4;
      out.push(new THREE.Vector3(Math.cos(a) * r * 0.7, y * 0.7, Math.sin(a) * r * 0.7));
    }
  } else if (kind === 'ring') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const band = i % 3;
      const r = (0.45 + band * 0.18) * pulse;
      out.push(new THREE.Vector3(Math.cos(a + t * (band - 1) * 0.3) * r, Math.sin(a + t * (band - 1) * 0.3) * r, 0));
    }
  } else if (kind === 'heart' || kind === 'star') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let x: number;
      let y: number;
      if (kind === 'heart') {
        x = 16 * Math.pow(Math.sin(a), 3) / 17;
        y = (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17;
      } else {
        const k = Math.floor((i / n) * 10);
        const f = (i / n) * 10 - k;
        const p0 = starPoint(k);
        const p1 = starPoint(k + 1);
        x = p0[0] + (p1[0] - p0[0]) * f;
        y = p0[1] + (p1[1] - p0[1]) * f;
      }
      out.push(new THREE.Vector3(x * 0.8 * pulse, y * 0.8 * pulse, 0));
    }
  } else {
    const pts = textPoints(name, n);
    for (let i = 0; i < n; i++) out.push(pts[i % pts.length].clone());
  }
  return out;
}

function starPoint(k: number): [number, number] {
  const a = Math.PI / 2 + (k * Math.PI) / 5;
  const r = k % 2 ? 0.42 : 1;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

const textCache = new Map<string, THREE.Vector3[]>();

/** points spread over the letters of a word (sampled from the text drawn on a canvas) */
export function textPoints(text: string, n: number): THREE.Vector3[] {
  const key = `${text}|${n}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const pts: THREE.Vector3[] = [];
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 100;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = 86;
      g.font = `900 ${size}px "Barlow Condensed", sans-serif`;
      const w = g.measureText(text).width;
      if (w > 380) {
        size *= 380 / w;
        g.font = `900 ${size}px "Barlow Condensed", sans-serif`;
      }
      g.fillText(text, 200, 52);
      const d = g.getImageData(0, 0, 400, 100).data;
      const lit: [number, number][] = [];
      for (let y = 0; y < 100; y += 2) for (let x = 0; x < 400; x += 2) if (d[(y * 400 + x) * 4 + 3] > 128) lit.push([x, y]);
      for (let i = 0; i < n && lit.length; i++) {
        const [x, y] = lit[Math.floor((i / n) * lit.length)];
        pts.push(new THREE.Vector3((x / 200 - 1) * 1, (1 - y / 50) * 0.25, 0));
      }
    }
  }
  if (!pts.length) for (let i = 0; i < n; i++) pts.push(new THREE.Vector3((i / n) * 2 - 1, 0, 0));
  textCache.set(key, pts);
  return pts;
}

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class SkyShow implements Fixture {
  readonly object = new THREE.Group();
  private drones: THREE.Points;
  private dronePos: Float32Array;
  private droneCol: Float32Array;
  private sparks: THREE.Points;
  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private nextSpark = 0;
  private shells: { p: THREE.Vector3; v: THREE.Vector3; fuse: number; col: THREE.Color }[] = [];
  private droneK = 0;
  private t = 0;
  private formAt = 0;
  private form = 0;
  private launchT = 0;
  private col = new THREE.Color();

  constructor(
    private center: THREE.Vector3,
    private scale: number,
    /** fireworks here (the finale) */
    private fireworks: boolean,
    /** 0..1: how dark the sky is now (drones only show after dark) */
    private night: () => number,
  ) {
    const tex = dotTexture();
    this.dronePos = new Float32Array(DRONES * 3);
    this.droneCol = new Float32Array(DRONES * 3);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dronePos, 3));
    dg.setAttribute('color', new THREE.BufferAttribute(this.droneCol, 3));
    this.drones = new THREE.Points(dg, new THREE.PointsMaterial({ size: 1.6 * scale, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false, toneMapped: false }));
    this.drones.frustumCulled = false;
    this.drones.visible = false;
    this.object.add(this.drones);
    // the drones wait on the ground behind the stage, in a grid
    const grid = formation('grid', DRONES, 0, 0);
    for (let i = 0; i < DRONES; i++) this.dronePos.set([center.x + grid[i].x * 30 * scale, center.y - 50 * scale, center.z + grid[i].y * 10], i * 3);
    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkCol = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.3 * scale, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    this.sparks.frustumCulled = false;
    this.object.add(this.sparks);
  }

  private burst(p: THREE.Vector3, col: THREE.Color, safe: boolean): void {
    const n = safe ? 90 : 160;
    for (let k = 0; k < n; k++) {
      const i = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % SPARKS;
      // a sphere of sparks
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = (14 + Math.random() * 4) * this.scale;
      this.sparkPos.set([p.x, p.y, p.z], i * 3);
      this.sparkVel.set([Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp], i * 3);
      this.sparkLife[i] = 1.6 + Math.random() * 0.9;
      const c = k % 7 === 0 ? this.col.setRGB(1, 0.95, 0.8) : col;
      this.sparkCol.set([c.r, c.g, c.b], i * 3);
    }
  }

  private launch(s: ShowState): void {
    const x = this.center.x + (Math.random() - 0.5) * 60 * this.scale;
    const col = s.colors[Math.floor(Math.random() * 3)].clone().lerp(new THREE.Color(1, 1, 1), 0.15);
    this.shells.push({ p: new THREE.Vector3(x, this.center.y - 50 * this.scale, this.center.z + (Math.random() - 0.5) * 20), v: new THREE.Vector3((Math.random() - 0.5) * 4, (34 + Math.random() * 8) * Math.sqrt(this.scale), 0), fuse: 1.6 + Math.random() * 0.5, col });
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const safe = s.reduceFlash;
    // ---- drones ----
    const night = this.night();
    const want = skyCue.drones === 'on' ? 1 : skyCue.drones === 'off' ? 0 : s.playing && night > 0.6 && (s.peak > 0.5 || s.hype > 0.82) ? 1 : 0;
    this.droneK += (want - this.droneK) * Math.min(1, dt * (want ? 0.25 : 0.4));
    this.drones.visible = this.droneK > 0.01;
    if (this.drones.visible) {
      // a new formation every 8 bars (32 beats)
      const seg = Math.floor(s.beat / 32);
      if (seg !== this.formAt) {
        this.formAt = seg;
        this.form = (this.form + 1) % FORMATIONS.length;
      }
      const kind = FORMATIONS[this.form];
      const target = formation(kind, DRONES, this.t, s.beat, (nameService.text || 'DECKHOUSE').toUpperCase());
      const W = 34 * this.scale;
      const lift = (1 - this.droneK) * 50 * this.scale;
      const k = Math.min(1, dt * 1.2);
      for (let i = 0; i < DRONES; i++) {
        const tp = target[i];
        const x = this.center.x + tp.x * W;
        const y = this.center.y + tp.y * W - lift;
        const z = this.center.z + tp.z * W;
        this.dronePos[i * 3] += (x - this.dronePos[i * 3]) * k;
        this.dronePos[i * 3 + 1] += (y - this.dronePos[i * 3 + 1]) * k;
        this.dronePos[i * 3 + 2] += (z - this.dronePos[i * 3 + 2]) * k;
        // colour: the show's colours across the formation, the beat brightening them
        const c = s.colors[kind === 'name' ? 0 : Math.floor(((tp.x + 1) / 2) * 2.99)];
        const glow = (0.5 + 0.5 * Math.pow(1 - (((s.beat % 1) + 1) % 1), 2) * (safe ? 0.3 : 1)) * this.droneK;
        this.droneCol[i * 3] = c.r * glow;
        this.droneCol[i * 3 + 1] = c.g * glow;
        this.droneCol[i * 3 + 2] = c.b * glow;
      }
      (this.drones.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.drones.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    // ---- fireworks ----
    skyCue.fireworksFor = Math.max(0, skyCue.fireworksFor - dt);
    skyCue.padFor = Math.max(0, skyCue.padFor - dt);
    const on = (this.fireworks && skyCue.fireworksFor > 0) || skyCue.padFor > 0;
    if (on || skyCue.volley > 0) {
      this.launchT -= dt;
      const rate = safe ? 1.1 : 0.45;
      if (this.launchT <= 0) {
        this.launch(s);
        this.launchT = rate * (0.6 + Math.random() * 0.8);
      }
      if (s.dropHit || skyCue.volley > 0) for (let k = 0; k < (safe ? 3 : 7); k++) this.launch(s);
      skyCue.volley = 0;
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.v.y -= 9.8 * dt;
      sh.p.addScaledVector(sh.v, dt);
      sh.fuse -= dt;
      if (sh.fuse <= 0) {
        this.burst(sh.p, sh.col, safe);
        this.shells.splice(i, 1);
      }
    }
    let alive = this.shells.length > 0;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      alive = true;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 4.5 * dt;
      const drag = Math.exp(-dt * 1.4);
      this.sparkVel[i * 3] *= drag;
      this.sparkVel[i * 3 + 1] *= drag;
      this.sparkVel[i * 3 + 2] *= drag;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      const fade = Math.max(0, Math.min(1, this.sparkLife[i] / 1.2));
      this.sparkCol[i * 3] *= fade < 1 ? 0.98 : 1;
      this.sparkCol[i * 3 + 1] *= fade < 1 ? 0.97 : 1;
      this.sparkCol[i * 3 + 2] *= fade < 1 ? 0.96 : 1;
      if (this.sparkLife[i] <= 0) this.sparkPos[i * 3 + 1] = -1e4;
    }
    // the shells' trails ride as sparks too: one bright point per shell
    for (const sh of this.shells) {
      const i = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % SPARKS;
      this.sparkPos.set([sh.p.x, sh.p.y, sh.p.z], i * 3);
      this.sparkVel.set([0, 0, 0], i * 3);
      this.sparkLife[i] = 0.35;
      this.sparkCol.set([1, 0.8, 0.5], i * 3);
    }
    this.sparks.visible = alive;
    if (alive) {
      (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.sparks.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.drones.geometry.dispose();
    this.sparks.geometry.dispose();
    (this.drones.material as THREE.PointsMaterial).map?.dispose();
    (this.drones.material as THREE.Material).dispose();
    (this.sparks.material as THREE.Material).dispose();
  }
}
