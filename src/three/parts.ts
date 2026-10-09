/*
 * Interactive 3D hardware parts. Each part is bound to a registry control id
 * (side tokens deck.L / deck.R resolve through the active deck layer), reads
 * its visual state every frame and turns pointer gestures into control input.
 *
 * Board space: metres, +X right, +Y up, +Z towards the DJ.
 */
import * as THREE from 'three';
import { faderCapGeometry, knurledKnob } from './realism';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ControlRegistry } from '../core/controls';
import { ledColor } from '../core/controls';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Deck } from '../audio/Deck';
import { nearEnd } from '../core/prefs';
import { clamp } from '../core/util';
import { mats, slipmatTexture, strobeTexture, vinylTexture } from './materials';

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
  m.emissiveIntensity = level * gain;
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
    // knurled for grip: fine metal knurling on chrome knobs, rubber ridges on the rest
    const body = new THREE.Mesh(style === 'chrome' ? knurledKnob(r, h, 60, 0.02) : style === 'mini' ? knobGeometry(r, h) : knurledKnob(r, h, 32, 0.045), style === 'chrome' ? M.chrome : M.rubber);
    body.castShadow = true;
    this.spin.add(body);
    if (style !== 'chrome') {
      const capMat = capColor ? new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.35, metalness: 0.4 }) : M.plasticDark;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.0006, 32), capMat);
      cap.position.y = h + 0.0002;
      this.spin.add(cap);
    }
    const ind = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.0008, r * 0.14), 0.0008, r * 0.62), style === 'chrome' ? M.black : M.white);
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
    const line = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? 0.0012 : w * 0.85, 0.0004, axis === 'x' ? d * 0.85 : 0.0012), M.white);
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
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
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
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, w * 0.8), new THREE.MeshBasicMaterial({ map: symbolTexture(opts.symbol, shape === 'big' ? '#e8ecf2' : '#c7ced9'), transparent: true, depthWrite: false }));
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
      const lvl = st.on ? st.level : 0.04;
      if (this.ringMat) {
        setEmissive(this.ringMat, st.color, st.on ? st.level : 0.05, 3);
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
    this.mat = new THREE.MeshStandardMaterial({ color: '#1c1f24', roughness: 0.62, metalness: 0, emissive: '#000000' });
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
    setEmissive(this.mat, color, lvl, 2.6);
    this.mat.color.set(lvl > 0 ? color : '#1c1f24').multiplyScalar(lvl > 0 ? 0.25 : 1);
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

export class JogPart extends Part {
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
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.01, ringH, 96, 1), M.jogRing);
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
      topMat = M.aluminium;
    } else {
      this.screenCanvas = document.createElement('canvas');
      this.screenCanvas.width = this.screenCanvas.height = 256;
      this.screen = new THREE.CanvasTexture(this.screenCanvas);
      this.screen.colorSpace = THREE.SRGBColorSpace;
      topMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.12, metalness: 0.2, emissive: '#ffffff', emissiveMap: this.screen, emissiveIntensity: 1 });
    }
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR, 0.004, 96), [M.jogRing, topMat, M.jogRing]);
    plate.position.y = ringH + 0.002;
    plate.userData.zone = 'top';
    plate.castShadow = true;
    // cylinder groups: 0 side, 1 top, 2 bottom → map top UVs for the screen
    this.top.add(plate);
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
    const S = 256;
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    const cx = S / 2;
    const cy = S / 2;
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
    // rotating position marker (clockwise in board space)
    const a = -angle - Math.PI / 2;
    g.strokeStyle = touched ? '#ffffff' : '#e7ecf3';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 72, cy + Math.sin(a) * 72);
    g.lineTo(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96);
    g.stroke();
    // tempo text
    g.fillStyle = '#9fe7ff';
    g.font = '700 22px "JetBrains Mono", monospace';
    g.textAlign = 'center';
    if (d.loaded) g.fillText(d.bpm.toFixed(1), cx, cy + 88);
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

