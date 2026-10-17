/*
 * The Bedroom (Section 5.2): where it starts. A small room, posters on the
 * wall, fairy lights, a desk lamp and a colour-changing LED strip, the
 * controller on a desk. The crowd is the stream: 3 to 50 viewers in the chat
 * (ui/StreamChat.ts).
 *
 * Signature moment: a raid. The viewer count spikes, chat floods with your
 * name, and the LED strip goes full rainbow (signature('raid')).
 *
 * TODO: procedural stand-in for the Blender bedroom set (Section 14).
 */
import * as THREE from 'three';
import { bevelBox } from '../bevel';
import { nameStyleFor } from '../../name/venueStyles';
import { VenueBase, type VenueDef, type VenueViews } from './base';
import { boothClutter } from './details';
import { Dresser } from './dress';
import { booth, LedStrings, TABLE_Y } from './fixtures';
import type { ShowState } from './show';
import { canvasTexture, floorTexture, rng } from './tex';
import type { Features } from '../../visualizer/AudioFeatures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** the room (the desk is against the front wall, the DJ faces it) */
export const BEDROOM = { x0: -2.1, x1: 2.1, z0: -0.95, z1: 3.1, h: 2.5 };

const STRIP_VERT = /* glsl */ `
  varying float vX;
  void main() {
    vX = position.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const STRIP_FRAG = /* glsl */ `
  uniform float uHue, uRainbow, uLevel, uTime;
  varying float vX;
  vec3 hsv(float h) {
    vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return k;
  }
  void main() {
    // one colour that changes with the music, or a rainbow running along the strip
    vec3 c = mix(hsv(uHue), hsv(vX * 0.6 - uTime * 0.8), uRainbow);
    gl_FragColor = vec4(c * uLevel, 1.0);
  }`;

function poster(seed: number): THREE.CanvasTexture {
  return canvasTexture(`bedroom-poster:${seed}`, 160, 224, (g, w, h) => {
    const r = rng(seed * 31);
    const bgs = ['#1f2c44', '#ff2e88', '#e9e2cf', '#7a3cff', '#0e0e10', '#ffb547'];
    g.fillStyle = bgs[seed % bgs.length];
    g.fillRect(0, 0, w, h);
    // dark ink on the light papers, light ink on the dark ones
    const ink = ['#e9e6df', '#0e0e10', '#0e0e10', '#e9e6df', '#e9e6df', '#0e0e10'][seed % bgs.length];
    g.fillStyle = ink;
    g.globalAlpha = 0.85;
    if (seed % 3 === 0) {
      // a big smiley
      g.beginPath();
      g.arc(w / 2, h * 0.4, w * 0.3, 0, Math.PI * 2);
      g.fillStyle = '#ffd400';
      g.fill();
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(w * 0.4, h * 0.36, 6, 0, Math.PI * 2);
      g.arc(w * 0.6, h * 0.36, 6, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = '#111';
      g.beginPath();
      g.arc(w / 2, h * 0.42, w * 0.17, 0.2, Math.PI - 0.2);
      g.stroke();
    } else {
      for (let i = 0; i < 6; i++) g.fillRect(0, h * 0.12 + i * 18, w * (0.4 + r() * 0.6), 8);
    }
    g.globalAlpha = 1;
    g.fillStyle = ink;
    g.font = '800 26px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText(['WAREHOUSE 92', 'ACID SUMMER', 'ALL NIGHT', 'SUNDAY SERVICE', 'BASS CULTURE', 'NORTHERN SOUL'][seed % 6], w / 2, h * 0.8, w * 0.9);
    g.font = '600 12px "Barlow Condensed", sans-serif';
    g.fillText('HOUSE · GARAGE · DISCO', w / 2, h * 0.88, w * 0.9);
  });
}

/** the view from the window: a night sky going orange at the bottom with city glow, the moon, two rows of rooftops with lit windows, a red light on a mast */
function nightView(): THREE.CanvasTexture {
  return canvasTexture('bedroom-view', 384, 320, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#060818');
    sky.addColorStop(0.55, '#1a1838');
    sky.addColorStop(0.85, '#5a3448');
    sky.addColorStop(1, '#8a4a3a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const r = rng(907);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`;
      g.fillRect(r() * w, r() * h * 0.5, 1, 1);
    }
    const moon = g.createRadialGradient(w * 0.74, h * 0.2, 0, w * 0.74, h * 0.2, 40);
    moon.addColorStop(0, 'rgba(255,248,230,1)');
    moon.addColorStop(0.3, 'rgba(255,248,230,0.9)');
    moon.addColorStop(0.36, 'rgba(200,210,255,0.25)');
    moon.addColorStop(1, 'rgba(200,210,255,0)');
    g.fillStyle = moon;
    g.fillRect(0, 0, w, h);
    // far rooftops, then nearer ones, each with lit windows
    for (const [base, tone, wh, step] of [
      [0.66, '#141526', 0.18, 5],
      [0.8, '#0b0b14', 0.3, 8],
    ] as [number, string, number, number][]) {
      let x = -10;
      while (x < w) {
        const bw = 24 + r() * 46;
        const bh = h * (0.08 + r() * wh);
        const top = h * base - bh;
        g.fillStyle = tone;
        g.fillRect(x, top, bw, h - top);
        for (let wy = top + 6; wy < h - 4; wy += step)
          for (let wx = x + 4; wx < x + bw - 4; wx += step) {
            if (r() > 0.32) continue;
            g.fillStyle = r() < 0.8 ? 'rgba(255,214,150,0.9)' : 'rgba(190,220,255,0.85)';
            g.fillRect(wx, wy, step * 0.5, step * 0.45);
          }
        if (r() < 0.25) {
          g.fillStyle = tone;
          g.fillRect(x + bw * 0.5, top - 22, 2, 22);
          g.fillStyle = '#ff3a2a';
          g.fillRect(x + bw * 0.5 - 1.5, top - 25, 5, 4);
        }
        x += bw + 2 + r() * 10;
      }
    }
  });
}

