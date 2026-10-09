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
import { decal, faderCapGeometry, faderScaleTexture, glassSheen, grooveTexture, knobScaleTexture, knurlBumpTexture, knurledKnob, meterLegendTexture, screw, turnedMetalTexture } from '../three/realism';

/** the silk-screen print colour on a panel of this colour (light on dark, dark on light) */
function printOn(hex: string): string {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.5 ? '#2a2d33' : '#c9ced6';
}

/** turned-aluminium inserts (knob caps, jog plates), one per tint */
const turnedMats = new Map<string, THREE.MeshStandardMaterial>();
function turnedMat(tint: string): THREE.MeshStandardMaterial {
  let m = turnedMats.get(tint);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: tint, map: turnedMetalTexture(), metalness: 0.85, roughness: 0.32 });
    m.userData.boardShared = true;
    turnedMats.set(tint, m);
  }
  return m;
}

import type { BoardHooks } from './hooks';

export type { BoardHooks };

export interface BoardEnv {
  reg: ControlRegistry;
  hooks: BoardHooks;
}

const tmp = new THREE.Vector3();
const tmpC = new THREE.Color();

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
    const shape = p.shape ?? 'round';
    // a club mixer's EQ knob is about 17 mm across and 15 mm tall
    const r = (p.size as number) || 0.0085;
    const h = shape === 'cap' ? r * 1.25 : r * 1.75;
    const geo = shape === 'round' ? knurledKnob(r, h, 36, 0.045) : shape === 'cap' ? knurledKnob(r, h, 64, 0.022) : knobBody(shape, r, h);
    const body = new THREE.Mesh(geo, zoneMat(p, 0, true));
    body.castShadow = true;
    this.spin.add(body);
    if (shape !== 'chicken' && shape !== 'hex') {
      // the cap: a contrasting insert (turned aluminium on a metal knob)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.8, 0.0008, 40), shape === 'cap' ? turnedMat(p.colors[1]) : zoneMat(p, 1));
      cap.position.y = h + 0.0001;
      this.spin.add(cap);
    }
    // the pointer: a line from the centre to the edge, and down the side so it reads from low angles
    const ind = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.0008, r * 0.13), 0.0006, r * 0.62), zoneMat(p, 2, true));
    ind.position.set(0, h + 0.0007, -r * 0.48);
    this.spin.add(ind);
    if (shape === 'round' || shape === 'cap') {
      const notch = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, h * 0.55, 0.0006), zoneMat(p, 2, true));
      notch.position.set(0, h * 0.52, -r * 1.06);
      this.spin.add(notch);
    }
    this.animGroup.add(this.spin);
    this.addHit(body);
    if (p.ring) {
      const n = 15;
      const geo = new THREE.CircleGeometry(0.0009, 10).rotateX(-Math.PI / 2);
      this.ring = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const a = ((-150 + (i / (n - 1)) * 300) * Math.PI) / 180;
        m.makeTranslation(Math.sin(a) * r * 1.6, 0.0004, -Math.cos(a) * r * 1.6);
        this.ring.setMatrixAt(i, m);
        this.ring.setColorAt(i, new THREE.Color(0x111111));
      }
      this.object.add(this.ring);
    } else {
      // the printed scale round it, as on a faceplate
      const sc = decal(knobScaleTexture('#c9ced6', /\.(hi|mid|low|filter|eq|pan)/.test(p.fn)), r * 3.6, r * 3.6, 0.75);
      sc.position.y = 0.0003;
      this.object.add(sc);
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
    // channel faders are 45 mm (60 on long-throw mixers); the crossfader 45
    this.len = (p.length as number) || 0.045;
    this.horiz = p.orient === 'horizontal';
    this.cursor = this.horiz ? 'ew-resize' : 'ns-resize';
    const shape = p.shape ?? 'square';
    // a pro cap: ~20 mm across the slot, ~11 along it, ~11 tall, ridged on top
    const across = shape === 'tall' ? 0.014 : shape === 'tbar' ? 0.024 : 0.019;
    const along = shape === 'tbar' ? 0.008 : shape === 'round' ? 0.012 : 0.011;
    const ch = shape === 'tall' ? 0.016 : 0.011;
    const plateT = 0.0016;
    // the escutcheon: a thin plate the slot is cut through, with the scale printed on it
    const pw = across * 1.9;
    const pl = this.len + along + 0.014;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(this.horiz ? pl : pw, plateT, this.horiz ? pw : pl, 2, 0.0012), zoneMat(p, 0));
    plate.position.y = plateT / 2;
    plate.receiveShadow = true;
    this.object.add(plate);
    const slotLen = this.len + along * 0.35;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(this.horiz ? slotLen : 0.0022, 0.0004, this.horiz ? 0.0022 : slotLen), new THREE.MeshBasicMaterial({ color: 0x030304 }));
    slot.position.y = plateT + 0.0001;
    this.object.add(slot);
    const sc = decal(faderScaleTexture(printOn(p.colors[0]), !this.horiz, this.horiz), pw, this.len + 0.006, 0.85);
    if (this.horiz) sc.rotation.z = Math.PI / 2;
    sc.position.y = plateT + 0.0002;
    this.object.add(sc);
    const geo = shape === 'round' ? new THREE.CylinderGeometry(along / 2, along / 2, ch, 24).translate(0, ch / 2, 0) : faderCapGeometry(across, ch, along, shape === 'tbar' ? 2 : 3);
    this.cap = new THREE.Mesh(geo, zoneMat(p, 1, true));
    if (this.horiz && shape !== 'round') this.cap.rotation.y = Math.PI / 2;
    this.cap.position.y = plateT;
    this.cap.castShadow = true;
    const line = new THREE.Mesh(new THREE.BoxGeometry(across * 0.86, 0.0004, 0.0009), zoneMat(p, 2, true));
    line.position.y = ch * 1.11 + 0.0002;
    this.cap.add(line);
    this.animGroup.add(this.cap);
    this.addHit(this.cap);
    this.addHit(plate);
    this.addLabel(0.04, -this.len / 2 - 0.014, this.len / 2 + 0.014, plateT);
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
  if (shape === 'round' || shape === 'big') return new THREE.CylinderGeometry(w / 2, w / 2 * 1.03, h, 40).translate(0, h / 2, 0);
  if (shape === 'pill') return new RoundedBoxGeometry(w, h, d, 3, Math.min(w, d) / 2.2).translate(0, h / 2, 0);
  // rubber keys are soft-cornered
  return new RoundedBoxGeometry(w, h, d, 3, Math.min(w, d) * 0.24).translate(0, h / 2, 0);
}

