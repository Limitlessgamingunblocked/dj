/*
 * The Fog Room: haze so thick you only see light. Beams from the ceiling
 * read as solid bars, sheets of light cut flat planes overhead, and light
 * sculptures hang in the fog over the crowd: rings, a tunnel, a face, a star.
 * Everything that's drawn with light stays 3.5 m or more above the floor.
 *
 *   modes    the sculpture: rings, tunnel, face, star
 *   pads     next shape, light sheets, thicker fog (hold), spin
 *   moments  tunnel (big: rings rush at the booth), bloom (big: rings burst
 *            outward), face (deep: a face appears in the fog and smiles)
 *   stems    the beams follow the drums, the sculpture the melody, the sheets
 *            the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import { MovingHeads } from '../fixtures';
import type { ShowState } from '../show';
import { CrazyRoom, V, glowMaterial, type RoomAction, type RoomMoment } from './kit';

const W = 8;
const H = 7.5;
const D = 16;
/** the sculptures' centre: well over the heads */
const SY = 4.6;
const SZ = -7;

function tube(points: THREE.Vector3[], closed: boolean, r = 0.05): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  return new THREE.TubeGeometry(curve, Math.max(24, points.length * 6), r, 8, closed);
}

function circle(r: number, n = 48, cx = 0, cy = 0, a0 = 0, a1 = Math.PI * 2): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(V(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0));
  }
  return out;
}

class FogRoom extends CrazyRoom {
  readonly modes = ['Rings', 'Tunnel', 'Face', 'Star'];
  readonly actions: RoomAction[] = [
    { id: 'next', label: 'Next shape', kind: 'hit' },
    { id: 'sheets', label: 'Light sheets', kind: 'toggle' },
    { id: 'thick', label: 'Thicker', kind: 'hold' },
    { id: 'spin', label: 'Spin', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'tunnel', label: 'A tunnel of light rushes at the booth', energy: 'big' },
    { id: 'bloom', label: 'The rings burst outward', energy: 'big' },
    { id: 'face', label: 'A face appears in the fog', energy: 'deep' },
  ];
  private shapes: { group: THREE.Group; mats: THREE.ShaderMaterial[]; k: number }[] = [];
  private sheets: THREE.Mesh[] = [];
  private sheetMat: THREE.ShaderMaterial;
  private spin = 0;
  private tunnelZ = 0;

