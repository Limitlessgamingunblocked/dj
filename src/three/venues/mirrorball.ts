/*
 * Mirror-ball spots: a pinspot on each ball throws hundreds of small spots
 * round the room that drift across the walls, floor and ceiling as it turns,
 * stretched where they hit at a slant, and on medium and up a thin ray
 * through the haze to each. It's the breakdown light: full on as the floor
 * drops, faint in the groove, almost gone at the peak.
 *
 * Nothing per spot on the CPU. Each spot's direction is fixed on the ball;
 * the vertex shader turns it with the ball, finds where it leaves the room's
 * box (the same room proxy the lasers stop on), and lays a quad flat on that
 * surface. `spotHit()` is the same maths in TypeScript, for the tests.
 */
import * as THREE from 'three';
import { fxTier } from '../fx';
import type { Fixture } from './fixtures';
import type { RoomProxy } from './lasers';
import type { ShowState } from './show';

/** Evenly spread unit directions (Fibonacci sphere). */
export function sphereDirs(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(i * ga) * r, y, Math.sin(i * ga) * r));
  }
  return out;
}

/**
 * Where a spot lands: the ray from the ball along `dir` turned by `angle`
 * round the vertical, against the room's box. The distance and the outward
 * axis it hit (0 x, 1 y, 2 z).
 */
