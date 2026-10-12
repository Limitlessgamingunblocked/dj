/*
 * The Aquarium: a glass tunnel along the sea floor. Outside the glass, the
 * sea: a sandy bed, rocks, kelp swaying, light shafts from the surface and
 * caustics rippling over everything. Schools of fish swirl round the tunnel
 * following the melody, and on the drop a whale glides over the top.
 *
 *   modes    reef (turquoise), deep (dark, glowing life), kelp forest, arctic
 *   pads     feed (the fish rush the glass), one big school, tunnel lights, go deeper (hold)
 *   moments  whale (big), swirl (big: a bait ball round the tunnel), jellyfish (deep)
 *   stems    the fish follow the melody, the light shafts the vocals, the caustics the drums
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { CrazyRoom, V, type RoomAction, type RoomMoment } from './kit';

const R = 5.2;
const D = 18;
const BACK = 3;
const FISH = 420;
const JELLY = 24;

const CAUSTIC = /* glsl */ `
  float caustic(vec2 p, float t) {
    float c = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 q = p * (1.3 + fi * 0.7) + vec2(t * (0.3 + fi * 0.1), -t * 0.2);
      c += abs(sin(q.x + sin(q.y * 1.3 + t)) * sin(q.y + sin(q.x * 1.1 - t)));
    }
    return pow(1.0 - c / 3.0, 5.0);
  }
`;

/** a fish: a squashed spindle with a tail, nose at +Z */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.12, 10, 6).scale(0.45, 0.8, 1.6);
  const tail = new THREE.ConeGeometry(0.1, 0.16, 4).rotateX(-Math.PI / 2).scale(0.2, 1.2, 1).translate(0, 0, -0.24);
  const g = new THREE.BufferGeometry();
  const a = body.toNonIndexed();
  const b = tail.toNonIndexed();
  const pos = new Float32Array([...(a.attributes.position.array as Float32Array), ...(b.attributes.position.array as Float32Array)]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** a whale: a long lathed body, a fluke and two fins */
function whale(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = Math.sin(Math.pow(t, 0.7) * Math.PI) * (1 - t * 0.55) * 1.6 + 0.05;
    prof.push(new THREE.Vector2(r, t * 14 - 7));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 24).rotateX(Math.PI / 2).scale(1, 0.8, 1), mat);
  g.add(body);
  const fluke = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 1.4), mat);
  fluke.position.z = -7.4;
  g.add(fluke);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.9), mat);
    fin.position.set(s * 1.6, -0.6, 2.2);
    fin.rotation.z = s * 0.35;
    g.add(fin);
  }
  return g;
}

class Aquarium extends CrazyRoom {
  readonly modes = ['Reef', 'Deep', 'Kelp forest', 'Arctic'];
  readonly actions: RoomAction[] = [
    { id: 'feed', label: 'Feed', kind: 'hit' },
    { id: 'school', label: 'One school', kind: 'toggle' },
    { id: 'lights', label: 'Tunnel lights', kind: 'toggle' },
    { id: 'deep', label: 'Deeper', kind: 'hold' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'whale', label: 'A whale glides over the tunnel', energy: 'big' },
    { id: 'swirl', label: 'The fish ball up round the tunnel', energy: 'big' },
    { id: 'jelly', label: 'Glowing jellyfish drift up', energy: 'deep' },
  ];
  private glass: THREE.ShaderMaterial;
  private bed: THREE.ShaderMaterial;
  private shafts: THREE.ShaderMaterial;
  private fish: THREE.InstancedMesh;
  private fishData: { a: number; r: number; y: number; z: number; speed: number; school: number; w: number }[] = [];
  private kelp: THREE.InstancedMesh;
  private kelpBase: THREE.Matrix4[] = [];
  private jellies: THREE.InstancedMesh;
  private jellyMat: THREE.MeshBasicMaterial;
  private whale: THREE.Group;
  private whaleT = -1;
  private feedT = 99;
  private dummy = new THREE.Object3D();
  private waterCol = new THREE.Color();

