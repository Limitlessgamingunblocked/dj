/*
 * The Upside-Down Room: a tall room with a crowd on the floor and a second
 * crowd dancing on the ceiling. Halfway through the set gravity flips: the
 * club camera rolls over, the ceiling crowd becomes the floor and you're
 * playing upside down above them. Drops can roll it over too.
 *
 * The roll only turns the club camera (never the board views you play
 * from), and it's undone first each frame so it can't build up.
 *
 *   modes    classic, neon, checkerboard, void
 *   pads     flip, spin the light ring, float (hold), tilt (hold)
 *   moments  flip (big), barrel roll (big), float (deep)
 *   stems    the floor tiles follow the drums, the light ring the melody,
 *            the ceiling tiles the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import { booth } from '../fixtures';
import { setClock } from '../moments';
import type { ShowState } from '../show';
import { CrazyRoom, HUE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 7;
const H = 8;
const D = 14;

const TILE_FRAG = /* glsl */ `
  ${HUE_GLSL}
  uniform float uMode, uTime, uBeat, uDrive;
  uniform vec3 uC0, uC1;
  varying vec3 vW;
  void main() {
    vec2 p = vW.xz;
    vec2 cell = floor(p / 1.4);
    float chk = mod(cell.x + cell.y, 2.0);
    vec3 col;
    if (uMode < 0.5) col = mix(vec3(0.05), vec3(0.12), chk) + uC0 * 0.25 * uDrive * chk;
    else if (uMode < 1.5) {
      vec2 g = abs(fract(p / 1.4) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.03, 0.5 - max(g.x, g.y));
      col = vec3(0.02) + mix(uC0, uC1, chk) * line * (0.4 + 1.5 * uDrive);
    } else if (uMode < 2.5) col = mix(vec3(0.9), vec3(0.03), chk) * (0.5 + 0.5 * uDrive);
    else col = vec3(0.01) + uC1 * 0.04 * (0.5 + 0.5 * sin(length(p) * 2.0 - uTime * 2.0)) * uDrive;
    float pulse = exp(-5.0 * fract(uBeat)) * uDrive * 0.15;
    gl_FragColor = vec4(col + uC0 * pulse, 1.0);
  }
`;

class UpsideDown extends CrazyRoom {
  readonly modes = ['Classic', 'Neon', 'Checkerboard', 'Void'];
  readonly actions: RoomAction[] = [
    { id: 'flip', label: 'Flip', kind: 'hit' },
    { id: 'spin', label: 'Spin lights', kind: 'toggle' },
    { id: 'float', label: 'Float', kind: 'hold' },
    { id: 'tilt', label: 'Tilt', kind: 'hold' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'flip', label: 'Gravity flips', energy: 'big' },
    { id: 'barrel', label: 'The room barrel-rolls', energy: 'big' },
    { id: 'float', label: 'Everything floats', energy: 'deep' },
  ];
  private floorMat: THREE.ShaderMaterial;
  private ceilMat: THREE.ShaderMaterial;
  private ring: THREE.Group;
  private ringMat: THREE.MeshBasicMaterial;
  private motes: THREE.Points;
  private moteV: Float32Array;
  /** 0 the right way up, 1 upside down; the roll eases towards it */
  private flipped = 0;
  private roll = 0;
  private barrel = 0;
  private applied = new THREE.Quaternion();
  private appliedRoll = 0;
  private halfDone = false;
  private lastProgress = 0;
  private q = new THREE.Quaternion();
  private fwd = new THREE.Vector3();

