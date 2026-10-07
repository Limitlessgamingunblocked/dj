/*
 * A walk-through field of hanging point lights over the whole floor: tens of
 * thousands of small bulbs on vertical strings, played as one 3D display.
 * (Large shows at Alexandra Palace have hung exactly this kind of field over
 * the room, with 42,000+ lights; see docs/venue-research.md. This is a
 * generic implementation of the idea, not anyone's show file.)
 *   – kick ripples: rings of light expand out from the booth on every beat
 *   – breakdowns: light rains down the strings, and a band of light breathes
 *     up and down with the energy
 *   – build-ups: a horizontal sheet of light sweeps up and down the field,
 *     faster as the build tightens, and the field fills in towards the drop
 *   – the drop: a sphere of light bursts out from the booth through the whole
 *     room, on the same downbeat as the lasers, strobes and sparks
 *   – the peak: planes of light turn through the volume, the field sparkles
 *     and the whole room lights on the downbeats
 *   – between sections: slow 3D colour clouds drift through the room
 *   – every bulb has its own tint in the palette and a soft halo in the haze;
 *     the crowd meter lifts the whole field
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
  uniform float uRain, uBreath, uSphereR, uSphere, uPlanes, uHype, uSparkleRate;
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
    float sp = step(0.93, fract(sin(aSeed * 91.7 + floor(uT * uSparkleRate)) * 43758.5)) * uPeak;
    float down = pow(1.0 - fract(uBeat * 0.25), 6.0) * uPeak;
    // 5. rain down the strings (each string its own timing)
    float sh = fract(sin(dot(floor(p.xz * 1.3), vec2(12.9898, 78.233))) * 43758.5453);
    float drop = 1.0 - fract(uT * (0.35 + sh * 0.3) + sh);
    float rain = exp(-pow((hN - drop) / 0.07, 2.0)) * uRain;
    // 6. a band of light breathing up and down with the energy
    float breath = exp(-pow((hN - (0.5 + 0.38 * sin(uT * 0.45))) / (0.1 + uEnergy * 0.25), 2.0)) * uBreath;
    // 7. the drop: a shell of light bursting out from the booth
    float shell = exp(-pow((length(p - uOrigin) - uSphereR) / 2.2, 2.0)) * uSphere;
    // 8. planes of light turning through the volume
    float ang = uT * 0.35;
    vec3 pn = normalize(vec3(cos(ang), 0.45 * sin(uT * 0.21), sin(ang)));
    float planes = smoothstep(0.86, 1.0, sin(dot(p - uOrigin, pn) * 0.45 - uT * 2.4)) * uPlanes;
    float b = 0.02 + 0.015 * sin(uT * 0.7 + aSeed * 40.0) + ring * (0.5 + uEnergy) + sheet * 1.3 + cloud * 0.55 + sp * 1.4 + down * 0.6
      + rain * 1.4 + breath * 0.8 + shell * 2.2 + planes * 1.2 + uFlash * 0.8;
    b *= mix(0.35, 1.0, uPlaying) * uMaster * (0.75 + 0.5 * uHype);
    // colour: each bulb its own tint in the palette; ripples warm-white, the peak white-hot
    vec3 col = mix(uA, uB, smoothstep(0.2, 0.8, n3(p * 0.05 + uT * 0.03)));
    col = mix(col, uC, step(0.82, aSeed) * 0.6);
    col = mix(col, uC, ring * 0.6);
    col = mix(col, vec3(1.0, 0.95, 0.88), clamp(sp + down + uFlash + shell * 0.7, 0.0, 1.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    // the haze swallows the far side of the field; nothing right on the lens
    float haze = exp(-dist * 0.012) * smoothstep(0.4, 1.6, dist);
    vC = col * b * haze;
    gl_PointSize = clamp(uSize * 700.0 / max(0.5, dist), 1.0, 18.0);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  varying vec3 vC;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, r);
    // a hot filament, a glow, and a faint halo in the haze
    gl_FragColor = vec4(vC * (smoothstep(0.14, 0.0, r) * 2.4 + core * core * 1.2 + core * 0.18), 1.0);
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
    uRain: { value: 0 },
    uBreath: { value: 0 },
    uSphereR: { value: 0 },
    uSphere: { value: 0 },
    uPlanes: { value: 0 },
    uHype: { value: 0.5 },
    uSparkleRate: { value: 14 },
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
    uC: { value: new THREE.Color() },
  };
  /** 0..1, how lit the field is right now (drives the room's wash lights) */
  glow = 0;
  /** seconds since the drop's shell of light set off */
  private sphereAge = 10;
  /** radius of the kick ripple right now (m), and how strong it is: the venue paints it onto the floor */
  get ripple(): [number, number] {
    const ph = ((this.u.uBeat.value % 1) + 1) % 1;
    return [ph * 34, (1 - ph) * (0.35 + this.u.uKick.value * 0.9) * this.u.uMaster.value];
  }
  /** the drop's shell: radius (m) and strength */
  get shell(): [number, number] {
    return [this.u.uSphereR.value, this.u.uSphere.value * this.u.uMaster.value];
  }
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
    // which patterns play, by section
    const k = Math.min(1, dt * 1.5);
    const breakdown = s.build > 0.3 && s.build < 0.85 ? 1 : 0;
    const quiet = s.peak < 0.3 && s.build < 0.3 && s.energy < 0.5 ? 1 : 0;
    u.uRain.value += (breakdown - u.uRain.value) * k;
    u.uBreath.value += (Math.max(breakdown, quiet) - u.uBreath.value) * k;
    u.uPlanes.value += ((s.peak > 0.5 ? 1 : 0) - u.uPlanes.value) * k;
    u.uHype.value = s.hype;
    u.uSparkleRate.value = s.reduceFlash ? 2.8 : 14;
    // the drop: the shell bursts out from the booth over a second and a half
    if (s.dropHit) this.sphereAge = 0;
    this.sphereAge += dt;
    u.uSphereR.value = this.sphereAge * 40;
    u.uSphere.value = this.sphereAge < 1.6 ? 1 - this.sphereAge / 1.6 : 0;
    this.glow = Math.min(1, (0.15 + s.energy * 0.3 + s.peak * 0.5 + s.build * 0.3 + s.flash + u.uSphere.value * 0.6) * (s.playing ? 1 : 0.3) * s.master);
  }
}
