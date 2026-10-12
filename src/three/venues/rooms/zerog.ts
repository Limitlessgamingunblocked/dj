/*
 * Zero Gravity: a space-station module, a long white cylinder with a window
 * strip onto the planet below. In the breakdowns gravity lets go: the crowd
 * drifts up off the floor in groups, tilting as they go, and the props float
 * and tumble (balls, cups, cubes, glow sticks). On the drop it all slams
 * back down, and the ring lights along the module flash round it.
 *
 *   modes    station (white), night shift (dark), neon, sunrise (the planet's dawn in the window)
 *   pads     zero-G (hold), slam, spin the module, launch
 *   moments  slam (big: everything down hard), launch (big: everything up at once), drift (deep)
 *   stems    the ring lights follow the drums, the drift the melody, the window the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { Crowd } from '../crowd';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const R = 6;
const D = 15;
const BACK = 3;
const PROPS = 140;
/** the cylinder's axis height: the deck cuts across it 0.6 m above its bottom */
const CY = R - 0.6;

const SHELL_FRAG = /* glsl */ `
  ${HUE_GLSL}
  uniform float uMode, uTime, uRing, uSpin, uWindow, uHue;
  uniform vec3 uC0, uC1;
  varying vec3 vP;
  void main() {
    // around the cylinder (a) and along it (z)
    float a = atan(vP.y - ${CY.toFixed(2)}, vP.x) + uSpin;
    float z = vP.z;
    vec3 base = uMode < 0.5 ? vec3(0.82, 0.84, 0.88) : uMode < 1.5 ? vec3(0.08, 0.09, 0.12) : uMode < 2.5 ? vec3(0.05, 0.04, 0.08) : vec3(0.78, 0.74, 0.7);
    // panels and their seams
    float pa = fract(a * 12.0 / 6.2831853);
    float pz = fract(z / 1.6);
    float seam = 1.0 - smoothstep(0.0, 0.02, min(min(pa, 1.0 - pa), min(pz, 1.0 - pz)) * 3.0);
    vec3 col = base * (0.85 + 0.15 * step(0.5, fract(floor(a * 12.0 / 6.2831853) * 0.5 + floor(z / 1.6) * 0.5)));
    col *= 1.0 - seam * 0.45;
    // ring lights every 3.2 m, chasing with the drums
    float ring = smoothstep(0.43, 0.47, abs(fract(z / 3.2) - 0.5));
    float chase = 0.5 + 0.5 * sin(z * 0.9 - uTime * 6.0);
    vec3 rc = mix(uC0, uC1, chase);
    col += rc * ring * (0.3 + uRing * 2.5) * (uMode > 1.5 && uMode < 2.5 ? 1.6 : 1.0);
    // the window strip: the planet below, the stars beyond
    float side = sin(a);
    float win = smoothstep(0.08, 0.04, abs(cos(a) + 0.15)) * step(side, 0.0) * step(-${(D - 1).toFixed(1)}, z) * step(z, -1.0);
    if (win > 0.0) {
      float lat = z * 0.03 + uTime * 0.01;
      float land = smoothstep(0.45, 0.55, fract(sin(floor(lat * 40.0) * 12.9) * 43758.5) * 0.6 + 0.4 * sin(lat * 7.0 + a * 3.0));
      vec3 sea = vec3(0.02, 0.12, 0.35);
      vec3 ground = vec3(0.12, 0.3, 0.12);
      vec3 planet = mix(sea, ground, land);
      if (uMode > 2.5) planet = mix(planet, vec3(1.0, 0.55, 0.25), 0.45);
      float cloud = smoothstep(0.6, 0.9, fract(sin(floor(lat * 90.0 + a * 20.0) * 4.1) * 43758.5));
      planet = mix(planet, vec3(0.9), cloud * 0.5);
      col = mix(col, planet * (0.6 + uWindow * 0.8), win);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

class ZeroG extends CrazyRoom {
  readonly modes = ['Station', 'Night shift', 'Neon', 'Sunrise'];
  readonly actions: RoomAction[] = [
    { id: 'float', label: 'Zero-G', kind: 'hold' },
    { id: 'slam', label: 'Slam', kind: 'hit' },
    { id: 'spin', label: 'Spin', kind: 'toggle' },
    { id: 'launch', label: 'Launch', kind: 'hit' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'slam', label: 'Gravity slams back on', energy: 'big' },
    { id: 'launch', label: 'Everyone launches off the floor', energy: 'big' },
    { id: 'drift', label: 'The room drifts in zero-G', energy: 'deep' },
  ];
  private mat: THREE.ShaderMaterial;
  private groups: { crowd: Crowd; y: number; v: number; phase: number; tilt: THREE.Vector2 }[] = [];
  private props: THREE.InstancedMesh;
  private prop: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; s: number }[] = [];
  /** 0 = full gravity, 1 = none */
  private float = 0;
  private spin = 0;
  private dummy = new THREE.Object3D();

  constructor() {
    super({ roomId: 'zerog', roomName: 'Zero Gravity', w: R - 0.6, h: R * 2 - 1, d: D, back: BACK, fog: 0x0a0c12, fogDensity: 0.012, hemi: 0.45, booth: { strip: '#9fe6ff' } });
    this.views.wide = { pos: V(-2.2, 2.6, -D + 1.2), target: V(0, 2.2, 0) };
    this.views.wideLabel = 'Down the module';
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMode: { value: 0 }, uTime: { value: 0 }, uRing: { value: 0 }, uSpin: { value: 0 }, uWindow: { value: 0 }, uHue: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() } },
      vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
      fragmentShader: SHELL_FRAG,
      side: THREE.BackSide,
    });
    // the module: a cylinder along Z, the floor a flat deck across its bottom
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, D + BACK, 48, 1, true).rotateX(Math.PI / 2), this.mat);
    cyl.position.set(0, CY, (BACK - D) / 2);
    this.group.add(cyl);
    for (const z of [-D, BACK]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(R, 48), this.mat);
      cap.position.set(0, CY, z);
      cap.rotation.y = z < 0 ? Math.PI : 0;
      this.group.add(cap);
    }
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.6, D + BACK).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6c7280, roughness: 0.5, metalness: 0.4 }));
    deck.position.set(0, 0.002, (BACK - D) / 2);
    this.group.add(deck);
    // floating props: balls, cups, cubes and glow sticks
    const geo = new THREE.IcosahedronGeometry(0.16, 1);
    const pm = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, emissive: 0x111111 });
    this.props = new THREE.InstancedMesh(geo, pm, PROPS);
    const col = new THREE.Color();
    for (let i = 0; i < PROPS; i++) {
      const s = 0.4 + Math.random() * 1.4;
      this.prop.push({ p: V((Math.random() - 0.5) * (R * 1.4), 0.1 + s * 0.16, -1.5 - Math.random() * (D - 3)), v: V(0, 0, 0), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), s });
      this.props.setColorAt(i, col.setHSL(Math.random(), 0.75, 0.55));
    }
    this.group.add(this.props);
    // four groups of people, each floats on its own
    const quads: [number, number, number, number][] = [
      [-R + 1.4, -0.2, -1.8, -D / 2],
      [0.2, R - 1.4, -1.8, -D / 2],
      [-R + 1.4, -0.2, -D / 2 - 0.4, -D + 1.2],
      [0.2, R - 1.4, -D / 2 - 0.4, -D + 1.2],
    ];
    quads.forEach((a, i) => {
      const c = this.people(0.9, 2001 + i * 7, { area: a, y: 0, phones: 0.25, clothes: ['#e8eaf0', '#2a2d33', '#9fe6ff', '#ff8a3c', '#16171a', '#d0d4dc'] });
      this.groups.push({ crowd: c, y: 0, v: 0, phase: i * 1.7, tilt: new THREE.Vector2() });
    });
    this.wash(V(0, CY + R * 0.6, -4), 0, 2.4, 14);
    this.wash(V(0, CY + R * 0.6, -11), 1, 2.4, 14);
    this.wash(V(0, 3, 1.2), 2, 1.2, 6);
  }

  protected onAction(id: string): void {
    if (id === 'slam') this.slam();
    if (id === 'launch') this.launch(4);
  }

  private slam(): void {
    for (const g of this.groups) g.v = Math.min(g.v, -3);
    for (const p of this.prop) p.v.y = Math.min(p.v.y, -6);
    this.float = 0;
  }

  private launch(up: number): void {
    for (const g of this.groups) g.v = up * (0.8 + Math.random() * 0.4);
    for (const p of this.prop) p.v.set((Math.random() - 0.5) * 2, up * (0.7 + Math.random() * 0.8), (Math.random() - 0.5) * 2);
  }

  startMoment(id: string, len = 8): void {
    super.startMoment(id, len);
    if (id === 'slam') this.slam();
    if (id === 'launch') this.launch(5);
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const u = this.mat.uniforms;
    // gravity lets go in the quiet parts and a breakdown, and on the pad
    const quiet = s.playing && s.peak < 0.3 && (s.build > 0.2 || s.energy < 0.45);
    const want = this.on('float') || this.momentK('drift') > 0.1 || this.momentK('launch') > 0.1 ? 1 : quiet ? 0.85 : 0;
    this.float += (want - this.float) * Math.min(1, dt * (want > this.float ? 0.6 : 2.5));
    const g = 9.8 * (1 - this.float) + 0.15;
    const melody = this.parts?.melody ?? s.high;
    // people: float up to a metre or two, bob, tilt; drop back with gravity
    for (const grp of this.groups) {
      const lift = this.float * (1.0 + 0.8 * Math.sin(this.time * 0.4 + grp.phase) + melody * 0.6);
      grp.v += (lift * 1.5 - grp.y) * this.float * dt * 1.2 - g * dt * (grp.y > 0 ? 1 : 0);
      grp.v *= Math.exp(-dt * (0.6 + 2 * (1 - this.float)));
      grp.y += grp.v * dt;
      if (grp.y < 0) {
        grp.y = 0;
        grp.v = Math.abs(grp.v) > 2 ? -grp.v * 0.15 : 0;
      }
      grp.tilt.set(Math.sin(this.time * 0.3 + grp.phase) * 0.12, Math.cos(this.time * 0.25 + grp.phase) * 0.12).multiplyScalar(Math.min(1, grp.y));
      const o = grp.crowd.object;
      o.position.y = grp.y;
      o.rotation.set(grp.tilt.x, 0, grp.tilt.y);
    }
    // props: drift and tumble in zero-G, bounce off the deck with gravity
    const top = CY + R - 0.8;
    for (let i = 0; i < this.prop.length; i++) {
      const p = this.prop[i];
      p.v.y -= g * dt;
      if (this.float > 0.5) p.v.addScaledVector(V(Math.sin(this.time * 0.3 + i), Math.cos(this.time * 0.2 + i * 1.3), Math.sin(this.time * 0.25 + i * 0.7)), dt * 0.15 * this.float);
      p.p.addScaledVector(p.v, dt);
      const floor = 0.16 * p.s;
      if (p.p.y < floor) {
        p.p.y = floor;
        p.v.y = Math.abs(p.v.y) * 0.35;
        p.v.x *= 0.8;
        p.v.z *= 0.8;
      }
      if (p.p.y > top) p.v.y = -Math.abs(p.v.y);
      if (Math.abs(p.p.x) > R - 1) p.v.x = -p.v.x;
      if (p.p.z > -1 || p.p.z < -D + 0.6) p.v.z = -p.v.z;
      p.r.x += p.w.x * dt * (0.3 + this.float * 2);
      p.r.y += p.w.y * dt * (0.3 + this.float * 2);
      this.dummy.position.copy(p.p);
      this.dummy.rotation.copy(p.r);
      this.dummy.scale.setScalar(p.s);
      this.dummy.updateMatrix();
      this.props.setMatrixAt(i, this.dummy.matrix);
    }
    this.props.instanceMatrix.needsUpdate = true;
    // the module turns on the pad
    this.spin += (this.on('spin') ? 0.25 : 0) * dt;
    u.uSpin.value = this.spin;
    u.uMode.value = this.look.mode;
    u.uTime.value = this.time;
    u.uRing.value = this.drive.floor * (0.6 + 0.4 * s.master) + this.momentK('slam') * 1.5 + s.flash;
    u.uWindow.value = this.drive.ceil;
    (u.uC0.value as THREE.Color).copy(this.cols[0]);
    (u.uC1.value as THREE.Color).copy(this.cols[1]);
    this.lookUp = Math.min(1, this.float * 0.8);
  }
}

export const zeroGravity: VenueDef = {
  id: 'zerog',
  name: 'Zero Gravity',
  short: 'Zero-G',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A space-station module where the crowd floats in the breakdowns and slams down on the drop.',
  palette: ['#9fe6ff', '#ff8a3c', '#ffffff'],
  ui: '#9fe6ff',
  capacity: '200',
  build: () => new ZeroG(),
  thumb(g, w, h) {
    g.fillStyle = '#c9ced8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e7eaf0';
    g.beginPath();
    g.ellipse(w / 2, h / 2, w * 0.45, h * 0.42, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d2a5a';
    g.fillRect(w * 0.08, h * 0.62, w * 0.84, h * 0.08);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `hsl(${i * 40},70%,55%)`;
      g.beginPath();
      g.arc(w * (0.15 + Math.random() * 0.7), h * (0.2 + Math.random() * 0.35), 3 + Math.random() * 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#1b1d22';
    for (let i = 0; i < 6; i++) g.fillRect(w * (0.2 + i * 0.11), h * (0.3 + (i % 3) * 0.08), 4, 10);
  },
};
