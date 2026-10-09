/*
 * Show controls built into the board (Section 13.6): a laser controller, a
 * lighting desk, a pyro & CO2 panel, an LED wall controller, a camera
 * switcher, a weather button (outdoor venues) and a crowd cam.
 * Each is a panel of its own buttons; what they fire goes through the board
 * hooks to the venue's light show, the camera and the screens.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PartCtx, PointerInfo } from '../three/parts';
import type { BoardComponent } from './format';
import { touchSound } from './feel';
import type { ShowCue } from './hooks';
import { BPart, BScreen, zoneMat, type BoardEnv } from './parts';
import type { Built, CompDef } from './catalog';

interface Key {
  label: string;
  color: string;
  /** what pressing does; `hold` keys run while held */
  press(env: BoardEnv, on: boolean): void;
  hold?: boolean;
  /** lit right now */
  lit?(env: BoardEnv): boolean;
}

const labelTex = new Map<string, THREE.CanvasTexture>();
function keyLabel(text: string): THREE.CanvasTexture {
  let t = labelTex.get(text);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.font = "700 26px 'Barlow Condensed', sans-serif";
  g.fillStyle = '#e8ebf0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 64, 25, 124);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  labelTex.set(text, t);
  return t;
}

/** a panel of labelled keys */
class KeyPanel extends BPart {
  private btns: { mesh: THREE.Mesh; key: Key; t: number; held: boolean }[] = [];

  constructor(comp: BoardComponent, env: BoardEnv, keys: Key[], cols: number) {
    super(comp, env);
    const p = this.p;
    const s = 0.022;
    const rows = Math.ceil(keys.length / cols);
    const W = cols * s * 1.3 + 0.012;
    const D = rows * s * 1.6 + 0.012;
    const base = new THREE.Mesh(new RoundedBoxGeometry(W, 0.012, D, 2, 0.004), zoneMat(p, 0));
    base.position.y = 0.006;
    this.object.add(base);
    keys.forEach((k, i) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(s, 0.006, s * 0.8, 2, 0.002), new THREE.MeshStandardMaterial({ color: '#16181d', emissive: k.color, emissiveIntensity: 0.15, roughness: 0.4 }));
      const x = -W / 2 + 0.006 + s * 0.65 + (i % cols) * s * 1.3;
      const z = -D / 2 + 0.006 + s * 0.5 + Math.floor(i / cols) * s * 1.6;
      m.position.set(x, 0.015, z);
      this.object.add(m);
      this.addHit(m);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(s * 1.25, s * 0.45), new THREE.MeshBasicMaterial({ map: keyLabel(k.label), transparent: true, depthWrite: false }));
      lab.rotation.x = -Math.PI / 2;
      lab.position.set(x, 0.0125, z + s * 0.62);
      this.object.add(lab);
      this.btns.push({ mesh: m, key: k, t: -9, held: false });
    });
    this.addLabel(Math.min(W, 0.1), -D / 2 - 0.012, D / 2 + 0.012, 0.012);
  }

  down(p: PointerInfo, c: PartCtx): void {
    const b = this.btns.find((x) => x.mesh === p.object);
    if (!b) return;
    b.t = c.now;
    b.held = true;
    touchSound(this.p.sound, this.env.hooks.audio());
    b.key.press(this.env, true);
    this.held = b;
  }

  private held: { key: Key; held: boolean } | null = null;

  up(): void {
    if (this.held) {
      this.held.held = false;
      if (this.held.key.hold) this.held.key.press(this.env, false);
    }
    this.held = null;
  }

  update(c: PartCtx): void {
    super.update(c);
    for (const b of this.btns) {
      const lit = b.held || b.key.lit?.(this.env) || c.now - b.t < 0.25;
      (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = lit ? 2 : 0.15;
      b.mesh.position.y = b.held ? 0.0135 : 0.015;
    }
  }

  valueText(): string {
    return this.btns.map((b) => b.key.label).join(' · ');
  }
}

const cue = (label: string, what: ShowCue, color: string, hold = false): Key => ({ label, color, hold, press: (env, on) => (hold ? env.hooks.show(what, on) : on && env.hooks.show(what)) });

/** the laser controller: a stick to aim, colours, patterns, and your name in the air */
class LaserController extends KeyPanel {
  private stick: THREE.Group;
  private aim = { x: 0, y: 0 };
  private aiming = false;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env, [cue('Lasers', 'lasers', '#3ddc97', true), cue('Colour', 'laserColor', '#ff2e88'), cue('Pattern', 'laserPattern', '#3ad7ff'), cue('My name', 'laserName', '#ffb547')], 2);
    this.stick = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 10).translate(0, 0.02, 0), new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.6, roughness: 0.3 }));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.008, 18, 12), new THREE.MeshStandardMaterial({ color: '#e0243c', roughness: 0.35 }));
    ball.position.y = 0.04;
    ball.userData.stick = true;
    this.stick.add(shaft, ball);
    this.stick.position.set(0.075, 0.012, 0);
    this.object.add(this.stick);
    this.addHit(ball);
  }

  down(p: PointerInfo, c: PartCtx): void {
    if (p.object.userData.stick) {
      this.aiming = true;
      return;
    }
    super.down(p, c);
  }

  move(p: PointerInfo): void {
    if (!this.aiming) return;
    this.aim = { x: Math.max(-1, Math.min(1, p.dx / 80)), y: Math.max(-1, Math.min(1, -p.dy / 80)) };
    this.env.hooks.laserAim(this.aim.x, this.aim.y);
  }

  up(): void {
    if (this.aiming) {
      this.aiming = false;
      return;
    }
    super.up();
  }

  update(c: PartCtx): void {
    super.update(c);
    this.stick.rotation.z = -this.aim.x * 0.5;
    this.stick.rotation.x = -this.aim.y * 0.5;
  }
}

