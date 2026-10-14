/*
 * The robot DJ: helmets and cartoon robot heads that take the place of the
 * face, hair and eyewear (Avatar builds them on the head bone), and the
 * segmented metal hands' materials.
 *
 *   helmet_chrome  a chrome helmet with a black glass visor; behind the glass
 *                  an LED dot matrix plays the set: the DJ's name scrolling
 *                  while nothing plays, a bar meter on the kick, chevrons
 *                  racing out on the drop, a slow wave in the breakdown, happy
 *                  eyes when the room peaks. LED rings glow on the ear pods
 *   helmet_gold    a gold helmet with a full-face visor: rainbow bars across
 *                  it that dance with the music
 *   robot_smiley   a glossy red egg of a head with a painted face: round
 *                  yellow eyes that blink and squint, a wide grin that opens
 *                  with a vocal and shouts on the drop
 *   robot_box      a white box head: glowing red eyes that pulse on the kick,
 *                  a grille of teeth that chatters with a vocal, an antenna
 *                  with a ball that bobs as the head moves
 *
 * Each head follows the face the show asks for (Avatar's expression
 * channels), so a robot still reacts to the drop, the build and the breakdown.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** what the face is doing this frame, from Avatar's expression channels */
export interface RobotFace {
  jaw: number;
  smile: number;
  squint: number;
  stank: number;
  lost: number;
  grin: number;
  blink: boolean;
  kick: number;
  beat: number;
  playing: boolean;
}

export const robotFace = (): RobotFace => ({ jaw: 0, smile: 0, squint: 0, stank: 0, lost: 0, grin: 0, blink: false, kick: 0, beat: 0, playing: false });

/** what a robot head needs from the avatar building it */
export interface RobotKit {
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos?: THREE.Vector3): THREE.Mesh;
  keep<T extends { dispose(): void }>(x: T): T;
  /** something that swings as the head moves (an antenna) */
  spring(obj: THREE.Object3D, k: number): void;
}

export interface RobotHead {
  update(f: RobotFace, dt: number): void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cl = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ------------------------------------------------------------------ */
/* materials                                                            */
/* ------------------------------------------------------------------ */

/** polished metal that catches the room's lights without blowing out */
export function metalMat(color: THREE.ColorRepresentation, rough = 0.2): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, envMapIntensity: 0.6 });
  // a touch darker than the swatch, so a spotlight on the crown doesn't flare white
  m.color.multiplyScalar(0.82);
  return m;
}

/** glossy painted plastic */
function plasticMat(color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
}

/** soft black rubber: the neck, the joints between metal plates */
export function rubberMat(color: THREE.ColorRepresentation = 0x141518): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
}

/* ------------------------------------------------------------------ */
/* shapes                                                               */
/* ------------------------------------------------------------------ */

/** a sphere (or a patch of one) pushed into a shape: `form` maps each unit direction to a point */
function shaped(g: THREE.SphereGeometry, form: (d: THREE.Vector3, out: THREE.Vector3) => void, scale = 1): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  const o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    form(d, o);
    o.multiplyScalar(scale);
    p.setXYZ(i, o.x, o.y, o.z);
  }
  g.computeVertexNormals();
  return g;
}

/** a patch on the front of a shaped sphere: `half` either side of straight ahead, from `top` to `bottom` (0 crown, 1 under the chin) */
const frontPatch = (half: number, top: number, bottom: number, w = 48, h = 16) => new THREE.SphereGeometry(1, w, h, Math.PI / 2 - half, half * 2, Math.PI * top, Math.PI * (bottom - top));

/* ------------------------------------------------------------------ */
/* an LED dot matrix behind a visor                                     */
/* ------------------------------------------------------------------ */

type Lit = (x: number, y: number) => number;

class DotMatrix {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private cell = 10;
  private acc = 1;
  /** the DJ's name as dots, for scrolling */
  private text: Uint8Array;
  private textW: number;

  constructor(
    readonly cols: number,
    readonly rows: number,
    private color: (x: number) => string,
    name: string,
  ) {
    this.canvas.width = cols * this.cell;
    this.canvas.height = rows * this.cell;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    // the name, set once in a small bold face and read back as dots
    const msg = `${(name || 'DECKHOUSE').toUpperCase()}   `;
    const t = document.createElement('canvas');
    const tg = t.getContext('2d')!;
    const fontPx = Math.max(7, rows - 5);
    tg.font = `700 ${fontPx}px monospace`;
    this.textW = Math.max(cols, Math.ceil(tg.measureText(msg).width));
    t.width = this.textW;
    t.height = rows;
    tg.font = `700 ${fontPx}px monospace`;
    tg.fillStyle = '#fff';
    tg.textBaseline = 'middle';
    tg.fillText(msg, 0, rows / 2 + 1);
    const px = tg.getImageData(0, 0, this.textW, rows).data;
    this.text = new Uint8Array(this.textW * rows);
    for (let i = 0; i < this.text.length; i++) this.text[i] = px[i * 4 + 3] > 110 ? 1 : 0;
  }

