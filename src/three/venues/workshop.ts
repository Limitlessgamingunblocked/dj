/*
 * The workshop (Section 13.2): where the Board Builder lives, at a workbench
 * in the player's hub. A pegboard of tools on the wall over the bench, an
 * angle-poise desk lamp clamped to the edge, stacked parts bins, a cutting
 * mat where the board sits, a shelf of half-built boards, a little radio
 * playing whatever's on the decks, and a window onto the city at 4am.
 * Not in the venue picker: the builder opens it, and test mode plays here.
 *
 * TODO: procedural stand-in for the workshop Blender set (Section 14).
 */
import * as THREE from 'three';
import type { Features } from '../../visualizer/AudioFeatures';
import { nameService } from '../../name/NameService';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { blobTexture, DustMotes } from './details';
import { TABLE_Y } from './fixtures';
import type { ShowState } from './show';
import { canvasTexture, concreteTexture, rng, windowsTexture } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** the room: the bench stands against the front wall, the builder faces it (−Z) */
export const WORKSHOP = { x0: -2.6, x1: 2.6, z0: -1.05, z1: 3.2, h: 2.7 };
/** the bench (its top is the booth top, so boards sit on it like on any booth) */
export const BENCH = { w: 2.6, d: 0.95, z: -0.1 };

const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

/** butcher-block beech: strips of slightly different wood */
function woodTexture(): THREE.CanvasTexture {
  return canvasTexture('workshop:wood', 512, 256, (g, w, h) => {
    const r = rng(41);
    const strip = h / 10;
    for (let i = 0; i < 10; i++) {
      const l = 52 + r() * 14;
      g.fillStyle = `hsl(32 ${38 + r() * 12}% ${l}%)`;
      g.fillRect(0, i * strip, w, strip);
      // grain
      g.strokeStyle = `hsla(28, 40%, ${l - 14}%, 0.25)`;
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        const y = i * strip + r() * strip;
        g.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 1.5);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, i * strip, w, 1);
    }
    // years of use: scorch marks, a ring from a mug, pen marks
    g.fillStyle = 'rgba(40,20,8,0.25)';
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.arc(r() * w, r() * h, 2 + r() * 5, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(60,30,10,0.3)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w * 0.86, h * 0.3, 14, 0, Math.PI * 2);
    g.stroke();
  }, { repeat: true });
}

