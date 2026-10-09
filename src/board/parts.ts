/*
 * The Board Builder's standard parts (Section 13.5), every one restylable:
 * knobs, faders, buttons, pad grids, jog wheels (any platter), screens,
 * meters, plus the composite mixer, transport and FX unit, and the panels
 * boards are built from. Each takes its look and behaviour from the
 * component's settings (format.ts → CommonProps): shape, material, three
 * colour zones, glow, label, function, feel, touch sound, idle animation.
 *
 * TODO: procedural stand-ins for the Blender component models (Section 14).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ControlRegistry } from '../core/controls';
import { ledColor } from '../core/controls';
import { nameService } from '../name/NameService';
import { Part, planeHit, type PartCtx, type PointerInfo } from '../three/parts';
import type { BoardComponent, CommonProps } from './format';
import { applyCurve, detent, invertCurve, touchSound } from './feel';
import { boardMaterial, type MatSpec } from './materials';

import type { BoardHooks } from './hooks';

export type { BoardHooks };

export interface BoardEnv {
  reg: ControlRegistry;
  hooks: BoardHooks;
}

const tmp = new THREE.Vector3();

/** material for one of the component's colour zones */
export function zoneMat(p: CommonProps, zone: 0 | 1 | 2, glow = false, idOverride?: MatSpec['id']): THREE.MeshStandardMaterial {
  return boardMaterial({ id: idOverride ?? (zone === 0 ? p.material : zone === 1 ? (p.material === 'chrome' || p.material === 'gold' ? p.material : 'gloss') : 'gloss'), color: p.colors[zone], glow: glow ? p.glow : null, image: p.image as string | undefined });
}

const ledMats = new Map<string, THREE.MeshStandardMaterial>();
/** an LED that lights: its own material (its colour changes) */
function ledMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#0c0d10', emissive: '#000000', roughness: 0.35 });
}
void ledMats;

