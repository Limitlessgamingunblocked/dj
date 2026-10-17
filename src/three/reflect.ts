/*
 * Reflective floors: polished concrete and sticky club floors mirror the
 * room's light. The LED wall, beams, lasers, strobes, lamps and neon show in
 * the floor as soft, vertically smeared streaks, the way they do on a real
 * dance floor.
 *
 * Up to two surfaces: the dance floor, and the stage deck (on a big stage
 * the LED wall shows in the deck's gloss; in a packed room the crowd hides
 * most of the floor). A planar reflection for each, cheaply:
 *   – only the bright things are drawn into it (objects tagged on the
 *     REFLECT layer when a venue loads: anything unlit, additive or set to
 *     skip tone mapping), from a camera mirrored below the floor, at a
 *     quarter of the screen's resolution, clipped at the floor so nothing
 *     under it gets in
 *   – blurred, more up and down than across, as polish and wet spots smear
 *     a reflection along the line of sight
 *   – added onto the floor's pixels only (found from the frame's depth: the
 *     surface at the floor's height), stronger at grazing angles (Fresnel)
 * The crowd isn't drawn into it, so a light behind someone can show in the
 * floor in front of them; the gaps between people are where you see it.
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { DepthTap } from './ao';

/** the layer bright things are tagged on for the reflection */
export const REFLECT_LAYER = 5;

/** what a venue's floor reflects: its height and how strongly (0..1) */
export interface FloorReflect {
  y: number;
  strength: number;
  /** how far the reflection smears, 0 (wet) .. 1 (worn concrete) */
  rough?: number;
}

/** is this object one of the bright things a floor would show? */
export function isBright(o: THREE.Object3D): boolean {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (!m || !((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.LineSegments).isLineSegments)) return false;
  const mats = Array.isArray(m) ? m : [m];
  return mats.some((x) => {
    if (!x.visible) return false;
    if (x.blending === THREE.AdditiveBlending) return true;
    if (x.toneMapped === false) return true;
    const e = (x as THREE.MeshStandardMaterial).emissive;
    const ei = (x as THREE.MeshStandardMaterial).emissiveIntensity ?? 1;
    return !!e && (e.r + e.g + e.b) * ei > 0.3;
  });
}

/** tag a venue's bright things for the reflection; returns how many */
export function tagBright(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (isBright(o)) {
      o.layers.enable(REFLECT_LAYER);
      n++;
    }
  });
  return n;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tIn;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int i = -5; i <= 5; i++) {
      float w = 1.0 - abs(float(i)) / 6.0;
      sum += texture2D(tIn, vUv + uDir * float(i)).rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tRefl0;
  uniform sampler2D tRefl1;
  uniform mat4 uProjInv, uCamWorld, uVP0, uVP1;
  uniform vec3 uCamPos;
  uniform vec2 uY, uStrength;
  uniform float uDebug;
  varying vec2 vUv;
  vec3 sampleRefl(sampler2D t, mat4 vp, vec3 w) {
    vec4 r = vp * vec4(w, 1.0);
    vec2 ruv = r.xy / r.w * 0.5 + 0.5;
    vec2 e = smoothstep(vec2(0.0), vec2(0.04), ruv) * smoothstep(vec2(0.0), vec2(0.04), 1.0 - ruv);
    return texture2D(t, clamp(ruv, 0.0, 1.0)).rgb * e.x * e.y;
  }
  void main() {
    vec4 c = texture2D(tColor, vUv);
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = c; return; }
    vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec3 w = (uCamWorld * vec4(v.xyz / v.w, 1.0)).xyz;
    // each surface: the pixels at its height (a few cm either way, for the worn relief) that face up;
    // without the facing test, everyone's heads at the stage deck's height got a stripe of reflection
    vec3 n = cross(dFdx(w), dFdy(w));
    float facing = smoothstep(0.75, 0.92, abs(n.y) / max(length(n), 1e-6));
    float m0 = uStrength.x > 0.0 ? (1.0 - smoothstep(0.02, 0.06, abs(w.y - uY.x))) * facing : 0.0;
    float m1 = uStrength.y > 0.0 ? (1.0 - smoothstep(0.02, 0.06, abs(w.y - uY.y))) * facing : 0.0;
    if (uDebug > 0.5) { gl_FragColor = vec4(m0, m1, 0.0, 1.0); return; }
    if (m0 + m1 <= 0.0) { gl_FragColor = c; return; }
    // Fresnel: a floor mirrors most at a grazing look, little straight down
    vec3 view = normalize(w - uCamPos);
    float f = 0.12 + 0.88 * pow(1.0 - abs(view.y), 4.0);
    vec3 add = vec3(0.0);
    if (m0 > 0.0) add += sampleRefl(tRefl0, uVP0, w) * uStrength.x * m0;
    if (m1 > 0.0) add += sampleRefl(tRefl1, uVP1, w) * uStrength.y * m1;
    gl_FragColor = vec4(c.rgb + add * f, c.a);
  }
