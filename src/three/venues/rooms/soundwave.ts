/*
 * The Sound Wave Room: the walls are thousands of pins and the ceiling a
 * field of hanging rods, all moving with the music like a 3D graphic
 * equaliser. The side walls push in by the spectrum (low notes by the booth,
 * high at the back) and bulge with the bass; hi-hats drop ripples across
 * the ceiling; it all moves on the GPU from one small audio texture.
 *
 *   modes    equaliser, ocean (rolling waves), city (stepped blocks on the
 *            beat), pulse (everything punches on the kick)
 *   pads     push (the walls slam in), freeze, wave (a wave down the room),
 *            invert (pins pull back on the beat)
 *   moments  slam (big), wave (big), breathe (deep)
 *   stems    the walls follow the melody, the ceiling the vocals and the
 *            hi-hats, the floor's glow the drums
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { AudioTexture, CrazyRoom, HUE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 7;
const H = 5.5;
const D = 14;
const PITCH = 0.26;
const RIPPLES = 8;

const VERT = /* glsl */ `
  ${HUE_GLSL}
  attribute vec4 aPin;
  uniform sampler2D uAudio;
  uniform float uTime, uBeat, uMode, uBass, uKick, uPush, uWave, uFreeze, uInvert, uWalls, uCeil, uHue;
  uniform vec4 uRip[${RIPPLES}];
  varying float vExt;
  varying vec3 vCol;
  varying vec3 vNw;
  varying float vTip;
  float spec(float x) { return texture2D(uAudio, vec2(x, 0.25)).r; }
  float h11(float n) { return fract(sin(n * 91.3) * 43758.5); }
  void main() {
    // aPin: u (along the wall / ceiling x), v (up the wall / ceiling z), side (0 left, 1 right, 2 ceiling), seed
    float side = aPin.z;
    float ext;
    if (side < 1.5) {
      float x = aPin.x;
      float s = uMode < 0.5 ? spec(0.02 + x * 0.6) * 1.4 : 0.0;
      if (uMode > 0.5 && uMode < 1.5) s = 0.5 + 0.5 * sin(x * 18.0 - uTime * 2.4 + aPin.y * 3.0) * (0.4 + uBass);
      if (uMode > 1.5 && uMode < 2.5) s = h11(floor(x * 14.0) + floor(aPin.y * 6.0) * 7.0 + floor(uBeat)) * (0.3 + uWalls);
      if (uMode > 2.5) s = uKick * (0.6 + 0.4 * h11(aPin.w * 10.0));
      // the higher up the wall, the less the spectrum reaches
      s *= smoothstep(1.05, 0.0, abs(aPin.y - spec(0.02 + x * 0.6) * 0.6));
      ext = (0.05 + s * (0.3 + uWalls * 1.2) + uBass * 0.35 + uPush * 0.9);
      ext += uWave * exp(-pow((x - fract(uTime * 0.5)) * 8.0, 2.0)) * 0.9;
      if (uInvert > 0.5) ext = 0.9 - ext * 0.8;
    } else {
      // the ceiling: rods hang lower where hi-hat ripples pass and with the vocals
      vec2 p = aPin.xy;
      float r = 0.0;
      for (int i = 0; i < ${RIPPLES}; i++) {
        vec4 rp = uRip[i];
        float age = uTime - rp.z;
        if (age < 0.0 || age > 2.0) continue;
        float d = length(p - rp.xy);
        r += exp(-pow((d - age * 6.0) * 2.0, 2.0)) * (1.0 - age / 2.0) * rp.w;
      }
      ext = 0.1 + r * 0.8 + uCeil * 0.7 * (0.5 + 0.5 * sin(p.x * 0.8 + p.y * 0.6 + uTime));
      ext += uWave * exp(-pow((p.y / ${D.toFixed(1)} + fract(uTime * 0.5)) * 8.0, 2.0)) * 0.9;
    }
    ext = mix(ext, 0.3, uFreeze);
    vExt = ext;
    // pins grow out of their wall: local y is the growth axis
    vec3 pos = position;
    vTip = step(0.0, pos.y);
    pos.y = (pos.y + 0.5) * max(0.03, ext);
    vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.0);
    vNw = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vCol = hsv(fract(aPin.x * 0.6 + aPin.y * 0.15 + uHue + side * 0.33), 0.75, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform float uLevel;
  varying float vExt;
  varying vec3 vCol;
  varying vec3 vNw;
  varying float vTip;
  void main() {
    // a dark metal body lit from above, and a glowing tip that brightens the further the pin is out
    float lit = 0.25 + 0.6 * max(0.0, dot(normalize(vNw), normalize(vec3(0.2, 1.0, 0.3))));
    vec3 col = vec3(0.07, 0.07, 0.09) * lit;
    col += vCol * vTip * (0.06 + min(vExt, 1.2) * 0.55) * uLevel;
    gl_FragColor = vec4(col, 1.0);
  }
`;

