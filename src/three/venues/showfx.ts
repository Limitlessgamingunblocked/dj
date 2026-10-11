/*
 * Show effects the big tours and festivals use now, built for the shared rig
 * (see docs/venue-research.md, "Show effects in use now"):
 *   – Wristbands: everyone in the crowd wears an LED band the show drives, as
 *     with the infrared-controlled bands at stadium tours. Colour sectors
 *     drift through the groove, waves run out from the stage through a build,
 *     every band fires on the drop and a ring of colour runs out through the
 *     crowd, and at the peak the two halves of the room swap on the beat.
 *   – KineticRig: a grid of LED spheres on motor winches over the floor,
 *     flying in formations: phrase-long waves, ripples and tilts in the
 *     groove, up into the roof for a breakdown, a slow descent through the
 *     build, a V on the drop, ripples on the beat at the peak. Winch speed is
 *     capped, as real ones are.
 *   – HoloScrim: a near-invisible gauze across the front of the stage with
 *     3D content projected on it, rendered from the front-of-house view, so
 *     shapes seem to hang in the air in front of the DJ: a turning wireframe
 *     solid, a tunnel of rings rushing out through a build, a burst on the
 *     drop, stars through a breakdown. From behind it is a faint reverse.
 * Each one is a single draw. They follow the flash rules: with Reduce
 * flashing nothing changes faster than every other beat and the drop doesn't
 * flash white.
 */
import * as THREE from 'three';
import type { Fixture } from './fixtures';
import { Pyro } from './pyro';
import type { ShowState } from './show';

/** how much of each part of the track is on: the groove, a breakdown (calm), the build's rush and the peak */
export function sectionMix(s: Pick<ShowState, 'playing' | 'build' | 'peak'>): { groove: number; calm: number; rush: number; peak: number } {
  if (!s.playing) return { groove: 0.3, calm: 0.7, rush: 0, peak: 0 };
  const peak = Math.min(1, Math.max(0, s.peak));
  const r = THREE.MathUtils.smoothstep(s.build, 0.45, 0.85);
  const c = Math.max(0, Math.min(1, s.build * 1.6) - r);
  const rush = r * (1 - peak);
  const calm = c * (1 - peak);
  return { groove: Math.max(0, 1 - peak - rush - calm), calm, rush, peak };
}

/* ------------------------------------------------------------------ */
/* LED wristbands                                                       */
/* ------------------------------------------------------------------ */

const BAND_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uT, uBeat, uKick, uGroove, uCalm, uRush, uPeak, uDrop, uSafe, uHands, uAmount, uScale;
  uniform vec2 uOrigin;
  uniform vec3 uC0, uC1, uC2;
  varying vec3 vCol;
  void main() {
    vec3 p = position;
    // a wrist at waist height, up in the air for some when the room's going
    float up = step(0.35, fract(aSeed * 7.3)) * uHands;
    p.y += 1.05 + up * 0.9 + 0.05 * sin(uBeat * 6.2832 + aSeed * 40.0);
    p.x += (fract(aSeed * 13.1) - 0.5) * 0.5;
    vec2 d = p.xz - uOrigin;
    float r = length(d);
    float ang = atan(d.x, -d.y);
    // groove: three sectors of the palette drifting round the room, each band breathing on its own
    float sec = fract(ang * 0.477 + uT * 0.02 + 10.0);
    vec3 gCol = sec < 0.333 ? uC0 : (sec < 0.667 ? uC1 : uC2);
    float g = 0.22 + 0.12 * sin(uT * 1.7 + aSeed * 50.0);
    // breakdown: a slow field of stars, a few bands at a time
    float star = smoothstep(0.92, 1.0, sin(uT * 0.9 + aSeed * 91.0) * 0.5 + 0.5);
    float c = 0.05 + 0.75 * star;
    // build: waves running out from the stage, faster as it tightens
    float speed = mix(9.0, 42.0, uRush);
    float wave = fract((r - uT * speed) / 16.0);
    float b = smoothstep(0.78, 1.0, wave) * (0.35 + 0.65 * uRush);
    // peak: the two halves of the room swap on the beat (every other beat with Reduce flashing); the colour moves on each bar
    float side = step(0.0, d.x);
    float beatStep = uSafe > 0.5 ? floor(uBeat * 0.5) : floor(uBeat);
    float on = mod(beatStep + side, 2.0);
    float pk = (0.3 + 0.7 * on) * (0.65 + 0.35 * uKick);
    float ci = mod(floor(uBeat / 4.0) + side, 3.0);
    vec3 pCol = ci < 0.5 ? uC0 : (ci < 1.5 ? uC1 : uC2);
    // the drop: every band at once, then a ring of colour running out through the crowd
    float ringD = (r - uDrop * 34.0) / 7.0;
    float ring = exp(-ringD * ringD) * exp(-uDrop * 0.7);
    float flash = (1.0 - uSafe * 0.75) * exp(-uDrop * 5.0);
    vec3 col = gCol * g * uGroove + uC2 * c * uCalm + mix(uC0, vec3(1.0), b * 0.5) * b * uRush + pCol * pk * uPeak;
    col += mix(uC1, vec3(1.0), 0.3) * ring * 1.4 + vec3(1.0, 0.97, 0.92) * flash * 1.6;
    vCol = col * uAmount;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(0.07 * uScale / max(1.0, -mv.z), 1.2, 7.0);
  }
