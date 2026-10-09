/*
 * Decoration and personality (Section 13.6): desk toys that move with the
 * music, animated pieces, stickers, freehand drawing and your name engraved
 * anywhere. None of them control anything; all of them react.
 *   bobblehead (nods on the beat), lava lamp, mini disco ball (spins, throws
 *   light), plant, mini speaker stack (thumps), cocktail (ripples with the
 *   bass), cat asleep on the mixer (wakes on drops), spinning gears, tiny
 *   dancers, a mini crowd (reacts like the real one), stickers, drawings,
 *   name engraving (engraved, embossed, neon, LED).
 * TODO: procedural stand-ins for Blender models (Section 14).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { nameService, type NameStyle } from '../name/NameService';
import type { PartCtx } from '../three/parts';
import type { BoardComponent } from './format';
import { boardMaterial } from './materials';
import { BPart, zoneMat, type BoardEnv } from './parts';
import type { Built, CompDef } from './catalog';

abstract class Decor extends BPart {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    this.cursor = 'default';
  }
  protected kick(): number {
    return this.env.hooks.kick();
  }
}

class Bobblehead extends Decor {
  private head: THREE.Group;
  private v = 0;
  private a = 0;
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.014, 6, 12).translate(0, 0.016, 0), zoneMat(p, 0));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.004, 24).translate(0, 0.002, 0), zoneMat(p, 2));
    this.head = new THREE.Group();
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 16), boardMaterial({ id: 'gloss', color: '#e8c39e' }));
    h.position.y = 0.01;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), zoneMat(p, 1));
    hair.position.y = 0.0115;
    const phones = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0018, 6, 20, Math.PI), boardMaterial({ id: 'matte', color: '#111' }));
    phones.position.y = 0.012;
    this.head.add(h, hair, phones);
    this.head.position.y = 0.03;
    this.animGroup.add(base, body, this.head);
    this.addHit(body);
  }
  update(c: PartCtx): void {
    super.update(c);
    // a spring, kicked by the kick
    const k = this.kick();
    this.v += (-this.a * 160 - this.v * 6) * c.dt + k * c.dt * 30;
    this.a += this.v * c.dt;
    this.head.rotation.x = Math.max(-0.5, Math.min(0.5, this.a));
  }
}

class LavaLamp extends Decor {
  private blobs: THREE.Mesh[] = [];
  private t = Math.random() * 10;
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.03, 24).translate(0, 0.015, 0), boardMaterial({ id: 'chrome', color: '#cccccc' }));
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.013, 0.07, 24).translate(0, 0.065, 0), new THREE.MeshPhysicalMaterial({ color: p.colors[1], transparent: true, opacity: 0.35, roughness: 0.05, emissive: p.colors[1], emissiveIntensity: 0.25 }));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.015, 24).translate(0, 0.107, 0), boardMaterial({ id: 'chrome', color: '#cccccc' }));
    this.animGroup.add(base, glass, cap);
    const lava = boardMaterial({ id: 'lava', color: p.colors[2], glow: { color: p.colors[2], intensity: 0.7, beat: false } });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.004 + i * 0.0008, 14, 10), lava);
      this.blobs.push(b);
      this.animGroup.add(b);
    }
    this.addHit(glass);
  }
  update(c: PartCtx): void {
    super.update(c);
    this.t += c.dt * 0.35;
    this.blobs.forEach((b, i) => {
      const y = 0.045 + (Math.sin(this.t * (0.6 + i * 0.17) + i * 2) * 0.5 + 0.5) * 0.045;
      b.position.set(Math.sin(this.t + i) * 0.002, y, Math.cos(this.t * 0.7 + i) * 0.002);
      b.scale.set(1, 1.2 + Math.sin(this.t * 2 + i) * 0.25, 1);
    });
  }
}

class DiscoBall extends Decor {
  private ball: THREE.Mesh;
  private light: THREE.PointLight;
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const r = (p.size as number) || 0.02;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.05, 6).translate(0, 0.025, 0), boardMaterial({ id: 'chrome', color: '#ccc' }));
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.004, 20).translate(0, 0.002, 0), zoneMat(p, 0));
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), new THREE.MeshStandardMaterial({ color: '#dddddd', metalness: 1, roughness: 0.15, flatShading: true, emissive: p.colors[2], emissiveIntensity: 0.05 }));
    this.ball.position.y = 0.05 + r;
    // it throws a little light around the booth
    this.light = new THREE.PointLight(p.colors[2], 0, 0.6, 2);
    this.light.position.y = 0.05 + r;
    this.animGroup.add(stand, foot, this.ball, this.light);
    this.addHit(this.ball);
  }
  update(c: PartCtx): void {
    super.update(c);
    this.ball.rotation.y += c.dt * 1.4;
    const k = this.kick();
    (this.ball.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05 + k * 0.6;
    this.light.intensity = 0.15 + k * 0.4;
  }
}

class Plant extends Decor {
  private leaves = new THREE.Group();
  private t = Math.random() * 6;
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.011, 0.022, 20).translate(0, 0.011, 0), zoneMat(p, 0));
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.013, 20).rotateX(-Math.PI / 2).translate(0, 0.021, 0), boardMaterial({ id: 'matte', color: '#3a2a1d' }));
    const leafMat = boardMaterial({ id: 'gloss', color: p.colors[1] === '#e8ebf0' ? '#2f8f46' : p.colors[1] });
    for (let i = 0; i < 9; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 6).scale(0.5, 0.12, 1.6), leafMat);
      const a = (i / 9) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.008, 0.03 + (i % 3) * 0.008, Math.sin(a) * 0.008);
      leaf.rotation.set(0.6, -a + Math.PI / 2, 0);
      this.leaves.add(leaf);
    }
    this.animGroup.add(pot, soil, this.leaves);
    this.addHit(pot);
  }
  update(c: PartCtx): void {
    super.update(c);
    this.t += c.dt;
    this.leaves.rotation.z = Math.sin(this.t * 1.3) * 0.04 + this.kick() * 0.03;
  }
}

class SpeakerStack extends Decor {
  private cones: THREE.Mesh[] = [];
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    for (let i = 0; i < 2; i++) {
      const box = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.03, 0.025, 2, 0.002), zoneMat(p, 0));
      box.position.y = 0.015 + i * 0.031;
      this.animGroup.add(box);
      if (i === 0) this.addHit(box);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.006, 0.003, 20).rotateX(Math.PI / 2), boardMaterial({ id: 'rubber', color: '#111' }));
      cone.position.set(0, 0.015 + i * 0.031, 0.0128);
      this.cones.push(cone);
      this.animGroup.add(cone);
    }
  }
  update(c: PartCtx): void {
    super.update(c);
    const k = this.kick();
    for (const cone of this.cones) cone.position.z = 0.0128 + k * 0.0025;
  }
}

class Cocktail extends Decor {
  private surface: THREE.Mesh;
  private t = 0;
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.03, 24, 1, true).translate(0, 0.019, 0), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.004, 8).translate(0, 0.002, 0), boardMaterial({ id: 'acrylic', color: '#ffffff' }));
    const drink = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.009, 0.02, 24).translate(0, 0.014, 0), new THREE.MeshStandardMaterial({ color: p.colors[2], transparent: true, opacity: 0.8, emissive: p.colors[2], emissiveIntensity: 0.25 }));
    const geo = new THREE.CircleGeometry(0.0108, 24, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    this.surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.colors[2], emissive: p.colors[2], emissiveIntensity: 0.4 }));
    this.surface.position.y = 0.024;
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.04, 6).translate(0, 0.02, 0), boardMaterial({ id: 'gloss', color: '#ff2e88' }));
    straw.position.set(0.004, 0.01, 0);
    straw.rotation.z = -0.25;
    this.animGroup.add(glass, stem, drink, this.surface, straw);
    this.addHit(glass);
  }
  update(c: PartCtx): void {
    super.update(c);
    this.t += c.dt;
    // the bass makes rings in the drink
    const pos = this.surface.geometry.getAttribute('position') as THREE.BufferAttribute;
    const k = this.kick();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      pos.setY(i, Math.sin(r * 900 - this.t * 22) * 0.0006 * k);
    }
    pos.needsUpdate = true;
  }
}

class Cat extends Decor {
  private head: THREE.Mesh;
  private body: THREE.Mesh;
  private awake = 0;
  private t = Math.random() * 5;
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const fur = boardMaterial({ id: 'matte', color: p.colors[0] === '#1b1d22' ? '#2a2420' : p.colors[0] });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 14).scale(1.4, 0.55, 1), fur);
    this.body.position.y = 0.011;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.011, 18, 14), fur);
    this.head.position.set(0.024, 0.01, 0.004);
    const ear = new THREE.ConeGeometry(0.004, 0.007, 4);
    for (const z of [-0.005, 0.005]) {
      const e = new THREE.Mesh(ear, fur);
      e.position.set(0.002, 0.01, z);
      this.head.add(e);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 16, Math.PI), fur);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(-0.022, 0.004, 0);
    this.animGroup.add(this.body, this.head, tail);
    this.addHit(this.body);
  }
  update(c: PartCtx): void {
    super.update(c);
    this.t += c.dt;
    // asleep: slow breathing. A drop wakes it: the head comes up for a few seconds
    if (this.env.hooks.dropPulse() > 0.5) this.awake = 4;
    this.awake = Math.max(0, this.awake - c.dt);
    const up = Math.min(1, this.awake);
    this.body.scale.y = 0.55 + Math.sin(this.t * 1.6) * 0.03 * (1 - up);
    this.head.position.y = 0.01 + up * 0.014;
    this.head.rotation.z = up * 0.4 + Math.sin(this.t * 6) * 0.05 * up;
  }
}

class Gears extends Decor {
  private gears: { m: THREE.Mesh; dir: number; teeth: number }[] = [];
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const specs = [
      [0, 0.018, 16, 1],
      [0.03, 0.012, 11, -1],
      [-0.024, 0.01, 9, -1],
    ] as const;
    for (const [x, r, teeth, dir] of specs) {
      const s = new THREE.Shape();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? r : r * 1.18;
        if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      s.holes.push(new THREE.Path().absarc(0, 0, r * 0.3, 0, Math.PI * 2, true));
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }).rotateX(-Math.PI / 2), boardMaterial({ id: p.material === 'matte' ? 'brushed' : p.material, color: p.colors[1] }));
      m.position.set(x, 0.002, 0);
      this.animGroup.add(m);
      this.gears.push({ m, dir, teeth });
    }
    this.addHit(this.gears[0].m);
  }
  update(c: PartCtx): void {
    super.update(c);
    // they turn with the tempo
    const speed = (Math.PI * 2) / (this.env.hooks.beat().period * 16);
    for (const g of this.gears) g.m.rotation.y += g.dir * speed * (16 / g.teeth) * c.dt;
  }
}

/** little figures: the tiny dancers along an edge, or a mini crowd */
class Figures extends Decor {
  private figs: { m: THREE.Group; ph: number }[] = [];
  constructor(
    comp: BoardComponent,
    env: BoardEnv,
    private crowd: boolean,
  ) {
    super(comp, env);
    const p = this.p;
    const n = Math.max(2, Math.min(80, (p.count as number) || (crowd ? 24 : 8)));
    const cols = crowd ? Math.ceil(Math.sqrt(n * 2)) : n;
    const skin = ['#e8c39e', '#c68c5f', '#8d5a3c', '#f1d4b7', '#5b3a29'];
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.0025, 0.006, 4, 8).translate(0, 0.0055, 0), boardMaterial({ id: 'matte', color: [p.colors[1], p.colors[2], '#3ad7ff', '#ffb547'][i % 4] }));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), boardMaterial({ id: 'matte', color: skin[i % skin.length] }));
      head.position.y = 0.0125;
      g.add(body, head);
      const x = crowd ? ((i % cols) - cols / 2) * 0.008 : (i - n / 2) * 0.012;
      const z = crowd ? Math.floor(i / cols) * 0.008 : 0;
      g.position.set(x + (crowd ? (Math.random() - 0.5) * 0.003 : 0), 0, z);
      this.animGroup.add(g);
      this.figs.push({ m: g, ph: Math.random() * Math.PI * 2 });
    }
    const base = new THREE.Mesh(new RoundedBoxGeometry(crowd ? cols * 0.008 + 0.006 : n * 0.012 + 0.006, 0.002, crowd ? Math.ceil(n / cols) * 0.008 + 0.006 : 0.01, 1, 0.001), zoneMat(p, 0));
    base.position.set(-0.004, -0.001, crowd ? (Math.ceil(n / cols) * 0.008) / 2 - 0.004 : 0);
    this.animGroup.add(base);
    this.addHit(base);
  }
  update(c: PartCtx): void {
    super.update(c);
    const b = this.env.hooks.beat();
    // the mini crowd jumps as hard as the real one; the dancers groove whatever
    const energy = this.crowd ? this.env.hooks.vibe() : 0.7;
    for (const f of this.figs) {
      const beatPh = (b.phase + f.ph / (Math.PI * 2) * (this.crowd ? 0.15 : 0)) % 1;
      const jump = Math.max(0, Math.sin(beatPh * Math.PI)) * 0.004 * energy;
      f.m.position.y = jump;
      f.m.rotation.y = this.crowd ? 0 : Math.sin(c.now * 3 + f.ph) * 0.6;
      f.m.rotation.z = Math.sin(c.now * 4 + f.ph) * 0.15 * energy;
    }
  }
}

