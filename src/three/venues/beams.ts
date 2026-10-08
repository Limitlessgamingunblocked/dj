/*
 * Moving-head beams as light in a volume, not tubes.
 *
 * Each beam is still one open cone mesh per head (instanced), but its fragment
 * shader is a little volume renderer: it intersects the view ray with the cone
 * analytically, then marches along the part of the ray inside the beam (1, 4
 * or 7 steps by effects tier) and adds up:
 *   – the haze there (one sample of the shared haze field, plus wisps along it)
 *   – the beam's field: an even top with a soft edge, no hard rim
 *   – the gobo in the beam's cross-section (spokes, a ring of dots, organic
 *     breakup, rings, or open), turning with the music: its shadows run the
 *     length of the beam as "fingers" through the haze
 *   – falloff with distance (the light spreads over a growing disc)
 *   – forward scattering (Henyey–Greenstein): look into a beam and it blazes
 *   – absorption: the sum saturates (1 − e^−kx), so a beam seen end-on glows
 *     hard but a crowd of them can't white the frame out
 * Front faces carry the whole chord; back faces are drawn only when the camera
 * is inside the beam, so nothing is counted twice. The same gobo is projected
 * where the beam lands on the floor.
 *
 * The prism splits each head into three beams round its axis (the extra two
 * instances are scaled away when it's out).
 */
import type { ShowState } from './show';

/** gobo patterns: 0 open, 1 spokes, 2 ring of dots, 3 breakup, 4 rings */
export const GOBOS = ['open', 'spokes', 'dots', 'breakup', 'rings'] as const;
export type Gobo = (typeof GOBOS)[number];

export const GOBO_GLSL = /* glsl */ `
  // gobo transmission at polar (phi, rr): rr 0 = beam centre, 1 = edge
  float goboAt(float id, float phi, float rr) {
    if (id < 0.5) return 1.0;
    if (id < 1.5) {
      // six spokes with a small open centre
      float s = 0.5 + 0.5 * cos(phi * 6.0);
      return max(smoothstep(0.38, 0.62, s), 1.0 - smoothstep(0.1, 0.18, rr));
    }
    if (id < 2.5) {
      // a ring of eight dots and a centre dot
      float a = (fract(phi * 1.27324 + 0.5) - 0.5) * 2.2;
      float d = length(vec2(a, (rr - 0.62) * 2.6));
      return max(1.0 - smoothstep(0.32, 0.48, d), 1.0 - smoothstep(0.13, 0.2, rr));
    }
    if (id < 3.5) {
      // organic breakup: leafy patches
      vec2 q = vec2(cos(phi), sin(phi)) * rr * 3.2;
      float n = sin(q.x * 2.1 + sin(q.y * 1.7)) * sin(q.y * 2.3 + sin(q.x * 1.3));
      return smoothstep(-0.15, 0.25, n);
    }
    // concentric rings
    return smoothstep(0.25, 0.55, 0.5 + 0.5 * cos(rr * 19.0));
  }
`;

