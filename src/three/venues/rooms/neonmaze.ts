/*
 * The Neon Maze: a dark room of neon tubes. Maze walls of tubes line the
 * edges, arches stand among the crowd, a grid runs across the ceiling and
 * the back wall is a neon dot-matrix that spells your DJ name. Every tube
 * knows its place along the maze, so patterns chase round it.
 *
 * The patterns are the pads: chase (light runs round the maze on the beat),
 * flicker (neon stutter; held steady with Reduce flashing), pulse (all of it
 * on the kick) and name (the sign takes over). Plus a held blackout and a
 * rainbow switch.
 *
 *   moments  chase storm (big), name in lights (big), slow breathe (deep)
 *   stems    the floor-level tubes follow the drums, the walls the melody,
 *            the ceiling grid the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import { nameService } from '../../../name/NameService';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 8;
const H = 4.5;
const D = 15;
/** the name sign: characters × (5 × 7 dots) */
const CHARS = 10;
const DOT = 0.17;

/** which dots of a 5 × 7 matrix a letter lights, read off a canvas (so any letter or digit works) */
export function letterDots(ch: string): boolean[] {
  const out: boolean[] = new Array(35).fill(false);
  if (typeof document === 'undefined' || !ch.trim()) return out;
  const c = document.createElement('canvas');
  c.width = 50;
  c.height = 70;
  const g = c.getContext('2d');
  if (!g) return out;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 50, 70);
  g.fillStyle = '#fff';
  g.font = '900 66px "Barlow Condensed", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch.toUpperCase(), 25, 37);
  const d = g.getImageData(0, 0, 50, 70).data;
  for (let r = 0; r < 7; r++)
    for (let col = 0; col < 5; col++) {
      let sum = 0;
      for (let y = r * 10; y < r * 10 + 10; y++) for (let x = col * 10; x < col * 10 + 10; x++) sum += d[(y * 50 + x) * 4];
      out[r * 5 + col] = sum / 100 > 70;
    }
  return out;
}