class SoundWave extends CrazyRoom {
  readonly modes = ['Equaliser', 'Ocean', 'City', 'Pulse'];
  readonly actions: RoomAction[] = [
    { id: 'push', label: 'Push', kind: 'hit' },
    { id: 'freeze', label: 'Freeze', kind: 'toggle' },
    { id: 'wave', label: 'Wave', kind: 'hit' },
    { id: 'invert', label: 'Invert', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'slam', label: 'The walls slam in and out', energy: 'big' },
    { id: 'wave', label: 'A wave runs through the room', energy: 'big' },
    { id: 'breathe', label: 'The room breathes', energy: 'deep' },
  ];
  private mat: THREE.ShaderMaterial;
  private audio = new AudioTexture();
  private rip: THREE.Vector4[] = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
  private ripN = 0;
  private floorMat: THREE.MeshStandardMaterial;

  constructor() {
    super({ roomId: 'soundwave', roomName: 'Sound Wave Room', w: W, h: H, d: D, back: 3, fog: 0x030306, fogDensity: 0.015, hemi: 0.25, booth: { strip: '#3dd6ff' } });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uAudio: { value: this.audio.texture },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uMode: { value: 0 },
        uBass: { value: 0 },
        uKick: { value: 0 },
        uPush: { value: 0 },
        uWave: { value: 0 },
        uFreeze: { value: 0 },
        uInvert: { value: 0 },
        uWalls: { value: 0 },
        uCeil: { value: 0 },
        uHue: { value: 0 },
        uLevel: { value: 1 },
        uRip: { value: this.rip },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    const pin = new THREE.BoxGeometry(PITCH * 0.86, 1, PITCH * 0.86);
    const mats: THREE.Matrix4[] = [];
    const pins: number[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    // the side walls: pins pointing into the room
    for (const [side, x, dir] of [
      [0, -W, 1],
      [1, W, -1],
    ] as [number, number, number][]) {
      q.setFromUnitVectors(V(0, 1, 0), V(dir, 0, 0));
      for (let z = 2.8; z > -D; z -= PITCH)
        for (let y = PITCH / 2; y < H; y += PITCH) {
          mats.push(m4.clone().compose(V(x, y, z), q, V(1, 1, 1)));
          pins.push((2.8 - z) / (D + 2.8), y / H, side, Math.random());
        }
    }
    // the ceiling: rods hanging down
    q.setFromUnitVectors(V(0, 1, 0), V(0, -1, 0));
    const cp = PITCH * 1.4;
    for (let x = -W + cp / 2; x < W; x += cp)
      for (let z = 2.8; z > -D; z -= cp) {
        mats.push(m4.clone().compose(V(x, H, z), q, V(1.2, 1, 1.2)));
        pins.push(x, z, 2, Math.random());
      }
    const mesh = new THREE.InstancedMesh(pin, this.mat, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    pin.setAttribute('aPin', new THREE.InstancedBufferAttribute(new Float32Array(pins), 4));
    mesh.frustumCulled = false;
    this.group.add(mesh);
    // a dark floor whose glow lines follow the drums, and the end walls
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.35, metalness: 0.4, emissive: 0x000000 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D + 3).rotateX(-Math.PI / 2), this.floorMat);
    floor.position.set(0, 0, (3 - D) / 2);
    const ends = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), ends);
    back.position.set(0, H / 2, -D);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), ends);
    front.position.set(0, H / 2, 3);
    front.rotation.y = Math.PI;
    this.group.add(floor, back, front);
    this.wash(V(0, H - 1, -D * 0.5), 0, 1.2, 14);
    this.wash(V(0, 1.5, -3), 1, 0.9, 8);
    this.people(0.9, 1701, { area: [-W + 1.6, W - 1.6, -1.6, -D + 1.4], phones: 0.18, clothes: ['#101114', '#2b2d33', '#f2f2f2', '#3dd6ff', '#16171a', '#1d1f24'] });
  }

  protected tick(s: ShowState, f: Features, dt: number): void {
    const u = this.mat.uniforms;
    this.audio.update(f);
    u.uTime.value = this.time;
    u.uBeat.value = s.beat;
    u.uMode.value = this.look.mode;
    u.uBass.value = (this.parts?.bass ?? s.bass) * 0.8 * this.look.level + this.momentK('breathe') * (0.5 + 0.5 * Math.sin(this.time * 1.5)) * 0.6;
    u.uKick.value = s.kick;
    const push = Math.max(this.since('push') < 0.6 ? 1 - this.since('push') / 0.6 : 0, this.moment?.id === 'slam' ? Math.max(0, Math.sin(this.moment.t * Math.PI * (s.bpm / 60))) * this.momentK() : 0);
    u.uPush.value = push;
    u.uWave.value = Math.max(this.since('wave') < 2 ? 1 : 0, this.momentK('wave'));
    u.uFreeze.value += ((this.on('freeze') ? 1 : 0) - u.uFreeze.value) * Math.min(1, dt * 4);
    u.uInvert.value = this.on('invert') ? 1 : 0;
    u.uWalls.value = this.drive.walls;
    u.uCeil.value = this.drive.ceil;
    u.uHue.value = this.look.hue + this.time * 0.01;
    u.uLevel.value = (0.4 + 0.6 * s.master) * this.look.level;
    // hi-hats drop ripples on the ceiling
    const hat = this.parts ? this.parts.hatHit : false;
    if ((hat || (this.parts?.snareHit ?? s.snare > 0.9)) && s.playing) this.rip[this.ripN++ % RIPPLES].set((Math.random() - 0.5) * W * 1.6, -Math.random() * D, this.time, 0.6 + Math.random() * 0.6);
    this.floorMat.emissive.copy(this.cols[0]).multiplyScalar(this.drive.floor * 0.25 * s.master);
    this.lookUp = Math.min(1, this.drive.ceil * 0.8 + push * 0.4);
  }

  dispose(): void {
    this.audio.dispose();
    super.dispose();
  }
}

export const soundWave: VenueDef = {
  id: 'soundwave',
  name: 'Sound Wave Room',
  short: 'Sound Wave',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Walls of thousands of pins and a ceiling of rods that move with the music like a 3D equaliser.',
  palette: ['#3dd6ff', '#ff2e88', '#ffb547'],
  ui: '#3dd6ff',
  capacity: '200',
  build: () => new SoundWave(),
  thumb(g, w, h) {
    g.fillStyle = '#04040a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const v = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.17));
      g.fillStyle = `hsl(${190 + i * 4},80%,55%)`;
      g.fillRect(i * (w / 40), h - v * h * 0.8, w / 40 - 1, v * h * 0.8);
    }
  },
};
