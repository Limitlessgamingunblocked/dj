/*
 * Interactive 3D hardware parts. Each part is bound to a registry control id
 * (side tokens deck.L / deck.R resolve through the active deck layer), reads
 * its visual state every frame and turns pointer gestures into control input.
 *
 * Board space: metres, +X right, +Y up, +Z towards the DJ.
 */
import type { LibraryBrowser } from './deviceScreen';
import * as THREE from 'three';
import { faderCapGeometry, grooves, knurledKnob, lathe, mergePieces, place, type Piece } from './realism';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ControlRegistry } from '../core/controls';
import { ledColor } from '../core/controls';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Deck } from '../audio/Deck';
import { nearEnd } from '../core/prefs';
import { clamp } from '../core/util';
import { discUV, fingerprintRoughness, knurlNormal, mats, RECORD_R, slipmatTexture, strobeTexture, vinylMaps, wornCapRoughness } from './materials';

export type DeckRef = 'L' | 'R' | number;

export interface PartCtx {
  reg: ControlRegistry;
  engine: AudioEngine;
  deck(ref: DeckRef): Deck;
  levels(ch: number): [number, number];
  master(): [number, number];
  now: number;
  dt: number;
  frame: number;
  accent: string;
  /** the track library, for a board whose screen browses it (null until the app supplies it) */
  browser: LibraryBrowser | null;
}

export interface PointerInfo {
  ray: THREE.Ray;
  point: THREE.Vector3; // world hit point at pointer down
  object: THREE.Object3D; // mesh hit at pointer down
  dx: number;
  dy: number;
  shift: boolean;
}

const tmpV = new THREE.Vector3();
const plane = new THREE.Plane();
const RING_OFF = new THREE.Color(0x15171b);

export function planeHit(ray: THREE.Ray, worldY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
  plane.set(new THREE.Vector3(0, 1, 0), -worldY);
  return ray.intersectPlane(plane, out);
}

export abstract class Part {
  readonly object = new THREE.Group();
  readonly hit: THREE.Object3D[] = [];
  id: string | null = null;
  alt: string | null = null; // control used while SHIFT is held
  label = '';
  cursor = 'pointer';
  flash = 0;

  constructor() {
    this.object.userData.part = this;
  }

  /** control id for the current shift state */
  control(reg: ControlRegistry): string | null {
    return reg.shift && this.alt ? this.alt : this.id;
  }

  protected addHit(o: THREE.Object3D): void {
    o.userData.part = this;
    this.hit.push(o);
  }

  update(_c: PartCtx): void {}

  /** where a hand takes hold of this part (world space): a little above it, by default */
  grip(out: THREE.Vector3): THREE.Vector3 {
    return this.object.localToWorld(out.set(0, 0.025, 0));
  }

  down?(p: PointerInfo, c: PartCtx): void;
  move?(p: PointerInfo, c: PartCtx): void;
  up?(p: PointerInfo, c: PartCtx): void;
  wheel?(delta: number, c: PartCtx): void;
  double?(c: PartCtx): void;
  valueText?(c: PartCtx): string;
}

function surfaceWorldY(o: THREE.Object3D, localY: number): number {
  tmpV.set(0, localY, 0);
  o.localToWorld(tmpV);
  return tmpV.y;
}

function setEmissive(m: THREE.MeshStandardMaterial, color: string, level: number, gain = 2.2): void {
  m.emissive.set(color);
  // white (and near-white) LEDs carry all three channels at once: at the same gain they burn out
  // into a blob that hides the button, so they glow at about half the gain of coloured ones
  const e = m.emissive;
  const white = Math.min(e.r, e.g, e.b) / Math.max(e.r, e.g, e.b, 1e-4);
  m.emissiveIntensity = level * gain * (1 - 0.5 * white * white);
}

/* ------------------------------------------------------------------ */
/* knob                                                                 */
/* ------------------------------------------------------------------ */

const latheCache = new Map<string, THREE.LatheGeometry>();
function knobGeometry(r: number, h: number): THREE.LatheGeometry {
  const k = `${r}|${h}`;
  let g = latheCache.get(k);
  if (g) return g;
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r * 1.08, 0),
    new THREE.Vector2(r * 1.08, h * 0.18),
    new THREE.Vector2(r, h * 0.24),
    new THREE.Vector2(r * 0.97, h * 0.82),
    new THREE.Vector2(r * 0.9, h),
    new THREE.Vector2(0, h),
  ];
  g = new THREE.LatheGeometry(pts, 40);
  latheCache.set(k, g);
  return g;
}

export type KnobStyle = 'rubber' | 'chrome' | 'cap' | 'mini';

/** the controls a DJ turns most: their knobs show it */
const WORN_KNOBS = /^(ch\.\d+\.(hi|mid|low|filter|trim)|mixer\.master|fx\.depth|deck\.\w+\.color)$/;

export class KnobPart extends Part {
  private spin = new THREE.Group();
  private ring: THREE.InstancedMesh | null = null;
  private ringValue = -1;
  private ringOn: THREE.Color | null = null;
  private encoderAngle = 0;
  private v0 = 0;
  private stepAcc = 0;
  private moved = false;

  constructor(
    id: string,
    label: string,
    private r: number,
    h: number,
    style: KnobStyle,
    capColor: string | null,
    readonly encoder = false,
    ledRing: string | null = null,
  ) {
    super();
    this.id = id;
    this.label = label;
    this.cursor = 'ns-resize';
    const M = mats();
    // the knobs worked all night (EQs, filters, gain, master, FX depth) are rubbed to a sheen where the fingers hold them
    const worn = !encoder && WORN_KNOBS.test(id);
    // knurled for grip: fine metal knurling on chrome knobs, rubber ridges on the rest
    const body = new THREE.Mesh(style === 'chrome' ? knurledKnob(r, h, 60, 0.02) : style === 'mini' ? knobGeometry(r, h) : knurledKnob(r, h, 32, 0.045), style === 'chrome' ? M.chrome : worn ? M.rubberWorn : M.rubber);
    body.castShadow = true;
    this.spin.add(body);
    if (style !== 'chrome') {
      // a satin clear-coated cap: its highlight shows the knob's shape even in a dark room
      const capMat = new THREE.MeshPhysicalMaterial({ color: capColor ?? '#2c3037', roughness: 0.32, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.25, roughnessMap: worn ? wornCapRoughness() : null, clearcoatRoughnessMap: worn ? wornCapRoughness() : null });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.0006, 32), capMat);
      cap.position.y = h + 0.0002;
      this.spin.add(cap);
    }
    // the pointer: a bold line from near the middle to the edge, so the value reads at a glance
    const ind = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.0011, r * 0.2), 0.0008, r * 0.72), style === 'chrome' ? M.black : M.white);
    ind.position.set(0, h + 0.0006, -r * 0.5);
    this.spin.add(ind);
    // side notch line so rotation reads from low camera angles too
    const notch = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, h * 0.6, 0.0008), style === 'chrome' ? M.black : M.white);
    notch.position.set(0, h * 0.55, -r * 0.99);
    this.spin.add(notch);
    this.object.add(this.spin);
    this.addHit(body);
    if (ledRing) {
      const n = 15;
      const geo = new THREE.CircleGeometry(0.0009, 10);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
      this.ring = new THREE.InstancedMesh(geo, mat, n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const a = ((-150 + (i / (n - 1)) * 300) * Math.PI) / 180;
        m.makeTranslation(Math.sin(a) * r * 1.45, 0.0004, -Math.cos(a) * r * 1.45);
        this.ring.setMatrixAt(i, m);
        this.ring.setColorAt(i, new THREE.Color(0x111111));
      }
      this.ring.userData.color = ledRing;
      this.object.add(this.ring);
    }
  }

  update(c: PartCtx): void {
    if (this.encoder) {
      this.spin.rotation.y = this.encoderAngle;
      return;
    }
    const v = c.reg.value(this.id!);
    this.spin.rotation.y = -(v - 0.5) * ((300 * Math.PI) / 180);
    if (this.ring && Math.abs(v - this.ringValue) > 1e-4) {
      // only relight the ring when the value moved
      this.ringValue = v;
      const ctl = c.reg.get(this.id!);
      const center = ctl && ctl.kind === 'continuous' && ctl.center;
      const n = this.ring.count;
      const on = (this.ringOn ??= new THREE.Color(this.ring.userData.color as string));
      const off = RING_OFF;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const lit = center ? (v >= 0.5 ? t >= 0.5 - 1e-6 && t <= v + 1e-6 : t <= 0.5 + 1e-6 && t >= v - 1e-6) : t <= v + 1e-6;
        this.ring.setColorAt(i, lit ? on : off);
      }
      this.ring.instanceColor!.needsUpdate = true;
    }
  }

  down(_p: PointerInfo, c: PartCtx): void {
    this.v0 = c.reg.value(this.id!);
    this.stepAcc = 0;
    this.moved = false;
  }

  move(p: PointerInfo, c: PartCtx): void {
    if (Math.abs(p.dy) > 3 || Math.abs(p.dx) > 3) this.moved = true;
    if (this.encoder) {
      const steps = Math.trunc((-p.dy - this.stepAcc) / 16);
      if (steps !== 0) {
        this.stepAcc += steps * 16;
        const ctl = c.reg.get(this.id!);
        if (ctl && ctl.kind === 'encoder') {
          for (let i = 0; i < Math.abs(steps); i++) ctl.step(Math.sign(steps));
          c.reg.mark(this.id!, 'ui');
        }
        this.encoderAngle -= steps * 0.35;
      }
      return;
    }
    c.reg.setValue(this.id!, this.v0 - p.dy / (p.shift ? 900 : 170), 'ui');
  }

  up(_p: PointerInfo, c: PartCtx): void {
    if (this.encoder && !this.moved) c.reg.press(this.id!, 'ui');
  }

  wheel(delta: number, c: PartCtx): void {
    if (this.encoder) {
      const ctl = c.reg.get(this.id!);
      if (ctl && ctl.kind === 'encoder') ctl.step(delta > 0 ? 1 : -1);
      this.encoderAngle -= Math.sign(delta) * 0.35;
      return;
    }
    c.reg.nudgeValue(this.id!, delta * 0.03, 'ui');
  }

  double(c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl && ctl.kind === 'continuous') c.reg.setValue(this.id!, ctl.def, 'ui');
  }

  valueText(c: PartCtx): string {
    const ctl = c.reg.get(this.id!);
    if (!ctl) return '';
    if (ctl.kind === 'encoder') return ctl.display?.() ?? 'turn / click';
    if (ctl.kind !== 'continuous') return '';
    const v = ctl.get();
    return ctl.format ? ctl.format(v) : `${Math.round(v * 100)}%`;
  }

  get radius(): number {
    return this.r;
  }
}