`;

interface PlaneView {
  rt: THREE.WebGLRenderTarget;
  blurA: THREE.WebGLRenderTarget;
  blurB: THREE.WebGLRenderTarget;
  cam: THREE.PerspectiveCamera;
  vp: THREE.Matrix4;
}

export class ReflectPass extends Pass {
  /** the venue's reflective surfaces, up to two (empty: none) */
  planes: FloorReflect[] = [];
  /** show which pixels count as each surface (the debug menu) */
  debug = false;
  private views: PlaneView[];
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private prevClear = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private tap: DepthTap,
  ) {
    super();
    this.needsSwap = true;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.views = [0, 1].map(() => {
      const cam = new THREE.PerspectiveCamera();
      cam.layers.set(REFLECT_LAYER);
      return {
        rt: new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: true }),
        blurA: new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false }),
        blurB: new THREE.WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false }),
        cam,
        vp: new THREE.Matrix4(),
      };
    });
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tIn: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tRefl0: { value: null },
        tRefl1: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uVP0: { value: new THREE.Matrix4() },
        uVP1: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uY: { value: new THREE.Vector2() },
        uStrength: { value: new THREE.Vector2() },
        uDebug: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.compMat);
  }

  /** the venue's surfaces: one or two */
  set floor(f: FloorReflect | FloorReflect[] | null) {
    this.planes = !f ? [] : (Array.isArray(f) ? f : [f]).slice(0, 2);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 4));
    const h = Math.max(1, Math.round(height / 4));
    for (const v of this.views) {
      v.rt.setSize(w, h);
      v.blurA.setSize(w, h);
      v.blurB.setSize(w, h);
    }
  }

  /** a camera below the surface, mirrored: what it sees through a pixel of the surface is what that pixel reflects */
  private placeVirtual(v: THREE.PerspectiveCamera, y0: number): void {
    const cam = this.camera;
    cam.getWorldPosition(this.tmp);
    v.position.set(this.tmp.x, 2 * y0 - this.tmp.y, this.tmp.z);
    cam.getWorldDirection(this.fwd);
    this.fwd.y = -this.fwd.y;
    this.up.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(this.q));
    this.up.y = -this.up.y;
    v.up.copy(this.up);
    v.lookAt(this.tmp.set(v.position.x + this.fwd.x, v.position.y + this.fwd.y, v.position.z + this.fwd.z));
    // a symmetric frustum a little wider than the real one, so it covers every pixel (the real one may be offset)
    v.fov = Math.min(150, cam.fov * 1.25);
    v.aspect = cam.aspect;
    v.near = cam.near;
    v.far = cam.far;
    v.updateProjectionMatrix();
    v.updateMatrixWorld(true);
  }

  /** the bright things above a surface, from below it, clipped at it, then smeared */
  private renderPlane(renderer: THREE.WebGLRenderer, p: FloorReflect, v: PlaneView): void {
    this.placeVirtual(v.cam, p.y);
    this.clip[0].set(new THREE.Vector3(0, 1, 0), -(p.y + 0.03));
    renderer.clippingPlanes = this.clip;
    renderer.setRenderTarget(v.rt);
    renderer.clear();
    renderer.render(this.scene, v.cam);
    renderer.clippingPlanes = [];
    // the smear: up and down more than across, wider on rougher surfaces
    const rough = p.rough ?? 0.5;
    const bu = this.blurMat.uniforms;
    this.quad.material = this.blurMat;
    bu.tIn.value = v.rt.texture;
    (bu.uDir.value as THREE.Vector2).set((0.6 + rough) / v.rt.width, 0);
    renderer.setRenderTarget(v.blurA);
    this.quad.render(renderer);
    bu.tIn.value = v.blurA.texture;
    (bu.uDir.value as THREE.Vector2).set(0, (1.5 + 3 * rough) / v.rt.height);
    renderer.setRenderTarget(v.blurB);
    this.quad.render(renderer);
    v.vp.multiplyMatrices(v.cam.projectionMatrix, v.cam.matrixWorldInverse);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const cu = this.compMat.uniforms;
    cu.tColor.value = readBuffer.texture;
    const depth = this.tap.depth;
    const out = this.renderToScreen ? null : writeBuffer;
    const camY = this.camera.getWorldPosition(this.tmp).y;
    // a surface the camera is under (or level with) reflects nothing it can see
    const live = depth ? this.planes.map((p) => p.strength > 0 && camY > p.y + 0.05) : [false, false];
    const strength = cu.uStrength.value as THREE.Vector2;
    strength.set(0, 0);
    if (live.some(Boolean)) {
      const prevClip = renderer.clippingPlanes;
      const prevBg = this.scene.background;
      const prevAuto = renderer.autoClear;
      const prevShadow = renderer.shadowMap.autoUpdate;
      renderer.getClearColor(this.prevClear);
      const prevAlpha = renderer.getClearAlpha();
      this.scene.background = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 1);
      this.planes.forEach((p, i) => {
        if (!live[i]) return;
        this.renderPlane(renderer, p, this.views[i]);
        strength.setComponent(i, p.strength);
      });
      renderer.clippingPlanes = prevClip;
      this.scene.background = prevBg;
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.autoClear = prevAuto;
      renderer.setClearColor(this.prevClear, prevAlpha);
    }
    // onto the surfaces
    const cam = this.camera;
    cu.tDepth.value = depth;
    cu.tRefl0.value = this.views[0].blurB.texture;
    cu.tRefl1.value = this.views[1].blurB.texture;
    (cu.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (cu.uCamWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
    (cu.uVP0.value as THREE.Matrix4).copy(this.views[0].vp);
    (cu.uVP1.value as THREE.Matrix4).copy(this.views[1].vp);
    cam.getWorldPosition(cu.uCamPos.value as THREE.Vector3);
    (cu.uY.value as THREE.Vector2).set(this.planes[0]?.y ?? -1e4, this.planes[1]?.y ?? -1e4);
    cu.uDebug.value = this.debug ? 1 : 0;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(out);
    this.quad.render(renderer);
  }

  dispose(): void {
    for (const v of this.views) {
      v.rt.dispose();
      v.blurA.dispose();
      v.blurB.dispose();
    }
    this.blurMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}