`;
const BAND_FRAG = /* glsl */ `
  varying vec3 vCol;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(q));
    gl_FragColor = vec4(vCol * a, 1.0);
  }
`;

/**
 * LED wristbands on the crowd: one point per person, at the spots the far
 * crowd stands on. `origin` is the stage, the waves run out from it.
 */
export class Wristbands implements Fixture {
  readonly object: THREE.Points;
  /** the venue can fade them (daylight: bands don't read in the sun) */
  amount = 1;
  private u: Record<string, THREE.IUniform>;
  private sinceDrop = 99;

  constructor(spots: { x: number; z: number; y?: number }[], o: { origin: THREE.Vector2; seed?: number }) {
    const n = spots.length;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    let h = (o.seed ?? 11) * 9301 + 49297;
    spots.forEach((s, i) => {
      pos.set([s.x, s.y ?? 0, s.z], i * 3);
      h = (h * 9301 + 49297) % 233280;
      seed[i] = h / 233280;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.u = {
      uT: { value: 0 },
      uBeat: { value: 0 },
      uKick: { value: 0 },
      uGroove: { value: 1 },
      uCalm: { value: 0 },
      uRush: { value: 0 },
      uPeak: { value: 0 },
      uDrop: { value: 99 },
      uSafe: { value: 0 },
      uHands: { value: 0 },
      uAmount: { value: 1 },
      uScale: { value: 900 },
      uOrigin: { value: o.origin.clone() },
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
      uC2: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: BAND_VERT, fragmentShader: BAND_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.object = new THREE.Points(geo, mat);
    this.object.frustumCulled = false;
  }

  update(s: ShowState, dt: number): void {
    this.sinceDrop = s.dropHit ? 0 : Math.min(99, this.sinceDrop + dt);
    const m = sectionMix(s);
    const u = this.u;
    u.uT.value = s.t;
    u.uBeat.value = s.beat;
    u.uKick.value = s.kick;
    u.uGroove.value = m.groove;
    u.uCalm.value = m.calm;
    u.uRush.value = m.rush;
    u.uPeak.value = m.peak;
    u.uDrop.value = this.sinceDrop;
    u.uSafe.value = s.reduceFlash ? 1 : 0;
    u.uHands.value = THREE.MathUtils.smoothstep(s.hype, 0.55, 0.9);
    u.uAmount.value = this.amount * s.master * Math.min(1.2, s.intensity);
    u.uScale.value = Pyro.pixelScale;
    (u.uC0.value as THREE.Color).copy(s.colors[0]);
    (u.uC1.value as THREE.Color).copy(s.colors[1]);
    (u.uC2.value as THREE.Color).copy(s.colors[2]);
    this.object.visible = this.amount > 0.01;
  }
}

/* ------------------------------------------------------------------ */
/* kinetic lights                                                       */
/* ------------------------------------------------------------------ */

export type KineticShape = 'wave' | 'ripple' | 'tilt' | 'dome' | 'high' | 'descend' | 'v';

/**
 * Where an element sits for a shape, 0 (lowest) .. 1 (up at the roof), at grid
 * position u, v (−1..1). `k` is how far a build has got (the descent).
 */
export function kineticHeight(shape: KineticShape, u: number, v: number, t: number, k = 0): number {
  let y: number;
  switch (shape) {
    case 'wave':
      y = 0.5 + 0.4 * Math.sin(u * 2.4 + t * 0.9);
      break;
    case 'ripple':
      y = 0.5 + 0.4 * Math.sin(Math.hypot(u, v) * 4 - t * 1.6);
      break;
    case 'tilt': {
      const a = t * 0.35;
      y = 0.5 + 0.3 * (u * Math.cos(a) + v * Math.sin(a));
      break;
    }
    case 'dome':
      y = 0.9 - 0.6 * Math.min(1, (u * u + v * v) / 1.6);
      break;
    case 'high':
      y = 0.88 + 0.06 * Math.sin(t * 0.6 + u * 1.5);
      break;
    case 'descend':
      // coming down as the build tightens, trembling
      y = 0.92 - 0.7 * k + 0.035 * Math.sin(u * 3 + t * 9);
      break;
    case 'v':
      y = 0.15 + 0.75 * Math.min(1, Math.abs(u));
      break;
  }
  return Math.min(1, Math.max(0, y));
}

/** the formation for this part of the track; a new groove shape every phrase */
export function kineticShapeFor(s: Pick<ShowState, 'playing' | 'build' | 'peak'>, phrase: number, sinceDrop: number, drops: number): KineticShape {
  if (!s.playing) return 'high';
  if (sinceDrop < 8) return drops % 2 ? 'dome' : 'v';
  if (s.peak > 0.5) return 'ripple';
  if (s.build > 0.6) return 'descend';
  if (s.build > 0.25) return 'high';
  return (['wave', 'tilt', 'ripple', 'dome'] as const)[((phrase % 4) + 4) % 4];
}

/** how fast a winch can move, metres a second */
export const WINCH_SPEED = 1.2;

export interface KineticSpec {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  nx: number;
  nz: number;
  /** where the winches hang (the roof) */
  top: number;
  /** the lowest and highest an element flies */
  low: number;
  high: number;
}

export class KineticRig implements Fixture {
  readonly object = new THREE.Group();
  private balls: THREE.InstancedMesh;
  private cables: THREE.LineSegments;
  private cablePos: Float32Array;
  private uv: [number, number][] = [];
  private xz: [number, number][] = [];
  private y: number[] = [];
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private sinceDrop = 99;
  private drops = 0;

  constructor(private spec: KineticSpec) {
    for (let j = 0; j < spec.nz; j++) {
      for (let i = 0; i < spec.nx; i++) {
        const u = spec.nx > 1 ? (i / (spec.nx - 1)) * 2 - 1 : 0;
        const v = spec.nz > 1 ? (j / (spec.nz - 1)) * 2 - 1 : 0;
        this.uv.push([u, v]);
        this.xz.push([THREE.MathUtils.lerp(spec.x0, spec.x1, (u + 1) / 2), THREE.MathUtils.lerp(spec.z0, spec.z1, (v + 1) / 2)]);
        this.y.push(spec.high);
      }
    }
    const n = this.uv.length;
    this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
    this.balls.frustumCulled = false;
    for (let i = 0; i < n; i++) this.balls.setColorAt(i, this.c.setRGB(0, 0, 0));
    this.cablePos = new Float32Array(n * 6);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(this.cablePos, 3));
    this.cables = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x2a2d33, transparent: true, opacity: 0.55 }));
    this.cables.frustumCulled = false;
    // the winch boxes in the roof
    const winches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.2, 0.28), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.4 }), n);
    this.xz.forEach(([x, z], i) => winches.setMatrixAt(i, this.m.makeTranslation(x, spec.top, z)));
    this.object.add(this.cables, this.balls, winches);
    this.place();
  }

  private place(): void {
    const top = this.spec.top - 0.1;
    this.xz.forEach(([x, z], i) => {
      this.balls.setMatrixAt(i, this.m.makeTranslation(x, this.y[i], z));
      this.cablePos.set([x, top, z, x, this.y[i] + 0.17, z], i * 6);
    });
    this.balls.instanceMatrix.needsUpdate = true;
    this.cables.geometry.attributes.position.needsUpdate = true;
  }

  update(s: ShowState, dt: number): void {
    if (s.dropHit) {
      this.sinceDrop = 0;
      this.drops++;
    } else this.sinceDrop = Math.min(99, this.sinceDrop + dt);
    const sp = this.spec;
    const shape = kineticShapeFor(s, Math.floor(s.bar / 16), this.sinceDrop, this.drops);
    const span = sp.high - sp.low;
    const step = WINCH_SPEED * dt;
    const m = sectionMix(s);
    const level = s.master * Math.min(1.3, s.intensity);
    const after = Math.exp(-this.sinceDrop * 1.2);
    for (let i = 0; i < this.uv.length; i++) {
      const [u, v] = this.uv[i];
      const want = sp.low + span * kineticHeight(shape, u, v, s.t, s.build);
      this.y[i] += Math.max(-step, Math.min(step, want - this.y[i]));
      // colour: a gradient across the grid; at the peak the crest of the ripple catches the third colour
      const h = (this.y[i] - sp.low) / span;
      this.c.copy(s.colors[0]).lerp(s.colors[1], (u + 1) / 2);
      if (m.peak > 0.05) this.c.lerp(s.colors[2], m.peak * THREE.MathUtils.smoothstep(h, 0.7, 0.95));
      const bright = (0.55 * m.groove + 0.3 * m.calm + (0.45 + 0.8 * s.build) * m.rush + (0.9 + 0.5 * h) * m.peak + 1.4 * after) * (1 + s.kick * (s.reduceFlash ? 0.2 : 0.5));
      this.balls.setColorAt(i, this.c.multiplyScalar(bright * level));
    }
    this.balls.instanceColor!.needsUpdate = true;
    this.place();
  }
}

/* ------------------------------------------------------------------ */
/* holographic gauze                                                    */
/* ------------------------------------------------------------------ */

const MAX_SEGS = 40;
const MAX_RINGS = 10;

const HOLO_VERT = /* glsl */ `
  varying vec2 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position.xy;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const HOLO_FRAG = /* glsl */ `
  uniform vec4 uSeg[${MAX_SEGS}];
  uniform vec4 uRing[${MAX_RINGS}];
  uniform float uSegN, uRingN, uAmt, uStars, uT, uFlash;
  uniform vec2 uSize;
  uniform vec3 uCol0, uCol1, uNormal;
  varying vec2 vLocal;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 p = vLocal;
    float lines = 0.0;
    for (int i = 0; i < ${MAX_SEGS}; i++) {
      if (float(i) >= uSegN) break;
      vec2 a = uSeg[i].xy, b = uSeg[i].zw;
      vec2 pa = p - a, ba = b - a;
      float h = clamp(dot(pa, ba) / max(1e-4, dot(ba, ba)), 0.0, 1.0);
      float d = length(pa - ba * h);
      // strokes about 25 cm wide, as projected content is drawn to read from the back of a field
      lines += exp(-d * d * 32.0) + 0.05 * exp(-d * 3.0);
    }
    float rings = 0.0;
    for (int i = 0; i < ${MAX_RINGS}; i++) {
      if (float(i) >= uRingN) break;
      float d = abs(length(p - uRing[i].xy) - uRing[i].z);
      rings += uRing[i].w * 0.7 * (exp(-d * d * 28.0) + 0.05 * exp(-d * 3.0));
    }
    // a breakdown: stars hanging in the gauze, each on its own slow pulse
    vec2 cell = floor(p * 1.4);
    vec2 f = fract(p * 1.4) - 0.5;
    float h = hash(cell);
    float tw = smoothstep(0.86, 1.0, sin(uT * (0.6 + h) + h * 50.0) * 0.5 + 0.5);
    float stars = step(0.7, h) * tw * exp(-dot(f, f) * 60.0) * uStars;
    // projected light on a gauze has to outshine the rig behind it
    vec3 col = (uCol0 * lines + uCol1 * rings) * 2.4 + vec3(0.85, 0.9, 1.0) * stars;
    col = col / (1.0 + col * 0.25);
    col += vec3(1.0) * uFlash * 0.25;
    // soft at the edges of the gauze; a faint reverse seen from behind
    vec2 e = smoothstep(vec2(0.0), vec2(1.2), uSize * 0.5 - abs(p));
    float front = dot(uNormal, cameraPosition - vWorld) > 0.0 ? 1.0 : 0.3;
    gl_FragColor = vec4(col * uAmt * e.x * e.y * front, 1.0);
  }
`;

