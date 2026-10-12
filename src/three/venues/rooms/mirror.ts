/*
 * The Infinity Mirror Room: walls, floor and ceiling are mirror panels, so
 * the crowd, the beams and you repeat into the distance. The mirrors look
 * the room up in a MirrorProbe that holds last frame's mirrors too, so each
 * reflection carries the next one and the corridor goes on forever, a little
 * darker each time. Lasers (kept 3 m above the crowd) bounce round it.
 *
 *   modes    clear mirror, tinted glass, lit panel seams, smoked glass
 *   pads     spin (the reflections turn), tilt (every panel tips), fold
 *            (hold: the reflections fold into a kaleidoscope), seams flash,
 *            dark glass
 *   moments  fold (big), ripple (big: a tilt wave runs round the room),
 *            spin (deep)
 *   stems    the floor's seams glow with the drums, the walls' with the
 *            melody, the ceiling's with the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import { Lasers, MovingHeads } from '../fixtures';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, MirrorProbe, PROBE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 7;
const H = 5;
const D = 14;
const BACK = 3;

export const MIRROR_FRAG = /* glsl */ `
  ${PROBE_GLSL}
  ${HUE_GLSL}
  uniform float uTilt, uFold, uSpin, uRefl, uSmoke, uSeam, uTime, uDark, uFlash;
  uniform vec3 uTint, uSeamCol, uDrive;
  varying vec3 vW;
  varying vec3 vN;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  vec3 rotAxis(vec3 v, vec3 a, float ang) {
    float c = cos(ang), s = sin(ang);
    return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c);
  }
  void main() {
    vec3 N = normalize(vN);
    // the panel this point is on: 1.2 m squares in the surface's own axes
    vec3 ax = abs(N);
    vec2 uv = ax.y > 0.5 ? vW.xz : ax.x > 0.5 ? vW.zy : vW.xy;
    vec2 cell = floor(uv / 1.2);
    vec2 f = fract(uv / 1.2);
    float id = h21(cell + N.xy * 7.0 + N.z * 13.0);
    // each panel tips a little its own way (a wave when tilting)
    float tilt = uTilt * (0.6 + 0.8 * id) * sin(uTime * 2.0 + cell.x * 0.9 + cell.y * 1.3 + id * 6.0);
    vec3 Np = rotAxis(N, normalize(cross(N, vec3(0.31, 0.77, 0.55))), tilt * 0.35);
    vec3 Vd = normalize(vW - cameraPosition);
    vec3 R = reflect(Vd, Np);
    // spin: the reflections turn round the room's upright axis
    R = rotAxis(R, vec3(0.0, 1.0, 0.0), uSpin);
    // fold: the reflections fold into a six-way kaleidoscope round the view
    if (uFold > 0.001) {
      float az = atan(R.z, R.x);
      float sec = 6.2831853 / 6.0;
      float k = abs(mod(az, sec) - sec * 0.5);
      float az2 = mix(az, k, uFold);
      float r = length(R.xz);
      R = normalize(vec3(cos(az2) * r, R.y * (1.0 - 0.3 * uFold), sin(az2) * r));
    }
    vec3 col = probe(vW + N * 0.02, R) * uRefl * uTint * (1.0 - uDark * 0.9);
    // smoked glass: darker near the panel's middle
    col *= 1.0 - uSmoke * 0.5 * (1.0 - smoothstep(0.0, 0.5, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 2.0));
    // the seams between panels: a dark line, lit by the stem that drives this surface
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float seam = 1.0 - smoothstep(0.004, 0.012, e);
    float drive = ax.y > 0.5 ? (N.y > 0.0 ? uDrive.x : uDrive.z) : uDrive.y;
    col = mix(col, vec3(0.0), seam * 0.8);
    col += uSeamCol * seam * (uSeam * (0.3 + 1.6 * drive) + uFlash * 3.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const MIRROR_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

class MirrorRoom extends CrazyRoom {
  readonly modes = ['Clear mirror', 'Tinted glass', 'Lit seams', 'Smoked glass'];
  readonly actions: RoomAction[] = [
    { id: 'spin', label: 'Spin', kind: 'toggle' },
    { id: 'tilt', label: 'Tilt', kind: 'hit' },
    { id: 'fold', label: 'Fold', kind: 'hold' },
    { id: 'flash', label: 'Seams flash', kind: 'hit' },
    { id: 'dark', label: 'Dark glass', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'fold', label: 'The mirrors fold into a kaleidoscope', energy: 'big' },
    { id: 'ripple', label: 'A ripple runs round the mirrors', energy: 'big' },
    { id: 'spin', label: 'The room starts to turn', energy: 'deep' },
  ];
  private probe: MirrorProbe;
  private mat: THREE.ShaderMaterial;
  private spin = 0;
  private fold = 0;
  private tilt = 0;

  constructor() {
    super({ roomId: 'mirror', roomName: 'Infinity Mirror Room', w: W, h: H, d: D, back: BACK, fog: 0x040408, fogDensity: 0.012, hemi: 0.35, booth: { strip: '#e8f2ff' } });
    this.keyLight = { color: 0xeaf0ff, intensity: 9 };
    // the endless corridor: low by a mirror wall, looking along it
    this.views.wide = { pos: V(-W + 0.6, 1.3, -D + 1), target: V(-W + 0.9, 1.5, 0) };
    this.views.wideLabel = 'Endless corridor';
    this.grade = { tint: 0xf0f4ff, contrast: 1.08, saturation: 1.05, lift: 0.002 };
    const box = new THREE.Box3(V(-W, 0, -D), V(W, H, BACK));
    this.probe = new MirrorProbe(192, V(0, 2.2, -D * 0.4), box);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...this.probe.uniforms,
        uTilt: { value: 0 },
        uFold: { value: 0 },
        uSpin: { value: 0 },
        uRefl: { value: 0.86 },
        uSmoke: { value: 0 },
        uSeam: { value: 0.4 },
        uTime: { value: 0 },
        uDark: { value: 0 },
        uFlash: { value: 0 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uSeamCol: { value: new THREE.Color(1, 1, 1) },
        uDrive: { value: new THREE.Vector3() },
      },
      vertexShader: MIRROR_VERT,
      fragmentShader: MIRROR_FRAG,
      side: THREE.BackSide,
    });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + BACK), this.mat);
    shell.position.set(0, H / 2, (BACK - D) / 2);
    this.group.add(shell);

    // beams from the ceiling corners and lasers over the crowd: in here they go on forever
    this.add(
      new MovingHeads(
        [-W + 1, -2, 2, W - 1].flatMap((x) => [-3, -9].map((z) => ({ pos: V(x, H - 0.25, z) }))),
        { length: 9, radius: 0.5, gain: 1.1, floorY: 0, haze: [0.3, H] },
      ),
    );
    this.add(
      new Lasers(
        [
          { pos: V(-W + 0.4, H - 0.6, -D + 1), dir: V(0.6, -0.05, 1), side: -1, beams: 10, length: 30 },
          { pos: V(W - 0.4, H - 0.6, -D + 1), dir: V(-0.6, -0.05, 1), side: 1, beams: 10, length: 30, alt: true },
        ],
        { room: { floorY: 0, x0: -W, x1: W, z0: -D, z1: BACK, ceilY: H }, audience: { floorY: 0, x0: -W, x1: W, z0: -D, z1: -1 }, haze: [0.5, H] },
      ),
    );
    this.wash(V(0, H - 0.4, -D * 0.5), 0, 2.2, 14);
    this.wash(V(-W + 1, 1, -4), 1, 1.4, 10);
    this.wash(V(W - 1, 1, -10), 2, 1.4, 10);
    this.people(0.85, 1201, { phones: 0.18, drinks: 0.2, clothes: ['#f2f2f2', '#101114', '#c7c9ce', '#2b2d33', '#d8d0c0', '#16171a'] });
  }

  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    this.probe.update(renderer, this.sceneRoot(), dt);
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const u = this.mat.uniforms;
    const mode = this.look.mode;
    u.uTime.value = this.time;
    // spin: a toggle, a moment, or both
    const spinRate = (this.on('spin') ? 0.25 : 0) + this.momentK('spin') * 0.5;
    this.spin += spinRate * dt * (s.playing ? 1 : 0.3);
    u.uSpin.value = this.spin;
    const foldWant = Math.max(this.on('fold') ? 1 : 0, this.momentK('fold'));
    this.fold += (foldWant - this.fold) * Math.min(1, dt * 3);
    u.uFold.value = this.fold;
    const tiltWant = Math.max(this.since('tilt') < 2 ? 1 - this.since('tilt') / 2 : 0, this.momentK('ripple'));
    this.tilt += (tiltWant - this.tilt) * Math.min(1, dt * 4);
    u.uTilt.value = this.tilt;
    u.uRefl.value = mode === 3 ? 0.72 : 0.88;
    u.uSmoke.value = mode === 3 ? 1 : 0;
    u.uSeam.value = mode === 2 ? 1 : 0.35;
    u.uDark.value += ((this.on('dark') ? 1 : 0) - u.uDark.value) * Math.min(1, dt * 3);
    u.uFlash.value = this.since('flash') < 0.4 ? 1 - this.since('flash') / 0.4 : 0;
    const tint = u.uTint.value as THREE.Color;
    if (mode === 1) tint.copy(this.cols[0]).lerp(new THREE.Color(1, 1, 1), 0.55);
    else tint.setRGB(1, 1, 1);
    (u.uSeamCol.value as THREE.Color).copy(this.cols[1]).multiplyScalar(s.master * 1.6);
    (u.uDrive.value as THREE.Vector3).set(this.drive.floor, this.drive.walls, this.drive.ceil);
    this.lookUp = Math.max(this.fold, Math.min(1, spinRate * 2)) * 0.7;
  }

  dispose(): void {
    this.probe.dispose();
    super.dispose();
  }
}

export const mirrorRoom: VenueDef = {
  id: 'mirror',
  name: 'Infinity Mirror Room',
  short: 'Mirrors',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Mirrors on every surface: the crowd, the beams and you, forever in every direction.',
  palette: ['#e8f2ff', '#7a3cff', '#3dd6ff'],
  ui: '#9fc6ff',
  capacity: '220',
  build: () => new MirrorRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, w, h);
    // rooms inside rooms
    for (let i = 0; i < 7; i++) {
      const k = 1 - i * 0.13;
      g.strokeStyle = `rgba(${170 + i * 10},${200 - i * 6},255,${0.85 - i * 0.1})`;
      g.lineWidth = 2;
      g.strokeRect(w / 2 - (w / 2) * k, h / 2 - (h / 2) * k, w * k, h * k);
    }
    g.fillStyle = '#0a0b10';
    for (let i = 0; i < 9; i++) g.beginPath(), g.arc(w * (0.15 + i * 0.09), h * 0.8, 6, 0, Math.PI * 2), g.fill();
  },
};
