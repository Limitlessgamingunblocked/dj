/*
 * The far crowd: thousands of people past the jointed 3D dancers, as
 * camera-facing cut-outs in one instanced draw (two triangles each).
 *   – four poses in a procedural silhouette atlas (arms down, one arm up
 *     filming, both arms up, fists up mid-jump), picked per person from the
 *     same show state that drives the 3D crowd: hands rise with the hype and
 *     the drop, jumps on the peak, phones held up by some
 *   – bob and sway on the beat with a per-person phase, so the floor moves
 *     like a crowd rather than a pattern
 *   – lit by the show: with a floor light map (lightmap.ts) each person is lit
 *     by the light actually landing where they stand (beam pools, the LED
 *     wall's spill, blinders, strobes); without one, by drifting pools.
 *     Front-lit seen from the stage, silhouettes against the light from
 *     behind; phone screens glow
 *   – cards turn part-way towards a camera looking down on them (the drone),
 *     so they don't flatten into slivers from above
 * A sold-out room needs ~10,000 people; at ~600–1,200 triangles a jointed
 * dancer that's millions of triangles, so the 3D crowd covers the front and
 * this covers the rest of the floor.
 */
import * as THREE from 'three';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { LIGHTMAP_GLSL, type LightMap } from './lightmap';
import { getCrowdScale } from './crowd';
import { canvasTexture, rng } from './tex';

export interface FarSpot {
  x: number;
  z: number;
  y?: number;
}

/**
 * Scatter people over a rectangle with a density (people per m²) that can
 * vary over the floor, skipping `avoid` boxes. Jittered grid per 1 m cell, so
 * the count follows the density closely. Density follows the crowd size setting.
 */
