/*
 * Show fixtures shared by the venues. Everything is instanced so a venue can
 * hang dozens of lights for a handful of draw calls:
 *   MovingHeads  beam fixtures with volumetric cones (pan/tilt patterns)
 *   Lasers       projectors emitting fans, tunnels, sheets and chases
 *   Strobes, Blinders, Globes (pendant lamps), LedStrings (dotted light lines)
 *   Co2Jets      CO2 cannon plumes, HazeLayer (drifting haze in the light)
 *   Crowd        (crowd.ts) jointed dancers, sign holders, VIP guests
 * plus scenery helpers (truss, speakers, booth, mirror ball).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fxTier } from '../fx';
import { HAZE_GLSL } from './atmos';
import { BEAM_FRAG, BEAM_VERT, GOBO_GLSL, goboFor, prismFacets } from './beams';
import { LIGHTMAP_GLSL, type LightMap } from './lightmap';
import type { ShowState } from './show';
import { grilleTexture, mirrorBallTexture, rng, smokeTexture, trussTexture } from './tex';

export const TABLE_Y = 0.9;

export interface Fixture {
  readonly object: THREE.Object3D;
  update(s: ShowState, dt: number, camera: THREE.Camera): void;
  /** free anything the venue's generic disposal can't see (shared buffers, side geometries) */
  dispose?(): void;
}

const WHITE = new THREE.Color(1, 1, 1);

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Laser/LED colours are pure: normalise to full saturation and boost. */
function hdr(c: THREE.Color, gain: number, out: THREE.Color): THREE.Color {
  const m = Math.max(c.r, c.g, c.b, 1e-3);
  return out.setRGB((c.r / m) * gain, (c.g / m) * gain, (c.b / m) * gain);
}

/* ------------------------------------------------------------------ */
/* moving heads                                                         */
/* ------------------------------------------------------------------ */

// the beams' volume shader (ray / cone, gobo, scattering) lives in beams.ts
const POOL_VERT = /* glsl */ `
  attribute vec2 aGobo;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec2 vGobo;
  void main() {
    vUv = uv;
    vColor = instanceColor;
    vGobo = aGobo;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const POOL_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec2 vGobo;
  ${GOBO_GLSL}
  void main() {
    vec2 d = vUv - 0.5;
    float rr = length(d) * 2.0;
    if (rr > 1.0) discard;
    // the gobo the beam carries, projected where it lands, with a soft edge
    float g = goboAt(vGobo.x, atan(d.y, d.x) + vGobo.y, rr);
    float disc = 1.0 - smoothstep(0.55, 1.0, rr);
    gl_FragColor = vec4(vColor * disc * (0.25 + 0.75 * g), 1.0);
  }`;

export interface HeadSpec {
  pos: THREE.Vector3;
  /** stands on the floor and points up (default hangs and points down) */
  up?: boolean;
  /** heading of "forward" (positive tilt): 0 = towards the room (−Z) */
  yaw?: number;
}

