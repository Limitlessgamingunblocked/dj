/*
 * Landmarks in the distance for the open-air venues: things on the horizon
 * that move, so the world goes on past the crowd. A fairground wheel turning
 * beyond the festival field, hot-air balloons over the sunrise valley, birds
 * at dawn and gulls over the sea, a lighthouse sweeping the bay with the
 * lights of a town along the far shore, aircraft crossing the sky.
 *
 * Each is a handful of draw calls at most; their lights move smoothly (well
 * under three changes a second) and slow down further with reduce flashing.
 */
import * as THREE from 'three';
import type { Dresser } from './dress';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { rng, softDotTexture } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Let a material through the venue's haze more than the rest: its fog is
 * scaled by `k`. Things a few hundred metres off are what the haze is for,
 * but at full strength it greys a balloon or a lit wheel out completely.
 */
export function thinFog<T extends THREE.Material>(m: T, k: number): T {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment.replace('fogColor, fogFactor )', `fogColor, fogFactor * ${k.toFixed(3)} )`));
  };
  m.customProgramCacheKey = () => `thinfog:${k}`;
  return m;
}

/* ------------------------------------------------------------------ */
/* the big wheel                                                        */
/* ------------------------------------------------------------------ */

/** fairground bulb colours: the wheel cycles through these, not the stage's palette */
const FAIR = ['#ff3b5c', '#ffb02e', '#ffe14a', '#3be37a', '#2ec4ff', '#b35cff'].map((c) => new THREE.Color(c));

/**
 * The bulb pattern on the wheel: how lit a bulb is (0..1) and which colour
 * (an index into FAIR, fractional to blend), for a bulb at `ang` round the
 * wheel and `rad` out from the hub (0..1), at time t. Three patterns take
 * turns, crossfading: a rainbow rolling round the rim, pulses running out
 * along the spokes, and alternate spokes trading places. A bulb's brightness
 * changes at most `maxHz` times a second.
 */
export function wheelBulb(pattern: number, ang: number, rad: number, t: number, maxHz: number): { lit: number; hue: number } {
  const w = Math.PI * 2 * maxHz;
  switch (pattern % 3) {
    case 0:
      return { lit: 0.75 + 0.25 * Math.sin(ang * 3 - t * w * 0.5), hue: ((ang / (Math.PI * 2)) * FAIR.length + t * 0.4) % FAIR.length };
    case 1:
      return { lit: 0.35 + 0.65 * Math.max(0, Math.sin(rad * 5 - t * w)), hue: (Math.floor(t * 0.1) * 2 + rad * 2) % FAIR.length };
    default: {
      const spoke = Math.round((ang / (Math.PI * 2)) * 16);
      return { lit: 0.5 + 0.5 * Math.sin(t * w * 0.6 + (spoke % 2) * Math.PI), hue: (spoke % 2) * 3 + 1 };
    }
  }
}

/**
 * A travelling big wheel: two rims on spokes round a hub, on A-frame legs,
 * with gondolas that hang level as it turns and bulbs down every spoke and
 * round the rim. Its plane faces `yaw` (0: the wheel's face looks down +Z).
 * The legs, the platform and the pay booth go into the venue's dresser `d`.
 */
export class FerrisWheel implements Fixture {
  readonly object = new THREE.Group();
  private wheel = new THREE.Group();
  private cars: THREE.InstancedMesh;
  private carMat: THREE.MeshStandardMaterial;
  private steel: THREE.MeshStandardMaterial;
  private col: THREE.BufferAttribute;
  /** per bulb: its angle round the wheel and its distance out (0..1) */
  private bulbs: { ang: number; rad: number }[] = [];
  private per: number;
  private n: number;
  private r: number;
  private hub: number;
  private t = 0;
  private dummy = new THREE.Object3D();
  private c = new THREE.Color();
  private c2 = new THREE.Color();
  private night: () => number;