  /** the name, scrolling right to left */
  scroll(t: number): Lit {
    const off = Math.floor(t * 9);
    return (x, y) => this.text[y * this.textW + ((((x + off) % this.textW) + this.textW) % this.textW)];
  }

  /** redraw (at most 30 times a second) */
  draw(lit: Lit, dt: number): void {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const { g, cell } = this;
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const rad = cell * 0.36;
    for (let x = 0; x < this.cols; x++) {
      g.fillStyle = this.color(x);
      for (let y = 0; y < this.rows; y++) {
        // unlit dots still show faintly, like a real panel
        g.globalAlpha = 0.07 + 0.93 * cl(lit(x, y), 0, 1);
        g.beginPath();
        g.arc(x * cell + cell / 2, y * cell + cell / 2, rad, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }
}

/**
 * What the LEDs show for the moment: the name between tracks, chevrons on the
 * drop, happy eyes at a peak, a wave in the breakdown, otherwise a bar meter
 * that jumps with the kick (and a vocal).
 */
function ledShow(m: DotMatrix, f: RobotFace, t: number, bars: Float32Array): Lit {
  const { cols, rows } = m;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  if (!f.playing) return m.scroll(t);
  if (f.stank > 0.4) {
    const ph = Math.floor(f.beat * 8);
    const flash = 0.55 + 0.45 * f.kick;
    return (x, y) => ((Math.abs(x - cx) + Math.abs(y - cy) * 0.9 - ph + 400) % 6 < 2 ? flash : 0);
  }
  if (f.grin > 0.5) {
    // two ^ eyes, a blink now and then
    const ex = cols * 0.25;
    return (x, y) => {
      if (f.blink) return Math.abs(y - cy) < 0.6 && Math.abs(Math.abs(x - cx) - ex) < 3.5 ? 1 : 0;
      const dx = Math.abs(Math.abs(x - cx) - ex);
      return dx <= 3.5 && Math.abs(y - (cy - 2 + dx)) < 0.75 ? 1 : 0;
    };
  }
  if (f.lost > 0.4) return (x, y) => Math.max(0, 1 - Math.abs(y - (cy + Math.sin(x * 0.32 + t * 2.4) * (rows * 0.3))) * 0.9);
  // the meter: bars rise from the bottom
  const n = bars.length;
  const step = Math.floor(f.beat * 4);
  for (let i = 0; i < n; i++) {
    const centre = 1 - Math.abs(i - (n - 1) / 2) / n;
    const want = cl(0.2 + 0.55 * hash01(step * 31 + i) * (0.4 + 0.6 * centre) + f.kick * 0.35 * centre + f.jaw * 0.3, 0, 1);
    bars[i] = want > bars[i] ? want : bars[i] * 0.86;
  }
  const w = cols / n;
  return (x, y) => {
    const h = bars[Math.min(n - 1, Math.floor(x / w))] * rows;
    const fromBottom = rows - y;
    if (x % w > w - 1) return 0;
    return fromBottom <= h ? 0.55 + 0.45 * (fromBottom / rows) : 0;
  };
}

/* ------------------------------------------------------------------ */
/* the heads                                                            */
/* ------------------------------------------------------------------ */

export function buildRobotHead(id: string, kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string], name: string): RobotHead | null {
  switch (id) {
    case 'helmet_chrome':
      return chromeHelmet(kit, headBone, r, zones, name);
    case 'helmet_gold':
      return goldHelmet(kit, headBone, r, zones, name);
    case 'robot_smiley':
      return smileyHead(kit, headBone, r, zones);
    case 'robot_box':
      return boxHead(kit, headBone, r, zones);
    default:
      return null;
  }
}

/** a ring of rubber round the bottom of a helmet, where it meets the neck */
function seal(kit: RobotKit, parent: THREE.Object3D, rx: number, rz: number, y: number, tube: number): void {
  const ring = kit.mesh(new THREE.TorusGeometry(1, tube, 8, 40), kit.keep(rubberMat()), parent, V(0, y, 0));
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(rx, rz, 1);
}

function chromeHelmet(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string], name: string): RobotHead {
  const grp = new THREE.Group();
  grp.position.set(0, r * 1.0, 0.004);
  headBone.add(grp);
  const RX = r * 1.12;
  const RY = r * 1.3;
  const RZ = r * 1.2;
  // rounded, with a flatter face where the visor sits
  const form = (d: THREE.Vector3, o: THREE.Vector3) => {
    const z = d.z > 0.5 ? 0.5 + (d.z - 0.5) * 0.55 : d.z;
    o.set(d.x * RX, d.y * RY, z * RZ);
  };
  const shell = kit.keep(metalMat(zones[0]));
  kit.mesh(shaped(new THREE.SphereGeometry(1, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.8), form), shell, grp);
  seal(kit, grp, RX * 0.6, RZ * 0.56, -RY * 0.8, r * 0.06);

  // the visor: black glass with the LED panel behind it
  const led = new DotMatrix(40, 15, () => zones[2], name);
  kit.keep(led.tex);
  const glass = kit.keep(new THREE.MeshPhysicalMaterial({ color: zones[1], roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xffffff, emissiveMap: led.tex, emissiveIntensity: 1.5 }));
  kit.mesh(shaped(frontPatch(0.95, 0.38, 0.6), form, 1.008), glass, grp);
  // a thin chrome lip round the visor
  const lip = kit.keep(metalMat(zones[0], 0.1));
  for (const th of [0.375, 0.605]) {
    const pts = Array.from({ length: 25 }, (_, i) => {
      const phi = Math.PI / 2 - 0.97 + (i / 24) * 1.94;
      const sin = Math.sin(Math.PI * th);
      const o = new THREE.Vector3();
      form(new THREE.Vector3(-Math.cos(phi) * sin, Math.cos(Math.PI * th), Math.sin(phi) * sin), o);
      return o.multiplyScalar(1.014);
    });
    kit.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r * 0.022, 6, false), lip, grp);
  }

  // ear pods with an LED ring that pulses on the kick
  const ringMat = kit.keep(new THREE.MeshStandardMaterial({ color: zones[2], emissive: zones[2], emissiveIntensity: 0.6, roughness: 0.4 }));
  for (const s of [-1, 1]) {
    const pod = kit.mesh(new THREE.CylinderGeometry(r * 0.36, r * 0.4, r * 0.14, 32).rotateZ(Math.PI / 2), shell, grp, V(s * RX * 0.97, -r * 0.05, -r * 0.08));
    void pod;
    const ring = kit.mesh(new THREE.TorusGeometry(r * 0.25, r * 0.03, 8, 32).rotateY(Math.PI / 2), ringMat, grp, V(s * (RX * 0.97 + r * 0.075), -r * 0.05, -r * 0.08));
    void ring;
  }

  const bars = new Float32Array(10);
  let t = 0;
  return {
    update(f, dt) {
      t += dt;
      led.draw(ledShow(led, f, t, bars), dt);
      ringMat.emissiveIntensity = 0.5 + (f.playing ? f.kick * 2.2 : 0.4 + 0.3 * Math.sin(t * 2));
    },
  };
}

