/*
 * Auto exposure, like a camera's, metering the highlights: the HDR scene is
 * cut into 16 × 9 cells (each the average brightness of its patch, read back
 * without stalling every few frames), and the exposure keeps the brightest
 * fifth of the frame from blowing out. A log average wouldn't do: half black
 * crowd and half white beams averages "dark" while the frame is white. It stops down fast when the frame blows out (a drop's
 * blinders, a wall of white beams) and opens up slowly; the first frames of a
 * hit still land at full punch, the way they do on a stream. The range is
 * narrow on purpose: a club stays dark, it just never goes milky.
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export interface ExposureOpts {
  /** brightness the scene settles at (log-average linear luminance) */
  key: number;
  /** exposure limits */
  min: number;
  max: number;
  /** adaptation speeds, per second: stopping down, opening up */
  down: number;
  up: number;
}

/** key: where the 80th-percentile cell settles (linear, before tone mapping); dark frames just sit at max */
export const DEFAULT_EXPOSURE: ExposureOpts = { key: 0.32, min: 0.35, max: 1.12, down: 3.2, up: 0.9 };

/** The exposure to use after dt seconds, given the measured highlight level (at exposure 1). */
export function nextExposure(cur: number, measured: number, dt: number, o: ExposureOpts = DEFAULT_EXPOSURE): number {
  if (!Number.isFinite(measured) || measured <= 0) return cur;
  const want = Math.min(o.max, Math.max(o.min, o.key / measured));
  const speed = want < cur ? o.down : o.up;
  // ease in exposure stops, so a 2-stop change takes as long either way at the same speed
  const lc = Math.log2(cur);
  const lw = Math.log2(want);
  return 2 ** (lc + (lw - lc) * (1 - Math.exp(-dt * speed)));
}

/**
 * The highlight level of the frame: the cells' average brightness (log-encoded
 * bytes, see the shader) decoded to linear, and the value 80 % of the way up.
 */
export function decodeHighlights(bytes: Uint8Array, cells: number, pct = 0.8): number {
  const v: number[] = [];
  for (let i = 0; i < cells; i++) v.push(2 ** ((bytes[i * 4] / 255) * 16 - 12));
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(pct * v.length))];
}

const W = 16;
const H = 9;

/**
 * A pass after the scene render that measures it and leaves it untouched
 * (needsSwap = false). The exposure it settles on is in `exposure`.
 */
export class ExposurePass extends Pass {
  exposure = 1;
  /** the last measured highlight level (80th-percentile cell), for tuning */
  measured = 0;
  opts: ExposureOpts = { ...DEFAULT_EXPOSURE };
  private rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
  private mat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null as THREE.Texture | null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // each output pixel: the average brightness of a 4 x 4 grid across its patch, log-encoded into a byte
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap;
      varying vec2 vUv;
      void main() {
        vec2 cell = vec2(${1 / W}, ${1 / H});
        vec2 o = vUv - cell * 0.5;
        float s = 0.0;
        for (int y = 0; y < 4; y++)
          for (int x = 0; x < 4; x++) {
            vec3 c = texture2D(tMap, o + cell * (vec2(float(x), float(y)) + 0.5) / 4.0).rgb;
            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            // NaN fails the test and counts as dark
            s += l >= 0.0 && l < 65504.0 ? min(l, 64.0) : 0.0;
          }
        gl_FragColor = vec4(clamp((log2(max(s / 16.0, 1.0 / 4096.0)) + 12.0) / 16.0, 0.0, 1.0), 0.0, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad(this.mat);
  private buf = new Uint8Array(W * H * 4);
  private pending = false;
  private frame = 0;
  private last = performance.now();
  enabled = true;

  constructor() {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.measured > 0) this.exposure = nextExposure(this.exposure, this.measured, dt, this.opts);
    if (this.pending || ++this.frame % 4) return;
    this.mat.uniforms.tMap.value = read.texture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
    this.pending = true;
    renderer
      .readRenderTargetPixelsAsync(this.rt, 0, 0, W, H, this.buf)
      .then(() => (this.measured = decodeHighlights(this.buf, W * H)))
      .catch(() => {})
      .finally(() => (this.pending = false));
  }

  dispose(): void {
    this.rt.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}
