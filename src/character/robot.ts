/*
 * The robot DJ: helmets and cartoon robot heads that take the place of the
 * face, hair and eyewear (Avatar builds them on the head bone), their necks,
 * and the robot hands' materials.
 *
 *   helmet_chrome  a pearly silver helmet: a goggle band stands proud of the
 *                  shell round a recessed black visor split down the middle;
 *                  behind the glass a red LED dot matrix (a 5×7 font) scrolls
 *                  the DJ's name, and with the music turns to a bar meter on
 *                  the kick, chevrons on the drop, a wave in the breakdown and
 *                  happy eyes when the room peaks. A slot of a mouth on the
 *                  chin, pods over the ears
 *   helmet_gold    a gold helmet, the face a U of black glass framed in a
 *                  thick gold rim, rainbow bars stacked down both sides of the
 *                  visor that chase and flash with the music, raised gold
 *                  panels over the ears
 *   robot_smiley   a tall red bullet of a head, cel-shaded and outlined in
 *                  black like a cartoon: big yellow eyes that blink and squint,
 *                  an open grin with a tongue that opens with a vocal
 *   robot_box      a pale grey box, cel-shaded and outlined: round red eyes
 *                  that glow on the kick, buck teeth that chatter, an antenna
 *                  on a thin wire with a red ball that bobs as the head moves
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

/** the cartoon heads (cel-shaded, on a grey metal neck); the rest are helmets (on black rubber) */
export const CARTOON_HEADS = new Set(['robot_smiley', 'robot_box']);

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cl = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const sm01 = (a: number, b: number, x: number) => {
  const t = cl((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash01 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ------------------------------------------------------------------ */
/* materials                                                            */
/* ------------------------------------------------------------------ */

/** polished metal (gold, steel) that catches the room's lights without blowing out */
export function metalMat(color: THREE.ColorRepresentation, rough = 0.2): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, envMapIntensity: 0.6 });
  // a touch darker than the swatch, so a spotlight on the crown doesn't flare white
  m.color.multiplyScalar(0.82);
  return m;
}

/** pearly silver: white-bright like the reference helmet and hands, lacquered, not a mirror */
export function pearlMat(color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.7 });
  m.color.multiplyScalar(0.86);
  return m;
}

/** soft black rubber: the neck, the joints between metal plates */
export function rubberMat(color: THREE.ColorRepresentation = 0x141518): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
}

/** three flat tones of light, for the cartoon heads */
function toonRamp(kit: RobotKit): THREE.DataTexture {
  const t = kit.keep(new THREE.DataTexture(new Uint8Array([135, 135, 135, 255, 205, 205, 205, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat));
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** a black outline round a cartoon part: its own shape a little bigger, inside out */
function outline(kit: RobotKit, geo: THREE.BufferGeometry, parent: THREE.Object3D, grow: number, pos?: THREE.Vector3, ink?: THREE.Material): THREE.Mesh {
  const m = kit.mesh(geo, ink ?? kit.keep(new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide })), parent, pos);
  m.scale.setScalar(grow);
  m.castShadow = false;
  return m;
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

/**
 * A patch on the front of a shaped sphere, from `a0` to `a1` round from
 * straight ahead (positive towards the avatar's left) and from `t0` to `t1`
 * down from the crown (0 crown, 1 under the chin). Its u runs left to right
 * as you look at the face, its v bottom to top.
 */
const patch = (a0: number, a1: number, t0: number, t1: number, w = 48, h = 16) => new THREE.SphereGeometry(1, w, h, Math.PI / 2 + a0, a1 - a0, Math.PI * t0, Math.PI * (t1 - t0));

/** the unit direction at (a, t) in the patch's terms */
const dirAt = (a: number, t: number) => V(Math.sin(a) * Math.sin(Math.PI * t), Math.cos(Math.PI * t), Math.cos(a) * Math.sin(Math.PI * t));

/** a loop through (a, t) points, on the shape at `scale` */
function loopOn(form: (d: THREE.Vector3, out: THREE.Vector3) => void, pts: [number, number][], scale: number, closed = true): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    pts.map(([a, t]) => {
      const o = new THREE.Vector3();
      form(dirAt(a, t), o);
      return o.multiplyScalar(scale);
    }),
    closed,
  );
}

