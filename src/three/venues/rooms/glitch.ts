/*
 * The Glitch Room: a clean room that breaks when you break the music. When
 * you scratch, run an echo or a stutter loop, the walls tear into pixels and
 * blocks push out, the colours split and invert, and the floor drops away
 * into a wireframe landscape. Stop, and it rebuilds itself line by line.
 *
 * How broken it is comes from the decks (roomShow.glitch, worked out by the
 * app each frame: a scratch, the echo's depth, how short a loop is), the
 * pads and the moments. With Reduce flashing the colours fade between
 * normal and inverted instead of snapping, and nothing jitters fast.
 *
 *   modes    gallery (white), vapor (pink and teal), terminal (green on
 *            black), corrupt (always a little broken)
 *   pads     break (hold), invert, wireframe floor, pixel burst
 *   moments  crash (big), pixelate (big), scan (deep: a scanline rebuilds it)
 *   stems    the floor's grid follows the drums, the walls' light lines the
 *            melody, the ceiling the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, V, roomShow, type RoomAction, type RoomMoment } from './kit';

const W = 7;
const H = 5;
const D = 13;
const BACK = 3;

const COMMON = /* glsl */ `
  ${HUE_GLSL}
  uniform float uG, uTime, uInvert, uMode, uWire, uScan, uSafe, uBeat;
  uniform vec3 uDrive, uC0, uC1;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float tick(float rate) { return floor(uTime * mix(rate, 2.0, uSafe)); }
  vec3 base(float mode, vec2 m, float drive) {
    vec2 g = abs(fract(m / 1.0) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.025, 0.5 - max(g.x, g.y));
    vec3 c;
    if (mode < 0.5) c = mix(vec3(0.82), vec3(0.62), line) + uC0 * line * drive * 0.8;
    else if (mode < 1.5) c = mix(vec3(0.95, 0.45, 0.75), vec3(0.2, 0.8, 0.8), clamp(m.y / 5.0, 0.0, 1.0)) * (0.5 + 0.5 * line) + uC1 * line * drive;
    else if (mode < 2.5) c = vec3(0.0, 0.05, 0.0) + vec3(0.1, 1.0, 0.3) * line * (0.4 + drive * 1.4);
    else c = mix(vec3(0.4), vec3(0.15), line) + uC0 * line * drive;
    return c;
  }
`;