/* ------------------------------------------------------------------ */
/* fader                                                                */
/* ------------------------------------------------------------------ */

export class FaderPart extends Part {
  private cap: THREE.Mesh;

  /** the cap, where it is now */
  grip(out: THREE.Vector3): THREE.Vector3 {
    return this.cap.localToWorld(out.set(0, this.capTop * 0.5, 0));
  }
  private grab = 0;
  private capTop: number;

  constructor(
    id: string,
    label: string,
    private axis: 'x' | 'z',
    private len: number,
    private maxAtFar: boolean,
    capColor: string | null = null,
    size: 'channel' | 'cross' | 'tempo' | 'mini' = 'channel',
  ) {
    super();
    this.id = id;
    this.label = label;
    this.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
    const M = mats();
    // [across the slot, height, along it]: pro caps are about 20 × 11 × 11 mm, ridged on top
    const dims = { channel: [0.016, 0.0105, 0.0095], cross: [0.015, 0.0105, 0.009], tempo: [0.018, 0.0095, 0.011], mini: [0.0095, 0.0075, 0.007] }[size];
    const [across, h, alongD] = dims;
    const [w, d] = axis === 'x' ? [alongD, across] : [across, alongD];
    const geo = faderCapGeometry(across, h, alongD, size === 'mini' ? 2 : 3).clone();
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    geo.translate(0, -h / 2, 0);
    const mat = capColor ? new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.45, metalness: 0.3 }) : M.faderCap;
    this.cap = new THREE.Mesh(geo, mat);
    this.cap.position.y = h / 2;
    this.cap.castShadow = true;
    const line = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? 0.0018 : w * 0.9, 0.0004, axis === 'x' ? d * 0.9 : 0.0018), M.white);
    line.position.y = h / 2 + h * 0.08 + 0.0002;
    this.cap.add(line);
    this.capTop = h;
    this.object.add(this.cap);
    this.addHit(this.cap);
    // invisible, wider grab area along the slot
    const hitGeo = new THREE.BoxGeometry(axis === 'x' ? len + w : w * 1.3, 0.004, axis === 'x' ? d * 1.3 : len + d);
    const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hitMesh.position.y = 0.002;
    this.object.add(hitMesh);
    this.addHit(hitMesh);
  }

  private along(v: number): number {
    if (this.axis === 'x') return (v - 0.5) * this.len;
    return (this.maxAtFar ? 0.5 - v : v - 0.5) * this.len;
  }

  private valueAt(a: number): number {
    if (this.axis === 'x') return a / this.len + 0.5;
    return this.maxAtFar ? 0.5 - a / this.len : a / this.len + 0.5;
  }

  update(c: PartCtx): void {
    const a = this.along(c.reg.value(this.id!));
    if (this.axis === 'x') this.cap.position.x = a;
    else this.cap.position.z = a;
  }

  private localAlong(ray: THREE.Ray): number | null {
    const hit = planeHit(ray, surfaceWorldY(this.object, this.capTop));
    if (!hit) return null;
    this.object.worldToLocal(hit);
    return this.axis === 'x' ? hit.x : hit.z;
  }

  down(p: PointerInfo, c: PartCtx): void {
    const a = this.localAlong(p.ray);
    const cur = this.along(c.reg.value(this.id!));
    if (a === null) return;
    // clicking the slot jumps the cap there; grabbing the cap keeps the offset
    if (p.object === this.cap) this.grab = a - cur;
    else {
      this.grab = 0;
      c.reg.setValue(this.id!, clamp(this.valueAt(a), 0, 1), 'ui');
    }
  }

  move(p: PointerInfo, c: PartCtx): void {
    const a = this.localAlong(p.ray);
    if (a === null) return;
    c.reg.setValue(this.id!, clamp(this.valueAt(a - this.grab), 0, 1), 'ui');
  }

  wheel(delta: number, c: PartCtx): void {
    c.reg.nudgeValue(this.id!, delta * 0.02, 'ui');
  }

  double(c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl && ctl.kind === 'continuous') c.reg.setValue(this.id!, ctl.def, 'ui');
  }

  valueText(c: PartCtx): string {
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'continuous') return '';
    const v = ctl.get();
    return ctl.format ? ctl.format(v) : `${Math.round(v * 100)}%`;
  }
}

/* ------------------------------------------------------------------ */
/* buttons & pads                                                       */
/* ------------------------------------------------------------------ */