/** the edge of an (a, t) rectangle, as points */
function rectPts(a0: number, a1: number, t0: number, t1: number, n = 16): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([a0 + ((a1 - a0) * i) / n, t0]);
  for (let i = 0; i < 4; i++) out.push([a1, t0 + ((t1 - t0) * i) / 4]);
  for (let i = 0; i < n; i++) out.push([a1 - ((a1 - a0) * i) / n, t1]);
  for (let i = 0; i < 4; i++) out.push([a0, t1 - ((t1 - t0) * i) / 4]);
  return out;
}

/** a smooth curve through (h, value) points, h from 0 to 1 (Catmull-Rom, flat at the ends) */
function curve(pts: [number, number][]): (h: number) => number {
  return (h) => {
    if (h <= pts[0][0]) return pts[0][1];
    const last = pts.length - 1;
    if (h >= pts[last][0]) return pts[last][1];
    let i = 0;
    while (pts[i + 1][0] < h) i++;
    const [h1, p1] = pts[i];
    const [h2, p2] = pts[i + 1];
    const p0 = pts[Math.max(0, i - 1)][1];
    const p3 = pts[Math.min(last, i + 2)][1];
    const u = (h - h1) / (h2 - h1);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
}

type Form = (d: THREE.Vector3, o: THREE.Vector3) => void;

/**
 * A head drawn from its outlines, the way a modeller blocks one in from
 * reference pictures: from the front its half-width `w`, from the side how
 * far the face (`front`) and the back of the head (`back`) reach, each at a
 * height h from the crown (0) to the bottom (1); round each height a
 * superellipse, squarer the higher `n`. A direction on a sphere maps to
 * (h, round), so the sphere-patch helpers above still place things on it:
 * a sphere's polar angle from 0 to `end`·π runs h from 0 to 1.
 */
function outlineForm(o: { top: number; height: number; end?: number; w: (h: number) => number; front: (h: number) => number; back: (h: number) => number; n: (h: number) => number }): Form {
  const end = o.end ?? 1;
  return (d, out) => {
    const t = Math.acos(cl(d.y, -1, 1)) / Math.PI;
    const h = cl(t / end, 0, 1);
    const a = Math.atan2(d.x, d.z);
    const e = 2 / o.n(h);
    const sx = Math.sin(a);
    const cz = Math.cos(a);
    const x = Math.sign(sx) * Math.pow(Math.abs(sx), e) * o.w(h);
    const z = Math.sign(cz) * Math.pow(Math.abs(cz), e) * (cz > 0 ? o.front(h) : o.back(h));
    out.set(x, o.top - h * o.height, z);
  };
}

/* ------------------------------------------------------------------ */
/* an LED dot matrix behind a visor                                     */
/* ------------------------------------------------------------------ */

/** a 5×7 font for the LED panel: each glyph seven rows of five dots */
const FONT: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  "'": '00100 00100 01000 00000 00000 00000 00000',
  '&': '01100 10010 10100 01000 10101 10010 01101',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

type Lit = (x: number, y: number) => number;

class DotMatrix {
  readonly canvas = document.createElement('canvas');
  readonly tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private cell = 16;
  private acc = 1;
  /** the DJ's name in the dot font, for scrolling */
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
    const msg = `${(name || 'DECKHOUSE').toUpperCase()}   `;
    this.textW = Math.max(cols, msg.length * 6);
    this.text = new Uint8Array(this.textW * rows);
    const top = Math.floor((rows - 7) / 2);
    [...msg].forEach((ch, i) => {
      const rowsOf = (FONT[ch] ?? FONT[' ']).split(' ');
      rowsOf.forEach((bits, y) => {
        for (let x = 0; x < 5; x++) if (bits[x] === '1' && y + top < rows) this.text[(y + top) * this.textW + i * 6 + x] = 1;
      });
    });
  }

  /** the name, scrolling right to left */
  scroll(t: number): Lit {
    const off = Math.floor(t * 8);
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
    const rad = cell * 0.38;
    for (let x = 0; x < this.cols; x++) {
      g.fillStyle = this.color(x);
      for (let y = 0; y < this.rows; y++) {
        // unlit dots still show faintly, like a real panel
        g.globalAlpha = 0.08 + 0.92 * cl(lit(x, y), 0, 1);
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
 * What the LEDs show for the moment: the name between tracks (and every
 * other 16 beats while playing), chevrons on the drop, happy eyes at a peak,
 * a wave in the breakdown, otherwise a bar meter that jumps with the kick.
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
  if (f.lost > 0.4) return (x, y) => Math.max(0, 1 - Math.abs(y - (cy + Math.sin(x * 0.4 + t * 2.4) * (rows * 0.32))) * 0.9);
  if (Math.floor(f.beat / 16) % 2 === 0) return m.scroll(t);
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
      return silverHelmet(kit, headBone, r, zones, name);
    case 'helmet_gold':
      return goldHelmet(kit, headBone, r, zones);
    case 'robot_smiley':
      return smileyHead(kit, headBone, r, zones);
    case 'robot_box':
      return boxHead(kit, headBone, r, zones);
    default:
      return null;
  }
}

/**
 * The neck under a robot head: black rubber in rings up into a helmet, or a
 * stack of grey metal segments under a cartoon head.
 */
export function buildRobotNeck(id: string, kit: RobotKit, neckBone: THREE.Object3D, H: number): void {
  if (CARTOON_HEADS.has(id)) {
    const steel = kit.keep(metalMat(0x9aa0aa, 0.35));
    const gap = kit.keep(rubberMat(0x1b1c20));
    kit.mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.16 * H, 12).translate(0, 0.06, 0), gap, neckBone);
    for (let i = 0; i < 4; i++) kit.mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.022 * H, 18), steel, neckBone, V(0, -0.005 + i * 0.033 * H, 0));
    return;
  }
  const rubber = kit.keep(rubberMat());
  kit.mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.13 * H, 20).translate(0, 0.05, 0), rubber, neckBone);
  for (let i = 0; i < 4; i++) {
    const rib = kit.mesh(new THREE.TorusGeometry(0.046 - i * 0.0015, 0.0045, 6, 24), rubber, neckBone, V(0, 0.005 + i * 0.026 * H, 0));
    rib.rotation.x = Math.PI / 2;
  }
}

