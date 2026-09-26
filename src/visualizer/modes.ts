/*
 * Visualizer modes (GLSL). Each renders a scene that the Visualizer passes
 * through bloom, chromatic aberration and palette post-processing.
 *   warp     – infinite warp tunnel, rings pass on the beat
 *   matrix   – audio-reactive 3D spectrum bar matrix (spectrogram waterfall)
 *   galaxy   – particle galaxy with beat and drop velocity bursts
 *   grid     – frequency wave grid terrain (synthwave horizon)
 *   crt      – vintage CRT rhythm monitor (scope + bars)
 */
import * as THREE from 'three';
import type { Features } from './AudioFeatures';

export interface VisMode {
  id: string;
  name: string;
  blurb: string;
  scene: THREE.Scene;
  camera: THREE.Camera;
  update(f: Features, dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

const PALETTE = /* glsl */ `
vec3 palette(float t, float hue) {
  return 0.5 + 0.5 * cos(6.28318 * (t + hue + vec3(0.0, 0.33, 0.67)));
}
`;

function spectrumTexture(n = 256): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(n * 4), n, 1, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function writeSpectrum(t: THREE.DataTexture, spec: Float32Array): void {
  const d = t.image.data as Uint8Array;
  const n = t.image.width;
  for (let i = 0; i < n; i++) {
    const v = Math.round(spec[Math.floor((i / n) * spec.length)] * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  t.needsUpdate = true;
}

function fullscreenQuad(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  return m;
}

/* ------------------------------------------------------------------ */
/* warp tunnel                                                          */
/* ------------------------------------------------------------------ */

export function warpMode(): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const spec = spectrumTexture();
  const u = {
    uTime: { value: 0 },
    uTravel: { value: 0 },
    uKick: { value: 0 },
    uSnare: { value: 0 },
    uHigh: { value: 0 },
    uLevel: { value: 0 },
    uDrop: { value: 0 },
    uHue: { value: 0 },
    uBeat: { value: 0 },
    uRes: { value: new THREE.Vector2(16, 9) },
    uSpec: { value: spec },
  };
  const frag = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime, uTravel, uKick, uSnare, uHigh, uLevel, uDrop, uHue, uBeat;
    uniform vec2 uRes;
    uniform sampler2D uSpec;
    ${PALETTE}
    void main() {
      vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      p *= 1.0 - 0.12 * uKick;
      float twist = 0.25 * sin(uTime * 0.3);
      float r = length(p);
      float a = atan(p.y, p.x) + twist / (r + 0.2);
      float depth = 0.32 / max(r, 0.002) + uTravel;
      float ang = a / 6.28318 + 0.5;
      float rings = pow(smoothstep(0.8, 1.0, fract(depth)), 3.0);
      float spokes = smoothstep(0.93, 1.0, fract(ang * 18.0 + depth * 0.08));
      float spec = texture2D(uSpec, vec2(abs(fract(ang * 2.0) * 2.0 - 1.0) * 0.8 + 0.02, 0.5)).r;
      vec3 base = pow(palette(depth * 0.04 + ang * 0.15, uHue), vec3(1.6));
      vec3 col = base * (rings * (0.8 + 1.6 * uBeat) + spokes * (0.18 + uHigh * 0.5));
      col += pow(palette(depth * 0.03 + 0.5, uHue), vec3(1.6)) * pow(spec, 2.4) * 0.55 * smoothstep(0.05, 0.6, r);
      float glow = exp(-r * 9.0) * (0.12 + uLevel * 0.25 + uDrop * 0.6);
      col += palette(0.2, uHue) * glow;
      col *= smoothstep(0.02, 0.25, r) + glow;
      col += vec3(0.6, 0.7, 1.0) * uSnare * 0.04;
      gl_FragColor = vec4(col, 1.0);
    }`;
  scene.add(fullscreenQuad(frag, u));
  return {
    id: 'warp',
    name: 'Warp Tunnel',
    blurb: 'Infinite tunnel, a ring passes on every beat',
    scene,
    camera,
    update(f, dt) {
      u.uTime.value += dt;
      u.uTravel.value += dt * (f.bpm / 60) * (f.playing ? 1 : 0.15) * (1 + f.kickPulse * 0.6 * f.intensity);
      u.uKick.value = f.kickPulse * f.intensity;
      u.uSnare.value = f.snarePulse * f.intensity;
      u.uHigh.value = f.high;
      u.uLevel.value = f.level;
      u.uDrop.value = f.drop * f.intensity;
      u.uHue.value = f.hue;
      u.uBeat.value = f.beatPulse * f.intensity;
      writeSpectrum(spec, f.spectrum);
    },
    resize(w, h) {
      u.uRes.value.set(w, h);
    },
    dispose() {
      spec.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* spectrum matrix                                                      */
/* ------------------------------------------------------------------ */

export function matrixMode(): VisMode {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 14, 38);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  const COLS = 48;
  const ROWS = 28;
  const hist = new Float32Array(COLS * ROWS);
  const geo = new THREE.BoxGeometry(0.34, 1, 0.34);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, COLS * ROWS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const grid = new THREE.GridHelper(40, 40, 0x223044, 0x121822);
  grid.position.y = -0.01;
  scene.add(grid);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  let t = 0;
  let acc = 0;
  let shake = 0;
  return {
    id: 'matrix',
    name: 'Spectrum Matrix',
    blurb: '3D bar matrix with a scrolling spectrogram',
    scene,
    camera,
    update(f, dt) {
      t += dt;
      acc += dt;
      if (acc > 1 / 30) {
        acc = 0;
        hist.copyWithin(COLS, 0, COLS * (ROWS - 1));
        for (let c = 0; c < COLS; c++) {
          const i = Math.floor(Math.pow(c / COLS, 1.25) * 230);
          hist[c] = f.spectrum[i];
        }
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const v = hist[r * COLS + c];
          const h = 0.05 + v * v * 7 * (0.7 + f.intensity * 0.5) * (r === 0 ? 1 + f.kickPulse * 0.4 : 1);
          m4.makeScale(1, h, 1);
          m4.setPosition((c - COLS / 2) * 0.42, 0, -r * 0.55);
          mesh.setMatrixAt(r * COLS + c, m4);
          col.setHSL((f.hue + c / COLS * 0.35 + r * 0.004) % 1, 0.85, 0.12 + v * 0.55);
          col.multiplyScalar(r === 0 ? 1.6 : 1 - r / (ROWS * 1.3));
          mesh.setColorAt(r * COLS + c, col);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      shake = Math.max(shake * Math.exp(-dt * 10), f.kickPulse * 0.12 * f.intensity);
      const orbit = t * 0.08;
      camera.position.set(Math.sin(orbit) * 9 + (Math.random() - 0.5) * shake, 5.5 + Math.sin(t * 0.3) * 1.2 + (Math.random() - 0.5) * shake, 9 + Math.cos(orbit) * 3);
      camera.lookAt(0, 1.2, -5);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* particle galaxy                                                      */
/* ------------------------------------------------------------------ */

export function galaxyMode(): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
  const N = 70000;
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    seeds[i * 4] = Math.random();
    seeds[i * 4 + 1] = Math.floor(Math.random() * 3);
    seeds[i * 4 + 2] = Math.random();
    seeds[i * 4 + 3] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const u = {
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uBurst: { value: 0 },
    uHue: { value: 0 },
    uBass: { value: 0 },
    uHigh: { value: 0 },
    uPixel: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime, uSpin, uBurst, uBass, uHigh, uPixel;
      varying float vR;
      varying float vS;
      void main() {
        float r = pow(seed.x, 0.55) * 14.0;
        float arm = seed.y * 2.0943951;
        float a = arm + r * 0.42 + uSpin * (1.6 / (r + 1.2));
        float scatter = (seed.z - 0.5) * (1.8 + r * 0.12);
        vec3 p = vec3(cos(a) * r + cos(a + 1.57) * scatter, (seed.w - 0.5) * (2.2 - r * 0.12), sin(a) * r + sin(a + 1.57) * scatter);
        p *= 1.0 + uBurst * (0.25 + seed.w * 0.9);
        p.y += sin(r * 0.8 - uTime * 2.0) * uBass * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixel * (1.2 + seed.z * 2.2 + uHigh * 1.5) * (22.0 / -mv.z);
        vR = r / 14.0;
        vS = seed.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHue;
      varying float vR;
      varying float vS;
      ${PALETTE}
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = smoothstep(0.25, 0.0, d);
        vec3 col = mix(vec3(1.0, 0.95, 0.9), palette(vR * 0.6 + vS * 0.1, uHue), smoothstep(0.0, 0.35, vR));
        gl_FragColor = vec4(col * a * (0.35 + (1.0 - vR) * 0.5), 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let burst = 0;
  let t = 0;
  return {
    id: 'galaxy',
    name: 'Particle Galaxy',
    blurb: '70k particles that burst on kicks and explode on drops',
    scene,
    camera,
    update(f, dt) {
      t += dt;
      burst = Math.max(burst * Math.exp(-dt * 3.5), f.kickPulse * 0.35 * f.intensity, f.drop * 1.6 * f.intensity);
      u.uTime.value = t;
      u.uSpin.value += dt * (0.25 + f.level * 0.8 + f.drop);
      u.uBurst.value = burst;
      u.uHue.value = f.hue;
      u.uBass.value = f.sub;
      u.uHigh.value = f.high;
      camera.position.set(Math.sin(t * 0.05) * 16, 9 + Math.sin(t * 0.13) * 4, Math.cos(t * 0.05) * 16);
      camera.lookAt(0, 0, 0);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      u.uPixel.value = Math.max(0.6, h / 720);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* frequency wave grid                                                  */
/* ------------------------------------------------------------------ */

export function gridMode(): VisMode {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05020c);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 200);
  camera.position.set(0, 2.2, 7);
  camera.lookAt(0, 1.4, -20);
  const W = 96;
  const H = 96;
  const data = new Uint8Array(W * H * 4);
  const hist = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  hist.magFilter = THREE.LinearFilter;
  hist.minFilter = THREE.LinearFilter;
  hist.needsUpdate = true;
  const u = { uHist: { value: hist }, uHue: { value: 0 }, uScroll: { value: 0 }, uBeat: { value: 0 }, uLevel: { value: 0 }, uAmp: { value: 1 } };
  const geo = new THREE.PlaneGeometry(40, 60, 160, 240);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -24);
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      uniform sampler2D uHist;
      uniform float uAmp;
      varying vec2 vUv;
      varying float vH;
      void main() {
        vUv = uv;
        float x = abs(uv.x - 0.5) * 2.0;
        float v = texture2D(uHist, vec2(pow(x, 1.3) * 0.95 + 0.02, uv.y)).r;
        float edge = smoothstep(0.08, 0.5, x);
        vec3 p = position;
        p.y += v * v * 6.0 * edge * uAmp;
        vH = v * edge;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHue, uScroll, uBeat, uLevel;
      varying vec2 vUv;
      varying float vH;
      ${PALETTE}
      void main() {
        vec2 g = vec2(vUv.x * 48.0, vUv.y * 70.0 + uScroll);
        vec2 f = abs(fract(g) - 0.5);
        float line = smoothstep(0.46, 0.5, max(f.x, f.y));
        vec3 c = palette(0.62 + vH * 0.4, uHue) * line * (0.7 + uBeat * 1.4 + vH * 2.0);
        c += palette(0.8, uHue) * vH * 0.25;
        float fade = smoothstep(0.0, 0.35, vUv.y);
        gl_FragColor = vec4(c * fade, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  // sun
  const sunU = { uHue: { value: 0 }, uPulse: { value: 0 }, uTime: { value: 0 } };
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.ShaderMaterial({
      uniforms: sunU,
      transparent: true,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        uniform float uHue, uPulse, uTime;
        varying vec2 vUv;
        ${PALETTE}
        void main(){
          float y = vUv.y;
          float stripes = step(0.5, fract(y * 14.0 - uTime * 0.4)) + step(0.55, y);
          vec3 c = mix(palette(0.05, uHue), palette(0.3, uHue), y) * (1.1 + uPulse);
          gl_FragColor = vec4(c * clamp(stripes, 0.0, 1.0), clamp(stripes, 0.0, 1.0));
        }`,
    }),
  );
  sun.position.set(0, 6, -70);
  scene.add(sun);
  const stars = new THREE.BufferGeometry();
  const sp = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    sp[i * 3] = (Math.random() - 0.5) * 200;
    sp[i * 3 + 1] = 5 + Math.random() * 60;
    sp[i * 3 + 2] = -80 - Math.random() * 40;
  }
  stars.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xaab4ff, size: 0.35, sizeAttenuation: true })));
  let acc = 0;
  let t = 0;
  return {
    id: 'grid',
    name: 'Wave Grid',
    blurb: 'Neon frequency terrain racing toward a sunset',
    scene,
    camera,
    update(f, dt) {
      t += dt;
      acc += dt;
      if (acc > 1 / 40) {
        acc = 0;
        data.copyWithin(W * 4, 0, W * (H - 1) * 4);
        for (let x = 0; x < W; x++) {
          const v = Math.round(f.spectrum[Math.floor((x / W) * 200)] * 255);
          data[x * 4] = v;
          data[x * 4 + 3] = 255;
        }
        hist.needsUpdate = true;
      }
      u.uScroll.value += dt * (f.bpm / 60) * (f.playing ? 2 : 0.3);
      u.uHue.value = f.hue;
      u.uBeat.value = f.beatPulse * f.intensity;
      u.uLevel.value = f.level;
      u.uAmp.value = 0.6 + f.intensity * 0.5;
      sunU.uHue.value = f.hue;
      sunU.uPulse.value = f.kickPulse * 0.5 * f.intensity + f.drop;
      sunU.uTime.value = t;
      camera.position.y = 2.2 + f.kickPulse * 0.15 * f.intensity;
      camera.lookAt(0, 1.4, -20);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose() {
      geo.dispose();
      hist.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* CRT rhythm monitor                                                   */
/* ------------------------------------------------------------------ */

export function crtMode(): VisMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const u = { uTex: { value: tex }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(16, 9) }, uFlick: { value: 0 } };
  const frag = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform float uTime, uFlick;
    uniform vec2 uRes;
    vec2 barrel(vec2 uv) {
      vec2 c = uv * 2.0 - 1.0;
      c *= 1.0 + dot(c, c) * vec2(0.06, 0.09);
      return c * 0.5 + 0.5;
    }
    void main() {
      // fit a 4:3 tube into the frame
      vec2 uv = vUv;
      float aspect = uRes.x / uRes.y;
      uv.x = (uv.x - 0.5) * aspect / (4.0 / 3.0) + 0.5;
      vec2 b = barrel(uv);
      if (b.x < 0.0 || b.x > 1.0 || b.y < 0.0 || b.y > 1.0) { gl_FragColor = vec4(0.01, 0.012, 0.015, 1.0); return; }
      float ab = 0.0015 + uFlick * 0.004;
      vec3 col;
      col.r = texture2D(uTex, b + vec2(ab, 0.0)).r;
      col.g = texture2D(uTex, b).g;
      col.b = texture2D(uTex, b - vec2(ab, 0.0)).b;
      float scan = 0.72 + 0.28 * sin(b.y * 480.0 * 3.14159);
      float mask = 0.85 + 0.15 * sin(gl_FragCoord.x * 2.0944);
      float roll = 0.94 + 0.06 * smoothstep(0.0, 0.08, abs(fract(b.y - uTime * 0.12) - 0.5));
      vec2 v = b * (1.0 - b);
      float vig = pow(v.x * v.y * 16.0, 0.25);
      float n = fract(sin(dot(b * uTime, vec2(12.9898, 78.233))) * 43758.5453) * 0.04;
      col = col * scan * mask * roll * vig * (1.0 + uFlick * 0.3) + n;
      gl_FragColor = vec4(col * 1.5, 1.0);
    }`;
  scene.add(fullscreenQuad(frag, u));
  let t = 0;
  return {
    id: 'crt',
    name: 'CRT Monitor',
    blurb: 'Vintage phosphor scope, spectrum and beat counter',
    scene,
    camera,
    update(f, dt) {
      t += dt;
      const W = canvas.width;
      const H = canvas.height;
      g.fillStyle = 'rgba(0, 6, 3, 0.55)';
      g.fillRect(0, 0, W, H);
      const hueDeg = (f.hue * 360 + 120) % 360;
      const phos = `hsl(${hueDeg}, 100%, 62%)`;
      // header
      g.fillStyle = phos;
      g.font = '700 30px "JetBrains Mono", monospace';
      g.textBaseline = 'top';
      g.fillText(`${f.bpm.toFixed(1)} BPM`, 24, 20);
      g.font = '600 18px "JetBrains Mono", monospace';
      g.fillText(f.playing ? 'SIGNAL ▮ LIVE' : 'SIGNAL ▯ IDLE', W - 190, 26);
      // beat squares
      for (let i = 0; i < 4; i++) {
        g.strokeStyle = phos;
        g.lineWidth = 2;
        g.strokeRect(24 + i * 36, 62, 26, 14);
        if (i === f.beatInBar) g.fillRect(24 + i * 36, 62, 26, 14);
      }
      // oscilloscope
      g.strokeStyle = phos;
      g.lineWidth = 3;
      g.shadowColor = phos;
      g.shadowBlur = 12;
      g.beginPath();
      const mid = H * 0.42;
      for (let i = 0; i < 512; i++) {
        const x = (i / 511) * W;
        const y = mid + f.waveform[i] * H * 0.3 * (0.7 + f.intensity * 0.4);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
      g.shadowBlur = 0;
      // spectrum bars
      const bars = 40;
      const bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const v = f.spectrum[Math.floor((i / bars) * 240)];
        const bh = v * H * 0.28;
        g.fillStyle = phos;
        for (let y = 0; y < bh; y += 8) g.fillRect(i * bw + 2, H - 20 - y - 6, bw - 4, 5);
      }
      // kick / snare lamps
      g.fillStyle = f.kickPulse > 0.3 ? phos : 'rgba(80,120,90,0.4)';
      g.fillText('KICK', W - 190, 62);
      g.fillStyle = f.snarePulse > 0.3 ? phos : 'rgba(80,120,90,0.4)';
      g.fillText('SNARE', W - 110, 62);
      tex.needsUpdate = true;
      u.uTime.value = t;
      u.uFlick.value = f.snarePulse * 0.5 * f.intensity + f.drop * 0.5;
    },
    resize(w, h) {
      u.uRes.value.set(w, h);
    },
    dispose() {
      tex.dispose();
    },
  };
}

export const MODE_FACTORIES: (() => VisMode)[] = [warpMode, matrixMode, galaxyMode, gridMode, crtMode];
export const MODE_INFO = [
  { id: 'warp', name: 'Warp Tunnel', blurb: 'Infinite tunnel, a ring passes on every beat' },
  { id: 'matrix', name: 'Spectrum Matrix', blurb: '3D bar matrix with a scrolling spectrogram' },
  { id: 'galaxy', name: 'Particle Galaxy', blurb: '70k particles that burst on kicks and explode on drops' },
  { id: 'grid', name: 'Wave Grid', blurb: 'Neon frequency terrain racing toward a sunset' },
  { id: 'crt', name: 'CRT Monitor', blurb: 'Vintage phosphor scope, spectrum and beat counter' },
];
