/*
 * A walk-through field of hanging point lights over the whole floor: tens of
 * thousands of small bulbs on vertical strings, played as one 3D display.
 * (Large shows at Alexandra Palace have hung exactly this kind of field over
 * the room, with 42,000+ lights; see docs/venue-research.md. This is a
 * generic implementation of the idea, not anyone's show file.)
 *   – kick ripples: rings of light expand out from the booth on every beat
 *   – build-ups: a horizontal sheet of light sweeps up and down the field,
 *     faster as the build tightens, and the field fills in towards the drop
 *   – the drop and the peak: the whole field flashes, then sparkles
 *   – between sections: slow 3D colour clouds drift through the room
 * One draw, everything in the shader. (The cords aren't drawn: 8,500 one-pixel
 * lines alias into bright streaks, and in a dark room the cables are invisible.)
 */
import * as THREE from 'three';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { rng } from './tex';

export interface FieldSpec {
  /** floor rectangle covered by strings */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** string spacing (m) */
  spacing: number;
  /** bulbs per string */
  bulbs: number;
  /** lowest and highest bulb heights */
  yLow: number;
  yHigh: number;
  /** the field ripples out from here (the booth) */
  origin: THREE.Vector3;
  /** keep strings out of this radius around the origin (the booth) */
  clear?: number;
}

/** String positions for a field: a jittered grid, minus the clear circle. */
export function fieldStrings(f: FieldSpec, seed = 3): { x: number; z: number }[] {
  const r = rng(seed);
  const out: { x: number; z: number }[] = [];
  for (let z = f.z0; z <= f.z1 + 1e-6; z += f.spacing) {
    for (let x = f.x0; x <= f.x1 + 1e-6; x += f.spacing) {
      const px = x + (r() - 0.5) * f.spacing * 0.3;
      const pz = z + (r() - 0.5) * f.spacing * 0.3;
      if (f.clear && Math.hypot(px - f.origin.x, pz - f.origin.z) < f.clear) continue;
      out.push({ x: px, z: pz });
    }
  }
  return out;
}

const VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uT, uBeat, uKick, uBuild, uPeak, uEnergy, uMaster, uFlash, uSize, uLow, uHigh, uPlaying;
  uniform vec3 uOrigin, uA, uB, uC;
  varying vec3 vC;
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 p = position;
    float d = length(p.xz - uOrigin.xz);
    float hN = (p.y - uLow) / max(0.01, uHigh - uLow);
    // 1. ripples: a ring leaves the booth on every beat and runs out across the room
    float ph = fract(uBeat);
    float ring = exp(-pow((d - ph * 34.0) / (1.4 + ph * 2.0), 2.0)) * (1.0 - ph) * (0.35 + uKick * 0.9);
    // 2. the build: a sheet sweeping up and down, faster as it tightens; the field fills in
    float rate = 0.25 + uBuild * uBuild * 3.0;
    float sweepY = 0.5 + 0.5 * sin(uBeat * 3.14159 * rate);
    float sheet = exp(-pow((hN - sweepY) / 0.12, 2.0)) * uBuild;
    // 3. colour clouds drifting through the room between sections
    float cloud = n3(p * vec3(0.07, 0.18, 0.07) + vec3(0.0, uT * 0.08, uT * 0.05));
    cloud = smoothstep(0.38, 0.9, cloud) * (1.0 - uPeak * 0.6);
    // 4. the peak: sparkle, and the whole field on the downbeats
    float sp = step(0.93, fract(sin(aSeed * 91.7 + floor(uT * 14.0)) * 43758.5)) * uPeak;
    float down = pow(1.0 - fract(uBeat * 0.25), 6.0) * uPeak;
    float b = 0.05 + 0.04 * sin(uT * 0.7 + aSeed * 40.0) + ring * (0.6 + uEnergy) + sheet * 1.6 + cloud * 0.7 + sp * 1.6 + down * 0.9 + uFlash * 1.2;
    b *= mix(0.35, 1.0, uPlaying) * uMaster;
    // colour: clouds in the palette, ripples warm-white, the peak white-hot
    vec3 col = mix(uA, uB, smoothstep(0.2, 0.8, n3(p * 0.05 + uT * 0.03)));
    col = mix(col, uC, ring * 0.6);
    col = mix(col, vec3(1.0, 0.95, 0.88), clamp(sp + down + uFlash, 0.0, 1.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    // the haze swallows the far side of the field; nothing right on the lens
    float haze = exp(-dist * 0.012) * smoothstep(0.4, 1.6, dist);
    vC = col * b * haze;
    gl_PointSize = clamp(uSize * 700.0 / max(0.5, dist), 1.0, 14.0);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  varying vec3 vC;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vC * (core * core * 2.4 + smoothstep(0.18, 0.0, r) * 2.0), 1.0);
  }`;

const WARM = new THREE.Color(1, 0.82, 0.6);

export class LightField implements Fixture {
  readonly object = new THREE.Group();
  private u = {
    uT: { value: 0 },
    uBeat: { value: 0 },
    uKick: { value: 0 },
    uBuild: { value: 0 },
    uPeak: { value: 0 },
    uEnergy: { value: 0 },
    uMaster: { value: 1 },
    uFlash: { value: 0 },
    uPlaying: { value: 0 },
    uSize: { value: 0.055 },
    uLow: { value: 0 },
    uHigh: { value: 1 },
    uOrigin: { value: new THREE.Vector3() },
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
    uC: { value: new THREE.Color() },
  };
  /** 0..1, how lit the field is right now (drives the room's wash lights) */
  glow = 0;
  readonly bulbs: number;

  constructor(f: FieldSpec, seed = 3) {
    const strings = fieldStrings(f, seed);
    const r = rng(seed + 1);
    const n = strings.length * f.bulbs;
    const pos = new Float32Array(n * 3);
    const sd = new Float32Array(n);
    strings.forEach((s, i) => {
      // each string's bulbs at slightly different heights, so the field reads as a volume
      const off = (r() - 0.5) * 0.6;
      for (let k = 0; k < f.bulbs; k++) {
        const j = i * f.bulbs + k;
        pos[j * 3] = s.x;
        pos[j * 3 + 1] = f.yLow + off * (k === 0 ? 0 : 1) + ((f.yHigh - f.yLow) * k) / Math.max(1, f.bulbs - 1);
        pos[j * 3 + 2] = s.z;
        sd[j] = r();
      }
    });
    this.bulbs = n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    const pts = new THREE.Points(
      g,
      new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pts.frustumCulled = false;
    this.object.add(pts);
    this.u.uLow.value = f.yLow;
    this.u.uHigh.value = f.yHigh;
    this.u.uOrigin.value.copy(f.origin);
  }

  update(s: ShowState, dt: number): void {
    const u = this.u;
    u.uT.value += dt;
    u.uBeat.value = s.beat;
    u.uKick.value = s.kick;
    u.uBuild.value = s.build;
    u.uPeak.value = s.peak;
    u.uEnergy.value = s.energy;
    u.uMaster.value = s.master * Math.min(1.3, s.intensity);
    u.uFlash.value = s.flash + s.strobe * 0.6;
    u.uPlaying.value += ((s.playing ? 1 : 0) - u.uPlaying.value) * Math.min(1, dt * 2);
    // warm white bulbs tinted by the palette
    const warm = WARM;
    u.uA.value.copy(s.colors[0]).lerp(warm, s.venueLook ? 0.55 : 0.2);
    u.uB.value.copy(s.colors[1]).lerp(warm, s.venueLook ? 0.3 : 0.1);
    u.uC.value.copy(s.colors[2]).lerp(warm, 0.5);
    this.glow = Math.min(1, (0.15 + s.energy * 0.3 + s.peak * 0.5 + s.build * 0.3 + s.flash) * (s.playing ? 1 : 0.3) * s.master);
  }
}