/** a ring of rubber round the bottom of a helmet, where it meets the neck */
function seal(kit: RobotKit, parent: THREE.Object3D, rx: number, rz: number, y: number, tube: number): void {
  const ring = kit.mesh(new THREE.TorusGeometry(1, tube, 8, 40), kit.keep(rubberMat()), parent, V(0, y, 0));
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(rx, rz, 1);
}

function silverHelmet(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string], name: string): RobotHead {
  // from the pictures: a tall helmet (about 1.3 times as tall as it's wide), a
  // high round dome, a goggle band across the upper face standing well proud
  // of the shell, under it a long flat faceplate narrowing to a squarish chin
  const grp = new THREE.Group();
  const HT = r * 2.6;
  const bottom = -r * 0.2;
  grp.position.set(0, bottom + HT / 2, 0.004);
  headBone.add(grp);
  const END = 0.93;
  const form = outlineForm({
    top: HT / 2,
    height: HT,
    end: END,
    w: curve([[0, 0], [0.03, 0.6 * r], [0.08, 0.88 * r], [0.15, 1.02 * r], [0.25, 1.1 * r], [0.38, 1.13 * r], [0.5, 1.1 * r], [0.6, 1.02 * r], [0.7, 0.92 * r], [0.8, 0.83 * r], [0.9, 0.76 * r], [1, 0.7 * r]]),
    front: curve([[0, 0], [0.03, 0.55 * r], [0.08, 0.85 * r], [0.16, 1.04 * r], [0.28, 1.15 * r], [0.42, 1.2 * r], [0.58, 1.18 * r], [0.72, 1.13 * r], [0.86, 1.05 * r], [1, 0.94 * r]]),
    back: curve([[0, 0], [0.03, 0.62 * r], [0.08, 0.92 * r], [0.18, 1.1 * r], [0.33, 1.17 * r], [0.52, 1.12 * r], [0.72, 0.94 * r], [0.88, 0.78 * r], [1, 0.68 * r]]),
    // round over the dome, the faceplate under the visor flat with rounded corners
    n: (h) => 2.1 + 1.3 * sm01(0.45, 0.7, h),
  });
  const T = (h: number) => h * END;
  const shell = kit.keep(pearlMat(zones[0]));
  kit.mesh(shaped(new THREE.SphereGeometry(1, 72, 56, 0, Math.PI * 2, 0, Math.PI * END), form), shell, grp);
  const rim = new THREE.Vector3();
  form(dirAt(Math.PI / 2, END), rim);
  seal(kit, grp, Math.abs(rim.x) * 0.98, 0.8 * r * 0.98, -HT / 2, r * 0.06);

  // the goggle band: a frame standing proud of the shell, the visor glass recessed in it
  const F0 = [-1.4, 1.4, T(0.27), T(0.6)] as const;
  const G0 = [-1.18, 1.18, T(0.31), T(0.56)] as const;
  const FRAME = 1.1;
  for (const [a0, a1, t0, t1] of [
    [F0[0], F0[1], F0[2], G0[2]],
    [F0[0], F0[1], G0[3], F0[3]],
    [F0[0], G0[0], G0[2], G0[3]],
    [G0[1], F0[1], G0[2], G0[3]],
  ]) kit.mesh(shaped(patch(a0, a1, t0, t1, 40, 6), form, FRAME), shell, grp);
  // its edges, rounded down to the shell outside and into the glass inside
  kit.mesh(new THREE.TubeGeometry(loopOn(form, rectPts(...F0), 1.045), 120, r * 0.056, 8, true), shell, grp);
  kit.mesh(new THREE.TubeGeometry(loopOn(form, rectPts(...G0), 1.08), 120, r * 0.018, 6, true), shell, grp);

  // the visor: black glass, the LED panel behind it, split down the middle
  const led = new DotMatrix(32, 9, () => zones[2], name);
  kit.keep(led.tex);
  const glass = kit.keep(new THREE.MeshPhysicalMaterial({ color: zones[1], roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xffffff, emissiveMap: led.tex, emissiveIntensity: 1.6 }));
  kit.mesh(shaped(patch(...G0, 48, 12), form, 1.068), glass, grp);
  kit.mesh(new THREE.TubeGeometry(loopOn(form, [[0.02, G0[2]], [0.02, (G0[2] + G0[3]) / 2], [0.02, G0[3]]], 1.072, false), 8, r * 0.012, 6, false), shell, grp);

  // a slot of a mouth low on the faceplate
  const mouth = new THREE.Vector3();
  form(dirAt(0, T(0.82)), mouth);
  const slot = kit.mesh(new THREE.CapsuleGeometry(r * 0.022, r * 0.3, 4, 8).rotateZ(Math.PI / 2), kit.keep(rubberMat(0x060607)), grp, mouth);
  slot.scale.z = 0.5;

  const bars = new Float32Array(8);
  let t = 0;
  return {
    update(f, dt) {
      t += dt;
      led.draw(ledShow(led, f, t, bars), dt);
    },
  };
}