/** the pegboard: holes on a 25 mm grid, painted outlines where the tools hang */
function pegboardTexture(): THREE.CanvasTexture {
  return canvasTexture('workshop:pegboard', 1024, 512, (g, w, h) => {
    g.fillStyle = '#c9b48f';
    g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(90,60,30,${r() * 0.05})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    const step = 16;
    g.fillStyle = '#2a2018';
    for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
      g.beginPath();
      g.arc(x, y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
    // shadow-board outlines (marker), so you know where the tools go back
    g.strokeStyle = 'rgba(20,20,24,0.7)';
    g.lineWidth = 3;
    const outline = (x: number, y: number, ww: number, hh: number) => {
      g.beginPath();
      g.roundRect(x, y, ww, hh, 8);
      g.stroke();
    };
    outline(90, 120, 30, 220);
    outline(140, 120, 30, 200);
    outline(190, 120, 26, 180);
    outline(720, 90, 120, 60);
    g.font = `600 28px ${FONT}`;
    g.fillStyle = 'rgba(20,20,24,0.75)';
    g.fillText('PUT IT BACK', 640, 470);
  });
}

/** the label on a parts drawer */
function binLabel(text: string): THREE.CanvasTexture {
  return canvasTexture(`workshop:bin:${text}`, 128, 40, (g, w, h) => {
    g.fillStyle = '#f2efe6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1a1a';
    g.font = `700 24px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

/** the self-healing cutting mat under the board */
function matTexture(): THREE.CanvasTexture {
  return canvasTexture('workshop:mat', 512, 256, (g, w, h) => {
    g.fillStyle = '#1f5a45';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(220,240,230,0.18)';
    g.lineWidth = 1;
    for (let x = 0; x < w; x += 16) {
      g.beginPath();
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, h);
      g.stroke();
    }
    for (let y = 0; y < h; y += 16) {
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(w, y + 0.5);
      g.stroke();
    }
    g.strokeStyle = 'rgba(240,250,245,0.4)';
    g.lineWidth = 2;
    for (let x = 0; x < w; x += 80) {
      g.beginPath();
      g.moveTo(x + 1, 0);
      g.lineTo(x + 1, h);
      g.stroke();
    }
    g.fillStyle = 'rgba(240,250,245,0.5)';
    g.font = `600 12px ${FONT}`;
    for (let x = 0, n = 0; x < w; x += 80, n++) g.fillText(String(n * 5), x + 4, 12);
  });
}

class Workshop extends VenueBase {
  readonly views: VenueViews = {
    // over your shoulder at the bench, the way you'd look at what you're building
    wide: { pos: V(0, 1.75, 1.05), target: V(0, TABLE_Y, -0.15) },
    wideLabel: 'Over the bench',
    crowd: { pos: V(1.9, 1.9, 2.6), target: V(-0.1, 1.0, -0.2) },
    drone: [V(1.6, 1.9, 2.4), V(-1.6, 1.9, 2.2), V(-1.8, 1.6, 0.6), V(0, 1.8, 0.9), V(1.8, 1.6, 0.6)],
    extra: { cctv: { pos: V(-2.4, 2.5, 3.0), target: V(0, 1, 0) }, crane: { radius: 1.5, low: 1.2, high: 2.2 }, vertigo: { near: 1.0, far: 2.4, height: 1.5 } },
  };
  private lampLight: THREE.SpotLight;
  private lampBulb: THREE.MeshBasicMaterial;
  private radioDial: THREE.MeshBasicMaterial;
  private windowLight: THREE.PointLight;
  private ceilingLight: THREE.PointLight;
  private bench = new THREE.Group();
  private t = 0;

  constructor() {
    super({ fog: 0x07070a, fogDensity: 0.014, background: 0x07070a, hemiSky: 0x40404c, hemiGround: 0x1a140e, hemi: 0.3, flashAt: V(0, 2.3, 1.2), flashRange: 6 });
    this.keyLight = { color: 0xffe2bc, intensity: 6 };
    this.grade = { tint: 0xfff2e0, contrast: 1.04, saturation: 1.02, lift: 0.012 };
    this.toneMapping = 'agx';
    const R = WORKSHOP;
    const W = R.x1 - R.x0;
    const D = R.z1 - R.z0;

    // the room: concrete floor, painted block walls
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.85, map: concreteTexture(78) });
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    fl.rotation.x = -Math.PI / 2;
    fl.position.set(0, 0, (R.z0 + R.z1) / 2);
    fl.receiveShadow = true;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.92 });
    const wall = (w: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, R.h), wallMat);
      m.position.set(x, R.h / 2, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      return m;
    };
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, R.h, (R.z0 + R.z1) / 2);
    this.group.add(fl, ceil, wall(W, 0, R.z0, 0), wall(W, 0, R.z1, Math.PI), wall(D, R.x0, (R.z0 + R.z1) / 2, Math.PI / 2), wall(D, R.x1, (R.z0 + R.z1) / 2, -Math.PI / 2));

    // the window on the left wall: the city at 4am
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ map: windowsTexture('workshop:city', '#ffcf8a', 0.3), color: 0x8892a8, toneMapped: false }));
    win.position.set(R.x0 + 0.01, 1.65, 1.2);
    win.rotation.y = Math.PI / 2;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5 });
    for (const [w, h, y, z] of [[0.05, 0.98, 1.65, 0.48], [0.05, 0.98, 1.65, 1.92], [0.05, 0.05, 2.12, 1.2], [0.05, 0.05, 1.18, 1.2], [0.05, 0.05, 1.65, 1.2]] as const) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, w === 0.05 && h === 0.05 ? 1.48 : w), frameMat);
      f.position.set(R.x0 + 0.03, y, z);
      this.group.add(f);
    }
    this.group.add(win);
    this.windowLight = new THREE.PointLight(0x7f8fb8, 1.2, 5, 1.6);
    this.windowLight.position.set(R.x0 + 0.4, 1.7, 1.2);
    this.group.add(this.windowLight);

    // the workbench: a thick beech top on steel legs, a shelf underneath with parts bins
    const wood = woodTexture();
    wood.repeat.set(2, 1);
    const topMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wood, roughness: 0.55 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.45, metalness: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(BENCH.w, 0.05, BENCH.d), topMat);
    top.position.set(0, TABLE_Y - 0.025, BENCH.z);
    top.receiveShadow = true;
    top.castShadow = true;
    this.bench.add(top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE_Y - 0.05, 0.05), steel);
      leg.position.set(sx * (BENCH.w / 2 - 0.06), (TABLE_Y - 0.05) / 2, BENCH.z + sz * (BENCH.d / 2 - 0.06));
      this.bench.add(leg);
    }
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(BENCH.w - 0.1, 0.025, BENCH.d - 0.1), topMat);
    shelf.position.set(0, 0.22, BENCH.z);
    this.bench.add(shelf);
    // the cutting mat where the board goes
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.75), new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.8 }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(0, TABLE_Y + 0.002, BENCH.z - 0.02);
    mat.receiveShadow = true;
    this.bench.add(mat);
    // the venues hide their own booth when a custom board brings a table; this is that booth
    this.bench.userData.venueBooth = true;
    this.group.add(this.bench);

    // parts bins under the bench and a drawer cabinet on the right of it
    const binColors = [0xd8402f, 0xf0b62e, 0x2f7fd8, 0x3aa65a, 0xe8e4da];
    const r = rng(19);
    for (let i = 0; i < 8; i++) {
      const bin = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.15, 0.36), new THREE.MeshStandardMaterial({ color: binColors[i % binColors.length], roughness: 0.55 }));
      bin.position.set(-1.1 + i * 0.31, 0.31, BENCH.z + (r() - 0.5) * 0.08);
      this.bench.add(bin);
    }
    const labels = ['KNOBS', 'FADERS', 'PADS', 'JOGS', 'LEDS', 'CAPS', 'SCREWS', 'STICKERS', 'CABLES', 'GLITTER', 'SPARES', '???'];
    const cab = new THREE.Group();
    const cabBody = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.18), new THREE.MeshStandardMaterial({ color: 0x8a1f24, roughness: 0.5, metalness: 0.3 }));
    cabBody.position.y = 0.21;
    cab.add(cabBody);
    const drawerMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.3, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 12; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.085, 0.02), drawerMat);
      d.position.set(-0.155 + col * 0.155, 0.37 - row * 0.1, 0.095);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), new THREE.MeshBasicMaterial({ map: binLabel(labels[i]), color: 0xb8b4ac }));
      lab.position.z = 0.0105;
      d.add(lab);
      cab.add(d);
    }
    cab.position.set(BENCH.w / 2 - 0.32, TABLE_Y, BENCH.z - BENCH.d / 2 + 0.12);
    this.bench.add(cab);

    // the pegboard on the wall over the bench, and a few tools hanging off it
    const peg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.1), new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.85 }));
    peg.position.set(0, TABLE_Y + 0.95, R.z0 + 0.02);
    this.group.add(peg);
    const pegZ = R.z0 + 0.04;
    const pegY = (py: number) => TABLE_Y + 0.95 + (0.5 - py) * 1.1;
    const pegX = (px: number) => (px - 0.5) * 2.4;
    const handle = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    // screwdrivers (yellow, red, blue)
    [[0.1, 0xf0c22e], [0.151, 0xd8402f], [0.2, 0x2f7fd8]].forEach(([px, c]) => {
      const sd = new THREE.Group();
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.1, 10), handle(c));
      h.position.y = 0.05;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 6), steel);
      shaft.position.y = -0.06;
      sd.add(h, shaft);
      sd.position.set(pegX(px), pegY(0.42), pegZ + 0.02);
      this.group.add(sd);
    });
    // a coil of cable and a wrench
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 40), new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.6 }));
    coil.position.set(pegX(0.42), pegY(0.4), pegZ + 0.03);
    for (let i = 1; i < 4; i++) {
      const c2 = coil.clone();
      c2.scale.setScalar(1 - i * 0.04);
      c2.position.z += i * 0.006;
      c2.rotation.z = i * 0.3;
      this.group.add(c2);
    }
    this.group.add(coil);
    const wrench = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.24, 0.008), steel);
    wrench.position.set(pegX(0.82), pegY(0.3), pegZ + 0.01);
    wrench.rotation.z = Math.PI / 2 - 0.1;
    this.group.add(wrench);
    // a soldering iron in its stand at the back of the bench
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 16), steel);
    stand.position.set(-BENCH.w / 2 + 0.22, TABLE_Y + 0.015, BENCH.z - BENCH.d / 2 + 0.14);
    const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.12, 10, 1, true), steel);
    spring.position.set(0, 0.07, 0);
    spring.rotation.z = 0.6;
    stand.add(spring);
    const iron = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8), handle(0x2b6fd0));
    iron.position.set(-0.05, 0.1, 0);
    iron.rotation.z = 0.6;
    stand.add(iron);
    this.group.add(stand);
    // a mug
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.4 }));
    mug.position.set(BENCH.w / 2 - 0.25, TABLE_Y + 0.045, BENCH.z + 0.28);
    this.group.add(mug);

    // the radio on the shelf: its dial glows with the music
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.7 });
    const wallShelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.28), shelfMat);
    wallShelf.position.set(-1.6, 2.15, R.z0 + 0.14);
    this.group.add(wallShelf);
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.12), new THREE.MeshStandardMaterial({ color: 0x6e2a1e, roughness: 0.6 }));
    radio.position.set(-1.85, 2.255, R.z0 + 0.14);
    this.radioDial = new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false });
    const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), this.radioDial);
    dial.position.set(0, 0.04, 0.061);
    radio.add(dial);
    this.group.add(radio);
    // half-built boards on the shelf: bare panels with holes where the knobs go
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.22), new THREE.MeshStandardMaterial({ color: i ? 0x2a2d33 : 0x6b7382, roughness: 0.4, metalness: 0.5 }));
      p.position.set(-1.38 + i * 0.05, 2.18 + 0.06 + i * 0.03, R.z0 + 0.13);
      p.rotation.x = 1.2;
      this.group.add(p);
    }

    // your name, label-maker tape on the front of the bench
    if (nameService.named) {
      const tape = nameService.surface('sticker', 0.42, 0.06, { gain: 1 });
      tape.position.set(-0.7, TABLE_Y - 0.03, BENCH.z + BENCH.d / 2 + 0.002);
      this.bench.add(tape);
    }

    // the desk lamp: clamp, two arms, a shade pointing at the mat
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.35, metalness: 0.5 });
    const lamp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 12), lampMat);
    base.position.y = 0.025;
    lamp.add(base);
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), lampMat);
    arm1.position.set(0.12, 0.27, 0);
    arm1.rotation.z = -0.5;
    lamp.add(arm1);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 6), lampMat);
    arm2.position.set(0.42, 0.52, 0);
    arm2.rotation.z = -1.25;
    lamp.add(arm2);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.11, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.35, metalness: 0.5, side: THREE.DoubleSide }));
    shade.position.set(0.63, 0.47, 0);
    shade.rotation.z = 0.5;
    lamp.add(shade);
    this.lampBulb = new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), this.lampBulb);
    bulb.position.set(0.64, 0.44, 0);
    lamp.add(bulb);
    lamp.position.set(-BENCH.w / 2 + 0.15, TABLE_Y, BENCH.z - BENCH.d / 2 + 0.1);
    lamp.rotation.y = -0.5;
    this.group.add(lamp);
    this.lampLight = new THREE.SpotLight(0xffe7c4, 9, 3.5, 0.75, 0.6, 1.6);
    lamp.updateMatrixWorld(true);
    this.lampLight.position.copy(bulb.getWorldPosition(new THREE.Vector3()));
    this.lampLight.target.position.set(0, TABLE_Y, BENCH.z);
    this.lampLight.castShadow = false;
    this.group.add(this.lampLight, this.lampLight.target);

    // a strip light on the ceiling, low: the lamp does the work
    this.ceilingLight = new THREE.PointLight(0xe8eef8, 1.4, 6, 1.6);
    this.ceilingLight.position.set(0, R.h - 0.2, 1.2);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.08), new THREE.MeshBasicMaterial({ color: 0xc8d0dc, toneMapped: false }));
    tube.position.set(0, R.h - 0.03, 1.2);
    this.group.add(this.ceilingLight, tube);

    // a soft shadow under the bench and dust in the lamp's beam
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(BENCH.w + 0.4, BENCH.d + 0.4), new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.004, BENCH.z);
    this.group.add(blob);
    this.add(new DustMotes(new THREE.Box3(V(-1, TABLE_Y, -0.7), V(0.6, TABLE_Y + 0.9, 0.5)), 90, 23));
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    this.t += dt;
    // the radio's dial breathes with whatever's playing
    const lvl = Math.min(1, s.kick * 0.6 + s.wash * 0.4);
    this.radioDial.color.setRGB(1.6, 0.95, 0.35).multiplyScalar(0.5 + lvl * 0.8);
    // the lamp is steady; the strip light flickers now and then (it's an old tube)
    const flick = Math.sin(this.t * 0.7) > 0.995 ? 0.4 : 1;
    this.ceilingLight.intensity = 1.4 * flick;
    this.lampBulb.color.setRGB(2.4, 2.2, 1.8);
    this.windowLight.intensity = 1 + Math.sin(this.t * 0.2) * 0.1;
  }
}

export const workshop: VenueDef = {
  id: 'workshop',
  name: 'Workshop',
  place: '',
  kind: 'hub',
  blurb: '',
  palette: ['#ffd7a8', '#3ad7ff', '#ff2e88'],
  ui: '#3ad7ff',
  capacity: '',
  build: () => new Workshop(),
  thumb(g, w, h) {
    g.fillStyle = '#c9b48f';
    g.fillRect(0, 0, w, h * 0.6);
    g.fillStyle = '#2a2018';
    for (let y = 6; y < h * 0.6; y += 10) for (let x = 6; x < w; x += 10) g.fillRect(x, y, 2, 2);
    g.fillStyle = '#b07a42';
    g.fillRect(0, h * 0.6, w, h * 0.12);
    g.fillStyle = '#1f2026';
    g.fillRect(0, h * 0.72, w, h * 0.28);
  },
};