const symbolCache = new Map<string, THREE.CanvasTexture>();
function symbolTexture(text: string, color = '#ffffff'): THREE.CanvasTexture {
  const k = `${text}|${color}`;
  let t = symbolCache.get(k);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${text.length > 3 ? 34 : 46}px "Barlow Condensed", sans-serif`;
  if (text === 'PLAY') {
    g.beginPath();
    g.moveTo(34, 40);
    g.lineTo(34, 88);
    g.lineTo(66, 64);
    g.fill();
    g.fillRect(74, 40, 8, 48);
    g.fillRect(88, 40, 8, 48);
  } else g.fillText(text, 64, 66);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  symbolCache.set(k, t);
  return t;
}

export type ButtonShape = 'rect' | 'round' | 'big' | 'pill';

export class ButtonPart extends Part {
  private mat: THREE.MeshStandardMaterial;
  private body: THREE.Mesh;
  private ringMat: THREE.MeshStandardMaterial | null = null;
  private pressed = false;
  private restY: number;
  private lastKey = '';

  constructor(
    id: string,
    label: string,
    shape: ButtonShape,
    w: number,
    d: number,
    private led: string,
    opts: { h?: number; base?: string; symbol?: string; alt?: string | null } = {},
  ) {
    super();
    this.id = id;
    this.alt = opts.alt ?? null;
    this.label = label;
    const h = opts.h ?? (shape === 'big' ? 0.006 : 0.004);
    const base = opts.base ?? '#23262c';
    this.mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.55, metalness: 0.05, emissive: '#000000' });
    let geo: THREE.BufferGeometry;
    if (shape === 'round' || shape === 'big') geo = new THREE.CylinderGeometry(w / 2, w / 2 * 1.02, h, 36);
    else geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(w, d) * (shape === 'pill' ? 0.49 : 0.18));
    this.body = new THREE.Mesh(geo, this.mat);
    this.body.position.y = h / 2;
    this.restY = h / 2;
    this.body.castShadow = true;
    this.object.add(this.body);
    this.addHit(this.body);
    if (opts.symbol) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, w * 0.8), new THREE.MeshBasicMaterial({ map: symbolTexture(opts.symbol, '#f2f5fa'), transparent: true, depthWrite: false }));
      s.rotation.x = -Math.PI / 2;
      s.position.y = h / 2 + 0.0003;
      this.body.add(s);
    }
    if (shape === 'big') {
      this.ringMat = new THREE.MeshStandardMaterial({ color: '#15171b', roughness: 0.4, emissive: '#000000' });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + 0.0018, 0.0011, 10, 48), this.ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.0012;
      this.object.add(ring);
    }
  }

  update(c: PartCtx): void {
    const id = this.control(c.reg);
    const st = id ? ledColor(c.reg.lit(id), this.led) : { on: false, color: this.led, level: 0 };
    const flash = c.reg.flashing(id ?? '') ? 1 : 0;
    const key = `${st.on}|${st.color}|${st.level.toFixed(2)}|${flash}|${this.pressed}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      // unlit buttons keep a faint glow of their colour (backlit caps), so you can see where they are
      const lvl = st.on ? st.level : 0.1;
      if (this.ringMat) {
        setEmissive(this.ringMat, st.color, st.on ? st.level : 0.12, 3);
        setEmissive(this.mat, st.color, st.on ? st.level * 0.25 : 0, 1);
      } else setEmissive(this.mat, st.on ? st.color : this.led, lvl + flash * 0.5, 2.4);
      this.body.position.y = this.restY - (this.pressed ? 0.0012 : 0);
    }
  }

  down(_p: PointerInfo, c: PartCtx): void {
    const id = this.control(c.reg);
    if (!id) return;
    this.pressed = true;
    this.activeId = id;
    c.reg.press(id, 'ui');
  }

  private activeId: string | null = null;

  up(_p: PointerInfo, c: PartCtx): void {
    this.pressed = false;
    if (this.activeId) c.reg.release(this.activeId, 'ui');
    this.activeId = null;
  }
}

export class PadPart extends Part {
  private mat: THREE.MeshStandardMaterial;
  private body: THREE.Mesh;
  private pressed = false;
  private lastKey = '';

