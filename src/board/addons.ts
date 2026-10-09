/*
 * Wild add-ons (Section 13.6): controllers you won't find on a real board.
 * Each has a clear behaviour, its own look and its own sound:
 *   Theremin Zone, Touch Ribbon, XY Pad, Spinning Globe, Crowd Fader,
 *   Big Red Drop Button, Scratch Tower, Tape Stop Lever, Rewind Wheel,
 *   Air Horn & Siren, Vocal Chop Keyboard, Step Sequencer, Gravity Ball
 *   Pit, Pendulum, Fire Fader, Hype Dial.
 * TODO: procedural stand-ins for Blender models (Section 14).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Part, planeHit, type PartCtx, type PointerInfo } from '../three/parts';
import type { BoardComponent, CommonProps } from './format';
import { applyCurve, touchSound } from './feel';
import { boardMaterial } from './materials';
import { BFader, BJog, BPart, zoneMat, type BoardEnv } from './parts';
import type { Built, CompDef, OptionSpec } from './catalog';
import { scaleNote, type Drum } from './sounds';

const tmp = new THREE.Vector3();
const CONTROL: OptionSpec = { key: 'fn', label: 'Controls (across / turn)', kind: 'control' };
const CONTROL2: OptionSpec = { key: 'fn2', label: 'Controls (up / tilt)', kind: 'control' };
const DECKS = [1, 2, 3, 4].map((n) => ({ id: n, label: `Deck ${n}` }));

/** the point on a part's top surface (local x, z) under the pointer */
function surfacePoint(o: THREE.Object3D, ray: THREE.Ray, y: number): THREE.Vector3 | null {
  tmp.set(0, y, 0);
  o.localToWorld(tmp);
  const hit = planeHit(ray, tmp.y);
  if (!hit) return null;
  return o.worldToLocal(hit);
}

const glowMat = (color: string, k = 1.6) => new THREE.MeshStandardMaterial({ color: '#08080a', emissive: color, emissiveIntensity: k, transparent: true, opacity: 0.9 });

/** a fading trail of dots drawn on a canvas (XY pad, theremin, ribbon) */
class Trail {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  private pts: { x: number; y: number; a: number }[] = [];
  constructor(private color: string) {
    this.canvas.width = this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas);
  }
  add(x: number, y: number): void {
    this.pts.push({ x, y, a: 1 });
  }
  update(dt: number): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 256);
    for (const p of this.pts) p.a -= dt * 1.4;
    this.pts = this.pts.filter((p) => p.a > 0).slice(-80);
    for (const p of this.pts) {
      const grd = g.createRadialGradient(p.x * 256, p.y * 256, 0, p.x * 256, p.y * 256, 18);
      grd.addColorStop(0, this.color);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = p.a;
      g.fillStyle = grd;
      g.fillRect(p.x * 256 - 18, p.y * 256 - 18, 36, 36);
    }
    g.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }
}

/* ------------------------------ XY pad / theremin / ribbon ------------------------------ */

/** a surface you drag on: X (and Y) drive controls; a glowing trail follows */
class SurfacePart extends BPart {
  private trail: Trail;
  private w: number;
  private d: number;
  private dot: THREE.Mesh;
  private xy = { x: 0.5, y: 0.5 };
  private touching = false;

  constructor(
    comp: BoardComponent,
    env: BoardEnv,
    private kind: 'xy' | 'theremin' | 'ribbon',
  ) {
    super(comp, env);
    const p = this.p;
    this.w = (p.w as number) || (kind === 'ribbon' ? 0.22 : kind === 'theremin' ? 0.16 : 0.1);
    this.d = kind === 'ribbon' ? 0.018 : this.w;
    this.cursor = 'crosshair';
    this.trail = new Trail(p.colors[2]);
    const base = new THREE.Mesh(new RoundedBoxGeometry(this.w + 0.01, 0.006, this.d + 0.01, 2, 0.003), zoneMat(p, 0));
    base.position.y = 0.003;
    this.object.add(base);
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.d), new THREE.MeshBasicMaterial({ map: this.trail.tex, transparent: true, toneMapped: false, depthWrite: false }));
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = 0.0065;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.d), boardMaterial({ id: kind === 'theremin' ? 'frosted' : 'gloss', color: p.colors[1], glow: { color: p.colors[2], intensity: 0.15, beat: kind === 'theremin' } }));
    panel.rotation.x = -Math.PI / 2;
    panel.position.y = 0.0062;
    this.object.add(panel, surf);
    if (kind === 'theremin') {
      // the field: a soft glowing column above the plate
      const field = new THREE.Mesh(new THREE.BoxGeometry(this.w, 0.12, this.d), new THREE.MeshBasicMaterial({ color: p.colors[2], transparent: true, opacity: 0.06, depthWrite: false }));
      field.position.y = 0.066;
      this.object.add(field);
      this.addHit(field);
    }
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(kind === 'ribbon' ? 0.006 : 0.005, 16, 12), glowMat(p.colors[2], 2.4));
    this.dot.position.y = 0.009;
    this.dot.visible = false;
    this.object.add(this.dot);
    this.addHit(panel);
    this.addLabel(Math.min(this.w, 0.08), -this.d / 2 - 0.012, this.d / 2 + 0.012, 0.006);
  }

  private at(ray: THREE.Ray): { x: number; y: number; h: number } | null {
    const pt = surfacePoint(this.object, ray, this.kind === 'theremin' ? 0.06 : 0.0065);
    if (!pt) return null;
    return { x: Math.min(1, Math.max(0, pt.x / this.w + 0.5)), y: Math.min(1, Math.max(0, 1 - (pt.z / this.d + 0.5))), h: 0 };
  }

  private drive(c: PartCtx): void {
    const p = this.p;
    const x = applyCurve(this.xy.x, p.feel.curve);
    const fn = p.fn || (this.kind === 'xy' ? 'ch.1.filter' : this.kind === 'theremin' ? 'fx.param' : 'ch.1.filter');
    c.reg.setValue(fn, x, 'ui');
    if (this.kind !== 'ribbon') c.reg.setValue(p.fn2 || 'fx.depth', applyCurve(this.xy.y, p.feel.curve), 'ui');
  }

  down(p: PointerInfo, c: PartCtx): void {
    this.touching = true;
    this.move(p, c);
  }

  move(p: PointerInfo, c: PartCtx): void {
    const a = this.at(p.ray);
    if (!a) return;
    this.xy = { x: a.x, y: a.y };
    this.trail.add(a.x, 1 - a.y);
    this.drive(c);
    if (Math.random() < 0.15) this.env.hooks.sounds()?.shimmer(undefined, 0.6 + a.x);
  }

  up(_p: PointerInfo, c: PartCtx): void {
    this.touching = false;
    // the ribbon and theremin spring back to the middle when you let go; the XY pad stays where it is
    if (this.kind !== 'xy') {
      this.xy = { x: 0.5, y: 0.5 };
      this.drive(c);
    }
  }

  update(c: PartCtx): void {
    super.update(c);
    this.trail.update(c.dt);
    this.dot.visible = this.touching || this.kind === 'xy';
    this.dot.position.x = (this.xy.x - 0.5) * this.w;
    this.dot.position.z = -(this.xy.y - 0.5) * this.d;
  }

  valueText(): string {
    return this.kind === 'ribbon' ? 'slide along it' : 'drag across it';
  }
}