type Solid = { v: THREE.Vector3[]; e: [number, number][] };

/** the wireframe solids the gauze shows, unit size */
function solids(): Solid[] {
  const edgesOf = (v: THREE.Vector3[], len: number) => {
    const e: [number, number][] = [];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (Math.abs(v[i].distanceTo(v[j]) - len) < 1e-3) e.push([i, j]);
    return e;
  };
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const uniq = (g: THREE.BufferGeometry) => {
    const out: THREE.Vector3[] = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      if (!out.some((o) => o.distanceTo(v) < 1e-4)) out.push(v);
    }
    return out;
  };
  const iv = uniq(ico);
  const cube = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new THREE.Vector3(x, y, z).multiplyScalar(0.62))));
  const oct = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  const tet = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, -1, -1), new THREE.Vector3(-1, 1, -1), new THREE.Vector3(-1, -1, 1)].map((v) => v.multiplyScalar(0.62));
  const star = [...tet, ...tet.map((v) => v.clone().negate())];
  const starE = [...edgesOf(tet, tet[0].distanceTo(tet[1])), ...edgesOf(tet, tet[0].distanceTo(tet[1])).map(([a, b]) => [a + 4, b + 4] as [number, number])];
  return [
    { v: iv, e: edgesOf(iv, iv[0].distanceTo(iv.slice(1).reduce((m, x) => (iv[0].distanceTo(x) < iv[0].distanceTo(m) ? x : m)))) },
    { v: cube, e: edgesOf(cube, 1.24) },
    { v: oct, e: edgesOf(oct, Math.SQRT2) },
    { v: star, e: starE },
  ];
}

