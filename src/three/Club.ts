/*
 * Club environment: floor, DJ booth, LED wall + side projection screens
 * (fed by the visual player), truss with moving-head beams, lasers, crowd and
 * audio-reactive lighting. The DJ stands at +Z facing the room (−Z).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Features } from '../visualizer/AudioFeatures';

export const TABLE_Y = 0.9;

const beamVertex = /* glsl */ `
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vT = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float edge = pow(abs(dot(vN, vView)), 1.4);
    float a = uIntensity * edge * pow(vT, 1.6) * 0.55;
    gl_FragColor = vec4(uColor * a, a);
  }`;

interface Head {
  pivot: THREE.Group;
  beam: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  lens: THREE.MeshBasicMaterial;
  phase: number;
  side: number;
}

export class Club {
  readonly group = new THREE.Group();
  readonly wallMaterial: THREE.MeshBasicMaterial;
  readonly ledWall: THREE.Mesh;
  private heads: Head[] = [];
  private lasers: THREE.Mesh[] = [];
  private laserMat: THREE.MeshBasicMaterial;
  private laserGroup = new THREE.Group();
  private crowd: THREE.InstancedMesh;
  private crowdBase: { x: number; z: number; ph: number; h: number }[] = [];
  private accentA: THREE.PointLight;
  private accentB: THREE.PointLight;
  private boothStrip: THREE.MeshBasicMaterial;
  private floorGlow: THREE.MeshBasicMaterial;
  readonly keyLight: THREE.SpotLight;
  private t = 0;
  private m4 = new THREE.Matrix4();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x020306);
    scene.fog = new THREE.FogExp2(0x03040a, 0.055);

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x08090d, roughness: 0.45, metalness: 0.15, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.floorGlow = new THREE.MeshBasicMaterial({ color: 0x2233ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(6, 48), this.floorGlow);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, 0.005, -3.5);
    this.group.add(glow);

    // booth
    const boothMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.3 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.42, metalness: 0.15 });
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.8, TABLE_Y - 0.04, 0.95), boothMat);
    booth.position.set(0, (TABLE_Y - 0.04) / 2, 0);
    booth.receiveShadow = true;
    booth.castShadow = true;
    this.group.add(booth);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.04, 1.02), topMat);
    top.position.set(0, TABLE_Y - 0.02, 0);
    top.receiveShadow = true;
    this.group.add(top);
    this.boothStrip = new THREE.MeshBasicMaterial({ color: 0x2ec4f1, toneMapped: false });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.02, 0.01), this.boothStrip);
    strip.position.set(0, TABLE_Y - 0.18, -0.48);
    this.group.add(strip);
    const strip2 = strip.clone();
    strip2.position.y = 0.06;
    this.group.add(strip2);
    // monitor speakers either side
    const spkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.7 });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.4, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const spk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.34), spkMat);
      spk.position.set(s * 1.36, TABLE_Y + 0.26, -0.32);
      spk.rotation.y = s * -0.35;
      spk.castShadow = true;
      this.group.add(spk);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 32), coneMat);
      cone.rotation.x = Math.PI / 2;
      cone.position.set(0, -0.07, 0.171);
      spk.add(cone);
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 24), coneMat);
      tw.rotation.x = Math.PI / 2;
      tw.position.set(0, 0.14, 0.171);
      spk.add(tw);
    }

    // LED wall (visual player)
    this.wallMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.ledWall = new THREE.Mesh(new THREE.PlaneGeometry(11.2, 6.3), this.wallMaterial);
    this.ledWall.position.set(0, 3.55, -8);
    this.group.add(this.ledWall);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(11.6, 6.7, 0.25), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.8 }));
    frame.position.set(0, 3.55, -8.14);
    this.group.add(frame);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.7), this.wallMaterial);
      side.position.set(s * 8.2, 3.1, -5.2);
      side.rotation.y = -s * 0.75;
      this.group.add(side);
    }

    // truss + moving heads
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.9 });
    for (const z of [-1.4, -5.4]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 0.18, 0.18), trussMat);
      beam.position.set(0, 4.6, z);
      this.group.add(beam);
    }
    const headGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.3, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.4, metalness: 0.6 });
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.85, 9, 24, 1, true);
    beamGeo.translate(0, -4.5, 0);
    // uv.y: 1 at the lens, 0 at the far end
    let hi = 0;
    for (const z of [-1.4, -5.4]) {
      for (const x of [-5, -2.5, 0, 2.5, 5]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, 4.42, z);
        const head = new THREE.Mesh(headGeo, headMat);
        pivot.add(head);
        const mat = new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uIntensity: { value: 0 } },
          vertexShader: beamVertex,
          fragmentShader: beamFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const beam = new THREE.Mesh(beamGeo, mat);
        pivot.add(beam);
        const lens = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), lens);
        lensMesh.rotation.x = Math.PI / 2;
        lensMesh.position.y = -0.155;
        pivot.add(lensMesh);
        this.group.add(pivot);
        this.heads.push({ pivot, beam, mat, lens, phase: hi * 0.7, side: x === 0 ? 0 : Math.sign(x) });
        hi++;
      }
    }

    // lasers from above the LED wall
    this.laserMat = new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const laserGeo = new THREE.CylinderGeometry(0.006, 0.006, 22, 6, 1, true);
    laserGeo.translate(0, -11, 0);
    this.laserGroup.position.set(0, 6.9, -7.8);
    for (let i = 0; i < 12; i++) {
      const l = new THREE.Mesh(laserGeo, this.laserMat);
      this.lasers.push(l);
      this.laserGroup.add(l);
    }
    this.group.add(this.laserGroup);

    // crowd: simple silhouettes (body + head) behind the booth
    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.7, 4, 10);
    bodyGeo.translate(0, 0.55, 0);
    const headGeo2 = new THREE.SphereGeometry(0.12, 12, 10);
    headGeo2.translate(0, 1.33, 0);
    const crowdGeo = mergeGeometries([bodyGeo, headGeo2]);
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0x151822, roughness: 0.7, metalness: 0.1 });
    const N = 110;
    this.crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, N);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 13;
      const z = -2.8 - Math.random() * 4.8;
      this.crowdBase.push({ x, z, ph: Math.random(), h: 0.9 + Math.random() * 0.22 });
    }
    this.crowd.count = this.crowdBase.length;
    this.crowd.castShadow = false;
    this.group.add(this.crowd);

    // lights
    scene.add(new THREE.HemisphereLight(0x6a7ba8, 0x07070a, 0.5));
    this.keyLight = new THREE.SpotLight(0xfff4e6, 15, 7, 0.55, 0.65, 1.6);
    this.keyLight.position.set(0.35, TABLE_Y + 2.4, 1.1);
    this.keyLight.target.position.set(0, TABLE_Y, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.015;
    this.keyLight.shadow.radius = 3;
    this.keyLight.shadow.camera.near = 0.8;
    this.keyLight.shadow.camera.far = 5;
    scene.add(this.keyLight, this.keyLight.target);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.35);
    fill.position.set(-2, 3, 3);
    scene.add(fill);
    this.accentA = new THREE.PointLight(0x4cc9f0, 6, 9, 1.8);
    this.accentA.position.set(-2.5, 2.4, -2.5);
    this.accentB = new THREE.PointLight(0xff5fcf, 6, 9, 1.8);
    this.accentB.position.set(2.5, 2.4, -2.5);
    scene.add(this.accentA, this.accentB);
    scene.add(this.group);
  }

  setVisTexture(tex: THREE.Texture | null): void {
    if (this.wallMaterial.map !== tex) {
      this.wallMaterial.map = tex;
      this.wallMaterial.color.set(tex ? 0xffffff : 0x050608);
      this.wallMaterial.needsUpdate = true;
    }
  }

  setShadows(on: boolean, size: number): void {
    this.keyLight.castShadow = on;
    if (this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  update(f: Features, dt: number, reactive: boolean): void {
    this.t += dt;
    const t = this.t;
    const hue = f.hue;
    const energy = reactive ? Math.min(1, 0.25 + f.level * 0.9) : 0.3;
    // moving heads: sweep patterns locked to the beat
    const beatT = f.time * (f.bpm / 60);
    this.heads.forEach((h, i) => {
      const pat = Math.floor(beatT / 16) % 3;
      let pan: number;
      let tilt: number;
      if (pat === 0) {
        pan = Math.sin(beatT * Math.PI * 0.25 + h.phase) * 0.7;
        tilt = 0.45 + Math.sin(beatT * Math.PI * 0.5 + h.phase) * 0.25;
      } else if (pat === 1) {
        pan = (i % 2 ? 1 : -1) * (0.3 + 0.35 * Math.sin(beatT * Math.PI * 0.125));
        tilt = 0.3 + (f.beatInBar % 2) * 0.2;
      } else {
        pan = Math.sin(t * 0.4 + i) * 0.9;
        tilt = 0.6 + Math.cos(t * 0.5 + i * 0.5) * 0.3;
      }
      h.pivot.rotation.set(tilt, pan, 0, 'YXZ');
      const c = this.col.setHSL((hue + (i % 5) * 0.08 + (f.beatInBar % 2) * 0.5 * (f.drop > 0.3 ? 1 : 0)) % 1, 0.9, 0.55);
      h.mat.uniforms.uColor.value.copy(c);
      const strobe = f.drop > 0.5 && reactive ? (Math.floor(t * 18) % 2 ? 1.6 : 0.1) : 1;
      h.mat.uniforms.uIntensity.value = (0.35 + energy * 0.6 + (reactive ? f.kickPulse * 0.8 : 0)) * strobe * (f.playing ? 1 : 0.35);
      h.lens.color.copy(c).multiplyScalar(1.5 + f.kickPulse * 2);
    });
    // lasers on drops and high energy
    const laserOn = reactive && f.playing ? Math.max(f.drop, f.energy > 0.65 ? (f.beatInBar === 0 ? 0.8 : 0.3) : 0) : 0;
    this.laserMat.opacity += (laserOn * 0.9 - this.laserMat.opacity) * Math.min(1, dt * 8);
    this.laserMat.color.setHSL((hue + 0.33) % 1, 1, 0.55);
    this.lasers.forEach((l, i) => {
      const spread = 0.9 + 0.3 * Math.sin(t * 0.7);
      const a = (i / (this.lasers.length - 1) - 0.5) * spread * 2;
      l.rotation.set(-1.25 + Math.sin(t * 1.3 + i * 0.2) * 0.12, 0, a + Math.sin(t * 0.9) * 0.2);
    });
    // crowd bobbing on the beat
    const bob = f.playing ? Math.pow(1 - f.beatPhase, 2) : 0;
    this.crowdBase.forEach((p, i) => {
      const y = bob * 0.09 * (0.6 + ((i * 7) % 5) / 10) + (f.drop > 0.4 ? Math.sin(t * 9 + p.ph * 6) * 0.08 : 0);
      this.m4.makeScale(1, p.h, 1);
      this.m4.setPosition(p.x, y, p.z);
      this.crowd.setMatrixAt(i, this.m4);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
    // accent lights and strips
    this.accentA.color.setHSL(hue, 0.85, 0.55);
    this.accentB.color.setHSL((hue + 0.5) % 1, 0.85, 0.55);
    const pulse = reactive ? f.kickPulse : 0;
    this.accentA.intensity = 3 + energy * 6 + pulse * 10;
    this.accentB.intensity = 3 + energy * 6 + pulse * 10;
    this.boothStrip.color.setHSL(hue, 0.9, 0.35 + pulse * 0.3);
    this.floorGlow.color.setHSL((hue + 0.1) % 1, 0.8, 0.5);
    this.floorGlow.opacity = reactive ? 0.05 + f.kickPulse * 0.12 + f.drop * 0.2 : 0.03;
  }
}