class Theremin extends SurfacePart {
  constructor(c: BoardComponent, e: BoardEnv) {
    super(c, e, 'theremin');
  }
}
class Ribbon extends SurfacePart {
  constructor(c: BoardComponent, e: BoardEnv) {
    super(c, e, 'ribbon');
  }
}
class XYPad extends SurfacePart {
  constructor(c: BoardComponent, e: BoardEnv) {
    super(c, e, 'xy');
  }
}

/* ------------------------------ spinning globe ------------------------------ */

class GlobePart extends BPart {
  private ball: THREE.Mesh;
  private vel = new THREE.Vector2();
  private last = new THREE.Vector2();
  private held = false;
  private vals = { a: 0.5, b: 0.5 };

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const r = (p.size as number) || 0.035;
    this.cursor = 'grab';
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.95, r * 0.5, 32), zoneMat(p, 0));
    cup.position.y = r * 0.25;
    this.object.add(cup);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), boardMaterial({ id: p.material === 'matte' ? 'holo' : p.material, color: p.colors[1], glow: p.glow }));
    this.ball.position.y = r * 0.9;
    this.ball.castShadow = true;
    // meridians so the spin reads
    const lines = new THREE.Mesh(new THREE.SphereGeometry(r * 1.003, 12, 8), new THREE.MeshBasicMaterial({ color: p.colors[2], wireframe: true, transparent: true, opacity: 0.35 }));
    this.ball.add(lines);
    this.animGroup.add(this.ball);
    this.addHit(this.ball);
  }

  down(p: PointerInfo): void {
    this.held = true;
    this.last.set(p.dx, p.dy);
    this.vel.set(0, 0);
  }

  move(p: PointerInfo): void {
    const dx = p.dx - this.last.x;
    const dy = p.dy - this.last.y;
    this.last.set(p.dx, p.dy);
    this.vel.set(dx * 0.01, dy * 0.01);
  }

  up(): void {
    this.held = false;
  }

  update(c: PartCtx): void {
    super.update(c);
    // momentum: it keeps rolling and slows down naturally
    this.ball.rotation.y += this.vel.x;
    this.ball.rotation.x += this.vel.y;
    if (!this.held) this.vel.multiplyScalar(Math.pow(0.35, c.dt));
    if (this.vel.lengthSq() > 1e-8) {
      this.vals.a = Math.min(1, Math.max(0, this.vals.a + this.vel.x * 0.6 * this.p.feel.sensitivity));
      this.vals.b = Math.min(1, Math.max(0, this.vals.b - this.vel.y * 0.6 * this.p.feel.sensitivity));
      c.reg.setValue(this.p.fn || 'fx.param', this.vals.a, 'ui');
      c.reg.setValue(this.p.fn2 || 'ch.1.filter', this.vals.b, 'ui');
    }
  }

  valueText(): string {
    return 'roll it: left–right and up–down drive two controls';
  }
}

/* ------------------------------ big red drop button ------------------------------ */

