/*
 * The Lava Lamp Room: giant lava lamps round the room and one huge one
 * behind the booth, the blobs inside rising, stretching and splitting with
 * the bass in slow, warm colours. The lamps light the room, so the walls and
 * the crowd glow with them.
 *
 *   modes    classic (orange in red), purple haze, mint, rainbow
 *   pads     heat (hold: the blobs rise faster), split, swirl, glow
 *   moments  eruption (big: everything shoots up), merge (big: one great blob), melt (deep: slow and low)
 *   stems    the blobs' wobble follows the drums, their rise the melody, the glow the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 9;
const H = 8;
const D = 15;
const BLOBS = 7;

const LAMP_VERT = /* glsl */ `
  varying vec3 vO;
  varying vec3 vEye;
  void main() {
    vO = position;
    // the camera in the lamp's own space, for the ray
    vEye = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LAMP_FRAG = /* glsl */ `
  ${HUE_GLSL}
  uniform vec4 uBlob[${BLOBS}];
  uniform float uMode, uHue, uGlow, uTime, uK;
  uniform vec3 uFluid, uWax;
  varying vec3 vO;
  varying vec3 vEye;
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  float field(vec3 p) {
    float d = 10.0;
    for (int i = 0; i < ${BLOBS}; i++) {
      vec4 b = uBlob[i];
      vec3 q = p - b.xyz;
      q.y *= 0.8;
      d = smin(d, length(q) - b.w, uK);
    }
    // a pool of wax on the bottom, and a little under the cap
    d = smin(d, p.y + 0.42, 0.12);
    return d;
  }
  vec3 waxCol(float y) {
    vec3 c = uWax;
    if (uMode > 2.5) c = hsv(fract(y * 0.6 + uTime * 0.03 + uHue), 0.85, 1.0);
    return c;
  }
  void main() {
    // the lamp's unit space: radius 0.5 round Y, y from -0.5 to 0.5
    vec3 ro = vEye;
    vec3 rd = normalize(vO - vEye);
    vec3 p = vO;
    float t = 0.0;
    vec3 col = uFluid * (0.35 + uGlow * 0.4);
    float hit = 0.0;
    for (int i = 0; i < 40; i++) {
      vec3 q = p + rd * t;
      if (length(q.xz) > 0.505 || abs(q.y) > 0.505) break;
      float d = field(q);
      if (d < 0.004) { hit = 1.0; p = q; break; }
      t += max(d * 0.8, 0.008);
    }
    if (hit > 0.5) {
      vec2 e = vec2(0.006, 0.0);
      vec3 n = normalize(vec3(field(p + e.xyy) - field(p - e.xyy), field(p + e.yxy) - field(p - e.yxy), field(p + e.yyx) - field(p - e.yyx)));
      float rim = pow(1.0 - abs(dot(n, -rd)), 2.0);
      vec3 wc = waxCol(p.y);
      col = wc * (0.55 + 0.45 * max(0.0, n.y) + rim * 0.8) * (0.9 + uGlow * 0.8);
    }
    // the glass: a glint down the side
    vec3 gn = normalize(vec3(vO.x, 0.0, vO.z));
    float edge = pow(1.0 - abs(dot(gn, -rd)), 4.0);
    col += vec3(1.0) * edge * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const PALETTES: [number, number][] = [
  [0xb01010, 0xff8a1a],
  [0x2a0a4a, 0xff3df0],
  [0x0a3a2a, 0x7affc8],
  [0x101014, 0xffffff],
];

interface Lamp {
  mat: THREE.ShaderMaterial;
  blobs: { y: number; v: number; x: number; z: number; r: number; phase: number }[];
  light: THREE.PointLight;
}

class LavaRoom extends CrazyRoom {
  readonly modes = ['Classic', 'Purple haze', 'Mint', 'Rainbow'];
  readonly actions: RoomAction[] = [
    { id: 'heat', label: 'Heat', kind: 'hold' },
    { id: 'split', label: 'Split', kind: 'hit' },
    { id: 'swirl', label: 'Swirl', kind: 'toggle' },
    { id: 'glow', label: 'Glow', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'eruption', label: 'The lamps erupt', energy: 'big' },
    { id: 'merge', label: 'The wax pulls into one great blob', energy: 'big' },
    { id: 'melt', label: 'Everything melts down slow', energy: 'deep' },
  ];
  private lamps: Lamp[] = [];
  private splitT = 99;

  constructor() {
    super({ roomId: 'lava', roomName: 'Lava Lamp Room', w: W, h: H, d: D, back: 3, fog: 0x0a0406, fogDensity: 0.02, hemi: 0.2, booth: { strip: '#ff8a1a' } });
    this.views.wide = { pos: V(-W + 1.5, 2.2, -D + 1.5), target: V(0, 3, 0) };
    this.views.wideLabel = 'Among the lamps';
    this.ambient = 0.5;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), new THREE.MeshStandardMaterial({ color: 0x1a0e10, roughness: 0.85, side: THREE.BackSide }));
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D + 3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x120a0a, roughness: 0.25, metalness: 0.3 }));
    floor.position.set(0, 0.003, (3 - D) / 2);
    this.group.add(floor);
    // the lamps: three down each side, one huge one behind the booth
    const spots: [number, number, number, number][] = [
      [-W + 1.4, -3, 1.2, 6],
      [-W + 1.4, -8, 1.2, 6],
      [-W + 1.4, -13, 1.2, 6],
      [W - 1.4, -3, 1.2, 6],
      [W - 1.4, -8, 1.2, 6],
      [W - 1.4, -13, 1.2, 6],
      [0, 2.4, 2.2, 7.4],
    ];
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.25, metalness: 0.95 });
    for (const [x, z, r, h] of spots) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uBlob: { value: Array.from({ length: BLOBS }, () => new THREE.Vector4(0, -1, 0, 0.05)) },
          uMode: { value: 0 },
          uHue: { value: 0 },
          uGlow: { value: 0 },
          uTime: { value: 0 },
          uK: { value: 0.12 },
          uFluid: { value: new THREE.Color() },
          uWax: { value: new THREE.Color() },
        },
        vertexShader: LAMP_VERT,
        fragmentShader: LAMP_FRAG,
      });
      // the glass, a tapered body on a cone base under a cone cap
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 32), mat);
      glass.scale.set(r * 2, h, r * 2);
      glass.position.set(x, 1.1 + h / 2, z);
      this.group.add(glass);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 1.2, 1.1, 32), metal);
      base.position.set(x, 0.55, z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.95, 0.8, 32), metal);
      cap.position.set(x, 1.1 + h + 0.4, z);
      this.group.add(base, cap);
      const light = new THREE.PointLight(0xff6a1a, 2, 9, 1.6);
      light.position.set(x * 0.85, 1.1 + h * 0.5, z);
      this.group.add(light);
      const blobs = Array.from({ length: BLOBS }, (_, i) => ({ y: -0.4 + Math.random() * 0.8, v: 0, x: (Math.random() - 0.5) * 0.4, z: (Math.random() - 0.5) * 0.4, r: 0.07 + Math.random() * 0.06, phase: i * 1.3 + x }));
      this.lamps.push({ mat, blobs, light });
    }
    this.people(0.9, 2401, { area: [-W + 3, W - 3, -1.8, -D + 1.5], phones: 0.25, clothes: ['#e8eaf0', '#ff8a1a', '#16171a', '#2a2d33', '#7a3cff', '#d0d4dc'] });
    this.wash(V(0, H - 0.5, -6), 0, 1.4, 14);
  }

  protected onAction(id: string): void {
    if (id === 'split') this.splitT = 0;
  }

  startMoment(id: string, len = 8): void {
    super.startMoment(id, len);
    if (id === 'eruption') for (const l of this.lamps) for (const b of l.blobs) b.v = 0.6 + Math.random() * 0.5;
    if (id === 'merge') this.splitT = 99;
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const heat = (this.on('heat') ? 1.8 : 1) * (1 - this.momentK('melt') * 0.7);
    const melody = this.parts?.melody ?? s.high;
    const wob = this.drive.floor;
    const merge = this.momentK('merge');
    this.splitT += dt;
    const split = Math.max(0, 1 - this.splitT / 2.5);
    const [fluid, wax] = PALETTES[this.look.mode];
    const glow = (this.on('glow') ? 0.8 : 0) + this.drive.ceil * 0.7 + s.kick * 0.15;
    for (const lamp of this.lamps) {
      const u = lamp.mat.uniforms;
      lamp.blobs.forEach((b, i) => {
        // warm wax rises, cools at the top and sinks: a slow loop each, faster with heat and the melody
        const target = Math.sin(this.time * 0.08 * heat * (0.8 + melody * 0.8) + b.phase) * 0.38;
        b.v += (target - b.y) * dt * 0.6 * heat - b.v * dt * 0.8;
        b.y = Math.max(-0.42, Math.min(0.42, b.y + b.v * dt));
        const sw = this.on('swirl') ? this.time * 0.6 + i : 0;
        const cx = merge > 0 ? b.x * (1 - merge) : b.x * Math.cos(sw) - b.z * Math.sin(sw) * (this.on('swirl') ? 1 : 0);
        const cz = merge > 0 ? b.z * (1 - merge) : b.z;
        const cy = merge > 0 ? b.y * (1 - merge * 0.8) : b.y;
        // split: alternate blobs pull apart sideways
        const off = split * (i % 2 ? 0.15 : -0.15);
        const r = b.r * (1 + wob * 0.35 * Math.sin(this.time * 6 + i)) * (1 + merge * 0.4);
        (u.uBlob.value[i] as THREE.Vector4).set(cx + off, cy, cz, r);
      });
      u.uK.value = 0.1 + merge * 0.12 - split * 0.06;
      u.uMode.value = this.look.mode;
      u.uHue.value = this.look.hue;
      u.uTime.value = this.time;
      u.uGlow.value = glow;
      (u.uFluid.value as THREE.Color).set(fluid);
      const wc = u.uWax.value as THREE.Color;
      wc.set(wax);
      if (this.look.hue > 0.01) wc.offsetHSL(this.look.hue, 0, 0);
      lamp.light.color.copy(wc);
      lamp.light.intensity = (1.6 + glow * 2.5) * (0.5 + 0.5 * s.master);
    }
    this.lookUp = Math.min(1, this.momentK('eruption') + merge * 0.6);
  }
}

export const lavaLamp: VenueDef = {
  id: 'lava',
  name: 'Lava Lamp Room',
  short: 'Lava Lamp',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Giant lava lamps whose blobs rise, stretch and split with the bass, lighting the room in slow colours.',
  palette: ['#ff8a1a', '#ff2e88', '#ffd23f'],
  ui: '#ff8a1a',
  capacity: '220',
  build: () => new LavaRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#1a0e10';
    g.fillRect(0, 0, w, h);
    for (const [x, sc] of [
      [0.2, 0.7],
      [0.5, 1],
      [0.8, 0.7],
    ] as [number, number][]) {
      const lw = w * 0.14 * sc;
      const lh = h * 0.7 * sc;
      const lx = w * x - lw / 2;
      const ly = h * 0.9 - lh;
      g.fillStyle = '#b01010';
      g.fillRect(lx, ly, lw, lh);
      g.fillStyle = '#ff8a1a';
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.ellipse(lx + lw * (0.3 + (i % 2) * 0.4), ly + lh * (0.2 + i * 0.2), lw * 0.22, lh * 0.07, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
};
