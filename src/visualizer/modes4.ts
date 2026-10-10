/*
 * The visual player's modes with memory and in 3D.
 *   echo      – Infinity Mirror: every frame folds into the last, a corridor of rings
 *   mosh      – Datamosh: the picture smears along broken motion vectors, a clean frame lands on the bar
 *   ink       – Ink Flow: coloured ink carried on a slow curl-noise current
 *   orb       – Pulse Orb: a sphere the spectrum pushes out, inside rings of particles
 *   city      – Spectrum City: a night drive through towers that grow with the music
 *   morph     – Morph Cloud: 60k points that become a new shape every four bars
 *   nameboard – Name in Lights: your DJ name on an LED marquee
 */
import * as THREE from 'three';
import { nameService } from '../name/NameService';
import type { Features } from './AudioFeatures';
import { shaderMode, type ModeInfo } from './kit';
import { PALETTE, spectrumTexture, writeSpectrum, type VisMode } from './modes';

/* ------------------------------------------------------------------ */
/* feedback modes                                                       */
/* ------------------------------------------------------------------ */

export function echoMode(): VisMode {
  return shaderMode(
    'echo',
    'Infinity Mirror',
    'Every frame folds into the last: rings fly out down an endless corridor',
    /* glsl */ `
    void main() {
      vec2 p = screen();
      float asp = uRes.x / uRes.y;
      // the last frame, pulled in a little and turned: what was drawn flies outward
      float z = 0.972 - 0.03 * uKick - 0.02 * uDrop;
      vec2 q = rot(0.006 + 0.02 * uDrop + 0.006 * sin(uTime * 0.23)) * p * z;
      vec3 prev = texture2D(uPrev, q / vec2(asp, 1.0) + 0.5).rgb;
      prev *= 0.93;
      float r = length(p);
      float ang = atan(p.y, p.x) / 6.28318 + 0.5;
      float s = spec(abs(fract(ang * 3.0) * 2.0 - 1.0) * 0.75 + 0.02);
      float R = 0.16 + s * 0.16 + uKick * 0.04;
      float ring = smoothstep(0.012, 0.0, abs(r - R));
      // the colour moves on through the bar, so the corridor carries the last few beats in rainbow
      vec3 col = neon(ang * 0.3 + uBeat * 0.0625) * ring * (0.12 + uLevel * 0.25);
      // a hexagon that turns a step on every beat
      vec2 h = rot(floor(uBeat) * 0.5236) * p;
      float hex = max(abs(h.x) * 0.866 + abs(h.y) * 0.5, abs(h.y));
      col += neon(0.5 + uBar * 0.11) * smoothstep(0.008, 0.0, abs(hex - 0.07 - uSnare * 0.05)) * (0.06 + uSnare * 0.3);
      gl_FragColor = vec4(clamp(prev + col, 0.0, 3.0), 1.0);
    }`,
    1,
    { feedback: true },
  );
}

export function moshMode(): VisMode {
  return shaderMode(
    'mosh',
    'Datamosh',
    'The picture smears along broken motion vectors; a clean frame lands on every bar',
    /* glsl */ `
    void main() {
      float asp = uRes.x / uRes.y;
      vec2 blocks = vec2(floor(asp * 16.0), 16.0);
      vec2 cell = floor(vUv * blocks);
      // new motion vectors twice a beat; most blocks hold still until the drop
      float seed = floor(uBeat * 2.0);
      vec2 mv = hash2(cell * 1.37 + seed * 7.13) - 0.5;
      mv *= step(0.62 - 0.35 * uDrop - 0.15 * uKick, hash(cell + seed * 3.1));
      mv *= (0.004 + 0.01 * uKick + 0.012 * uDrop) * vec2(1.0 / asp, 1.0);
      vec3 prev;
      prev.r = texture2D(uPrev, vUv - mv * 1.3).r;
      prev.g = texture2D(uPrev, vUv - mv).g;
      prev.b = texture2D(uPrev, vUv - mv * 0.7).b;
      prev *= 0.988;
      // the clean picture: spectrum columns and a pulsing ring
      vec2 p = screen();
      float cols = 20.0;
      float ci = floor(vUv.x * cols);
      float hgt = spec(ci / cols * 0.8 + 0.02);
      float bar = step(abs(vUv.y - 0.5), hgt * 0.42 + 0.02) * step(0.18, fract(vUv.x * cols));
      vec3 fresh = neon(ci / cols * 0.6 + uBar * 0.17) * bar;
      fresh += neon(uBar * 0.17 + 0.5) * smoothstep(0.012, 0.0, abs(length(p) - 0.18 - uKick * 0.08));
      // a keyframe lands at the top of each bar, then breaks up
      float key = smoothstep(0.05, 0.0, fract(uBeat * 0.25)) * mix(0.8, 0.5, uSafe);
      vec3 col = mix(prev, fresh, max(key, 0.025 + 0.02 * uSnare));
      // the odd corrupt block flicks to a flat colour
      float bad = step(0.986 - 0.02 * uDrop, hash(cell + floor(uTime * mix(12.0, 2.0, uSafe))));
      col = mix(col, neon(hash(cell) + uBar * 0.1) * 0.6, bad * 0.5);
      gl_FragColor = vec4(clamp(col, 0.0, 3.0), 1.0);
    }`,
    1,
    { feedback: true },
  );
}