class DropButton extends BPart {
  private cover: THREE.Group;
  private open = false;
  private button: THREE.Mesh;
  private beat = 0;
  private pressedAt = -1e9;
  private coverHit: THREE.Mesh;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const s = (p.size as number) || 0.07;
    const base = new THREE.Mesh(new RoundedBoxGeometry(s * 1.3, s * 0.3, s * 1.3, 3, s * 0.08), boardMaterial({ id: 'matte', color: '#ffcc00' }));
    base.position.y = s * 0.15;
    this.object.add(base);
    // hazard stripes
    const stripes = new THREE.Mesh(new THREE.PlaneGeometry(s * 1.25, s * 1.25), new THREE.MeshStandardMaterial({ map: stripesTex(), transparent: true }));
    stripes.rotation.x = -Math.PI / 2;
    stripes.position.y = s * 0.301;
    this.object.add(stripes);
    this.button = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.42, s * 0.45, s * 0.2, 40), new THREE.MeshStandardMaterial({ color: '#c8141e', emissive: '#ff1a1a', emissiveIntensity: 0.3, roughness: 0.3 }));
    this.button.position.y = s * 0.4;
    this.button.castShadow = true;
    this.object.add(this.button);
    this.addHit(this.button);
    this.cover = new THREE.Group();
    this.cover.position.set(0, s * 0.3, -s * 0.6);
    this.coverHit = new THREE.Mesh(new THREE.BoxGeometry(s * 1.15, s * 0.36, s * 1.15).translate(0, s * 0.18, s * 0.6), new THREE.MeshPhysicalMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.35, roughness: 0.05, transmission: 0.5 }));
    this.cover.add(this.coverHit);
    this.object.add(this.cover);
    this.addHit(this.coverHit);
    this.cursor = 'pointer';
  }

  down(p: PointerInfo, c: PartCtx): void {
    if (p.object === this.coverHit || !this.open) {
      this.open = !this.open;
      touchSound('mechanical', this.env.hooks.audio());
      return;
    }
    // slam it
    this.pressedAt = c.now;
    this.env.hooks.drop();
    touchSound('mechanical', this.env.hooks.audio());
    setTimeout(() => (this.open = false), 2500);
  }

  update(c: PartCtx): void {
    super.update(c);
    const want = this.open ? -1.9 : 0;
    this.cover.rotation.x += (want - this.cover.rotation.x) * Math.min(1, c.dt * 8);
    // a heartbeat while the cover is up
    if (this.open) {
      this.beat += c.dt;
      if (this.beat > 0.9) {
        this.beat = 0;
        this.env.hooks.sounds()?.heartbeat();
      }
    }
    const pressed = c.now - this.pressedAt < 0.25;
    this.button.position.y = ((this.p.size as number) || 0.07) * (pressed ? 0.33 : 0.4);
    (this.button.material as THREE.MeshStandardMaterial).emissiveIntensity = this.open ? 0.6 + 0.5 * Math.max(0, Math.sin(c.now * 7)) : 0.3;
  }

  valueText(): string {
    return this.open ? 'SLAM IT' : 'flip the cover up first';
  }
}

let stripes: THREE.CanvasTexture | null = null;
function stripesTex(): THREE.CanvasTexture {
  if (stripes) return stripes;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffcc00';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 - 128, 128);
    g.lineTo(i - 128, 128);
    g.fill();
  }
  g.clearRect(28, 28, 72, 72);
  stripes = new THREE.CanvasTexture(c);
  stripes.colorSpace = THREE.SRGBColorSpace;
  return stripes;
}

/* ------------------------------ levers and wheels ------------------------------ */

/** the tape stop lever: pull it down and the deck winds down like a tape machine */
class TapeLever extends BPart {
  private arm = new THREE.Group();
  private angle = 0;
  private fired = false;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    this.cursor = 'ns-resize';
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.02, 0.06, 2, 0.005), zoneMat(p, 0));
    base.position.y = 0.01;
    this.object.add(base);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 12).translate(0, 0.05, 0), boardMaterial({ id: 'chrome', color: '#cccccc' }));
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 14), zoneMat(p, 1, true));
    knob.position.y = 0.1;
    this.arm.add(rod, knob);
    this.arm.position.y = 0.02;
    this.object.add(this.arm);
    this.addHit(knob);
    this.addHit(base);
  }

  move(p: PointerInfo, c: PartCtx): void {
    this.angle = Math.min(1, Math.max(0, p.dy / 120));
    if (this.angle > 0.85 && !this.fired) {
      this.fired = true;
      this.env.hooks.sounds()?.clunk();
      this.env.hooks.tapeStop(Math.max(1, Math.min(4, (this.p.deck as number) || c.engine.masterDeck?.id || 1)));
    }
  }

  up(): void {
    this.fired = false;
    this.angle = 0;
  }

  update(c: PartCtx): void {
    super.update(c);
    this.arm.rotation.x += (this.angle * 1.1 - this.arm.rotation.x) * Math.min(1, c.dt * 14);
  }

  valueText(): string {
    return 'pull it all the way down';
  }
}

