/*
 * Depth of field for photo mode: a real lens's blur from the scene's depth.
 *   – how blurred each pixel is (the circle of confusion) from how far it is
 *     from the focus distance, scaled by the aperture (f/1.4 is shallow, f/16
 *     keeps it all sharp)
 *   – the blur gathers a golden-angle disc of taps, turned at random per
 *     pixel so small highlights don't print the pattern; a tap only counts if
 *     it's blurred enough to reach this pixel, and things behind the focus
 *     don't bleed over a sharp subject in front
 *   – bright taps weigh more, so the stage's lights open into round bokeh
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { DepthTap } from './ao';
import { FINITE_GLSL } from './lens';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tColor, tDist;
  uniform float uFocus, uAperture, uMaxBlur;
  uniform vec2 uTexel;
  varying vec2 vUv;
  ${FINITE_GLSL}
  // metres from the camera (the depth tap's copy: the depth buffer itself has been drawn over by now)
  float linearDepth(vec2 uv) {
    return texture2D(tDist, uv).x;
  }
  // signed circle of confusion in pixels: + behind the focus, − in front
  float coc(float z) {
    return clamp((z - uFocus) / max(z, 1e-3) * uAperture, -1.0, 1.0) * uMaxBlur;
  }
  void main() {
    float z0 = linearDepth(vUv);
    float c0 = coc(z0);
    vec3 base = finite3(texture2D(tColor, vUv).rgb);
    float r0 = abs(c0);
    if (r0 < 0.5) {
      gl_FragColor = vec4(base, 1.0);
      return;
    }
    vec3 acc = base;
    float wsum = 1.0;
    // the spiral turned by a different angle at every pixel: a small bright speck
    // spreads into a soft disc, not a flower of the taps' own pattern
    float spin = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
    for (int i = 0; i < 48; i++) {
      float fi = float(i);
      float rr = sqrt((fi + 0.5) / 48.0) * r0;
      float a = fi * 2.39996 + spin;
      vec2 off = vec2(cos(a), sin(a)) * rr * uTexel;
      vec2 uv = vUv + off;
      float z = linearDepth(uv);
      float c = coc(z);
      // a tap reaches here if its own blur is at least as wide as the distance; in front, it always can
      float reach = smoothstep(rr - 1.5, rr + 0.5, abs(c));
      float front = step(z, z0 + 0.05);
      float w = mix(reach, max(reach, smoothstep(rr - 1.0, rr, r0)), front);
      vec3 col = finite3(texture2D(tColor, uv).rgb);
      // highlights bloom into bokeh
      w *= 1.0 + dot(col, vec3(0.3, 0.5, 0.2)) * 2.0;
      acc += col * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, 1.0);
  }
`;

/** blur radius (px) for a depth, focus distance and aperture: the same as the shader's */
export function cocPx(z: number, focus: number, aperture: number, maxBlur: number): number {
  return Math.max(-1, Math.min(1, ((z - focus) / Math.max(z, 1e-3)) * aperture)) * maxBlur;
}

/** f-number to the shader's aperture scale: f/1.4 very shallow, f/16 nearly all sharp */
export function apertureScale(fNumber: number): number {
  return 2.8 / Math.max(1, fNumber);
}

export class DofPass extends Pass {
  /** metres to the plane in focus */
  focus = 3;
  /** f-number */
  fNumber = 2.8;
  private mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;

  constructor(private tap: DepthTap) {
    super();
    this.needsSwap = true;
    this.enabled = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDist: { value: null },
        uFocus: { value: 3 },
        uAperture: { value: 1 },
        uMaxBlur: { value: 14 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(width: number, height: number): void {
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
    // the widest blur scales with the picture
    this.mat.uniforms.uMaxBlur.value = Math.max(6, height / 48);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.mat.uniforms;
    // keep the distance copy coming (the first frame after turning on has none yet: sharp for a frame)
    this.tap.requestDistance();
    const dist = this.tap.distance;
    u.tColor.value = readBuffer.texture;
    u.tDist.value = dist;
    u.uFocus.value = this.focus;
    u.uAperture.value = dist ? apertureScale(this.fNumber) : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}