export function inkMode(): VisMode {
  return shaderMode(
    'ink',
    'Ink Flow',
    'Coloured ink on a slow current: bass, vocal and highs each pour their own',
    /* glsl */ `
    vec2 flow(vec2 p, vec2 t) {
      float e = 0.02;
      float a = fbm(p + vec2(0.0, e) + t), b = fbm(p - vec2(0.0, e) + t);
      float c = fbm(p + vec2(e, 0.0) + t), d = fbm(p - vec2(e, 0.0) + t);
      return vec2(a - b, d - c) / (2.0 * e);
    }
    void main() {
      vec2 p = screen();
      float asp = uRes.x / uRes.y;
      vec2 v = flow(p * 1.4, vec2(uTime * 0.03, -uTime * 0.02));
      vec2 uv = vUv - v * 0.001 * (1.0 + uLevel * 1.5 + uKick * 2.0) * vec2(1.0 / asp, 1.0);
      uv -= (vUv - 0.5) * 0.002 * uKick;
      vec3 prev = texture2D(uPrev, uv).rgb * 0.992;
      vec3 ink = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 c = vec2(sin(uTime * (0.13 + fi * 0.04) + fi * 2.1) * 0.32 * asp, cos(uTime * (0.11 + fi * 0.03) + fi * 1.3) * 0.3);
        float amt = i == 0 ? uSub : (i == 1 ? uVocal : uHigh);
        ink += pal(fi * 0.31 + uTime * 0.01) * smoothstep(0.05 + amt * 0.05, 0.0, length(p - c)) * (0.015 + amt * 0.06);
      }
      // a kick drops a ring of ink in the middle
      ink += pal(0.6 + uBar * 0.07) * smoothstep(0.012, 0.0, abs(length(p) - 0.1)) * uKick * 0.2;
      vec3 col = prev + ink;
      // keep the colours: bright overlaps don't run to white
      col /= 1.0 + max(max(col.r, col.g), col.b) * 0.15;
      gl_FragColor = vec4(clamp(col, 0.0, 1.5), 1.0);
    }`,
    1,
    { feedback: true },
  );
}

/* ------------------------------------------------------------------ */
/* pulse orb                                                            */
/* ------------------------------------------------------------------ */