  constructor(pos: THREE.Vector3, yaw: number, o: { radius: number; spokes?: number; night: () => number; d: Dresser }) {
    const n = (this.n = o.spokes ?? 16);
    const R = (this.r = o.radius);
    // high enough that a car at the bottom clears the loading platform
    const H = (this.hub = R + 4.2);
    this.night = o.night;
    this.object.position.copy(pos);
    this.object.rotation.y = yaw;
    this.wheel.position.y = H;
    this.object.add(this.wheel);

    // the turning part: rims, spokes, cross-bracing, the hub (white steel)
    const frame: THREE.BufferGeometry[] = [];
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const len = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
      const m = a.clone().add(b).multiplyScalar(0.5);
      frame.push(g.translate(m.x, m.y, m.z).toNonIndexed());
    };
    for (const z of [-1.3, 1.3]) {
      frame.push(new THREE.TorusGeometry(R, 0.16, 5, 96).translate(0, 0, z).toNonIndexed());
      frame.push(new THREE.TorusGeometry(R * 0.86, 0.1, 4, 96).translate(0, 0, z).toNonIndexed());
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const at = (r: number, z: number) => V(Math.cos(a) * r, Math.sin(a) * r, z);
      for (const z of [-1.3, 1.3]) rod(at(1.0, z * 0.7), at(R, z), 0.12);
      rod(at(R, -1.3), at(R, 1.3), 0.08);
      // a diagonal between this spoke and the next, inside the rims
      const b = ((i + 1) / n) * Math.PI * 2;
      for (const z of [-1.3, 1.3]) rod(at(R * 0.86, z), V(Math.cos(b) * R, Math.sin(b) * R, z), 0.06);
    }
    frame.push(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 16).rotateX(Math.PI / 2).toNonIndexed());
    frame.push(new THREE.CylinderGeometry(0.35, 0.35, 4.4, 10).rotateX(Math.PI / 2).toNonIndexed());
    for (const g of frame) if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // painted steel, a little grey so the bulbs stand out against it at night
    this.steel = thinFog(new THREE.MeshStandardMaterial({ color: 0xa8a6a0, roughness: 0.6, metalness: 0.3 }), 0.6);
    this.wheel.add(new THREE.Mesh(mergeAll(frame), this.steel));

    // bulbs: down both faces of every spoke and round both rims, one mesh whose colours change
    const bulb = new THREE.OctahedronGeometry(0.28, 0).toNonIndexed();
    this.per = bulb.attributes.position.count;
    const parts: THREE.BufferGeometry[] = [];
    for (const z of [-1.42, 1.42]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        for (let k = 1; k <= 8; k++) {
          const rad = k / 8;
          parts.push(bulb.clone().translate(Math.cos(a) * R * rad, Math.sin(a) * R * rad, z));
          this.bulbs.push({ ang: a, rad });
        }
      }
      for (let i = 0; i < n * 4; i++) {
        const a = ((i + 0.5) / (n * 4)) * Math.PI * 2;
        parts.push(bulb.clone().translate(Math.cos(a) * (R + 0.3), Math.sin(a) * (R + 0.3), z));
        this.bulbs.push({ ang: a, rad: 1.05 });
      }
    }
    const lights = mergeAll(parts);
    this.col = new THREE.BufferAttribute(new Float32Array(lights.attributes.position.count * 3), 3);
    this.col.setUsage(THREE.DynamicDrawUsage);
    lights.setAttribute('color', this.col);
    this.wheel.add(new THREE.Mesh(lights, thinFog(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 0.4)));

    // the gondolas: an open car with a canopy, hung from a bar
    const car: THREE.BufferGeometry[] = [
      new THREE.BoxGeometry(1.7, 0.9, 1.5).translate(0, -2.3, 0),
      new THREE.CylinderGeometry(0.06, 0.06, 1.9, 5).translate(0, -1.0, 0),
      new THREE.ConeGeometry(1.25, 0.55, 6).rotateY(Math.PI / 6).translate(0, -1.15, 0),
      new THREE.CylinderGeometry(0.04, 0.04, 1.0, 4).translate(0.75, -1.85, 0.65),
      new THREE.CylinderGeometry(0.04, 0.04, 1.0, 4).translate(-0.75, -1.85, -0.65),
    ].map((g) => g.toNonIndexed());
    this.carMat = thinFog(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2, emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0 }), 0.6);
    this.cars = new THREE.InstancedMesh(mergeAll(car), this.carMat, n);
    for (let i = 0; i < n; i++) this.cars.setColorAt(i, FAIR[i % FAIR.length].clone().lerp(new THREE.Color(1, 1, 1), 0.25));
    this.cars.frustumCulled = false;
    this.object.add(this.cars);

    // the legs: an A-frame each side of the hub, braced, on a raised platform with a pay booth and steps
    const d = o.d;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const p = (x: number, y: number, z: number) => V(x, y, z).applyMatrix4(m);
    for (const z of [-2.2, 2.2]) {
      for (const s of [-1, 1]) d.rod('white', p(s * R * 0.62, 0.9, z * 2.2), p(0, H, z), 0.32, 8);
      d.rod('white', p(-R * 0.4, H * 0.36, z * 1.75), p(R * 0.4, H * 0.36, z * 1.75), 0.16, 6);
    }
    d.rod('white', p(0, H, -2.4), p(0, H, 2.4), 0.5, 10);
    d.box('grey', R * 1.5, 0.9, 11, pos.x, pos.y + 0.45, pos.z, yaw);
    const booth = p(R * 0.62 + 3, 2.2, 5.6);
    d.box('red', 3.2, 2.6, 2.2, booth.x, booth.y, booth.z, yaw);
    d.box('white', 3.4, 0.2, 2.4, booth.x, booth.y + 1.4, booth.z, yaw);
    d.steps(p(0, 0, 6.7), yaw + Math.PI, 3, 3.2, 0.3, 0.4, 'stone');
    const lamp = d.glow('#ffe2a8', 'breathe', 2.2);
    for (const s of [-1, 1]) {
      const at = p(s * (R * 0.75), 1.4, 5.4);
      d.put(lamp, new THREE.SphereGeometry(0.25, 8, 6).translate(at.x, at.y, at.z));
    }
  }

  /** which pattern is up, and how far through the crossfade to the next */
  private pattern(t: number): { a: number; b: number; k: number } {
    const slot = 14;
    const a = Math.floor(t / slot);
    return { a, b: a + 1, k: THREE.MathUtils.smoothstep(t % slot, slot - 2, slot) };
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const t = this.t;
    // one turn in about a minute and a half
    const turn = (t * Math.PI * 2) / 90;
    this.wheel.rotation.z = turn;
    const night = this.night();
    const maxHz = s.reduceFlash ? 0.35 : 1.2;
    // kept under about 1: brighter, the tone curve turns every colour to white
    const gain = 0.35 + 0.75 * night;
    const pat = this.pattern(t);
    const arr = this.col.array as Float32Array;
    for (let i = 0; i < this.bulbs.length; i++) {
      const b = this.bulbs[i];
      const x = wheelBulb(pat.a, b.ang, b.rad, t, maxHz);
      const y = wheelBulb(pat.b, b.ang, b.rad, t, maxHz);
      mixHue(x.hue, this.c).multiplyScalar(x.lit * (1 - pat.k));
      mixHue(y.hue, this.c2).multiplyScalar(y.lit * pat.k);
      this.c.add(this.c2).multiplyScalar(gain);
      for (let v = 0; v < this.per; v++) {
        const o = (i * this.per + v) * 3;
        arr[o] = this.c.r;
        arr[o + 1] = this.c.g;
        arr[o + 2] = this.c.b;
      }
    }
    this.col.needsUpdate = true;
    // the cars hang straight down from the rim, swinging a little
    for (let i = 0; i < this.n; i++) {
      const a = (i / this.n) * Math.PI * 2 + turn;
      this.dummy.position.set(Math.cos(a) * this.r, this.hub + Math.sin(a) * this.r, 0);
      this.dummy.rotation.set(0, 0, Math.sin(t * 0.8 + i * 1.7) * 0.05);
      this.dummy.updateMatrix();
      this.cars.setMatrixAt(i, this.dummy.matrix);
    }
    this.cars.instanceMatrix.needsUpdate = true;
    this.carMat.emissiveIntensity = 0.35 * night;
    // the venue's key light is aimed at the stage, not out here: in the dark the frame and cars fall back to silhouettes
    const dim = 0.3 + 0.7 * (1 - night);
    this.steel.color.setHex(0xa8a6a0).multiplyScalar(dim);
    this.carMat.color.setScalar(dim);
  }
}