const CAM_VIEWS: [string, string][] = [
  ['perf', 'Perf'],
  ['wide', 'Wide'],
  ['crowd', 'Crowd'],
  ['booth', 'Booth'],
  ['fisheye', 'Fisheye'],
  ['crane', 'Crane'],
  ['drone', 'Drone'],
  ['camcorder', 'Camcorder'],
];

const panel = (keys: () => Key[], cols: number) => (c: BoardComponent, env: BoardEnv): Built => {
  const p = new KeyPanel(c, env, keys(), cols);
  return { object: p.object, parts: [p] };
};

export const SHOW_CONTROLS: CompDef[] = [
  {
    type: 'laser_ctl',
    category: 'show',
    label: 'Laser Controller',
    blurb: 'Aim the lasers, change colours and patterns, write your name in the air (where the venue has lasers).',
    icon: '🔺',
    defaults: () => ({}),
    cost: 8,
    unlock: { tier: 4, text: 'Fame tier 4' },
    build: (c, env) => {
      const p = new LaserController(c, env);
      return { object: p.object, parts: [p] };
    },
  },
  {
    type: 'light_desk',
    category: 'show',
    label: 'Lighting Desk',
    blurb: 'Strobes, blinders, blackout, haze and the LED walls by hand.',
    icon: '💡',
    defaults: () => ({}),
    cost: 8,
    build: panel(() => [cue('Strobe', 'strobe', '#ffffff', true), cue('Blinder', 'blinder', '#ffb547', true), cue('Blackout', 'blackout', '#555555', true), cue('Haze', 'hazeUp', '#c9b6ff'), cue('Visuals', 'nextVisual', '#3ad7ff'), cue('Lasers', 'lasers', '#3ddc97', true)], 3),
  },
  {
    type: 'pyro_panel',
    category: 'show',
    label: 'Pyro & CO2 Panel',
    blurb: 'Flames, CO2 cannons, confetti, streamers, sparklers and fog, each on its own button.',
    icon: '🎆',
    defaults: () => ({}),
    cost: 8,
    unlock: { tier: 5, text: 'Fame tier 5' },
    build: panel(() => [cue('Flames', 'pyro', '#ff5a1a'), cue('CO2', 'co2', '#e8f4ff'), cue('Confetti', 'confetti', '#ff2e88'), cue('Streamers', 'streamers', '#b6ff3b'), cue('Sparklers', 'sparklers', '#ffd27a'), cue('Fog', 'fog', '#9aa3b4')], 3),
  },
  {
    type: 'ledwall_ctl',
    category: 'show',
    label: 'LED Wall Controller',
    blurb: 'Switch the visuals and flash your name on the walls.',
    icon: '🟪',
    defaults: () => ({}),
    cost: 4,
    unlock: { tier: 3, text: 'Fame tier 3' },
    build: panel(() => [cue('Visuals', 'nextVisual', '#3ad7ff'), cue('My name', 'flashName', '#ff2e88')], 2),
  },
  {
    type: 'cam_switcher',
    category: 'show',
    label: 'Camera Switcher',
    blurb: 'Pick the camera angle live, for the stream and your recordings.',
    icon: '🎥',
    defaults: () => ({}),
    cost: 6,
    build: panel(() => CAM_VIEWS.map(([id, label]) => ({ label, color: '#ff2e2e', press: (env: BoardEnv, on: boolean) => on && env.hooks.camera(id) })), 4),
  },
  {
    type: 'weather',
    category: 'show',
    label: 'Weather Button',
    blurb: 'Outdoor venues only: rain, a breeze, or hurry the sunrise along.',
    icon: '🌦',
    defaults: () => ({}),
    cost: 3,
    unlock: { tier: 5, text: 'Fame tier 5' },
    build: panel(
      () =>
        (['rain', 'breeze', 'sunrise'] as const).map((w) => ({
          label: w,
          color: w === 'rain' ? '#3ad7ff' : w === 'breeze' ? '#b6ff3b' : '#ffb547',
          press: (env: BoardEnv, on: boolean) => {
            if (on && !env.hooks.weather(w)) env.hooks.toast('The weather button works at outdoor venues.');
          },
        })),
      3,
    ),
  },
  {
    type: 'crowd_cam',
    category: 'show',
    label: 'Crowd Cam',
    blurb: 'A small screen with a live view of the dance floor.',
    icon: '📺',
    defaults: () => ({ kind: 'crowd', w: 0.1, d: 0.06, tilt: -0.6 }),
    cost: 10,
    build: (c, env) => {
      const s = new BScreen(c, env);
      return { object: s.object, parts: [s] };
    },
  },
];