/** the rewind wheel: spin it backwards for a pull-up */
class RewindWheel extends BPart {
  private disc: THREE.Mesh;
  private spin = 0;
  private acc = 0;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const r = (p.size as number) || 0.04;
    this.cursor = 'grab';
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.012, 48), zoneMat(p, 1, true));
    this.disc.rotation.z = Math.PI / 2;
    this.disc.position.y = r + 0.006;
    const spokes = new THREE.Mesh(new THREE.BoxGeometry(0.013, r * 1.8, 0.004), zoneMat(p, 2, true));
    this.disc.add(spokes);
    const stand = new THREE.Mesh(new RoundedBoxGeometry(0.03, r + 0.006, 0.03, 2, 0.004).translate(0, (r + 0.006) / 2, 0), zoneMat(p, 0));
    this.object.add(stand, this.disc);
    this.addHit(this.disc);
  }

  down(): void {
    this.acc = 0;
  }

  move(p: PointerInfo, c: PartCtx): void {
    const d = -p.dy;
    this.spin = d * 0.05;
    // pulled back hard enough: rewind
    if (d < -60 && this.acc > -1) {
      this.acc = -2;
      this.env.hooks.rewind(Math.max(1, Math.min(4, (this.p.deck as number) || c.engine.masterDeck?.id || 1)));
    }
  }

  update(c: PartCtx): void {
    super.update(c);
    this.disc.rotation.x += this.spin * c.dt * 10;
    this.spin *= Math.pow(0.2, c.dt);
  }

  valueText(): string {
    return 'drag it back towards you';
  }
}

/* ------------------------------ horn, keyboard, sequencer ------------------------------ */

class HornPanel extends BPart {
  private btns: { mesh: THREE.Mesh; what: 'horn' | 'siren'; t: number }[] = [];

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.012, 0.05, 2, 0.004), zoneMat(p, 0));
    base.position.y = 0.006;
    this.object.add(base);
    (['horn', 'siren'] as const).forEach((what, i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.016, 0.01, 32), new THREE.MeshStandardMaterial({ color: what === 'horn' ? '#ff9f1c' : '#2ec4f1', emissive: what === 'horn' ? '#ff9f1c' : '#2ec4f1', emissiveIntensity: 0.2 }));
      m.position.set(i ? 0.022 : -0.022, 0.017, 0);
      m.userData.what = what;
      this.object.add(m);
      this.addHit(m);
      this.btns.push({ mesh: m, what, t: -9 });
    });
  }

  down(p: PointerInfo, c: PartCtx): void {
    const b = this.btns.find((x) => x.mesh === p.object);
    if (!b) return;
    b.t = c.now;
    const s = this.env.hooks.sounds();
    if (b.what === 'horn') s?.horn();
    else s?.siren();
    // the lights flash with it
    this.env.hooks.show('strobe', true);
    setTimeout(() => this.env.hooks.show('strobe', false), b.what === 'horn' ? 900 : 1800);
  }

  update(c: PartCtx): void {
    super.update(c);
    for (const b of this.btns) (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = c.now - b.t < 0.8 ? 2 : 0.2;
  }

  valueText(): string {
    return 'air horn · siren';
  }
}

class VocalKeys extends BPart {
  private keys: { mesh: THREE.Mesh; i: number; t: number }[] = [];

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const n = Math.max(5, Math.min(24, (p.keys as number) || 13));
    const kw = 0.011;
    const base = new THREE.Mesh(new RoundedBoxGeometry(n * kw + 0.012, 0.012, 0.06, 2, 0.004), zoneMat(p, 0));
    base.position.y = 0.006;
    this.object.add(base);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new RoundedBoxGeometry(kw * 0.9, 0.006, 0.045, 1, 0.001), new THREE.MeshStandardMaterial({ color: p.colors[1], emissive: p.colors[2], emissiveIntensity: 0, roughness: 0.4 }));
      m.position.set(-n * kw * 0.5 + kw * (i + 0.5), 0.015, 0.004);
      this.object.add(m);
      this.addHit(m);
      this.keys.push({ mesh: m, i, t: -9 });
    }
  }

  down(p: PointerInfo, c: PartCtx): void {
    const k = this.keys.find((x) => x.mesh === p.object);
    if (!k) return;
    k.t = c.now;
    // in the track's key: the keys walk up its scale (C minor when nothing's playing)
    const key = this.env.hooks.key() ?? { root: 60, minor: true };
    this.env.hooks.sounds()?.vocal(scaleNote(key.root, key.minor, k.i));
  }

  update(c: PartCtx): void {
    super.update(c);
    for (const k of this.keys) {
      const lit = Math.max(0, 1 - (c.now - k.t) * 3);
      (k.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = lit * 2;
      k.mesh.position.y = 0.015 - lit * 0.002;
    }
  }

  valueText(): string {
    return 'plays chopped vocals in the track’s key';
  }
}

const SEQ_ROWS: Drum[] = ['kick', 'clap', 'hat', 'perc'];