export function orbMode(): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);
  const spec = spectrumTexture();
  const u = {
    uTime: { value: 0 },
    uKick: { value: 0 },
    uDrop: { value: 0 },
    uLevel: { value: 0 },
    uHigh: { value: 0 },
    uHue: { value: 0 },
    uBurst: { value: 0 },
    uSpec: { value: spec },
    uWire: { value: 0 },
  };
  const vert = /* glsl */ `
    uniform sampler2D uSpec;
    uniform float uTime, uKick, uLevel, uBurst;
    varying vec3 vN;
    varying vec3 vView;
    varying float vD;
    float bump(vec3 n, float t) { return sin(n.x * 4.0 + t) * sin(n.y * 4.3 - t * 1.3) * sin(n.z * 3.7 + t * 0.7); }
    void main() {
      vec3 n = normalize(position);
      // the equator carries the low end, the poles the highs
      float band = 0.03 + abs(n.y) * 0.5 + 0.08 * (0.5 + 0.5 * sin(n.x * 5.0 + n.z * 3.0));
      float s = texture2D(uSpec, vec2(band, 0.5)).r;
      float d = s * s * 0.55 + bump(n * (1.0 + uLevel), uTime * 0.8) * (0.05 + 0.1 * uLevel) + uKick * 0.12;
      d += uBurst * 0.45 * (0.5 + 0.5 * bump(n * 2.0, uTime * 3.0));
      vD = d;
      vN = normalize(normalMatrix * n);
      vec4 mv = modelViewMatrix * vec4(n * (1.5 + d), 1.0);
      vView = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`;
  const frag = /* glsl */ `
    uniform float uHue, uWire, uKick, uDrop, uHigh;
    varying vec3 vN;
    varying vec3 vView;
    varying float vD;
    ${PALETTE}
    void main() {
      vec3 c = clamp(palette(0.55 + vD * 0.8, uHue), 0.0, 1.0);
      if (uWire > 0.5) {
        gl_FragColor = vec4(c * (0.12 + uHigh * 0.35 + uDrop * 0.3), 1.0);
        return;
      }
      float f = 1.0 - clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
      vec3 col = c * (0.03 + f * f * 1.2);
      col += clamp(palette(vD * 1.5 + 0.1, uHue), 0.0, 1.0) * smoothstep(0.15, 0.6, vD) * 0.8;
      col += vec3(f * f * f * f) * uKick * 0.4;
      gl_FragColor = vec4(col, 1.0);
    }`;
  const solidGeo = new THREE.IcosahedronGeometry(1, 28);
  const wireGeo = new THREE.IcosahedronGeometry(1, 9);
  const solidMat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag });
  const wireMat = new THREE.ShaderMaterial({
    uniforms: { ...u, uWire: { value: 1 } },
    vertexShader: vert,
    fragmentShader: frag,
    wireframe: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const solid = new THREE.Mesh(solidGeo, solidMat);
  const wire = new THREE.Mesh(wireGeo, wireMat);
  wire.scale.setScalar(1.02);
  const orb = new THREE.Group();
  orb.add(solid, wire);
  scene.add(orb);

  // two tilted rings of particles round it
  const N = 6000;
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) seeds[i] = Math.random();
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  ringGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  const ru = { uSpin: { value: 0 }, uKick: u.uKick, uDrop: u.uDrop, uSpec: u.uSpec, uHue: u.uHue, uPixel: { value: 1 } };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ru,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 seed;
      uniform float uSpin, uKick, uDrop, uPixel;
      uniform sampler2D uSpec;
      varying float vA;
      varying float vS;
      void main() {
        float a = seed.x * 6.28318 + uSpin * (0.6 + seed.y * 0.5);
        float s = texture2D(uSpec, vec2(0.04 + abs(fract(seed.x * 2.0) * 2.0 - 1.0) * 0.6, 0.5)).r;
        float r = 2.7 + seed.y * 0.9 + uKick * 0.2 + uDrop * seed.z * 1.5;
        vec3 p = vec3(cos(a) * r, (seed.z - 0.5) * (0.15 + s * s * 2.4), sin(a) * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixel * (1.0 + s * 2.0) * (10.0 / max(0.1, -mv.z));
        vA = seed.x;
        vS = s;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHue;
      varying float vA;
      varying float vS;
      ${PALETTE}
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        gl_FragColor = vec4(clamp(palette(vA * 0.5 + 0.3, uHue), 0.0, 1.0) * smoothstep(0.25, 0.0, d) * (0.25 + vS * 0.8), 1.0);
      }`,
  });
  const ringA = new THREE.Points(ringGeo, ringMat);
  const ringB = new THREE.Points(ringGeo, ringMat);
  ringA.rotation.set(0.35, 0, 0.12);
  ringB.rotation.set(-0.5, 0, -0.3);
  ringB.scale.setScalar(1.25);
  ringA.frustumCulled = ringB.frustumCulled = false;
  scene.add(ringA, ringB);

  let t = 0;
  let burst = 0;
  let shake = 0;
  return {
    id: 'orb',
    name: 'Pulse Orb',
    blurb: 'A sphere the spectrum pushes out, in rings of particles; it bursts on the drop',
    scene,
    camera,
    update(f: Features, dt: number) {
      t += dt;
      writeSpectrum(spec, f.spectrum);
      const i = f.intensity;
      burst = Math.max(burst * Math.exp(-dt * 2.5), f.drop * i);
      u.uTime.value = t;
      u.uKick.value = f.kickPulse * i;
      u.uDrop.value = f.drop * i;
      u.uLevel.value = f.level;
      u.uHigh.value = f.high;
      u.uHue.value = f.hue;
      u.uBurst.value = burst;
      ru.uSpin.value += dt * (0.3 + f.level * 0.8 + f.drop * 1.5);
      orb.rotation.y += dt * (0.15 + f.level * 0.3);
      orb.rotation.x = Math.sin(t * 0.21) * 0.3;
      shake = Math.max(shake * Math.exp(-dt * 10), f.kickPulse * 0.06 * i * f.shake);
      const r = 7.2 - f.drop * 1.2 * i;
      camera.position.set(Math.sin(t * 0.09) * r + (Math.random() - 0.5) * shake, 1.2 + Math.sin(t * 0.17) * 1.5 + (Math.random() - 0.5) * shake, Math.cos(t * 0.09) * r);
      camera.lookAt(0, 0, 0);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      ru.uPixel.value = Math.max(0.6, h / 720);
    },
    dispose() {
      spec.dispose();
      solidGeo.dispose();
      wireGeo.dispose();
      solidMat.dispose();
      wireMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* spectrum city                                                        */
/* ------------------------------------------------------------------ */

export function cityMode(): VisMode {
  const LEN = 120;
  const SKY = new THREE.Color().setRGB(0.008, 0.01, 0.028);
  const scene = new THREE.Scene();
  scene.background = SKY;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  const spec = spectrumTexture();
  const u = {
    uTravel: { value: 0 },
    uKick: { value: 0 },
    uDrop: { value: 0 },
    uHigh: { value: 0 },
    uHue: { value: 0 },
    uBeat: { value: 0 },
    uLen: { value: LEN },
    uSpec: { value: spec },
    uSky: { value: new THREE.Vector3(SKY.r, SKY.g, SKY.b) },
  };
  // twelve columns of towers either side of the road; the inner ones play the highs, the outer ones the bass
  const COLS = 6;
  const ROWS = 40;
  const cells = new Float32Array(COLS * 2 * ROWS * 4);
  let n = 0;
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < COLS; k++) {
      for (let r = 0; r < ROWS; r++) {
        cells[n++] = side * (3.6 + k * 2.6);
        cells[n++] = r * (LEN / ROWS) + Math.random() * 0.6;
        cells[n++] = (1.5 + Math.random() * 4.5) * (1 + k * 0.3);
        cells[n++] = Math.max(0.03, 0.62 - k * 0.11 + Math.random() * 0.05);
      }
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = box.index;
  geo.setAttribute('position', box.getAttribute('position'));
  geo.setAttribute('normal', box.getAttribute('normal'));
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 4));
  geo.instanceCount = COLS * 2 * ROWS;
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      attribute vec4 aCell;
      uniform sampler2D uSpec;
      uniform float uTravel, uKick, uLen;
      varying vec3 vLocal;
      varying vec3 vNrm;
      varying float vH;
      varying float vS;
      varying float vFog;
      varying float vSeed;
      void main() {
        float s = texture2D(uSpec, vec2(aCell.w, 0.5)).r;
        float h = aCell.z * (0.45 + s * s * 1.3) + 0.4 + uKick * 0.3 * aCell.w;
        float seed = fract(sin(dot(aCell.xy, vec2(12.9898, 78.233))) * 43758.5453);
        float wdt = 1.6 + seed * 0.7;
        float z = mod(aCell.y + uTravel, uLen) - uLen + 6.0;
        vLocal = vec3(position.x * wdt, position.y * h, position.z * wdt);
        vec3 p = vec3(aCell.x, 0.0, z) + vLocal;
        vNrm = normal;
        vH = h;
        vS = s;
        vSeed = seed;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFog = smoothstep(25.0, uLen - 8.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHue, uHigh, uKick, uBeat;
      uniform vec3 uSky;
      varying vec3 vLocal;
      varying vec3 vNrm;
      varying float vH;
      varying float vS;
      varying float vFog;
      varying float vSeed;
      ${PALETTE}
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 tint = clamp(palette(vSeed * 0.3 + 0.55, uHue), 0.0, 1.0);
        vec3 col = vec3(0.012, 0.014, 0.03);
        if (abs(vNrm.y) > 0.5) {
          col = tint * (0.04 + vS * 0.5);
        } else {
          float x = abs(vNrm.x) > 0.5 ? vLocal.z : vLocal.x;
          vec2 g = vec2(x * 2.2, vLocal.y * 1.6);
          vec2 id = floor(g);
          vec2 f = fract(g);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
          // windows switch on and off every couple of beats, more of them lit when the highs are busy
          float on = step(0.62 - uHigh * 0.25, hsh(id + vSeed * 91.0 + floor(uBeat * 0.5 + hsh(id) * 8.0) * 0.37));
          vec3 warm = mix(vec3(1.0, 0.72, 0.42), tint, 0.3 + 0.5 * step(0.8, hsh(id * 1.7 + vSeed)));
          col += warm * win * on * (0.35 + 0.35 * vS);
          // the LED crown at the top follows its band
          float crown = smoothstep(vH - 0.55, vH - 0.2, vLocal.y) * step(vLocal.y, vH - 0.06);
          col += tint * crown * (0.25 + vS * 1.6 + uKick * 0.4);
        }
        gl_FragColor = vec4(mix(col, uSky, vFog), 1.0);
      }`,
  });
  const towers = new THREE.Mesh(geo, mat);
  towers.frustumCulled = false;
  scene.add(towers);

  const groundGeo = new THREE.PlaneGeometry(80, LEN + 20);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, 0, -LEN / 2 + 4);
  const groundMat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      uniform float uLen;
      varying vec3 vW;
      varying float vFog;
      void main() {
        vW = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFog = smoothstep(25.0, uLen - 8.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTravel, uHue, uKick;
      uniform vec3 uSky;
      varying vec3 vW;
      varying float vFog;
      ${PALETTE}
      void main() {
        float x = vW.x;
        float z = vW.z;
        vec3 col = vec3(0.006, 0.007, 0.014);
        float road = step(abs(x), 2.6);
        col = mix(col, vec3(0.018, 0.018, 0.028), road);
        // the centre dashes and the kerbs
        col += vec3(0.5) * step(0.5, fract((z - uTravel) / 4.0)) * step(abs(x), 0.06);
        col += clamp(palette(0.55, uHue), 0.0, 1.0) * smoothstep(0.08, 0.0, abs(abs(x) - 2.6)) * (0.25 + uKick * 0.5);
        // traffic: tail lights pulling away, headlights coming the other way
        float tail = step(0.92, fract((z - uTravel * 0.45) / 7.0)) * smoothstep(0.35, 0.05, abs(x - 1.3));
        float head = step(0.94, fract((z - uTravel * 1.8) / 9.0)) * smoothstep(0.35, 0.05, abs(x + 1.3));
        col += vec3(1.0, 0.12, 0.08) * tail * 1.4 + vec3(1.0, 0.95, 0.85) * head * 1.2;
        gl_FragColor = vec4(mix(col, uSky, vFog), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(groundGeo, groundMat));

  let t = 0;
  let shake = 0;
  return {
    id: 'city',
    name: 'Spectrum City',
    blurb: 'A night drive through towers that grow with the music; bass in the tall ones at the back',
    scene,
    camera,
    update(f: Features, dt: number) {
      t += dt;
      writeSpectrum(spec, f.spectrum);
      const i = f.intensity;
      u.uTravel.value += dt * ((f.bpm || 120) / 60) * 2.2 * (f.playing ? 1 : 0.1) * (1 + f.drop * 0.8);
      u.uKick.value = f.kickPulse * i;
      u.uDrop.value = f.drop * i;
      u.uHigh.value = f.high;
      u.uHue.value = f.hue;
      u.uBeat.value = f.beatCount + f.beatPhase;
      shake = Math.max(shake * Math.exp(-dt * 10), f.kickPulse * 0.05 * i * f.shake);
      camera.position.set(Math.sin(t * 0.1) * 0.6 + (Math.random() - 0.5) * shake, 3.2 + Math.sin(t * 0.27) * 0.6 + f.drop * 1.5, 4);
      camera.lookAt(Math.sin(t * 0.07) * 1.5, 2.4, -20);
      const fov = 60 + f.drop * 10 * i;
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      spec.dispose();
      box.dispose();
      geo.dispose();
      mat.dispose();
      groundGeo.dispose();
      groundMat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* morph cloud                                                          */
/* ------------------------------------------------------------------ */

export const MORPH_SHAPES = 6;

export function morphMode(): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  const spec = spectrumTexture();
  const N = 60000;
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const u = {
    uA: { value: 0 },
    uB: { value: 1 },
    uMix: { value: 1 },
    uBurst: { value: 0 },
    uTime: { value: 0 },
    uKick: { value: 0 },
    uHue: { value: 0 },
    uPixel: { value: 1 },
    uSpec: { value: spec },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uA, uB, uMix, uBurst, uTime, uKick, uPixel;
      uniform sampler2D uSpec;
      varying float vC;
      varying float vS;
      const float PI = 3.14159265;
      vec3 shape(float k, vec4 s) {
        if (k < 0.5) {
          // sphere
          float th = s.x * 6.28318;
          float ph = acos(2.0 * s.y - 1.0);
          return vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th)) * 2.3;
        }
        if (k < 1.5) {
          // torus
          float a = s.x * 6.28318, b = s.y * 6.28318;
          return vec3((2.0 + 0.75 * cos(b)) * cos(a), 0.75 * sin(b), (2.0 + 0.75 * cos(b)) * sin(a));
        }
        if (k < 2.5) {
          // the shell of a cube
          float face = floor(s.z * 6.0);
          vec2 q = vec2(s.x, s.y) * 2.0 - 1.0;
          float sd = mod(face, 2.0) * 2.0 - 1.0;
          vec3 p = face < 2.0 ? vec3(sd, q) : (face < 4.0 ? vec3(q.x, sd, q.y) : vec3(q, sd));
          return p * 1.7;
        }
        if (k < 3.5) {
          // a double helix with rungs
          float a = s.x * 6.28318 * 2.5;
          float y = (s.x - 0.5) * 5.5;
          vec3 arm = vec3(cos(a), 0.0, sin(a)) * 1.3;
          if (s.z < 0.18) return mix(arm, -arm, s.y) + vec3(0.0, y, 0.0);
          float side = s.y < 0.5 ? 1.0 : -1.0;
          return arm * side + vec3(0.0, y, 0.0) + (vec3(s.w, s.z, s.y) - 0.5) * 0.12;
        }
        if (k < 4.5) {
          // a trefoil knot
          float t = s.x * 6.28318;
          vec3 c = vec3(sin(t) + 2.0 * sin(2.0 * t), cos(t) - 2.0 * cos(2.0 * t), -sin(3.0 * t)) * 0.75;
          return c + vec3(cos(s.y * 6.28318), sin(s.y * 6.28318), s.z - 0.5) * 0.28 * s.w;
        }
        // a rippling sheet
        vec2 q = (vec2(s.x, s.y) - 0.5) * 6.0;
        return vec3(q.x, sin(q.x * 1.3 + uTime * 1.5) * cos(q.y * 1.1 + uTime) * 0.7, q.y);
      }
      void main() {
        float m = smoothstep(0.0, 1.0, clamp(uMix * 1.4 - seed.w * 0.4, 0.0, 1.0));
        vec3 p = mix(shape(uA, seed), shape(uB, seed), m);
        // in between shapes the points swirl
        float mid = sin(m * PI);
        p += vec3(sin(seed.y * 40.0 + uTime), cos(seed.x * 37.0 - uTime), sin(seed.z * 31.0 + uTime)) * mid * 0.5;
        float s = texture2D(uSpec, vec2(0.03 + seed.x * 0.6, 0.5)).r;
        p *= 1.0 + s * s * 0.25 + uKick * 0.08;
        p += normalize(p + 0.0001) * uBurst * (0.5 + seed.w * 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixel * (1.0 + s * 1.5 + seed.z) * (7.0 / max(0.1, -mv.z));
        vC = seed.x * 0.35 + m * 0.2;
        vS = s;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHue;
      varying float vC;
      varying float vS;
      ${PALETTE}
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        gl_FragColor = vec4(clamp(palette(vC, uHue), 0.0, 1.0) * smoothstep(0.25, 0.0, d) * (0.03 + vS * 0.1), 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

  let t = 0;
  let lastBar = -1;
  let shapeB = 1;
  let burst = 0;
  const next = (avoid: number) => (avoid + 1 + Math.floor(Math.random() * (MORPH_SHAPES - 1))) % MORPH_SHAPES;
  const morphTo = (k: number) => {
    u.uA.value = shapeB;
    shapeB = k;
    u.uB.value = k;
    u.uMix.value = 0;
  };
  return {
    id: 'morph',
    name: 'Morph Cloud',
    blurb: '60k points that become a new shape every four bars and blow apart on the drop',
    scene,
    camera,
    update(f: Features, dt: number) {
      t += dt;
      writeSpectrum(spec, f.spectrum);
      const i = f.intensity;
      const bar = Math.floor(f.beatCount / 4);
      if (f.dropHit) morphTo(next(shapeB));
      else if (bar !== lastBar && bar % 4 === 0 && f.playing) morphTo(next(shapeB));
      lastBar = bar;
      // a morph takes two beats
      u.uMix.value = Math.min(1, u.uMix.value + dt * ((f.bpm || 120) / 60) * 0.5);
      burst = Math.max(burst * Math.exp(-dt * 2.2), f.drop * 1.2 * i);
      u.uBurst.value = burst;
      u.uTime.value = t;
      u.uKick.value = f.kickPulse * i;
      u.uHue.value = f.hue;
      pts.rotation.y += dt * (0.18 + f.level * 0.5);
      pts.rotation.x = Math.sin(t * 0.13) * 0.35;
      const r = 8.5 - f.drop * 1.5 * i;
      camera.position.set(Math.sin(t * 0.05) * r, 1.5 + Math.sin(t * 0.11) * 1.2, Math.cos(t * 0.05) * r);
      camera.lookAt(0, 0, 0);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      u.uPixel.value = Math.max(0.6, h / 720);
    },
    dispose() {
      spec.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* name in lights                                                       */
/* ------------------------------------------------------------------ */

/** the name band is this many dots tall */
const TEXT_ROWS = 20;

export function nameboardMode(): VisMode {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const tex = canvas ? new THREE.CanvasTexture(canvas) : new THREE.DataTexture(new Uint8Array(4), 1, 1);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  let drawn = '';
  const draw = () => {
    if (!canvas) return;
    const text = `${nameService.text}   •   `;
    drawn = nameService.text;
    const g = canvas.getContext('2d')!;
    const font = `700 ${TEXT_ROWS - 2}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.font = font;
    canvas.width = Math.max(8, Math.ceil(g.measureText(text).width));
    canvas.height = TEXT_ROWS;
    g.font = font;
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.fillText(text, 0, TEXT_ROWS / 2 + 1);
    tex.dispose();
    tex.needsUpdate = true;
    extra.uTextW.value = canvas.width;
  };
  const extra = { uText: { value: tex as THREE.Texture }, uTextW: { value: 64 }, uScroll: { value: 0 } };
  // web fonts land after the first draw
  if (typeof document !== 'undefined' && document.fonts) void document.fonts.ready.then(() => (drawn = ''));
  let scroll = 0;
  return shaderMode(
    'nameboard',
    'Name in Lights',
    'Your DJ name on an LED marquee, with a spectrum and a chaser that runs on the beat',
    /* glsl */ `
    uniform sampler2D uText;
    uniform float uTextW, uScroll;
    void main() {
      float asp = uRes.x / uRes.y;
      float rows = 45.0;
      float cols = floor(rows * asp);
      vec2 g = vUv * vec2(cols, rows);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float led = smoothstep(0.46, 0.26, length(f));
      vec3 c = vec3(0.0);
      float lit = 0.0;
      // the name, stepping along one dot at a time
      float ty = id.y - 13.0;
      if (ty >= 0.0 && ty < ${TEXT_ROWS}.0) {
        float tx = mod(id.x + uScroll, uTextW);
        float on = step(0.45, texture2D(uText, vec2((tx + 0.5) / uTextW, (ty + 0.5) / ${TEXT_ROWS}.0)).r);
        vec3 tc = mix(neon(0.0), neon(id.x / cols - uBeat * 0.25), clamp(uDrop * 1.5, 0.0, 1.0));
        float shine = smoothstep(5.0, 0.0, abs(id.x - fract(uBeat * 0.25) * (cols + 20.0) + 10.0));
        c += tc * on * (0.9 + shine * 0.8 + uKick * 0.35);
        lit = max(lit, on);
      }
      // the spectrum along the bottom, mirrored from the middle
      if (id.y >= 2.0 && id.y < 12.0) {
        float xm = abs(id.x - cols * 0.5 + 0.5) / (cols * 0.5);
        float on = step(id.y - 1.5, spec(0.02 + xm * 0.7) * 10.0);
        c += mix(neon(0.35), neon(0.0), (id.y - 2.0) / 10.0) * on * 0.85;
        lit = max(lit, on);
      }
      // the chaser: a light runs along the top on every beat
      if (id.y >= 37.0 && id.y < 40.0) {
        float d = fract(uBeat) * (cols + 10.0) - id.x;
        float on = step(0.0, d) * step(d, 10.0) * (1.0 - d / 10.0);
        c += neon(0.6) * on;
        lit = max(lit, step(0.01, on));
      }
      // the four beats of the bar
      if (id.y >= 41.0 && id.y < 43.0) {
        float k = floor((id.x - 2.0) / 4.0);
        float on = step(0.0, k) * step(k, 3.0) * step(0.5, mod(id.x - 2.0, 4.0)) * step(k, mod(floor(uBeat), 4.0));
        c += neon(0.25) * on * 0.9;
        lit = max(lit, on);
      }
      // marquee bulbs round the edge
      if (id.y < 1.0 || id.y > rows - 2.0 || id.x < 1.0 || id.x > cols - 2.0) {
        float on = step(0.5, fract((id.x + id.y - floor(uBeat * mix(4.0, 1.0, uSafe))) / 4.0));
        c += neon(0.12) * on * 0.8;
        lit = max(lit, on);
      }
      vec3 col = (c + vec3(0.03, 0.028, 0.035) * (1.0 - lit)) * led;
      // on the drop the whole board pulses the colour
      col += neon(0.0) * led * uDrop * gate(2.0, 0.25) * 0.4 * flashAmp();
      gl_FragColor = vec4(col, 1.0);
    }`,
    1,
    {
      uniforms: extra,
      update(_u, f, dt) {
        if (nameService.text !== drawn) draw();
        scroll += dt * (f.playing ? ((f.bpm || 120) / 60) * 4 : 2);
        extra.uScroll.value = Math.floor(scroll) % Math.max(1, extra.uTextW.value);
      },
      dispose() {
        tex.dispose();
      },
    },
  );
}

export const MODES4: (() => VisMode)[] = [echoMode, moshMode, inkMode, orbMode, cityMode, morphMode, nameboardMode];

export const INFO4: ModeInfo[] = [
  { id: 'echo', name: 'Infinity Mirror', blurb: 'Every frame folds into the last: rings fly out down an endless corridor', energy: 'mid' },
  { id: 'mosh', name: 'Datamosh', blurb: 'The picture smears along broken motion vectors; a clean frame lands on every bar', energy: 'peak' },
  { id: 'ink', name: 'Ink Flow', blurb: 'Coloured ink on a slow current: bass, vocal and highs each pour their own', energy: 'calm' },
  { id: 'orb', name: 'Pulse Orb', blurb: 'A sphere the spectrum pushes out, in rings of particles; it bursts on the drop', energy: 'peak' },
  { id: 'city', name: 'Spectrum City', blurb: 'A night drive through towers that grow with the music', energy: 'mid' },
  { id: 'morph', name: 'Morph Cloud', blurb: '60k points that become a new shape every four bars and blow apart on the drop', energy: 'mid' },
  { id: 'nameboard', name: 'Name in Lights', blurb: 'Your DJ name on an LED marquee, with a spectrum and a beat chaser', energy: 'mid' },
];