/** the print on a button top: ▶❚❚ for play, otherwise its label */
const glyphCache = new Map<string, THREE.CanvasTexture>();
function glyphTexture(text: string, color: string): THREE.CanvasTexture {
  const k = `${text}|${color}`;
  let t = glyphCache.get(k);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (/^(play|▶|play\/pause|▶❚❚)$/i.test(text.trim())) {
    g.beginPath();
    g.moveTo(30, 40);
    g.lineTo(30, 88);
    g.lineTo(64, 64);
    g.fill();
    g.fillRect(74, 40, 9, 48);
    g.fillRect(89, 40, 9, 48);
  } else {
    g.font = `700 ${text.length > 4 ? 30 : 44}px "Barlow Condensed", sans-serif`;
    g.fillText(text.toUpperCase(), 64, 66, 120);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  glyphCache.set(k, t);
  return t;
}

const chromeBezel = (): THREE.MeshStandardMaterial => boardMaterial({ id: 'chrome', color: '#c9ced6' });

export class BButton extends BPart {
  private led: THREE.MeshStandardMaterial;
  private top: THREE.Mesh;
  private ringLed: THREE.MeshStandardMaterial | null = null;
  private held = false;
  private h: number;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const shape = p.shape ?? 'square';
    // CUE / PLAY on a media player are about 30 mm across
    const w = (p.w as number) || (shape === 'big' ? 0.03 : 0.016);
    const d = shape === 'round' || shape === 'big' ? w : (p.d as number) || (shape === 'pill' ? w * 0.5 : w * (shape === 'rect' ? 0.55 : 1));
    this.h = shape === 'big' ? 0.0075 : 0.0045;
    this.led = ledMat();
    if (shape === 'big') {
      // a big transport button: rubber top in a chrome bezel, the light in a ring round it
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + 0.0019, 0.0013, 12, 56), chromeBezel());
      bezel.rotation.x = Math.PI / 2;
      bezel.position.y = 0.0013;
      this.object.add(bezel);
      this.ringLed = ledMat();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + 0.0003, 0.0008, 8, 56), this.ringLed);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.0016;
      this.object.add(ring);
      this.led.color.set(p.colors[0]);
      this.led.roughness = 0.75;
    } else {
      const base = new THREE.Mesh(buttonGeo(shape, w * 1.14, d * 1.14, 0.0012), new THREE.MeshStandardMaterial({ color: '#0a0b0d', roughness: 0.6 }));
      this.object.add(base);
      // translucent rubber: its colour shows faintly even when it's off
      this.led.color.set(p.colors[1]);
      this.led.roughness = 0.55;
    }
    this.top = new THREE.Mesh(buttonGeo(shape, w, d, this.h), this.led);
    this.top.position.y = 0.0012;
    this.top.castShadow = true;
    this.animGroup.add(this.top);
    this.addHit(this.top);
    // the print on top: the label when it's set to go on it, CUE / ▶❚❚ on a big transport button by its function
    const onTop = p.label.place === 'on' && p.label.text ? p.label.text : shape === 'big' ? (/\.play$/.test(p.fn) ? 'PLAY' : /\.cue$/.test(p.fn) ? 'CUE' : '') : '';
    if (onTop) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, Math.min(w, d) * 0.82), new THREE.MeshBasicMaterial({ map: glyphTexture(onTop, '#e8ebf0'), transparent: true, depthWrite: false }));
      s.rotation.x = -Math.PI / 2;
      s.position.y = this.h + 0.0002;
      this.top.add(s);
    }
    if (p.label.place !== 'on') this.addLabel(Math.max(0.03, w * 1.6), -d / 2 - 0.008, d / 2 + 0.008, this.h);
  }

  update(c: PartCtx): void {
    super.update(c);
    const ctl = c.reg.get(this.target);
    let lit = ledColor(c.reg.lit(this.target), this.p.colors[2]);
    if (ctl?.kind === 'continuous') lit = { on: ctl.get() > 0.5, color: this.p.colors[2], level: 1 };
    const glow = this.p.glow.intensity;
    const target = this.ringLed ?? this.led;
    target.emissive.set(lit.on ? lit.color : glow > 0 ? this.p.glow.color : this.p.colors[2]);
    // off, an LED still shows a hint of its colour behind the rubber
    target.emissiveIntensity = lit.on ? lit.level * (this.ringLed ? 1.6 : 2.2) : Math.max(glow * 0.8, 0.06);
    if (this.ringLed) {
      this.led.emissive.set(lit.on ? lit.color : '#000000');
      this.led.emissiveIntensity = lit.on ? lit.level * 0.07 : 0;
    }
    this.top.position.y = 0.0012 - (this.held ? this.h * 0.3 : 0);
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
    const s = (p.size as number) || 0.02;
    const gap = s * 0.2;
    const base = (p.base as string) || 'deck.L.pad.{n}';
    const W = cols * s + (cols - 1) * gap;
    const D = rows * s + (rows - 1) * gap;
    // the pads sit in a recessed well in a raised frame
    const plate = new THREE.Mesh(new RoundedBoxGeometry(W + gap * 3, 0.003, D + gap * 3, 2, 0.002), zoneMat(p, 0));
    plate.position.y = 0.0015;
    this.object.add(plate);
    const well = new THREE.Mesh(new RoundedBoxGeometry(W + gap * 1.2, 0.0008, D + gap * 1.2, 2, 0.0015), new THREE.MeshStandardMaterial({ color: '#060708', roughness: 0.8 }));
    well.position.y = 0.003;
    this.object.add(well);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const n = r * cols + c + 1;
        // soft silicone with a light under it: rounded on top, a little proud of the well
        const m = new THREE.Mesh(new RoundedBoxGeometry(s, 0.0045, s, 3, s * 0.16).translate(0, 0.0052, 0), ledMat());
        (m.material as THREE.MeshStandardMaterial).color.set(p.colors[1]);
        (m.material as THREE.MeshStandardMaterial).roughness = 0.7;
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
      pad.led.emissive.set(lit.on ? lit.color : this.p.glow.intensity > 0 ? this.p.glow.color : this.p.colors[2]);
      // backlit pads idle with a faint glow of their colour
      pad.led.emissiveIntensity = lit.on ? lit.level * 1.8 : Math.max(this.p.glow.intensity * 0.6, 0.05) + (pad.held ? 0.8 : 0);
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
    // the outer ring: knurled round the side so a thumb can nudge it
    const ringSide = zoneMat(p, 0).clone();
    ringSide.bumpMap = knurlBumpTexture();
    ringSide.bumpMap.repeat.set(Math.max(1, Math.round((r * Math.PI * 2) / 0.12)), 1);
    ringSide.bumpScale = 1.2;
    ringSide.userData.boardShared = false;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.012, ringH, 128, 1, false), [ringSide, zoneMat(p, 0), zoneMat(p, 0)]);
    ring.position.y = ringH / 2;
    ring.castShadow = true;
    ring.userData.zone = 'ring';
    this.object.add(ring);
    this.addHit(ring);
    // the light pipe round the platter's edge
    this.ringLed = ledMat();
    const led = new THREE.Mesh(new THREE.TorusGeometry(r * 0.835, Math.max(0.0009, r * 0.012), 8, 128), this.ringLed);
    led.rotation.x = Math.PI / 2;
    led.position.y = ringH + 0.0006;
    this.object.add(led);
    const style = (p.platter as string) || 'metal';
    const topR = r * 0.8;
    const topMat =
      style === 'vinyl'
        ? new THREE.MeshStandardMaterial({ map: grooveTexture(), roughness: 0.3, metalness: 0.2 })
        : style === 'metal'
          ? turnedMat(p.colors[1])
          : boardMaterial({ id: PLATTERS[style] ?? 'gloss', color: p.colors[1], glow: style === 'led' ? { color: p.colors[2], intensity: 0.6, beat: true } : p.glow });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR, 0.004, 128), [zoneMat(p, 0), topMat, zoneMat(p, 0)]);
    plate.position.y = ringH + 0.002;
    plate.userData.zone = 'top';
    this.spin.add(plate);
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
      // the on-jog display sits under glass in a dark bezel
      const bez = new THREE.Mesh(new THREE.RingGeometry(topR * 0.36, topR * 0.41, 48), new THREE.MeshStandardMaterial({ color: '#08090b', roughness: 0.3, metalness: 0.4 }));
      bez.rotation.x = -Math.PI / 2;
      bez.position.y = ringH + 0.0046;
      this.object.add(bez);
      const sheen = glassSheen(topR * 0.72, topR * 0.72, true);
      sheen.position.y = ringH + 0.0048;
      this.object.add(sheen);
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
    // the panel's black border round the picture, then the picture, then the glass over both
    const border = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.005, d + 0.005), new THREE.MeshStandardMaterial({ color: '#050608', roughness: 0.2, metalness: 0.3 }));
    border.rotation.x = -Math.PI / 2;
    border.position.set(0, 0.00605, -d / 2);
    tilt.add(border);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.glass);
    scr.rotation.x = -Math.PI / 2;
    scr.position.set(0, 0.0062, -d / 2);
    tilt.add(scr);
    const sheen = glassSheen(w + 0.005, d + 0.005);
    sheen.position.set(0, 0.0064, -d / 2);
    tilt.add(sheen);
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
  private peakL = 0;
  private peakR = 0;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const kind = (p.kind as string) || 'led';
    const len = (p.length as number) || 0.06;
    this.cursor = 'default';
    const base = new THREE.Mesh(new RoundedBoxGeometry(kind === 'led' ? 0.016 : len, 0.004, kind === 'led' ? len + 0.008 : len * 0.6, 2, 0.0015), zoneMat(p, 0));
    base.position.y = 0.002;
    this.object.add(base);
    this.addHit(base);
    if (kind === 'led') {
      // a club meter: two columns of 15 LEDs (green, then amber, then red) behind a smoked window, with the dB marks printed beside
      const n = 15;
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.0085, 0.0006, len + 0.003), new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.15, metalness: 0.2 }));
      win.position.set(-0.002, 0.0042, 0);
      this.object.add(win);
      this.segs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0028, 0.0006, (len / n) * 0.7), new THREE.MeshBasicMaterial({ toneMapped: false }), n * 2);
      const m = new THREE.Matrix4();
      for (let col = 0; col < 2; col++)
        for (let i = 0; i < n; i++) {
          m.makeTranslation(-0.002 + (col ? 0.0019 : -0.0019), 0.0046, len / 2 - (i + 0.5) * (len / n));
          this.segs.setMatrixAt(col * n + i, m);
          this.segs.setColorAt(col * n + i, new THREE.Color(0x111111));
        }
      this.object.add(this.segs);
      const leg = decal(meterLegendTexture(printOn(p.colors[0]), n), 0.0045, len, 0.85);
      leg.position.set(0.0052, 0.0042, 0);
      this.object.add(leg);
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
      const n = this.segs.count / 2;
      const low = new THREE.Color(this.p.colors[2]);
      const amber = new THREE.Color('#ffc53a');
      const red = new THREE.Color('#ff2b45');
      const lv2 = [l, r];
      for (let col = 0; col < 2; col++) {
        const db = 20 * Math.log10(Math.max(1e-6, lv2[col]));
        const f = Math.min(1, Math.max(0, (db + 36) / 39));
        const lit = Math.round(Math.max(f, col ? this.peakR : this.peakL) * n);
        if (col) this.peakR = Math.max(f, this.peakR - c.dt * 1.8);
        else this.peakL = Math.max(f, this.peakL - c.dt * 1.8);
        for (let i = 0; i < n; i++) {
          const k = i / (n - 1);
          const base = k > 0.86 ? red : k > 0.68 ? amber : low;
          // an unlit LED still shows a ghost of its colour through the smoked window
          this.segs.setColorAt(col * n + i, i < lit ? tmpC.copy(base).multiplyScalar(1.6) : tmpC.copy(base).multiplyScalar(0.07));
        }
      }
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
    const parts = [g1, g2].map((g) => (g.index ? g.toNonIndexed() : g));
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
    // screws in the corners of a plate, as it would be held together
    const pw = (p.w as number) || 0.4;
    const pd = (p.d as number) || 0.25;
    if (p.screws !== false && (p.shape ?? 'rect') === 'rect' && pw > 0.08 && pd > 0.08) {
      const inset = Math.min(0.012, Math.min(pw, pd) * 0.08);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const sc = screw(0.0022);
          sc.position.set(sx * (pw / 2 - inset), h, sz * (pd / 2 - inset));
          this.animGroup.add(sc);
        }
    }
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