function goldHelmet(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string], name: string): RobotHead {
  const grp = new THREE.Group();
  grp.position.set(0, r * 1.0, 0.004);
  headBone.add(grp);
  const RX = r * 1.1;
  const RY = r * 1.28;
  const RZ = r * 1.2;
  const form = (d: THREE.Vector3, o: THREE.Vector3) => o.set(d.x * RX, d.y * RY, d.z * RZ);
  const shell = kit.keep(metalMat(zones[0], 0.24));
  kit.mesh(shaped(new THREE.SphereGeometry(1, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.8), form), shell, grp);
  seal(kit, grp, RX * 0.6, RZ * 0.6, -RY * 0.8, r * 0.06);

  // a big visor down the face, rainbow bars lighting behind it
  const led = new DotMatrix(26, 22, (x) => `hsl(${Math.round((x / 26) * 300)}, 100%, 58%)`, name);
  kit.keep(led.tex);
  const glass = kit.keep(new THREE.MeshPhysicalMaterial({ color: zones[1], roughness: 0.04, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xffffff, emissiveMap: led.tex, emissiveIntensity: 1.3 }));
  kit.mesh(shaped(frontPatch(0.98, 0.24, 0.7), form, 1.008), glass, grp);
  // a crest down the middle, front to back
  const crest = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => {
    // from the back of the head over the crown to the top of the visor
    const a = -1.3 + (i / 12) * 1.85;
    return new THREE.Vector3(0, Math.cos(a) * RY * 1.01, Math.sin(a) * RZ * 1.01);
  }));
  kit.mesh(new THREE.TubeGeometry(crest, 48, r * 0.045, 8, false), shell, grp);
  // vents on the sides
  const vent = kit.keep(rubberMat(zones[2]));
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const v = kit.mesh(new THREE.CapsuleGeometry(r * 0.035, r * 0.3, 4, 8).rotateX(Math.PI / 2), vent, grp, V(s * RX * 0.985, -r * 0.05 + (k - 1) * r * 0.13, -r * 0.2));
    v.scale.x = 0.6;
  }

  const bars = new Float32Array(13);
  let t = 0;
  return {
    update(f, dt) {
      t += dt;
      // between tracks the colours drift slowly across the glass
      const lit: Lit = f.playing ? ledShow(led, f, t, bars) : (x, y) => 0.35 + 0.35 * Math.sin(x * 0.5 - t * 2 + y * 0.15);
      led.draw(lit, dt);
    },
  };
}