  constructor() {
    super({ roomId: 'fog', roomName: 'Fog Room', w: W, h: H, d: D, back: 3, fog: 0x0a0a10, fogDensity: 0.11, hemi: 0.12, booth: { strip: '#ffffff' } });
    this.ambient = 0.3;
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 1, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), dark);
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    // beams: solid bars in this fog
    this.add(
      new MovingHeads(
        [-6, -3, 0, 3, 6].flatMap((x) => [-2.5, -8, -13].map((z) => ({ pos: V(x, H - 0.3, z) }))),
        { length: 11, radius: 0.35, gain: 1.6, floorY: 0, haze: [0.2, H] },
      ),
    );
    // the sculptures, each a group of glowing tubes
    const make = (geos: THREE.BufferGeometry[]) => {
      const g = new THREE.Group();
      const mats: THREE.ShaderMaterial[] = [];
      for (const geo of geos) {
        const m = glowMaterial(new THREE.Color(1, 1, 1));
        mats.push(m);
        g.add(new THREE.Mesh(geo, m));
      }
      g.position.set(0, SY, SZ);
      g.visible = false;
      this.group.add(g);
      this.shapes.push({ group: g, mats, k: 0 });
    };
    make([1.4, 2.1, 2.8].map((r) => tube(circle(r), true, 0.06)));
    make(Array.from({ length: 8 }, (_, i) => tube(circle(2.2 - i * 0.05), true, 0.05).translate(0, 0, -i * 1.6)));
    make([tube(circle(2.4), true, 0.07), tube(circle(0.28, 16, -0.8, 0.6), true, 0.08), tube(circle(0.28, 16, 0.8, 0.6), true, 0.08), tube(circle(1.4, 24, 0, -0.1, Math.PI * 1.15, Math.PI * 1.85), false, 0.08)]);
    const star: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI * 2 * 2) / 5;
      star.push(V(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0));
    }
    make([tube(star, false, 0.06), tube(circle(2.9), true, 0.04)]);
    // flat sheets of light, overhead
    this.sheetMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uGain: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uGain, uTime; varying vec2 vUv;
        void main() {
          float fade = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x) * (1.0 - vUv.y);
          float ripple = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 3.0);
          gl_FragColor = vec4(uColor * uGain * fade * ripple, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 - 0.4, D * 0.9), this.sheetMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.set(0, 3.6 + i * 0.9, -D * 0.45);
      this.sheets.push(sh);
      this.group.add(sh);
    }
    this.people(0.95, 1801, { phones: 0.25, drinks: 0.2, clothes: ['#f2f2f2', '#d8d8dc', '#101114', '#2b2d33', '#c7c9ce', '#16171a'] });
  }

  protected onAction(id: string): void {
    if (id === 'next') this.setLook({ ...this.look, mode: (this.look.mode + 1) % this.modes.length });
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    // which sculpture: the look's, or the moment's
    const mm = this.moment?.id;
    const want = mm === 'tunnel' ? 1 : mm === 'face' ? 2 : mm === 'bloom' ? 0 : this.look.mode;
    const melody = this.parts?.melody ?? s.high;
    this.spin += (this.on('spin') ? 0.6 : 0.08) * dt * (0.5 + melody);
    this.tunnelZ = (this.tunnelZ + dt * (mm === 'tunnel' ? 6 : 1.2)) % 1.6;
    this.shapes.forEach((sh, i) => {
      sh.k += ((i === want ? 1 : 0) - sh.k) * Math.min(1, dt * 2);
      sh.group.visible = sh.k > 0.01;
      if (!sh.group.visible) return;
      const gain = sh.k * (0.6 + melody * 1.6 + s.kick * 0.5) * (0.4 + 0.6 * s.master) * this.look.level;
      sh.mats.forEach((m, j) => {
        (m.uniforms.uColor.value as THREE.Color).copy(this.cols[j % 3]);
        m.uniforms.uGain.value = gain * 2.2;
      });
      sh.group.rotation.z = i === 0 || i === 3 ? this.spin : 0;
      // the rings burst outward on the bloom
      const bloom = this.momentK('bloom');
      if (i === 0) sh.group.scale.setScalar(1 + bloom * 1.8 + this.drive.walls * 0.2);
      // the tunnel's rings come at the booth
      if (i === 1) sh.group.position.z = SZ + this.tunnelZ;
      // the face smiles wider with the vocals
      if (i === 2) sh.group.children[3].scale.y = 1 + this.drive.ceil * 0.6;
    });
    // the sheets, with the vocals or when switched on, sweeping slowly
    const sheetGain = (this.on('sheets') ? 0.7 : 0) + this.drive.ceil * 0.5;
    this.sheetMat.uniforms.uGain.value = sheetGain * (0.5 + 0.5 * s.master);
    (this.sheetMat.uniforms.uColor.value as THREE.Color).copy(this.cols[2]);
    this.sheetMat.uniforms.uTime.value = this.time;
    this.sheets.forEach((sh, i) => (sh.rotation.z = Math.sin(this.time * 0.2 + i * 2) * 0.15));
    // thicker fog on the pad
    this.fogDensity = 0.11 * (this.on('thick') ? 1.8 : 1) * (0.8 + 0.4 * this.look.level);
    this.lookUp = Math.min(1, 0.4 + this.momentK() * 0.6);
  }
}

export const fogRoom: VenueDef = {
  id: 'fog',
  name: 'Fog Room',
  short: 'Fog Room',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Fog so thick you only see light: solid beams, sheets of light and glowing sculptures overhead.',
  palette: ['#ffffff', '#3dd6ff', '#ff2e88'],
  ui: '#c8d6e8',
  capacity: '240',
  build: () => new FogRoom(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2a2e38');
    grad.addColorStop(1, '#0a0a10');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    for (const r of [10, 17, 24]) {
      g.beginPath();
      g.arc(w / 2, h * 0.4, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(200,230,255,0.15)';
    for (let i = 0; i < 4; i++) g.fillRect(w * (0.15 + i * 0.22), 0, 6, h);
  },
};