class Sequencer extends BPart {
  private cells: THREE.Mesh[][] = [];
  private grid: boolean[][];
  private run = false;
  private runBtn: THREE.Mesh;
  private lastStep = -1;
  private scheduled = -1;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const steps = 16;
    const s = 0.009;
    const saved = Array.isArray(p.pattern) ? (p.pattern as unknown[]) : [];
    this.grid = SEQ_ROWS.map((_, r) => Array.from({ length: steps }, (_, i) => (Array.isArray(saved[r]) ? !!(saved[r] as unknown[])[i] : r === 2 ? i % 2 === 1 : r === 0 ? i % 4 === 0 : false)));
    const W = steps * s * 1.15 + 0.03;
    const base = new THREE.Mesh(new RoundedBoxGeometry(W, 0.01, 0.06, 2, 0.003), zoneMat(p, 0));
    base.position.y = 0.005;
    this.object.add(base);
    for (let r = 0; r < SEQ_ROWS.length; r++) {
      this.cells.push([]);
      for (let i = 0; i < steps; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, 0.003, s), new THREE.MeshStandardMaterial({ color: '#1a1c22', emissive: p.colors[2], emissiveIntensity: 0 }));
        m.position.set(-W / 2 + 0.025 + i * s * 1.15, 0.0115, -0.021 + r * s * 1.2);
        m.userData.cell = [r, i];
        this.object.add(m);
        this.addHit(m);
        this.cells[r].push(m);
      }
    }
    this.runBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.005, 20), new THREE.MeshStandardMaterial({ color: '#103a24', emissive: '#3ddc97', emissiveIntensity: 0.1 }));
    this.runBtn.position.set(-W / 2 + 0.01, 0.012, 0);
    this.object.add(this.runBtn);
    this.addHit(this.runBtn);
  }

  down(p: PointerInfo): void {
    if (p.object === this.runBtn) {
      this.run = !this.run;
      this.scheduled = -1;
      return;
    }
    const cell = p.object.userData.cell as [number, number] | undefined;
    if (cell) {
      this.grid[cell[0]][cell[1]] = !this.grid[cell[0]][cell[1]];
      this.comp.props.pattern = this.grid.map((row) => row.map((x) => (x ? 1 : 0)));
      touchSound('soft', this.env.hooks.audio());
    }
  }

  update(c: PartCtx): void {
    super.update(c);
    const b = this.env.hooks.beat();
    // sixteenths, locked to the master's beat; each step is scheduled just ahead on the audio clock
    const step = Math.floor(((b.bar % 4) + b.phase) * 4) % 16;
    const ac = this.env.hooks.audio();
    const snd = this.env.hooks.sounds();
    if (this.run && snd && ac) {
      const nextStep = (step + 1) % 16;
      if (nextStep !== this.scheduled) {
        this.scheduled = nextStep;
        const sixteenth = b.period / 4;
        const at = b.next - b.period + (Math.floor(b.phase * 4) + 1) * sixteenth;
        const t = Math.max(ac.currentTime + 0.005, at);
        SEQ_ROWS.forEach((d, r) => this.grid[r][nextStep] && snd.drum(d, t));
      }
    }
    if (step !== this.lastStep) this.lastStep = step;
    for (let r = 0; r < this.cells.length; r++)
      for (let i = 0; i < 16; i++) {
        const on = this.grid[r][i];
        const head = this.run && i === step;
        (this.cells[r][i].material as THREE.MeshStandardMaterial).emissiveIntensity = (on ? 1.2 : 0) + (head ? 0.9 : 0);
      }
    (this.runBtn.material as THREE.MeshStandardMaterial).emissiveIntensity = this.run ? 1.8 : 0.1;
  }

  valueText(): string {
    return this.run ? 'running: click steps to change the pattern' : 'press the green button to start';
  }
}

/* ------------------------------ ball pit ------------------------------ */