const VERT = /* glsl */ `
  ${HUE_GLSL}
  attribute vec4 aTube;
  uniform float uTime, uBeat, uPattern, uKick, uRainbow, uBlack, uSafe, uHue, uStorm, uBreath, uName;
  uniform vec3 uDrive, uC0, uC1, uC2;
  varying vec3 vCol;
  float h11(float n) { return fract(sin(n * 127.1) * 43758.5); }
  void main() {
    // aTube: place along the maze 0..1, kind (0 floor-level maze, 1 wall, 2 ceiling, 3 name dot), lit (name dots), seed
    float t = aTube.x;
    float kind = aTube.y;
    float lit = aTube.z;
    float seed = aTube.w;
    float drive = kind < 0.5 ? uDrive.x : kind < 2.5 && kind > 1.5 ? uDrive.z : uDrive.y;
    float b = 0.35 + 0.65 * drive;
    if (uPattern < 0.5) {
      // chase: bright heads running round the maze on the beat
      float head = fract(t * 3.0 - uBeat * 0.25 * (1.0 + uStorm * 3.0));
      b *= 0.25 + 1.6 * pow(1.0 - head, 6.0);
    } else if (uPattern < 1.5) {
      // flicker: neon stutter (a steady glow with Reduce flashing)
      float f = step(0.25, h11(seed * 31.0 + floor(uTime * 9.0)));
      b *= mix(f * 1.1 + 0.15, 0.8, uSafe);
    } else if (uPattern < 2.5) {
      b *= 0.3 + 1.4 * uKick;
    } else {
      b *= kind > 2.5 ? 1.6 : 0.2 + 0.2 * sin(t * 30.0 - uTime * 3.0);
    }
    if (kind > 2.5) b = (lit > 0.5 ? max(b, 0.6 + uName * 1.6) : 0.04) ;
    b *= mix(1.0, 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.2 + t * 6.0)), uBreath);
    vec3 c = kind < 0.5 ? uC0 : kind < 1.5 ? uC1 : kind < 2.5 ? uC2 : mix(uC0, vec3(1.0), 0.35);
    if (uRainbow > 0.5) c = hsv(fract(t + uTime * 0.05 + uHue), 0.9, 1.0);
    if (kind < 2.5) b *= 1.0 - uBlack;
    vCol = c * b * 2.4;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

class NeonMaze extends CrazyRoom {
  readonly modes = ['Chase', 'Flicker', 'Pulse', 'Name'];
  readonly actions: RoomAction[] = [
    { id: 'chase', label: 'Chase', kind: 'hit' },
    { id: 'flicker', label: 'Flicker', kind: 'hit' },
    { id: 'pulse', label: 'Pulse', kind: 'hit' },
    { id: 'name', label: 'Spell name', kind: 'hit' },
    { id: 'black', label: 'Blackout', kind: 'hold' },
    { id: 'rainbow', label: 'Rainbow', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'storm', label: 'The neon goes into a chase storm', energy: 'big' },
    { id: 'name', label: 'Your name in lights', energy: 'big' },
    { id: 'breathe', label: 'The neon breathes', energy: 'deep' },
  ];
  private mat: THREE.ShaderMaterial;
  private tubeAttr: THREE.InstancedBufferAttribute;
  private nameStart = 0;
  private shownName = '';

  constructor() {
    super({ roomId: 'neonmaze', roomName: 'Neon Maze', w: W, h: H, d: D, back: 3, fog: 0x030206, fogDensity: 0.03, hemi: 0.1, booth: { strip: '#ff2e88' } });
    this.ambient = 0.35;
    // the signature angle: over the crowd to your name on the back wall
    this.views.wide = { pos: V(2.6, 2.3, -1.2), target: V(0, 2.8, -D) };
    this.views.wideLabel = 'Your name in neon';
    const dark = new THREE.MeshStandardMaterial({ color: 0x08070a, roughness: 0.6, metalness: 0.2, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), dark);
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPattern: { value: 0 },
        uKick: { value: 0 },
        uRainbow: { value: 0 },
        uBlack: { value: 0 },
        uSafe: { value: 0 },
        uHue: { value: 0 },
        uStorm: { value: 0 },
        uBreath: { value: 0 },
        uName: { value: 0 },
        uDrive: { value: new THREE.Vector3() },
        uC0: { value: new THREE.Color() },
        uC1: { value: new THREE.Color() },
        uC2: { value: new THREE.Color() },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`,
    });
    // every tube as one instance: a segment from a to b, its place along the maze and its kind
    const segs: { a: THREE.Vector3; b: THREE.Vector3; t: number; kind: number }[] = [];
    const path = (pts: THREE.Vector3[], kind: number, t0: number, t1: number) => {
      for (let i = 0; i < pts.length - 1; i++) segs.push({ a: pts[i], b: pts[i + 1], t: t0 + ((t1 - t0) * i) / (pts.length - 1), kind });
    };
    // maze walls round the edges: zig-zag runs of tubes at three heights
    for (const side of [-1, 1])
      for (const y of [0.4, 1.4, 2.4]) {
        const pts: THREE.Vector3[] = [];
        for (let z = 2; z > -D + 0.5; z -= 1.2) pts.push(V(side * (W - 0.3 - (Math.round(z / 1.2) % 2 ? 0.5 : 0)), y, z));
        path(pts, y < 1 ? 0 : 1, side < 0 ? 0 : 0.5, side < 0 ? 0.5 : 1);
      }
    // arches among the crowd
    for (let i = 0; i < 6; i++) {
      const z = -3 - i * 1.9;
      const x = (i % 2 ? 1 : -1) * 2.8;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI;
        pts.push(V(x + Math.cos(a) * 1.1, Math.sin(a) * 2.6, z));
      }
      path(pts, 1, i / 6, i / 6 + 0.15);
    }
    // the ceiling grid
    for (let x = -W + 1; x < W; x += 2) path([V(x, H - 0.1, 2), V(x, H - 0.1, -D + 0.5)], 2, (x + W) / (2 * W), (x + W) / (2 * W) + 0.2);
    for (let z = 1; z > -D; z -= 2) path([V(-W + 0.5, H - 0.12, z), V(W - 0.5, H - 0.12, z)], 2, -z / D, -z / D + 0.2);
    // the name sign: a dot-matrix of short tubes across the back wall
    const nameStart = segs.length;
    const sx = -((CHARS * 6 - 1) * DOT) / 2;
    for (let c = 0; c < CHARS; c++)
      for (let r = 0; r < 7; r++)
        for (let k = 0; k < 5; k++) {
          const x = sx + (c * 6 + k) * DOT;
          const y = 3.4 - r * DOT;
          segs.push({ a: V(x - DOT * 0.32, y, -D + 0.08), b: V(x + DOT * 0.32, y, -D + 0.08), t: (c * 5 + k) / (CHARS * 5), kind: 3 });
        }
    this.nameStart = nameStart;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    const mesh = new THREE.InstancedMesh(geo, this.mat, segs.length);
    const attr = new Float32Array(segs.length * 4);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = V(0, 1, 0);
    segs.forEach((sg, i) => {
      const len = sg.a.distanceTo(sg.b);
      q.setFromUnitVectors(up, sg.b.clone().sub(sg.a).normalize());
      const r = sg.kind === 3 ? 0.035 : 0.022;
      m4.compose(sg.a.clone().add(sg.b).multiplyScalar(0.5), q, V(r, len, r));
      mesh.setMatrixAt(i, m4);
      attr.set([sg.t % 1, sg.kind, 0, Math.random()], i * 4);
    });
    this.tubeAttr = new THREE.InstancedBufferAttribute(attr, 4);
    geo.setAttribute('aTube', this.tubeAttr);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.wash(V(0, H - 0.5, -D * 0.5), 0, 1.6, 14);
    this.wash(V(-W + 1, 1, -6), 1, 1.2, 8);
    this.wash(V(W - 1, 1, -10), 2, 1.2, 8);
    this.people(0.8, 2001, { phones: 0.2, clothes: ['#101114', '#2b2d33', '#f2f2f2', '#ff2e88', '#16171a', '#3dd6ff'] });
    this.spell();
  }

  /** light the sign's dots for the DJ name (centred, up to ten characters) */
  private spell(): void {
    const name = (nameService.text || 'DECKHOUSE').toUpperCase().slice(0, CHARS);
    this.shownName = nameService.text;
    const pad = Math.floor((CHARS - name.length) / 2);
    const a = this.tubeAttr.array as Float32Array;
    for (let c = 0; c < CHARS; c++) {
      const ch = name[c - pad] ?? ' ';
      const dots = letterDots(ch);
      for (let r = 0; r < 7; r++)
        for (let k = 0; k < 5; k++) {
          const i = this.nameStart + c * 35 + r * 5 + k;
          a[i * 4 + 2] = dots[r * 5 + k] ? 1 : 0;
        }
    }
    this.tubeAttr.needsUpdate = true;
  }

  protected onAction(id: string): void {
    const i = ['chase', 'flicker', 'pulse', 'name'].indexOf(id);
    if (i >= 0) this.setLook({ ...this.look, mode: i });
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    if (nameService.text !== this.shownName) this.spell();
    const u = this.mat.uniforms;
    u.uTime.value = this.time;
    u.uBeat.value = s.beat;
    const momentName = this.momentK('name');
    u.uPattern.value = momentName > 0.2 ? 3 : this.momentK('storm') > 0.1 ? 0 : this.look.mode;
    u.uStorm.value = this.momentK('storm');
    u.uBreath.value = this.momentK('breathe');
    u.uName.value = Math.max(momentName, this.look.mode === 3 ? 1 : 0);
    u.uKick.value = s.kick;
    u.uRainbow.value = this.on('rainbow') ? 1 : 0;
    u.uBlack.value += ((this.on('black') ? 1 : 0) - u.uBlack.value) * Math.min(1, dt * 10);
    u.uSafe.value = s.reduceFlash ? 1 : 0;
    u.uHue.value = this.look.hue;
    (u.uDrive.value as THREE.Vector3).set(this.drive.floor, this.drive.walls, this.drive.ceil);
    const m = (0.4 + 0.6 * s.master) * this.look.level;
    (u.uC0.value as THREE.Color).copy(this.cols[0]).multiplyScalar(m);
    (u.uC1.value as THREE.Color).copy(this.cols[1]).multiplyScalar(m);
    (u.uC2.value as THREE.Color).copy(this.cols[2]).multiplyScalar(m);
    this.lookUp = momentName * 0.5;
  }
}

export const neonMaze: VenueDef = {
  id: 'neonmaze',
  name: 'Neon Maze',
  short: 'Neon Maze',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A maze of neon tubes that chase, flicker and pulse to the beat, and a neon wall that spells your name.',
  palette: ['#ff2e88', '#3dd6ff', '#b6ff3b'],
  ui: '#ff2e88',
  capacity: '160',
  build: () => new NeonMaze(),
  thumb(g, w, h) {
    g.fillStyle = '#05030a';
    g.fillRect(0, 0, w, h);
    g.lineWidth = 3;
    g.lineCap = 'round';
    const cols = ['#ff2e88', '#3dd6ff', '#b6ff3b'];
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = cols[i % 3];
      g.shadowColor = cols[i % 3];
      g.shadowBlur = 8;
      g.beginPath();
      const x = 8 + i * (w - 16) / 8;
      g.moveTo(x, h * 0.2 + (i % 2) * 10);
      g.lineTo(x, h * 0.8 - (i % 3) * 8);
      g.stroke();
    }
    g.shadowBlur = 0;
  },
};