export class MovingHeads implements Fixture {
  readonly object = new THREE.Group();
  private beams: THREE.InstancedMesh;
  /** per beam instance: gobo id, gobo rotation */
  private goboAttr: THREE.InstancedBufferAttribute;
  private poolGobo: THREE.InstancedBufferAttribute | null = null;
  private sub = new THREE.Quaternion();
  private tiltQ = new THREE.Quaternion();
  private xAxis = new THREE.Vector3(1, 0, 0);
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private heads: THREE.InstancedMesh;
  private lenses: THREE.InstancedMesh;
  private home: THREE.Quaternion[] = [];
  private pan: number[] = [];
  private tilt: number[] = [];
  private beamMat: THREE.ShaderMaterial;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private c = new THREE.Color();
  private one = new THREE.Vector3(1, 1, 1);
  private gain: number;
  /** pools of light where the beams hit the floor */
  private pools: THREE.InstancedMesh | null = null;
  /** the venue's floor light map: pools are painted into it too */
  lightMap: LightMap | null = null;
  private floorY = 0;
  private len: number;
  private rad: number;
  private dir = new THREE.Vector3();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private yq = new THREE.Quaternion();
  private down = new THREE.Vector3(0, -1, 0);
  private yAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private specs: HeadSpec[],
    o: { length?: number; radius?: number; gain?: number; body?: number; floorY?: number; haze?: [number, number] } = {},
  ) {
    const n = specs.length;
    const len = o.length ?? 12;
    const rad = o.radius ?? 0.9;
    this.len = len;
    this.rad = rad;
    this.gain = o.gain ?? 1.2;
    // a little wider than the analytic cone so the mesh always encloses it
    const beamGeo = new THREE.CylinderGeometry(0.05 * 1.01, rad * 1.01, len, 28, 1, true);
    beamGeo.translate(0, -len / 2 - 0.16, 0);
    // three instances per head: the beam, and two more for the prism's facets
    this.goboAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3 * 2), 2);
    this.goboAttr.setUsage(THREE.DynamicDrawUsage);
    beamGeo.setAttribute('aGobo', this.goboAttr);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHaze: { value: 1 },
        uSmoke: { value: 0.5 },
        uDust: { value: 1 },
        uBand: { value: new THREE.Vector2(...(o.haze ?? [-100, 100])) },
        uLen: { value: len },
        uR0: { value: 0.05 },
        uR1: { value: rad },
        uLensY: { value: -0.16 },
        uSteps: { value: 5 },
        uGain: { value: 16 },
      },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG(HAZE_GLSL),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beams = new THREE.InstancedMesh(beamGeo, this.beamMat, n * 3);
    this.beams.frustumCulled = false;
    const headGeo = mergeGeometries([new THREE.CylinderGeometry(0.12, 0.14, 0.3, 14).translate(0, -0.02, 0), new THREE.BoxGeometry(0.34, 0.06, 0.1).translate(0, 0.16, 0)]);
    this.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: o.body ?? 0x15161a, roughness: 0.45, metalness: 0.6 }), n);
    this.lenses = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 18).rotateX(Math.PI / 2).translate(0, -0.172, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
    const base = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: o.body ?? 0x15161a, roughness: 0.5, metalness: 0.5 }), n);
    specs.forEach((sp, i) => {
      const yaw = sp.yaw ?? 0;
      const home = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      if (sp.up) home.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
      this.home.push(home);
      this.pan.push(0);
      this.tilt.push(0.4);
      this.m4.makeTranslation(sp.pos.x, sp.pos.y + (sp.up ? -0.2 : 0.22), sp.pos.z);
      base.setMatrixAt(i, this.m4);
      for (let f = 0; f < 3; f++) this.beams.setColorAt(i + f * n, this.c.setRGB(0, 0, 0));
      this.lenses.setColorAt(i, this.c);
    });
    this.object.add(base, this.heads, this.lenses, this.beams);
    if (o.floorY !== undefined) {
      this.floorY = o.floorY + 0.012;
      // the gobo lands on the floor with the light
      const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      this.poolGobo = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      this.poolGobo.setUsage(THREE.DynamicDrawUsage);
      poolGeo.setAttribute('aGobo', this.poolGobo);
      const mat = new THREE.ShaderMaterial({ vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      this.pools = new THREE.InstancedMesh(poolGeo, mat, n);
      this.pools.frustumCulled = false;
      for (let i = 0; i < n; i++) this.pools.setColorAt(i, this.c.setRGB(0, 0, 0));
      this.object.add(this.pools);
    }
  }

  update(s: ShowState, dt: number): void {
    const n = this.specs.length;
    const b = s.beat;
    const t = s.t;
    const k = Math.min(1, dt * (s.moverPattern === 4 ? 9 : 5));
    this.beamMat.uniforms.uTime.value = t;
    this.beamMat.uniforms.uSmoke.value = s.smoke;
    this.beamMat.uniforms.uHaze.value = 1.05;
    const tier = fxTier();
    this.beamMat.uniforms.uDust.value = tier === 'low' ? 0 : 1;
    // steps through each beam: one on low (no wisps), four on medium, seven on high
    this.beamMat.uniforms.uSteps.value = tier === 'low' ? 1 : tier === 'medium' ? 4 : 7;
    // an energy budget: a big rig's beams each run lower, so thirty of them don't add up to a white frame
    this.beamMat.uniforms.uGain.value = 8 * (this.gain / 1.2) * Math.min(1, Math.sqrt(12 / n));
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) - 0.5 : 0;
      let pan = 0;
      let tilt = 0.5;
      switch (s.moverPattern) {
        case 0:
          pan = Math.sin((b * Math.PI) / 8 + i * 0.7) * 0.7;
          tilt = 0.55 + Math.sin((b * Math.PI) / 4 + i) * 0.22;
          break;
        case 1:
          pan = u * 1.4 * (0.55 + 0.45 * Math.sin((b * Math.PI) / 8));
          tilt = 0.5 + 0.12 * Math.sin((b * Math.PI) / 2);
          break;
        case 2:
          pan = i % 2 ? 0.38 : -0.38;
          tilt = (Math.floor(b) + i) % 2 ? 0.22 : 0.78;
          break;
        case 3:
          pan = Math.sin((b * Math.PI) / 2 + i * 0.9) * 0.45;
          tilt = 0.5 + Math.cos((b * Math.PI) / 2 + i * 0.9) * 0.3;
          break;
        case 4:
          pan = Math.sin(t * 2.1 + i * 1.3) * 0.95;
          tilt = 0.55 + Math.sin(t * 3.3 + i) * 0.38;
          break;
        default:
          pan = Math.sin(t * 0.3 + i) * 0.15;
          tilt = 0.1 + 0.08 * Math.sin(t * 0.5 + i);
      }
      this.pan[i] += (pan - this.pan[i]) * k;
      this.tilt[i] += (tilt - this.tilt[i]) * k;
      this.e.set(this.tilt[i], this.pan[i], 0);
      this.q.setFromEuler(this.e).premultiply(this.home[i]);
      this.m4.compose(this.specs[i].pos, this.q, this.one);
      this.heads.setMatrixAt(i, this.m4);
      // gobo and prism from the music
      const gp = goboFor(s, i);
      if (gp.prism) {
        prismFacets(gp.spin * 0.3).forEach(([turn, tilt], f) => {
          // turn about the beam's own axis (local −Y), then tip off it
          this.sub.setFromAxisAngle(this.yAxis, turn).multiply(this.tiltQ.setFromAxisAngle(this.xAxis, tilt));
          this.yq.copy(this.q).multiply(this.sub);
          this.m4.compose(this.specs[i].pos, this.yq, this.one);
          this.beams.setMatrixAt(i + f * n, this.m4);
          this.goboAttr.setXY(i + f * n, gp.gobo, gp.spin);
        });
        this.m4.compose(this.specs[i].pos, this.q, this.one);
      } else {
        this.beams.setMatrixAt(i, this.m4);
        this.beams.setMatrixAt(i + n, this.zero);
        this.beams.setMatrixAt(i + 2 * n, this.zero);
        this.goboAttr.setXY(i, gp.gobo, gp.spin);
      }
      this.lenses.setMatrixAt(i, this.m4);
      let level = s.movers * s.master * s.intensity;
      if (s.moverPattern === 2) level *= (Math.floor(b) + i) % 2 ? 1 : 0.35;
      level *= 0.7 + s.kick * 0.5 * (0.4 + s.peak);
      const col = s.colors[(i + (s.moverPattern === 4 ? Math.floor(b) : 0)) % 3 === 2 ? 2 : (i + (s.peak > 0.5 ? Math.floor(b) : 0)) % 2];
      // through the prism the light is shared by three beams
      const share = gp.prism ? 0.42 : 1;
      this.c.copy(col).multiplyScalar(level * this.gain * share);
      this.beams.setColorAt(i, this.c);
      this.beams.setColorAt(i + n, gp.prism ? this.c : this.c.setRGB(0, 0, 0));
      this.beams.setColorAt(i + 2 * n, gp.prism ? this.c.copy(col).multiplyScalar(level * this.gain * share) : this.c.setRGB(0, 0, 0));
      this.poolGobo?.setXY(i, gp.prism ? 0 : gp.gobo, gp.spin);
      this.lenses.setColorAt(i, this.c.copy(col).multiplyScalar(0.3 + level * 4));
      if (this.pools) {
        const pos = this.specs[i].pos;
        const dir = this.dir.copy(this.down).applyQuaternion(this.q);
        const t = dir.y < -0.08 ? (this.floorY - pos.y) / dir.y : -1;
        if (t > 0 && t < this.len * 1.05) {
          const r = 0.05 + (this.rad - 0.05) * Math.min(1, t / this.len);
          const stretch = Math.min(3, 1 / -dir.y);
          this.yq.setFromAxisAngle(this.yAxis, Math.atan2(dir.x, dir.z));
          this.p.copy(pos).addScaledVector(dir, t);
          this.p.y = this.floorY;
          this.m4.compose(this.p, this.yq, this.s.set(r * 2.4, 1, r * 2.4 * stretch));
          const pk = level * 0.55 * (1 - 0.5 * Math.min(1, t / this.len));
          this.pools.setColorAt(i, this.c.copy(col).multiplyScalar(pk));
          // and onto the light map, so the people standing there are lit
          this.lightMap?.splat(this.p.x, this.p.z, r * 1.25, r * 1.25 * stretch, col, pk * 1.6, -Math.atan2(dir.x, dir.z));
        } else {
          this.m4.makeScale(0, 0, 0);
          this.pools.setColorAt(i, this.c.setRGB(0, 0, 0));
        }
        this.pools.setMatrixAt(i, this.m4);
      }
    }
    if (this.pools) {
      this.pools.instanceMatrix.needsUpdate = true;
      this.pools.instanceColor!.needsUpdate = true;
      this.poolGobo!.needsUpdate = true;
    }
    this.goboAttr.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
    this.lenses.instanceMatrix.needsUpdate = true;
    this.beams.instanceColor!.needsUpdate = true;
    this.lenses.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* strobes, blinders                                                    */