/** FAIR at a fractional index, blended between neighbours */
function mixHue(h: number, out: THREE.Color): THREE.Color {
  const n = FAIR.length;
  const i = Math.floor(((h % n) + n) % n);
  return out.copy(FAIR[i]).lerp(FAIR[(i + 1) % n], h - Math.floor(h));
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // every part has position, normal and uv, nothing else
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/* ------------------------------------------------------------------ */
/* hot-air balloons                                                     */
/* ------------------------------------------------------------------ */

/** the envelope's outline, mouth to crown, for a balloon 1 tall */
const ENVELOPE: [number, number][] = [
  [0.09, 0], [0.12, 0.06], [0.2, 0.15], [0.3, 0.28], [0.38, 0.42], [0.42, 0.56], [0.42, 0.68], [0.39, 0.78], [0.32, 0.87], [0.22, 0.94], [0.11, 0.98], [0, 1],
];

/**
 * How hard a balloon's burner is going (0..1) at time t: bursts of a couple
 * of seconds every so often, with a soft attack and release so it glows up
 * and dies away rather than flashing.
 */
export function burner(t: number, seed: number, slow: boolean): number {
  const every = 9 + (seed % 7);
  const len = 1.6 + (seed % 3) * 0.7;
  const u = (t + seed * 3.7) % every;
  const ramp = slow ? 0.9 : 0.25;
  return THREE.MathUtils.smoothstep(u, 0, ramp) * (1 - THREE.MathUtils.smoothstep(u, len, len + ramp * 1.6));
}

/**
 * Hot-air balloons drifting on the wind: striped envelopes with a wicker
 * basket on ropes. The burners roar now and then, the flame under the mouth
 * and the envelope glowing from inside, brighter in the dark. They climb
 * as it gets light.
 */
export class Balloons implements Fixture {
  readonly object = new THREE.Group();
  private list: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; base: THREE.Vector3; speed: number; size: number; seed: number }[] = [];
  private flames: THREE.Points;
  private flamePos: THREE.BufferAttribute;
  private flameCol: THREE.BufferAttribute;
  private t = 0;

  constructor(
    spots: { pos: THREE.Vector3; size: number; colors: [string, string] }[],
    private o: { night: () => number; wind: THREE.Vector3; span: number; climb: number },
  ) {
    const r = rng(spots.length * 31 + 7);
    for (let i = 0; i < spots.length; i++) {
      const { pos, size, colors } = spots[i];
      const a = new THREE.Color(colors[0]);
      const b = new THREE.Color(colors[1]);
      const pts = ENVELOPE.map(([x, y]) => new THREE.Vector2(x, y));
      const env = new THREE.LatheGeometry(pts, 24).toNonIndexed();
      // gores in two colours, a band round the middle in the second
      const ep = env.attributes.position as THREE.BufferAttribute;
      const ec = new Float32Array(ep.count * 3);
      for (let v = 0; v < ep.count; v += 3) {
        let cx = 0;
        let cz = 0;
        let cy = 0;
        for (let k = 0; k < 3; k++) {
          cx += ep.getX(v + k);
          cy += ep.getY(v + k);
          cz += ep.getZ(v + k);
        }
        const gore = Math.floor(((Math.atan2(cx, cz) + Math.PI) / (Math.PI * 2)) * 12) % 2;
        const band = cy / 3 > 0.5 && cy / 3 < 0.62;
        const c = (gore === 0) !== band ? a : b;
        for (let k = 0; k < 3; k++) ec.set([c.r, c.g, c.b], (v + k) * 3);
      }
      env.setAttribute('color', new THREE.BufferAttribute(ec, 3));
      // the basket and the ropes up to the mouth
      const wicker = new THREE.Color('#6a4a2a');
      const rope = new THREE.Color('#2a2420');
      const rest: [THREE.BufferGeometry, THREE.Color][] = [[new THREE.BoxGeometry(0.075, 0.06, 0.075).translate(0, -0.13, 0), wicker]];
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const from = V(x * 0.033, -0.1, z * 0.033);
        const to = V(x * 0.07, 0.01, z * 0.07);
        const len = from.distanceTo(to);
        const g = new THREE.CylinderGeometry(0.0025, 0.0025, len, 3).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), to.clone().sub(from).normalize()));
        const m = from.add(to).multiplyScalar(0.5);
        rest.push([g.translate(m.x, m.y, m.z), rope]);
      }
      const geos = [env, ...rest.map(([g, c]) => {
        const n = g.toNonIndexed();
        const col = new Float32Array(n.attributes.position.count * 3);
        for (let k = 0; k < col.length; k += 3) col.set([c.r, c.g, c.b], k);
        n.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return n;
      })];
      const merged = mergeColored(geos);
      const mat = thinFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, emissive: new THREE.Color('#ff9a40'), emissiveIntensity: 0 }), 0.45);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.scale.setScalar(size);
      mesh.rotation.y = r() * Math.PI * 2;
      this.object.add(mesh);
      this.list.push({ mesh, mat, base: pos.clone(), speed: 0.8 + r() * 0.5, size, seed: 3 + i * 5 });
    }
    const fg = new THREE.BufferGeometry();
    this.flamePos = new THREE.BufferAttribute(new Float32Array(spots.length * 3), 3);
    this.flameCol = new THREE.BufferAttribute(new Float32Array(spots.length * 3), 3);
    fg.setAttribute('position', this.flamePos);
    fg.setAttribute('color', this.flameCol);
    this.flames = new THREE.Points(fg, new THREE.PointsMaterial({ size: 3.2, map: softDotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.flames.frustumCulled = false;
    this.object.add(this.flames);
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const t = this.t;
    const night = this.o.night();
    const span = this.o.span;
    this.list.forEach((b, i) => {
      // drift downwind, wrapping round out of sight; bob; climb as it gets light
      const along = b.base.x + this.o.wind.x * b.speed * t;
      const x = ((((along + span) % (2 * span)) + 2 * span) % (2 * span)) - span;
      const y = b.base.y + Math.sin(t * 0.07 + i * 2.1) * 2.5 + (1 - night) * this.o.climb * (0.6 + 0.4 * ((i * 0.37) % 1));
      const z = b.base.z + this.o.wind.z * b.speed * t * 0.2;
      b.mesh.position.set(x, y, z);
      b.mesh.rotation.y += dt * 0.03;
      const f = burner(t, b.seed, s.reduceFlash);
      // dark shapes against the night sky until a burner lights one up; full colour by day
      b.mat.color.setScalar(0.25 + 0.75 * (1 - night));
      b.mat.emissiveIntensity = f * (0.12 + 0.6 * night);
      this.flamePos.setXYZ(i, x, y - b.size * 0.02, z);
      const k = f * (0.6 + 1.6 * night);
      this.flameCol.setXYZ(i, 2.2 * k, 1.1 * k, 0.35 * k);
    });
    this.flamePos.needsUpdate = true;
    this.flameCol.needsUpdate = true;
  }
}

/** merge parts that all carry position, normal and colour (uv left off) */
function mergeColored(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of geos) if (!g.attributes.normal) g.computeVertexNormals();
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [k, n] of [['position', 3], ['normal', 3], ['color', 3]] as [string, number][]) {
    const a = new Float32Array(count * n);
    let o = 0;
    for (const g of geos) {
      a.set(g.attributes[k].array as Float32Array, o);
      o += g.attributes[k].array.length;
    }
    out.setAttribute(k, new THREE.BufferAttribute(a, n));
  }
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/* ------------------------------------------------------------------ */
/* birds                                                                */
/* ------------------------------------------------------------------ */