class BallPit extends BPart {
  private balls: { m: THREE.Mesh; v: THREE.Vector3; glow: number }[] = [];
  private pads: { m: THREE.Mesh; drum: Drum; lit: number }[] = [];
  private W = 0.14;
  private D = 0.1;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const W = this.W;
    const D = this.D;
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.05, depthWrite: false }));
    box.position.y = 0.05;
    this.object.add(box);
    const floor = new THREE.Mesh(new RoundedBoxGeometry(W + 0.01, 0.008, D + 0.01, 2, 0.003), zoneMat(p, 0));
    floor.position.y = 0.004;
    this.object.add(floor);
    const drums: Drum[] = ['kick', 'clap', 'hat', 'perc'];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(W / 4 - 0.004, 0.003, D - 0.01), new THREE.MeshStandardMaterial({ color: '#16181d', emissive: p.colors[2], emissiveIntensity: 0.1 }));
      m.position.set(-W / 2 + W / 8 + (i * W) / 4, 0.0095, 0);
      this.object.add(m);
      this.pads.push({ m, drum: drums[i], lit: 0 });
    }
    this.addHit(box);
    this.cursor = 'copy';
  }

  down(p: PointerInfo): void {
    // drop a ball where you clicked
    const pt = surfacePoint(this.object, p.ray, 0.1);
    if (!pt || this.balls.length > 24) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.006, 14, 10), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: this.p.colors[2], emissiveIntensity: 0.3 }));
    m.position.set(Math.max(-this.W / 2 + 0.008, Math.min(this.W / 2 - 0.008, pt.x)), 0.09, Math.max(-this.D / 2 + 0.008, Math.min(this.D / 2 - 0.008, pt.z)));
    this.object.add(m);
    this.balls.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.06), glow: 0 });
  }

  update(c: PartCtx): void {
    super.update(c);
    const dt = Math.min(0.033, c.dt);
    const snd = this.env.hooks.sounds();
    for (const b of this.balls) {
      b.v.y -= 0.6 * dt;
      b.m.position.addScaledVector(b.v, dt);
      const pos = b.m.position;
      // walls
      if (Math.abs(pos.x) > this.W / 2 - 0.006) {
        pos.x = Math.sign(pos.x) * (this.W / 2 - 0.006);
        b.v.x *= -0.8;
      }
      if (Math.abs(pos.z) > this.D / 2 - 0.006) {
        pos.z = Math.sign(pos.z) * (this.D / 2 - 0.006);
        b.v.z *= -0.8;
      }
      // the floor pads: a bounce plays the pad under it
      if (pos.y < 0.0175 && b.v.y < 0) {
        pos.y = 0.0175;
        const speed = -b.v.y;
        b.v.y = speed * 0.72;
        b.v.x *= 0.92;
        b.v.z *= 0.92;
        if (speed > 0.06) {
          const i = Math.max(0, Math.min(3, Math.floor((pos.x / this.W + 0.5) * 4)));
          this.pads[i].lit = 1;
          b.glow = 1;
          snd?.drum(this.pads[i].drum, undefined, Math.min(1, speed * 2.5));
        }
      }
      b.glow = Math.max(0, b.glow - dt * 3);
      (b.m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + b.glow * 2.5;
    }
    // settled balls fade away
    this.balls = this.balls.filter((b) => {
      const still = Math.abs(b.v.y) < 0.01 && b.m.position.y < 0.019;
      if (still) {
        b.m.scale.multiplyScalar(0.92);
        if (b.m.scale.x < 0.1) {
          this.object.remove(b.m);
          (b.m.material as THREE.Material).dispose();
          b.m.geometry.dispose();
          return false;
        }
      }
      return true;
    });
    for (const p of this.pads) {
      p.lit = Math.max(0, p.lit - dt * 4);
      (p.m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1 + p.lit * 2.2;
    }
  }

  valueText(): string {
    return 'click to drop balls';
  }
}

/* ------------------------------ pendulum ------------------------------ */

class Pendulum extends BPart {
  private arm = new THREE.Group();
  private on = false;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.16, 0.004).translate(0, 0.08, 0), boardMaterial({ id: 'brushed', color: '#999' }));
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.004), boardMaterial({ id: 'brushed', color: '#999' }));
    beam.position.y = 0.16;
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.01, 0.04, 2, 0.003), zoneMat(p, 0));
    base.position.y = 0.005;
    this.object.add(frame, beam, base);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.12, 8).translate(0, -0.06, 0), boardMaterial({ id: 'chrome', color: '#ccc' }));
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 14), zoneMat(p, 1, true));
    bob.position.y = -0.12;
    this.arm.add(rod, bob);
    this.arm.position.set(0, 0.158, 0.004);
    this.object.add(this.arm);
    this.addHit(bob);
    this.addHit(base);
  }

  down(): void {
    this.on = !this.on;
    touchSound('mechanical', this.env.hooks.audio());
  }

  update(c: PartCtx): void {
    super.update(c);
    const b = this.env.hooks.beat();
    // one full swing per bar, locked to the tempo
    const ph = ((b.bar % 2) + b.phase) / 2;
    const a = Math.sin(ph * Math.PI * 2) * (this.on ? 0.6 : 0.08);
    this.arm.rotation.z = a;
    if (this.on) c.reg.setValue(this.p.fn || 'fx.param', 0.5 + a / 1.2, 'ui');
  }

  valueText(): string {
    return this.on ? 'swinging with the tempo: click to stop' : 'click to swing it';
  }
}

/* ------------------------------ fire fader / crowd fader / hype dial ------------------------------ */

class FlameFader extends BFader {
  private flames: THREE.Points;
  private lastPyro = -9;
  private crowdMode: boolean;

  constructor(comp: BoardComponent, env: BoardEnv, crowd = false) {
    super(comp, env);
    this.crowdMode = crowd;
    const n = 60;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.flames = new THREE.Points(g, new THREE.PointsMaterial({ color: crowd ? '#3ad7ff' : '#ff7a1a', size: 0.004, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.object.add(this.flames);
  }

  update(c: PartCtx): void {
    super.update(c);
    const v = c.reg.value(this.target);
    if (this.crowdMode) this.env.hooks.crowd(v);
    const len = (this.p.length as number) || 0.06;
    const capZ = -(v - 0.5) * len;
    const pos = this.flames.geometry.getAttribute('position') as THREE.BufferAttribute;
    const heat = Math.max(0, (v - 0.55) / 0.45);
    for (let i = 0; i < pos.count; i++) {
      const t = (c.now * 1.7 + i * 0.137) % 1;
      pos.setXYZ(i, (Math.sin(i * 12.9) * 0.005) * (1 - t), 0.012 + t * 0.03 * heat, capZ + Math.cos(i * 7.3) * 0.004 * (1 - t));
    }
    pos.needsUpdate = true;
    this.flames.visible = heat > 0.02;
    (this.flames.material as THREE.PointsMaterial).size = 0.002 + heat * 0.004;
    // flames on stage grow as you push it: pyro bursts near the top, every two bars at most
    if (!this.crowdMode && v > 0.92 && c.now - this.lastPyro > this.env.hooks.beat().period * 8) {
      this.lastPyro = c.now;
      this.env.hooks.show('pyro');
    }
  }
}

class CrowdFader extends FlameFader {
  constructor(c: BoardComponent, e: BoardEnv) {
    super(c, e, true);
  }
}

class HypeDial extends BPart {
  private dial = new THREE.Group();
  private v = 0;
  private v0 = 0;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const r = (p.size as number) || 0.04;
    this.cursor = 'ns-resize';
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.15, r * 0.06, 8, 64), new THREE.MeshStandardMaterial({ color: '#111', emissive: p.colors[2], emissiveIntensity: 0.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.004;
    this.object.add(ring);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, r * 0.6, 48).translate(0, r * 0.3, 0), zoneMat(p, 0, true));
    knob.castShadow = true;
    const ptr = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, 0.002, r * 0.7), zoneMat(p, 2, true));
    ptr.position.set(0, r * 0.61, -r * 0.5);
    this.dial.add(knob, ptr);
    this.object.add(this.dial);
    this.addHit(knob);
  }

  down(): void {
    this.v0 = this.v;
  }

  move(p: PointerInfo): void {
    this.v = Math.min(1, Math.max(0, this.v0 - p.dy / 220));
    this.env.hooks.hype(this.v);
  }

  wheel(delta: number): void {
    this.v = Math.min(1, Math.max(0, this.v + delta * 0.04));
    this.env.hooks.hype(this.v);
  }

  update(c: PartCtx): void {
    super.update(c);
    this.dial.rotation.y = -(this.v - 0.5) * ((300 * Math.PI) / 180);
  }

  valueText(): string {
    return `${Math.round(this.v * 100)}%: lights, crowd and FX together`;
  }
}