/** text for labels: drawn once into a small texture */
const labelCache = new Map<string, THREE.CanvasTexture>();
function labelTexture(text: string, font: CommonProps['label']['font'], color: string): THREE.CanvasTexture {
  const key = `${text}|${font}|${color}`;
  let t = labelCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  const fam = font === 'mono' ? "'JetBrains Mono', monospace" : font === 'marker' ? "'Permanent Marker', cursive" : font === 'script' ? "'Pacifico', cursive" : "'Barlow Condensed', sans-serif";
  g.font = `700 40px ${fam}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text.toUpperCase() === text || font !== 'label' ? text : text.toUpperCase(), 128, 34, 248);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(key, t);
  return t;
}

export abstract class BPart extends Part {
  /** what the idle animation moves */
  protected animGroup = new THREE.Group();
  protected pos = 0;
  private animT = Math.random() * 10;
  /** the control this part drives: its own function, or the board's control for this component */
  readonly target: string;

  constructor(
    readonly comp: BoardComponent,
    protected env: BoardEnv,
  ) {
    super();
    const p = comp.props;
    this.target = p.fn || `board.${comp.id}`;
    this.id = this.target;
    this.label = p.label.text || p.name || comp.type;
    this.object.add(this.animGroup);
  }

  protected get p(): CommonProps {
    return this.comp.props;
  }

  /** a label above, below or on the part, `w` wide, at `z` */
  protected addLabel(w: number, zAbove: number, zBelow: number, y: number): void {
    const l = this.p.label;
    if (!l.text || l.place === 'none') return;
    const tex = labelTexture(l.text, l.font, this.p.colors[1]);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, y + 0.0004, l.place === 'above' ? zAbove : l.place === 'below' ? zBelow : 0);
    this.object.add(m);
  }

  protected sound(): void {
    touchSound(this.p.sound, this.env.hooks.audio());
  }

  /** the idle animation, and anything the part draws each frame */
  update(c: PartCtx): void {
    const a = this.p.anim;
    if (a === 'none') return;
    this.animT += c.dt;
    const g = this.animGroup;
    if (a === 'spin') g.rotation.y += c.dt * 1.2;
    else if (a === 'bob') g.position.y = Math.sin(this.animT * 3) * 0.004;
    else if (a === 'pulse') g.scale.setScalar(1 + Math.max(0, Math.sin(this.animT * 6)) * 0.04);
  }

  /** set the target's value from a position (0..1), through the feel curve */
  protected send(pos: number, c: PartCtx): void {
    this.pos = Math.min(1, Math.max(0, pos));
    c.reg.setValue(this.target, applyCurve(this.pos, this.p.feel.curve), 'ui');
  }

  /** where the target's value puts the part (it may have moved from MIDI or the screen) */
  protected readPos(c: PartCtx): number {
    return invertCurve(c.reg.value(this.target), this.p.feel.curve);
  }
}

/* ------------------------------ knob ------------------------------ */

function knobBody(shape: string, r: number, h: number): THREE.BufferGeometry {
  if (shape === 'hex') return new THREE.CylinderGeometry(r, r, h, 6).translate(0, h / 2, 0);
  if (shape === 'chicken') {
    // a chicken-head pointer: a tapered wedge on a short cylinder
    const s = new THREE.Shape();
    s.moveTo(-r * 0.55, r * 0.7);
    s.lineTo(r * 0.55, r * 0.7);
    s.lineTo(r * 0.18, -r * 1.35);
    s.lineTo(-r * 0.18, -r * 1.35);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h * 0.7, bevelEnabled: true, bevelSize: r * 0.08, bevelThickness: r * 0.08, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, h * 0.3, 0);
    return g;
  }
  if (shape === 'pointer') return new THREE.CylinderGeometry(r * 0.85, r, h, 32).translate(0, h / 2, 0);
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r * 1.06, 0), new THREE.Vector2(r * 1.06, h * 0.18), new THREE.Vector2(r, h * 0.26), new THREE.Vector2(r * 0.96, h * 0.85), new THREE.Vector2(r * 0.88, h), new THREE.Vector2(0, h)];
  return new THREE.LatheGeometry(pts, shape === 'cap' ? 48 : 32);
}

export class BKnob extends BPart {
  private spin = new THREE.Group();
  private ring: THREE.InstancedMesh | null = null;
  private v0 = 0;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    this.cursor = 'ns-resize';
    const p = this.p;
    const r = (p.size as number) || 0.011;
    const h = r * 1.4;
    const body = new THREE.Mesh(knobBody(p.shape ?? 'round', r, h), zoneMat(p, 0, true));
    body.castShadow = true;
    this.spin.add(body);
    if (p.shape !== 'chicken') {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.78, 0.0006, 32), zoneMat(p, 1));
      cap.position.y = h + 0.0003;
      this.spin.add(cap);
    }
    const ind = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.0008, r * 0.14), 0.0009, r * 0.6), zoneMat(p, 2, true));
    ind.position.set(0, h + 0.0007, -r * 0.5);
    this.spin.add(ind);
    this.animGroup.add(this.spin);
    this.addHit(body);
    if (p.ring) {
      const n = 15;
      const geo = new THREE.CircleGeometry(0.0009, 10).rotateX(-Math.PI / 2);
      this.ring = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const a = ((-150 + (i / (n - 1)) * 300) * Math.PI) / 180;
        m.makeTranslation(Math.sin(a) * r * 1.5, 0.0004, -Math.cos(a) * r * 1.5);
        this.ring.setMatrixAt(i, m);
        this.ring.setColorAt(i, new THREE.Color(0x111111));
      }
      this.object.add(this.ring);
    }
    this.addLabel(r * 3.2, -r * 2.1, r * 2.1, 0);
  }

  update(c: PartCtx): void {
    super.update(c);
    const ctl = c.reg.get(this.target);
    if (ctl?.kind === 'encoder') return;
    const pos = this.readPos(c);
    this.spin.rotation.y = -(pos - 0.5) * ((300 * Math.PI) / 180);
    if (this.ring) {
      const on = new THREE.Color(this.p.colors[2]);
      const off = new THREE.Color(0x15171b);
      const n = this.ring.count;
      for (let i = 0; i < n; i++) this.ring.setColorAt(i, i / (n - 1) <= pos + 1e-6 ? on : off);
      this.ring.instanceColor!.needsUpdate = true;
    }
  }

  down(_p: PointerInfo, c: PartCtx): void {
    this.v0 = this.readPos(c);
  }

  move(p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.target);
    if (ctl?.kind === 'encoder') {
      if (Math.abs(p.dy) > 14) {
        ctl.step(p.dy < 0 ? 1 : -1);
        this.sound();
      }
      return;
    }
    const sens = this.p.feel.sensitivity;
    let next = this.v0 - (p.dy / (p.shift ? 900 : 170)) * sens;
    const n = this.p.feel.detents;
    if (n > 1) {
      const before = detent(this.pos, n);
      next = detent(next, n);
      if (next !== before) this.sound();
    }
    this.send(next, c);
  }

  wheel(delta: number, c: PartCtx): void {
    const n = this.p.feel.detents;
    const step = n > 1 ? 1 / (n - 1) : 0.03 * this.p.feel.sensitivity;
    this.send(this.readPos(c) + Math.sign(delta) * step, c);
    if (n > 1) this.sound();
  }

  double(c: PartCtx): void {
    const ctl = c.reg.get(this.target);
    if (ctl?.kind === 'continuous') c.reg.setValue(this.target, ctl.def, 'ui');
  }

  valueText(c: PartCtx): string {
    const ctl = c.reg.get(this.target);
    if (ctl?.kind === 'continuous') return ctl.format ? ctl.format(ctl.get()) : `${Math.round(ctl.get() * 100)}%`;
    return ctl ? '' : 'Not connected: pick a function in the inspector';
  }
}

/* ------------------------------ fader ------------------------------ */

export class BFader extends BPart {
  private cap: THREE.Mesh;
  private len: number;
  private horiz: boolean;
  private grab = 0;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    this.len = (p.length as number) || 0.06;
    this.horiz = p.orient === 'horizontal';
    this.cursor = this.horiz ? 'ew-resize' : 'ns-resize';
    const track = new THREE.Mesh(new THREE.BoxGeometry(this.horiz ? this.len + 0.01 : 0.004, 0.002, this.horiz ? 0.004 : this.len + 0.01), zoneMat(p, 0));
    track.position.y = 0.001;
    this.object.add(track);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(this.horiz ? this.len : 0.0015, 0.0006, this.horiz ? 0.0015 : this.len), boardMaterial({ id: 'matte', color: '#050506' }));
    slot.position.y = 0.0021;
    this.object.add(slot);
    const shape = p.shape ?? 'square';
    const cw = shape === 'tall' ? 0.012 : shape === 'tbar' ? 0.02 : 0.014;
    const cd = shape === 'tbar' ? 0.006 : shape === 'round' ? 0.012 : 0.009;
    const ch = shape === 'tall' ? 0.014 : 0.009;
    const geo = shape === 'round' ? new THREE.CylinderGeometry(cd / 2, cd / 2, ch, 24) : new RoundedBoxGeometry(this.horiz ? cd : cw, ch, this.horiz ? cw : cd, 2, 0.0015);
    this.cap = new THREE.Mesh(geo, zoneMat(p, 1, true));
    this.cap.position.y = ch / 2 + 0.002;
    this.cap.castShadow = true;
    const line = new THREE.Mesh(new THREE.BoxGeometry(this.horiz ? 0.0008 : cw * 0.9, 0.0005, this.horiz ? cw * 0.9 : 0.0008), zoneMat(p, 2, true));
    line.position.y = ch / 2 + 0.0003;
    this.cap.add(line);
    this.animGroup.add(this.cap);
    this.addHit(this.cap);
    this.addHit(track);
    this.addLabel(0.04, -this.len / 2 - 0.012, this.len / 2 + 0.012, 0);
  }

  private place(pos: number): void {
    const off = (pos - 0.5) * this.len;
    // vertical faders: up (away from you, −z) is more
    if (this.horiz) this.cap.position.x = off;
    else this.cap.position.z = -off;
  }

  update(c: PartCtx): void {
    super.update(c);
    this.place(this.readPos(c));
  }

  private posAt(ray: THREE.Ray): number | null {
    tmp.set(0, 0.008, 0);
    this.object.localToWorld(tmp);
    const hit = planeHit(ray, tmp.y);
    if (!hit) return null;
    this.object.worldToLocal(hit);
    return this.horiz ? hit.x / this.len + 0.5 : -hit.z / this.len + 0.5;
  }

  down(p: PointerInfo, c: PartCtx): void {
    const at = this.posAt(p.ray);
    const cur = this.readPos(c);
    // grabbing the cap keeps it under the pointer; clicking the track jumps (heavier faders jump less)
    this.grab = at === null ? 0 : p.object === this.cap ? at - cur : (at - cur) * this.p.feel.resistance;
    if (at !== null && p.object !== this.cap) this.send(at - this.grab, c);
    this.sound();
  }

  move(p: PointerInfo, c: PartCtx): void {
    const at = this.posAt(p.ray);
    if (at === null) return;
    const want = at - this.grab;
    // resistance: a heavy fader lags behind the hand a touch
    const cur = this.readPos(c);
    const k = 1 - this.p.feel.resistance * 0.6;
    this.send(cur + (want - cur) * Math.max(0.15, k) * this.p.feel.sensitivity, c);
  }

  wheel(delta: number, c: PartCtx): void {
    this.send(this.readPos(c) + delta * 0.03, c);
  }

  double(c: PartCtx): void {
    const ctl = c.reg.get(this.target);
    if (ctl?.kind === 'continuous') c.reg.setValue(this.target, ctl.def, 'ui');
  }

  valueText(c: PartCtx): string {
    const ctl = c.reg.get(this.target);
    return ctl?.kind === 'continuous' ? (ctl.format ? ctl.format(ctl.get()) : `${Math.round(ctl.get() * 100)}%`) : ctl ? '' : 'Not connected';
  }
}

/* ------------------------------ button ------------------------------ */

function buttonGeo(shape: string, w: number, d: number, h: number): THREE.BufferGeometry {
  if (shape === 'round' || shape === 'big') return new THREE.CylinderGeometry(w / 2, w / 2, h, 32).translate(0, h / 2, 0);
  if (shape === 'pill') return new RoundedBoxGeometry(w, h, d, 3, Math.min(w, d) / 2.2).translate(0, h / 2, 0);
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(w, d) * 0.15).translate(0, h / 2, 0);
}

export class BButton extends BPart {
  private led: THREE.MeshStandardMaterial;
  private top: THREE.Mesh;
  private held = false;
  private h: number;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const shape = p.shape ?? 'square';
    const w = (p.w as number) || (shape === 'big' ? 0.05 : 0.016);
    const d = shape === 'round' || shape === 'big' ? w : (p.d as number) || (shape === 'pill' ? w * 0.5 : w * (shape === 'rect' ? 0.55 : 1));
    this.h = shape === 'big' ? 0.02 : 0.006;
    const base = new THREE.Mesh(buttonGeo(shape, w * 1.12, d * 1.12, 0.002), zoneMat(p, 0));
    this.object.add(base);
    this.led = ledMat();
    this.led.color.set(p.colors[1]);
    this.top = new THREE.Mesh(buttonGeo(shape, w, d, this.h), [this.led, this.led, this.led]);
    this.top.position.y = 0.0015;
    this.top.castShadow = true;
    this.animGroup.add(this.top);
    this.addHit(this.top);
    this.addLabel(Math.max(0.03, w * 1.6), -d / 2 - 0.008, d / 2 + 0.008, this.h);
  }

  update(c: PartCtx): void {
    super.update(c);
    const ctl = c.reg.get(this.target);
    let lit = ledColor(c.reg.lit(this.target), this.p.colors[2]);
    if (ctl?.kind === 'continuous') lit = { on: ctl.get() > 0.5, color: this.p.colors[2], level: 1 };
    const glow = this.p.glow.intensity;
    this.led.emissive.set(lit.on ? lit.color : this.p.glow.color);
    this.led.emissiveIntensity = lit.on ? lit.level * 2.2 : glow * 0.8;
    this.top.position.y = 0.0015 - (this.held ? this.h * 0.35 : 0);
  }

  down(_p: PointerInfo, c: PartCtx): void {
    this.held = true;
    this.sound();
    const ctl = c.reg.get(this.target);
    if (ctl?.kind === 'continuous') c.reg.setValue(this.target, ctl.get() > 0.5 ? 0 : 1, 'ui');
    else c.reg.press(this.target, 'ui');
  }

  up(_p: PointerInfo, c: PartCtx): void {
    this.held = false;
    c.reg.release(this.target, 'ui');
  }
}

/* ------------------------------ pad grid ------------------------------ */

/** one pad of a grid (its own control id) */
class GridPad extends Part {
  led: THREE.MeshStandardMaterial;
  held = false;
  constructor(
    id: string,
    label: string,
    readonly mesh: THREE.Mesh,
  ) {
    super();
    this.id = id;
    this.label = label;
    this.led = mesh.material as THREE.MeshStandardMaterial;
    this.object.add(mesh);
    this.addHit(mesh);
  }
  down(_p: PointerInfo, c: PartCtx): void {
    this.held = true;
    c.reg.press(this.id!, 'ui');
  }
  up(_p: PointerInfo, c: PartCtx): void {
    this.held = false;
    c.reg.release(this.id!, 'ui');
  }
}

export class BPads extends BPart {
  readonly pads: GridPad[] = [];

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const rows = Math.max(1, Math.min(16, (p.rows as number) || 2));
    const cols = Math.max(1, Math.min(16, (p.cols as number) || 4));
    const s = (p.size as number) || 0.018;
    const gap = s * 0.18;
    const base = (p.base as string) || 'deck.L.pad.{n}';
    const W = cols * s + (cols - 1) * gap;
    const D = rows * s + (rows - 1) * gap;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(W + gap * 2, 0.003, D + gap * 2, 2, 0.002), zoneMat(p, 0));
    plate.position.y = 0.0015;
    this.object.add(plate);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const n = r * cols + c + 1;
        const m = new THREE.Mesh(new RoundedBoxGeometry(s, 0.004, s, 2, s * 0.12).translate(0, 0.005, 0), ledMat());
        (m.material as THREE.MeshStandardMaterial).color.set(p.colors[1]);
        m.castShadow = true;
        const pad = new GridPad(base.replace('{n}', String(n)), `Pad ${n}`, m);
        pad.object.position.set(-W / 2 + s / 2 + c * (s + gap), 0, -D / 2 + s / 2 + r * (s + gap));
        this.animGroup.add(pad.object);
        this.pads.push(pad);
        for (const h of pad.hit) this.hit.push(h);
      }
    this.addLabel(Math.min(W, 0.08), -D / 2 - 0.01, D / 2 + 0.01, 0.003);
  }

  update(c: PartCtx): void {
    super.update(c);
    for (const pad of this.pads) {
      const lit = ledColor(c.reg.lit(pad.id!), this.p.colors[2]);
      pad.led.emissive.set(lit.on ? lit.color : this.p.glow.color);
      pad.led.emissiveIntensity = lit.on ? lit.level * 1.8 : this.p.glow.intensity * 0.6 + (pad.held ? 0.8 : 0);
      pad.object.position.y = pad.held ? -0.001 : 0;
    }
  }
}

/* ------------------------------ jog wheel ------------------------------ */

const PLATTERS: Record<string, MatSpec['id']> = { vinyl: 'gloss', metal: 'brushed', led: 'matte', glass: 'frosted', liquid: 'liquid', holo: 'holo' };

export class BJog extends BPart {
  private spin = new THREE.Group();
  private ringLed: THREE.MeshStandardMaterial;
  private screen: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } | null = null;
  private last = 0;
  private zone: 'top' | 'ring' = 'top';
  private r: number;
  private deck: number;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    this.cursor = 'grab';
    this.deck = Math.max(1, Math.min(4, (p.deck as number) || 1));
    this.r = (p.size as number) || 0.07;
    this.id = p.fn || `deck.${this.deck}.jog`;
    (this as { target: string }).target = this.id;
    this.label = `Deck ${this.deck} jog`;
    const r = this.r;
    const ringH = 0.014;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.01, ringH, 96), zoneMat(p, 0));
    ring.position.y = ringH / 2;
    ring.castShadow = true;
    ring.userData.zone = 'ring';
    this.object.add(ring);
    this.addHit(ring);
    this.ringLed = ledMat();
    const led = new THREE.Mesh(new THREE.TorusGeometry(r * 0.82, Math.max(0.0012, r * 0.02), 8, 96), this.ringLed);
    led.rotation.x = Math.PI / 2;
    led.position.y = ringH + 0.001;
    this.object.add(led);
    const style = (p.platter as string) || 'vinyl';
    const topR = r * 0.8;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR, 0.004, 96), boardMaterial({ id: PLATTERS[style] ?? 'gloss', color: style === 'vinyl' ? '#0c0c0e' : p.colors[1], glow: style === 'led' ? { color: p.colors[2], intensity: 0.6, beat: true } : p.glow }));
    plate.position.y = ringH + 0.002;
    plate.userData.zone = 'top';
    this.spin.add(plate);
    if (style === 'vinyl') {
      // grooves and a label
      const grooves = new THREE.Mesh(new THREE.RingGeometry(topR * 0.38, topR * 0.97, 96, 6), new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.25, metalness: 0.3 }));
      grooves.rotation.x = -Math.PI / 2;
      grooves.position.y = ringH + 0.0041;
      this.spin.add(grooves);
    }
    const display = (p.display as string) || 'art';
    if (display !== 'none') {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.screen = { canvas, tex };
      const disc = new THREE.Mesh(new THREE.CircleGeometry(topR * 0.36, 48), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = ringH + 0.0046;
      this.object.add(disc);
    }
    const marker = new THREE.Mesh(new THREE.BoxGeometry(r * 0.04, 0.0008, topR * 0.3), zoneMat(p, 2, true));
    marker.position.set(0, ringH + 0.0044, -topR * 0.8);
    this.spin.add(marker);
    this.animGroup.add(this.spin);
    this.addHit(plate);
    this.addLabel(r * 1.2, -r - 0.012, r + 0.012, 0);
  }

  update(c: PartCtx): void {
    super.update(c);
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'jog') return;
    const d = c.engine.deck(this.deck);
    this.spin.rotation.y = ctl.angle();
    const touched = ctl.touched();
    this.ringLed.emissive.set(touched ? '#ffffff' : this.p.colors[2]);
    this.ringLed.emissiveIntensity = (touched ? 1 : d.playing ? 0.6 : d.loaded ? 0.2 : 0.05) * 2.2;
    if (this.screen && c.frame % 3 === 0) this.drawCenter(c);
  }

  private drawCenter(c: PartCtx): void {
    const g = this.screen!.canvas.getContext('2d')!;
    const S = 256;
    const d = c.engine.deck(this.deck);
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, S, S);
    const kind = (this.p.display as string) || 'art';
    if (kind === 'name') {
      nameService.draw(this.screen!.canvas, 'chrome_led', nameService.text, { bg: '#05060a' });
    } else if (kind === 'wave' && d.analysis?.waveform) {
      const w = d.analysis.waveform as unknown as { peaks?: Float32Array };
      const peaks = w.peaks;
      const at = d.duration > 0 ? d.position() / d.duration : 0;
      g.strokeStyle = this.p.colors[2];
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 0; x < S; x += 3) {
        const i = peaks ? Math.floor((at + (x - S / 2) / S / 20) * peaks.length) : 0;
        const v = peaks && i >= 0 && i < peaks.length ? peaks[i] : 0;
        g.moveTo(x, S / 2 - v * 90);
        g.lineTo(x, S / 2 + v * 90);
      }
      g.stroke();
    } else {
      g.fillStyle = this.p.colors[2];
      g.font = '700 54px "JetBrains Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(d.loaded ? d.bpm.toFixed(1) : '--', S / 2, S / 2 - 18);
      g.font = '600 26px "Barlow Condensed", sans-serif';
      g.fillStyle = '#c9d2e0';
      g.fillText(`DECK ${this.deck}`, S / 2, S / 2 + 38);
    }
    this.screen!.tex.needsUpdate = true;
  }

  private angleAt(ray: THREE.Ray): number | null {
    tmp.set(0, 0.018, 0);
    this.object.localToWorld(tmp);
    const hit = planeHit(ray, tmp.y);
    if (!hit) return null;
    this.object.worldToLocal(hit);
    return Math.atan2(hit.z, hit.x);
  }

  down(p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'jog') return;
    this.zone = (p.object.userData.zone as 'top' | 'ring') ?? 'top';
    ctl.touch(this.zone);
    this.last = this.angleAt(p.ray) ?? 0;
    c.reg.mark(this.id!, 'ui');
  }

  move(p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (!ctl || ctl.kind !== 'jog') return;
    const a = this.angleAt(p.ray);
    if (a === null) return;
    let d = a - this.last;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.last = a;
    if (Math.abs(d) > 1e-5) ctl.turn((d / (Math.PI * 2)) * this.p.feel.sensitivity, this.zone);
  }

  up(_p: PointerInfo, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl?.kind === 'jog') ctl.touch(null);
  }

  wheel(delta: number, c: PartCtx): void {
    const ctl = c.reg.get(this.id!);
    if (ctl?.kind === 'jog') ctl.turn(delta * 0.02, 'ring');
  }

  valueText(): string {
    return 'top: scratch · edge: nudge';
  }
}

/* ------------------------------ screen ------------------------------ */

export class BScreen extends BPart {
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private glass: THREE.MeshBasicMaterial;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const w = (p.w as number) || 0.12;
    const d = (p.d as number) || 0.07;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = Math.round((512 * d) / w);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(w + 0.008, 0.006, d + 0.008, 2, 0.002), zoneMat(p, 0));
    bezel.position.y = 0.003;
    const tilt = new THREE.Group();
    tilt.rotation.x = (p.tilt as number) ?? -0.5;
    tilt.position.set(0, 0.006, d / 2);
    bezel.position.z = -d / 2;
    tilt.add(bezel);
    this.glass = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.glass);
    scr.rotation.x = -Math.PI / 2;
    scr.position.set(0, 0.0062, -d / 2);
    tilt.add(scr);
    this.animGroup.add(tilt);
    this.addHit(bezel);
    this.cursor = 'default';
  }

  update(c: PartCtx): void {
    super.update(c);
    const kind = (this.p.kind as string) || 'wave';
    if (kind === 'crowd') {
      const feed = this.env.hooks.crowdFeed();
      if (feed && this.glass.map !== feed) {
        this.glass.map = feed;
        this.glass.needsUpdate = true;
      }
      return;
    }
    if (c.frame % 3 !== 0) return;
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#04050a';
    g.fillRect(0, 0, W, H);
    const deck = Math.max(1, Math.min(4, (this.p.deck as number) || 1));
    const d = c.engine.deck(deck);
    if (kind === 'name') {
      nameService.draw(this.canvas, 'pixel_led', nameService.text, { bg: '#04050a' });
    } else if (kind === 'track') {
      g.fillStyle = '#fff';
      g.font = '700 46px "Barlow Condensed", sans-serif';
      g.fillText(d.track?.meta.title ?? 'No track', 20, 60, W - 40);
      g.fillStyle = '#9aa3b4';
      g.font = '500 32px "Barlow Condensed", sans-serif';
      g.fillText(d.track?.meta.artist ?? '', 20, 104, W - 40);
      g.fillStyle = this.p.colors[2];
      g.font = '700 40px "JetBrains Mono", monospace';
      g.fillText(d.loaded ? `${d.bpm.toFixed(1)} BPM` : '', 20, H - 30);
    } else if (kind === 'clock') {
      g.fillStyle = this.p.colors[2];
      g.font = `700 ${Math.round(H * 0.5)}px "JetBrains Mono", monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(new Date().toTimeString().slice(0, 5), W / 2, H / 2);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    } else {
      // the waveform around the playhead
      const [l, r] = c.levels(deck);
      g.fillStyle = this.p.colors[2];
      const t = c.now;
      for (let x = 0; x < W; x += 4) {
        const v = (0.25 + 0.75 * Math.abs(Math.sin(x * 0.05 + t * 6) * Math.sin(x * 0.013 + t))) * Math.max(l, r, 0.08);
        g.fillRect(x, H / 2 - v * H * 0.45, 3, v * H * 0.9);
      }
      g.fillStyle = '#fff';
      g.fillRect(W / 2 - 1, 0, 2, H);
    }
    this.tex.needsUpdate = true;
  }
}