class Bedroom extends VenueBase {
  readonly views: VenueViews = {
    // the stream camera, from the wall behind the desk
    wide: { pos: V(0, 1.46, -0.6), target: V(0, 1.38, 1.4) },
    wideLabel: 'Stream cam',
    director: {
      style: 'stream',
      // just you in your room: nobody to turn round to
      skip: ['reverse', 'jib', 'ots', 'pullback'],
    },
    crowd: { pos: V(1.65, 1.85, 2.75), target: V(-0.1, 1.05, 0.1) },
    drone: [V(1.4, 1.9, 2.6), V(-1.5, 1.9, 2.4), V(-1.6, 1.7, 0.6), V(0, 1.9, -0.4), V(1.6, 1.7, 0.6)],
    extra: { cctv: { pos: V(-1.95, 2.35, 2.95), target: V(0, 1, 0) }, crane: { radius: 1.6, low: 1.2, high: 2.1 }, vertigo: { near: 1.1, far: 2.6, height: 1.4 } },
  };
  private ledStrip: THREE.ShaderMaterial;
  private stripLight: THREE.PointLight;
  private backLight: THREE.PointLight;
  private lamp: THREE.SpotLight;
  private hue = 0;
  private rainbow = 0;
  private raidT = -1e9;
  private t = 0;

