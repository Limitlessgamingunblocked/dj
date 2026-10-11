/*
 * Ambient occlusion: the soft shadow where things meet (under the booth, in
 * the corners, between people, where a wall meets the floor) that stops a
 * scene looking pasted together.
 *
 * Screen space, from the depth of the frame that was just drawn: no second
 * render of the scene. Half resolution:
 *   1. a scalable-ambient-obscurance estimate: 12 taps spiralling round
 *      each pixel, each one asking how far a nearby surface sits in front of
 *      this one's tangent plane, within a radius in metres
 *   2. a two-pass blur that keeps edges (it won't smear across a depth step)
 *   3. composite: the frame times the occlusion. Bright pixels (LED walls,
 *      beams, lasers, lamps) are spared, since light doesn't sit in shadow,
 *      and it fades out with distance, where it only adds noise.
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { FINITE_GLSL } from './lens';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const AO_FRAG = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv;
  uniform float uProjScale, uRadius, uBias, uIntensity, uFadeNear, uFadeFar;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 viewAt(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float d0 = texture2D(tDepth, vUv).x;
    if (d0 >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
    vec3 P = viewAt(vUv);
    // the normal from the neighbours on whichever side is flatter (no halos at depth steps)
    vec3 px1 = viewAt(vUv + vec2(uTexel.x, 0.0)) - P;
    vec3 px2 = P - viewAt(vUv - vec2(uTexel.x, 0.0));
    vec3 py1 = viewAt(vUv + vec2(0.0, uTexel.y)) - P;
    vec3 py2 = P - viewAt(vUv - vec2(0.0, uTexel.y));
    vec3 dx = abs(px1.z) < abs(px2.z) ? px1 : px2;
    vec3 dy = abs(py1.z) < abs(py2.z) ? py1 : py2;
    vec3 n = normalize(cross(dx, dy));
    float dist = -P.z;
    // the radius in screen space, shrinking with distance
    float rs = uRadius * uProjScale / max(0.1, dist);
    // a 4x4 interleaved pattern of rotations: structured noise the blur removes cleanly
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    float rot = (cell.x * 4.0 + cell.y) * 0.3927 + hash(cell) * 0.2;
    float occ = 0.0;
    float r2 = uRadius * uRadius;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float a = rot + fi * 2.39996;
      float s = (fi + 0.5) / 12.0;
      vec2 off = vec2(cos(a), sin(a)) * rs * s;
      vec3 v = viewAt(vUv + off) - P;
      float vv = dot(v, v);
      float vn = dot(v, n);
      float f = max(0.0, r2 - vv);
      occ += f * f * f * max(0.0, (vn - uBias * dist) / (vv + 0.01));
    }
    occ /= r2 * r2 * r2;
    float ao = clamp(1.0 - uIntensity * 9.0 * occ / 12.0, 0.0, 1.0);
    ao = ao * ao;
    ao = mix(ao, 1.0, smoothstep(uFadeNear, uFadeFar, dist));
    gl_FragColor = vec4(ao, dist, 0.0, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tAO;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).rg;
    float sum = c.r;
    float wsum = 1.0;
    for (int i = -4; i <= 4; i++) {
      if (i == 0) continue;
      vec2 s = texture2D(tAO, vUv + uDir * float(i)).rg;
      // keep to the same surface: weight by how close the depths are
      float w = exp(-abs(s.g - c.g) / max(0.05, c.g * 0.04)) * (1.0 - abs(float(i)) / 5.0);
      sum += s.r * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tAO;
  uniform float uStrength, uDebug;
  varying vec2 vUv;
  ${FINITE_GLSL}
  void main() {
    vec4 c = texture2D(tColor, vUv);
    float ao = texture2D(tAO, vUv).r;
    // light isn't in shadow: lamps, screens, beams and lasers keep their full brightness
    float l = dot(finite3(c.rgb), vec3(0.2126, 0.7152, 0.0722));
    float k = mix(ao, 1.0, smoothstep(0.6, 1.8, l));
    gl_FragColor = uDebug > 0.5 ? vec4(vec3(ao), 1.0) : vec4(c.rgb * mix(1.0, k, uStrength), c.a);
  }
`;

/**
 * Keeps the scene's depth for the passes after it. The composer swaps its two
 * buffers as passes run, so which one holds the scene changes from frame to
 * frame: this sits straight after the scene render and notes where it is.
 */
export class DepthTap extends Pass {
  depth: THREE.DepthTexture | null = null;

  constructor() {
    super();
    this.needsSwap = false;
  }

  render(_r: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.depth = readBuffer.depthTexture;
  }
}

export class AOPass extends Pass {
  /** 0 (off) .. 1 */
  strength = 1;
  /** show the occlusion itself (the debug menu) */
  debug = false;
  private aoRT: THREE.WebGLRenderTarget;
  private blurRT: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private tap: DepthTap,
  ) {
    super();
    this.needsSwap = true;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.blurRT = new THREE.WebGLRenderTarget(1, 1, opts);
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uProjScale: { value: 1 },
        // metres: about a hand's span, so people and props pick up contact shadow without a halo round the room
        uRadius: { value: 0.55 },
        uBias: { value: 0.002 },
        uIntensity: { value: 1 },
        uFadeNear: { value: 18 },
        uFadeFar: { value: 45 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tAO: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null }, tAO: { value: null }, uStrength: { value: 1 }, uDebug: { value: 0 } }, vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.aoMat);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.aoRT.setSize(w, h);
    this.blurRT.setSize(w, h);
    (this.aoMat.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const depth = this.tap.depth;
    const out = this.renderToScreen ? null : writeBuffer;
    if (!depth || this.strength <= 0.001) {
      // nothing to do: pass the frame through
      this.compMat.uniforms.tColor.value = readBuffer.texture;
      this.compMat.uniforms.tAO.value = null;
      this.compMat.uniforms.uStrength.value = 0;
      this.compMat.uniforms.uDebug.value = 0;
      this.quad.material = this.compMat;
      renderer.setRenderTarget(out);
      this.quad.render(renderer);
      return;
    }
    const cam = this.camera;
    const u = this.aoMat.uniforms;
    u.tDepth.value = depth;
    (u.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    // half the screen height in uv per metre at 1 m away
    u.uProjScale.value = cam.projectionMatrix.elements[5] * 0.5;
    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.aoRT);
    this.quad.render(renderer);
    // the blur, across then down
    const bu = this.blurMat.uniforms;
    const texel = u.uTexel.value as THREE.Vector2;
    this.quad.material = this.blurMat;
    bu.tAO.value = this.aoRT.texture;
    (bu.uDir.value as THREE.Vector2).set(texel.x, 0);
    renderer.setRenderTarget(this.blurRT);
    this.quad.render(renderer);
    bu.tAO.value = this.blurRT.texture;
    (bu.uDir.value as THREE.Vector2).set(0, texel.y);
    renderer.setRenderTarget(this.aoRT);
    this.quad.render(renderer);
    // and over the frame
    const cu = this.compMat.uniforms;
    cu.tColor.value = readBuffer.texture;
    cu.tAO.value = this.aoRT.texture;
    cu.uStrength.value = this.strength;
    cu.uDebug.value = this.debug ? 1 : 0;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(out);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.aoRT.dispose();
    this.blurRT.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}