class CrowdFigures extends Figures {
  constructor(c: BoardComponent, e: BoardEnv) {
    super(c, e, true);
  }
}
class Dancers extends Figures {
  constructor(c: BoardComponent, e: BoardEnv) {
    super(c, e, false);
  }
}

/* ------------------------------ stickers, drawings, engravings ------------------------------ */

export const STICKER_DESIGNS = ['smiley', 'house', 'acid', 'peace', 'vinyl', 'bolt', 'heart', 'star', 'eye', 'cassette'] as const;

function stickerArt(design: string, color: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(0, 0, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, 110, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = accent;
  g.strokeStyle = accent;
  g.lineWidth = 12;
  g.lineCap = 'round';
  const text = (t: string, size = 54) => {
    g.font = `900 ${size}px 'Barlow Condensed', sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, 0, 0);
  };
  switch (design) {
    case 'smiley':
      g.beginPath();
      g.arc(-35, -25, 12, 0, Math.PI * 2);
      g.arc(35, -25, 12, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(0, 5, 55, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      break;
    case 'house':
      text('HOUSE', 66);
      break;
    case 'acid':
      text('ACID', 72);
      break;
    case 'peace':
      g.beginPath();
      g.arc(0, 0, 70, 0, Math.PI * 2);
      g.moveTo(0, -70);
      g.lineTo(0, 70);
      g.moveTo(0, 0);
      g.lineTo(-50, 50);
      g.moveTo(0, 0);
      g.lineTo(50, 50);
      g.stroke();
      break;
    case 'vinyl':
      for (const r of [80, 60, 40]) {
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    case 'bolt':
      g.beginPath();
      g.moveTo(15, -80);
      g.lineTo(-35, 10);
      g.lineTo(5, 10);
      g.lineTo(-15, 80);
      g.lineTo(35, -10);
      g.lineTo(-5, -10);
      g.closePath();
      g.fill();
      break;
    case 'heart':
      g.beginPath();
      g.moveTo(0, 60);
      g.bezierCurveTo(-90, 0, -50, -70, 0, -25);
      g.bezierCurveTo(50, -70, 90, 0, 0, 60);
      g.fill();
      break;
    case 'star':
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 32 : 80;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      break;
    case 'eye':
      g.beginPath();
      g.ellipse(0, 0, 80, 45, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 25, 0, Math.PI * 2);
      g.fill();
      break;
    default:
      g.strokeRect(-70, -45, 140, 90);
      g.beginPath();
      g.arc(-30, 0, 15, 0, Math.PI * 2);
      g.arc(30, 0, 15, 0, Math.PI * 2);
      g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Sticker extends Decor {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const s = (p.size as number) || 0.04;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshStandardMaterial({ map: stickerArt((p.design as string) || 'smiley', p.colors[1], p.colors[2]), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.0006;
    this.animGroup.add(m);
    this.addHit(m);
  }
}

/** freehand drawing and graffiti tags: strokes saved with the board as lists of points (0..1) */
class Drawing extends Decor {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const w = (p.w as number) || 0.12;
    const d = (p.d as number) || 0.08;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.round((512 * d) / w);
    const g = c.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const strokes = Array.isArray(p.strokes) ? (p.strokes as { c?: string; w?: number; pts?: number[] }[]) : [];
    for (const s of strokes) {
      const pts = Array.isArray(s.pts) ? s.pts : [];
      g.strokeStyle = typeof s.c === 'string' ? s.c : p.colors[2];
      g.lineWidth = typeof s.w === 'number' ? s.w : 10;
      g.shadowColor = g.strokeStyle as string;
      g.shadowBlur = p.glow.intensity > 0 ? 12 : 0;
      g.beginPath();
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const x = pts[i] * c.width;
        const y = pts[i + 1] * c.height;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, transparent: true, emissive: '#ffffff', emissiveMap: p.glow.intensity > 0 ? tex : null, emissiveIntensity: p.glow.intensity, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.0007;
    this.animGroup.add(m);
    this.addHit(m);
  }
}

/** your name, anywhere: engraved, embossed, neon or LED, in any of the name styles */
class Engraving extends Decor {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const w = (p.w as number) || 0.16;
    const finish = (p.finish as string) || 'neon';
    const style: NameStyle = ((p.style as string) || (finish === 'led' ? 'pixel_led' : finish === 'neon' ? 'neon_script' : 'white_install')) as NameStyle;
    const mesh = nameService.surface(style, w, w * 0.32, {});
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = finish === 'embossed' ? 0.003 : 0.0008;
    if (finish === 'engraved' || finish === 'embossed') {
      // a plate the name is cut into or raised from
      const plate = new THREE.Mesh(new RoundedBoxGeometry(w * 1.05, finish === 'embossed' ? 0.003 : 0.0015, w * 0.36, 2, 0.001), zoneMat(p, 0));
      plate.position.y = finish === 'embossed' ? 0.0015 : 0.00075;
      this.animGroup.add(plate);
      this.addHit(plate);
    } else this.addHit(mesh);
    this.animGroup.add(mesh);
  }
}

/* ------------------------------ the list ------------------------------ */

const single = (P: new (c: BoardComponent, e: BoardEnv) => BPart) => (c: BoardComponent, env: BoardEnv): Built => {
  const p = new P(c, env);
  return { object: p.object, parts: [p] };
};

const toy = (type: string, label: string, blurb: string, icon: string, P: new (c: BoardComponent, e: BoardEnv) => BPart, cost: number, defaults: Record<string, unknown> = {}, unlock?: CompDef['unlock']): CompDef => ({ type, category: 'decor', label, blurb, icon, defaults: () => ({ fn: '', sound: 'silent', ...defaults }), cost, unlock, build: single(P) });

export const DECOR: CompDef[] = [
  toy('bobblehead', 'Bobblehead', 'Nods to the beat.', '🧑‍🎤', Bobblehead, 2, { colors: ['#ff2e88', '#2a1a10', '#15171b'] }),
  toy('lava_lamp', 'Lava lamp', 'Slow blobs, hot glow.', '🪔', LavaLamp, 4, { colors: ['#15171b', '#ff9f1c', '#ff4d1a'] }),
  toy('disco_ball', 'Mini disco ball', 'Spins and throws a little light around.', '🪩', DiscoBall, 6, { size: 0.02, colors: ['#15171b', '#e8ebf0', '#c9b6ff'] }, { tier: 2, text: 'Fame tier 2' }),
  toy('plant', 'Plant', 'Something living in the booth.', '🪴', Plant, 2, { colors: ['#b5643c', '#2f8f46', '#15171b'] }),
  toy('speaker_stack', 'Mini speaker stack', 'Thumps with the kick.', '🔊', SpeakerStack, 2),
  toy('cocktail', 'Cocktail', 'Ripples with the bass.', '🍸', Cocktail, 2, { colors: ['#15171b', '#ffffff', '#ff2e88'] }),
  toy('cat', 'Sleeping cat', 'Asleep on the mixer. Wakes up on drops.', '🐈', Cat, 2, { colors: ['#2a2420', '#e8ebf0', '#15171b'] }, { milestone: 'first_encore', text: 'Milestone: your first encore' }),
  toy('gears', 'Spinning gears', 'Turn with the tempo.', '⚙', Gears, 3, { material: 'brushed', colors: ['#15171b', '#c9ced6', '#15171b'] }),
  toy('dancers', 'Tiny dancers', 'Along the edge of the board, grooving.', '💃', Dancers, 4, { count: 8 }),
  toy('mini_crowd', 'Mini crowd', 'A tiny crowd that reacts like the real one.', '👥', CrowdFigures, 8, { count: 24 }, { tier: 3, text: 'Fame tier 3' }),
  { type: 'sticker', category: 'decor', label: 'Sticker', blurb: 'From the rave and house sticker library.', icon: '🏷', defaults: () => ({ fn: '', sound: 'silent', design: 'smiley', size: 0.04, colors: ['#15171b', '#ffde00', '#111111'] }), options: [{ key: 'design', label: 'Design', kind: 'select', choices: STICKER_DESIGNS.map((d) => ({ id: d, label: d })) }, { key: 'size', label: 'Size (m)', kind: 'number', min: 0.01, max: 0.4, step: 0.005 }], cost: 1, build: single(Sticker) },
  { type: 'drawing', category: 'decor', label: 'Drawing', blurb: 'Freehand drawing and graffiti tags, straight onto the board.', icon: '✍', defaults: () => ({ fn: '', sound: 'silent', w: 0.12, d: 0.08, strokes: [] }), options: [{ key: 'w', label: 'Width (m)', kind: 'number', min: 0.02, max: 1, step: 0.01 }, { key: 'd', label: 'Depth (m)', kind: 'number', min: 0.02, max: 1, step: 0.01 }], cost: 1, build: single(Drawing) },
  { type: 'engraving', category: 'decor', label: 'Name engraving', blurb: 'Your name anywhere: engraved, embossed, neon or LED, in any style and size.', icon: '✒', defaults: () => ({ fn: '', sound: 'silent', w: 0.16, finish: 'neon', style: '' }), options: [{ key: 'w', label: 'Width (m)', kind: 'number', min: 0.03, max: 2, step: 0.01 }, { key: 'finish', label: 'Finish', kind: 'select', choices: ['engraved', 'embossed', 'neon', 'led'].map((x) => ({ id: x, label: x })) }, { key: 'style', label: 'Lettering', kind: 'select', choices: [{ id: '', label: 'Matches the finish' }, ...['led_sign', 'pixel_led', 'neon_red', 'neon_script', 'chrome_led', 'marker', 'handpainted', 'white_install', 'sticker'].map((x) => ({ id: x, label: x.replace('_', ' ') }))] }], cost: 2, build: single(Engraving) },
];