/* ------------------------------------------------------------------ */

export class Strobes implements Fixture {
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private c = new THREE.Color();

  constructor(
    private spots: { pos: THREE.Vector3; yaw?: number; tilt?: number }[],
    size: [number, number, number] = [0.55, 0.16, 0.08],
  ) {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m4.makeRotationFromEuler(new THREE.Euler(s.tilt ?? 0, s.yaw ?? 0, 0, 'YXZ')).setPosition(s.pos);
      this.mesh.setMatrixAt(i, m4);
      this.mesh.setColorAt(i, this.c.setRGB(0.05, 0.05, 0.05));
    });
    this.object.add(this.mesh);
  }

  update(s: ShowState): void {
    const v = 0.04 + s.strobe * s.master * 9;
    for (let i = 0; i < this.spots.length; i++) this.mesh.setColorAt(i, this.c.setRGB(v, v, v * 1.05));
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

export class Blinders implements Fixture {
  readonly object = new THREE.Group();
  private lamps: THREE.InstancedMesh;
  private c = new THREE.Color();
  private n: number;

  /** each spot is a 2-lamp blinder facing `yaw` (0 = facing −Z, the room) */
  constructor(spots: { pos: THREE.Vector3; yaw?: number; tilt?: number }[]) {
    this.n = spots.length * 2;
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.26, 0.14), new THREE.MeshStandardMaterial({ color: 0x131417, roughness: 0.5, metalness: 0.5 }), spots.length);
    this.lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.1, 20).rotateY(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.n);
    const m4 = new THREE.Matrix4();
    const off = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m4.makeRotationFromEuler(new THREE.Euler(s.tilt ?? 0, s.yaw ?? 0, 0, 'YXZ')).setPosition(s.pos);
      body.setMatrixAt(i, m4);
      for (let j = 0; j < 2; j++) {
        off.makeTranslation(j ? 0.12 : -0.12, 0, -0.072);
        this.lamps.setMatrixAt(i * 2 + j, m4.clone().multiply(off));
        this.lamps.setColorAt(i * 2 + j, this.c.setRGB(0.05, 0.03, 0.01));
      }
    });
    this.object.add(body, this.lamps);
  }

  update(s: ShowState): void {
    const v = 0.03 + s.blinder * s.master * 5;
    for (let i = 0; i < this.n; i++) this.lamps.setColorAt(i, this.c.setRGB(v, v * 0.62, v * 0.28));
    this.lamps.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* dotted LED strings                                                   */
/* ------------------------------------------------------------------ */

export class LedStrings implements Fixture {
  readonly object: THREE.Points;
  private u = {
    uBeat: { value: 0 },
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uMaster: { value: 1 },
    uSize: { value: 0.09 },
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
    uWarm: { value: 0 },
  };
  private pos: number[] = [];
  private at: number[] = [];
  private sid: number[] = [];
  private strings = 0;

  constructor(
    private o: { size?: number; warm?: string | null; spacing?: number } = {},
  ) {
    this.object = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: /* glsl */ `
          attribute float aT;
          attribute float aS;
          uniform float uBeat, uTime, uLevel, uMaster, uSize, uWarm;
          uniform vec3 uA, uB;
          varying vec3 vC;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float chase = pow(0.5 + 0.5 * sin((aT * 14.0 - uBeat * 2.0 + aS * 0.7) * 3.14159), 6.0);
            float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + aS * 13.0 + aT * 97.0);
            float b = 0.3 + 0.2 * twinkle + uLevel * chase * 1.8;
            vec3 col = mix(uA, uB, step(0.5, fract(aS * 0.5)));
            vC = col * b * uMaster;
            gl_PointSize = uSize * 700.0 / max(0.5, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vC;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vC * a * a * 2.2, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.object.frustumCulled = false;
    this.u.uSize.value = o.size ?? 0.09;
  }

  /** a straight run of lamps */
  line(a: THREE.Vector3, b: THREE.Vector3): this {
    return this.path([a, b]);
  }

  /** lamps along a polyline */
  path(points: THREE.Vector3[]): this {
    const spacing = this.o.spacing ?? 0.22;
    let total = 0;
    for (let i = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1]);
    const v = new THREE.Vector3();
    let acc = 0;
    for (let i = 1; i < points.length; i++) {
      const seg = points[i].distanceTo(points[i - 1]);
      const n = Math.max(1, Math.floor(seg / spacing));
      for (let j = 0; j < n; j++) {
        v.lerpVectors(points[i - 1], points[i], j / n);
        this.pos.push(v.x, v.y, v.z);
        this.at.push((acc + (j / n) * seg) / total);
        this.sid.push(this.strings);
      }
      acc += seg;
    }
    this.strings++;
    return this;
  }

  done(): this {
    const g = this.object.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.at, 1));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(this.sid, 1));
    return this;
  }

  update(s: ShowState, dt: number): void {
    this.u.uBeat.value = s.beat;
    this.u.uTime.value += dt;
    this.u.uLevel.value = s.playing ? 0.4 + s.energy * 0.6 + s.peak * 0.6 : 0.15;
    this.u.uMaster.value = s.master * Math.min(1.3, s.intensity);
    if (this.o.warm) {
      this.u.uA.value.set(this.o.warm).multiplyScalar(1.4);
      this.u.uB.value.copy(s.colors[0]).lerp(this.u.uA.value, 0.5).multiplyScalar(1.2);
    } else {
      hdr(s.colors[0], 1.3, this.u.uA.value);
      hdr(s.colors[1], 1.3, this.u.uB.value);
    }
  }
}

/* ------------------------------------------------------------------ */
/* pendant globes                                                       */
/* ------------------------------------------------------------------ */

export class Globes implements Fixture {
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private c = new THREE.Color();
  private base: THREE.Color;

  constructor(
    private spots: { pos: THREE.Vector3; r: number }[],
    color: string,
    ceilingY: number,
  ) {
    this.base = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = normalize(-mv.xyz);
          vC = instanceColor;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        void main() {
          float f = abs(dot(normalize(vN), normalize(vV)));
          gl_FragColor = vec4(vC * (0.25 + 1.1 * pow(f, 1.8)), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), mat, spots.length);
    const m4 = new THREE.Matrix4();
    const wires: number[] = [];
    spots.forEach((s, i) => {
      m4.makeScale(s.r, s.r, s.r).setPosition(s.pos);
      this.mesh.setMatrixAt(i, m4);
      this.mesh.setColorAt(i, this.base);
      wires.push(s.pos.x, s.pos.y + s.r, s.pos.z, s.pos.x, ceilingY, s.pos.z);
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    this.object.add(this.mesh, new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1512 })));
  }

  update(s: ShowState): void {
    this.spots.forEach((sp, i) => {
      const d = Math.hypot(sp.pos.x, sp.pos.z);
      const wave = s.playing ? Math.pow(Math.max(0, Math.cos((d * 0.35 - (s.beat % 1) * Math.PI * 2) * 0.5)), 8) : 0;
      const tw = s.peak > 0.4 ? (hash(i * 3.1 + Math.floor(s.beat * 2)) > 0.6 ? 1.5 : 0.4) : 1;
      const v = (1.1 + wave * 1.6 * (0.3 + s.energy)) * tw * (0.25 + 0.75 * s.master);
      this.mesh.setColorAt(i, this.c.copy(this.base).multiplyScalar(v));
    });
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* CO2 cannons                                                          */
/* ------------------------------------------------------------------ */

export class Co2Jets implements Fixture {
  readonly object = new THREE.Group();
  private pts: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private alpha: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;
  private per = 90;
  private tint = { value: new THREE.Color(1, 1, 1) };
  private rnd = rng(7);

  constructor(
    private nozzles: THREE.Vector3[],
    private power = 11,
  ) {
    const n = nozzles.length * this.per;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n).fill(99);
    this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.alpha = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.size = new THREE.BufferAttribute(new Float32Array(n), 1);
    g.setAttribute('aAlpha', this.alpha);
    g.setAttribute('aSize', this.size);
    this.pts = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: smokeTexture() }, uTint: this.tint },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          attribute float aSize;
          varying float vA;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            // flying through the plume must not white out the frame
            vA = aAlpha * smoothstep(0.8, 3.0, -mv.z);
            gl_PointSize = min(aSize * 700.0 / max(0.5, -mv.z), 260.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uTint;
          varying float vA;
          void main() {
            vec4 t = texture2D(uMap, gl_PointCoord);
            gl_FragColor = vec4(uTint, t.a * vA);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.pts.frustumCulled = false;
    const nozzle = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: 0.7, roughness: 0.4 }), nozzles.length);
    nozzles.forEach((p, i) => nozzle.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y - 0.15, p.z)));
    this.object.add(nozzle, this.pts);
  }

  fire(): void {
    const r = this.rnd;
    this.nozzles.forEach((nz, j) => {
      for (let i = 0; i < this.per; i++) {
        const k = j * this.per + i;
        this.pos[k * 3] = nz.x;
        this.pos[k * 3 + 1] = nz.y;
        this.pos[k * 3 + 2] = nz.z;
        const sp = 0.9;
        this.vel[k * 3] = (r() - 0.5) * sp;
        this.vel[k * 3 + 1] = this.power * (0.55 + r() * 0.6);
        this.vel[k * 3 + 2] = (r() - 0.5) * sp;
        this.life[k] = -r() * 0.7; // staggered release over the blast
        this.max[k] = 1.3 + r() * 1.1;
      }
    });
  }

  update(s: ShowState, dt: number): void {
    if (s.co2) this.fire();
    // the plume picks up the wash, and goes white in the strobes
    this.tint.value.copy(s.colors[0]).lerp(WHITE, 0.75).multiplyScalar(0.55 + s.wash * 0.4 + s.flash * 0.6);
    const drag = Math.exp(-dt * 2.2);
    for (let k = 0; k < this.life.length; k++) {
      const l = (this.life[k] += dt);
      if (l < 0 || l > this.max[k]) {
        this.alpha.setX(k, 0);
        if (l < 0) {
          const j = Math.floor(k / this.per);
          this.pos[k * 3] = this.nozzles[j].x;
          this.pos[k * 3 + 1] = this.nozzles[j].y;
          this.pos[k * 3 + 2] = this.nozzles[j].z;
        }
        continue;
      }
      this.vel[k * 3] *= drag;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * drag - dt * 0.6;
      this.vel[k * 3 + 2] *= drag;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const u = l / this.max[k];
      this.alpha.setX(k, Math.min(1, u * 8) * (1 - u) * 0.42);
      this.size.setX(k, 0.3 + u * 1.5);
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.size.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* haze                                                                  */
/* ------------------------------------------------------------------ */

/*
 * Haze, in three tiers (the effects level, src/three/fx.ts):
 *   low     horizontal sheets of drifting noise (cheap; edge-on they're hidden)
 *   medium  slices facing the camera at increasing distances, so the haze
 *           reads as a volume from any angle, its density from the shared haze
 *           field (atmos.ts) the beams and lasers use
 *   high    more slices, lit from below by the venue's light map where it has
 *           one (haze glows over the pools of light)
 * Slices are one instanced draw.
 */
export class HazeLayer implements Fixture {
  readonly object = new THREE.Group();
  private u = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color() },
    uDensity: { value: 0.5 },
    uSmoke: { value: 0.5 },
    uBand: { value: new THREE.Vector2() },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxMax: { value: new THREE.Vector3() },
    uLit: { value: 0 },
  };
  private sheets = new THREE.Group();
  private slices: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private static SLICES = 12;

  /** `gain` scales the density (big rooms look through far more haze); a light map lights it from below on High */
  constructor(
    box: THREE.Box3,
    sheets = 6,
    private gain = 1,
    lightMap?: LightMap,
  ) {
    this.u.uBand.value.set(box.min.y, box.max.y);
    this.u.uBoxMin.value.copy(box.min);
    this.u.uBoxMax.value.copy(box.max);
    const sheetMat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uDensity, uSmoke;
        uniform vec2 uBand;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vW;
        ${HAZE_GLSL}
        void main() {
          float v = hazeAt(vW, uTime, vec2(-100.0, 100.0), uSmoke) * 1.4;
          float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
          // hide the sheet structure: fade near the camera, and only where a sheet is seen almost exactly edge-on
          vec3 toCam = cameraPosition - vW;
          float dist = length(toCam);
          float near = smoothstep(0.6, 3.5, dist);
          float graze = smoothstep(0.008, 0.07, abs(toCam.y) / max(dist, 1e-3));
          gl_FragColor = vec4(uColor * v * edge * uDensity * near * graze, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    for (let i = 0; i < sheets; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.z), sheetMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(c.x, box.min.y + (size.y * (i + 0.5)) / sheets, c.z);
      this.sheets.add(m);
    }
    // camera-facing slices
    const sliceU: Record<string, THREE.IUniform> = { ...this.u };
    if (lightMap) Object.assign(sliceU, lightMap.uniforms);
    const sliceMat = new THREE.ShaderMaterial({
      uniforms: sliceU,
      defines: lightMap ? { USE_LM: '' } : {},
      vertexShader: /* glsl */ `
        attribute float iAmp;
        varying vec3 vW;
        varying float vAmp;
        void main() {
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vAmp = iAmp;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uDensity, uSmoke, uLit;
        uniform vec2 uBand;
        uniform vec3 uColor, uBoxMin, uBoxMax;
        varying vec3 vW;
        varying float vAmp;
        ${HAZE_GLSL}
        #ifdef USE_LM
          ${LIGHTMAP_GLSL}
        #endif
        void main() {
          // only inside the haze volume, softly
          vec3 a = smoothstep(uBoxMin - 1.5, uBoxMin + 1.5, vW) * (1.0 - smoothstep(uBoxMax - 1.5, uBoxMax + 1.5, vW));
          float inside = a.x * a.z;
          float d = hazeAt(vW, uTime, uBand, uSmoke) * inside;
          vec3 col = uColor;
          #ifdef USE_LM
            // lit from below by the pools of light on the floor
            col += lightMapPools(vW) * uLit * exp(-max(0.0, vW.y - uBoxMin.y) * 0.25);
          #endif
          gl_FragColor = vec4(col * d * uDensity * vAmp, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const n = HazeLayer.SLICES;
    const sliceGeo = new THREE.PlaneGeometry(1, 1);
    sliceGeo.setAttribute('iAmp', new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    this.slices = new THREE.InstancedMesh(sliceGeo, sliceMat, n);
    this.slices.frustumCulled = false;
    this.object.add(this.sheets, this.slices);
  }

  update(s: ShowState, _dt: number, camera: THREE.Camera): void {
    this.u.uTime.value = s.t;
    this.u.uSmoke.value = s.smoke;
    this.u.uColor.value.copy(s.colors[0]).lerp(s.colors[1], 0.5 + 0.5 * Math.sin(s.t * 0.2));
    // a strobe lights the haze, but it shouldn't fill the frame with fog
    this.u.uDensity.value = (0.025 + s.smoke * 0.05) * (0.4 + s.wash + s.flash * 0.35) * s.master * this.gain;
    const tier = fxTier();
    this.sheets.visible = tier === 'low';
    this.slices.visible = tier !== 'low';
    if (tier === 'low') return;
    this.u.uLit.value = tier === 'high' ? 0.22 : 0;
    // slices in front of the camera, spaced out with distance; each weighs the depth of haze it stands for
    const cam = camera as THREE.PerspectiveCamera;
    const n = tier === 'high' ? HazeLayer.SLICES : 7;
    const amp = this.slices.geometry.getAttribute('iAmp') as THREE.InstancedBufferAttribute;
    const fov = THREE.MathUtils.degToRad(cam.fov ?? 50);
    const aspect = cam.aspect ?? 1.6;
    camera.getWorldQuaternion(this.q);
    camera.getWorldPosition(this.p);
    this.fwd.set(0, 0, -1).applyQuaternion(this.q);
    const near = 2.5;
    const far = 70;
    let prev = near;
    for (let i = 0; i < HazeLayer.SLICES; i++) {
      if (i >= n) {
        this.m4.makeScale(0, 0, 0);
        this.slices.setMatrixAt(i, this.m4);
        amp.setX(i, 0);
        continue;
      }
      const d = near * Math.pow(far / near, (i + 0.5) / n);
      const h = 2 * d * Math.tan(fov / 2) * 1.2;
      this.m4.compose(this.sc.copy(this.p).addScaledVector(this.fwd, d), this.q, new THREE.Vector3(h * aspect, h, 1));
      this.slices.setMatrixAt(i, this.m4);
      const next = near * Math.pow(far / near, (i + 1) / n);
      amp.setX(i, (next - prev) * 0.07 * smoothstepJs(near, near + 2, d));
      prev = next;
    }
    amp.needsUpdate = true;
    this.slices.instanceMatrix.needsUpdate = true;
  }
}

/*
 * Hazers on stage puffing clouds that roll out over the crowd and thin away.
 * Every particle's life is worked out in the shader from the clock (no CPU
 * work per frame); one draw. Medium and High only.
 */
export class Hazers implements Fixture {
  readonly object: THREE.Points;
  private u = {
    uTime: { value: 0 },
    uPuff: { value: 0.5 },
    uColor: { value: new THREE.Color() },
    uMap: { value: smokeTexture() },
  };

  /** each hazer at `pos`, its output drifting along `dir` (m/s) */
  constructor(spots: { pos: THREE.Vector3; dir: THREE.Vector3 }[], perHazer = 24) {
    const n = spots.length * perHazer;
    const pos = new Float32Array(n * 3);
    const dir = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const r = rng(77);
    spots.forEach((sp, h) => {
      for (let i = 0; i < perHazer; i++) {
        const k = h * perHazer + i;
        pos.set([sp.pos.x, sp.pos.y, sp.pos.z], k * 3);
        dir.set([sp.dir.x * (0.8 + r() * 0.4), sp.dir.y, sp.dir.z * (0.8 + r() * 0.4)], k * 3);
        seed[k] = (i + r() * 0.6) / perHazer;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.object = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: /* glsl */ `
          attribute vec3 aDir;
          attribute float aSeed;
          uniform float uTime, uPuff;
          varying float vA;
          varying float vR;
          void main() {
            const float LIFE = 11.0;
            float age = mod(uTime + aSeed * LIFE, LIFE);
            float k = age / LIFE;
            vec3 p = position + aDir * age + vec3(sin(age * 0.7 + aSeed * 40.0), 0.0, cos(age * 0.5 + aSeed * 31.0)) * age * 0.18;
            p.y += age * 0.16 + 0.6;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float d = -mv.z;
            // in quickly, then thinning away; never right on the lens
            vA = smoothstep(0.0, 0.08, k) * pow(1.0 - k, 1.6) * uPuff * smoothstep(1.5, 4.0, d);
            vR = aSeed * 6.2832;
            gl_PointSize = min((1.2 + k * 5.0) * 700.0 / max(d, 0.5), 320.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform vec3 uColor;
          varying float vA;
          varying float vR;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            vec2 q = vec2(c.x * cos(vR) - c.y * sin(vR), c.x * sin(vR) + c.y * cos(vR)) + 0.5;
            gl_FragColor = vec4(uColor * texture2D(uMap, q).a * vA, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.object.frustumCulled = false;
  }

  update(s: ShowState, dt: number): void {
    this.u.uTime.value += dt;
    this.object.visible = fxTier() !== 'low';
    // the operator pumps more haze through a build-up
    this.u.uPuff.value = (0.25 + s.smoke * 0.5 + s.build * 0.4) * s.master;
    // lit by the wash, white in the strobes
    this.u.uColor.value.copy(s.colors[0]).lerp(WHITE, 0.55).multiplyScalar(0.05 + s.wash * 0.05 + s.flash * 0.18);
  }
}

function smoothstepJs(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export { Crowd, crowdArea, type CrowdRole, type CrowdSpot } from './crowd';

/* ------------------------------------------------------------------ */
/* scenery helpers                                                      */
/* ------------------------------------------------------------------ */

let trussMat: THREE.MeshStandardMaterial | null = null;
/** Square box truss between two points. */
export function truss(a: THREE.Vector3, b: THREE.Vector3, size = 0.3): THREE.Mesh {
  trussMat ??= new THREE.MeshStandardMaterial({ map: trussTexture(), alphaTest: 0.5, metalness: 0.85, roughness: 0.35, color: 0xb9bdc5, side: THREE.DoubleSide });
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(size, len, size);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / size / 4));
  const m = new THREE.Mesh(geo, trussMat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const speakerBody = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.75, metalness: 0.1 });
/** Speaker cabinet with its front (+Z) showing the grille. */
export function speaker(w: number, h: number, d: number, layout: 'mid' | 'sub' | 'monitor' | 'top', bodyColor?: number): THREE.Mesh {
  const body = bodyColor !== undefined ? new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6, metalness: 0.1 }) : speakerBody;
  const front = new THREE.MeshStandardMaterial({ map: grilleTexture(layout), roughness: 0.85 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [body, body, body, body, front, body]);
  m.castShadow = false;
  return m;
}

/** Hanging line array: `n` boxes curving downwards, front facing +Z (rotate the group to aim). */
export function lineArray(n: number, w = 0.9, h = 0.32, d = 0.6): THREE.Group {
  const g = new THREE.Group();
  let y = 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const box = speaker(w, h, d, 'top');
    box.position.set(0, y - h / 2, 0);
    box.rotation.x = a;
    g.add(box);
    y -= h * 0.98;
    a += 0.05 + i * 0.012;
  }
  return g;
}

/** DJ booth table (top at TABLE_Y), front panel facing the room (−Z). */
export function booth(o: { w?: number; d?: number; front?: THREE.Material; top?: number; strip?: string | null; z?: number }): { group: THREE.Group; strip: THREE.MeshBasicMaterial | null } {
  const w = o.w ?? 2.9;
  const d = o.d ?? 1.0;
  const g = new THREE.Group();
  const bodyMat = o.front ?? new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, TABLE_Y - 0.04, d), bodyMat);
  body.position.set(0, (TABLE_Y - 0.04) / 2, o.z ?? 0);
  body.receiveShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.04, d + 0.08), new THREE.MeshStandardMaterial({ color: o.top ?? 0x15161a, roughness: 0.42, metalness: 0.15 }));
  top.position.set(0, TABLE_Y - 0.02, o.z ?? 0);
  top.receiveShadow = true;
  g.add(top);
  let strip: THREE.MeshBasicMaterial | null = null;
  if (o.strip !== null) {
    strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.strip ?? '#ffffff'), toneMapped: false });
    const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.025, 0.012), strip);
    s.position.set(0, TABLE_Y - 0.06, (o.z ?? 0) - d / 2 - 0.045);
    g.add(s);
  }
  return { group: g, strip };
}

/** Rotating mirror ball on a short chain. */
export function mirrorBall(r: number): THREE.Mesh {
  const tex = mirrorBallTexture();
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, map: tex, roughnessMap: tex, envMapIntensity: 2.4, flatShading: true }));
  return m;
}

/** Scale a 1×1×1-segment box's UVs so a tiling texture keeps its real-world size. */
export function boxUV(geo: THREE.BoxGeometry, w: number, h: number, d: number, unit: number): THREE.BoxGeometry {
  const uv = geo.attributes.uv;
  const faces: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, (uv.getX(f * 4 + i) * faces[f][0]) / unit, (uv.getY(f * 4 + i) * faces[f][1]) / unit);
  return geo;
}

/** Box with tiled UVs. */
export function block(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], unit = 4): THREE.Mesh {
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, unit), mat);
  m.receiveShadow = true;
  return m;
}

/** Simple flat floor. */
export function floor(size: number, mat: THREE.Material, y = 0): THREE.Mesh {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  f.rotation.x = -Math.PI / 2;
  f.position.y = y;
  f.receiveShadow = true;
  return f;
}

/** Update every fixture in a list. */
export function updateAll(list: Fixture[], s: ShowState, dt: number, camera: THREE.Camera): void {
  for (const f of list) f.update(s, dt, camera);
}
export { Lasers, type LaserSpec } from './lasers';