export function scatter(x0: number, x1: number, z0: number, z1: number, density: (x: number, z: number) => number, seed: number, avoid: THREE.Box2[] = []): FarSpot[] {
  const r = rng(seed);
  const out: FarSpot[] = [];
  // the crowd size setting (Settings → Show)
  const k = getCrowdScale();
  const p = new THREE.Vector2();
  for (let z = Math.min(z0, z1); z < Math.max(z0, z1); z += 1) {
    for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x += 1) {
      const d = Math.max(0, density(x + 0.5, z + 0.5)) * k;
      // whole people per cell, plus one more with the fractional chance
      let n = Math.floor(d);
      if (r() < d - n) n++;
      for (let i = 0; i < n; i++) {
        p.set(x + r(), z + r());
        if (p.x > Math.max(x0, x1) || p.y > Math.max(z0, z1)) continue;
        if (avoid.some((b) => b.containsPoint(p))) continue;
        out.push({ x: p.x, z: p.y });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* silhouette atlas                                                     */
/* ------------------------------------------------------------------ */

/*
 * 4 frames of 128×256 (1 m × 2 m). Channels are data, not colour:
 *   R  1 = skin, 0.5 = hair, 0 = clothes
 *   G  1 = top, ~0.4 = trousers
 *   B  1 = phone screen (frame 1)
 *   A  coverage
 */
function atlas(): THREE.CanvasTexture {
  return canvasTexture(
    'far-crowd-atlas',
    512,
    256,
    (g) => {
      g.clearRect(0, 0, 512, 256);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const PX = 128; // px per metre
      const feet = 250;
      const y = (m: number) => feet - m * PX;
      const CLOTH = 'rgb(0,255,0)';
      const LEGS = 'rgb(0,100,0)';
      const SKIN = 'rgb(255,255,0)';
      const HAIR = 'rgb(128,255,0)';
      const limb = (pts: [number, number][], w: number, col: string) => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.stroke();
      };
      // arm poses: [shoulder → elbow → hand] per side, in metres from the body centre
      type Arm = [number, number][];
      const poses: { l: Arm; r: Arm; crouch: number; phone?: boolean }[] = [
        // arms down, a little bent, hands in front of the hips
        { l: [[-0.2, 1.43], [-0.25, 1.17], [-0.17, 0.95]], r: [[0.2, 1.43], [0.26, 1.17], [0.19, 0.97]], crouch: 0 },
        // right arm up holding a phone, left down
        { l: [[-0.2, 1.43], [-0.25, 1.17], [-0.18, 0.95]], r: [[0.2, 1.43], [0.3, 1.66], [0.22, 1.93]], crouch: 0, phone: true },
        // both arms up in a V
        { l: [[-0.2, 1.43], [-0.36, 1.68], [-0.44, 1.95]], r: [[0.2, 1.43], [0.36, 1.68], [0.44, 1.95]], crouch: 0 },
        // fists up, elbows out, knees bent (jumping)
        { l: [[-0.2, 1.43], [-0.4, 1.56], [-0.27, 1.86]], r: [[0.2, 1.43], [0.4, 1.56], [0.27, 1.86]], crouch: 0.06 },
      ];
      poses.forEach((p, f) => {
        const ox = f * 128 + 64;
        const X = (m: number) => ox + m * PX;
        const c = p.crouch;
        const Y = (m: number) => y(m - c);
        // legs
        limb([[X(-0.09), Y(0.93)], [X(-0.11 - c), Y(0.5)], [X(-0.1), y(0.04)]], 17, LEGS);
        limb([[X(0.09), Y(0.93)], [X(0.11 + c), Y(0.5)], [X(0.1), y(0.04)]], 17, LEGS);
        // shoes
        g.fillStyle = LEGS;
        g.beginPath();
        g.ellipse(X(-0.1), y(0.03), 9, 5, 0, 0, Math.PI * 2);
        g.ellipse(X(0.1), y(0.03), 9, 5, 0, 0, Math.PI * 2);
        g.fill();
        // torso: shoulders to hips
        g.fillStyle = CLOTH;
        g.beginPath();
        g.moveTo(X(-0.21), Y(1.46));
        g.quadraticCurveTo(X(0), Y(1.5), X(0.21), Y(1.46));
        g.lineTo(X(0.17), Y(1.12));
        g.lineTo(X(0.16), Y(0.9));
        g.lineTo(X(-0.16), Y(0.9));
        g.lineTo(X(-0.17), Y(1.12));
        g.closePath();
        g.fill();
        // arms: sleeve to the elbow, skin below
        for (const arm of [p.l, p.r]) {
          const pts = arm.map(([ax, ay]) => [X(ax), Y(ay)] as [number, number]);
          limb([pts[0], pts[1]], 12, CLOTH);
          limb([pts[1], pts[2]], 10, SKIN);
          g.fillStyle = SKIN;
          g.beginPath();
          g.arc(pts[2][0], pts[2][1], 6, 0, Math.PI * 2);
          g.fill();
        }
        // neck, head and hair
        limb([[X(0), Y(1.47)], [X(0), Y(1.55)]], 11, SKIN);
        g.fillStyle = SKIN;
        g.beginPath();
        g.ellipse(X(0), Y(1.65), 12, 15, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = HAIR;
        g.beginPath();
        g.ellipse(X(0), Y(1.69), 12.5, 12, 0, Math.PI, Math.PI * 2);
        g.fill();
        if (p.phone) {
          // the phone in the raised hand, screen towards the stage
          const [hx, hy] = [X(p.r[2][0]), Y(p.r[2][1])];
          g.fillStyle = 'rgb(0,0,255)';
          g.fillRect(hx - 5, hy - 16, 10, 16);
        }
      });
    },
    { srgb: false },
  );
}

/* ------------------------------------------------------------------ */
/* the fixture                                                          */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */ `
  #ifdef USE_LM
    ${LIGHTMAP_GLSL}
  #endif
  attribute vec4 iData; // seed, phone, scale, skin tone
  uniform float uBeat, uBob, uHands, uJump, uCheer, uTime;
  uniform vec3 uLight, uAmb, uFocus, uWhite;
  float vh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vh(i), vh(i + vec2(1.0, 0.0)), f.x), mix(vh(i + vec2(0.0, 1.0)), vh(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  varying vec2 vUv;
  varying vec3 vTop, vLegs, vSkin, vHair, vLit;
  varying float vPhone, vY, vSeedF;
  #include <fog_pars_vertex>
  void main() {
    vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float seed = iData.x;
    float sc = iData.z;
    // the beat: knees bend once a beat, weight shifts every two
    float ph = uBeat + seed * 0.35;
    float bob = uBob * 1.7 * (0.5 - 0.5 * cos(6.28318 * ph));
    float sway = sin(3.14159 * ph + seed * 6.0) * (0.03 + uBob * 0.25);
    float jump = uJump * 0.28 * max(0.0, sin(3.14159 * fract(uBeat * 0.5 + seed)));
    // pose: arms come up with the hype and the drop, some film, jumpers on the peak
    float r = fract(seed * 7.31);
    float up = clamp(uHands * 0.75 + uCheer, 0.0, 1.0);
    float frame = 0.0;
    if (r < up) frame = fract(seed * 3.7) < 0.5 ? 2.0 : 1.0;
    if (iData.y > 0.5 && r < 0.85) frame = 1.0;
    if (frame > 1.5 && mod(floor(uBeat + seed * 4.0), 2.0) > 0.5 && uHands > 0.4) frame = 3.0;
    if (uJump > 0.2 && fract(seed * 5.3) < uJump) frame = 3.0;
    vPhone = (iData.y > 0.5 && frame == 1.0) ? 1.0 : 0.0;
    vSeedF = seed;
    float flip = fract(seed * 13.7) > 0.5 ? 1.0 : 0.0;
    float u = flip > 0.5 ? 1.0 - uv.x : uv.x;
    vUv = vec2((frame + u) * 0.25, uv.y);
    vY = uv.y;
    // a card facing the camera; it leans towards a camera that looks down on it
    vec3 toCam = cameraPosition - c;
    vec3 hz = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
    vec3 right = vec3(hz.z, 0.0, -hz.x);
    vec3 d = normalize(toCam);
    vec3 up3 = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(cross(d, right)), 0.55));
    vec3 p = c + right * ((position.x + sway * position.y) * sc) + up3 * (position.y * 2.0 * sc) + vec3(0.0, bob + jump, 0.0);
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    // clothes, skin and hair per person
    vTop = instanceColor;
    float s2 = fract(seed * 17.13);
    vLegs = s2 < 0.55 ? vec3(0.025, 0.025, 0.03) : (s2 < 0.85 ? vec3(0.04, 0.06, 0.11) : vec3(0.18, 0.16, 0.13));
    float t = iData.w;
    vSkin = mix(vec3(0.62, 0.42, 0.3), vec3(0.16, 0.09, 0.06), t);
    float h = fract(seed * 29.7);
    vHair = h < 0.6 ? vec3(0.03, 0.022, 0.018) : (h < 0.85 ? vec3(0.17, 0.1, 0.05) : vec3(0.5, 0.4, 0.22));
    // lit by the show: faces towards the light are bright, backs are silhouettes
    vec3 toFocus = uFocus - c;
    float facing = dot(normalize(vec3(toFocus.x, 0.0, toFocus.z) + vec3(1e-4, 0.0, 0.0)), hz);
    float own = 0.7 + 0.6 * fract(seed * 41.3);
    #ifdef USE_LM
      // the light landing where this person stands
      vLit = uAmb + lightMapAt(c) * (0.45 + 0.55 * max(0.0, facing)) * own * 1.1 + uLight * 0.15 * (0.2 + 0.8 * max(0.0, facing)) + uWhite;
    #else
      // pools of light sweeping over the floor (the moving heads); most people are in the dark
      float pool = smoothstep(0.58, 0.9, vn(c.xz * 0.09 + vec2(uTime * 0.11, -uTime * 0.07)));
      pool += smoothstep(0.7, 0.95, vn(c.xz * 0.05 - vec2(uTime * 0.05, uTime * 0.09) + 17.0)) * 0.6;
      vLit = uAmb + uLight * (0.2 + 0.8 * max(0.0, facing)) * (0.06 + 2.2 * pool) * own + uWhite;
    #endif
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uPhoneGlow, uPhotos, uTime;
  varying vec2 vUv;
  varying vec3 vTop, vLegs, vSkin, vHair, vLit;
  varying float vPhone, vY, vSeedF;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    if (t.a < 0.45) discard;
    vec3 base = t.g > 0.6 ? vTop : vLegs;
    base = mix(base, vHair, step(0.3, t.r) * (1.0 - step(0.75, t.r)));
    base = mix(base, vSkin, step(0.75, t.r));
    vec3 col = base * vLit * (0.55 + 0.45 * vY);
    if (vPhone > 0.5 && t.b > 0.5) {
      col = vec3(0.75, 0.85, 1.0) * uPhoneGlow;
      // a photo flash now and then after the drop
      if (uPhotos > 0.001) col += vec3(14.0) * step(1.0 - 0.06 * uPhotos, fract(sin(dot(vec2(vSeedF * 113.0, floor(uTime * 9.0 + vSeedF * 37.0)), vec2(12.9898, 78.233))) * 43758.5453));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }`;

const PALE = new THREE.Color(0.9, 0.9, 1);

export class FarCrowd implements Fixture {
  readonly object: THREE.InstancedMesh;
  private u: Record<string, THREE.IUniform>;
  private hands = 0;
  private jump = 0;
  private cheer = 0;
  private c = new THREE.Color();

  constructor(spots: FarSpot[], o: { seed?: number; clothes?: string[]; phones?: number; focus?: THREE.Vector3; lightMap?: LightMap } = {}) {
    const r = rng(o.seed ?? 7);
    const clothes = (o.clothes ?? ['#121316', '#1b1d22', '#0d0e10', '#2a2d33', '#3a2f2a', '#c9c6bf', '#4a1c22', '#1d2b3a']).map((c) => new THREE.Color(c));
    this.u = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uAtlas: { value: null },
        uBeat: { value: 0 },
        uBob: { value: 0 },
        uHands: { value: 0 },
        uJump: { value: 0 },
        uCheer: { value: 0 },
        uTime: { value: 0 },
        uLight: { value: new THREE.Color() },
        uAmb: { value: new THREE.Color(0.012, 0.012, 0.016) },
        uWhite: { value: new THREE.Color() },
        uFocus: { value: new THREE.Vector3() },
        uPhoneGlow: { value: 2 },
        uPhotos: { value: 0 },
      },
    ]);
    this.u.uAtlas.value = atlas();
    (this.u.uFocus.value as THREE.Vector3).copy(o.focus ?? new THREE.Vector3(0, 2, 0));
    if (o.lightMap) Object.assign(this.u, o.lightMap.uniforms);
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, fog: true, defines: o.lightMap ? { USE_LM: '' } : {} });
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const n = spots.length;
    const data = new Float32Array(n * 4);
    this.object = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m.makeTranslation(s.x, s.y ?? 0, s.z);
      this.object.setMatrixAt(i, m);
      this.object.setColorAt(i, this.c.copy(clothes[Math.floor(r() * clothes.length)]));
      data[i * 4] = r();
      data[i * 4 + 1] = r() < (o.phones ?? 0.06) ? 1 : 0;
      data[i * 4 + 2] = 0.9 + r() * 0.2;
      data[i * 4 + 3] = r();
    });
    geo.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4));
    this.object.computeBoundingSphere();
    // bobbing and jumping lift people above the rest-pose bounds
    this.object.boundingSphere!.radius += 1;
  }

  /** light that falls on everyone (e.g. the glow of a light field overhead) */
  ambient(c: THREE.Color): void {
    (this.u.uAmb.value as THREE.Color).setRGB(0.012 + c.r, 0.012 + c.g, 0.016 + c.b);
  }

  get count(): number {
    return this.object.count;
  }

  update(s: ShowState, dt: number): void {
    const u = this.u;
    u.uBeat.value = s.beat;
    u.uTime.value += dt;
    const hype = s.hype;
    const moving = s.playing ? 1 : 0.15;
    u.uBob.value = (0.03 + hype * 0.07 + s.peak * 0.03) * moving;
    // the same envelopes as the 3D crowd, so front and back move together
    const handsTarget = s.playing ? Math.min(1, hype * hype * 0.8 + s.peak * 0.55 + s.drop * 0.3) : 0;
    this.hands += (handsTarget - this.hands) * Math.min(1, dt * 2);
    u.uHands.value = this.hands;
    const jumpTarget = s.playing ? Math.max(0, s.peak * (0.4 + hype * 0.6) - s.build) : 0;
    this.jump += (jumpTarget - this.jump) * Math.min(1, dt * 3);
    u.uJump.value = this.jump;
    if (s.dropHit) this.cheer = 1;
    this.cheer = Math.max(this.cheer * Math.exp(-dt * 0.35), s.accent * 0.75 * (0.4 + hype * 0.6));
    u.uCheer.value = s.playing ? this.cheer : 0;
    u.uPhotos.value = s.photos;
    // light from the show: the palette's wash, the kick, strobes and blinders
    const m = s.master;
    const light = u.uLight.value as THREE.Color;
    // beams are saturated in the haze, but the light they put on people reads paler
    light.copy(s.colors[0]).lerp(s.colors[1], 0.5 + 0.5 * Math.sin(s.t * 0.4)).lerp(PALE, 0.35).multiplyScalar((0.05 + s.wash * 0.12 + s.kick * 0.1) * m);
    // strobes and blinders light everyone at once
    const w = s.flash * 0.45 + s.strobe * m * 0.25;
    (u.uWhite.value as THREE.Color).setRGB(w, w, w * 1.05);
    u.uPhoneGlow.value = 1.6 + s.flash;
  }
}