  constructor(id: string, label: string, size: number) {
    super();
    this.id = id;
    this.label = label;
    this.mat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.55, metalness: 0, emissive: '#000000' });
    this.body = new THREE.Mesh(new RoundedBoxGeometry(size, 0.0045, size, 2, size * 0.12), this.mat);
    this.body.position.y = 0.00225;
    this.body.castShadow = true;
    this.object.add(this.body);
    this.addHit(this.body);
  }

  update(c: PartCtx): void {
    const st = c.reg.lit(this.id!);
    let color = '#ffffff';
    let lvl = 0;
    if (st && typeof st === 'object') {
      color = st.color;
      lvl = st.level ?? 1;
    } else if (typeof st === 'string') {
      color = st;
      lvl = 1;
    } else if (st === true) lvl = 1;
    const key = `${color}|${lvl.toFixed(2)}|${this.pressed}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    // unlit pads glow faintly white so the grid reads; lit ones take their colour
    if (lvl > 0) setEmissive(this.mat, color, lvl, 2.6);
    else setEmissive(this.mat, '#9aa3b5', 0.05, 1);
    this.mat.color.set(lvl > 0 ? color : '#2b2f36').multiplyScalar(lvl > 0 ? 0.25 : 1);
    this.body.position.y = 0.00225 - (this.pressed ? 0.0012 : 0);
  }

  down(_p: PointerInfo, c: PartCtx): void {
    this.pressed = true;
    c.reg.press(this.id!, 'ui');
  }

  up(_p: PointerInfo, c: PartCtx): void {
    this.pressed = false;
    c.reg.release(this.id!, 'ui');
  }
}

/* ------------------------------------------------------------------ */
/* jog wheel                                                            */
/* ------------------------------------------------------------------ */

export type JogStyle = 'cdj' | 'controller' | 'pro';

/** m:ss for a jog display */
function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let knurledRing: THREE.MeshStandardMaterial | null = null;
let alloyTop: THREE.MeshStandardMaterial | null = null;
let glassPrints: THREE.Texture | null = null;

/** the jog ring's dark metal with a knurled rim */
function jogRingKnurled(): THREE.MeshStandardMaterial {
  if (knurledRing) return knurledRing;
  knurledRing = mats().jogRing.clone();
  knurledRing.normalMap = knurlNormal();
  knurledRing.normalScale.set(1, 1);
  knurledRing.roughness = 0.42;
  return knurledRing;
}

/** a controller jog's brushed aluminium top, with faint fingerprints */
function jogTopMetal(): THREE.MeshStandardMaterial {
  return (alloyTop ??= new THREE.MeshStandardMaterial({ color: 0xb9bec7, metalness: 1, roughness: 1, roughnessMap: fingerprintRoughness(0.36, 0.2, true) }));
}

/** fingerprints for a display glass, turned to its uv (a cylinder cap's) so they sit on the near side */
function jogGlassPrints(): THREE.Texture {
  if (glassPrints) return glassPrints;
  const t = fingerprintRoughness(0.1, 0.5).clone();
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  t.userData.shared = true;
  t.needsUpdate = true;
  return (glassPrints = t);
}

export class JogPart extends Part {
  /** the hand on the near side of the wheel, towards the DJ */
  grip(out: THREE.Vector3): THREE.Vector3 {
    return this.object.localToWorld(out.set(this.r * 0.15, this.topY + 0.01, this.r * 0.55));
  }

  private top = new THREE.Group();
  private ringLed: THREE.MeshStandardMaterial;
  private lastAngle = 0;
  private topY: number;
  private screen: THREE.CanvasTexture | null = null;
  private screenCanvas: HTMLCanvasElement | null = null;

  constructor(
    id: string,
    label: string,
    private r: number,
    style: JogStyle,
    private deckRef: DeckRef,
    private accent: string,
  ) {
    super();
    this.id = id;
    this.label = label;
    this.cursor = 'grab';
    const M = mats();
    const ringH = 0.014;
    // the rim is knurled for grip (a normal map: the light catches every ridge, for no extra geometry)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.01, ringH, 128, 1), jogRingKnurled());
    ring.position.y = ringH / 2;
    ring.castShadow = true;
    ring.userData.zone = 'ring';
    this.object.add(ring);
    this.addHit(ring);
    // knurled grip band look: dark ring top annulus
    const ann = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r, 96), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.8, roughnessMap: M.aluminium.roughnessMap }));
    ann.rotation.x = -Math.PI / 2;
    ann.position.y = ringH + 0.0002;
    ann.userData.zone = 'ring';
    this.object.add(ann);
    this.addHit(ann);
    this.ringLed = new THREE.MeshStandardMaterial({ color: '#0d0f12', emissive: '#000000', roughness: 0.3 });
    const led = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, 0.0012, 8, 96), this.ringLed);
    led.rotation.x = Math.PI / 2;
    led.position.y = ringH + 0.001;
    this.object.add(led);

    this.topY = ringH + 0.004;
    const topR = r * 0.78;
    let topMat: THREE.Material;
    if (style === 'controller') {
      topMat = jogTopMetal();
    } else {
      this.screenCanvas = document.createElement('canvas');
      this.screenCanvas.width = this.screenCanvas.height = 512;
      this.screen = new THREE.CanvasTexture(this.screenCanvas);
      this.screen.colorSpace = THREE.SRGBColorSpace;
      this.screen.anisotropy = 16;
      // glass over the display, smudged where the hand lands
      topMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 1, roughnessMap: jogGlassPrints(), metalness: 0.2, emissive: '#ffffff', emissiveMap: this.screen, emissiveIntensity: SCREEN_GAIN });
    }
    // the top: a moulded bezel standing a little proud round the rim, and the display (or the metal disc) set into it
    const inR = style === 'controller' ? topR - 0.0012 : topR - 0.0065;
    const bezel = new THREE.Mesh(
      lathe(
        [
          [topR, 0],
          [topR, 0.0044],
          [topR - 0.0009, 0.0053],
          [topR - 0.0035, 0.0055],
          [inR + 0.0012, 0.0049],
          [inR, 0.0041],
          [inR - 0.0002, 0.0036],
        ],
        128,
      ),
      style === 'controller' ? M.jogRing : M.plasticDark,
    );
    bezel.position.y = ringH;
    bezel.castShadow = true;
    bezel.userData.zone = 'top';
    const discGeo = new THREE.CircleGeometry(inR, 96).rotateX(-Math.PI / 2);
    if (style !== 'controller') {
      // the display was drawn for a cylinder cap's uv (a quarter turn round from a plain disc's)
      const p = discGeo.getAttribute('position');
      const uv = discGeo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getZ(i) / (2 * inR), 0.5 + p.getX(i) / (2 * inR));
    }
    const plate = new THREE.Mesh(discGeo, topMat);
    plate.position.y = ringH + 0.0038;
    plate.userData.zone = 'top';
    this.top.add(bezel, plate);
    if (style === 'controller') {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.05, 0.001, 16), new THREE.MeshStandardMaterial({ color: '#111', emissive: accent, emissiveIntensity: 1.5 }));
      dot.position.set(0, ringH + 0.0045, -topR * 0.78);
      this.top.add(dot);
      const center = new THREE.Mesh(new THREE.CylinderGeometry(topR * 0.35, topR * 0.35, 0.0012, 48), M.black);
      center.position.y = ringH + 0.0045;
      this.top.add(center);
    }
    this.object.add(this.top);
    this.addHit(plate);
    this.addHit(bezel);
    if (style !== 'controller') {
      // CDJ-style jogs: the ring rotates, display stays put; we rotate only the marker (drawn)
      this.top.userData.static = true;
    }
  }

  update(c: PartCtx): void {
    const id = this.id!;
    const ctl = c.reg.get(id);
    if (!ctl || ctl.kind !== 'jog') return;
    const d = c.deck(this.deckRef);
    const angle = ctl.angle();
    if (!this.top.userData.static) this.top.rotation.y = angle;
    const touched = ctl.touched();
    const lvl = touched ? 1 : d.playing ? 0.55 : d.loaded ? 0.18 : 0.04;
    setEmissive(this.ringLed, touched ? '#ffffff' : this.accent, lvl, 2.2);
    if (this.screen && this.screenCanvas && c.frame % 2 === 0) this.drawScreen(d, angle, touched);
  }

  private drawScreen(d: Deck, angle: number, touched: boolean): void {
    const g = this.screenCanvas!.getContext('2d')!;
    // drawn in a 256-unit square, at the canvas's real resolution
    const S = 256;
    const cx = S / 2;
    const cy = S / 2;
    // the plate's texture lies a quarter turn round: turn the drawing back so it reads upright from the DJ's side
    const k = this.screenCanvas!.width / S;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.translate(cx, cy);
    g.rotate(-Math.PI / 2);
    g.translate(-cx, -cy);
    // art in the centre
    const art = d.track?.meta.art;
    if (art) {
      let img = artImages.get(art);
      if (!img) {
        img = new Image();
        img.src = art;
        artImages.set(art, img);
      }
      if (img.complete && img.naturalWidth) {
        g.save();
        g.beginPath();
        g.arc(cx, cy, 58, 0, Math.PI * 2);
        g.clip();
        g.drawImage(img, cx - 58, cy - 58, 116, 116);
        g.restore();
      }
    } else {
      g.fillStyle = '#0d1016';
      g.beginPath();
      g.arc(cx, cy, 58, 0, Math.PI * 2);
      g.fill();
    }
    // progress ring
    if (d.loaded && d.duration > 0) {
      const f = d.position() / d.duration;
      g.strokeStyle = '#1c222b';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(cx, cy, 108, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = nearEnd(d) ? '#ff3b5c' : this.accent;
      g.beginPath();
      g.arc(cx, cy, 108, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      g.stroke();
    }
    // rotating position marker (clockwise in board space; the drawing is already turned a quarter)
    const a = -angle;
    g.strokeStyle = touched ? '#ffffff' : '#e7ecf3';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 72, cy + Math.sin(a) * 72);
    g.lineTo(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96);
    g.stroke();
    // the beat: four dots round the top, the one we're on lit
    if (d.loaded) {
      const beat = ((Math.floor(d.beatPosition(d.displayPosition())) % 4) + 4) % 4;
      for (let i = 0; i < 4; i++) {
        const ba = -Math.PI / 2 + (i - 1.5) * 0.2;
        g.fillStyle = i === beat && d.playing ? this.accent : '#2a313c';
        g.beginPath();
        g.arc(cx + Math.cos(ba) * 122, cy + Math.sin(ba) * 122, 4.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // the deck, the tempo, the time left
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = this.accent;
    g.font = '700 17px "Barlow Condensed", sans-serif';
    g.fillText(`DECK ${d.id}`, cx, cy - 76);
    if (d.loaded) {
      g.fillStyle = '#ffffff';
      g.font = '700 24px "JetBrains Mono", monospace';
      g.fillText(d.bpm.toFixed(1), cx, cy + 86);
      g.fillStyle = nearEnd(d) && d.playing ? '#ff3b5c' : '#9fe7ff';
      g.font = '600 15px "JetBrains Mono", monospace';
      g.fillText(`-${formatClock(d.remaining)}`, cx, cy + 104);
    }
    this.screen!.needsUpdate = true;
  }

  private angleAt(ray: THREE.Ray): number | null {
    const hit = planeHit(ray, surfaceWorldY(this.object, this.topY));
    if (!hit) return null;
    this.object.worldToLocal(hit);
    return Math.atan2(hit.z, hit.x);
  }

  down(p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'jog') return;
    const zone = (p.object.userData.zone as 'top' | 'ring') ?? 'top';
    ctl.touch(zone);
    this.zone = zone;
    this.lastAngle = this.angleAt(p.ray) ?? 0;
    c.reg.mark(this.id!, 'ui');
  }

  private zone: 'top' | 'ring' = 'top';

  move(p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'jog') return;
    const a = this.angleAt(p.ray);
    if (a === null) return;
    let d = a - this.lastAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.lastAngle = a;
    if (Math.abs(d) > 1e-5) ctl.turn(d / (Math.PI * 2), this.zone);
  }

  up(_p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl && ctl.kind === 'jog') ctl.touch(null);
  }

  wheel(delta: number, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl && ctl.kind === 'jog') ctl.turn(delta * 0.02, 'ring');
  }

  valueText(c: PartCtx): string {
    const d = c.deck(this.deckRef);
    return d.vinyl ? 'top: scratch · edge: nudge' : 'turn to nudge';
  }

  get radius(): number {
    return this.r;
  }
}

const artImages = new Map<string, HTMLImageElement>();

/* ------------------------------------------------------------------ */
/* turntable platter + record                                           */
/* ------------------------------------------------------------------ */

/** the platter's height above the plinth, the felt mat's thickness, and the record's (metres) */
const PLATTER_H = 0.028;
const MAT_H = 0.003;
const REC_H = 0.0018;
/** the record's playing surface sits a little below its label area and its rim */
const REC_GROOVE_H = 0.0016;
/** height of the record's grooved surface above the plinth: where a stylus rides */
export const RECORD_TOP = PLATTER_H + MAT_H + REC_GROOVE_H;

/**
 * A 12-inch record, lathed: a raised label area, the thinner grooved field, a
 * beaded rim, a centre hole. One mesh, planar uv across the disc.
 */
function recordGeometry(): THREE.BufferGeometry {
  const R = RECORD_R;
  const H = REC_H;
  const G = REC_GROOVE_H;
  return discUV(
    lathe(
      // out along the underside, round the rim, in across the top, down the hole (the lathe faces outward along this path)
      [
        [0.0037, 0],
        [R - 0.0016, 0],
        [R - 0.0004, 0.0002],
        [R, H * 0.45],
        [R - 0.0003, H * 0.95],
        [R - 0.0012, H],
        [R - 0.0034, G + 0.00005],
        [R - 0.0048, G],
        [0.0505, G],
        [0.0498, H],
        [0.0037, H],
        [0.0037, 0],
      ],
      160,
    ),
    R,
  );
}

/** the felt mat: a disc with a soft rounded edge */
function slipmatGeometry(r: number): THREE.BufferGeometry {
  return discUV(
    lathe(
      [
        [r - 0.001, 0],
        [r, MAT_H * 0.3],
        [r - 0.0002, MAT_H * 0.85],
        [r - 0.0012, MAT_H],
        [0.004, MAT_H],
        [0.004, 0],
      ],
      128,
    ),
    r,
  );
}

let recordMat: THREE.MeshPhysicalMaterial | null = null;

/** grooved vinyl: fine rings in colour, smooth gaps between tracks, and the radial anisotropic streak */
function vinylMaterial(): THREE.MeshPhysicalMaterial {
  if (recordMat) return recordMat;
  const v = vinylMaps();
  recordMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: v.map,
    roughness: 1,
    roughnessMap: v.rough,
    metalness: 0,
    anisotropy: 0.9,
    anisotropyMap: v.aniso,
    specularIntensity: 1,
  });
  return recordMat;
}

export class PlatterPart extends Part {
  /** the hand on the record, near side */
  grip(out: THREE.Vector3): THREE.Vector3 {
    return this.object.localToWorld(out.set(0.03, this.topY + 0.01, 0.1));
  }

  private platter = new THREE.Group();
  private record = new THREE.Group();
  private labelTex: THREE.CanvasTexture;
  private labelCanvas: HTMLCanvasElement;
  private labelFor: string | null = null;
  private lastAngle = 0;
  private zone: 'top' | 'ring' = 'top';
  private topY: number;
  private strobeGlow: THREE.MeshBasicMaterial;

  constructor(
    id: string,
    label: string,
    private deckRef: DeckRef,
    private accent: string,
  ) {
    super();
    this.id = id;
    this.label = label;
    this.cursor = 'grab';
    const M = mats();
    const pr = 0.166;
    const ph = PLATTER_H;
    const strobe = new THREE.MeshStandardMaterial({ color: 0xc9cdd4, roughness: 0.35, metalness: 0.9, map: strobeTexture() });
    (strobe.map as THREE.Texture).repeat.set(1, 1);
    const platterMesh = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, ph, 128, 1, true), strobe);
    platterMesh.position.y = ph / 2;
    platterMesh.userData.zone = 'ring';
    platterMesh.castShadow = true;
    const platterTop = new THREE.Mesh(new THREE.CircleGeometry(pr, 96), M.platterMetal);
    platterTop.rotation.x = -Math.PI / 2;
    platterTop.position.y = ph;
    platterTop.userData.zone = 'ring';
    this.platter.add(platterMesh, platterTop);
    // felt slipmat: the fibres scatter a soft sheen at grazing angles
    const felt = new THREE.MeshPhysicalMaterial({ map: slipmatTexture('DECKHOUSE', accent), roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x3a3a40) });
    const mat = new THREE.Mesh(slipmatGeometry(0.151), felt);
    mat.position.y = ph;
    mat.userData.zone = 'top';
    mat.receiveShadow = true;
    this.platter.add(mat);
    this.object.add(this.platter);

    // record: lathed vinyl with its label on top
    const rec = new THREE.Mesh(recordGeometry(), vinylMaterial());
    rec.position.y = ph + MAT_H;
    rec.userData.zone = 'top';
    rec.castShadow = true;
    rec.receiveShadow = true;
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = this.labelCanvas.height = 512;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.labelTex.anisotropy = 8;
    // printed paper: matte, with a faint satin varnish
    const labelMesh = new THREE.Mesh(new THREE.CircleGeometry(0.0496, 64), new THREE.MeshStandardMaterial({ map: this.labelTex, roughness: 0.55 }));
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.y = ph + MAT_H + REC_H + 0.00004;
    labelMesh.userData.zone = 'top';
    this.record.add(rec, labelMesh);
    this.object.add(this.record);
    // the spindle: a polished pin with a chamfered tip, through the mat and the record
    const spindle = new THREE.Mesh(
      lathe(
        [
          [0.0062, 0],
          [0.0062, 0.0012],
          [0.0036, 0.0016],
          [0.0036, 0.0125],
          [0.0029, 0.0142],
          [0.0016, 0.0149],
          [0, 0.015],
        ],
        24,
      ),
      M.chrome,
    );
    spindle.position.y = ph;
    this.object.add(spindle);
    this.topY = ph + MAT_H + REC_H;
    this.addHit(rec);
    this.addHit(labelMesh);
    this.addHit(mat);
    this.addHit(platterMesh);
    this.addHit(platterTop);
    // strobe light glow on the platter edge
    this.strobeGlow = new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.03), this.strobeGlow);
    glow.position.set(-pr * 0.72, ph / 2, pr * 0.72);
    glow.rotation.y = Math.PI / 4;
    this.object.add(glow);
  }

  update(c: PartCtx): void {
    const d = c.deck(this.deckRef);
    this.platter.rotation.y = d.platterAngle;
    const ctl = c.reg.get(this.id!);
    if (ctl && ctl.kind === 'jog') this.record.rotation.y = ctl.angle();
    this.record.visible = d.loaded;
    this.strobeGlow.opacity = d.playing ? 0.5 : 0.15;
    const key = d.track?.id ?? '';
    if (key !== this.labelFor) {
      this.labelFor = key;
      this.drawLabel(d);
    }
  }

  /** a pressed record's centre label: the art (or a plain colour), the title, the small print round the rim */
  private drawLabel(d: Deck): void {
    const g = this.labelCanvas.getContext('2d')!;
    const S = 512;
    const c = S / 2;
    g.fillStyle = this.accent;
    g.fillRect(0, 0, S, S);
    const art = d.track?.meta.art;
    const finish = () => {
      // a band for the title, the way labels print it
      g.fillStyle = 'rgba(0,0,0,0.38)';
      g.fillRect(0, S * 0.63, S, S * 0.2);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '700 40px "Barlow Condensed", sans-serif';
      g.fillText((d.track?.meta.title ?? '').slice(0, 22), c, S * 0.69);
      g.font = '600 30px "Barlow Condensed", sans-serif';
      g.fillText((d.track?.meta.artist ?? '').slice(0, 26), c, S * 0.775);
      // the small print round the rim
      g.save();
      g.translate(c, c);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = '600 19px "Barlow Condensed", sans-serif';
      const rim = 'DECKHOUSE RECORDS  ·  33⅓ RPM  ·  STEREO  ·  SIDE A  ·  ALL RIGHTS RESERVED  ·  ';
      const rr = S * 0.445;
      const step = 0.0395;
      for (let i = 0; i < rim.length; i++) {
        const a = -Math.PI * 0.95 + i * step;
        if (a > Math.PI * 0.95) break;
        g.save();
        g.rotate(a);
        g.translate(0, -rr);
        g.fillText(rim[i], 0, 0);
        g.restore();
      }
      g.restore();
      // side and speed either side of the hole
      g.fillStyle = '#fff';
      g.font = '700 30px "Barlow Condensed", sans-serif';
      g.fillText('A', c - S * 0.2, c);
      g.font = '600 20px "Barlow Condensed", sans-serif';
      g.fillText('33⅓', c + S * 0.2, c);
      // a fine printed ring at the edge, and the hole with its punched rim
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(c, c, S * 0.49, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#0a0a0a';
      g.beginPath();
      g.arc(c, c, 20, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(c, c, 22, 0, Math.PI * 2);
      g.stroke();
      this.labelTex.needsUpdate = true;
    };
    if (art) {
      const img = new Image();
      img.onload = () => {
        g.drawImage(img, 0, 0, S, S);
        finish();
      };
      img.src = art;
    } else {
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.beginPath();
      g.arc(c, c, S * 0.36, 0, Math.PI * 2);
      g.fill();
      finish();
    }
  }

  private angleAt(ray: THREE.Ray): number | null {
    const hit = planeHit(ray, surfaceWorldY(this.object, this.topY));
    if (!hit) return null;
    this.object.worldToLocal(hit);
    return Math.atan2(hit.z, hit.x);
  }

  down(p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'jog') return;
    this.zone = (p.object.userData.zone as 'top' | 'ring') ?? 'top';
    ctl.touch(this.zone);
    this.lastAngle = this.angleAt(p.ray) ?? 0;
  }

  move(p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'jog') return;
    const a = this.angleAt(p.ray);
    if (a === null) return;
    let d = a - this.lastAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.lastAngle = a;
    if (Math.abs(d) > 1e-5) ctl.turn(d / (Math.PI * 2), this.zone);
  }

  up(_p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl && ctl.kind === 'jog') ctl.touch(null);
  }

  wheel(delta: number, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl && ctl.kind === 'jog') ctl.turn(delta * 0.02, 'ring');
  }

  valueText(): string {
    return 'record: scratch · platter edge: nudge';
  }
}

/* ------------------------------------------------------------------ */
/* tonearm (needle drop)                                                */
/* ------------------------------------------------------------------ */

/** height of the arm's bearing axis above the plinth */
const ARM_Y = 0.05;

let cartMat: THREE.MeshStandardMaterial | null = null;

/**
 * The tonearm, modelled on the classic direct-drive DJ deck's S-shaped arm:
 * a base with its height-adjust collar, a gimbal, the S-curved tube, a
 * detachable headshell with a finger lift, a cartridge and stylus, and behind
 * the pivot a counterweight with grooved rings. Beside it: the arm rest with
 * its clip, the cue lift lever and the anti-skate dial. Static parts and
 * swinging parts are each merged per material (5 draw calls in all).
 */
export class TonearmPart extends Part {
  private arm = new THREE.Group();
  private angle: number;
  private readonly rest: number;
  private readonly start: number;
  private readonly end: number;
  private readonly L = 0.232;
  private dragging = false;

  constructor(
    id: string,
    label: string,
    pivot: THREE.Vector2,
    center: THREE.Vector2,
    private deckRef: DeckRef,
  ) {
    super();
    this.id = id;
    this.label = label;
    this.cursor = 'grab';
    const M = mats();
    this.object.position.set(pivot.x, 0, pivot.y);

    // arm angle θ: rotation.y of the group; stylus at pivot + L·(−sinθ, −cosθ)
    const D = pivot.distanceTo(center);
    const toCenter = Math.atan2(-(center.x - pivot.x), -(center.y - pivot.y));
    const angleFor = (r: number) => {
      const a = Math.acos(clamp((D * D + this.L * this.L - r * r) / (2 * D * this.L), -1, 1));
      return toCenter + a; // stylus on the side of the record facing the rest post
    };
    this.start = angleFor(0.146);
    this.end = angleFor(0.062);
    this.rest = angleFor(0.146) + 0.3;
    this.angle = this.rest;

    /* the static base, rest and controls */
    const chrome: Piece[] = [];
    const black: Piece[] = [];
    // plinth ring and the height-adjust collar with its grooved grip
    chrome.push({ g: lathe([[0.036, 0], [0.036, 0.0022], [0.0345, 0.0034], [0.026, 0.0034], [0, 0.0034]], 48) });
    black.push({ g: lathe([[0.0265, 0.0034], ...grooves(0.0265, 0.005, 0.0145, 7, 0.0009), [0.0265, 0.0165], [0.024, 0.0175], [0, 0.0175]], 36) });
    // the pillar up to the gimbal, and the collar's lock lever
    chrome.push({ g: new THREE.CylinderGeometry(0.0105, 0.0105, 0.022, 24), m: place(0, 0.0175 + 0.011, 0) });
    chrome.push({ g: new THREE.BoxGeometry(0.003, 0.003, 0.016), m: place(-0.022, 0.013, 0.016, 0, -0.8, 0) });
    chrome.push({ g: new THREE.SphereGeometry(0.0026, 10, 8), m: place(-0.0277, 0.013, 0.0218) });
    // arm rest: a post with a rubber-lined cradle and a clip, out along the rest angle, clear of the platter
    const dir = new THREE.Vector2(-Math.sin(this.rest), -Math.cos(this.rest));
    const cl = new THREE.Vector2(center.x - pivot.x, center.y - pivot.y);
    let s = 0.155;
    while (s > 0.1 && dir.clone().multiplyScalar(s).distanceTo(cl) < 0.178) s -= 0.005;
    const rx = dir.x * s;
    const rz = dir.y * s;
    const restY = ARM_Y - 0.0058;
    chrome.push({ g: lathe([[0.0075, 0], [0.0075, 0.002], [0.0042, 0.003], [0.0034, 0.004], [0.0034, restY - 0.004], [0, restY - 0.004]], 20), m: place(rx, 0, rz) });
    black.push({ g: new THREE.BoxGeometry(0.014, 0.004, 0.009), m: place(rx, restY - 0.002, rz, 0, this.rest, 0) });
    for (const side of [-1, 1]) {
      const ox = Math.cos(this.rest) * side * 0.0058;
      const oz = -Math.sin(this.rest) * side * 0.0058;
      black.push({ g: new THREE.BoxGeometry(0.0022, 0.0075, 0.008), m: place(rx + ox, restY + 0.0025, rz + oz, 0, this.rest, 0) });
    }
    // the clip that holds the arm in transit, swung open
    chrome.push({ g: new THREE.TorusGeometry(0.0055, 0.0007, 6, 16, Math.PI), m: place(rx, restY + 0.0005, rz, 0, this.rest + 1.2, Math.PI / 2) });
    // cue lift: a post with a lever towards the DJ
    const lx = 0.034;
    const lz = 0.03;
    chrome.push({ g: lathe([[0.006, 0], [0.006, 0.0015], [0.0038, 0.0025], [0.0038, 0.024], [0.003, 0.025], [0, 0.025]], 16), m: place(lx, 0, lz) });
    chrome.push({ g: new THREE.BoxGeometry(0.0034, 0.0024, 0.022), m: place(lx, 0.022, lz + 0.011, 0.12, 0, 0) });
    black.push({ g: new THREE.CylinderGeometry(0.0028, 0.0028, 0.007, 12), m: place(lx, 0.0207, lz + 0.024, Math.PI / 2 + 0.12, 0, 0) });
    // anti-skate dial: a knurled knob with a bright index notch, beside the base
    const ax = -0.032;
    const az = 0.03;
    black.push({ g: lathe([[0.0105, 0], [0.0105, 0.0012], [0.0085, 0.0014], ...grooves(0.0085, 0.0014, 0.0072, 12, 0.0006), [0.0078, 0.0078], [0, 0.0078]], 36), m: place(ax, 0, az) });
    chrome.push({ g: new THREE.CylinderGeometry(0.0062, 0.0062, 0.0006, 24), m: place(ax, 0.0081, az) });
    chrome.push({ g: new THREE.BoxGeometry(0.0009, 0.0016, 0.0042), m: place(ax, 0.0079, az - 0.0052) });
    for (let i = 0; i < 7; i++) {
      const a = -1.6 + (i / 6) * 3.2;
      chrome.push({ g: new THREE.BoxGeometry(0.0006, 0.0003, 0.0022), m: place(ax + Math.sin(a) * 0.0096, 0.0013, az - Math.cos(a) * 0.0096, 0, -a, 0) });
    }
    const baseChrome = new THREE.Mesh(mergePieces(chrome), M.chrome);
    const baseBlack = new THREE.Mesh(mergePieces(black), M.plasticDark);
    baseChrome.castShadow = baseBlack.castShadow = true;
    this.object.add(baseChrome, baseBlack);

    /* the swinging arm (points along local −Z) */
    const aChrome: Piece[] = [];
    const aBlack: Piece[] = [];
    // gimbal: the bearing housing on top of the pillar, the horizontal bearing across it
    aChrome.push({ g: lathe([[0.0125, 0.0395], [0.0125, 0.046], [0.0105, 0.0475], [0, 0.0475]], 32) });
    aBlack.push({ g: new THREE.CylinderGeometry(0.0072, 0.0072, 0.03, 20), m: place(0, ARM_Y, 0.001, 0, 0, Math.PI / 2) });
    for (const side of [-1, 1]) aChrome.push({ g: new THREE.CylinderGeometry(0.0045, 0.0045, 0.0016, 16), m: place(side * 0.0153, ARM_Y, 0.001, 0, 0, Math.PI / 2) });
    // the headshell sits at the stylus end, turned in by the offset angle that keeps the stylus square to the groove
    const off = -0.38;
    const tip = new THREE.Vector3(0, RECORD_TOP + 0.0002, -this.L);
    const hs = new THREE.Matrix4().compose(tip, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, off, 0)), new THREE.Vector3(1, 1, 1));
    const inHead = (m: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(hs, m);
    const cartH = 0.0172;
    const plateY = cartH + 0.0012; // headshell plate, above the stylus tip
    // the S: from the gimbal round to the headshell's collar
    const collar = new THREE.Vector3(0, plateY + 0.0006, 0.031).applyMatrix4(hs);
    collar.y = ARM_Y;
    const sCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, ARM_Y, -0.006),
      new THREE.Vector3(0.002, ARM_Y, -0.045),
      new THREE.Vector3(0.016, ARM_Y, -0.105),
      new THREE.Vector3(0.012, ARM_Y, -0.155),
      new THREE.Vector3((0.012 + collar.x) / 2 - 0.003, ARM_Y, (-0.155 + collar.z) / 2),
      collar,
    ]);
    aChrome.push({ g: new THREE.TubeGeometry(sCurve, 64, 0.0042, 12) });
    // the headshell's locking collar and the plate
    aChrome.push({ g: new THREE.CylinderGeometry(0.0056, 0.0056, 0.012, 16), m: inHead(place(0, plateY - 0.0002 + (ARM_Y - tip.y - plateY), 0.026, Math.PI / 2, 0, 0)) });
    aBlack.push({ g: new THREE.CylinderGeometry(0.0062, 0.0062, 0.003, 16), m: inHead(place(0, ARM_Y - tip.y, 0.0335, Math.PI / 2, 0, 0)) });
    // plate: a bent strip from the collar down to the cartridge mount
    const plate = new RoundedBoxGeometry(0.019, 0.0022, 0.036, 2, 0.0009);
    aBlack.push({ g: plate, m: inHead(place(0, plateY, 0.004, -0.04, 0, 0)) });
    aBlack.push({ g: new THREE.BoxGeometry(0.008, 0.002, 0.008), m: inHead(place(0, plateY + 0.0012 + (ARM_Y - tip.y - plateY) * 0.5, 0.0205, -0.25, 0, 0)) });
    // two cartridge screws on top
    for (const z of [0.0005, 0.0095]) aChrome.push({ g: new THREE.CylinderGeometry(0.0011, 0.0011, 0.0008, 10), m: inHead(place(0, plateY + 0.0013, z)) });
    // finger lift: a bent wire off the side, curling up
    const lift = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0085, plateY + 0.0006, -0.006),
      new THREE.Vector3(0.0145, plateY + 0.0018, -0.009),
      new THREE.Vector3(0.0205, plateY + 0.0055, -0.011),
      new THREE.Vector3(0.0235, plateY + 0.0095, -0.0115),
    ]);
    aChrome.push({ g: new THREE.TubeGeometry(lift, 16, 0.0012, 6), m: hs });
    aChrome.push({ g: new THREE.SphereGeometry(0.0016, 10, 8), m: inHead(place(0.0236, plateY + 0.0098, -0.0115)) });
    // stylus: the cantilever down from the cartridge's nose, a pin-head tip
    aChrome.push({ g: new THREE.CylinderGeometry(0.00028, 0.0004, 0.0062, 6), m: inHead(place(0, 0.0024, -0.0105, 1.05, 0, 0)) });
    aChrome.push({ g: new THREE.ConeGeometry(0.0005, 0.0012, 6), m: inHead(place(0, 0.0005, -0.0132, Math.PI, 0, 0)) });
    // counterweight: a stub behind the pivot carrying the weight, with grooved grip rings and a scale ring
    aChrome.push({ g: new THREE.CylinderGeometry(0.0052, 0.0052, 0.062, 16), m: place(0, ARM_Y, 0.04, Math.PI / 2, 0, 0) });
    const wz0 = 0.03;
    const weight = lathe([[0.0052, 0], [0.0165, 0], [0.0172, 0.0012], ...grooves(0.0172, 0.0012, 0.013, 9, 0.0008), [0.0172, 0.03], [0.016, 0.0315], [0.0052, 0.0315]], 32);
    aChrome.push({ g: weight, m: place(0, ARM_Y, wz0, Math.PI / 2, 0, 0) });
    aBlack.push({ g: lathe([[0.0052, 0], [0.0174, 0], [0.0176, 0.0002], [0.0176, 0.0058], [0.0174, 0.006], [0.0052, 0.006]], 48), m: place(0, ARM_Y, wz0 + 0.0005 - 0.0068, Math.PI / 2, 0, 0) });
    const armChrome = new THREE.Mesh(mergePieces(aChrome), M.chrome);
    const armBlack = new THREE.Mesh(mergePieces(aBlack), M.plasticDark);
    // the cartridge body: a tapered block under the headshell, with its stylus guard
    cartMat ??= new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.38, metalness: 0.1 });
    const body = new RoundedBoxGeometry(0.0158, cartH - 0.0035, 0.024, 2, 0.0018);
    const pos = body.getAttribute('position') as THREE.BufferAttribute;
    // narrower towards the nose and the bottom, like the real thing
    for (let i = 0; i < pos.count; i++) {
      const k = 1 - 0.18 * clamp((-pos.getZ(i) / 0.012 + 1) / 2, 0, 1) - 0.1 * clamp(0.5 - pos.getY(i) / (cartH - 0.0035), 0, 1);
      pos.setX(i, pos.getX(i) * k);
    }
    body.computeVertexNormals();
    const cart = new THREE.Mesh(
      mergePieces([
        { g: body, m: inHead(place(0, 0.0035 + (cartH - 0.0035) / 2, 0.003)) },
        { g: new THREE.BoxGeometry(0.0085, 0.0034, 0.009), m: inHead(place(0, 0.0034, -0.0068)) },
      ]),
      cartMat,
    );
    for (const m of [armChrome, armBlack, cart]) {
      m.castShadow = true;
      this.arm.add(m);
      this.addHit(m);
    }
    this.object.add(this.arm);
  }

  update(c: PartCtx): void {
    if (this.dragging) {
      this.arm.rotation.y = this.angle;
      return;
    }
    const d = c.deck(this.deckRef);
    const target = d.loaded ? this.start + (this.end - this.start) * (d.duration ? d.position() / d.duration : 0) : this.rest;
    this.angle += (target - this.angle) * Math.min(1, c.dt * 6);
    this.arm.rotation.y = this.angle;
  }

  private angleFromRay(ray: THREE.Ray): number | null {
    const hit = planeHit(ray, surfaceWorldY(this.object, ARM_Y));
    if (!hit) return null;
    this.object.worldToLocal(hit);
    return Math.atan2(-hit.x, -hit.z);
  }

  down(): void {
    this.dragging = true;
  }

  move(p: PointerInfo): void {
    const a = this.angleFromRay(p.ray);
    if (a === null) return;
    const lo = Math.min(this.start, this.end, this.rest);
    const hi = Math.max(this.start, this.end, this.rest);
    this.angle = clamp(a, lo, hi);
  }

  up(_p: PointerInfo, c: PartCtx): void {
    this.dragging = false;
    const f = (this.angle - this.start) / (this.end - this.start);
    if (f >= 0 && f <= 1) c.reg.setValue(this.id!, f, 'ui');
  }

  valueText(c: PartCtx): string {
    const d = c.deck(this.deckRef);
    return d.loaded ? 'drag to drop the needle' : 'load a track first';
  }
}

/* ------------------------------------------------------------------ */
/* screens, meters, indicators, switches                                */
/* ------------------------------------------------------------------ */

/** how much brighter than paper white a screen's picture is, so it reads as lit after the frame is tone-mapped (kept under the lens's flare threshold) */
export const SCREEN_GAIN = 1.4;

/** the glass over a screen: black, so it only adds the room's reflections on top of the picture */
export function screenGlass(w: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    // soft and faint, so a lamp over the booth glints across it without washing the picture out
    new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.24, metalness: 0, specularIntensity: 0.45, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, envMapIntensity: 0.9 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

export class ScreenPart extends Part {
  readonly canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly d: number,
    pxW: number,
    pxH: number,
    private drawFn: (g: CanvasRenderingContext2D, W: number, H: number, c: PartCtx) => void,
    tilt = 0,
    private every = 2,
    o: { housing?: boolean; gain?: number; back?: THREE.Material } = {},
  ) {
    super();
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 16;
    const gain = o.gain ?? SCREEN_GAIN;
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(w + 0.008, 0.004, d + 0.008, 2, 0.002), mats().plasticDark);
    const picture = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, color: new THREE.Color(gain, gain, gain) }));
    picture.rotation.x = -Math.PI / 2;
    picture.position.y = 0.0021;
    const glass = screenGlass(w, d);
    glass.position.y = 0.0023;
    const holder = new THREE.Group();
    holder.add(bezel, picture, glass);
    if (o.back) {
      // a lid's shell behind the panel (a laptop's)
      const shell = new THREE.Mesh(new RoundedBoxGeometry(w + 0.014, 0.004, d + 0.014, 2, 0.003), o.back);
      shell.position.y = -0.0032;
      shell.castShadow = true;
      holder.add(shell);
    }
    holder.rotation.x = tilt;
    holder.position.y = 0.002 + Math.abs(Math.sin(tilt)) * d * 0.5;
    this.object.add(holder);
    // a raised screen sits on a wedge of housing, not on air
    if (tilt > 0.05 && o.housing !== false) {
      const c = Math.cos(tilt) * (d / 2);
      const top = 0.002 + Math.sin(tilt) * d - 0.003;
      const shape = new THREE.Shape([new THREE.Vector2(c - 0.004, 0), new THREE.Vector2(-c + 0.002, 0), new THREE.Vector2(-c + 0.002, top), new THREE.Vector2(c - 0.004, 0.001)]);
      const wedge = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w + 0.004, bevelEnabled: false }).rotateY(-Math.PI / 2).translate((w + 0.004) / 2, 0, 0), mats().plasticDark);
      wedge.castShadow = true;
      this.object.add(wedge);
    }
  }

  update(c: PartCtx): void {
    if (c.frame % this.every !== 0) return;
    this.drawFn(this.g, this.canvas.width, this.canvas.height, c);
    this.tex.needsUpdate = true;
  }
}

export class VuPart extends Part {
  private mesh: THREE.InstancedMesh;
  private peak = [0, 0];
  private cols: number;
  private colors: THREE.Color[];
  private off = new THREE.Color(0x14171c);
  private dim: THREE.Color[] = [];

  constructor(
    private source: number | 'master',
    private n: number,
    length: number,
    stereo: boolean,
    segW = 0.0028,
  ) {
    super();
    this.cols = stereo ? 2 : 1;
    const segD = (length / n) * 0.72;
    const geo = new THREE.BoxGeometry(segW, 0.0008, segD);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, n * this.cols);
    const m = new THREE.Matrix4();
    this.colors = [];
    for (let c = 0; c < this.cols; c++) {
      for (let i = 0; i < n; i++) {
        const x = this.cols === 2 ? (c === 0 ? -segW * 0.75 : segW * 0.75) : 0;
        const z = length / 2 - (i + 0.5) * (length / n);
        m.makeTranslation(x, 0.0004, z);
        this.mesh.setMatrixAt(c * n + i, m);
        this.mesh.setColorAt(c * n + i, this.off);
      }
    }
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      this.colors.push(new THREE.Color(f > 0.86 ? '#ff2b45' : f > 0.68 ? '#ffc53a' : '#27e07d').multiplyScalar(1.6));
      // an unlit LED still shows a ghost of its colour through the window
      this.dim.push(this.colors[i].clone().multiplyScalar(0.045));
    }
    this.object.add(this.mesh);
  }

  update(c: PartCtx): void {
    const lv = this.source === 'master' ? c.master() : c.levels(this.source);
    for (let ch = 0; ch < this.cols; ch++) {
      const val = this.cols === 1 ? Math.max(lv[0], lv[1]) : lv[ch];
      const db = 20 * Math.log10(Math.max(1e-6, val));
      const f = clamp((db + 36) / 39, 0, 1);
      this.peak[ch] = Math.max(f, this.peak[ch] - c.dt * 1.8);
      const lit = Math.round(this.peak[ch] * this.n);
      for (let i = 0; i < this.n; i++) this.mesh.setColorAt(ch * this.n + i, i < lit ? this.colors[i] : this.dim[i]);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

export class IndicatorPart extends Part {
  private mat: THREE.MeshStandardMaterial;
  constructor(
    r: number,
    private fn: (c: PartCtx) => { color: string; level: number } | null,
  ) {
    super();
    this.mat = new THREE.MeshStandardMaterial({ color: '#15171b', emissive: '#000', roughness: 0.3 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.0012, 16), this.mat);
    m.position.y = 0.0006;
    this.object.add(m);
  }
  update(c: PartCtx): void {
    const s = this.fn(c);
    setEmissive(this.mat, s?.color ?? '#000', s?.level ?? 0, 2.5);
  }
}

export class SwitchPart extends Part {
  private lever: THREE.Mesh;
  constructor(
    id: string,
    label: string,
    private state: (c: PartCtx) => -1 | 0 | 1,
  ) {
    super();
    this.id = id;
    this.label = label;
    const M = mats();
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.003, 0.006, 2, 0.001), M.plasticDark);
    base.position.y = 0.0015;
    this.lever = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.006, 0.003), M.chrome);
    this.lever.position.y = 0.005;
    this.object.add(base, this.lever);
    this.addHit(base);
    this.addHit(this.lever);
  }
  update(c: PartCtx): void {
    this.lever.position.x = this.state(c) * 0.0035;
  }
  down(_p: PointerInfo, c: PartCtx): void {
    c.reg.press(this.id!, 'ui');
  }
  up(_p: PointerInfo, c: PartCtx): void {
    c.reg.release(this.id!, 'ui');
  }
  valueText(c: PartCtx): string {
    return ['A', 'THRU', 'B'][this.state(c) + 1];
  }
}