function smileyHead(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string]): RobotHead {
  const grp = new THREE.Group();
  grp.position.set(0, r * 1.25, 0.01);
  headBone.add(grp);
  const RX = r * 1.12;
  const RY = r * 1.55;
  const RZ = r * 1.04;
  // an egg: full at the crown, narrower at the chin
  const form = (d: THREE.Vector3, o: THREE.Vector3) => {
    const k = 1 - 0.2 * Math.max(0, -d.y) + 0.04 * Math.max(0, d.y);
    o.set(d.x * RX * k, d.y * RY, d.z * RZ * k);
  };
  kit.mesh(shaped(new THREE.SphereGeometry(1, 56, 40), form), kit.keep(plasticMat(zones[0])), grp);
  // a little rubber neck joint under the chin
  seal(kit, grp, r * 0.3, r * 0.3, -RY * 0.98, r * 0.07);

  // the painted face, redrawn when the expression changes
  const W = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = W;
  const g = canvas.getContext('2d')!;
  const tex = kit.keep(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const decal = kit.keep(new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }));
  const HALF = 0.95;
  const TOP = 0.18;
  const BOT = 0.8;
  kit.mesh(shaped(frontPatch(HALF, TOP, BOT, 48, 32), form, 1.004), decal, grp);
  // a canvas pixel is wider than it is tall on the egg: draw circles wider to keep them round
  const A = (Math.PI * (BOT - TOP) * RY) / (HALF * 2 * RX * 1.02);
  let last = '';
  const draw = (f: RobotFace) => {
    const happy = f.grin > 0.5 || f.smile > 0.5;
    const shout = f.stank > 0.4;
    const open = cl(Math.max(f.jaw, shout ? 0.9 : 0), 0, 1);
    const sq = f.blink ? 1 : cl(f.squint * 0.8 + (shout ? 0.5 : 0), 0, 0.85);
    const key = `${happy}|${shout}|${Math.round(open * 6)}|${Math.round(sq * 5)}`;
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, W, W);
    const ink = zones[2];
    // eyes: big yellow discs ringed in black (or happy arcs at a peak)
    for (const s of [-1, 1]) {
      const ex = W / 2 + s * W * 0.17;
      const ey = W * 0.36;
      const R = W * 0.075;
      g.lineWidth = W * 0.016;
      g.strokeStyle = ink;
      if (happy && !f.blink) {
        g.lineWidth = W * 0.03;
        g.lineCap = 'round';
        g.beginPath();
        g.ellipse(ex, ey + R * 0.3, R * A, R * 0.9, 0, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
        continue;
      }
      g.fillStyle = zones[1];
      g.beginPath();
      g.ellipse(ex, ey, R * A, R * (1 - sq), 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (sq > 0.95) {
        g.beginPath();
        g.moveTo(ex - R * A, ey);
        g.lineTo(ex + R * A, ey);
        g.lineWidth = W * 0.02;
        g.stroke();
      }
    }
    // the grin: a wide crescent that opens with the jaw, the tongue inside
    const my = W * 0.6;
    const mw = W * 0.2 * (shout ? 0.8 : 1);
    const depth = W * (0.07 + open * 0.09);
    g.beginPath();
    g.moveTo(W / 2 - mw, my - W * 0.02);
    g.quadraticCurveTo(W / 2, my + W * 0.02 - open * W * 0.05, W / 2 + mw, my - W * 0.02);
    g.quadraticCurveTo(W / 2, my + depth * 2, W / 2 - mw, my - W * 0.02);
    g.closePath();
    g.fillStyle = ink;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#ff5a6e';
    g.beginPath();
    g.ellipse(W / 2, my + depth * 1.05, mw * 0.5, depth * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    tex.needsUpdate = true;
  };
  draw(robotFace());
  return { update: (f) => draw(f) };
}

function boxHead(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string]): RobotHead {
  const grp = new THREE.Group();
  grp.position.set(0, r * 1.1, 0.01);
  headBone.add(grp);
  const W = r * 2.3;
  const H = r * 1.9;
  const D = r * 1.95;
  const body = kit.keep(plasticMat(zones[0]));
  kit.mesh(kit.keep(new RoundedBoxGeometry(W, H, D, 4, r * 0.22)), body, grp);
  seal(kit, grp, r * 0.42, r * 0.42, -H / 2 - r * 0.02, r * 0.07);
  const dark = kit.keep(rubberMat(zones[2]));
  const front = D / 2;

  // eyes: glowing red domes in dark sockets
  const eyeMat = kit.keep(new THREE.MeshPhysicalMaterial({ color: zones[1], emissive: zones[1], emissiveIntensity: 0.5, roughness: 0.15, clearcoat: 1 }));
  const eyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const at = V(s * W * 0.22, r * 0.2, front);
    kit.mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, r * 0.06, 32).rotateX(Math.PI / 2), dark, grp, at);
    const eye = new THREE.Object3D();
    eye.position.copy(at).add(V(0, 0, r * 0.03));
    grp.add(eye);
    const dome = kit.mesh(new THREE.SphereGeometry(r * 0.31, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), eyeMat, eye);
    dome.scale.z = 0.4;
    eyes.push(eye);
  }

  // the mouth: a dark grille with two rows of teeth, the bottom row on a jaw
  const mouthY = -r * 0.48;
  kit.mesh(new THREE.BoxGeometry(W * 0.5, r * 0.42, r * 0.04), dark, grp, V(0, mouthY, front));
  const toothMat = kit.keep(plasticMat(0xf4f4f2));
  const jaw = new THREE.Group();
  jaw.position.set(0, mouthY, front + r * 0.025);
  grp.add(jaw);
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * W * 0.078;
    kit.mesh(new THREE.BoxGeometry(W * 0.06, r * 0.15, r * 0.035), toothMat, grp, V(x, mouthY + r * 0.09, front + r * 0.025));
    kit.mesh(new THREE.BoxGeometry(W * 0.06, r * 0.15, r * 0.035), toothMat, jaw, V(x, -r * 0.09, 0));
  }

  // the antenna: a stalk and a red ball, bobbing on a spring
  const antenna = new THREE.Object3D();
  antenna.position.set(0, H / 2, 0);
  grp.add(antenna);
  kit.mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.16, r * 0.06, 20), dark, antenna, V(0, r * 0.02, 0));
  kit.mesh(new THREE.CylinderGeometry(r * 0.035, r * 0.035, r * 0.6, 8).translate(0, r * 0.3, 0), kit.keep(metalMat(0xc9ced6, 0.25)), antenna);
  const ballMat = kit.keep(new THREE.MeshPhysicalMaterial({ color: zones[1], emissive: zones[1], emissiveIntensity: 0.25, roughness: 0.2, clearcoat: 1 }));
  kit.mesh(new THREE.SphereGeometry(r * 0.17, 20, 14), ballMat, antenna, V(0, r * 0.68, 0));
  kit.spring(antenna, 1.6);
  // bolts for ears
  const bolt = kit.keep(metalMat(0xb8bec8, 0.3));
  for (const s of [-1, 1]) kit.mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, r * 0.1, 6).rotateZ(Math.PI / 2), bolt, grp, V(s * (W / 2 + r * 0.04), 0, 0));

  let t = 0;
  return {
    update(f, dt) {
      t += dt;
      const shout = f.stank > 0.4;
      // the eyes narrow in a squint, shut for a blink, flare on the drop
      const sq = f.blink ? 0.12 : 1 - cl(f.squint * 0.6, 0, 0.6);
      for (const e of eyes) e.scale.y += (sq - e.scale.y) * Math.min(1, dt * 25);
      const glow = f.playing ? 0.4 + f.kick * 1.6 + (shout ? 1.2 : 0) : 0.45 + 0.15 * Math.sin(t * 1.5);
      eyeMat.emissiveIntensity = glow;
      ballMat.emissiveIntensity = 0.2 + (f.playing ? f.kick * 0.9 : 0);
      jaw.position.y = mouthY - cl(Math.max(f.jaw, shout ? 0.7 : 0), 0, 1) * r * 0.1;
    },
  };
}