/**
 * A flock: wings that flap and glide, flying a slow loop round `center`
 * (a figure of eight `radius` across), loosely in formation. Fades in with
 * `visible()` (daylight for birds at dawn). One mesh rebuilt each frame.
 */
export class Birds implements Fixture {
  readonly object: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private mat: THREE.MeshBasicMaterial;
  private seat: { off: THREE.Vector3; phase: number; rate: number }[] = [];
  private t = 0;
  private c = new THREE.Vector3();
  private n = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private tmp = { p: new THREE.Vector3(), mid: new THREE.Vector3(), tip: new THREE.Vector3(), w: new THREE.Vector3() };

  constructor(private o: { count: number; center: THREE.Vector3; radius: THREE.Vector3; speed: number; size: number; color: string; seed: number; glide?: number; visible: () => number }) {
    const r = rng(o.seed);
    for (let i = 0; i < o.count; i++) {
      // a loose V behind the leader, with stragglers
      const rank = Math.ceil(i / 2);
      const s = i % 2 ? 1 : -1;
      this.seat.push({ off: V(s * rank * 1.6 + (r() - 0.5) * 2, (r() - 0.5) * 1.5, -rank * 1.4 + (r() - 0.5) * 2).multiplyScalar(o.size), phase: r() * 10, rate: 0.9 + r() * 0.3 });
    }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(o.count * 12 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    this.mat = new THREE.MeshBasicMaterial({ color: o.color, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false });
    this.object = new THREE.Mesh(g, this.mat);
    this.object.frustumCulled = false;
  }

  /** where the flock's leader is at time t */
  private leader(t: number, out: THREE.Vector3): THREE.Vector3 {
    const { center, radius, speed } = this.o;
    const w = speed / Math.max(radius.x, radius.z);
    return out.set(center.x + Math.sin(t * w) * radius.x, center.y + Math.sin(t * w * 2 + 1) * radius.y, center.z + Math.sin(t * w * 2) * radius.z * 0.5);
  }

  update(_s: ShowState, dt: number): void {
    this.t += dt;
    const t = this.t;
    const vis = this.o.visible();
    this.mat.opacity = vis;
    this.object.visible = vis > 0.01;
    if (!this.object.visible) return;
    this.leader(t, this.c);
    this.leader(t + 0.5, this.n);
    this.fwd.subVectors(this.n, this.c).normalize();
    this.side.set(-this.fwd.z, 0, this.fwd.x).normalize();
    const a = this.pos.array as Float32Array;
    const sz = this.o.size;
    const glide = this.o.glide ?? 0.3;
    const { p, mid, tip, w } = this.tmp;
    let o = 0;
    const put = (v: THREE.Vector3, along = 0) => {
      a[o++] = v.x + this.fwd.x * along;
      a[o++] = v.y + this.fwd.y * along;
      a[o++] = v.z + this.fwd.z * along;
    };
    for (const b of this.seat) {
      // the bird's place in the formation, swaying
      p.copy(this.c).addScaledVector(this.side, b.off.x + Math.sin(t * 0.6 + b.phase) * sz * 0.6).addScaledVector(this.fwd, b.off.z);
      p.y += b.off.y + Math.sin(t * 0.9 + b.phase) * sz * 0.3;
      // flap, or glide with the wings held up a touch
      const cycle = (t * 0.25 + b.phase) % 1;
      const flap = cycle < glide ? 0.25 : Math.sin((t * 6 * b.rate + b.phase) * Math.PI);
      const tipY = flap * sz * 0.45;
      for (const s of [-1, 1]) {
        mid.copy(p).addScaledVector(this.side, s * sz * 0.28);
        mid.y += tipY * 0.4;
        tip.copy(mid).addScaledVector(this.side, s * sz * 0.3).addScaledVector(this.fwd, -sz * 0.12);
        tip.y = p.y + tipY;
        // inner wing: shoulder front, shoulder back, the elbow; outer wing: the elbow, front and back, to the tip
        put(p, sz * 0.12);
        put(p, -sz * 0.14);
        put(mid);
        put(w.copy(mid), sz * 0.06);
        put(w.copy(mid), -sz * 0.08);
        put(tip);
      }
    }
    this.pos.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* the coast: headlands, a lighthouse, a town's lights                  */
/* ------------------------------------------------------------------ */

/**
 * A ridge of land along `path` (x, z points): `width` across, rising to
 * `height(t)` along its spine (t 0..1 from the first point to the last),
 * falling to `y0` either side and at both ends, lumpy. Flat-shaded and dark: it's seen from
 * a long way off, mostly against the sky.
 */
export function headland(path: THREE.Vector2[], width: number, height: (t: number) => number, o: { y0: number; seed: number; color: string }): THREE.Mesh {
  const r = rng(o.seed);
  const curve = new THREE.SplineCurve(path);
  const steps = Math.max(8, Math.round(curve.getLength() / 12));
  const across = 9;
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nx = -tan.y;
    const nz = tan.x;
    // both ends run down into the sea
    const lift = (height(t) + 2) * THREE.MathUtils.smoothstep(Math.min(t, 1 - t), 0, 0.06);
    for (let j = 0; j < across; j++) {
      const u = (j / (across - 1)) * 2 - 1;
      const w = (width / 2) * u * (0.85 + r() * 0.3);
      const y = o.y0 - 2 + lift * Math.pow(Math.max(0, 1 - u * u), 0.55) * (0.85 + r() * 0.3);
      pos.push(p.x + nx * w, y, p.y + nz * w);
    }
  }
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < across - 1; j++) {
      const a = i * across + j;
      index.push(a, a + across, a + 1, a + 1, a + across, a + across + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ color: o.color, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
}

/**
 * The lights of a town along a far shore: streets of warm points scattered
 * along `path`, `depth` deep inland, with a few hotel blocks lit floor by
 * floor. Dark buildings go into `d`; the lights are one Points object that
 * comes up with `night()`.
 */
export class TownLights implements Fixture {
  readonly object: THREE.Points;
  private mat: THREE.PointsMaterial;
  private night: () => number;

  constructor(path: THREE.Vector2[], o: { y0: number; depth: number; count: number; seed: number; night: () => number; d: Dresser; size?: number }) {
    const r = rng(o.seed);
    const curve = new THREE.SplineCurve(path);
    const pos: number[] = [];
    const col: number[] = [];
    const tones = [new THREE.Color('#ffd9a0'), new THREE.Color('#ffb15a'), new THREE.Color('#fff1dc'), new THREE.Color('#cfe3ff')];
    const light = (x: number, y: number, z: number, c: THREE.Color, k: number) => {
      pos.push(x, y, z);
      col.push(c.r * k * 1.5, c.g * k * 1.5, c.b * k * 1.5);
    };
    // hotels on the front: a block, lit windows up its face
    const len = curve.getLength();
    for (let s = 20; s < len - 20; s += 28 + r() * 40) {
      const t = s / len;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const yaw = Math.atan2(-tan.y, tan.x);
      const h = 10 + Math.pow(r(), 1.5) * 34;
      const w = 14 + r() * 16;
      const back = 6 + r() * 6;
      const nx = -tan.y;
      const nz = tan.x;
      const cx = p.x + nx * back;
      const cz = p.y + nz * back;
      o.d.box('grey', w, h, 10, cx, o.y0 + h / 2, cz, yaw);
      // windows on the face towards the water (the side the path's normal points away from)
      const floors = Math.floor(h / 3.2);
      const cols = Math.floor(w / 3.4);
      for (let f = 0; f < floors; f++)
        for (let c = 0; c < cols; c++) {
          if (r() > 0.55) continue;
          const along = (c / Math.max(1, cols - 1) - 0.5) * (w - 2);
          light(cx + tan.x * along - nx * 5.2, o.y0 + 2 + f * 3.2, cz + tan.y * along - nz * 5.2, tones[r() < 0.8 ? 0 : 2], 0.7 + r() * 0.5);
        }
    }
    // the streets behind: points in rows, thinning inland; the promenade's lamps along the front
    for (let i = 0; i < o.count; i++) {
      const t = r();
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const back = Math.pow(r(), 1.8) * o.depth + 4;
      light(p.x - tan.y * back + (r() - 0.5) * 3, o.y0 + 1 + r() * 6 + back * 0.04, p.y + tan.x * back + (r() - 0.5) * 3, tones[Math.floor(r() * tones.length)], 0.5 + r() * 0.8);
    }
    for (let s = 0; s < len; s += 9) {
      const p = curve.getPointAt(s / len);
      light(p.x, o.y0 + 4, p.y, tones[1], 1.4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.mat = new THREE.PointsMaterial({ size: o.size ?? 1.1, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false, map: softDotTexture(), blending: THREE.AdditiveBlending });
    this.object = new THREE.Points(g, this.mat);
    this.night = o.night;
  }

  update(): void {
    // lights come on through the dusk
    this.mat.opacity = THREE.MathUtils.smoothstep(this.night(), 0.05, 0.6);
  }
}

/**
 * A lighthouse on a headland: a banded tower with a gallery and a lantern,
 * a keeper's cottage. After dark the lamp turns: two beams sweep the bay, and
 * the lantern blazes as a beam swings past you (once every few seconds, far
 * under the flash limit). The masonry goes into `d`.
 */
export class Lighthouse implements Fixture {
  readonly object = new THREE.Group();
  private beams = new THREE.Group();
  private beamMat: THREE.MeshBasicMaterial;
  private lens: THREE.MeshBasicMaterial;
  private glare: THREE.Sprite;
  private t = 0;
  private dir = new THREE.Vector3();
  private to = new THREE.Vector3();
  private top: THREE.Vector3;
  private night: () => number;
  private period: number;

  constructor(pos: THREE.Vector3, o: { height: number; night: () => number; d: Dresser; period?: number; reach?: number }) {
    const d = o.d;
    const h = o.height;
    this.night = o.night;
    this.period = o.period ?? 12;
    // the tower: tapering, in white and red bands
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const y0 = (i / bands) * h;
      const y1 = ((i + 1) / bands) * h;
      const r0 = THREE.MathUtils.lerp(h * 0.12, h * 0.075, i / bands);
      const r1 = THREE.MathUtils.lerp(h * 0.12, h * 0.075, (i + 1) / bands);
      d.put(i % 2 ? 'red' : 'white', new THREE.CylinderGeometry(r1, r0, y1 - y0, 16).translate(pos.x, pos.y + (y0 + y1) / 2, pos.z));
    }
    const gy = pos.y + h;
    d.put('blackMetal', new THREE.CylinderGeometry(h * 0.11, h * 0.09, h * 0.03, 16).translate(pos.x, gy, pos.z));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      d.rod('blackMetal', V(pos.x + Math.cos(a) * h * 0.105, gy, pos.z + Math.sin(a) * h * 0.105), V(pos.x + Math.cos(a) * h * 0.105, gy + h * 0.035, pos.z + Math.sin(a) * h * 0.105), h * 0.002, 3);
    }
    d.put('blackMetal', new THREE.TorusGeometry(h * 0.105, h * 0.0025, 3, 24).rotateX(Math.PI / 2).translate(pos.x, gy + h * 0.035, pos.z));
    d.put('red', new THREE.ConeGeometry(h * 0.07, h * 0.06, 16).translate(pos.x, gy + h * 0.12, pos.z));
    d.put('blackMetal', new THREE.SphereGeometry(h * 0.012, 8, 6).translate(pos.x, gy + h * 0.155, pos.z));
    // the cottage at its foot
    d.box('white', h * 0.35, h * 0.12, h * 0.2, pos.x + h * 0.28, pos.y + h * 0.06, pos.z, 0.4);
    d.box('darkWood', h * 0.37, h * 0.02, h * 0.23, pos.x + h * 0.28, pos.y + h * 0.13, pos.z, 0.4);

    // the lantern: glass that's lit, the beams, the glare
    this.lens = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2cc'), toneMapped: false });
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.06, h * 0.06, h * 0.07, 12), this.lens);
    this.top = V(pos.x, gy + h * 0.055, pos.z);
    lantern.position.copy(this.top);
    this.object.add(lantern);
    const reach = o.reach ?? 220;
    const beam = new THREE.CylinderGeometry(reach * 0.06, h * 0.03, reach, 16, 6, true);
    // bright at the lamp, gone at the far end
    const bp = beam.attributes.position as THREE.BufferAttribute;
    const bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      const k = Math.pow(1 - (bp.getY(i) / reach + 0.5), 2.2);
      bc.set([k, k * 0.95, k * 0.8], i * 3);
    }
    beam.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    beam.translate(0, reach / 2, 0).rotateZ(-Math.PI / 2);
    const both = mergeColored([beam.toNonIndexed(), beam.clone().rotateY(Math.PI).toNonIndexed()]);
    beam.dispose();
    this.beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false, opacity: 0 });
    this.beams.add(new THREE.Mesh(both, this.beamMat));
    this.beams.position.copy(this.top);
    this.object.add(this.beams);
    this.glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: new THREE.Color('#fff0c8'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, opacity: 0 }));
    this.glare.position.copy(this.top);
    this.object.add(this.glare);
  }

  update(_s: ShowState, dt: number, camera: THREE.Camera): void {
    this.t += dt;
    const night = THREE.MathUtils.smoothstep(this.night(), 0.15, 0.7);
    const a = (this.t / this.period) * Math.PI * 2;
    this.beams.rotation.y = a;
    this.beamMat.opacity = night * 0.32;
    this.lens.color.setRGB(1, 0.95, 0.8).multiplyScalar(0.6 + 2.2 * night);
    // how straight a beam points at the camera
    this.to.subVectors(camera.position, this.top).setY(0).normalize();
    this.dir.set(Math.cos(a), 0, -Math.sin(a));
    const facing = Math.pow(Math.abs(this.dir.dot(this.to)), 40);
    const dist = camera.position.distanceTo(this.top);
    this.glare.scale.setScalar(dist * (0.008 + 0.05 * facing));
    (this.glare.material as THREE.SpriteMaterial).opacity = night * (0.35 + 0.9 * facing);
  }
}