/* ------------------------------ meter ------------------------------ */

export class BMeter extends BPart {
  private segs: THREE.InstancedMesh | null = null;
  private needle: THREE.Mesh | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private level = 0;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const kind = (p.kind as string) || 'led';
    const len = (p.length as number) || 0.06;
    this.cursor = 'default';
    const base = new THREE.Mesh(new RoundedBoxGeometry(kind === 'led' ? 0.012 : len, 0.004, kind === 'led' ? len : len * 0.6, 2, 0.0015), zoneMat(p, 0));
    base.position.y = 0.002;
    this.object.add(base);
    this.addHit(base);
    if (kind === 'led') {
      const n = 16;
      this.segs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.007, 0.001, (len / n) * 0.7), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        m.makeTranslation(0, 0.0045, len / 2 - (i + 0.5) * (len / n));
        this.segs.setMatrixAt(i, m);
        this.segs.setColorAt(i, new THREE.Color(0x111111));
      }
      this.object.add(this.segs);
    } else if (kind === 'needle') {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.9, len * 0.5), boardMaterial({ id: 'matte', color: '#f1e6c8', glow: { color: '#ffcf7a', intensity: 0.3, beat: false } }));
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.0042;
      this.object.add(face);
      this.needle = new THREE.Mesh(new THREE.BoxGeometry(0.0008, 0.0006, len * 0.42).translate(0, 0, -len * 0.21), boardMaterial({ id: 'matte', color: '#1a1a1a' }));
      this.needle.position.set(0, 0.0046, len * 0.22);
      this.object.add(this.needle);
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 256;
      this.canvas.height = 128;
      this.tex = new THREE.CanvasTexture(this.canvas);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.92, len * 0.52), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
      scr.rotation.x = -Math.PI / 2;
      scr.position.y = 0.0042;
      this.object.add(scr);
    }
  }

  update(c: PartCtx): void {
    super.update(c);
    const src = this.p.source;
    const [l, r] = typeof src === 'number' && src >= 1 ? c.levels(src) : c.master();
    const lv = Math.max(l, r);
    this.level = Math.max(lv, this.level - c.dt * 1.5);
    if (this.segs) {
      const n = this.segs.count;
      const lit = Math.round(this.level * n);
      const a = new THREE.Color(this.p.colors[2]);
      const red = new THREE.Color('#ff2e2e');
      const off = new THREE.Color(0x111216);
      for (let i = 0; i < n; i++) this.segs.setColorAt(i, i < lit ? (i > n * 0.82 ? red : a) : off);
      this.segs.instanceColor!.needsUpdate = true;
    } else if (this.needle) this.needle.rotation.y = 0.8 - this.level * 1.6;
    else if (this.canvas && this.tex && c.frame % 2 === 0) {
      const g = this.canvas.getContext('2d')!;
      g.fillStyle = '#03040a';
      g.fillRect(0, 0, 256, 128);
      g.strokeStyle = this.p.colors[2];
      g.fillStyle = this.p.colors[2];
      const kind = this.p.kind as string;
      const spec = c.engine.visAnalyser;
      const buf = new Uint8Array(kind === 'scope' ? spec.fftSize : spec.frequencyBinCount);
      if (kind === 'scope') {
        spec.getByteTimeDomainData(buf);
        g.lineWidth = 2;
        g.beginPath();
        for (let x = 0; x < 256; x++) {
          const v = buf[Math.floor((x / 256) * Math.min(buf.length, 2048))] / 255;
          if (x === 0) g.moveTo(x, v * 128);
          else g.lineTo(x, v * 128);
        }
        g.stroke();
      } else {
        spec.getByteFrequencyData(buf);
        const bars = 32;
        for (let b = 0; b < bars; b++) {
          const i = Math.floor(Math.pow(b / bars, 2) * buf.length * 0.5);
          const v = buf[i] / 255;
          g.fillRect(b * 8, 128 - v * 124, 6, v * 124);
        }
      }
      this.tex.needsUpdate = true;
    }
  }
}