  constructor() {
    super({ roomId: 'aquarium', roomName: 'Aquarium', w: R - 0.8, h: R, d: D, back: BACK, fog: 0x06324a, fogDensity: 0.035, hemi: 0.5, hemiSky: 0x5fd8ff, hemiGround: 0x0a2030, booth: { strip: '#5fe8ff' } });
    this.views.wide = { pos: V(-2.4, 1.7, -D + 1.5), target: V(0.5, 2.6, 0) };
    this.views.wideLabel = 'Down the tunnel';
    const u = { uTime: { value: 0 }, uCaustic: { value: 0 }, uTint: { value: new THREE.Color() }, uLights: { value: 0 }, uC0: { value: new THREE.Color() } };
    // the glass: almost clear, the sea's tint at a glancing angle, caustics playing over it, a rib every 3 m
    this.glass = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; void main() { vP = (modelMatrix * vec4(position, 1.0)).xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${CAUSTIC}
        uniform float uTime, uCaustic, uLights; uniform vec3 uTint, uC0;
        varying vec3 vP; varying vec3 vN;
        void main() {
          vec3 V = normalize(cameraPosition - vP);
          float fres = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
          float c = caustic(vP.xz * 0.6 + vP.y * 0.2, uTime);
          float rib = smoothstep(0.455, 0.475, abs(fract(vP.z / 3.0) - 0.5));
          // clear glass: a faint tint at a glancing angle, sparkles of caustic light, a steel rib every 3 m
          vec3 col = uTint * 0.6 + vec3(0.6, 0.9, 1.0) * c * (0.15 + uCaustic * 0.5);
          float alpha = 0.03 + fres * 0.16 + c * 0.05;
          col = mix(col, vec3(0.25, 0.3, 0.34) + uC0 * uLights * 1.5, rib);
          gl_FragColor = vec4(col, mix(alpha, 0.9, rib));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(R, R, D + BACK, 48, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), this.glass);
    arch.position.set(0, 0, (BACK - D) / 2);
    arch.renderOrder = 2;
    this.group.add(arch);
    // the sea bed: sand with caustics, out to the fog
    this.bed = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${CAUSTIC}
        uniform float uTime, uCaustic; uniform vec3 uTint;
        varying vec3 vP;
        void main() {
          float ripple = 0.5 + 0.5 * sin(vP.x * 3.0 + sin(vP.z * 1.7) * 2.0);
          vec3 sand = mix(vec3(0.55, 0.5, 0.38), vec3(0.62, 0.58, 0.45), ripple) * 0.55;
          float c = caustic(vP.xz * 0.45, uTime);
          vec3 col = sand * (0.35 + uTint * 0.6) + vec3(0.7, 0.95, 1.0) * c * (0.25 + uCaustic * 0.8);
          float fog = exp(-length(vP.xz - vec2(0.0, -6.0)) * 0.05);
          gl_FragColor = vec4(mix(uTint * 0.35, col, fog), 1.0);
        }`,
    });
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), this.bed);
    bed.position.set(0, -0.02, -10);
    this.group.add(bed);
    // the tunnel's own floor: a dark walkway
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.8, D + BACK).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a2a32, roughness: 0.35, metalness: 0.3 }));
    walk.position.set(0, 0.005, (BACK - D) / 2);
    this.group.add(walk);
    // rocks
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a4a4a, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + Math.random() * 1.8, 0), rockMat);
      rock.position.set(side * (R + 1.5 + Math.random() * 12), 0, -Math.random() * 40 + 5);
      rock.scale.y = 0.5 + Math.random() * 0.6;
      rock.rotation.set(Math.random(), Math.random() * 6, 0);
      this.group.add(rock);
    }
    // kelp: tall swaying ribbons outside the glass
    const kelpGeo = new THREE.PlaneGeometry(0.35, 7, 1, 10).translate(0, 3.5, 0);
    this.kelp = new THREE.InstancedMesh(kelpGeo, new THREE.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x0a1a08 }), 70);
    for (let i = 0; i < 70; i++) {
      const side = i % 2 ? 1 : -1;
      this.dummy.position.set(side * (R + 1 + Math.random() * 10), 0, -Math.random() * 36 + 4);
      this.dummy.rotation.set(0, Math.random() * 6, 0);
      this.dummy.scale.set(1, 0.6 + Math.random() * 0.9, 1);
      this.dummy.updateMatrix();
      this.kelpBase.push(this.dummy.matrix.clone());
      this.kelp.setMatrixAt(i, this.dummy.matrix);
    }
    this.group.add(this.kelp);
    // light shafts from the surface
    this.shafts = new THREE.ShaderMaterial({
      uniforms: { uGain: { value: 0.5 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.6, 0.9, 1) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uGain, uTime; uniform vec3 uColor; varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
          float flick = 0.7 + 0.3 * sin(uTime * 0.8 + vUv.x * 12.0);
          gl_FragColor = vec4(uColor * uGain * edge * vUv.y * flick * 0.35, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 9; i++) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.4 + Math.random() * 2, 22), this.shafts);
      shaft.position.set((Math.random() - 0.5) * 30, 10, -Math.random() * 30 + 2);
      shaft.rotation.set(0, Math.random() * 3, 0.25 + Math.random() * 0.2);
      this.group.add(shaft);
    }
    // the fish: schools circling the tunnel
    const fishMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5, emissive: 0x081018 });
    this.fish = new THREE.InstancedMesh(fishGeometry(), fishMat, FISH);
    const col = new THREE.Color();
    const hues = [0.08, 0.15, 0.55, 0.95, 0.6];
    for (let i = 0; i < FISH; i++) {
      const school = i % 5;
      this.fishData.push({ a: Math.random() * Math.PI * 2, r: R + 0.8 + Math.random() * 2.5, y: 0, z: -Math.random() * (D + 4) + 2, speed: 0.25 + Math.random() * 0.2, school, w: Math.random() * 6 });
      this.fish.setColorAt(i, col.setHSL(hues[school] + (Math.random() - 0.5) * 0.04, 0.8, 0.55));
    }
    this.group.add(this.fish);
    // the whale and the jellyfish
    this.whale = whale(new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.6 }));
    this.whale.visible = false;
    this.group.add(this.whale);
    this.jellyMat = new THREE.MeshBasicMaterial({ color: 0xff7ae0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    this.jellies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), this.jellyMat, JELLY);
    this.jellies.visible = false;
    this.group.add(this.jellies);
    this.people(0.9, 2101, { area: [-R + 1.5, R - 1.5, -1.7, -D + 1.5], phones: 0.35, clothes: ['#e8eaf0', '#1d4d6a', '#5fe8ff', '#ffb547', '#16171a', '#2a2d33'] });
    this.wash(V(0, R - 0.5, -4), 0, 1.6, 10);
    this.wash(V(0, R - 0.5, -12), 1, 1.6, 10);
  }

  protected onAction(id: string): void {
    if (id === 'feed') this.feedT = 0;
  }

  startMoment(id: string, len = 8): void {
    super.startMoment(id, id === 'whale' ? 14 : len);
    if (id === 'whale') this.whaleT = 0;
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const t = this.time;
    const deep = this.on('deep') ? 1 : 0;
    const mode = this.look.mode;
    // the water's colour by mode, darker deeper
    const tints = [0x1aa8c8, 0x06203a, 0x1a7a5a, 0x7ab8d8];
    this.waterCol.set(tints[mode]).multiplyScalar(1 - deep * 0.6);
    this.fogBase.copy(this.waterCol).multiplyScalar(0.35);
    this.fogDensity = 0.03 + deep * 0.03 + (mode === 1 ? 0.02 : 0);
    const u = this.glass.uniforms;
    u.uTime.value = t;
    u.uCaustic.value = this.drive.floor;
    (u.uTint.value as THREE.Color).copy(this.waterCol);
    u.uLights.value = (this.on('lights') ? 1 : 0.2) * (0.4 + s.kick * 0.8);
    (u.uC0.value as THREE.Color).copy(this.cols[0]);
    this.shafts.uniforms.uTime.value = t;
    this.shafts.uniforms.uGain.value = (0.3 + this.drive.ceil * 1.2) * (1 - deep * 0.8) * (mode === 1 ? 0.3 : 1);
    // kelp sways
    for (let i = 0; i < this.kelpBase.length; i++) {
      this.dummy.matrix.copy(this.kelpBase[i]);
      this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);
      this.dummy.rotation.setFromQuaternion(this.dummy.quaternion);
      this.dummy.rotation.z = Math.sin(t * 0.7 + i) * 0.12;
      this.dummy.updateMatrix();
      this.kelp.setMatrixAt(i, this.dummy.matrix);
    }
    this.kelp.instanceMatrix.needsUpdate = true;
    this.kelp.visible = mode !== 3;
    // fish: each school circles the tunnel; the melody speeds them up; one school on the pad; feeding rushes the glass
    const melody = this.parts?.melody ?? s.high;
    this.feedT += dt;
    const feed = Math.max(0, 1 - this.feedT / 3);
    const swirl = this.momentK('swirl');
    const one = this.on('school') ? 1 : 0;
    for (let i = 0; i < FISH; i++) {
      const fd = this.fishData[i];
      const dir = fd.school % 2 ? 1 : -1;
      fd.a += dir * fd.speed * (0.6 + melody * 1.4 + swirl * 2.5) * dt;
      const tight = Math.max(one, swirl);
      const r = fd.r * (1 - tight * 0.15) - feed * 0.6;
      const zc = fd.school * -3.5 - 1;
      const z = fd.z * (1 - tight) + (zc + Math.sin(fd.w + t * 0.2) * 2) * tight;
      // round the arch (above the floor only), the fish facing along their path
      const ang = (fd.a % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const arcA = ang < Math.PI ? ang : Math.PI * 2 - ang;
      const x = Math.cos(arcA) * r;
      const y = Math.sin(arcA) * r * 0.95 + 0.3 + Math.sin(t * 2 + fd.w) * 0.08;
      this.dummy.position.set(x, y, z);
      const tangent = V(-Math.sin(arcA), Math.cos(arcA), 0).multiplyScalar(dir * (ang < Math.PI ? 1 : -1));
      this.dummy.lookAt(x + tangent.x, y + tangent.y, z + tangent.z);
      this.dummy.rotateY(Math.sin(t * 8 + fd.w) * 0.15);
      this.dummy.scale.setScalar(mode === 3 ? 1.4 : 1);
      this.dummy.updateMatrix();
      this.fish.setMatrixAt(i, this.dummy.matrix);
    }
    this.fish.instanceMatrix.needsUpdate = true;
    // the whale: one slow pass overhead, side to side across the tunnel
    if (this.whaleT >= 0) {
      this.whaleT += dt;
      const k = this.whaleT / 14;
      this.whale.visible = k < 1;
      this.whale.position.set(-30 + k * 60, R + 4 + Math.sin(k * Math.PI) * 1.5, -8);
      this.whale.rotation.set(0, Math.PI / 2, Math.sin(this.whaleT * 0.6) * 0.05);
      this.whale.children[1].rotation.x = Math.sin(this.whaleT * 1.2) * 0.25;
      if (k >= 1) this.whaleT = -1;
    }
    // jellyfish, glowing, drifting up in the deep moment and in deep water
    const jk = Math.max(this.momentK('jelly'), mode === 1 ? 0.6 : 0, deep * 0.8);
    this.jellies.visible = jk > 0.02;
    if (this.jellies.visible) {
      this.jellyMat.color.copy(this.cols[1]).multiplyScalar(0.5 + jk + this.drive.ceil * 0.6);
      for (let i = 0; i < JELLY; i++) {
        const side = i % 2 ? 1 : -1;
        const y = ((t * 0.25 + i * 0.37) % 1) * 9;
        const pulse = 1 + 0.15 * Math.sin(t * 3 + i);
        this.dummy.position.set(side * (R + 1.2 + (i % 5) * 0.9), y, -2 - (i * 1.3) % (D - 2));
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(pulse, 1 / pulse, pulse);
        this.dummy.updateMatrix();
        this.jellies.setMatrixAt(i, this.dummy.matrix);
      }
      this.jellies.instanceMatrix.needsUpdate = true;
    }
    this.lookUp = Math.min(1, this.momentK('whale') * 1.2 + swirl * 0.6 + feed * 0.4);
  }
}

export const aquarium: VenueDef = {
  id: 'aquarium',
  name: 'Aquarium',
  short: 'Aquarium',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A glass tunnel under the sea: fish schools swirl to the melody and a whale passes over on the drop.',
  palette: ['#5fe8ff', '#ff7ae0', '#ffd23f'],
  ui: '#5fe8ff',
  capacity: '220',
  build: () => new Aquarium(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1aa8c8');
    grad.addColorStop(1, '#06324a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w / 2, h, h * 0.8, Math.PI, 0);
    g.stroke();
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `hsl(${[30, 50, 200, 340][i % 4]},80%,60%)`;
      const a = Math.PI + (i / 30) * Math.PI;
      g.fillRect(w / 2 + Math.cos(a) * h * 0.95, h + Math.sin(a) * h * 0.95, 5, 2);
    }
    g.fillStyle = '#3a4a5a';
    g.beginPath();
    g.ellipse(w * 0.6, h * 0.15, w * 0.22, h * 0.07, 0, 0, Math.PI * 2);
    g.fill();
  },
};
