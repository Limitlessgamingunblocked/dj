/*
 * Show lasers: RGB scanned-beam projectors, drawn the way they look on camera
 * (see docs/venue-research.md, "Lasers and effects").
 *   – beams only show where there's haze: they brighten in the clumps and fade
 *     in clear pockets as the clouds drift through (shared haze, atmos.ts)
 *   – a hard core with a faint halo, a whisper of red and blue fringe where the
 *     three diode beams don't quite converge, and a little divergence with
 *     distance; scanned beams shimmer
 *   – beams end where they hit the room (floor, walls, ceiling or vault, and
 *     solid things like the LED wall), with a bright dot on the surface, so a
 *     sweeping fan traces a line of dots across the ceiling
 *   – sheet looks are drawn as real planes of light between neighbouring
 *     beams, streaky with haze and brightest seen edge-on (the "liquid sky"
 *     over the crowd, tunnels, waves)
 *   – a projector pointed at the camera flares
 *   – safety: given the audience area, every beam is kept at least 3 m above
 *     the floor over the crowd (no audience scanning)
 *   – looks change smoothly: fans open out and beams sweep to their new places
 * Five draws for any number of projectors: beams, sheets, dots, bodies and
 * apertures.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HAZE_GLSL } from './atmos';
import type { Fixture } from './fixtures';
import { SHEET, type LaserPattern } from './laserlooks';
import type { ShowState } from './show';

/* ------------------------------------------------------------------ */
/* the room, as the lasers see it                                       */
/* ------------------------------------------------------------------ */

export interface RoomProxy {
  floorY: number;
  /** walls (axis aligned) */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** flat ceiling */
  ceilY?: number;
  /** a barrel vault running along z, centred on x = 0 */
  vault?: { centreY: number; radius: number };
  /** solid things in the room the beams stop on (LED wall, galleries) */
  solids?: THREE.Box3[];
}

/** Distance along a ray (from inside a box) to where it enters, or −1 if it misses (or starts inside). */
function enterBox(o: THREE.Vector3, d: THREE.Vector3, b: THREE.Box3): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    const oo = o[k];
    const dd = d[k];
    const lo = b.min[k];
    const hi = b.max[k];
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return -1;
      continue;
    }
    let t1 = (lo - oo) / dd;
    let t2 = (hi - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin > 0 ? tmin : -1;
}

/** How far a beam from `o` along unit direction `d` travels before it hits the room. */
export function hitDistance(o: THREE.Vector3, d: THREE.Vector3, room: RoomProxy): number {
  const E = 1e-6;
  let t = Infinity;
  if (d.x > E) t = Math.min(t, (room.x1 - o.x) / d.x);
  else if (d.x < -E) t = Math.min(t, (room.x0 - o.x) / d.x);
  if (d.z > E) t = Math.min(t, (room.z1 - o.z) / d.z);
  else if (d.z < -E) t = Math.min(t, (room.z0 - o.z) / d.z);
  if (d.y < -E) t = Math.min(t, (room.floorY - o.y) / d.y);
  if (room.ceilY !== undefined && d.y > E) t = Math.min(t, (room.ceilY - o.y) / d.y);
  if (room.vault) {
    // inside the cylinder x² + (y − cy)² = r²: the far root
    const oy = o.y - room.vault.centreY;
    const a = d.x * d.x + d.y * d.y;
    if (a > 1e-9) {
      const b = 2 * (o.x * d.x + oy * d.y);
      const c = o.x * o.x + oy * oy - room.vault.radius * room.vault.radius;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const tc = (-b + Math.sqrt(disc)) / (2 * a);
        if (tc > 0) t = Math.min(t, tc);
      }
    }
  }
  if (room.solids) {
    for (const bx of room.solids) {
      const ts = enterBox(o, d, bx);
      if (ts > 0 && ts < t) t = ts;
    }
  }
  return Math.max(0, t);
}

export interface AudienceZone {
  floorY: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** how far above the floor beams must stay over the crowd (default 3 m) */
  clear?: number;
}

/**
 * Lift a beam (unit direction `d`, changed in place) so it stays at least
 * `clear` above the floor everywhere its path crosses the audience area.
 * Returns true if it had to be lifted.
 */