/** a point in the gauze's frame (x right, y up, z back towards the stage) projected onto the gauze from the eye */
export function projectOnto(p: THREE.Vector3, eye: THREE.Vector3): THREE.Vector2 | null {
  const dz = p.z - eye.z;
  if (dz < 0.5) return null;
  const k = -eye.z / dz;
  return new THREE.Vector2(eye.x + (p.x - eye.x) * k, eye.y + (p.y - eye.y) * k);
}

export class HoloScrim implements Fixture {
  readonly object: THREE.Mesh;
  /** the venue can fade it (a projection washes out in daylight) */
  amount = 1;
  private u: Record<string, THREE.IUniform>;
  private eye: THREE.Vector3;
  private solids = solids();
  private sinceDrop = 99;
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private tmp = new THREE.Vector3();

  /**
   * `pos`: the gauze's centre; it faces −Z (the crowd). `eye`: front of house
   * (world), the view the content is drawn for.
   */
  constructor(
    private size: [number, number],
    pos: THREE.Vector3,
    eye: THREE.Vector3,
  ) {
    this.eye = eye.clone().sub(pos);
    // the gauze faces the crowd: its frame's z runs back towards the stage
    this.eye.set(-this.eye.x, this.eye.y, this.eye.z);
    this.u = {
      uSeg: { value: Array.from({ length: MAX_SEGS }, () => new THREE.Vector4()) },
      uRing: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector4()) },
      uSegN: { value: 0 },
      uRingN: { value: 0 },
      uAmt: { value: 0 },
      uStars: { value: 0 },
      uT: { value: 0 },
      uFlash: { value: 0 },
      uSize: { value: new THREE.Vector2(...size) },
      uCol0: { value: new THREE.Color() },
      uCol1: { value: new THREE.Color() },
      uNormal: { value: new THREE.Vector3(0, 0, -1) },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
    this.object.position.copy(pos);
    this.object.rotation.y = Math.PI;
    this.object.frustumCulled = false;
  }

  update(s: ShowState, dt: number): void {
    this.sinceDrop = s.dropHit ? 0 : Math.min(99, this.sinceDrop + dt);
    const m = sectionMix(s);
    const u = this.u;
    const [W, H] = this.size;
    const drop = this.sinceDrop < 2.5 ? 1 - this.sinceDrop / 2.5 : 0;
    // how much shows: a faint solid in the groove, more through the build, all of it on the drop and the peak
    const amt = (0.3 * s.energy * m.groove + 0.35 * m.calm + (0.35 + 0.6 * s.build) * m.rush + 0.7 * m.peak + drop) * s.master * Math.min(1.2, s.intensity) * this.amount;
    u.uAmt.value = Math.min(1, amt);
    this.object.visible = amt > 0.01;
    u.uT.value = s.t;
    u.uStars.value = m.calm + 0.3 * m.groove;
    u.uFlash.value = s.reduceFlash ? 0 : Math.max(0, 1 - this.sinceDrop * 4);
    (u.uCol0.value as THREE.Color).copy(s.colors[0]).lerp(new THREE.Color(1, 1, 1), 0.25);
    (u.uCol1.value as THREE.Color).copy(s.colors[1]);
    // the solid: a new one every 16 bars, turning with the beat; it swells on the kick at the peak and bursts on the drop
    const solid = this.solids[((Math.floor(s.bar / 16) % this.solids.length) + this.solids.length) % this.solids.length];
    const turn = (s.beat * Math.PI) / 16;
    this.e.set(turn * 0.7, turn, turn * 0.3);
    this.q.setFromEuler(this.e);
    const scale = Math.min(H, W) * 0.3 * (1 + 0.1 * s.kick * m.peak) * (1 - 0.45 * m.rush) * (1 + 2.2 * (1 - drop) * (this.sinceDrop < 2.5 ? 1 : 0));
    const centre = new THREE.Vector3(0, H * 0.06, 2);
    const segs = u.uSeg.value as THREE.Vector4[];
    let n = 0;
    const pts = solid.v.map((v) => projectOnto(this.tmp.copy(v).applyQuaternion(this.q).multiplyScalar(scale).add(centre), this.eye));
    for (const [a, b] of solid.e) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb || n >= MAX_SEGS) continue;
      segs[n++].set(pa.x, pa.y, pb.x, pb.y);
    }
    u.uSegN.value = n;
    // the tunnel: rings coming out of the stage towards the crowd, faster as the build tightens; on the drop they burst
    const rings = u.uRing.value as THREE.Vector4[];
    let r = 0;
    const tunnel = Math.max(m.rush, drop);
    if (tunnel > 0.02) {
      const speed = 4 + 22 * s.build;
      for (let k = 0; k < MAX_RINGS; k++) {
        const z = 18 - ((k * 2.4 + s.t * speed) % 24);
        const c = projectOnto(this.tmp.set(0, H * 0.06, z), this.eye);
        if (!c) continue;
        const k2 = -this.eye.z / (z - this.eye.z);
        const radius = (H * 0.32 + drop * this.sinceDrop * 14) * k2;
        rings[r++].set(c.x, c.y, radius, tunnel * THREE.MathUtils.smoothstep(z, -6, 6));
      }
    }
    u.uRingN.value = r;
  }
}