  constructor() {
    super({ fog: 0x07060b, fogDensity: 0.02, background: 0x05040a, hemiSky: 0x2a2440, hemiGround: 0x0c0a08, hemi: 0.25, flashAt: V(0, 2.2, 1), flashRange: 6 });
    this.keyLight = { color: 0xffd9a8, intensity: 5 };
    this.grade = { tint: 0xfff0e2, contrast: 1.06, saturation: 1.05, lift: 0.01 };
    this.toneMapping = 'agx';
    const { x0, x1, z0, z1, h } = BEDROOM;
    const W = x1 - x0;
    const D = z1 - z0;
    const cz = (z0 + z1) / 2;

    // the room: painted walls, a wooden floor, a rug
    const wall = new THREE.MeshStandardMaterial({ color: 0x2c3046, roughness: 0.9 });
    const ft = floorTexture('#3a2a1e', 'bedroom-floor').clone();
    ft.userData = {};
    ft.repeat.set(W / 1.5, D / 1.5);
    ft.needsUpdate = true;
    const floorMat = new THREE.MeshStandardMaterial({ map: ft, color: 0xb08860, roughness: 0.7 });
    const ceil = new THREE.MeshStandardMaterial({ color: 0x24263a, roughness: 0.95 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, h, D), [wall, wall, ceil, floorMat, wall, wall]);
    for (const m of shell.material as THREE.Material[]) m.side = THREE.BackSide;
    shell.position.set(0, h / 2, cz);
    shell.receiveShadow = true;
    this.group.add(shell);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshStandardMaterial({ color: 0x5a1e3a, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.2, 0.004, 1.5);
    this.group.add(rug);

    // the desk against the front wall, the controller on it (the board); no computer
    // a dark walnut top: a white desk under the lamp blew out the frame round the board
    const desk = booth({ w: 1.6, d: 0.72, front: new THREE.MeshStandardMaterial({ color: 0x2c241e, roughness: 0.6 }), top: 0x4a3a2e, strip: null, z: -0.12 });
    this.group.add(desk.group);
    boothClutter(this.group, 1.6, TABLE_Y, -0.45, 33, { laptop: false });
    // little monitor speakers either side
    for (const x of [-0.62, 0.62]) {
      const spk = new THREE.Mesh(bevelBox(0.16, 0.24, 0.18), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5 }));
      spk.position.set(x, TABLE_Y + 0.12, -0.55);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.3, metalness: 0.4 }));
      cone.position.set(x, TABLE_Y + 0.1, -0.459);
      this.group.add(spk, cone);
    }

    // the desk lamp
    const lampBody = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.4, metalness: 0.5 });
    const lamp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 16), lampBody);
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 6), lampBody);
    arm1.position.set(0, 0.15, -0.04);
    arm1.rotation.x = -0.35;
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 6), lampBody);
    arm2.position.set(0, 0.34, 0.06);
    arm2.rotation.x = 1.0;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.11, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x1b1d22, side: THREE.DoubleSide, roughness: 0.4 }));
    shade.position.set(0, 0.38, 0.2);
    shade.rotation.x = 2.3;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.25, 0.9), toneMapped: false }));
    bulb.position.set(0, 0.36, 0.22);
    lamp.add(base, arm1, arm2, shade, bulb);
    lamp.position.set(-0.68, TABLE_Y, -0.4);
    this.group.add(lamp);
    // a soft pool to the left of the board, not a hot spot on it
    this.lamp = new THREE.SpotLight(0xffcf90, 1.3, 2.5, 0.8, 0.9, 1.6);
    this.lamp.position.set(-0.68, TABLE_Y + 0.36, -0.18);
    this.lamp.target.position.set(-0.55, TABLE_Y, 0.1);
    this.group.add(this.lamp, this.lamp.target);

    // the colour-changing LED strip along the top of the front wall and under the desk
    this.ledStrip = new THREE.ShaderMaterial({ uniforms: { uHue: { value: 0 }, uRainbow: { value: 0 }, uLevel: { value: 1 }, uTime: { value: 0 } }, vertexShader: STRIP_VERT, fragmentShader: STRIP_FRAG, toneMapped: false });
    const top = new THREE.Mesh(bevelBox(W - 0.1, 0.02, 0.02), this.ledStrip);
    top.position.set(0, h - 0.06, z0 + 0.03);
    const under = new THREE.Mesh(bevelBox(1.5, 0.015, 0.015), this.ledStrip);
    under.position.set(0, TABLE_Y - 0.05, -0.47);
    const back = new THREE.Mesh(bevelBox(W - 0.1, 0.02, 0.02), this.ledStrip);
    back.position.set(0, h - 0.06, z1 - 0.03);
    this.group.add(top, under, back);
    this.stripLight = new THREE.PointLight(0xff2e88, 1.5, 5, 1.4);
    this.stripLight.position.set(0, h - 0.25, 0.4);
    const stripLight2 = new THREE.PointLight(0xff2e88, 0.8, 4, 1.4);
    stripLight2.position.set(0, h - 0.25, z1 - 0.4);
    this.group.add(this.stripLight, stripLight2);
    this.backLight = stripLight2;

    // fairy lights in loops over the bed and along the side wall
    const fairy = new LedStrings({ warm: '#ffcf8a', size: 0.05, spacing: 0.12 });
    const loops: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const x = x0 + 0.2 + (i / 24) * (W - 0.4);
      loops.push(V(x, h - 0.25 - Math.abs(Math.sin((i / 24) * Math.PI * 4)) * 0.22, z1 - 0.06));
    }
    fairy.path(loops);
    fairy.path([V(x0 + 0.05, h - 0.3, z1 - 0.2), V(x0 + 0.05, h - 0.45, 1.6), V(x0 + 0.05, h - 0.3, 0.4)]);
    this.add(fairy.done());

    // the bed, a window onto the night, posters, records, a plant
    const bed = new THREE.Group();
    const frame = new THREE.Mesh(bevelBox(1.5, 0.3, 2.0), new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.7 }));
    frame.position.y = 0.15;
    // the soft things get deep bevels so they read as padded
    const mattress = new THREE.Mesh(bevelBox(1.42, 0.2, 1.92, 0.06), new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.95 }));
    mattress.position.y = 0.4;
    const duvet = new THREE.Mesh(bevelBox(1.46, 0.08, 1.3, 0.03), new THREE.MeshStandardMaterial({ color: 0x3a5a86, roughness: 0.95 }));
    duvet.position.set(0, 0.53, -0.3);
    const pillow = new THREE.Mesh(bevelBox(0.55, 0.12, 0.35, 0.05), mattress.material);
    const pillow2 = pillow.clone();
    pillow.position.set(-0.35, 0.56, 0.7);
    pillow2.position.set(0.35, 0.56, 0.7);
    const head = new THREE.Mesh(bevelBox(1.5, 0.7, 0.06), frame.material);
    head.position.set(0, 0.6, 1.0);
    bed.add(frame, mattress, duvet, pillow, pillow2, head);
    bed.position.set(-0.75, 0, z1 - 1.05);
    this.group.add(bed);
    // the window on the right wall, the city at night outside
    const win = new THREE.Group();
    const night = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), new THREE.MeshBasicMaterial({ map: nightView(), color: new THREE.Color(0.85, 0.85, 0.95) }));
    const sill = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.6 });
    win.add(night);
    for (const [w, hh, x, y] of [
      [1.2, 0.05, 0, 0.47],
      [1.2, 0.05, 0, -0.47],
      [0.05, 0.98, 0.58, 0],
      [0.05, 0.98, -0.58, 0],
      [0.03, 0.9, 0, 0],
    ]) {
      const m = new THREE.Mesh(bevelBox(w, hh, 0.05), sill);
      m.position.set(x, y, 0.02);
      win.add(m);
    }
    win.position.set(x1 - 0.01, 1.45, 1.4);
    win.rotation.y = -Math.PI / 2;
    this.group.add(win);
    const moon = new THREE.PointLight(0x8aa0ff, 0.6, 4, 1.5);
    moon.position.set(x1 - 0.4, 1.5, 1.4);
    this.group.add(moon);
    // posters on the front wall over the desk and on the left wall
    const spots: [number, number, number, number][] = [
      [-1.25, 1.75, z0 + 0.01, 0],
      [-0.75, 1.95, z0 + 0.01, 0],
      [0.95, 1.8, z0 + 0.01, 0],
      [1.45, 1.6, z0 + 0.01, 0],
      [x0 + 0.01, 1.6, 0.6, Math.PI / 2],
      [x0 + 0.01, 1.7, 1.2, Math.PI / 2],
    ];
    const r = rng(41);
    spots.forEach(([x, y, z, ry], i) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.56), new THREE.MeshStandardMaterial({ map: poster(i), roughness: 0.85 }));
      p.position.set(x, y, z);
      p.rotation.set(0, ry, (r() - 0.5) * 0.1);
      this.group.add(p);
    });
    // your name, hand-drawn on a sheet taped to the wall
    const nm = nameStyleFor('bedroom');
    if (nm.sign) this.nameSign(nm.sign, 0.62, 0.3, V(0.2, 2.1, z0 + 0.012), 0, 1);
    // a crate of records and a plant
    const crate = new THREE.Mesh(bevelBox(0.36, 0.3, 0.36), new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.8 }));
    crate.position.set(1.4, 0.15, 0.4);
    this.group.add(crate);
    for (let i = 0; i < 9; i++) {
      const rec = new THREE.Mesh(bevelBox(0.31, 0.31, 0.006), new THREE.MeshStandardMaterial({ color: [0x111111, 0xff2e88, 0xe9e2cf, 0x3a5a86][i % 4], roughness: 0.6 }));
      rec.position.set(1.4, 0.36, 0.28 + i * 0.026);
      rec.rotation.x = -0.15;
      this.group.add(rec);
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.22, 14), new THREE.MeshStandardMaterial({ color: 0xc96b3c, roughness: 0.8 }));
    pot.position.set(1.7, 0.11, 2.6);
    this.group.add(pot);
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2e6b3a, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.45), leaf);
      l.position.set(1.7, 0.42, 2.6);
      l.rotation.set((r() - 0.5) * 0.8, (i / 9) * Math.PI * 2, (r() - 0.5) * 0.8);
      l.translateY(0.12);
      this.group.add(l);
    }
    this.dress();
  }

  /** a lived-in bedroom studio: records, foam, a ring light, the chair, the clutter */
  private dress(): void {
    const { x0, x1, z0, h } = BEDROOM;
    const d = new Dresser(11);
    // a low cube shelf of records in the front-right corner, a turntable and a speaker on top
    const sx = x1 - 0.21;
    const sz0 = -0.92;
    const plank = (w: number, hh: number, dd: number, x: number, y: number, z: number) => d.box('white', w, hh, dd, x, y, z);
    plank(0.39, 0.03, 1.47, sx, 0.015, sz0 + 0.735);
    plank(0.39, 0.03, 1.47, sx, 0.785, sz0 + 0.735);
    plank(0.39, 0.03, 1.47, sx, 0.4, sz0 + 0.735);
    for (let i = 0; i <= 4; i++) plank(0.39, 0.77, 0.03, sx, 0.4, sz0 + 0.015 + i * 0.36);
    const sleeves: ('black' | 'cream' | 'red' | 'blue' | 'yellow' | 'grey')[] = ['black', 'cream', 'red', 'black', 'blue', 'yellow', 'grey', 'black'];
    for (let row = 0; row < 2; row++)
      for (let cube = 0; cube < 4; cube++) {
        const n = 18 + Math.floor(d.r() * 10);
        for (let k = 0; k < n; k++) {
          const z = sz0 + 0.04 + cube * 0.36 + k * 0.0115;
          if (z > sz0 + 0.03 + cube * 0.36 + 0.33) break;
          const hh = 0.3 + d.r() * 0.02;
          d.box(sleeves[Math.floor(d.r() * sleeves.length)], 0.3, hh, 0.008, sx + 0.02, 0.03 + row * 0.385 + hh / 2, z, 0, 0, (d.r() - 0.5) * 0.05);
        }
      }
    // the turntable on top, a record on the platter, a few sleeves leaning on the wall
    d.box('blackMetal', 0.36, 0.09, 0.45, sx, 0.845, sz0 + 0.5);
    d.put('alu', new THREE.CylinderGeometry(0.15, 0.15, 0.02, 24).translate(sx, 0.9, sz0 + 0.48));
    d.put('black', new THREE.CylinderGeometry(0.148, 0.148, 0.004, 24).translate(sx, 0.912, sz0 + 0.48));
    d.rod('alu', V(sx + 0.14, 0.93, sz0 + 0.65), V(sx + 0.04, 0.93, sz0 + 0.5), 0.005, 4);
    for (let i = 0; i < 3; i++) d.box(sleeves[i + 1], 0.31, 0.31, 0.006, sx + 0.12, 0.96, sz0 + 1.0 + i * 0.04, Math.PI / 2, 0, -0.18 - i * 0.03);
    d.box('black', 0.16, 0.26, 0.18, sx, 0.93, sz0 + 1.3);
    // acoustic foam behind the desk, either side of the board
    for (const cx of [-0.95, 0.75])
      for (let ix = 0; ix < 2; ix++)
        for (let iy = 0; iy < 2; iy++) {
          const x = cx + ix * 0.31;
          const y = 1.2 + iy * 0.31;
          d.box(ix === iy ? 'black' : 'grey', 0.3, 0.3, 0.03, x, y, z0 + 0.016);
          for (let w = 0; w < 4; w++) d.put(ix === iy ? 'black' : 'grey', new THREE.CylinderGeometry(0.035, 0.035, 0.29, 3).rotateZ(Math.PI / 2).rotateX(ix === iy ? 0 : Math.PI / 2).translate(x, y - 0.11 + w * 0.073, z0 + 0.04));
        }
    // the streamer's ring light on a tripod, turned to face the desk
    const ring = d.glow('#fff4e6', 'steady', 0.8);
    const rp = V(-1.3, 0, -0.35);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      d.rod('blackMetal', V(rp.x + Math.cos(a) * 0.28, 0, rp.z + Math.sin(a) * 0.28), V(rp.x, 0.55, rp.z), 0.01, 4);
    }
    d.rod('blackMetal', V(rp.x, 0.55, rp.z), V(rp.x, 1.5, rp.z), 0.012, 6);
    d.put(ring, new THREE.TorusGeometry(0.2, 0.022, 8, 32).rotateY(0.9).translate(rp.x, 1.62, rp.z));
    d.put('black', new THREE.TorusGeometry(0.2, 0.03, 6, 32).rotateY(0.9).translate(rp.x - Math.sin(0.9) * 0.015, 1.62, rp.z - Math.cos(0.9) * 0.015));
    // the desk chair, pushed out of the way, a hoodie over its back
    const cp = V(-1.25, 0, 0.85);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      d.rod('blackMetal', V(cp.x, 0.08, cp.z), V(cp.x + Math.cos(a) * 0.3, 0.05, cp.z + Math.sin(a) * 0.3), 0.015, 4);
      d.put('rubber', new THREE.SphereGeometry(0.03, 6, 4).translate(cp.x + Math.cos(a) * 0.3, 0.03, cp.z + Math.sin(a) * 0.3));
    }
    d.rod('steel', V(cp.x, 0.08, cp.z), V(cp.x, 0.45, cp.z), 0.025, 8);
    d.box('black', 0.5, 0.08, 0.48, cp.x, 0.48, cp.z, 0.6);
    d.box('black', 0.48, 0.62, 0.07, cp.x + Math.sin(0.6) * 0.22, 0.85, cp.z + Math.cos(0.6) * 0.22, 0.6, -0.1);
    d.box('red', 0.5, 0.36, 0.1, cp.x + Math.sin(0.6) * 0.27, 1.02, cp.z + Math.cos(0.6) * 0.27, 0.6, 0.15);
    // a skateboard leaning on the left wall, trainers by the bed
    d.box('darkWood', 0.2, 0.012, 0.8, x0 + 0.1, 0.42, 2.0, 0, -1.2);
    for (const dz of [-0.28, 0.28]) for (const dx of [-0.07, 0.07]) d.put('cream', new THREE.CylinderGeometry(0.026, 0.026, 0.03, 8).rotateZ(Math.PI / 2).translate(x0 + 0.13 + dx * 0.1, 0.42 + dz * Math.cos(1.2), 2.0 - dz * Math.sin(1.2) * 0.1 + dx));
    for (const dx of [0, 0.14]) {
      d.box('white', 0.11, 0.08, 0.28, 0.3 + dx, 0.04, 2.55, 0.2);
      d.box('red', 0.112, 0.02, 0.282, 0.3 + dx, 0.01, 2.55, 0.2);
    }
    // a mini fridge with stickers, a can on top
    d.box('white', 0.48, 0.82, 0.5, x1 - 0.27, 0.41, 2.25);
    d.box('grey', 0.03, 0.25, 0.03, x1 - 0.5, 0.6, 2.05);
    for (let i = 0; i < 5; i++) d.box((['red', 'blue', 'yellow', 'black', 'green'] as const)[i], 0.07 + d.r() * 0.05, 0.05 + d.r() * 0.05, 0.003, x1 - 0.2 - d.r() * 0.2, 0.3 + d.r() * 0.4, 1.999, 0, 0, (d.r() - 0.5) * 0.6);
    d.put('alu', new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10).translate(x1 - 0.3, 0.88, 2.3));
    // curtains either side of the window, on a rod
    const curtain = new THREE.MeshStandardMaterial({ color: 0x4a1e2a, roughness: 0.95, side: THREE.DoubleSide });
    for (const dz of [-0.78, 0.78]) {
      const g = new THREE.PlaneGeometry(0.42, 1.55, 12, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < p.count; j++) p.setZ(j, Math.sin(p.getX(j) * 38) * 0.03);
      d.put(curtain, g.rotateY(-Math.PI / 2).translate(x1 - 0.07, 1.25, 1.4 + dz));
    }
    d.rod('blackMetal', V(x1 - 0.07, 2.05, 0.45), V(x1 - 0.07, 2.05, 2.35), 0.012, 6);
    // a laptop left open on the bed, a throw at the foot
    const screen = d.glow('#9fc2ff', 'steady', 0.9);
    d.box('alu', 0.32, 0.015, 0.22, -0.55, 0.578, 1.75, 0.3);
    d.put(screen, new THREE.PlaneGeometry(0.3, 0.19).rotateX(-0.25).rotateY(Math.PI + 0.3).translate(-0.55 + Math.sin(0.3) * 0.1, 0.68, 1.75 + Math.cos(0.3) * 0.1));
    // the throw lies across the duvet and falls over both sides
    d.box('yellow', 1.54, 0.03, 0.42, -0.75, 0.585, 1.36);
    for (const s of [-1, 1]) d.box('yellow', 0.03, 0.24, 0.42, -0.75 + s * 0.77, 0.47, 1.36);
    // the door at the back of the left wall, a hoodie on its hook
    d.box('cream', 0.05, 2.02, 0.84, x0 + 0.03, 1.01, 2.6);
    d.box('white', 0.07, 2.1, 0.06, x0 + 0.035, 1.05, 2.15);
    d.box('white', 0.07, 2.1, 0.06, x0 + 0.035, 1.05, 3.05);
    d.box('white', 0.07, 0.06, 0.96, x0 + 0.035, 2.07, 2.6);
    d.put('alu', new THREE.SphereGeometry(0.03, 8, 6).translate(x0 + 0.08, 1.0, 2.3));
    d.box('blue', 0.08, 0.6, 0.38, x0 + 0.1, 1.45, 2.85);
    // a paper lantern on the ceiling (off: the strip and fairy lights do the work), a smoke alarm
    d.put('cream', new THREE.SphereGeometry(0.17, 16, 10).translate(-1.35, h - 0.36, 2.55));
    d.rod('black', V(-1.35, h - 0.19, 2.55), V(-1.35, h, 2.55), 0.004, 3);
    d.put('white', new THREE.CylinderGeometry(0.06, 0.06, 0.03, 14).translate(-0.8, h - 0.015, 0.6));
    // a socket by the desk, cables to the speakers and the strip
    d.box('white', 0.09, 0.09, 0.02, 0.9, 0.3, z0 + 0.01);
    d.cable(V(0.9, 0.3, z0 + 0.03), V(0.6, 0.9, z0 + 0.06), 0.12, 0.006);
    d.cable(V(0.9, 0.28, z0 + 0.03), V(-0.6, 0.9, z0 + 0.06), 0.2, 0.006);
    // the ON AIR light by the desk
    d.neon('ON AIR', '#ff2a3a', V(x0 + 0.02, 2.02, -0.35), Math.PI / 2, 0.16, 'steady');
    // photos pegged on a string over the bed
    const { z1 } = BEDROOM;
    const string = [V(-1.6, 1.62, z1 - 0.02), V(-0.75, 1.52, z1 - 0.02), V(0.05, 1.62, z1 - 0.02)];
    d.tube('rubber', string, 0.002, 3);
    const pics: ('blue' | 'red' | 'yellow' | 'green' | 'terracotta' | 'canvas')[] = ['blue', 'terracotta', 'yellow', 'green', 'red', 'canvas', 'blue', 'terracotta'];
    pics.forEach((k, i) => {
      const t = (i + 0.5) / pics.length;
      const x = -1.6 + t * 1.65;
      const y = 1.62 - Math.sin(t * Math.PI) * 0.1 - 0.065;
      const tilt = (d.r() - 0.5) * 0.25;
      d.box('white', 0.09, 0.11, 0.003, x, y, z1 - 0.025, 0, 0, tilt);
      d.box(k, 0.074, 0.074, 0.003, x - Math.sin(tilt) * 0.008, y + 0.008, z1 - 0.028, 0, 0, tilt);
      d.box('darkWood', 0.012, 0.03, 0.008, x, y + 0.06, z1 - 0.03);
    });
    // a laundry basket by the fridge, clothes on top and one on the floor
    d.put('canvas', new THREE.CylinderGeometry(0.21, 0.18, 0.46, 14, 1, true).translate(1.12, 0.23, 2.85));
    d.put('canvas', new THREE.CircleGeometry(0.18, 14).rotateX(-Math.PI / 2).translate(1.12, 0.01, 2.85));
    d.put('blue', new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(1.12, 0.42, 2.85));
    d.box('red', 0.3, 0.05, 0.22, 1.08, 0.5, 2.82, 0.5, 0.2, 0.1);
    d.box('grey', 0.42, 0.03, 0.3, 0.82, 0.015, 2.62, 0.9);

    this.add(d.done());
  }

  /** the raid: the strip goes full rainbow for a while */
  signature(what: string): void {
    if (what === 'raid') this.raidT = this.t;
  }

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    this.t += dt;
    // the strip's colour walks round the wheel, a step on every bar, faster at the peak
    this.hue = (this.hue + dt * (0.01 + s.energy * 0.03 + s.peak * 0.05) + (s.dropHit ? 0.33 : 0)) % 1;
    const raid = this.t - this.raidT < 14 ? 1 : 0;
    this.rainbow += (raid - this.rainbow) * Math.min(1, dt * 2);
    const u = this.ledStrip.uniforms;
    u.uHue.value = this.hue;
    u.uRainbow.value = this.rainbow;
    u.uTime.value = this.t;
    const lv = (0.5 + 0.9 * s.master * (0.4 + s.hype * 0.8)) * (1 + s.kick * 0.5 * (s.reduceFlash ? 0.3 : 1));
    u.uLevel.value = lv;
    const c = new THREE.Color().setHSL(this.rainbow > 0.5 ? (this.t * 0.4) % 1 : this.hue, 1, 0.5);
    this.stripLight.color.copy(c);
    this.backLight.color.copy(c);
    this.stripLight.intensity = 1.6 * lv;
    this.backLight.intensity = 0.9 * lv;
  }
}

export const bedroom: VenueDef = {
  id: 'bedroom',
  name: 'Bedroom stream',
  short: 'Bedroom',
  place: 'Home',
  kind: 'Livestream',
  blurb: 'Posters, fairy lights and a stream. Where every DJ starts.',
  palette: ['#ff2e88', '#ffb547', '#3ad7ff'],
  ui: '#ff2e88',
  capacity: '3–50 viewers',
  build: () => new Bedroom(),
  thumb(g, w, h) {
    g.fillStyle = '#1b1d2e';
    g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, 0);
    ['#ff2e88', '#ffb547', '#b6ff3b', '#3ad7ff', '#7a3cff'].forEach((c, i) => grad.addColorStop(i / 4, c));
    g.fillStyle = grad;
    g.fillRect(0, 4, w, 4);
    g.fillStyle = '#ffcf8a';
    for (let i = 0; i < 16; i++) g.fillRect(w * (0.05 + i * 0.06), h * 0.2 + Math.abs(Math.sin(i * 0.8)) * 8, 3, 3);
    g.fillStyle = '#5a4636';
    g.fillRect(w * 0.3, h * 0.6, w * 0.4, h * 0.08);
  },
};