export function clampAboveAudience(o: THREE.Vector3, d: THREE.Vector3, zone: AudienceZone): boolean {
  const clearY = zone.floorY + (zone.clear ?? 3);
  const hl = Math.hypot(d.x, d.z);
  const inside = o.x >= zone.x0 && o.x <= zone.x1 && o.z >= zone.z0 && o.z <= zone.z1;
  if (hl < 1e-5) {
    // straight down into the crowd: point it up instead
    if (d.y < 0 && inside) {
      d.set(0, 1, 0);
      return true;
    }
    return false;
  }
  const ux = d.x / hl;
  const uz = d.z / hl;
  // where the beam's ground track enters and leaves the audience
  let sIn = -Infinity;
  let sOut = Infinity;
  for (const [oo, uu, lo, hi] of [
    [o.x, ux, zone.x0, zone.x1],
    [o.z, uz, zone.z0, zone.z1],
  ]) {
    if (Math.abs(uu) < 1e-9) {
      if (oo < lo || oo > hi) return false;
      continue;
    }
    let a = (lo - oo) / uu;
    let b = (hi - oo) / uu;
    if (a > b) [a, b] = [b, a];
    sIn = Math.max(sIn, a);
    sOut = Math.min(sOut, b);
  }
  if (sOut <= Math.max(sIn, 0)) return false;
  // height is linear along the track, so checking where it enters and leaves is enough
  let minSlope = (clearY - o.y) / sOut;
  if (sIn > 0.05) minSlope = Math.max(minSlope, (clearY - o.y) / sIn);
  else if (o.y < clearY) minSlope = Math.max(minSlope, 2); // low, among the crowd: steeply up
  if (d.y / hl >= minSlope) return false;
  const n = Math.hypot(1, minSlope);
  d.set(ux / n, minSlope / n, uz / n);
  return true;
}

/** Slim black stands for projectors that sit above the stage deck (one merged mesh). */
export function laserStands(tops: THREE.Vector3[], baseY: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const t of tops) {
    const h = t.y - 0.1 - baseY;
    parts.push(new THREE.CylinderGeometry(0.035, 0.05, h, 8).translate(t.x, baseY + h / 2, t.z));
    parts.push(new THREE.CylinderGeometry(0.28, 0.32, 0.04, 12).translate(t.x, baseY + 0.02, t.z));
  }
  return new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.5, metalness: 0.5 }));
}

/* ------------------------------------------------------------------ */
/* shaders                                                              */
/* ------------------------------------------------------------------ */