export const BEAM_VERT = /* glsl */ `
  attribute vec2 aGobo;
  varying vec3 vW;
  varying vec3 vColor;
  varying vec3 vLens;
  varying vec3 vAxis;
  varying vec3 vX;
  varying vec3 vZ;
  varying vec2 vGobo;
  uniform float uLensY;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 w = m * vec4(position, 1.0);
    vW = w.xyz;
    vLens = (m * vec4(0.0, uLensY, 0.0, 1.0)).xyz;
    mat3 r = mat3(m);
    vAxis = normalize(r * vec3(0.0, -1.0, 0.0));
    vX = normalize(r * vec3(1.0, 0.0, 0.0));
    vZ = normalize(r * vec3(0.0, 0.0, 1.0));
    vColor = instanceColor;
    vGobo = aGobo;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export const BEAM_FRAG = (haze: string) => /* glsl */ `
  uniform float uTime;
  uniform float uHaze;
  uniform float uSmoke;
  uniform float uDust;
  uniform vec2 uBand;
  uniform float uLen;
  uniform float uR0;
  uniform float uR1;
  uniform float uSteps;
  uniform float uGain;
  varying vec3 vW;
  varying vec3 vColor;
  varying vec3 vLens;
  varying vec3 vAxis;
  varying vec3 vX;
  varying vec3 vZ;
  varying vec2 vGobo;
  ${haze}
  ${GOBO_GLSL}
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    if (dot(vColor, vec3(1.0)) < 1e-4) discard;
    float tanA = max(1e-4, (uR1 - uR0) / uLen);
    float k = 1.0 + tanA * tanA;
    // the cone's apex sits behind the lens; the beam runs from the lens (h0) to its far end
    float h0 = uR0 / tanA;
    vec3 A = vLens - vAxis * h0;
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vW - ro);
    vec3 co = ro - A;
    float dv = dot(rd, vAxis);
    float cv = dot(co, vAxis);
    // inside the cone: |x|^2 <= k h^2 with h >= 0; f(t) = a t^2 + 2 b t + c
    float a = 1.0 - k * dv * dv;
    float b = dot(co, rd) - k * cv * dv;
    float c = dot(co, co) - k * cv * cv;
    float tIn = -1e9;
    float tOut = 1e9;
    float disc = b * b - a * c;
    if (abs(a) < 1e-5) {
      if (abs(b) < 1e-7) discard;
      float t = -c / (2.0 * b);
      if (b < 0.0) tIn = t; else tOut = t;
    } else if (disc >= 0.0) {
      float sq = sqrt(disc);
      float r0 = (-b - sq) / a;
      float r1 = (-b + sq) / a;
      float lo = min(r0, r1);
      float hi = max(r0, r1);
      if (a > 0.0) { tIn = lo; tOut = hi; }
      else if (dv > 0.0) tIn = hi;
      else tOut = lo;
    } else if (a > 0.0) discard;
    // between the lens and the far end
    if (abs(dv) > 1e-6) {
      float ta = (h0 - cv) / dv;
      float tb = (h0 + uLen - cv) / dv;
      tIn = max(tIn, min(ta, tb));
      tOut = min(tOut, max(ta, tb));
    } else if (cv < h0 || cv > h0 + uLen) discard;
    tIn = max(tIn, 0.0);
    // camera inside the beam: only its inside walls (back faces) are drawn, else only front faces
    float hc = cv;
    float rc = length(co - hc * vAxis);
    bool inside = hc > h0 && hc < h0 + uLen && rc < hc * tanA;
    if (gl_FrontFacing == inside) discard;
    float len = tOut - tIn;
    if (len <= 1e-4) discard;

    // the haze: one sample of the shared field at the middle of the chord (noise is the
    // expensive part); along the chord, cheap wisps, or true noise at two points on high
    vec3 pa = ro + rd * tIn;
    vec3 pb = ro + rd * tOut;
    float hm = hazeAt((pa + pb) * 0.5, uTime, uBand, uSmoke);
    float steps = uSteps;
    float w1 = 1.0;
    float w2 = 1.0;
    if (steps > 6.5) {
      w1 = 0.7 + 0.6 * hzN(mix(pa, pb, 0.3) * 1.7 + vec3(0.0, uTime * 0.2, uTime * 0.1));
      w2 = 0.7 + 0.6 * hzN(mix(pa, pb, 0.7) * 1.7 + vec3(0.0, uTime * 0.2, uTime * 0.1));
    }
    float j = ign(gl_FragCoord.xy + fract(uTime * 7.0) * 37.0);
    float acc = 0.0;
    for (int i = 0; i < 7; i++) {
      if (float(i) >= steps) break;
      float u = (float(i) + (steps > 1.5 ? j : 0.5)) / steps;
      vec3 p = ro + rd * (tIn + len * u);
      vec3 rel = p - A;
      float h = max(1e-4, dot(rel, vAxis));
      vec3 rv = rel - vAxis * h;
      float rr = length(rv) / (h * tanA);
      float phi = atan(dot(rv, vZ), dot(rv, vX)) + vGobo.y;
      // an even field with a defined edge (a soft one reads as milk), a little hotter in the middle
      float field = 1.0 - smoothstep(0.8, 1.0, rr);
      field *= 0.7 + 0.3 * exp(-rr * rr * 5.0);
      float g = goboAt(vGobo.x, phi, rr);
      // the light spreads over a growing disc: dimmer further out
      float spread = h0 / h;
      float fall = mix(1.0, spread, 0.6) * (1.0 - smoothstep(0.82, 1.0, (h - h0) / uLen));
      float wisp = steps > 1.5 ? mix(w1, w2, u) * (0.85 + 0.15 * sin(dot(p, vec3(1.3, 0.7, 1.1)) * 2.0 + uTime * 0.6)) : 1.0;
      acc += field * g * fall * wisp;
    }
    acc *= (len / steps) * (0.25 + 1.4 * hm);
    // the haze absorbs as well as scatters: a long look down a beam glows but saturates
    // (1 - e^-kx)/k is the plain sum for a side-on beam and levels off end-on
    acc = (1.0 - exp(-acc * 7.0)) / 7.0;
    // forward scattering: brighter looking up into the beam (normalised to 1 side-on)
    float cosT = dot(vAxis, -rd);
    float gg = 0.5;
    float den = 1.0 + gg * gg - 2.0 * gg * cosT;
    float phase = ((1.0 - gg * gg) / (den * sqrt(den))) / ((1.0 - gg * gg) / ((1.0 + gg * gg) * sqrt(1.0 + gg * gg)));
    // from inside a beam, looking up it, the lens is a flare (the lens pass does that), not a wall of light
    phase = inside ? min(phase, 1.2) : min(phase, 2.5);
    float near = inside ? 0.22 : mix(0.3, 1.0, smoothstep(0.5, 4.0, tIn));
    // a beam right in front of the lens fills the frame: up close it reads as a glow, not a wall
    float hE = max(1e-3, dot(pa - A, vAxis));
    float apparent = (hE * tanA) / max(0.25, tIn);
    near /= 1.0 + apparent * 4.0;
    // dust drifting through the light, on the near surface
    vec3 cell = floor(pa * 6.0 + vec3(0.0, uTime * 0.5, 0.0));
    float dust = step(0.9965, fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453)) * uDust;
    vec3 col = vColor * (acc * phase * uGain * near + dust * 0.6) * uHaze;
    // one beam never fills the frame on its own
    gl_FragColor = vec4(min(col, vec3(1.6)), 1.0);
  }`;

/** CPU twin of the shader's ray / cone test (for tests): the part of the ray inside the beam, or null */
export function coneInterval(ro: [number, number, number], rd: [number, number, number], lens: [number, number, number], axis: [number, number, number], r0: number, r1: number, len: number): [number, number] | null {
  const dot = (p: number[], q: number[]) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const tanA = Math.max(1e-4, (r1 - r0) / len);
  const k = 1 + tanA * tanA;
  const h0 = r0 / tanA;
  const A = [lens[0] - axis[0] * h0, lens[1] - axis[1] * h0, lens[2] - axis[2] * h0];
  const co = [ro[0] - A[0], ro[1] - A[1], ro[2] - A[2]];
  const dv = dot(rd, axis);
  const cv = dot(co, axis);
  const a = 1 - k * dv * dv;
  const b = dot(co, rd) - k * cv * dv;
  const c = dot(co, co) - k * cv * cv;
  let tIn = -1e9;
  let tOut = 1e9;
  const disc = b * b - a * c;
  if (Math.abs(a) < 1e-5) {
    if (Math.abs(b) < 1e-7) return null;
    const t = -c / (2 * b);
    if (b < 0) tIn = t;
    else tOut = t;
  } else if (disc >= 0) {
    const sq = Math.sqrt(disc);
    const lo = Math.min((-b - sq) / a, (-b + sq) / a);
    const hi = Math.max((-b - sq) / a, (-b + sq) / a);
    if (a > 0) {
      tIn = lo;
      tOut = hi;
    } else if (dv > 0) tIn = hi;
    else tOut = lo;
  } else if (a > 0) return null;
  if (Math.abs(dv) > 1e-6) {
    const ta = (h0 - cv) / dv;
    const tb = (h0 + len - cv) / dv;
    tIn = Math.max(tIn, Math.min(ta, tb));
    tOut = Math.min(tOut, Math.max(ta, tb));
  } else if (cv < h0 || cv > h0 + len) return null;
  tIn = Math.max(tIn, 0);
  return tOut - tIn > 1e-4 ? [tIn, tOut] : null;
}

/**
 * The gobo and how it turns, from the music: dots turning slowly through a
 * breakdown, spokes spinning up with the build, the prism and open beams at
 * the peak, a different texture every 8 bars of the groove. Alternate heads
 * turn the other way.
 */
export function goboFor(s: Pick<ShowState, 'build' | 'peak' | 'bar' | 'beat' | 'playing'>, i: number): { gobo: number; spin: number; prism: boolean } {
  const dir = i % 2 ? -1 : 1;
  if (!s.playing) return { gobo: 3, spin: s.beat * 0.05 * dir, prism: false };
  if (s.peak > 0.5) {
    // open beams with the prism, spokes on every other 4 bars
    const spokes = Math.floor(s.bar / 4) % 2 === 1;
    return { gobo: spokes ? 1 : 0, spin: s.beat * 0.6 * dir, prism: true };
  }
  if (s.build > 0.6) return { gobo: 1, spin: s.beat * (0.15 + s.build * 0.9) * dir, prism: s.build > 0.85 };
  if (s.build > 0.25) return { gobo: 2, spin: s.beat * 0.08 * dir, prism: false };
  const cycle = [3, 0, 4, 2];
  const g = cycle[(((Math.floor(s.bar / 8) + (i % 2)) % 4) + 4) % 4];
  return { gobo: g, spin: s.beat * 0.12 * dir, prism: false };
}

/** the three prism beams' directions round the head's axis: [turn about the axis, tilt off it] */
export function prismFacets(spin: number, spread = 0.11): [number, number][] {
  return [0, 1, 2].map((k) => [spin + (k * Math.PI * 2) / 3, spread]);
}