export function spotHit(ball: THREE.Vector3, dir: THREE.Vector3, angle: number, min: THREE.Vector3, max: THREE.Vector3): { t: number; axis: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = [c * dir.x + s * dir.z, dir.y, -s * dir.x + c * dir.z].map((v) => (Math.abs(v) < 1e-4 ? (v < 0 ? -1e-4 : 1e-4) : v));
  const o = [ball.x, ball.y, ball.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  let t = Infinity;
  let axis = 0;
  for (let k = 0; k < 3; k++) {
    const tk = ((d[k] > 0 ? hi[k] : lo[k]) - o[k]) / d[k];
    if (tk < t) {
      t = tk;
      axis = k;
    }
  }
  return { t, axis };
}

const SPOT_VERT = /* glsl */ `
  attribute vec3 aDir;
  attribute float aBall;
  uniform vec3 uBall[4];
  uniform float uAngle;
  uniform vec3 uMin;
  uniform vec3 uMax;
  uniform float uSize;
  varying vec2 vUv;
  varying float vI;

  vec3 turned(vec3 d) {
    float c = cos(uAngle), s = sin(uAngle);
    return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
  }

  void main() {
    int bi = int(aBall + 0.5);
    vec3 o = uBall[0];
    for (int i = 1; i < 4; i++) if (i == bi) o = uBall[i];
    vec3 d = turned(aDir);
    vec3 dd = sign(d) * max(abs(d), vec3(1e-4));
    vec3 tv = (mix(uMin, uMax, step(0.0, dd)) - o) / dd;
    float t = min(tv.x, min(tv.y, tv.z));
    vec3 n = tv.x <= t ? vec3(-sign(dd.x), 0.0, 0.0) : tv.y <= t ? vec3(0.0, -sign(dd.y), 0.0) : vec3(0.0, 0.0, -sign(dd.z));
    // lay the spot on the surface, stretched along the way the light travels
    vec3 along = d - n * dot(d, n);
    float la = length(along);
    vec3 u = la > 1e-3 ? along / la : (abs(n.y) > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0));
    vec3 v = cross(n, u);
    float cosi = max(0.22, abs(dot(d, n)));
    float size = uSize + t * 0.014;
    vec3 wp = o + d * t + n * 0.012 + (u * position.x / cosi + v * position.y) * size;
    vUv = position.xy * 2.0;
    // the light spreads over a bigger spot further away
    vI = 1.0 / (1.0 + t * t * 0.012) * (0.75 + 0.5 * fract(aDir.x * 91.7 + aDir.z * 37.3));
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

const SPOT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel;
  varying vec2 vUv;
  varying float vI;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float a = (1.0 - smoothstep(0.45, 1.0, r)) + 0.6 * exp(-r * r * 9.0);
    gl_FragColor = vec4(uColor * a * vI * uLevel, 1.0);
  }`;

// the rays: a line from the ball to each spot, faint in the haze
const RAY_VERT = SPOT_VERT.replace('uniform float uSize;', 'uniform float uSize;\n  varying float vAlong;')
  .replace('vec3 wp = o + d * t + n * 0.012 + (u * position.x / cosi + v * position.y) * size;', 'vec3 wp = o + d * t * position.x;\n    vAlong = position.x;')
  .replace('vUv = position.xy * 2.0;', 'vUv = vec2(0.0);');

const RAY_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel;
  uniform float uHaze;
  varying float vI;
  varying float vAlong;
  void main() {
    // brightest leaving the ball, gone by the time it lands
    float a = (1.0 - vAlong) * (1.0 - vAlong);
    gl_FragColor = vec4(uColor * a * vI * uLevel * uHaze, 1.0);
  }`;

export interface BallSpec {
  /** the ball itself (it's turned with the spots) */
  mesh: THREE.Object3D;
  /** how many spots it throws */
  spots: number;
}

export class MirrorBallSpots implements Fixture {
  readonly object = new THREE.Group();
  private spotMat: THREE.ShaderMaterial;
  private rayMat: THREE.ShaderMaterial;
  private rays: THREE.LineSegments;
  private angle = 0;
  private level = 0;
  private color = new THREE.Color();

  constructor(
    private balls: BallSpec[],
    room: RoomProxy,
    private speed = 0.22,
  ) {
    const min = new THREE.Vector3(room.x0, room.floorY, room.z0);
    const max = new THREE.Vector3(room.x1, room.ceilY ?? room.floorY + 12, room.z1);
    const dirs: number[] = [];
    const ball: number[] = [];
    balls.slice(0, 4).forEach((b, bi) => {
      // each ball's facets sit at their own angles
      const twist = new THREE.Quaternion().setFromEuler(new THREE.Euler(bi * 0.7, bi * 1.3, 0));
      for (const d of sphereDirs(b.spots)) {
        d.applyQuaternion(twist);
        dirs.push(d.x, d.y, d.z);
        ball.push(bi);
      }
    });
    const count = ball.length;
    const ballPos = Array.from({ length: 4 }, (_, i) => balls[Math.min(i, balls.length - 1)].mesh.position.clone());
    const uniforms = () => ({
      uBall: { value: ballPos },
      uAngle: { value: 0 },
      uMin: { value: min },
      uMax: { value: max },
      uSize: { value: 0.045 },
      uColor: { value: this.color },
      uLevel: { value: 0 },
      uHaze: { value: 0.5 },
    });
    const attrs = (g: THREE.InstancedBufferGeometry) => {
      g.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(dirs), 3));
      g.setAttribute('aBall', new THREE.InstancedBufferAttribute(new Float32Array(ball), 1));
      g.instanceCount = count;
      return g;
    };

    const quad = new THREE.PlaneGeometry(1, 1);
    const spotGeo = attrs(new THREE.InstancedBufferGeometry());
    spotGeo.index = quad.index;
    spotGeo.setAttribute('position', quad.getAttribute('position'));
    this.spotMat = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: SPOT_VERT,
      fragmentShader: SPOT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const spots = new THREE.Mesh(spotGeo, this.spotMat);
    spots.frustumCulled = false;
    spots.renderOrder = 2;

    const rayGeo = attrs(new THREE.InstancedBufferGeometry());
    rayGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    this.rayMat = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: RAY_VERT,
      fragmentShader: RAY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rays = new THREE.LineSegments(rayGeo, this.rayMat);
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 2;
    this.object.add(spots, this.rays);
  }

  update(s: ShowState, dt: number): void {
    this.angle = (this.angle + dt * this.speed) % (Math.PI * 2);
    for (const b of this.balls) b.mesh.rotation.y = this.angle;
    // the breakdown light: full as the floor drops, faint in the groove, nearly gone at the peak
    const target = s.playing ? (0.16 + 0.84 * THREE.MathUtils.smoothstep(s.build, 0.15, 0.55)) * (1 - 0.75 * s.peak) : 0.45;
    this.level += (target - this.level) * Math.min(1, dt * 1.5);
    const lv = this.level * s.master;
    this.object.visible = lv > 0.01;
    // a white pinspot, a touch of the show's colour
    this.color.setRGB(1, 0.96, 0.9).lerp(s.colors[0], 0.18);
    for (const m of [this.spotMat, this.rayMat]) {
      m.uniforms.uAngle.value = this.angle;
      m.uniforms.uLevel.value = lv * (m === this.spotMat ? 1.5 : 0.09);
      m.uniforms.uHaze.value = 0.3 + s.smoke;
    }
    this.rays.visible = fxTier() !== 'low';
  }

  dispose(): void {
    this.spotMat.dispose();
    this.rayMat.dispose();
  }
}
