/*
 * Projection mapping at the open-air venues: a projector by the stage throws
 * the visual player onto the surfaces round it (the buildings across from the
 * rooftop, the headland over the bay, the boat's hull). Each surface gets an
 * overlay sharing its geometry: the projector's view of the visuals, added on
 * top, fading at the edges of the throw and on faces turned away from it.
 * The visuals come from a hidden material in the venue's visMaterials (the
 * stage sets its map each frame).
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
  uniform mat4 uProj;
  uniform vec3 uFrom;
  varying vec4 vClip;
  varying float vFacing;
  varying float vDist;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    #ifdef USE_INSTANCING
      wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    #endif
    vClip = uProj * wp;
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vFacing = dot(n, normalize(uFrom - wp.xyz));
    vDist = length(uFrom - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uVis;
  uniform float uGain;
  uniform vec3 uTint;
  varying vec4 vClip;
  varying float vFacing;
  varying float vDist;
  void main() {
    if (vClip.w <= 0.0) discard;
    vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || vFacing <= 0.0) discard;
    float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x) * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.92, uv.y);
    vec3 c = texture2D(uVis, uv).rgb * uTint;
    gl_FragColor = vec4(c * uGain * edge * smoothstep(0.0, 0.3, vFacing), 1.0);
  }
`;

export class Projector {
  /** the venue pushes this into its visMaterials; the stage gives it the visual player */
  readonly visMat = new THREE.MeshBasicMaterial();
  readonly mat: THREE.ShaderMaterial;
  private cam: THREE.PerspectiveCamera;

  constructor(from: THREE.Vector3, to: THREE.Vector3, fovDeg: number, aspect: number) {
    this.cam = new THREE.PerspectiveCamera(fovDeg, aspect, 1, 2000);
    this.cam.position.copy(from);
    this.cam.lookAt(to);
    this.cam.updateMatrixWorld(true);
    const proj = new THREE.Matrix4().multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uProj: { value: proj }, uFrom: { value: from.clone() }, uVis: { value: null }, uGain: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** the overlays, so the stage knows when one is on screen (and runs the visual player for it) */
  readonly overlays: THREE.Object3D[] = [];

  /** throw onto these meshes (and everything under them) */
  onto(root: THREE.Object3D): void {
    const targets: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.projection !== true) targets.push(m);
    });
    for (const m of targets) {
      const over = (m as THREE.InstancedMesh).isInstancedMesh ? new THREE.InstancedMesh(m.geometry, this.mat, (m as THREE.InstancedMesh).count) : new THREE.Mesh(m.geometry, this.mat);
      if ((m as THREE.InstancedMesh).isInstancedMesh) (over as THREE.InstancedMesh).instanceMatrix = (m as THREE.InstancedMesh).instanceMatrix;
      over.userData.projection = true;
      over.renderOrder = 3;
      over.frustumCulled = m.frustumCulled;
      m.add(over);
      this.overlays.push(over);
    }
  }

  /** each frame: the visuals and how bright the throw is (projection reads best after dark) */
  update(gain: number): void {
    this.mat.uniforms.uVis.value = this.visMat.map;
    this.mat.uniforms.uGain.value = this.visMat.map ? gain : 0;
  }
}