const WALL_VERT = /* glsl */ `
  uniform float uG, uTime, uSafe;
  varying vec3 vW; varying vec3 vN; varying float vPush;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    // blocks push out of the wall: each 0.5 m block by its own amount, changing a few times a second
    vec3 ax = abs(n);
    vec2 m = ax.y > 0.5 ? wp.xz : ax.x > 0.5 ? wp.zy : wp.xy;
    vec2 blk = floor(m / 0.5);
    float t = floor(uTime * mix(6.0, 1.5, uSafe));
    float r = h21(blk + t * 0.37);
    float push = step(1.0 - uG * 0.6, r) * r * uG * 1.2;
    wp.xyz += n * push;
    vPush = push;
    vW = wp.xyz;
    vN = n;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WALL_FRAG = /* glsl */ `
  ${COMMON}
  varying vec3 vW; varying vec3 vN; varying float vPush;
  void main() {
    vec3 N = normalize(vN);
    vec3 ax = abs(N);
    vec2 m = ax.y > 0.5 ? vW.xz : ax.x > 0.5 ? vW.zy : vW.xy;
    float drive = N.y < -0.5 ? uDrive.z : uDrive.y;
    // pixelate: coarser as it breaks
    float px = mix(0.001, 0.35, uG * uG);
    vec2 mq = px > 0.01 ? floor(m / px) * px : m;
    vec3 c = base(uMode, mq, drive);
    // colour split: the channels slide apart
    float split = uG * 0.25;
    c.r = base(uMode, mq + vec2(split, 0.0), drive).r;
    c.b = base(uMode, mq - vec2(split, 0.0), drive).b;
    // blocks that have gone: a void with scrolling data
    vec2 blk = floor(m / 0.5);
    float gone = step(1.0 - uG * 0.35, h21(blk + tick(4.0) * 0.71));
    vec3 voidc = vec3(0.02) + uC1 * step(0.6, h21(floor(vec2(m.x * 10.0, m.y * 10.0 - uTime * 6.0)))) * 0.6;
    c = mix(c, voidc, gone);
    // the pushed blocks glow at their faces
    c += uC0 * vPush * 0.8;
    // scanline rebuilding: above it, clean; below it, broken
    if (uScan > 0.001) {
      float line = 1.0 - smoothstep(0.0, 0.06, abs(vW.y / 5.0 - (1.0 - uScan)));
      c += vec3(1.0) * line * 2.0;
    }
    c = mix(c, vec3(1.0) - clamp(c, 0.0, 1.0), uInvert);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const FLOOR_VERT = /* glsl */ `
  uniform float uWire, uTime, uG;
  uniform vec3 uDrive;
  varying vec3 vW; varying float vH;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // the floor drops into a wireframe landscape: hills rolling towards the booth
    float hgt = (sin(wp.x * 0.9 + uTime * 0.6) * cos(wp.z * 0.7 + uTime * 0.9) * 0.5 + 0.5) * uWire;
    float keep = smoothstep(-1.5, -3.0, wp.z);
    wp.y -= uWire * 1.6 * keep;
    wp.y += hgt * (0.6 + uDrive.x * 1.2) * keep;
    vH = hgt;
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FLOOR_FRAG = /* glsl */ `
  ${COMMON}
  varying vec3 vW; varying float vH;
  void main() {
    vec3 solid = base(uMode, vW.xz, uDrive.x);
    vec2 g = abs(fract(vW.xz / 0.6) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.03, 0.5 - max(g.x, g.y));
    vec3 wire = mix(uC0, uC1, vH) * line * (1.0 + uDrive.x * 2.0) * (0.8 + 0.6 * exp(-4.0 * fract(uBeat)));
    vec3 c = mix(solid, wire, uWire);
    c = mix(c, vec3(1.0) - clamp(c, 0.0, 1.0), uInvert * (1.0 - uWire));
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** a w × h plane split into 0.25 m quads (so blocks can push out of it) */
function grid(w: number, h: number): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(w, h, Math.ceil(w / 0.25), Math.ceil(h / 0.25));
}

class GlitchRoom extends CrazyRoom {
  readonly modes = ['Gallery', 'Vapor', 'Terminal', 'Corrupt'];
  readonly actions: RoomAction[] = [
    { id: 'break', label: 'Break', kind: 'hold' },
    { id: 'invert', label: 'Invert', kind: 'toggle' },
    { id: 'wire', label: 'Wireframe floor', kind: 'toggle' },
    { id: 'pixel', label: 'Pixel burst', kind: 'hit' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'crash', label: 'The room crashes', energy: 'big' },
    { id: 'pixelate', label: 'The room pixelates', energy: 'big' },
    { id: 'scan', label: 'A scanline rebuilds the room', energy: 'deep' },
  ];
  private uniforms: Record<string, THREE.IUniform>;
  private g = 0;
  private inv = 0;
  private wire = 0;

  constructor() {
    super({ roomId: 'glitch', roomName: 'Glitch Room', w: W, h: H, d: D, back: BACK, fog: 0x0a0a0c, fogDensity: 0.01, hemi: 0.5, booth: { strip: '#ffffff' } });
    this.uniforms = {
      uG: { value: 0 },
      uTime: { value: 0 },
      uInvert: { value: 0 },
      uMode: { value: 0 },
      uWire: { value: 0 },
      uScan: { value: 0 },
      uSafe: { value: 0 },
      uBeat: { value: 0 },
      uDrive: { value: new THREE.Vector3() },
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
    };
    const wallMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, side: THREE.DoubleSide });
    const floorMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, side: THREE.DoubleSide });
    const len = D + BACK;
    const cz = (BACK - D) / 2;
    const place = (g: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, rx: number, ry: number) => {
      const m = new THREE.Mesh(g, mat);
      m.position.copy(pos);
      m.rotation.set(rx, ry, 0);
      m.frustumCulled = false;
      this.group.add(m);
    };
    // the walls and ceiling face into the room
    place(grid(len, H), wallMat, V(-W, H / 2, cz), 0, Math.PI / 2);
    place(grid(len, H), wallMat, V(W, H / 2, cz), 0, -Math.PI / 2);
    place(grid(W * 2, H), wallMat, V(0, H / 2, -D), 0, 0);
    place(grid(W * 2, H), wallMat, V(0, H / 2, BACK), 0, Math.PI);
    place(grid(W * 2, len), wallMat, V(0, H, cz), Math.PI / 2, 0);
    place(new THREE.PlaneGeometry(W * 2, len, 64, 80), floorMat, V(0, 0, cz), -Math.PI / 2, 0);
    this.wash(V(0, H - 0.4, -D * 0.5), 0, 1.6, 14);
    this.wash(V(0, 2, -3), 1, 1.2, 8);
    this.people(0.85, 2301, { phones: 0.25, clothes: ['#101114', '#f2f2f2', '#2b2d33', '#ff2e88', '#3dd6ff', '#16171a'] });
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const u = this.uniforms;
    const mode = this.look.mode;
    // how broken: the decks, the pads, the moments (and always a little when corrupt)
    const pixel = this.since('pixel') < 0.6 ? 1 - this.since('pixel') / 0.6 : 0;
    const want = Math.min(1, Math.max(roomShow.glitch * this.look.level, this.on('break') ? 1 : 0, this.momentK('crash'), this.momentK('pixelate') * 0.7, pixel, mode === 3 ? 0.18 : 0));
    this.g += (want - this.g) * Math.min(1, dt * (want > this.g ? 10 : 2.5));
    u.uG.value = this.g;
    u.uTime.value = this.time;
    u.uBeat.value = s.beat;
    u.uMode.value = mode;
    u.uSafe.value = s.reduceFlash ? 1 : 0;
    // inverted: the pad, or the crash's two bars
    const invWant = this.on('invert') || (this.moment?.id === 'crash' && this.moment.t < (120 / Math.max(60, s.bpm)) * 4 * 2) ? 1 : 0;
    this.inv += (invWant - this.inv) * Math.min(1, dt * (s.reduceFlash ? 2 : 14));
    u.uInvert.value = this.inv;
    const wireWant = this.on('wire') || this.momentK('crash') > 0.2 || this.g > 0.7 ? 1 : 0;
    this.wire += (wireWant - this.wire) * Math.min(1, dt * 2);
    u.uWire.value = this.wire;
    u.uScan.value = this.moment?.id === 'scan' ? Math.min(1, this.moment.t / this.moment.len) : 0;
    (u.uDrive.value as THREE.Vector3).set(this.drive.floor, this.drive.walls, this.drive.ceil);
    (u.uC0.value as THREE.Color).copy(this.cols[0]).multiplyScalar(0.5 + 0.8 * s.master);
    (u.uC1.value as THREE.Color).copy(this.cols[1]).multiplyScalar(0.5 + 0.8 * s.master);
    this.lookUp = this.g * 0.7;
  }
}

export const glitchRoom: VenueDef = {
  id: 'glitch',
  name: 'Glitch Room',
  short: 'Glitch',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A clean room that breaks when you scratch, echo or stutter: the walls tear into pixels and the floor drops into wireframe.',
  palette: ['#ff2e88', '#3dd6ff', '#ffffff'],
  ui: '#ff4fa3',
  capacity: '170',
  build: () => new GlitchRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#c8c8cc';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      const x = (i * 47) % w;
      const y = (i * 29) % h;
      g.fillStyle = i % 3 === 0 ? '#ff2e88' : i % 3 === 1 ? '#3dd6ff' : '#101114';
      g.fillRect(x, y, 6 + (i % 4) * 5, 4 + (i % 3) * 3);
    }
    g.strokeStyle = '#3dd6ff';
    for (let x = 0; x < w; x += 8) {
      g.beginPath();
      g.moveTo(x, h * 0.7);
      g.lineTo(w / 2 + (x - w / 2) * 2, h);
      g.stroke();
    }
  },
};
