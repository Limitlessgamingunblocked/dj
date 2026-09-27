/*
 * Stage pyrotechnics, fired by the light show (the drop, then a flame on
 * every downbeat for a few bars; or by hand from the lighting desk):
 *   flame – flame-jet machines: a column of turbulent fire that shoots up,
 *           holds and falls back, lighting the room orange
 *   spark – cold-spark fountains (the indoor kind): a few hundred sparks
 *           thrown up and falling under gravity for a few seconds
 * Both are stateless shaders driven by per-emitter trigger times, so a
 * salvo costs a couple of draw calls.
 */
import * as THREE from 'three';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';

export interface PyroSpec {
  pos: THREE.Vector3;
  kind: 'flame' | 'spark';
}

const FLAME_VERT = /* glsl */ `
  attribute float iFire;
  attribute float iSeed;
  uniform float uTime, uHeight;
  varying float vH;
  varying float vFire;
  varying float vSeed;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec3 p = position;
    float h = clamp(p.y / uHeight, 0.0, 1.0);
    // the column shoots up with the envelope and flares out at the top
    float grow = smoothstep(0.0, 0.35, iFire);
    p.y *= mix(0.15, 1.0, grow) * (0.85 + 0.15 * sin(uTime * 23.0 + iSeed * 9.0));
    float wob = sin(uTime * 9.0 + h * 7.0 + iSeed * 5.0) * 0.12 * h + sin(uTime * 17.0 + h * 13.0) * 0.05 * h;
    p.xz *= 1.0 + h * 0.4 * grow;
    p.x += wob;
    p.z += cos(uTime * 7.0 + h * 5.0 + iSeed) * 0.08 * h;
    vH = h;
    vFire = iFire;
    vSeed = iSeed;
    vec4 wp = instanceMatrix * vec4(p, 1.0);
    vec4 mv = modelViewMatrix * wp;
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  varying float vH;
  varying float vFire;
  varying float vSeed;
  varying vec3 vN;
  varying vec3 vView;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    if (vFire < 0.01) discard;
    float edge = abs(dot(vN, vView));
    vec2 q = vec2(atan(vN.z, vN.x) * 1.3 + vSeed * 7.0, vH * 3.2 - uTime * 3.6);
    float n = fbm(q * 1.6);
    float body = smoothstep(1.05, 0.45, vH + (n - 0.5) * 0.6) * smoothstep(0.0, 0.04, vH);
    float core = pow(edge, 1.5);
    float a = body * core * vFire;
    vec3 hot = vec3(1.0, 0.92, 0.7);
    vec3 mid = vec3(1.0, 0.45, 0.08);
    vec3 cool = vec3(0.6, 0.08, 0.02);
    vec3 col = mix(hot, mid, smoothstep(0.05, 0.45, vH + (1.0 - n) * 0.2));
    col = mix(col, cool, smoothstep(0.45, 0.95, vH));
    gl_FragColor = vec4(col * a * 3.2, 1.0);
  }
`;

const SPARK_VERT = /* glsl */ `
  attribute vec3 aSeed;
  attribute float aEmit;
  uniform float uSince[8];
  uniform float uDur;
  uniform float uScale;
  varying float vAge;
  varying float vAlive;
  void main() {
    float since = uSince[int(aEmit + 0.5)];
    float life = 0.7 + aSeed.x * 0.8;
    float t = mod(since - aSeed.y * life, life);
    float born = since - t;
    vAlive = step(0.0, born) * step(born, uDur);
    vAge = t / life;
    float ang = aSeed.z * 6.2832;
    float spread = 0.35 + aSeed.x * 0.9;
    vec3 v = vec3(cos(ang) * spread, 4.2 + aSeed.y * 2.6, sin(ang) * spread);
    vec3 p = position + v * t + vec3(0.0, -4.9, 0.0) * t * t;
    p.y = max(p.y, position.y);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vAlive * uScale * (1.4 - vAge) * 0.05 / max(0.2, -mv.z);
  }
`;

const SPARK_FRAG = /* glsl */ `
  varying float vAge;
  varying float vAlive;
  void main() {
    if (vAlive < 0.5) discard;
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    vec3 col = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.5, 0.12), smoothstep(0.1, 0.8, vAge));
    gl_FragColor = vec4(col * a * (1.0 - vAge * 0.7) * 4.0, 1.0);
  }
`;

const SPARKS_PER = 220;
const SPARK_DUR = 3.2;

export class Pyro implements Fixture {
  /** spark size scale in pixels (set from the render height) */
  static pixelScale = 900;
  readonly object = new THREE.Group();
  private flames: PyroSpec[];
  private sparks: PyroSpec[];
  private flameMesh: THREE.InstancedMesh | null = null;
  private flameAttr: THREE.InstancedBufferAttribute | null = null;
  private flameMat: THREE.ShaderMaterial | null = null;
  private sparkMat: THREE.ShaderMaterial | null = null;
  private light: THREE.PointLight | null = null;
  /** per-flame trigger time (s) */
  private fireAt: number[];
  private sparkAt: number[];
  private chase = 0;
  private lastBar = -1;
  private now = 0;

