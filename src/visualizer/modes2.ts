/*
 * More visualizer modes — full-screen shaders locked to the beat grid:
 *   lasers   – laser show: fans from three projectors sweeping through haze,
 *              gated on eighths and strobing at the peak
 *   kaleido  – kaleidoscope fractal whose symmetry changes every 4 bars
 *   strobe   – black-and-white strobe geometry, a new pattern every bar
 *   chrome   – raymarched liquid-chrome blobs pumping with the bass
 *   fractal  – flight through a neon fractal tunnel at the track's tempo
 */
import * as THREE from 'three';
import type { Features } from './AudioFeatures';
import { fullscreenQuad, PALETTE, spectrumTexture, writeSpectrum, type VisMode } from './modes';

const COMMON = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime, uBeat, uBar, uPulse, uKick, uSnare, uHigh, uSub, uLevel, uDrop, uHue, uBuild, uTravel, uI;
  uniform vec2 uRes;
  uniform sampler2D uSpec;
  ${PALETTE}
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
  vec2 screen() { return (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0); }
`;

function shaderMode(id: string, name: string, blurb: string, body: string, travelSpeed = 1): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const spec = spectrumTexture();
  const u: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uBeat: { value: 0 },
    uBar: { value: 0 },
    uPulse: { value: 0 },
    uKick: { value: 0 },
    uSnare: { value: 0 },
    uHigh: { value: 0 },
    uSub: { value: 0 },
    uLevel: { value: 0 },
    uDrop: { value: 0 },
    uHue: { value: 0 },
    uBuild: { value: 0 },
    uTravel: { value: 0 },
    uI: { value: 1 },
    uRes: { value: new THREE.Vector2(16, 9) },
    uSpec: { value: spec },
  };
  scene.add(fullscreenQuad(COMMON + body, u));
  return {
    id,
    name,
    blurb,
    scene,
    camera,
    update(f: Features, dt: number) {
      const i = f.intensity;
      u.uTime.value += dt;
      u.uBeat.value = f.beatCount + f.beatPhase;
      u.uBar.value = Math.floor(f.beatCount / 4);
      u.uPulse.value = f.beatPulse * i;
      u.uKick.value = f.kickPulse * i;
      u.uSnare.value = f.snarePulse * i;
      u.uHigh.value = f.high;
      u.uSub.value = f.sub;
      u.uLevel.value = f.level;
      u.uDrop.value = f.drop * i;
      u.uHue.value = f.hue;
      u.uBuild.value = f.breakdown;
      u.uI.value = i;
      u.uTravel.value += dt * (f.bpm / 60) * travelSpeed * (f.playing ? 1 : 0.12) * (1 + f.kickPulse * 0.5 * i);
      writeSpectrum(spec, f.spectrum);
    },
    resize(w: number, h: number) {
      (u.uRes.value as THREE.Vector2).set(w, h);
    },
    dispose() {
      spec.dispose();
    },
  };
}

export function laserMode(): VisMode {
  return shaderMode(
    'lasers',
    'Laser Show',
    'Three projectors fanning lasers through haze, gated on the beat',
    /* glsl */ `
    float beam(vec2 p, vec2 o, float a, float w) {
      vec2 d = vec2(cos(a), sin(a));
      vec2 q = p - o;
      float t = dot(q, d);
      if (t < 0.0) return 0.0;
      float dist = length(q - d * t);
      return (exp(-dist / w) + exp(-dist / (w * 9.0)) * 0.12) * exp(-t * 0.45);
    }
    void main() {
      vec2 p = screen();
      float haze = 0.45 + 0.9 * fbm(p * 2.5 + vec2(uTime * 0.07, -uTime * 0.05));
      vec3 col = vec3(0.0);
      float peak = clamp(uDrop * 1.4, 0.0, 1.0);
      float gate = mix(1.0, step(0.5, fract(uBeat * 2.0)), peak);
      for (int s = 0; s < 3; s++) {
        float fs = float(s);
        vec2 o = s == 0 ? vec2(0.0, -0.58) : vec2(fs == 1.0 ? -0.95 : 0.95, -0.52);
        float base = 1.5708 + (s == 0 ? 0.0 : (fs == 1.0 ? -0.35 : 0.35)) + sin(uBeat * 0.785 + fs * 2.1) * (0.35 + peak * 0.25);
        float spread = 0.7 + 0.45 * sin(uBeat * 0.3927 + fs) + uBuild * 0.4;
        vec3 c = pow(palette(0.05 + fs * 0.33, uHue), vec3(0.6));
        c /= max(max(c.r, c.g), max(c.b, 0.001));
        float lvl = 0.0;
        for (int i = 0; i < 12; i++) {
          float fi = float(i) / 11.0 - 0.5;
          float g = mod(float(i) + floor(uBeat * 2.0), 2.0) < 1.0 ? 1.0 : gate;
          lvl += beam(p, o, base + fi * spread, 0.0022) * g;
        }
        col += c * lvl * (0.55 + 0.45 * uPulse + uKick * 0.4);
        col += c * exp(-length(p - o) * 18.0) * (0.6 + uKick);
      }
      col *= haze;
      // floor reflection
      if (p.y < -0.5) col *= 0.35 + 0.2 * fbm(p * 8.0);
      float strobe = peak * step(0.72, fract(uBeat * 4.0));
      col += vec3(strobe * 0.35);
      col += vec3(0.02, 0.01, 0.03) * haze;
      gl_FragColor = vec4(col * (0.7 + 0.5 * uI), 1.0);
    }`,
  );
}

export function kaleidoMode(): VisMode {
  return shaderMode(
    'kaleido',
    'Kaleidoscope',
    'Fractal kaleidoscope, new symmetry every four bars, zooms on kicks',
    /* glsl */ `
    void main() {
      vec2 p = screen();
      float r = length(p);
      float a = atan(p.y, p.x) + uTime * 0.05;
      float seg = 6.0 + 2.0 * mod(floor(uBar / 4.0), 4.0);
      float sa = 6.28318 / seg;
      a = mod(a, sa);
      a = abs(a - sa * 0.5);
      p = vec2(cos(a), sin(a)) * r;
      p *= 1.6 - 0.35 * uKick - 0.25 * uDrop;
      p = rot(uTravel * 0.06) * p;
      vec3 col = vec3(0.0);
      vec2 z = p;
      for (int i = 0; i < 7; i++) {
        z = abs(z) / max(dot(z, z), 0.02) - vec2(0.72 + 0.12 * sin(uTime * 0.13), 0.55 + 0.1 * cos(uTime * 0.11));
        float fi = float(i);
        col += pow(palette(length(z) * 0.18 + fi * 0.07 + uTravel * 0.02, uHue), vec3(1.6)) * exp(-length(z) * 1.7) * 0.17;
      }
      col = 1.0 - exp(-col * 1.4);
      float spec = texture2D(uSpec, vec2(clamp(r * 0.9, 0.0, 0.95), 0.5)).r;
      col += pow(palette(0.6 + r, uHue), vec3(1.5)) * pow(spec, 3.0) * smoothstep(0.08, 0.02, abs(fract(r * 4.0 - uTravel * 0.25) - 0.5) - 0.4) * 0.8;
      col *= 0.55 + 0.5 * uPulse;
      col *= smoothstep(1.3, 0.2, r);
      gl_FragColor = vec4(col * (0.6 + 0.3 * uI), 1.0);
    }`,
  );
}

export function strobeMode(): VisMode {
  return shaderMode(
    'strobe',
    'Strobe Geometry',
    'Hard black-and-white geometry, a new pattern every bar',
    /* glsl */ `
    void main() {
      vec2 p = screen();
      float b = floor(uBeat);
      float bp = fract(uBeat);
      float pat = mod(uBar, 6.0);
      float v = 0.0;
      if (pat < 1.0) {
        float d = max(abs(p.x), abs(p.y));
        v = step(0.5, fract(d * 7.0 - uBeat));
      } else if (pat < 2.0) {
        vec2 q = rot(b * 0.7854) * p;
        v = step(0.5, fract(q.x * 6.0 + b * 0.5));
      } else if (pat < 3.0) {
        float r = length(p);
        for (int i = 0; i < 4; i++) v += smoothstep(0.03, 0.0, abs(r - fract(bp + float(i) * 0.25) * 1.2));
        v = clamp(v, 0.0, 1.0);
      } else if (pat < 4.0) {
        v = mod(floor(p.x * 7.0) + floor(p.y * 7.0) + b, 2.0);
      } else if (pat < 5.0) {
        v = smoothstep(0.05, 0.0, abs(p.x - (bp * 2.0 - 1.0) * uRes.x / uRes.y * 0.5)) + smoothstep(0.05, 0.0, abs(p.y + (bp * 2.0 - 1.0) * 0.5));
      } else {
        float tri = abs(fract((atan(p.y, p.x) / 6.28318) * 3.0 + b * 0.125) - 0.5);
        v = step(tri, 0.25) * step(length(p), 0.45 + 0.1 * uKick);
      }
      float fade = pow(1.0 - bp, 1.5);
      v *= 0.12 + 0.88 * fade;
      float drop = clamp(uDrop * 1.5, 0.0, 1.0);
      if (mod(b, 2.0) > 0.5 && drop > 0.3) v = 1.0 - v;
      float strobe = drop * step(0.65, fract(uBeat * 4.0));
      v = max(v, strobe);
      v += uSnare * 0.15 * step(0.5, hash(floor(p * 40.0) + b));
      vec3 tint = mix(vec3(1.0), pow(palette(0.0, uHue), vec3(0.5)), clamp(uI - 1.0, 0.0, 0.5) * 2.0);
      vec3 col = tint * v * 0.62;
      col += (hash(vUv * uTime) - 0.5) * 0.03;
      gl_FragColor = vec4(col, 1.0);
    }`,
  );
}

export function chromeMode(): VisMode {
  return shaderMode(
    'chrome',
    'Liquid Chrome',
    'Raymarched chrome blobs that pump with the bass',
    /* glsl */ `
    float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
    float map(vec3 p) {
      float d = 1e5;
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec3 c = vec3(sin(uTime * 0.55 + fi * 1.7), cos(uTime * 0.47 + fi * 2.3) * 0.7, sin(uTime * 0.39 + fi * 1.1) * 0.8) * (0.55 + uSub * 0.35);
        d = smin(d, length(p - c) - (0.46 + 0.1 * sin(fi * 2.0 + uTime) + uKick * 0.12), 0.7);
      }
      return d;
    }
    vec3 env(vec3 d) {
      vec3 base = mix(vec3(0.02, 0.02, 0.04), pow(palette(0.65, uHue), vec3(2.0)) * 0.35, smoothstep(-0.4, 1.0, d.y));
      float strips = smoothstep(0.9, 1.0, sin(d.y * 5.0 + uBeat * 1.5708)) * 0.8 + smoothstep(0.97, 1.0, sin(atan(d.x, d.z) * 3.0 - uTime * 0.4));
      base += pow(palette(0.1 + d.y * 0.2, uHue), vec3(0.8)) * strips * (1.2 + uPulse * 1.5);
      return base;
    }
    void main() {
      vec2 p = screen();
      vec3 ro = vec3(0.0, 0.0, 3.4);
      vec3 rd = normalize(vec3(p, -1.35));
      float yaw = uTime * 0.1;
      ro.xz = rot(yaw) * ro.xz;
      rd.xz = rot(yaw) * rd.xz;
      float t = 0.0;
      float hit = 0.0;
      for (int i = 0; i < 56; i++) {
        float d = map(ro + rd * t);
        if (d < 0.002) { hit = 1.0; break; }
        t += d * 0.9;
        if (t > 8.0) break;
      }
      vec3 col;
      if (hit > 0.5) {
        vec3 pos = ro + rd * t;
        vec2 e = vec2(0.002, -0.002);
        vec3 n = normalize(e.xyy * map(pos + e.xyy) + e.yyx * map(pos + e.yyx) + e.yxy * map(pos + e.yxy) + e.xxx * map(pos + e.xxx));
        vec3 r = reflect(rd, n);
        float fres = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
        col = env(r) * (0.55 + 0.45 * fres) + fres * 0.15;
      } else {
        col = env(rd) * 0.14;
      }
      gl_FragColor = vec4(col * (0.8 + 0.3 * uI), 1.0);
    }`,
  );
}

export function fractalMode(): VisMode {
  return shaderMode(
    'fractal',
    'Fractal Flight',
    'Fly through a neon fractal tunnel at the track’s tempo',
    /* glsl */ `
    float map(vec3 p) {
      p.xy = rot(p.z * 0.08 + uTime * 0.1) * p.xy;
      p.z = mod(p.z, 4.0) - 2.0;
      float s = 1.0;
      for (int i = 0; i < 4; i++) {
        p = abs(p) - vec3(1.3, 1.1, 0.9) * s;
        p.xy = rot(0.6 + uKick * 0.1) * p.xy;
        s *= 0.62;
      }
      vec3 q = abs(p) - vec3(0.35, 0.12, 0.35) * s * 3.0;
      return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
    }
    void main() {
      vec2 p = screen();
      vec3 ro = vec3(0.0, 0.0, -uTravel * 1.6);
      vec3 rd = normalize(vec3(p, 1.0));
      rd.xy = rot(sin(uTime * 0.2) * 0.3) * rd.xy;
      float t = 0.0;
      vec3 glow = vec3(0.0);
      for (int i = 0; i < 64; i++) {
        vec3 pos = ro + rd * t;
        float d = map(pos);
        glow += pow(palette(pos.z * 0.05 + float(i) * 0.004, uHue), vec3(1.6)) * 0.0035 / (0.03 + abs(d)) * exp(-t * 0.08);
        t += max(abs(d) * 0.7, 0.02);
        if (t > 22.0) break;
      }
      vec3 col = glow * (0.05 + 0.06 * uPulse + 0.06 * uDrop);
      col = 1.0 - exp(-col * 1.6);
      col += vec3(1.0) * uDrop * step(0.8, fract(uBeat * 4.0)) * 0.2;
      gl_FragColor = vec4(col * (0.8 + 0.3 * uI), 1.0);
    }`,
    1,
  );
}

export const MORE_MODES: (() => VisMode)[] = [laserMode, kaleidoMode, strobeMode, chromeMode, fractalMode];
export const MORE_INFO = [
  { id: 'lasers', name: 'Laser Show', blurb: 'Three projectors fanning lasers through haze, gated on the beat' },
  { id: 'kaleido', name: 'Kaleidoscope', blurb: 'Fractal kaleidoscope, new symmetry every four bars, zooms on kicks' },
  { id: 'strobe', name: 'Strobe Geometry', blurb: 'Hard black-and-white geometry, a new pattern every bar' },
  { id: 'chrome', name: 'Liquid Chrome', blurb: 'Raymarched chrome blobs that pump with the bass' },
  { id: 'fractal', name: 'Fractal Flight', blurb: 'Fly through a neon fractal tunnel at the track’s tempo' },
];