/* ------------------------------ scratch tower ------------------------------ */

function buildScratchTower(c: BoardComponent, env: BoardEnv): Built {
  const p = c.props;
  const deck = Math.max(1, Math.min(4, (p.deck as number) || 1));
  const group = new THREE.Group();
  const tower = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.12, 0.2, 2, 0.008).translate(0, 0.06, 0), zoneMat(p, 0));
  tower.castShadow = true;
  group.add(tower);
  const jog: BoardComponent = { ...c, id: `${c.id}-jog`, props: { ...p, fn: `deck.${deck}.jog`, deck, size: 0.06, platter: 'vinyl', display: 'none', anim: 'none' } as CommonProps, children: [] };
  const j = new BJog(jog, env);
  j.object.position.set(0, 0.12, -0.02);
  group.add(j.object);
  const xf: BoardComponent = { ...c, id: `${c.id}-xf`, props: { ...p, fn: 'mixer.xfader', length: 0.07, orient: 'horizontal', shape: 'tbar', anim: 'none' } as CommonProps, children: [] };
  const f = new BFader(xf, env);
  f.object.position.set(0, 0.12, 0.075);
  group.add(f.object);
  return { object: group, parts: [j, f] };
}

/* ------------------------------ the list ------------------------------ */

const single = (P: new (c: BoardComponent, e: BoardEnv) => Part) => (c: BoardComponent, env: BoardEnv): Built => {
  const p = new P(c, env);
  return { object: p.object, parts: [p] };
};

