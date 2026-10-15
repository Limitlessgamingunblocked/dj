/*
 * Two modes for long nights.
 *   film      – Black & White 16mm: two thin white rings that turn one notch
 *               on every beat, shot on grainy black-and-white film (gate
 *               weave, 24 fps flicker, grain, dust, a hair in the gate, the
 *               odd scratch, halation, a vignette and the gate's round
 *               corners). A build strobes the projector; the drop flips the
 *               frame to a negative for a beat (a slow, soft fade with
 *               flashing reduced). Made for deep minimal.
 *   sculpture – Your Set as a Sculpture: every track played this session is
 *               a glowing ribbon drawn from its own audio (setHistory.ts),
 *               rising round one spiral; a mix braids the two tracks'
 *               ribbons. The camera orbits the growing tip, a light rides it
 *               on the kick, and a breakdown pulls back to the whole set.
 */
import * as THREE from 'three';
import type { Features } from './AudioFeatures';
import { shaderMode, type ModeInfo } from './kit';
import type { VisMode } from './modes';
import { place, rung, sessionSet, setLabel, spiral, spiralAngle, STEP, ARC, type RGB, type Ribbon, type SetHistory } from './setHistory';

/* ------------------------------------------------------------------ */
/* black & white 16mm                                                   */
/* ------------------------------------------------------------------ */

/** how far the rings turn each beat */
export const NOTCH = Math.PI / 8;
/** the part of the beat the notch takes; the rest of the beat they hold still */
export const NOTCH_EASE = 0.2;