/* ------------------------------ panel ------------------------------ */

/** the shapes boards are built from: plates, discs, L-shapes, rings, tiers */
export function panelGeometry(shape: string, w: number, d: number, h: number): THREE.BufferGeometry {
  if (shape === 'round') return new THREE.CylinderGeometry(w / 2, w / 2, h, 64).translate(0, h / 2, 0);
  if (shape === 'hex') return new THREE.CylinderGeometry(w / 2, w / 2, h, 6).translate(0, h / 2, 0);
  if (shape === 'ring') {
    const s = new THREE.Shape().absarc(0, 0, w / 2, 0, Math.PI * 2, false);
    s.holes.push(new THREE.Path().absarc(0, 0, w / 2 - Math.min(w, d) * 0.22, 0, Math.PI * 2, true));
    return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2);
  }
  if (shape === 'L') {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -d / 2);
    s.lineTo(w / 2, -d / 2);
    s.lineTo(w / 2, -d / 2 + d * 0.45);
    s.lineTo(-w / 2 + w * 0.45, -d / 2 + d * 0.45);
    s.lineTo(-w / 2 + w * 0.45, d / 2);
    s.lineTo(-w / 2, d / 2);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
  }
  if (shape === 'curve') {
    const s = new THREE.Shape().absarc(0, d, d * 1.6, -Math.PI * 0.5 - 0.6, -Math.PI * 0.5 + 0.6, false);
    s.absarc(0, d, d * 0.9, -Math.PI * 0.5 + 0.6, -Math.PI * 0.5 - 0.6, true);
    return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 48 }).rotateX(-Math.PI / 2);
  }
  if (shape === 'tier') {
    const g1 = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.006, h / 3)).translate(0, h / 2, 0);
    const g2 = new RoundedBoxGeometry(w * 0.8, h, d * 0.45, 2, Math.min(0.006, h / 3)).translate(0, h * 1.5, -d * 0.2);
    const merged = new THREE.BufferGeometry();
    const parts = [g1, g2].map((g) => g.toNonIndexed());
    const pos = parts.flatMap((g) => [...(g.getAttribute('position').array as Float32Array)]);
    const nor = parts.flatMap((g) => [...(g.getAttribute('normal').array as Float32Array)]);
    const uv = parts.flatMap((g) => [...(g.getAttribute('uv').array as Float32Array)]);
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return merged;
  }
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(0.006, h / 3, w / 4, d / 4)).translate(0, h / 2, 0);
}

export class BPanel extends BPart {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const m = new THREE.Mesh(panelGeometry(p.shape ?? 'rect', (p.w as number) || 0.4, (p.d as number) || 0.25, (p.h as number) || 0.03), zoneMat(p, 0, true));
    m.castShadow = true;
    m.receiveShadow = true;
    this.animGroup.add(m);
    this.addHit(m);
    this.cursor = 'default';
    // an engraving or print on top: the label
    const h = (p.h as number) || 0.03;
    const l = p.label;
    if (l.text && l.place !== 'none') {
      const tex = labelTexture(l.text, l.font, p.colors[1]);
      const w = Math.min(((p.w as number) || 0.4) * 0.6, 0.3);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      lab.rotation.x = -Math.PI / 2;
      lab.position.set(0, (p.shape === 'tier' ? h * 2 : h) + 0.0005, l.place === 'above' ? -((p.d as number) || 0.25) * 0.35 : l.place === 'below' ? ((p.d as number) || 0.25) * 0.35 : 0);
      this.object.add(lab);
    }
  }
}
