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
  uniform float uProjScale, uRadius, uBias, uIntensity, uFadeNear, uFadeFar, uClearTo, uClearSoft;
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
    // the radius scales with the view: a hand's span across a club, a few centimetres on the board
    // (a fixed half-metre radius at the decks darkened the whole desk round every object), and
    // shrinking steeply closer in: a person a few metres off is all folds and gaps (an arm by
    // the side, a loose shirt), and a radius of a hand's span reads each one as a corner and
    // paints it near black
    float k = clamp(dist / 6.0, 0.0, 1.0);
    float rad = uRadius * max(0.1, k * k * k);
    // the radius in screen space, shrinking with distance
    float rs = rad * uProjScale / max(0.1, dist);
    // a 4x4 interleaved pattern of rotations: structured noise the blur removes cleanly
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    float rot = (cell.x * 4.0 + cell.y) * 0.3927 + hash(cell) * 0.2;
    float occ = 0.0;
    float r2 = rad * rad;
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
    // none on the board and the desk round it: at arm's length the estimate is mostly noise from the
    // print, caps and bevels, and it read as smoky smudges round every jog and knob (the deck light
    // and the shadows already ground the hardware)
    ao = mix(1.0, ao, smoothstep(uClearTo, uClearTo + uClearSoft, dist));
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
  uniform sampler2D tDepth;
  uniform mat4 uProjInv;
  uniform vec2 uAoTexel;
  uniform float uStrength, uDebug;
  varying vec2 vUv;
  ${FINITE_GLSL}
  void main() {
    vec4 c = texture2D(tColor, vUv);
    // depth-aware upsampling: of the four nearest half-resolution samples, take the one whose depth
    // matches this pixel's, so the occlusion never bleeds across an edge into a halo
    float d0 = texture2D(tDepth, vUv).x;
    vec4 pv = uProjInv * vec4(vUv * 2.0 - 1.0, d0 * 2.0 - 1.0, 1.0);
    float dist = -pv.z / pv.w;
    vec2 g = vUv / uAoTexel - 0.5;
    vec2 base = (floor(g) + 0.5) * uAoTexel;
    vec2 fr = fract(g);
    float tol = max(0.03, dist * 0.025);
    float sum = 0.0;
    float wsum = 0.0;
    for (int j = 0; j < 2; j++)
      for (int i = 0; i < 2; i++) {
        vec2 s = texture2D(tAO, base + vec2(float(i), float(j)) * uAoTexel).rg;
        // bilinear, but samples from another surface (across an edge) barely count
        float wb = (i == 0 ? 1.0 - fr.x : fr.x) * (j == 0 ? 1.0 - fr.y : fr.y);
        float w = wb * exp(-abs(s.g - dist) / tol) + 1e-5;
        sum += s.r * w;
        wsum += w;
      }
    float ao = sum / wsum;
    // nothing on the same surface nearby (a thin edge): mostly unshadowed
    ao = mix(1.0, ao, clamp(wsum * 3.0, 0.0, 1.0));
    // light isn't in shadow: lamps, screens, beams and lasers keep their full brightness
    float l = dot(finite3(c.rgb), vec3(0.2126, 0.7152, 0.0722));
    float k = mix(ao, 1.0, smoothstep(0.6, 1.8, l));
    gl_FragColor = uDebug > 0.5 ? vec4(vec3(ao), 1.0) : vec4(c.rgb * mix(1.0, k, uStrength), c.a);
  }
`;

const DIST_FRAG = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uNear, uFar;
  varying vec2 vUv;
  void main() {
    float d = texture2D(tDepth, vUv).x * 2.0 - 1.0;
    gl_FragColor = vec4(2.0 * uNear * uFar / (uFar + uNear - d * (uFar - uNear)), 0.0, 0.0, 1.0);
  }
`;

/**
 * Keeps the scene's depth for the passes after it. The composer swaps its two
 * buffers as passes run, so which one holds the scene changes from frame to
 * frame: this sits straight after the scene render and notes where it is.
 *
 * A pass drawing into that buffer later clears its depth, so a pass that runs
 * after the others (depth of field) asks for a copy: the distance from the
 * camera in metres, in a texture of its own, made only on frames it's asked for.
 */
export class DepthTap extends Pass {
  depth: THREE.DepthTexture | null = null;
  /** this frame's distance copy, or null if nobody asked for one */
  distance: THREE.Texture | null = null;
  private want = 0;
  private distRT: THREE.WebGLRenderTarget | null = null;
  private distQuad: FullScreenQuad | null = null;
  private size = new THREE.Vector2(1, 1);

  constructor(private camera?: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
  }

  /** make the distance copy on the next frames (ask again every frame it's needed) */
  requestDistance(): void {
    this.want = 2;
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.distRT?.setSize(width, height);
  }

  render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.depth = readBuffer.depthTexture;
    this.distance = null;
    if (this.want <= 0 || !this.depth || !this.camera) return;
    this.want--;
    if (!this.distRT || !this.distQuad) {
      this.distRT = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
      this.distQuad = new FullScreenQuad(
        new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 100 } }, vertexShader: VERT, fragmentShader: DIST_FRAG, depthTest: false, depthWrite: false }),
      );
    }
    const u = (this.distQuad.material as THREE.ShaderMaterial).uniforms;
    u.tDepth.value = this.depth;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.distRT);
    this.distQuad.render(renderer);
    this.distance = this.distRT.texture;
  }

  dispose(): void {
    this.distRT?.dispose();
    (this.distQuad?.material as THREE.Material | undefined)?.dispose();
    this.distQuad?.dispose();
  }
}

export class AOPass extends Pass {
  /** 0 (off) .. 1 */
  strength = 1;
  /** show the occlusion itself (the debug menu) */
  debug = false;
  /** metres from the camera with no occlusion at all (the board you're looking at), and the fade after it */
  clearTo = 0;
  clearSoft = 1;
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
        // (enough that a gently curved surface, a chest or a shoulder, doesn't shade itself in blotches)
        uBias: { value: 0.007 },
        uIntensity: { value: 1 },
        uFadeNear: { value: 18 },
        uFadeFar: { value: 45 },
        uClearTo: { value: 0 },
        uClearSoft: { value: 1 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tAO: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({ uniforms: { tColor: { value: null }, tAO: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uAoTexel: { value: new THREE.Vector2(1, 1) }, uStrength: { value: 1 }, uDebug: { value: 0 } }, vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false });
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
    u.uClearTo.value = this.clearTo;
    u.uClearSoft.value = Math.max(0.05, this.clearSoft);
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
    cu.tDepth.value = depth;
    (cu.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (cu.uAoTexel.value as THREE.Vector2).copy(texel);
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