/** the rings' turn, in notches: one a beat, eased over the first fifth of it */
export function filmNotch(beat: number): number {
  const b = Math.floor(beat);
  const x = Math.min(1, Math.max(0, (beat - b) / NOTCH_EASE));
  return b + 1 - (1 - x) * (1 - x) * (1 - x);
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * How negative the frame is, `since` beats after the drop: all the way for a
 * beat, then straight back. With flashing reduced, a slower, softer fade:
 * in over three quarters of a beat, out over a beat and a half, never all the way.
 */
export function negativeAt(since: number, safe: boolean): number {
  if (!(since >= 0)) return 0;
  if (!safe) return since < 1 ? 1 : 0;
  return 0.8 * Math.min(smooth(since / 0.75), 1 - smooth((since - 1.25) / 1.5));
}

export function filmMode(): VisMode {
  const rotA = new THREE.Matrix3();
  const rotB = new THREE.Matrix3();
  const extra = {
    uRotA: { value: rotA },
    uRotB: { value: rotB },
    uFrame: { value: 0 },
    uNeg: { value: 0 },
  };
  const m4 = new THREE.Matrix4();
  const e = new THREE.Euler();
  const pose = (m: THREE.Matrix3, x: number, y: number, z: number) => m.setFromMatrix4(m4.makeRotationFromEuler(e.set(x, y, z))).transpose();
  let clock = 0;
  let frame = -1;
  let dropBeat = Number.NaN;
  const mode = shaderMode(
    'film',
    'Black & White 16mm',
    'Two thin rings turn a notch on every beat, on grainy black-and-white film; the drop flips it to a negative',
    /* glsl */ `
    uniform mat3 uRotA, uRotB;
    uniform float uFrame, uNeg;
    float sdTorus(vec3 p, float R, float r) { return length(vec2(length(p.xz) - R, p.y)) - r; }
    float map(vec3 p) {
      return min(sdTorus(uRotA * p, 0.95, 0.016), sdTorus(uRotB * p, 0.62, 0.012));
    }
    vec3 nrm(vec3 p) {
      vec2 e = vec2(0.0008, 0.0);
      return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
    }
    float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
    void main() {
      float asp = uRes.x / uRes.y;
      // one film frame: the frame number, kept small so the hashes stay sharp
      float fr = mod(uFrame, 997.0);
      float ft = mod(uTime, 1000.0);
      // gate weave: a slow drift and a little jitter every frame, a jump on the snare
      float fw = mod(uFrame, 4096.0);
      vec2 weave = (vec2(noise(vec2(fw * 0.05, 1.3)), noise(vec2(fw * 0.04, 7.1))) - 0.5) * vec2(0.004, 0.007);
      weave += (hash2(vec2(fr, 3.7)) - 0.5) * vec2(0.0012, 0.0022) * (1.0 + uSnare * 1.5);
      vec2 uv = vUv + weave;
      vec2 p = (uv - 0.5) * vec2(asp, 1.0);

      // everything below is worked out as it looks on screen (v, 0 black, 1 white) and squared to light at the end
      // the rings, lit like a still life: a key from the upper left, a rim from behind
      vec3 ro = vec3(0.0, 0.0, 3.8);
      vec3 rd = normalize(vec3(p, -1.4));
      float t = 0.0;
      float glow = 0.0;
      float hit = 0.0;
      for (int i = 0; i < 96; i++) {
        float d = map(ro + rd * t);
        glow += exp(-d * 40.0) * 0.01;
        if (d < 0.0003) { hit = 1.0; break; }
        t += d * 0.85;
        if (t > 7.0) break;
      }
      vec3 L = normalize(vec3(-0.55, 0.75, 0.6));
      float v;
      if (hit > 0.5) {
        vec3 q = ro + rd * t;
        vec3 n = nrm(q);
        float dif = max(dot(n, L), 0.0);
        float spe = pow(max(dot(reflect(rd, n), L), 0.0), 40.0);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        v = 0.16 + 0.62 * dif + 0.75 * spe * (1.0 + uKick * 0.3) + 0.3 * rim;
      } else {
        // a backdrop in a soft pool of light, the rings' shadow faint on it
        vec3 bp = ro + rd * ((-1.6 - ro.z) / rd.z);
        vec2 pc = bp.xy - vec2(0.45, 0.35);
        float pool = exp(-dot(pc, pc) * 0.16);
        float sh = 1.0;
        float st = 0.05;
        for (int i = 0; i < 20; i++) {
          float d = map(bp + L * st);
          sh = min(sh, 16.0 * d / st);
          st += clamp(d, 0.03, 0.3);
          if (st > 3.2) break;
        }
        v = 0.04 + 0.2 * pool * (0.4 + 0.6 * clamp(sh, 0.0, 1.0));
      }
      // halation: highlights bleed into the emulsion round the rings
      v += glow * (0.24 + uKick * 0.2);

      // the projector: 24 fps flicker, a little uneven across the frame, breathing slowly
      float flick = 0.94 + 0.08 * hash1(fr * 1.71) + 0.025 * sin(ft * 1.3);
      flick *= 1.0 + (hash1(fr * 3.93) - 0.5) * 0.08 * (vUv.x - 0.5);
      v *= flick;
      // a build strobes the shutter, faster the deeper it goes (once a beat and gentler with flashing reduced)
      float bk = smoothstep(0.35, 1.0, uBuild);
      float per = uBuild > 0.85 ? 4.0 : (uBuild > 0.65 ? 2.0 : 1.0);
      v *= 1.0 - bk * 0.75 * flashAmp() * (1.0 - gate(per, 0.5));

      // grain: new every frame, about a pixel and a half, a touch heavier in the build
      float gs = max(1.0, uRes.y / 720.0) * 1.4;
      vec2 gp = floor(gl_FragCoord.xy / gs);
      vec2 go = vec2(hash1(fr * 0.71), hash1(fr * 1.93)) * 300.0;
      float grain = hash(gp + go) + hash(gp * 1.37 + go.yx + 17.0) - 1.0;
      v += grain * (0.05 + 0.03 * bk) * (0.55 + 0.45 * min(v, 1.0));

      // dust: specks for a frame or two, mostly dark, now and then a bright one
      vec2 sp = vUv * vec2(asp, 1.0);
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float k = floor(fr * 0.5) + fi * 17.0;
        if (hash1(k * 1.37) > 0.22) continue;
        vec2 c = vec2(hash1(k * 2.11 + 0.3) * asp, hash1(k * 1.31 + 0.7));
        float rad = 0.0012 + 0.0055 * hash1(k * 0.73) * hash1(k * 0.91);
        vec2 q = sp - c;
        float d = length(q * vec2(1.0, 0.7 + hash1(k * 4.1) * 0.6)) - rad * (0.65 + 0.7 * noise(q * 900.0 + fi * 9.0));
        float m = smoothstep(0.0011, 0.0, d);
        v = mix(v, hash1(k * 5.3) > 0.78 ? 1.0 : 0.0, m * 0.9);
      }
      // a hair caught in the gate: it stays a second or so, twitching
      float hw = floor(ft / 1.6);
      if (hash1(hw * 3.17) < 0.28) {
        vec2 hc = vec2(hash1(hw * 1.9) * asp, 0.12 + hash1(hw * 2.7) * 0.76);
        float ang = hash1(hw * 5.1) * 6.28318;
        vec2 q = rot(ang) * (sp - hc) + (hash2(vec2(fr, hw)) - 0.5) * 0.0015;
        float len = 0.035 + 0.05 * hash1(hw * 7.7);
        float y = q.y - (q.x * q.x) * (3.0 + 6.0 * hash1(hw * 8.3)) - sin(q.x * 90.0) * 0.0015;
        float m = smoothstep(0.0011, 0.0, abs(y)) * smoothstep(len, len * 0.8, abs(q.x));
        v = mix(v, 0.0, m * 0.85);
      }
      // the odd vertical scratch: it wanders a little and breaks up along the frame
      float sw = floor(ft * 0.55);
      if (hash1(sw * 1.13 + 4.0) > 0.58) {
        float sx = hash1(sw * 2.9) * asp + sin(ft * 3.1 + sw) * 0.0015 + (hash1(fr * 0.37) - 0.5) * 0.0008;
        float m = smoothstep(0.0012, 0.0, abs(sp.x - sx)) * step(0.32, noise(vec2(vUv.y * 9.0, fr * 0.37)));
        v += m * (0.3 + 0.25 * hash1(fr * 2.3));
      }

      // the drop: a negative (a slow, soft, dimmer one with flashing reduced)
      float white = mix(1.0, 0.65, uSafe);
      v = mix(clamp(v, 0.0, 1.4), white - clamp(v, 0.0, white), uNeg);

      // the projected frame: a soft vignette and the gate's round, slightly rough corners
      vec2 c2 = vUv - 0.5;
      v *= 1.0 - 0.55 * pow(clamp(length(c2 * vec2(1.0, 0.92)) * 1.3, 0.0, 1.0), 2.2);
      vec2 g = c2 * vec2(asp, 1.0);
      float edge = sdBox2(g, vec2(0.5 * asp - 0.05, 0.45)) - 0.035 + (noise(g * 70.0) - 0.5) * 0.0025;
      v *= smoothstep(0.003, -0.004, edge);

      // to light, and silver rather than grey: the faintest warmth in the highlights
      v = max(v, 0.0);
      vec3 col = vec3(v * v) * mix(vec3(1.0), vec3(1.0, 0.97, 0.93), clamp(v, 0.0, 1.0));
      gl_FragColor = vec4(clamp(col, 0.0, 2.0), 1.0);
    }`,
    1,
    {
      uniforms: extra,
      update(_u, f: Features, dt: number) {
        clock += dt;
        const beat = f.beatCount + f.beatPhase;
        if (f.dropHit) dropBeat = beat;
        // the camera runs at 24 frames a second: the picture (and the notch) only moves on a new frame
        const now = Math.floor(clock * 24);
        if (now !== frame) {
          frame = now;
          const a = filmNotch(beat) * NOTCH;
          pose(rotA, a, a * 0.5 + 0.4, 0.15);
          pose(rotB, 1.2 + a * 0.7, -a * 1.3, 0);
          extra.uFrame.value = frame;
          extra.uNeg.value = negativeAt(beat - dropBeat, (f.safe ?? 0) > 0.5);
        }
      },
    },
  );
  mode.mono = true;
  return mode;
}

/* ------------------------------------------------------------------ */
/* your set as a sculpture                                              */
/* ------------------------------------------------------------------ */

/** dashes of the path ahead of the tip, and how long each (in beats, gap included) */
const GHOST = 40;
const DASH = 3;
/** ribbons with their own colour (more wrap round) */
const COLORS = 256;
const BEHIND = 192;

/**
 * The whole sculpture is one instanced draw of camera-facing segments: for
 * every sample a rung (its reach the audio) and a stretch of spine to the
 * next sample, plus the dashed path ahead of the tip.
 */
export function sculptureMode(set: SetHistory = sessionSet): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 600);
  scene.add(camera);
  const MAX = GHOST + (set === sessionSet ? 2 * 12200 : 4096);
  const quad = new THREE.InstancedBufferGeometry();
  // x along the segment (0..1), y across it (-1..1)
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const A = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const B = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  // ribbon colour slot, the set's beat, kind (0 spine, 1 rung, 2 path ahead), the gap to the next rung
  const I = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  quad.setAttribute('aA', A);
  quad.setAttribute('aB', B);
  quad.setAttribute('aInfo', I);
  quad.instanceCount = 0;
  const colorData = new Uint8Array(COLORS * 4);
  const colorTex = new THREE.DataTexture(colorData, COLORS, 1, THREE.RGBAFormat);
  colorTex.magFilter = colorTex.minFilter = THREE.NearestFilter;
  colorTex.needsUpdate = true;
  const u = {
    uColors: { value: colorTex },
    uRes: { value: new THREE.Vector2(960, 540) },
    uHead: { value: 0 },
    uKick: { value: 0 },
    uKickAge: { value: 9 },
    uDrop: { value: 0 },
    uOld: { value: 1 },
    uFocus: { value: 8 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aA;
      attribute vec3 aB;
      attribute vec4 aInfo;
      uniform vec2 uRes;
      uniform float uHead, uKick, uKickAge, uDrop, uOld, uFocus;
      uniform sampler2D uColors;
      varying vec3 vCol;
      varying float vAcross;
      varying float vAlong;
      varying float vKind;
      void main() {
        float kind = aInfo.z;
        vec4 ca = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
        vec4 cb = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
        if (ca.w < 0.05 || cb.w < 0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec2 half_ = uRes * 0.5;
        vec2 sa = ca.xy / ca.w * half_;
        vec2 sb = cb.xy / cb.w * half_;
        vec2 d = sb - sa;
        float len = length(d);
        vec2 dir = len > 0.001 ? d / len : vec2(0.0, 1.0);
        vec2 nrm = vec2(-dir.y, dir.x);
        float w = mix(ca.w, cb.w, position.x);
        float ppu = projectionMatrix[1][1] * half_.y / w;
        // a world width at this depth, never under about a pixel and a half
        float worldW = kind < 0.5 ? 0.02 : (kind < 1.5 ? 0.012 : 0.014);
        float px = worldW * ppu;
        float hw = max(0.75, px * 0.5) + (kind < 0.5 ? 1.0 : 0.0);
        vec2 s = mix(sa, sb, position.x) + nrm * position.y * hw + dir * (position.x * 2.0 - 1.0) * (kind < 0.5 ? hw * 0.6 : 0.0);
        gl_Position = vec4(s / half_ * w, mix(ca.z, cb.z, position.x), w);

        vec3 c = texture2D(uColors, vec2((mod(aInfo.x, ${COLORS}.0) + 0.5) / ${COLORS}.0, 0.5)).rgb;
        float age = max(0.0, uHead - aInfo.y);
        // the newest stretch glows, older tracks settle (less so pulled back to the whole set)
        float b = mix(0.42, 0.62, uOld) + 0.6 * exp(-age / 40.0);
        // every kick sends a light back down the sculpture
        b += 1.1 * exp(-abs(age - uKickAge * 24.0) / 3.0) * exp(-uKickAge * 1.6);
        b *= 1.0 + uDrop * 0.6;
        // depth: what's nearer than the middle of the shot is brighter, the far side dimmer
        b *= clamp(1.0 - (w - uFocus) / (uFocus * 1.3), 0.35, 1.3);
        float thin = clamp(px * 0.5 / hw, 0.3, 1.0);
        if (kind > 1.5) {
          // the path still to come: faint dashes, fading out ahead
          b = 0.16 * exp(-max(0.0, aInfo.y - uHead) / 70.0) * smoothstep(0.0, 4.0, aInfo.y - uHead);
          c = mix(c, vec3(1.0), 0.5);
        } else if (kind > 0.5) {
          // rungs overlap when they're closer than they're wide: share the light so the band stays even
          float gap = aInfo.w * ppu;
          b *= 0.55 / max(1.0, 2.0 * hw / max(gap, 0.001));
        } else {
          b *= 0.9 * thin;
        }
        vCol = c * b;
        vAcross = position.y;
        vAlong = position.x;
        vKind = kind;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vAcross;
      varying float vAlong;
      varying float vKind;
      void main() {
        float a = 1.0 - abs(vAcross);
        float prof = a * a;
        vec3 c = vCol * prof;
        if (vKind < 0.5) {
          // the spine: a white-hot core in the ribbon's colour
          c += vec3(dot(vCol, vec3(0.33))) * smoothstep(0.55, 1.0, a) * 0.6;
        } else if (vKind < 1.5) {
          // the rung's ends draw the outline of the sound
          c *= 1.0 + 0.9 * (smoothstep(0.86, 1.0, vAlong) + smoothstep(0.14, 0.0, vAlong));
        }
        gl_FragColor = vec4(clamp(c, 0.0, 6.0), 1.0);
      }`,
  });
  const ribbons = new THREE.Mesh(quad, mat);
  ribbons.frustumCulled = false;
  scene.add(ribbons);

  // the playhead: a light at each growing tip, beating with the kick
  const heads = 4;
  const headPos = new Float32Array(heads * 3);
  const headCol = new Float32Array(heads * 4);
  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3).setUsage(THREE.DynamicDrawUsage));
  headGeo.setAttribute('aCol', new THREE.BufferAttribute(headCol, 4).setUsage(THREE.DynamicDrawUsage));
  headGeo.setDrawRange(0, 0);
  const hu = { uPixel: { value: 1 }, uKick: u.uKick };
  const headMat = new THREE.ShaderMaterial({
    uniforms: hu,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aCol;
      uniform float uPixel, uKick;
      varying vec4 vCol;
      void main() {
        vCol = aCol;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uPixel * (56.0 + 44.0 * uKick) * aCol.a;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uKick;
      varying vec4 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = smoothstep(0.16, 0.0, r);
        float halo = exp(-r * 5.0) * (0.7 + uKick * 1.2);
        // a thin flare across the tip, longer on the kick
        vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
        float flare = smoothstep(0.05, 0.0, q.y) * (1.0 - q.x) * (0.3 + uKick * 0.9);
        vec3 c = mix(vCol.rgb, vec3(1.0), 0.7) * core * (3.0 + uKick * 3.0) + vCol.rgb * (halo + flare);
        gl_FragColor = vec4(clamp(c, 0.0, 6.0), 1.0);
      }`,
  });
  const headPts = new THREE.Points(headGeo, headMat);
  headPts.frustumCulled = false;
  scene.add(headPts);

  // dust in the air round it, so the orbit reads as space
  const DUST = 900;
  const dust = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    const r = 18 + Math.random() * 90;
    const th = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.35) * 80;
    dust[i * 3] = Math.cos(th) * r;
    dust[i * 3 + 1] = y;
    dust[i * 3 + 2] = Math.sin(th) * r;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0x5a6274, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const dustPts = new THREE.Points(dustGeo, dustMat);
  dustPts.frustumCulled = false;
  scene.add(dustPts);

  // a small caption: which track, or which two are mixing
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const CW = 1024;
  const CH = 64;
  if (canvas) {
    canvas.width = CW;
    canvas.height = CH;
  }
  const labelTex = canvas ? new THREE.CanvasTexture(canvas) : null;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: labelTex, color: 0x8c8b86, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  label.renderOrder = 10;
  label.frustumCulled = false;
  label.visible = false;
  camera.add(label);
  let labelText = '';
  let aspect = 16 / 9;
  const placeLabel = () => {
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfW = halfH * aspect;
    const hgt = halfH * 2 * 0.032;
    label.scale.set(hgt * (CW / CH), hgt, 1);
    const m = halfH * 0.07;
    label.position.set(-halfW + m + (hgt * (CW / CH)) / 2, -halfH + m + hgt / 2, -1);
  };
  const drawLabel = (text: string) => {
    if (!canvas || !labelTex || text === labelText) return;
    labelText = text;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = '#000';
    g.fillRect(0, 0, CW, CH);
    g.font = '500 30px "JetBrains Mono", ui-monospace, monospace';
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '5px';
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(text.toUpperCase(), 4, CH / 2 + 1);
    labelTex.needsUpdate = true;
    label.visible = true;
  };
  if (typeof document !== 'undefined' && document.fonts) void document.fonts.ready.then(() => (labelText = ''));

  /* keeping the instances in step with the history */
  let rev = -1;
  let cursor = GHOST;
  const written = new Map<Ribbon, { n: number; spine: number }>();
  let lo = Infinity;
  let hi = -1;
  const pos: RGB = [0, 0, 0];
  const dir: RGB = [0, 0, 0];
  const put = (i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, slot: number, s: number, kind: number, gap: number) => {
    A.array[i * 3] = ax;
    A.array[i * 3 + 1] = ay;
    A.array[i * 3 + 2] = az;
    B.array[i * 3] = bx;
    B.array[i * 3 + 1] = by;
    B.array[i * 3 + 2] = bz;
    I.array[i * 4] = slot;
    I.array[i * 4 + 1] = s;
    I.array[i * 4 + 2] = kind;
    I.array[i * 4 + 3] = gap;
    lo = Math.min(lo, i);
    hi = Math.max(hi, i);
  };
  const writeRibbon = (r: Ribbon) => {
    let w = written.get(r);
    if (!w) written.set(r, (w = { n: 0, spine: -1 }));
    const slot = (r.n - 1) % COLORS;
    for (let k = w.n; k < r.s.length; k++) {
      if (cursor + 2 > MAX) return;
      const s = r.s[k];
      place(s, r.side, r.mix[k], pos, dir);
      const [down, up] = rung(r.level[k], r.kick[k], r.sub[k]);
      const gap = ((k > 0 ? s - r.s[k - 1] : STEP) || STEP) * ARC;
      put(cursor, pos[0] - dir[0] * down, pos[1] - dir[1] * down, pos[2] - dir[2] * down, pos[0] + dir[0] * up, pos[1] + dir[1] * up, pos[2] + dir[2] * up, slot, s, 1, gap);
      // the spine so far ends here; this sample's own stretch waits for the next one
      if (w.spine >= 0) {
        B.array[w.spine * 3] = pos[0];
        B.array[w.spine * 3 + 1] = pos[1];
        B.array[w.spine * 3 + 2] = pos[2];
        lo = Math.min(lo, w.spine);
      }
      put(cursor + 1, pos[0], pos[1], pos[2], pos[0], pos[1], pos[2], slot, s, 0, gap);
      w.spine = cursor + 1;
      cursor += 2;
      w.n = k + 1;
    }
  };
  const sync = () => {
    if (set.revision !== rev || cursor + 2 * set.open.length + 2 > MAX) {
      rev = set.revision;
      written.clear();
      cursor = GHOST;
    }
    for (const r of set.ribbons) writeRibbon(r);
    quad.instanceCount = cursor;
  };
  /** upload what changed: the dashes ahead (every frame) and the new samples */
  const flush = (from: number, to: number) => {
    for (const [attr, n] of [[A, 3], [B, 3], [I, 4]] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, GHOST * n);
      if (to >= from) attr.addUpdateRange(from * n, (to - from + 1) * n);
      attr.needsUpdate = true;
    }
    lo = Infinity;
    hi = -1;
  };

  /* colours: each ribbon's, eased when its song's look arrives */
  const colorNow = new Float32Array(COLORS * 3);
  const colorSet = new Uint8Array(COLORS);
  const syncColors = (dt: number) => {
    const k = Math.min(1, dt * 1.5);
    let dirty = false;
    for (const r of set.ribbons.slice(-COLORS)) {
      const slot = (r.n - 1) % COLORS;
      for (let c = 0; c < 3; c++) {
        const i = slot * 3 + c;
        const target = r.color[c];
        colorNow[i] = colorSet[slot] ? colorNow[i] + (target - colorNow[i]) * k : target;
        const v = Math.round(Math.min(1, Math.max(0, colorNow[i])) * 255);
        if (colorData[slot * 4 + c] !== v) {
          colorData[slot * 4 + c] = v;
          dirty = true;
        }
      }
      colorSet[slot] = 1;
      colorData[slot * 4 + 3] = 255;
    }
    if (dirty) colorTex.needsUpdate = true;
  };

  /* framing: a bounding sphere round a stretch of the spiral */
  const box = new THREE.Box3();
  const tmp = new THREE.Vector3();
  const pt: RGB = [0, 0, 0];
  const frameOf = (s0: number, s1: number, out: THREE.Sphere) => {
    box.makeEmpty();
    const n = 24;
    for (let i = 0; i <= n; i++) {
      spiral(s0 + ((s1 - s0) * i) / n, pt);
      box.expandByPoint(tmp.set(pt[0], pt[1], pt[2]));
    }
    box.expandByScalar(0.45);
    box.getBoundingSphere(out);
    out.radius = Math.max(out.radius, 2.2);
    return out;
  };
  const near = new THREE.Sphere();
  const whole = new THREE.Sphere();
  const look = new THREE.Vector3();
  let dist = 8;
  let pull = 0;
  let t = 0;
  let kickAge = 9;
  let first = true;
  return {
    id: 'sculpture',
    name: 'Your Set as a Sculpture',
    blurb: 'Every track you play is a ribbon drawn from its sound; mixes braid them, and the sculpture grows all night',
    scene,
    camera,
    update(f: Features, dt: number) {
      t += dt;
      sync();
      const from = lo;
      const to = hi;
      syncColors(dt);
      const head = set.beat;
      const open = set.ribbons.filter((r) => r.open && r.s.length);
      // the path ahead of the tip, in dashes that stay put as the tip reaches them
      const ahead = Math.ceil((head + 2) / DASH) * DASH;
      const lead = open.length ? (open[open.length - 1].n - 1) % COLORS : 0;
      for (let g = 0; g < GHOST; g++) {
        const s0 = ahead + g * DASH;
        spiral(s0, pos);
        spiral(s0 + DASH * 0.5, dir);
        put(g, pos[0], pos[1], pos[2], dir[0], dir[1], dir[2], lead, s0, 2, 1);
      }
      flush(from, to);
      // the playheads: one on each ribbon still growing (or the start of the path, waiting)
      let nh = 0;
      for (const r of open.slice(-heads)) {
        const k = r.s.length - 1;
        place(r.s[k], r.side, r.mix[k], pos, dir);
        headPos.set(pos, nh * 3);
        headCol.set([...r.color, r.quiet > 0 ? 0.5 : 1], nh * 4);
        nh++;
      }
      if (!nh) {
        spiral(head, pos);
        headPos.set(pos, 0);
        headCol.set([0.8, 0.8, 0.85, 0.35 + 0.15 * Math.sin(t * 2)], 0);
        nh = 1;
      }
      headGeo.setDrawRange(0, nh);
      (headGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (headGeo.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;

      // the camera orbits; a breakdown (or the music stopping) pulls back to the whole set
      const i = f.intensity;
      kickAge = f.kickHit ? 0 : kickAge + (dt * (f.bpm || 120)) / 60;
      const want = Math.max(f.breakdown > 0.35 ? Math.min(1, (f.breakdown - 0.35) / 0.4) : 0, f.playing ? 0 : 0.65);
      pull += (want - pull) * Math.min(1, dt * 0.45);
      frameOf(Math.max(0, head - BEHIND), head + 24, near);
      frameOf(0, head + 8, whole);
      tmp.lerpVectors(near.center, whole.center, pull);
      const radius = near.radius + (whole.radius - near.radius) * pull;
      const fit = Math.min(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
      const want2 = (radius / Math.sin(Math.atan(fit))) * (0.9 - 0.1 * f.drop * i);
      const k = first ? 1 : Math.min(1, dt * 0.9);
      dist += (want2 - dist) * k;
      look.lerp(tmp, k);
      first = false;
      // swing round the newest stretch from outside the spiral, square on to its middle (from inside,
      // older turns would block the view; end on, a short first track would look like a stub);
      // pulled back, the swing widens round the whole set
      const orbit = spiralAngle((Math.max(0, head - BEHIND) + head + 24) / 2) + (0.85 + 1.3 * pull) * Math.sin(t * 0.05 + 0.6);
      const el = 0.32 + 0.28 * pull + 0.07 * Math.sin(t * 0.07);
      camera.position.set(look.x + Math.cos(orbit) * Math.cos(el) * dist, look.y + Math.sin(el) * dist, look.z + Math.sin(orbit) * Math.cos(el) * dist);
      camera.lookAt(look);
      camera.far = Math.max(200, dist * 4 + 200);
      camera.updateProjectionMatrix();

      u.uHead.value = head;
      u.uKick.value = f.kickPulse * i;
      u.uKickAge.value = f.playing ? kickAge : 9;
      u.uDrop.value = f.drop * i;
      u.uOld.value = pull;
      u.uFocus.value = dist;
      dustMat.opacity = 0.35 + 0.25 * pull;
      drawLabel(setLabel(open.filter((r) => r.quiet === 0).map((r) => r.n), set.ribbons.length, pull > 0.6));
    },
    resize(w: number, h: number) {
      aspect = w / h;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      u.uRes.value.set(w, h);
      hu.uPixel.value = Math.max(0.6, h / 720);
      placeLabel();
    },
    dispose() {
      quad.dispose();
      mat.dispose();
      colorTex.dispose();
      headGeo.dispose();
      headMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      label.geometry.dispose();
      (label.material as THREE.Material).dispose();
      labelTex?.dispose();
    },
  };
}

export const MODES5: (() => VisMode)[] = [filmMode, () => sculptureMode()];

export const INFO5: ModeInfo[] = [
  { id: 'film', name: 'Black & White 16mm', blurb: 'Two thin rings turn a notch on every beat, on grainy black-and-white film', energy: 'calm' },
  { id: 'sculpture', name: 'Your Set as a Sculpture', blurb: 'Every track you play is a ribbon drawn from its sound; mixes braid them, all night', energy: 'mid' },
];
