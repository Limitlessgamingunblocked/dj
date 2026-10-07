/*
 * Light that lands on things. Each frame the venue paints a small top-down
 * map of the light on its floor: the pools under the moving heads, the LED
 * wall's spill over the front rows, blinders on the front rows, the glow
 * under a hanging light field. The floor and both crowds read it, so beams
 * sweeping across the room show as moving patches of light on the people
 * underneath, in the right places.
 *
 * The map is a 128 × 256 half-float target painted with soft splats (one
 * instanced draw). `lightMapAt(worldPos)` in a shader returns the light there
 * (plus a whole-room flash for strobes).
 *
 * ScreenAverage reads back the LED wall's average colour (a 4 × 4 render,
 * read asynchronously every few frames, so it never stalls the GPU), for the
 * wall's spill light.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const LIGHTMAP_GLSL = /* glsl */ `
  uniform sampler2D uLightMap;
  uniform vec2 uLMMin, uLMSize;
  uniform vec3 uLMFlash;
  vec3 lightMapAt(vec3 wp) {
    vec2 uv = (wp.xz - uLMMin) / uLMSize;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return (texture2D(uLightMap, uv).rgb + uLMFlash) * inside;
  }
  /** the painted light only (no whole-room flash) */
  vec3 lightMapPools(vec3 wp) {
    vec2 uv = clamp((wp.xz - uLMMin) / uLMSize, 0.0, 1.0);
    return texture2D(uLightMap, uv).rgb;
  }
`;

const SPLAT_VERT = /* glsl */ `
  attribute vec4 iRect; // centre x, z and half-size x, z in world metres
  attribute vec2 iRot;  // cos, sin of the turn about y
  attribute vec3 iColor;
  uniform vec2 uMin, uSize;
  varying vec2 vP;
  varying vec3 vC;
  void main() {
    vP = position.xy;
    vec2 l = position.xy * iRect.zw;
    vec2 w = iRect.xy + vec2(l.x * iRot.x - l.y * iRot.y, l.x * iRot.y + l.y * iRot.x);
    vC = iColor;
    gl_Position = vec4((w - uMin) / uSize * 2.0 - 1.0, 0.0, 1.0);
  }`;

const SPLAT_FRAG = /* glsl */ `
  varying vec2 vP;
  varying vec3 vC;
  void main() {
    float a = smoothstep(1.0, 0.0, length(vP));
    gl_FragColor = vec4(vC * a * a, 1.0);
  }`;

export class LightMap {
  readonly target: THREE.WebGLRenderTarget;
  readonly uniforms: { uLightMap: { value: THREE.Texture }; uLMMin: { value: THREE.Vector2 }; uLMSize: { value: THREE.Vector2 }; uLMFlash: { value: THREE.Color } };
  private mesh: THREE.InstancedMesh;
  private rect: THREE.InstancedBufferAttribute;
  private rot: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private n = 0;
  private scene = new THREE.Scene();
  private cam = new THREE.Camera();
  private clear = new THREE.Color();

  /** covers the floor rectangle from `min` (x, z) with `size` (x, z) metres */
  constructor(min: THREE.Vector2, size: THREE.Vector2, res: [number, number] = [128, 256], private max = 384) {
    this.target = new THREE.WebGLRenderTarget(res[0], res[1], { type: THREE.HalfFloatType, depthBuffer: false });
    this.uniforms = { uLightMap: { value: this.target.texture }, uLMMin: { value: min.clone() }, uLMSize: { value: size.clone() }, uLMFlash: { value: new THREE.Color(0, 0, 0) } };
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.rect = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.rot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iRect', this.rect);
    geo.setAttribute('iRot', this.rot);
    geo.setAttribute('iColor', this.col);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMin: { value: min.clone() }, uSize: { value: size.clone() } },
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** start a new frame of light */
  begin(): void {
    this.n = 0;
    this.uniforms.uLMFlash.value.setRGB(0, 0, 0);
  }

  /** a soft oval of light centred at (x, z) with half-sizes rx, rz, turned by `angle` about y */
  splat(x: number, z: number, rx: number, rz: number, c: THREE.Color, k = 1, angle = 0): void {
    if (this.n >= this.max || k <= 0) return;
    const i = this.n++;
    this.rect.setXYZW(i, x, z, rx, rz);
    this.rot.setXY(i, Math.cos(angle), Math.sin(angle));
    this.col.setXYZ(i, c.r * k, c.g * k, c.b * k);
  }

  /** light over the whole room this frame (strobes) */
  flash(r: number, g: number, b: number): void {
    this.uniforms.uLMFlash.value.setRGB(r, g, b);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.mesh.count = this.n;
    this.rect.needsUpdate = true;
    this.rot.needsUpdate = true;
    this.col.needsUpdate = true;
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(this.clear);
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    if (this.n) renderer.render(this.scene, this.cam);
    renderer.setClearColor(this.clear, alpha);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.target.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Light a standard material by the map: the floor or a crowd picks up the
 * light landing on it (as emitted light, times its own colour). `gain` is
 * baked into the shader.
 */
export function useLightMap(mat: THREE.Material, lm: LightMap, gain = 1): void {
  const prevCompile = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prevCompile(sh, r);
    Object.assign(sh.uniforms, lm.uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLMWorld;').replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 lmP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lmP = instanceMatrix * lmP;
      #endif
      vLMWorld = (modelMatrix * lmP).xyz;`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLMWorld;\n${LIGHTMAP_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += lightMapAt(vLMWorld) * diffuseColor.rgb * ${gain.toFixed(3)};`);
  };
  mat.customProgramCacheKey = () => `${prevKey()}|lm${gain.toFixed(3)}`;
  mat.needsUpdate = true;
}

/** The average colour of a texture (the LED wall's picture), read back without stalling. */
export class ScreenAverage {
  /** smoothed average colour (linear) */
  readonly color = new THREE.Color(0.25, 0.25, 0.25);
  private target = new THREE.Color(0.25, 0.25, 0.25);
  private rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
  private mat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null as THREE.Texture | null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tMap; varying vec2 vUv; void main() { gl_FragColor = vec4(clamp(texture2D(tMap, vUv).rgb, 0.0, 1.0), 1.0); }',
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad(this.mat);
  private buf = new Uint8Array(4 * 4 * 4);
  private pending = false;
  private frame = 0;

  update(renderer: THREE.WebGLRenderer, tex: THREE.Texture | null | undefined, dt: number): void {
    this.color.lerp(this.target, Math.min(1, dt * 8));
    if (!tex || this.pending || ++this.frame % 6) return;
    this.mat.uniforms.tMap.value = tex;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
    this.pending = true;
    renderer
      .readRenderTargetPixelsAsync(this.rt, 0, 0, 4, 4, this.buf)
      .then(() => {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < 16; i++) {
          r += this.buf[i * 4];
          g += this.buf[i * 4 + 1];
          b += this.buf[i * 4 + 2];
        }
        this.target.setRGB(r / 4080, g / 4080, b / 4080);
      })
      .catch(() => {})
      .finally(() => (this.pending = false));
  }

  dispose(): void {
    this.rt.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}