export class PlatterPart extends Part {
  private platter = new THREE.Group();
  private record = new THREE.Group();
  private labelTex: THREE.CanvasTexture;
  private labelCanvas: HTMLCanvasElement;
  private labelFor = '';
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
    const ph = 0.028;
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
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.151, 0.151, 0.003, 96), [new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: slipmatTexture('DECKHOUSE', accent), roughness: 0.95 }), M.black]);
    mat.position.y = ph + 0.0015;
    mat.userData.zone = 'top';
    this.platter.add(mat);
    this.object.add(this.platter);

    // record
    const vinyl = new THREE.MeshStandardMaterial({ map: vinylTexture(), roughness: 0.28, metalness: 0.15, color: 0xffffff });
    const rec = new THREE.Mesh(new THREE.CylinderGeometry(0.1524, 0.1524, 0.0018, 128), [M.black, vinyl, M.black]);
    rec.position.y = ph + 0.0045;
    rec.userData.zone = 'top';
    rec.castShadow = true;
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = this.labelCanvas.height = 256;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    const labelMesh = new THREE.Mesh(new THREE.CircleGeometry(0.05, 64), new THREE.MeshStandardMaterial({ map: this.labelTex, roughness: 0.6 }));
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.y = ph + 0.0056;
    labelMesh.userData.zone = 'top';
    this.record.add(rec, labelMesh);
    this.object.add(this.record);
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.018, 16), M.chrome);
    spindle.position.y = ph + 0.009;
    this.object.add(spindle);
    this.topY = ph + 0.0055;
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

  private drawLabel(d: Deck): void {
    const g = this.labelCanvas.getContext('2d')!;
    const S = 256;
    g.fillStyle = this.accent;
    g.fillRect(0, 0, S, S);
    const art = d.track?.meta.art;
    const finish = () => {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, S * 0.62, S, S * 0.22);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = '700 22px "Barlow Condensed", sans-serif';
      g.fillText((d.track?.meta.title ?? '').slice(0, 22), S / 2, S * 0.7);
      g.font = '600 16px "Barlow Condensed", sans-serif';
      g.fillText((d.track?.meta.artist ?? '').slice(0, 26), S / 2, S * 0.78);
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(S / 2, S / 2, 7, 0, Math.PI * 2);
      g.fill();
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
      g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
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
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.012, 32), M.chrome);
    base.position.y = 0.006;
    this.object.add(base);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 16), M.black);
    post.position.y = 0.025;
    this.object.add(post);
    // arm points along local −Z; rotating the group swings it
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, this.L, 12), M.chrome);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.04, -this.L / 2);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.006, 0.034), M.black);
    head.position.set(0, 0.037, -this.L - 0.01);
    const cart = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.016), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4 }));
    cart.position.set(0, 0.03, -this.L - 0.008);
    const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.026, 24), M.chrome);
    weight.rotation.x = Math.PI / 2;
    weight.position.set(0, 0.04, 0.045);
    const lift = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.02), M.chrome);
    lift.position.set(0.012, 0.038, -this.L - 0.02);
    [tube, head, cart, weight, lift].forEach((m) => {
      m.castShadow = true;
      this.arm.add(m);
      this.addHit(m);
    });
    this.object.add(this.arm);

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
    const hit = planeHit(ray, surfaceWorldY(this.object, 0.04));
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
  ) {
    super();
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(w + 0.008, 0.004, d + 0.008, 2, 0.002), mats().plasticDark);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    glass.rotation.x = -Math.PI / 2;
    glass.position.y = 0.0021;
    const holder = new THREE.Group();
    holder.add(bezel, glass);
    holder.rotation.x = tilt;
    holder.position.y = 0.002 + Math.abs(Math.sin(tilt)) * d * 0.5;
    this.object.add(holder);
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