  constructor(specs: PyroSpec[], o: { height?: number } = {}) {
    this.flames = specs.filter((s) => s.kind === 'flame');
    this.sparks = specs.filter((s) => s.kind === 'spark').slice(0, 8);
    this.fireAt = this.flames.map(() => -100);
    this.sparkAt = this.sparks.map(() => -100);
    const body = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, metalness: 0.6 });
    const nozzle = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.35, metalness: 0.8 });
    for (const s of specs) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(s.kind === 'flame' ? 0.34 : 0.26, s.kind === 'flame' ? 0.28 : 0.16, s.kind === 'flame' ? 0.34 : 0.26), body);
      base.position.copy(s.pos).add(new THREE.Vector3(0, s.kind === 'flame' ? 0.14 : 0.08, 0));
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 10), nozzle);
      tip.position.copy(s.pos).add(new THREE.Vector3(0, s.kind === 'flame' ? 0.34 : 0.2, 0));
      this.object.add(base, tip);
    }
    if (this.flames.length) {
      const H = o.height ?? 3.2;
      const geo = new THREE.CylinderGeometry(0.3, 0.08, H, 18, 14, true).translate(0, H / 2, 0);
      this.flameMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uHeight: { value: H } },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.flameAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.flames.length), 1);
      const seeds = new Float32Array(this.flames.map((_, i) => (i * 0.618) % 1));
      geo.setAttribute('iFire', this.flameAttr);
      geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));
      this.flameMesh = new THREE.InstancedMesh(geo, this.flameMat, this.flames.length);
      this.flameMesh.frustumCulled = false;
      const m = new THREE.Matrix4();
      this.flames.forEach((s, i) => this.flameMesh!.setMatrixAt(i, m.makeTranslation(s.pos.x, s.pos.y + 0.4, s.pos.z)));
      this.object.add(this.flameMesh);
      const c = this.flames.reduce((a, s) => a.add(s.pos), new THREE.Vector3()).multiplyScalar(1 / this.flames.length);
      this.light = new THREE.PointLight(0xff7a2a, 0, 26, 1.4);
      this.light.position.copy(c).add(new THREE.Vector3(0, 2.2, -1.5));
      this.object.add(this.light);
    }
    if (this.sparks.length) {
      const n = this.sparks.length * SPARKS_PER;
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n * 3);
      const emit = new Float32Array(n);
      let k = 0;
      this.sparks.forEach((s, e) => {
        for (let i = 0; i < SPARKS_PER; i++, k++) {
          pos.set([s.pos.x, s.pos.y + 0.26, s.pos.z], k * 3);
          seed.set([Math.random(), Math.random(), Math.random()], k * 3);
          emit[k] = e;
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
      geo.setAttribute('aEmit', new THREE.BufferAttribute(emit, 1));
      this.sparkMat = new THREE.ShaderMaterial({
        uniforms: { uSince: { value: new Float32Array(8).fill(100) }, uDur: { value: SPARK_DUR }, uScale: { value: 900 } },
        vertexShader: SPARK_VERT,
        fragmentShader: SPARK_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const pts = new THREE.Points(geo, this.sparkMat);
      pts.frustumCulled = false;
      this.object.add(pts);
    }
  }

  update(s: ShowState, dt: number): void {
    this.now += dt;
    const t = this.now;
    if (s.pyro) {
      // full salvo, staggered from the centre out, then a flame on the next downbeats
      this.flames.forEach((f, i) => (this.fireAt[i] = t + Math.abs(f.pos.x) * 0.015));
      this.sparks.forEach((_, i) => (this.sparkAt[i] = t + i * 0.05));
      this.chase = 3;
      this.lastBar = s.bar;
    } else if (this.chase > 0 && s.bar !== this.lastBar) {
      this.lastBar = s.bar;
      const side = this.chase % 2 ? 1 : -1;
      this.flames.forEach((f, i) => {
        if (Math.sign(f.pos.x || 1) === side) this.fireAt[i] = t;
      });
      this.chase--;
    }
    let lit = 0;
    if (this.flameAttr && this.flameMat) {
      const arr = this.flameAttr.array as Float32Array;
      for (let i = 0; i < arr.length; i++) {
        const since = t - this.fireAt[i];
        const env = since < 0 ? 0 : since < 0.15 ? since / 0.15 : since < 0.8 ? 1 : Math.max(0, 1 - (since - 0.8) / 0.35);
        arr[i] = env * Math.min(1, s.master + 0.2);
        lit += arr[i];
      }
      this.flameAttr.needsUpdate = true;
      this.flameMat.uniforms.uTime.value = t;
      if (this.light) this.light.intensity = (lit / Math.max(1, arr.length)) * 60 * (0.8 + Math.random() * 0.4);
    }
    if (this.sparkMat) {
      this.sparkMat.uniforms.uScale.value = Pyro.pixelScale;
      const since = this.sparkMat.uniforms.uSince.value as Float32Array;
      for (let i = 0; i < this.sparks.length; i++) since[i] = Math.max(-1, t - this.sparkAt[i]);
    }
  }
}