  constructor() {
    super({ roomId: 'upsidedown', roomName: 'Upside-Down Room', w: W, h: H, d: D, back: 3, fog: 0x050508, fogDensity: 0.012, hemi: 0.35, booth: { strip: '#ffb547' } });
    // the signature angle: from the back, halfway up, both crowds in shot
    this.views.wide = { pos: V(-5.6, H * 0.5, -D + 0.8), target: V(0, H * 0.5, -1) };
    this.views.wideLabel = 'Both crowds';
    const tileMat = () =>
      new THREE.ShaderMaterial({
        uniforms: { uMode: { value: 0 }, uTime: { value: 0 }, uBeat: { value: 0 }, uDrive: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
        fragmentShader: TILE_FRAG,
        side: THREE.DoubleSide,
      });
    this.floorMat = tileMat();
    this.ceilMat = tileMat();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D + 3).rotateX(-Math.PI / 2), this.floorMat);
    floor.position.set(0, 0, (3 - D) / 2);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D + 3).rotateX(Math.PI / 2), this.ceilMat);
    ceil.position.set(0, H, (3 - D) / 2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.8, side: THREE.DoubleSide });
    for (const x of [-W, W]) {
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(D + 3, H), wallMat);
      wl.rotation.y = Math.PI / 2;
      wl.position.set(x, H / 2, (3 - D) / 2);
      this.group.add(wl);
    }
    for (const z of [-D, 3]) {
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), wallMat);
      wl.position.set(0, H / 2, z);
      this.group.add(wl);
    }
    this.group.add(floor, ceil);
    // the second booth, on the ceiling, and its crowd
    const upside = new THREE.Group();
    upside.position.set(0, H, 0);
    upside.rotation.z = Math.PI;
    upside.add(booth({ w: 2.6, d: 0.9, strip: '#7a3cff' }).group);
    this.group.add(upside);
    // a ring of light bars round the middle of the room
    this.ring = new THREE.Group();
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.2), this.ringMat);
      bar.position.set(Math.cos(a) * (W - 0.3), Math.sin(a) * (H / 2 - 0.3), 0);
      bar.lookAt(0, 0, 0);
      this.ring.add(bar);
    }
    this.ring.position.set(0, H / 2, -D / 2);
    this.ring.rotation.y = Math.PI / 2;
    this.group.add(this.ring);
    this.wash(V(0, H / 2, -D / 2), 0, 2.6, 16);
    this.wash(V(0, 1, -4), 1, 1.4, 9);
    this.wash(V(0, H - 1, -4), 2, 1.4, 9);
    this.people(0.85, 1901, { phones: 0.18, clothes: ['#f2f2f2', '#101114', '#ffb547', '#2b2d33', '#16171a', '#d8d0c0'] });
    // the ceiling crowd: built the right way up, then the whole crowd turned over onto the ceiling
    const top = this.people(0.75, 1902, { phones: 0.18, clothes: ['#101114', '#7a3cff', '#f2f2f2', '#2b2d33', '#3dd6ff', '#16171a'] });
    top.object.removeFromParent();
    upside.add(top.object);
    // motes that fall towards whichever way is down
    const n = 600;
    const pos = new Float32Array(n * 3);
    this.moteV = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * W * 2, Math.random() * H, -Math.random() * D], i * 3);
      this.moteV[i] = 0.2 + Math.random() * 0.6;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.05, color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(this.motes);
  }

  protected onAction(id: string): void {
    if (id === 'flip') this.flipped = 1 - this.flipped;
  }

  startMoment(id: string, len = 8): void {
    super.startMoment(id, id === 'flip' ? 2 : len);
    if (id === 'flip') this.flipped = 1 - this.flipped;
  }

  protected tick(s: ShowState, _f: Features, dt: number, camera: THREE.Camera): void {
    // halfway through the set, gravity flips (once per set)
    if (setClock.progress < this.lastProgress - 0.2) this.halfDone = false;
    this.lastProgress = setClock.progress;
    if (!this.halfDone && setClock.progress >= 0.5 && s.playing) {
      this.halfDone = true;
      this.flipped = 1 - this.flipped;
    }
    for (const [m, drive] of [
      [this.floorMat, this.drive.floor],
      [this.ceilMat, this.drive.ceil],
    ] as [THREE.ShaderMaterial, number][]) {
      m.uniforms.uMode.value = this.look.mode;
      m.uniforms.uTime.value = this.time;
      m.uniforms.uBeat.value = s.beat;
      m.uniforms.uDrive.value = drive;
      (m.uniforms.uC0.value as THREE.Color).copy(this.cols[0]);
      (m.uniforms.uC1.value as THREE.Color).copy(this.cols[1]);
    }
    this.ring.rotation.z += dt * ((this.on('spin') ? 1.2 : 0.15) + (this.parts?.melody ?? 0) * 0.5);
    this.ringMat.color.copy(this.cols[1]).multiplyScalar((0.6 + this.drive.walls * 2) * (0.4 + 0.6 * s.master));
    // the motes fall towards down, or float
    const down = this.flipped > 0.5 ? 1 : -1;
    const float = this.on('float') || this.momentK('float') > 0.2;
    const p = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + (float ? Math.sin(this.time + i) * 0.1 : down * this.moteV[i]) * dt;
      if (y < 0) y += H;
      if (y > H) y -= H;
      p.setY(i, y);
    }
    p.needsUpdate = true;
    // the roll: towards the flip, plus a barrel roll and a held tilt
    const target = this.flipped * Math.PI;
    this.roll += (target - this.roll) * Math.min(1, dt * 1.6);
    if (this.moment?.id === 'barrel') this.barrel = Math.min(1, this.moment.t / 3) * Math.PI * 2;
    else this.barrel += (Math.round(this.barrel / (Math.PI * 2)) * Math.PI * 2 - this.barrel) * Math.min(1, dt * 2);
    const tilt = this.on('tilt') ? 0.45 : 0;
    this.applyRoll(camera, this.roll + this.barrel + tilt);
    this.lookUp = this.flipped * 0.3 + (float ? 0.5 : 0);
  }

  /**
   * Turn the club camera round its view axis. Last frame's roll comes off
   * first (unless the camera rig has set the camera afresh since), so it
   * never builds up; the board views close to the booth never roll.
   */
  private applyRoll(camera: THREE.Camera, roll: number): void {
    if (camera.quaternion.equals(this.applied) && this.appliedRoll !== 0) {
      camera.getWorldDirection(this.fwd);
      camera.quaternion.premultiply(this.q.setFromAxisAngle(this.fwd, -this.appliedRoll));
    }
    const nearBooth = camera.position.distanceTo(V(0, 1.2, 0)) < 2.6;
    const r = nearBooth ? 0 : roll;
    if (Math.abs(r) > 1e-4) {
      camera.getWorldDirection(this.fwd);
      camera.quaternion.premultiply(this.q.setFromAxisAngle(this.fwd, r));
    }
    this.appliedRoll = r;
    this.applied.copy(camera.quaternion);
  }
}

export const upsideDown: VenueDef = {
  id: 'upsidedown',
  name: 'Upside-Down Room',
  short: 'Upside-Down',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A crowd on the floor and another on the ceiling. Halfway through the set, gravity flips.',
  palette: ['#ffb547', '#7a3cff', '#3dd6ff'],
  ui: '#ffb547',
  capacity: '320',
  build: () => new UpsideDown(),
  thumb(g, w, h) {
    g.fillStyle = '#07070c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#1c1c24' : '#2e2e38';
      g.fillRect(i * (w / 12), h * 0.86, w / 12, h * 0.14);
      g.fillRect(i * (w / 12), 0, w / 12, h * 0.14);
    }
    g.fillStyle = '#0a0a10';
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.arc(w * (0.1 + i * 0.09), h * 0.78, 6, 0, Math.PI * 2);
      g.arc(w * (0.12 + i * 0.09), h * 0.22, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffb547';
    g.fillRect(0, h / 2 - 2, w, 4);
  },
};