/* ------------------------------------------------------------------ */
/* aircraft                                                             */
/* ------------------------------------------------------------------ */

/**
 * An airliner crossing the sky from `from` to `to`, every `period` seconds:
 * a dark shape by day, by night its navigation lights (red port, green
 * starboard, a white tail light) and a strobe once a second or so.
 */
export class Aircraft implements Fixture {
  readonly object = new THREE.Group();
  private body: THREE.Mesh;
  private lights: THREE.Points;
  private col: THREE.BufferAttribute;
  private t: number;
  private dir: THREE.Vector3;
  private ahead = new THREE.Vector3();

  constructor(private o: { from: THREE.Vector3; to: THREE.Vector3; period: number; offset?: number; night: () => number; scale?: number }) {
    this.t = o.offset ?? 0;
    this.dir = o.to.clone().sub(o.from).normalize();
    const s = o.scale ?? 1;
    const parts = [
      new THREE.CylinderGeometry(2 * s, 1.6 * s, 38 * s, 8).rotateX(Math.PI / 2),
      new THREE.BoxGeometry(36 * s, 0.6 * s, 6 * s).translate(0, -0.5 * s, 1 * s),
      new THREE.BoxGeometry(12 * s, 0.4 * s, 3.4 * s).translate(0, 0.6 * s, -17 * s),
      new THREE.BoxGeometry(0.4 * s, 6 * s, 4 * s).translate(0, 3.5 * s, -17 * s),
    ].map((g) => g.toNonIndexed());
    for (const g of parts) g.deleteAttribute('uv');
    this.body = new THREE.Mesh(mergeColored(parts.map((g) => withColor(g, '#3a3e46'))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }));
    this.object.add(this.body);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-18 * s, 0, 1 * s, 18 * s, 0, 1 * s, 0, 0.8 * s, -19 * s, 0, -2 * s, 0], 3));
    this.col = new THREE.BufferAttribute(new Float32Array(12), 3);
    g.setAttribute('color', this.col);
    this.lights = new THREE.Points(g, new THREE.PointsMaterial({ size: 5 * s, map: softDotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.lights.frustumCulled = false;
    this.body.add(this.lights);
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const k = (this.t % this.o.period) / this.o.period;
    this.body.position.lerpVectors(this.o.from, this.o.to, k);
    this.body.lookAt(this.ahead.copy(this.body.position).add(this.dir));
    const night = this.o.night();
    const n = 0.3 + 0.7 * night;
    // the strobe: a short pulse every 1.3 s (under one a second with reduce flashing)
    const every = s.reduceFlash ? 2.2 : 1.3;
    const strobe = (this.t % every) < 0.09 ? 3 : 0;
    const set = (i: number, r: number, g: number, b: number) => this.col.setXYZ(i, r * n, g * n, b * n);
    // flying towards +Z the port wing is +X: red there, green on the starboard tip
    set(0, 0.1 + strobe, 2.4 + strobe, 0.3 + strobe);
    set(1, 2.4 + strobe, 0.1 + strobe, 0.05 + strobe);
    set(2, 1.6, 1.6, 1.6);
    set(3, Math.sin(this.t * Math.PI) > 0.4 ? 2.6 : 0.2, 0.05, 0.02);
    this.col.needsUpdate = true;
  }
}

function withColor(g: THREE.BufferGeometry, c: string): THREE.BufferGeometry {
  const col = new THREE.Color(c);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([col.r, col.g, col.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