export const ADDONS: CompDef[] = [
  { type: 'theremin', category: 'addons', label: 'Theremin Zone', blurb: 'A glowing field: move across it to sweep an effect, up and down for a second one. Light trails follow your hand.', icon: '〰', defaults: () => ({ fn: 'fx.param', fn2: 'fx.depth', w: 0.16, colors: ['#15171b', '#2a2d36', '#7affc0'] }), options: [CONTROL, CONTROL2], cost: 6, unlock: { tier: 3, text: 'Fame tier 3' }, build: single(Theremin) },
  { type: 'ribbon', category: 'addons', label: 'Touch Ribbon', blurb: 'Slide along a glowing bar for filter sweeps; it springs back when you let go.', icon: '━', defaults: () => ({ fn: 'ch.1.filter', w: 0.22, colors: ['#15171b', '#22252c', '#ff2e88'] }), options: [CONTROL, { key: 'w', label: 'Length (m)', kind: 'number', min: 0.06, max: 1, step: 0.01 }], cost: 4, unlock: { tier: 2, text: 'Fame tier 2' }, build: single(Ribbon) },
  { type: 'xy', category: 'addons', label: 'XY Pad', blurb: 'One square, two effects: across for one, up and down for the other. A glowing dot leaves a trail.', icon: '⊞', defaults: () => ({ fn: 'ch.1.filter', fn2: 'fx.depth', w: 0.1, colors: ['#15171b', '#1b1e26', '#3ad7ff'] }), options: [CONTROL, CONTROL2, { key: 'w', label: 'Size (m)', kind: 'number', min: 0.04, max: 0.6, step: 0.01 }], cost: 4, build: single(XYPad) },
  { type: 'globe', category: 'addons', label: 'Spinning Globe', blurb: 'Roll a ball in any direction to drive two controls. It spins on with momentum and slows down naturally.', icon: '🌐', defaults: () => ({ fn: 'fx.param', fn2: 'ch.1.filter', size: 0.035, material: 'holo', colors: ['#15171b', '#8f7bff', '#ffffff'] }), options: [CONTROL, CONTROL2, { key: 'size', label: 'Radius (m)', kind: 'number', min: 0.015, max: 0.2, step: 0.005 }], cost: 5, unlock: { tier: 4, text: 'Fame tier 4' }, build: single(GlobePart) },
  { type: 'crowd_fader', category: 'addons', label: 'Crowd Fader', blurb: 'Pushes the crowd: how hard they jump, how loud they cheer. Doesn’t touch your score.', icon: '🙌', defaults: () => ({ fn: '', length: 0.08, orient: 'vertical', shape: 'tall', colors: ['#15171b', '#3ad7ff', '#3ad7ff'] }), options: [{ key: 'length', label: 'Length (m)', kind: 'number', min: 0.03, max: 0.4, step: 0.005 }], cost: 4, unlock: { tier: 3, text: 'Fame tier 3' }, build: single(CrowdFader) },
  { type: 'drop_button', category: 'addons', label: 'Big Red Drop Button', blurb: 'Flip the safety cover, hear a heartbeat, slam it: lights out, one second of silence, then everything fires at once.', icon: '🔴', defaults: () => ({ size: 0.07 }), options: [{ key: 'size', label: 'Size (m)', kind: 'number', min: 0.03, max: 0.3, step: 0.005 }], cost: 6, unlock: { milestone: 'first_s', text: 'Milestone: an S grade' }, build: single(DropButton) },
  { type: 'scratch_tower', category: 'addons', label: 'Scratch Tower', blurb: 'A stacked turntable just for scratching, with its own crossfader.', icon: '🗼', defaults: () => ({ deck: 1, colors: ['#1a1b1e', '#e8ebf0', '#ff3b3b'] }), options: [{ key: 'deck', label: 'Deck', kind: 'select', choices: DECKS }], cost: 10, unlock: { tier: 4, text: 'Fame tier 4' }, build: buildScratchTower },
  { type: 'tape_stop', category: 'addons', label: 'Tape Stop Lever', blurb: 'A heavy lever: pull it down and the track winds to a halt like a tape machine.', icon: '⏬', defaults: () => ({ deck: 0, colors: ['#1a1b1e', '#ff3b3b', '#ff3b3b'] }), options: [{ key: 'deck', label: 'Deck', kind: 'select', choices: [{ id: 0, label: 'The one playing' }, ...DECKS] }], cost: 3, unlock: { tier: 2, text: 'Fame tier 2' }, build: single(TapeLever) },
  { type: 'rewind', category: 'addons', label: 'Rewind Wheel', blurb: 'Spin it back for a classic pull-up rewind. The crowd cheers.', icon: '⏪', defaults: () => ({ deck: 0, size: 0.04, colors: ['#1a1b1e', '#e8ebf0', '#ffb547'] }), options: [{ key: 'deck', label: 'Deck', kind: 'select', choices: [{ id: 0, label: 'The one playing' }, ...DECKS] }], cost: 3, unlock: { tier: 3, text: 'Fame tier 3' }, build: single(RewindWheel) },
  { type: 'horn', category: 'addons', label: 'Air Horn & Siren', blurb: 'Two buttons, two classics. The lights flash with them.', icon: '📯', defaults: () => ({}), cost: 3, build: single(HornPanel) },
  { type: 'vocal_keys', category: 'addons', label: 'Vocal Chop Keyboard', blurb: 'A mini piano of chopped vocals, tuned to the track’s key. Each key glows when pressed.', icon: '🎹', defaults: () => ({ keys: 13, colors: ['#15171b', '#f2f2f2', '#c9b6ff'] }), options: [{ key: 'keys', label: 'Keys', kind: 'number', min: 5, max: 24, step: 1 }], cost: 8, unlock: { tier: 3, text: 'Fame tier 3' }, build: single(VocalKeys) },
  { type: 'sequencer', category: 'addons', label: 'Step Sequencer', blurb: 'Build drum loops live over the mix, locked to the tempo. A light chases across the steps.', icon: '⬚', defaults: () => ({ colors: ['#15171b', '#e8ebf0', '#ffb547'] }), cost: 12, unlock: { tier: 2, text: 'Fame tier 2' }, build: single(Sequencer) },
  { type: 'ball_pit', category: 'addons', label: 'Gravity Ball Pit', blurb: 'Drop glowing balls onto pads; every bounce plays a sound. Real physics.', icon: '⚪', defaults: () => ({ colors: ['#15171b', '#ffffff', '#ff2e88'] }), cost: 10, unlock: { tier: 5, text: 'Fame tier 5' }, build: single(BallPit) },
  { type: 'pendulum', category: 'addons', label: 'Pendulum', blurb: 'A swinging weight that sweeps an effect in time: one swing per bar, locked to the tempo.', icon: '🕰', defaults: () => ({ fn: 'fx.param', colors: ['#15171b', '#ffb547', '#ffb547'] }), options: [CONTROL], cost: 4, unlock: { tier: 3, text: 'Fame tier 3' }, build: single(Pendulum) },
  { type: 'fire_fader', category: 'addons', label: 'Fire Fader', blurb: 'Its cap bursts into flame near the top, and the flames on stage grow as you push it.', icon: '🔥', defaults: () => ({ fn: 'fx.depth', length: 0.08, orient: 'vertical', shape: 'tall', colors: ['#15171b', '#ff5a1a', '#ffb547'] }), options: [CONTROL, { key: 'length', label: 'Length (m)', kind: 'number', min: 0.03, max: 0.4, step: 0.005 }], cost: 5, unlock: { tier: 5, text: 'Fame tier 5' }, build: single(FlameFader) },
  { type: 'hype_dial', category: 'addons', label: 'Hype Dial', blurb: 'One big dial: lights, crowd noise and FX all rise together.', icon: '🔆', defaults: () => ({ size: 0.04, colors: ['#1b1d22', '#e8ebf0', '#ff2e88'] }), options: [{ key: 'size', label: 'Radius (m)', kind: 'number', min: 0.015, max: 0.2, step: 0.005 }], cost: 3, unlock: { tier: 4, text: 'Fame tier 4' }, build: single(HypeDial) },
];