const BEAM_VERT = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  attribute vec3 iOrigin;
  attribute vec3 iDir;
  attribute vec4 iColor;
  attribute float iLen;
  uniform float uK;
  varying float vSide;
  varying float vAlong;
  varying vec4 vColor;
  varying vec3 vW;
  varying float vNear;
  void main() {
    vec3 p = iOrigin + iDir * (aAlong * iLen);
    vec3 toCam = cameraPosition - p;
    float dist = length(toCam);
    vec3 side = normalize(cross(iDir, toCam) + vec3(1e-5, 0.0, 0.0));
    // constant width on screen, plus a little real divergence with distance
    float w = uK * max(dist, 0.3) + aAlong * iLen * 0.0012;
    p += side * aSide * w;
    vSide = aSide;
    vAlong = aAlong;
    vColor = iColor;
    vW = p;
    // nothing right on the lens (the drone flies through beams), and no smear when seen end-on
    float endOn = 1.0 - abs(dot(iDir, toCam / max(dist, 1e-4)));
    // (a camera-facing ribbon twists when it passes right by the lens: fade it out over the last few metres)
    vNear = smoothstep(0.8, 5.0, dist) * smoothstep(0.0, 0.06, endOn);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const BEAM_FRAG = /* glsl */ `
  uniform float uT, uSmoke;
  uniform vec2 uBand;
  varying float vSide;
  varying float vAlong;
  varying vec4 vColor;
  varying vec3 vW;
  varying float vNear;
  ${HAZE_GLSL}
  void main() {
    // the three diode beams don't quite converge: a whisper of red on one edge, blue on the other
    // (squares, not pow(x, 2.0): pow of a negative number is undefined in GLSL and NaN on many GPUs)
    vec3 e = vec3(vSide - 0.045, vSide, vSide + 0.045) * 6.0;
    vec3 core = exp(-e * e);
    float halo = exp(-abs(vSide) * 4.0) * 0.04;
    // a beam that hits something runs right up to it; one that doesn't fades out into the room
    float fade = smoothstep(0.0, 0.008, vAlong) * mix(1.0 - smoothstep(0.55, 1.0, vAlong), 1.0, vColor.a);
    float hz = hazeAt(vW, uT, uBand, uSmoke);
    gl_FragColor = vec4(vColor.rgb * (core * 0.85 + halo) * fade * (0.08 + 1.1 * hz) * vNear, 1.0);
  }`;

const SHEET_VERT = /* glsl */ `
  attribute vec3 aCol;
  attribute float aAlong;
  varying vec3 vCol;
  varying vec3 vW;
  varying float vAlong;
  void main() {
    vCol = aCol;
    vAlong = aAlong;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const SHEET_FRAG = /* glsl */ `
  uniform float uT, uSmoke;
  uniform vec2 uBand;
  varying vec3 vCol;
  varying vec3 vW;
  varying float vAlong;
  ${HAZE_GLSL}
  void main() {
    // a thin slab of lit haze: seen edge-on it's a bright line, face-on a faint plane
    // the sheet's normal from screen derivatives; seen exactly edge-on they're parallel (no normal),
    // so guard the length rather than normalize a zero vector (NaN)
    vec3 cr = cross(dFdx(vW), dFdy(vW));
    float cl = length(cr);
    vec3 toCam = cameraPosition - vW;
    float dist = length(toCam);
    float facing = cl > 1e-12 ? abs(dot(cr / cl, toCam / max(dist, 1e-4))) : 0.0;
    float graze = clamp(1.0 / max(facing, 0.2), 1.0, 4.0);
    // streaky texture: the scanner sweeping through rolling haze
    float streak = hzN(vW * vec3(0.32, 1.6, 0.32) + vec3(uT * 0.22, uT * 0.05, uT * 0.17));
    float hz = hazeAt(vW, uT, uBand, uSmoke);
    float near = smoothstep(0.6, 3.5, dist);
    float fade = smoothstep(0.0, 0.12, vAlong);
    gl_FragColor = vec4(vCol * (0.01 + 0.035 * streak * streak) * graze * (0.1 + 1.2 * hz) * near * fade, 1.0);
  }`;

const DOT_VERT = /* glsl */ `
  attribute vec3 aCol;
  uniform float uSize;
  varying vec3 vC;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    vC = aCol * smoothstep(0.5, 2.0, d);
    gl_PointSize = clamp(uSize * 700.0 / max(d, 0.1), 2.0, 22.0);
    gl_Position = projectionMatrix * mv;
  }`;

const DOT_FRAG = /* glsl */ `
  varying vec3 vC;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(vC * (exp(-r * r * 70.0) * 2.6 + exp(-r * 7.0) * 0.18), 1.0);
  }`;

/* ------------------------------------------------------------------ */
/* the fixture                                                          */
/* ------------------------------------------------------------------ */

export interface LaserSpec {
  pos: THREE.Vector3;
  /** forward direction of the projector */
  dir: THREE.Vector3;
  beams?: number;
  /** which side of the room it sits on (for crossfire) */
  side?: number;
  length?: number;
  /** use the second palette colour */
  alt?: boolean;
  /** house colour used while the venue palette is active */
  color?: string;
  /** looks this projector sits out */
  skip?: LaserPattern[];
}

export interface LaserOptions {
  /** the room: beams stop on it and leave dots */
  room?: RoomProxy;
  /** the crowd: beams stay above head height over it */
  audience?: AudienceZone;
  /** where the converge look meets (default: 25 m in front of the rig, a few metres up) */
  focus?: THREE.Vector3;
  /** floor-to-ceiling range the haze fills */
  haze?: [number, number];
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Laser colours are pure: normalise to full saturation and boost. */
function hdr(c: THREE.Color, gain: number, out: THREE.Color): THREE.Color {
  const m = Math.max(c.r, c.g, c.b, 1e-3);
  return out.setRGB((c.r / m) * gain, (c.g / m) * gain, (c.b / m) * gain);
}

const GRADIENT = new Set<LaserPattern>(['fan', 'gaps', 'wave', 'rotate', 'tunnel', 'liquid']);

/**
 * Which projectors play which looks. With an audience zone each projector is
 * a tier by height: 'lip' (below head-clearance, on the stage), 'low' (just
 * above it: the flat sheets come from these) or 'high' (trusses, towers,
 * walls). A real rig doesn't run one look on every head: the liquid sky is a
 * couple of low projectors, the starfield the high ones.
 */
type Tier = 'lip' | 'low' | 'high';
const PARTS: Partial<Record<LaserPattern, Tier[]>> = {
  liquid: ['low'],
  sheet: ['low', 'lip'],
  wave: ['low', 'lip'],
  tunnel: ['lip', 'high'],
  rotate: ['high'],
  stars: ['high'],
  chase: ['lip', 'high'],
};
const UP = new THREE.Vector3(0, 1, 0);

/** where a board's laser controller is pushing the beams, −1..1 each way (Board Builder, Section 13.6) */
export const laserAim = { x: 0, y: 0 };

export class Lasers implements Fixture {
  readonly object = new THREE.Group();
  private geo: THREE.InstancedBufferGeometry;
  private origin: THREE.InstancedBufferAttribute;
  private dir: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private len: THREE.InstancedBufferAttribute;
  private beamMat: THREE.ShaderMaterial;
  private sheetPos: THREE.BufferAttribute;
  private sheetCol: THREE.BufferAttribute;
  private sheetMat: THREE.ShaderMaterial;
  private dotPos: THREE.BufferAttribute;
  private dotCol: THREE.BufferAttribute;
  private frames: { F: THREE.Vector3; R: THREE.Vector3; U: THREE.Vector3; hF: THREE.Vector3; hR: THREE.Vector3 }[] = [];
  private apertures: THREE.InstancedMesh;
  private total = 0;
  private counts: number[];
  private cur: Float32Array;
  private ends: Float32Array;
  private cols: Float32Array;
  private house: THREE.Color[];
  private sheetPitch: number[] = [];
  private tiers: Tier[];
  /** per projector, eased in and out as looks hand over between groups */
  private part: number[];
  private look: LaserPattern = 'fan';
  private lookAt = -10;
  private frame = 0;
  private focus: THREE.Vector3;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private cam = new THREE.Vector3();
  private cA = new THREE.Color();
  private cB = new THREE.Color();
  private cC = new THREE.Color();
  private c = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s3 = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, -1);

  constructor(
    private specs: LaserSpec[],
    private opts: LaserOptions = {},
  ) {
    this.house = specs.map((s) => new THREE.Color(s.color ?? '#ffffff'));
    const z = opts.audience;
    this.tiers = specs.map((s) => {
      if (!z) return 'high';
      const clearY = z.floorY + (z.clear ?? 3);
      return s.pos.y < clearY ? 'lip' : s.pos.y < clearY + 2.5 ? 'low' : 'high';
    });
    this.part = specs.map(() => 1);
    this.counts = specs.map((s) => s.beams ?? 14);
    this.total = this.counts.reduce((a, b) => a + b, 0);
    const n = this.total;

    // beams: camera-facing ribbons, one instance per beam
    const SEG = 8;
    const along: number[] = [];
    const side: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      along.push(i / SEG, i / SEG);
      side.push(-1, 1);
      if (i < SEG) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(along.length * 3), 3));
    this.geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    this.geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    this.geo.setIndex(index);
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.dir = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.len = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    for (const a of [this.origin, this.dir, this.color, this.len]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iOrigin', this.origin);
    this.geo.setAttribute('iDir', this.dir);
    this.geo.setAttribute('iColor', this.color);
    this.geo.setAttribute('iLen', this.len);
    this.geo.instanceCount = n;
    const haze = { uT: { value: 0 }, uSmoke: { value: 0.5 }, uBand: { value: new THREE.Vector2(...(opts.haze ?? [-100, 100])) } };
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    this.beamMat = new THREE.ShaderMaterial({ uniforms: { ...haze, uK: { value: 0.009 } }, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, side: THREE.DoubleSide, ...additive });
    const beams = new THREE.Mesh(this.geo, this.beamMat);
    beams.frustumCulled = false;

    // sheets: a triangle from each projector to every pair of neighbouring beam ends
    const sg = new THREE.BufferGeometry();
    this.sheetPos = new THREE.BufferAttribute(new Float32Array(n * 9), 3).setUsage(THREE.DynamicDrawUsage);
    this.sheetCol = new THREE.BufferAttribute(new Float32Array(n * 9), 3).setUsage(THREE.DynamicDrawUsage);
    const sAlong = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) sAlong.set([0, 1, 1], i * 3);
    sg.setAttribute('position', this.sheetPos);
    sg.setAttribute('aCol', this.sheetCol);
    sg.setAttribute('aAlong', new THREE.BufferAttribute(sAlong, 1));
    this.sheetMat = new THREE.ShaderMaterial({ uniforms: { uT: haze.uT, uSmoke: haze.uSmoke, uBand: haze.uBand }, vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, side: THREE.DoubleSide, ...additive });
    const sheets = new THREE.Mesh(sg, this.sheetMat);
    sheets.frustumCulled = false;

    // dots where beams land
    const dg = new THREE.BufferGeometry();
    this.dotPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dotCol = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('position', this.dotPos);
    dg.setAttribute('aCol', this.dotCol);
    const dots = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: { uSize: { value: 0.32 } }, vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, ...additive }));
    dots.frustumCulled = false;

    this.object.add(beams, sheets, dots);

    // per-projector frames
    const centre = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    specs.forEach((s) => {
      const F = s.dir.clone().normalize();
      const R = new THREE.Vector3().crossVectors(F, Math.abs(F.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : UP).normalize();
      const U = new THREE.Vector3().crossVectors(R, F).normalize();
      const hF = new THREE.Vector3(F.x, 0, F.z);
      if (hF.lengthSq() < 1e-6) hF.set(0, 0, -1);
      hF.normalize();
      const hR = new THREE.Vector3(-hF.z, 0, hF.x);
      this.frames.push({ F, R, U, hF, hR });
      this.sheetPitch.push(-0.06);
      centre.add(s.pos);
      ahead.add(F);
    });
    centre.divideScalar(Math.max(1, specs.length));
    this.focus = opts.focus?.clone() ?? centre.clone().addScaledVector(ahead.normalize(), 25).add(new THREE.Vector3(0, 3, 0));

    this.cur = new Float32Array(n * 3);
    this.ends = new Float32Array(n * 3);
    this.cols = new Float32Array(n * 3);
    let k = 0;
    specs.forEach((s, p) => {
      for (let i = 0; i < this.counts[p]; i++, k++) {
        const F = this.frames[p].F;
        this.cur.set([F.x, F.y, F.z], k * 3);
        this.origin.setXYZ(k, s.pos.x, s.pos.y, s.pos.z);
      }
    });

    // projector housings with a glowing aperture
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.5, metalness: 0.6 }), specs.length);
    this.apertures = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), specs.length);
    specs.forEach((s, i) => {
      this.q.setFromUnitVectors(this.fwd, this.frames[i].F);
      this.m4.compose(s.pos.clone().addScaledVector(this.frames[i].F, -0.18), this.q, this.s3.set(1, 1, 1));
      body.setMatrixAt(i, this.m4);
      this.m4.makeTranslation(s.pos.x, s.pos.y, s.pos.z);
      this.apertures.setMatrixAt(i, this.m4);
      this.apertures.setColorAt(i, this.c.setRGB(0, 0, 0));
    });
    this.object.add(body, this.apertures);
  }

  private aim(p: number, yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
    const { F, R, U } = this.frames[p];
    // a laser controller on a board you built swings the looks round and lifts them; it never lowers them towards the crowd
    yaw += laserAim.x * 0.45;
    pitch += Math.max(0, laserAim.y) * 0.22;
    const cp = Math.cos(pitch);
    return out
      .copy(F)
      .multiplyScalar(Math.cos(yaw) * cp)
      .addScaledVector(R, Math.sin(yaw) * cp)
      .addScaledVector(U, Math.sin(pitch))
      .normalize();
  }

  /** Where beam `i` of projector `p` wants to point for the current look; returns [on, beam gain, dot gain]. */
  private target(s: ShowState, p: number, i: number, B: number, open: number, age: number, out: THREE.Vector3): [number, number, number] {
    const b = s.beat;
    const t = s.t;
    const u = B > 1 ? i / (B - 1) - 0.5 : 0;
    const sgn = this.specs[p].side ?? (p % 2 ? 1 : -1);
    const fr = this.frames[p];
    let on = 1;
    let gain = 1;
    let dot = 1.2;
    switch (this.look) {
      case 'fan':
        this.aim(p, u * (1.1 + 0.25 * Math.sin((b * Math.PI) / 8)) * open, -0.04 + 0.1 * Math.sin((b * Math.PI) / 4 + p * 1.3), out);
        if (s.peak > 0.5 && !s.reduceFlash) on = Math.floor(b * 2) % 2 ? 1 : 0.35;
        break;
      case 'gaps':
        // a wide fan with every third beam blanked; the gaps march across on the eighth notes
        this.aim(p, u * 1.35 * open, -0.03 + 0.06 * Math.sin((b * Math.PI) / 4 + p), out);
        on = (i + Math.floor(b * 2)) % 3 === 0 ? 0 : 1;
        break;
      case 'tunnel': {
        const a = (i / B) * Math.PI * 2 + t * 1.2 * (p % 2 ? 1 : -1);
        const hA = (0.12 + 0.05 * Math.sin((b * Math.PI) / 2)) * open + 0.01;
        out.copy(fr.F).multiplyScalar(Math.cos(hA)).addScaledVector(fr.R, Math.cos(a) * Math.sin(hA)).addScaledVector(fr.U, Math.sin(a) * Math.sin(hA)).normalize();
        break;
      }
      case 'sheet':
        this.aim(p, u * 1.5 * open, this.sheetPitch[p], out);
        gain = 0.7;
        break;
      case 'liquid': {
        // a flat plane over the crowd's heads, gently rippling
        const yaw = u * 1.75 * open;
        out.copy(fr.hF).multiplyScalar(Math.cos(yaw)).addScaledVector(fr.hR, Math.sin(yaw));
        out.y = 0.014 * Math.sin(u * 9 + t * 1.3 + p);
        out.normalize();
        gain = 0.45;
        break;
      }
      case 'wave':
        this.aim(p, u * 1.5 * open, -0.02 + 0.09 * Math.sin(u * 9 - t * 3 + p), out);
        gain = 0.75;
        break;
      case 'cross':
        this.aim(p, sgn * (0.35 + 0.25 * Math.sin((b * Math.PI) / 2)) + u * 0.3 * open, -0.04 + 0.08 * Math.sin((b * Math.PI) / 4), out);
        break;
      case 'converge': {
        // every projector closes in on one point that drifts over the crowd
        const P = this.w.copy(this.focus).add(this.s3.set(Math.sin(t * 0.37) * 6, Math.sin(t * 0.61) * 1.5, Math.cos(t * 0.29) * 6));
        const tight = s.build > 0.6 ? Math.min(1, (s.build - 0.6) / 0.35) : 0.5 + 0.5 * Math.sin(b * Math.PI * 0.5);
        const spread = (0.015 + 0.14 * (1 - tight)) * (2 - open);
        const a = (i / B) * Math.PI * 2 + t * 0.8;
        out.copy(P).sub(this.specs[p].pos).normalize().addScaledVector(fr.R, Math.cos(a) * spread).addScaledVector(fr.U, Math.sin(a) * spread).normalize();
        // a dozen projectors on one point would burn a hole in the frame
        gain = 0.55;
        break;
      }
      case 'rotate': {
        // a fan whose plane turns slowly about the projector's axis
        const th = t * 0.5 * (p % 2 ? 1 : -1);
        const wv = u * 1.4 * open;
        this.w.copy(fr.R).multiplyScalar(Math.cos(th)).addScaledVector(fr.U, Math.sin(th));
        out.copy(fr.F).multiplyScalar(Math.cos(wv)).addScaledVector(this.w, Math.sin(wv)).normalize();
        gain = 0.8;
        break;
      }
      case 'chase': {
        const step = Math.floor(b * 2);
        on = i < 4 ? 1 : 0;
        this.aim(p, (hash(step * 7 + i + p * 31) - 0.5) * 1.4, (hash(step * 13 + i * 3 + p) - 0.5) * 0.3, out);
        break;
      }
      case 'burst': {
        // fireworks: the beams fly open from the projector, then sparkle
        const k = Math.min(1, age / 0.4);
        const hx = hash(i * 3.1 + p * 17) - 0.5;
        const hy = hash(i * 7.7 + p * 5);
        out.copy(fr.F).addScaledVector(fr.R, hx * 2.8 * k).addScaledVector(fr.U, (0.12 + hy * 1.2) * k).normalize();
        if (age > 0.55) on = hash(Math.floor(t * (s.reduceFlash ? 2.8 : 16)) + i * 13 + p * 7) > 0.32 ? 1 : 0.12;
        gain = 1.15;
        dot = 1.6;
        break;
      }
      case 'strobe':
        this.aim(p, u * 1.2 * open, -0.03 + 0.05 * Math.sin((b * Math.PI) / 2), out);
        // on and off on the eighth notes (under 3 times a second with reduce flashing)
        on = s.reduceFlash ? ((t * 2.8) % 1 < 0.5 ? 1 : 0.2) : Math.floor(b * 2) % 2 ? 1 : 0;
        break;
      case 'stars': {
        // beams climb to the ceiling and wander: a field of moving dots overhead
        const h = hash(i * 5.3 + p * 41);
        const h2 = hash(i * 11.1 + p * 7);
        out.copy(fr.F).multiplyScalar(0.35).addScaledVector(UP, 0.85 + h2 * 0.5).addScaledVector(fr.hR, (h - 0.5) * 2.2 + Math.sin(t * 0.21 + i) * 0.18).addScaledVector(fr.hF, Math.cos(t * 0.17 + i * 1.7) * 0.25).normalize();
        on = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * (1.2 + h * 2) + i * 2.1), 4);
        gain = 0.1;
        dot = 3.2;
        break;
      }
    }
    return [on, gain, dot];
  }

  update(s: ShowState, dt: number, camera?: THREE.Camera): void {
    this.frame++;
    if (s.laserPattern !== this.look) {
      this.look = s.laserPattern;
      this.lookAt = s.t;
    }
    const age = s.t - this.lookAt;
    // fans open out over half a second and beams sweep to their new places
    const open = THREE.MathUtils.smoothstep(age, 0, 0.5);
    const kf = 1 - Math.exp(-dt * (age < 0.6 ? 6 : 18));
    const level = s.lasers * s.master * Math.min(1.3, s.intensity);
    const sheetAmt = (SHEET[this.look] ?? 0) * level;
    this.beamMat.uniforms.uT.value = s.t;
    this.beamMat.uniforms.uSmoke.value = s.smoke;
    if (camera) camera.getWorldPosition(this.cam);
    const room = this.opts.room;
    const zone = this.opts.audience;
    const grad = GRADIENT.has(this.look);
    // which projectors take part (all of them if the rig has none of the look's tiers)
    const want = PARTS[this.look];
    const anyTier = !want || !this.opts.audience || !this.tiers.some((t) => want.includes(t));
    for (let p = 0; p < this.specs.length; p++) {
      const target = (anyTier || want!.includes(this.tiers[p])) && !this.specs[p].skip?.includes(this.look) ? 1 : 0;
      this.part[p] += (target - this.part[p]) * Math.min(1, dt * 4);
    }
    let k = 0;
    this.specs.forEach((sp, p) => {
      const B = this.counts[p];
      const k0 = k;
      const base = sp.color && s.venueLook ? this.house[p] : s.colors[sp.alt ? 1 : 0];
      hdr(base, 2.4, this.cA);
      if (sp.color && s.venueLook) this.cB.copy(this.cA);
      else hdr(s.colors[sp.alt ? 0 : 1], 2.4, this.cB);
      hdr(s.colors[2], 2.4, this.cC);
      const targetSheet = -0.03 - 0.07 * (0.5 + 0.5 * Math.sin(s.t * 0.35 + p));
      this.sheetPitch[p] += (targetSheet - this.sheetPitch[p]) * Math.min(1, dt * 2);
      for (let i = 0; i < B; i++, k++) {
        const [on, gain, dotGain] = this.target(s, p, i, B, open, age, this.v);
        // sweep the beam towards where it wants to be, then keep it above the crowd
        const j = k * 3;
        this.w.set(this.cur[j], this.cur[j + 1], this.cur[j + 2]).lerp(this.v, kf).normalize();
        if (zone) clampAboveAudience(sp.pos, this.w, zone);
        this.cur[j] = this.w.x;
        this.cur[j + 1] = this.w.y;
        this.cur[j + 2] = this.w.z;
        let len = sp.length ?? 30;
        let hit = 0;
        if (room) {
          const th = hitDistance(sp.pos, this.w, room);
          if (th < len) {
            len = th;
            hit = 1;
          }
        }
        // colour: one colour, a gradient across the fan, or (burst) the whole palette
        if (this.look === 'burst' && !(sp.color && s.venueLook)) this.c.copy([this.cA, this.cB, this.cC][i % 3]);
        else if (grad) this.c.copy(this.cA).lerp(this.cB, i / Math.max(1, B - 1));
        else this.c.copy(this.cA);
        // scanned beams shimmer a little
        const lv = level * this.part[p];
        const g = lv * on * gain * (0.8 + 0.25 * s.kick) * (0.88 + 0.12 * hash(this.frame * 13 + k));
        this.dir.setXYZ(k, this.w.x, this.w.y, this.w.z);
        this.len.setX(k, len);
        this.color.setXYZ(k, this.c.r * g, this.c.g * g, this.c.b * g);
        this.color.setW(k, hit);
        const ex = sp.pos.x + this.w.x * len;
        const ey = sp.pos.y + this.w.y * len;
        const ez = sp.pos.z + this.w.z * len;
        this.ends.set([ex, ey, ez], j);
        this.cols[j] = this.c.r * lv * on;
        this.cols[j + 1] = this.c.g * lv * on;
        this.cols[j + 2] = this.c.b * lv * on;
        // a dot where it lands (just off the surface)
        this.dotPos.setXYZ(k, ex - this.w.x * 0.06, ey - this.w.y * 0.06, ez - this.w.z * 0.06);
        const dg = hit ? lv * on * dotGain * (0.85 + 0.3 * hash(this.frame * 7 + k * 3)) : 0;
        this.dotCol.setXYZ(k, this.c.r * dg, this.c.g * dg, this.c.b * dg);
      }
      // sheets between neighbouring beams (closed into a cone for the tunnel)
      for (let i = 0; i < B; i++) {
        const a = k0 + i;
        const nb = k0 + ((i + 1) % B);
        const live = sheetAmt > 0.001 && (i < B - 1 || this.look === 'tunnel');
        const o = a * 9;
        this.sheetPos.array.set([sp.pos.x, sp.pos.y, sp.pos.z, this.ends[a * 3], this.ends[a * 3 + 1], this.ends[a * 3 + 2], this.ends[nb * 3], this.ends[nb * 3 + 1], this.ends[nb * 3 + 2]], o);
        const ca = this.cols;
        const f = live ? sheetAmt / Math.max(1e-3, level) : 0;
        // brightest near the projector, where the light is concentrated
        const r0 = (ca[a * 3] + ca[nb * 3]) * 0.6 * f;
        const g0 = (ca[a * 3 + 1] + ca[nb * 3 + 1]) * 0.6 * f;
        const b0 = (ca[a * 3 + 2] + ca[nb * 3 + 2]) * 0.6 * f;
        (this.sheetCol.array as Float32Array).set([r0, g0, b0, ca[a * 3] * f, ca[a * 3 + 1] * f, ca[a * 3 + 2] * f, ca[nb * 3] * f, ca[nb * 3 + 1] * f, ca[nb * 3 + 2] * f], o);
      }
      // the aperture glows, and flares when the projector points at the camera
      const mid = k0 + (B >> 1);
      this.w.set(this.cur[mid * 3], this.cur[mid * 3 + 1], this.cur[mid * 3 + 2]);
      const toCam = this.v.copy(this.cam).sub(sp.pos);
      const dist = toCam.length();
      // a small star, not a sun: the lens pass adds the streaks
      const glint = camera && dist > 1 ? Math.pow(Math.max(0, this.w.dot(toCam.divideScalar(dist))), 60) : 0;
      const sc = 1 + glint * 1.2;
      this.m4.makeScale(sc, sc, sc).setPosition(sp.pos);
      this.apertures.setMatrixAt(p, this.m4);
      this.apertures.setColorAt(p, this.c.copy(this.cA).multiplyScalar(level * this.part[p] * (0.6 + glint * 1.6)));
    });
    this.sheetMat.uniforms.uT.value = s.t;
    for (const a of [this.origin, this.dir, this.color, this.len, this.sheetPos, this.sheetCol, this.dotPos, this.dotCol]) a.needsUpdate = true;
    this.apertures.instanceMatrix.needsUpdate = true;
    this.apertures.instanceColor!.needsUpdate = true;
  }
}