function goldHelmet(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string]): RobotHead {
  // from the pictures: an egg, a little taller than the silver helmet is
  // wide, rounder; the face a U of black glass from the brow to under the chin
  const grp = new THREE.Group();
  const HT = r * 2.8;
  const bottom = -r * 0.2;
  grp.position.set(0, bottom + HT / 2, 0.004);
  headBone.add(grp);
  const END = 0.93;
  const form = outlineForm({
    top: HT / 2,
    height: HT,
    end: END,
    w: curve([[0, 0], [0.05, 0.6 * r], [0.12, 0.86 * r], [0.22, 1.02 * r], [0.36, 1.1 * r], [0.5, 1.1 * r], [0.65, 1.04 * r], [0.78, 0.94 * r], [0.9, 0.82 * r], [1, 0.72 * r]]),
    front: curve([[0, 0], [0.05, 0.62 * r], [0.12, 0.92 * r], [0.22, 1.1 * r], [0.36, 1.2 * r], [0.5, 1.22 * r], [0.65, 1.18 * r], [0.78, 1.1 * r], [0.9, 0.98 * r], [1, 0.86 * r]]),
    back: curve([[0, 0], [0.05, 0.66 * r], [0.12, 0.94 * r], [0.22, 1.1 * r], [0.36, 1.16 * r], [0.5, 1.14 * r], [0.65, 1.06 * r], [0.8, 0.92 * r], [0.9, 0.8 * r], [1, 0.7 * r]]),
    n: () => 2.05,
  });
  const T = (h: number) => h * END;
  const shell = kit.keep(metalMat(zones[0], 0.24));
  kit.mesh(shaped(new THREE.SphereGeometry(1, 72, 56, 0, Math.PI * 2, 0, Math.PI * END), form), shell, grp);
  seal(kit, grp, 0.7 * r, 0.76 * r, -HT / 2, r * 0.06);

  // the visor: a U of black glass down the face (u left to right, v bottom to top)
  const A0 = -1.3;
  const A1 = 1.3;
  const T0 = T(0.07);
  const T1 = T(0.98);
  const U: [number, number][] = [];
  for (let i = 0; i <= 10; i++) U.push([0.1 + 0.8 * (i / 10), 0.97 - 0.02 * Math.sin((i / 10) * Math.PI)]);
  for (let i = 1; i <= 6; i++) U.push([0.9, 0.97 - (0.47 * i) / 6]);
  for (let i = 1; i < 16; i++) {
    const a = (i / 16) * Math.PI;
    U.push([0.5 + 0.4 * Math.cos(a), 0.5 - 0.46 * Math.sin(a)]);
  }
  for (let i = 0; i < 6; i++) U.push([0.1, 0.5 + (0.47 * i) / 6]);
  const S = 512;
  const mask = document.createElement('canvas');
  mask.width = mask.height = S;
  const mg = mask.getContext('2d')!;
  mg.fillStyle = '#000';
  mg.fillRect(0, 0, S, S);
  mg.fillStyle = '#fff';
  mg.beginPath();
  U.forEach(([u, v], i) => (i ? mg.lineTo(u * S, (1 - v) * S) : mg.moveTo(u * S, (1 - v) * S)));
  mg.closePath();
  mg.fill();
  const maskTex = kit.keep(new THREE.CanvasTexture(mask));
  // the rainbow, stacked down both sides inside the rim
  const led = document.createElement('canvas');
  led.width = led.height = S;
  const lg = led.getContext('2d')!;
  const ledTex = kit.keep(new THREE.CanvasTexture(led));
  ledTex.colorSpace = THREE.SRGBColorSpace;
  const HUES = [225, 195, 172, 140, 95, 58, 35, 12, 0];
  const glass = kit.keep(new THREE.MeshPhysicalMaterial({ color: zones[1], roughness: 0.04, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02, alphaMap: maskTex, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: ledTex, emissiveIntensity: 1.4 }));
  kit.mesh(shaped(patch(A0, A1, T0, T1, 64, 40), form, 1.006), glass, grp);
  // the thick gold rim round the U: a broad flat band standing off the shell, rounded at both edges
  const at = (u: number, v: number) => [A0 + (A1 - A0) * u, T0 + (T1 - T0) * (1 - v)] as [number, number];
  const rim = U.map(([u, v]) => at(u, v));
  const BAND = 1.3;
  const outer = U.map(([u, v]) => at(0.5 + (u - 0.5) * BAND, 0.5 + (v - 0.5) * BAND));
  // standing well proud of the glass and the shell, like a frame round the face
  const inner = loopOn(form, rim, 1.05).getSpacedPoints(160);
  const outerPts = loopOn(form, outer, 1.04).getSpacedPoints(160);
  const band = new THREE.BufferGeometry().setFromPoints(inner.flatMap((p, i) => [p, outerPts[i]]));
  const idx: number[] = [];
  for (let i = 0; i < 160; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  band.setIndex(idx);
  band.computeVertexNormals();
  const bandMat = kit.keep(shell.clone());
  bandMat.side = THREE.DoubleSide;
  kit.mesh(band, bandMat, grp);
  kit.mesh(new THREE.TubeGeometry(loopOn(form, rim, 1.03), 160, r * 0.06, 10, true), shell, grp);
  kit.mesh(new THREE.TubeGeometry(loopOn(form, outer, 1.02), 160, r * 0.045, 8, true), shell, grp);
  // raised gold blocks over the ears, just behind the rim, a round black port in each
  const port = kit.keep(rubberMat(zones[2]));
  for (const s of [-1, 1]) {
    const at = new THREE.Vector3();
    form(dirAt(s * 1.62, T(0.46)), at);
    const block = kit.mesh(kit.keep(new RoundedBoxGeometry(r * 0.2, r * 0.95, r * 0.55, 3, r * 0.07)), shell, grp, at.clone().add(V(-s * r * 0.04, 0, 0)));
    block.rotation.y = s * 0.1;
    kit.mesh(new THREE.CylinderGeometry(r * 0.13, r * 0.13, r * 0.04, 28).rotateZ(Math.PI / 2), port, grp, at.clone().add(V(s * r * 0.075, r * 0.06, r * 0.02)));
  }

  let t = 0;
  let acc = 1;
  return {
    update(f, dt) {
      t += dt;
      acc += dt;
      if (acc < 1 / 30) return;
      acc = 0;
      lg.fillStyle = '#000';
      lg.fillRect(0, 0, S, S);
      const n = HUES.length;
      const step = f.beat * 2;
      for (let i = 0; i < n; i++) {
        // idle: a slow shimmer; playing: a light chasing down the stack, all of it flaring on the kick and the drop
        const chase = f.playing ? 0.45 + 0.55 * Math.max(0, Math.cos((i / n - (step % 1)) * Math.PI * 2)) : 0.7 + 0.3 * Math.sin(t * 1.6 - i * 0.6);
        const k = cl(chase + (f.playing ? f.kick * 0.4 : 0) + (f.stank > 0.4 ? 0.6 : 0), 0, 1);
        lg.fillStyle = `hsl(${HUES[i]}, 100%, ${20 + 40 * k}%)`;
        const v0 = 0.84 - i * 0.052;
        for (const side of [-1, 1]) {
          // each bar a slanted slab hugging the rim: straight down its sides, then in round the curve of the U
          const inset = 0.1 + Math.max(0, 0.55 - v0) * 0.55;
          const x0 = side < 0 ? inset : 1 - inset - 0.13;
          lg.beginPath();
          lg.moveTo(x0 * S, (1 - v0) * S);
          lg.lineTo((x0 + 0.13) * S, (1 - v0 - side * 0.018) * S);
          lg.lineTo((x0 + 0.13) * S, (1 - v0 + 0.048 - side * 0.018) * S);
          lg.lineTo(x0 * S, (1 - v0 + 0.048) * S);
          lg.closePath();
          lg.fill();
        }
      }
      ledTex.needsUpdate = true;
    },
  };
}

function smileyHead(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string]): RobotHead {
  // from the pictures: a tall bullet half again as tall as it's wide, a broad
  // round crown, nearly straight sides narrowing to a rounded chin; a flat
  // face with rounded edges, shallower than it is wide
  const grp = new THREE.Group();
  const HT = r * 3.3;
  const bottom = -r * 0.32;
  grp.position.set(0, bottom + HT / 2, 0.01);
  headBone.add(grp);
  const W0 = r * 1.12;
  const form = outlineForm({
    top: HT / 2,
    height: HT,
    w: curve([[0, 0], [0.03, 0.55 * W0], [0.08, 0.8 * W0], [0.16, 0.95 * W0], [0.28, 1.0 * W0], [0.42, 0.99 * W0], [0.56, 0.95 * W0], [0.7, 0.86 * W0], [0.82, 0.74 * W0], [0.91, 0.58 * W0], [0.97, 0.36 * W0], [1, 0]]),
    front: curve([[0, 0], [0.03, 0.42 * r], [0.08, 0.66 * r], [0.16, 0.8 * r], [0.3, 0.86 * r], [0.5, 0.86 * r], [0.7, 0.84 * r], [0.82, 0.78 * r], [0.91, 0.66 * r], [0.97, 0.42 * r], [1, 0]]),
    back: curve([[0, 0], [0.03, 0.46 * r], [0.08, 0.7 * r], [0.16, 0.84 * r], [0.3, 0.9 * r], [0.5, 0.88 * r], [0.7, 0.8 * r], [0.82, 0.7 * r], [0.91, 0.56 * r], [0.97, 0.36 * r], [1, 0]]),
    n: () => 3.2,
  });
  const RX = W0;
  const RY = HT / 2;
  const ramp = toonRamp(kit);
  const headGeo = shaped(new THREE.SphereGeometry(1, 56, 40), form);
  kit.mesh(headGeo, kit.keep(new THREE.MeshToonMaterial({ color: zones[0], gradientMap: ramp })), grp);
  outline(kit, headGeo.clone(), grp, 1.035);

  // the painted face, redrawn when the expression changes
  const W = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = W;
  const g = canvas.getContext('2d')!;
  const tex = kit.keep(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // (lit a little from within, so the yellow eyes stay bright like a printed cartoon)
  const decal = kit.keep(new THREE.MeshToonMaterial({ map: tex, transparent: true, alphaTest: 0.4, gradientMap: ramp, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
  const HALF = 0.95;
  const TOP = 0.16;
  const BOT = 0.86;
  kit.mesh(shaped(patch(-HALF, HALF, TOP, BOT, 48, 32), form, 1.004), decal, grp);
  // a canvas pixel is wider than it is tall on the head: draw circles wider to keep them round
  // (the face runs straight down the head; across, it spans about 0.9 of the width either side)
  const A = ((BOT - TOP) * RY * 2) / (2 * 0.9 * RX);
  let last = '';
  const draw = (f: RobotFace) => {
    const happy = f.grin > 0.5 || f.smile > 0.5;
    const shout = f.stank > 0.4;
    const open = cl(Math.max(0.35 + f.jaw * 0.65, shout ? 0.95 : 0), 0, 1);
    const sq = f.blink ? 1 : cl(f.squint * 0.8 + (shout ? 0.4 : 0), 0, 0.85);
    const key = `${happy}|${shout}|${Math.round(open * 6)}|${Math.round(sq * 5)}`;
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, W, W);
    const ink = zones[2];
    // eyes: big yellow discs, a thick black ring round each (happy arcs at a peak)
    for (const s of [-1, 1]) {
      const ex = W / 2 + s * W * 0.27;
      const ey = W * 0.22;
      const R = W * 0.14;
      g.strokeStyle = ink;
      g.lineCap = 'round';
      if (happy && !f.blink) {
        g.lineWidth = W * 0.035;
        g.beginPath();
        g.ellipse(ex, ey + R * 0.35, R * A, R * 0.95, 0, Math.PI * 1.08, Math.PI * 1.92);
        g.stroke();
        continue;
      }
      g.lineWidth = W * 0.022;
      g.fillStyle = zones[1];
      g.beginPath();
      g.ellipse(ex, ey, R * A, Math.max(1, R * (1 - sq)), 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // the grin: a D on its back, black inside, a dark red tongue at the bottom
    const my = W * 0.7;
    const mw = W * 0.21 * (shout ? 0.82 : 1);
    const depth = W * (0.12 + open * 0.07);
    const lips = new Path2D();
    lips.moveTo(W / 2 - mw, my);
    lips.quadraticCurveTo(W / 2, my + W * 0.02, W / 2 + mw, my);
    lips.bezierCurveTo(W / 2 + mw * 0.9, my + depth * 1.4, W / 2 - mw * 0.9, my + depth * 1.4, W / 2 - mw, my);
    lips.closePath();
    g.fillStyle = '#120404';
    g.fill(lips);
    g.save();
    g.clip(lips);
    g.fillStyle = '#9e1a12';
    g.beginPath();
    g.ellipse(W / 2 - mw * 0.1, my + depth * 1.2, mw * 0.55, depth * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.lineWidth = W * 0.018;
    g.strokeStyle = ink;
    g.lineJoin = 'round';
    g.stroke(lips);
    tex.needsUpdate = true;
  };
  draw(robotFace());
  return { update: (f) => draw(f) };
}

function boxHead(kit: RobotKit, headBone: THREE.Object3D, r: number, zones: [string, string, string]): RobotHead {
  const grp = new THREE.Group();
  grp.position.set(0, r * 1.15, 0.01);
  headBone.add(grp);
  const W = r * 2.25;
  const H = r * 1.9;
  const D = r * 1.5;
  const ramp = toonRamp(kit);
  const ink = kit.keep(new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.BackSide }));
  const boxGeo = kit.keep(new RoundedBoxGeometry(W, H, D, 3, r * 0.1));
  kit.mesh(boxGeo, kit.keep(new THREE.MeshToonMaterial({ color: zones[0], gradientMap: ramp })), grp);
  outline(kit, boxGeo, grp, 1.03, undefined, ink);
  const front = D / 2;

  // eyes: flat red discs ringed in black, glowing on the kick
  const eyeMat = kit.keep(new THREE.MeshToonMaterial({ color: zones[1], emissive: zones[1], emissiveIntensity: 0.15, gradientMap: ramp }));
  const blackMat = kit.keep(new THREE.MeshBasicMaterial({ color: 0x050505 }));
  const eyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Object3D();
    eye.position.set(s * W * 0.245, r * 0.2, front + r * 0.005);
    grp.add(eye);
    kit.mesh(new THREE.CylinderGeometry(r * 0.38, r * 0.38, r * 0.02, 40).rotateX(Math.PI / 2), blackMat, eye);
    const disc = kit.mesh(new THREE.SphereGeometry(r * 0.33, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), eyeMat, eye, V(0, 0, r * 0.012));
    disc.scale.z = 0.22;
    eyes.push(eye);
  }

  // buck teeth: four, set in a black mouth at the bottom edge and poking out under it,
  // outlined; on a jaw that chatters
  const toothMat = kit.keep(new THREE.MeshToonMaterial({ color: 0xf3ecc9, gradientMap: ramp }));
  kit.mesh(new THREE.BoxGeometry(r * 1.02, r * 0.3, r * 0.02), blackMat, grp, V(-r * 0.16, -H / 2 + r * 0.17, front + r * 0.003));
  const jaw = new THREE.Group();
  const jawY = -H / 2 + r * 0.12;
  jaw.position.set(-r * 0.16, jawY, front + r * 0.025);
  grp.add(jaw);
  for (let i = 0; i < 4; i++) {
    const tg = kit.keep(new THREE.BoxGeometry(r * 0.22, r * 0.4, r * 0.06));
    const at = V((i - 1.5) * r * 0.24, 0, 0);
    kit.mesh(tg, toothMat, jaw, at);
    outline(kit, tg, jaw, 1.12, at, ink);
  }

  // the antenna: a thin black wire and a red ball, bobbing on a spring
  const antenna = new THREE.Object3D();
  antenna.position.set(r * 0.25, H / 2, -r * 0.1);
  grp.add(antenna);
  kit.mesh(new THREE.CylinderGeometry(r * 0.022, r * 0.03, r * 1.15, 6).translate(0, r * 0.575, 0), blackMat, antenna);
  const ballMat = kit.keep(new THREE.MeshToonMaterial({ color: zones[1], emissive: zones[1], emissiveIntensity: 0.1, gradientMap: ramp }));
  const ballGeo = kit.keep(new THREE.SphereGeometry(r * 0.32, 24, 16));
  kit.mesh(ballGeo, ballMat, antenna, V(0, r * 1.4, 0));
  outline(kit, ballGeo, antenna, 1.08, V(0, r * 1.4, 0), ink);
  kit.spring(antenna, 1.6);

  let t = 0;
  return {
    update(f, dt) {
      t += dt;
      const shout = f.stank > 0.4;
      // the eyes narrow in a squint, shut for a blink, flare on the drop
      const sq = f.blink ? 0.1 : 1 - cl(f.squint * 0.6, 0, 0.6);
      for (const e of eyes) e.scale.y += (sq - e.scale.y) * Math.min(1, dt * 25);
      eyeMat.emissiveIntensity = f.playing ? 0.1 + f.kick * 0.9 + (shout ? 0.7 : 0) : 0.15 + 0.08 * Math.sin(t * 1.5);
      ballMat.emissiveIntensity = 0.1 + (f.playing ? f.kick * 0.6 : 0);
      jaw.position.y = jawY - cl(Math.max(f.jaw, shout ? 0.7 : 0), 0, 1) * r * 0.08;
    },
  };
}
