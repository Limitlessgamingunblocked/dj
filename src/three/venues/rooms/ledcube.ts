/*
 * The LED Cube: floor, walls and ceiling are one LED screen. The visual
 * player wraps the room; the floor ripples out from where people step on the
 * kick; the waveform of what's playing runs along the walls; and on the drop
 * the room falls away into a tunnel, into space, or shatters into pixels.
 *
 *   modes    visuals, waveform (walls) and spectrum (floor), neon grid,
 *            digital rain
 *   pads     tunnel (hold), space (hold), floor flash, invert, bigger ripples
 *   moments  tunnel (big), shatter (big), space (deep)
 *   stems    drums drive the floor, melody the walls, vocals the ceiling
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import { crowdArea } from '../fixtures';
import type { ShowState } from '../show';
import { AudioTexture, CrazyRoom, HUE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 8;
const H = 6;
const D = 16;
const BACK = 3;
const RIPPLES = 24;

const FRAG = /* glsl */ `
  ${HUE_GLSL}
  uniform sampler2D uVis, uAudio;
  uniform float uMode, uTime, uBeat, uDrop, uDropKind, uFlash, uInvert, uHasVis, uRippleGain;
  uniform vec3 uDrive, uC0, uC1, uC2;
  uniform vec4 uRip[${RIPPLES}];
  varying vec3 vW;
  varying vec3 vN;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float h31(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  vec3 spec(float x) { return texture2D(uAudio, vec2(x, 0.25)).rgb; }
  float wave(float x) { return texture2D(uAudio, vec2(x, 0.75)).r; }
  void main() {
    vec3 N = normalize(vN);
    vec3 ax = abs(N);
    float isFloor = step(0.5, N.y);
    float isCeil = step(0.5, -N.y);
    float isWall = 1.0 - isFloor - isCeil;
    // the surface's own coordinates, metres, and 0..1 across it
    vec2 m = ax.y > 0.5 ? vW.xz : ax.x > 0.5 ? vW.zy : vW.xy;
    vec2 span = ax.y > 0.5 ? vec2(${(W * 2).toFixed(1)}, ${(D + BACK).toFixed(1)}) : ax.x > 0.5 ? vec2(${(D + BACK).toFixed(1)}, ${H.toFixed(1)}) : vec2(${(W * 2).toFixed(1)}, ${H.toFixed(1)});
    vec2 lo = ax.y > 0.5 ? vec2(${(-W).toFixed(1)}, ${(-D).toFixed(1)}) : ax.x > 0.5 ? vec2(${(-D).toFixed(1)}, 0.0) : vec2(${(-W).toFixed(1)}, 0.0);
    vec2 uv = (m - lo) / span;
    float drive = isFloor * uDrive.x + isWall * uDrive.y + isCeil * uDrive.z;
    vec3 col = vec3(0.0);
    if (uMode < 0.5) {
      col = uHasVis > 0.5 ? texture2D(uVis, vec2(uv.x, uv.y)).rgb * 1.2 : uC0 * 0.3;
    } else if (uMode < 1.5) {
      // the waveform along the walls, the spectrum across the floor, a glow on the ceiling
      if (isWall > 0.5) {
        float w = wave(uv.x) * 0.38 + 0.5;
        float d = abs(uv.y - w);
        col = mix(uC0, uC1, uv.x) * (0.012 / (d + 0.01)) * (0.5 + drive);
      } else {
        float s = spec(fract(abs(uv.x - 0.5) * 2.0) * 0.7).r;
        float bar = step(abs(uv.y - 0.5) * 2.0, s * 1.4);
        col = mix(uC1, uC2, uv.y) * bar * (0.4 + drive);
      }
    } else if (uMode < 2.5) {
      vec2 g = abs(fract(m / 1.0) - 0.5);
      float line = 1.0 - smoothstep(0.0, 0.04, min(g.x, g.y));
      float pulse = exp(-4.0 * fract(uBeat));
      col = mix(uC0, uC2, uv.y) * line * (0.4 + 1.4 * pulse * drive);
    } else {
      // digital rain: columns falling at their own speeds
      float colI = floor(m.x / 0.22 + m.y * 0.0);
      float sp = 0.6 + h21(vec2(colI, 3.0)) * 1.6;
      float y = fract((ax.y > 0.5 ? m.y : m.y) * 0.18 + uTime * sp * 0.25 + h21(vec2(colI, 9.0)));
      float trail = pow(y, 8.0);
      col = uC1 * trail * (0.6 + drive) + uC0 * step(0.985, y) * 2.0;
    }
    // footsteps: rings run out from where people stamp on the kick
    if (isFloor > 0.5) {
      float r = 0.0;
      for (int i = 0; i < ${RIPPLES}; i++) {
        vec4 rp = uRip[i];
        float age = uTime - rp.z;
        if (age < 0.0 || age > 2.2) continue;
        float d = length(vW.xz - rp.xy);
        float ring = exp(-pow((d - age * 2.4) * 6.0, 2.0)) * (1.0 - age / 2.2);
        r += ring * rp.w;
      }
      col += mix(uC2, vec3(1.0), 0.3) * r * uRippleGain * (0.6 + uDrive.x);
      col += vec3(1.0) * uFlash * 1.5;
    }
    // the drop: the room falls away
    if (uDrop > 0.001) {
      vec3 dir = normalize(vW - cameraPosition);
      vec3 fall = vec3(0.0);
      if (uDropKind < 0.5) {
        // a tunnel rushing past
        float a = atan(dir.y, dir.x);
        float rr = length(dir.xy) + 0.001;
        float z = 0.25 / rr + uTime * 2.6;
        float rings = pow(abs(sin(z * 3.14159)), 18.0);
        float spokes = pow(abs(sin(a * 6.0 + z * 0.7)), 30.0);
        fall = hueShift(uC0, z * 0.05) * (rings + spokes * 0.6) * (1.2 - rr);
      } else if (uDropKind < 1.5) {
        // space: stars streaming past, a nebula behind
        vec3 p = dir * 40.0;
        vec3 c = floor(p);
        float st = step(0.985, h31(c + floor(uTime * 0.5)));
        float tw = 0.5 + 0.5 * sin(uTime * 4.0 + h31(c) * 30.0);
        fall = vec3(st * tw * 2.0) + mix(uC1, uC2, 0.5 + 0.5 * dir.y) * 0.12 * (0.6 + 0.4 * sin(dir.x * 3.0 + uTime * 0.2));
      } else {
        // shatter: the LED tiles drop out one by one
        vec2 tile = floor(m / 0.5);
        float gone = step(h21(tile), uDrop * 1.1);
        fall = col * (1.0 - gone) + uC0 * gone * 0.05 * h21(tile + uTime);
        col = mix(col, fall, 1.0);
      }
      if (uDropKind < 1.5) col = mix(col, fall, smoothstep(0.0, 1.0, uDrop));
    }
    col = mix(col, vec3(1.0) - clamp(col, 0.0, 1.0), uInvert);
    // the LED pixels: a dot grid with dark gaps, brighter head-on
    vec2 px = fract(m / 0.035) - 0.5;
    float dotm = 1.0 - smoothstep(0.32, 0.5, length(px));
    col *= 0.35 + 0.9 * dotm;
    gl_FragColor = vec4(col, 1.0);
  }
`;

class LedCube extends CrazyRoom {
  readonly modes = ['Visuals', 'Waveform', 'Neon grid', 'Digital rain'];
  readonly actions: RoomAction[] = [
    { id: 'tunnel', label: 'Tunnel', kind: 'hold' },
    { id: 'space', label: 'Space', kind: 'hold' },
    { id: 'flash', label: 'Floor flash', kind: 'hit' },
    { id: 'invert', label: 'Invert', kind: 'toggle' },
    { id: 'stomp', label: 'Big ripples', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'tunnel', label: 'The room falls away into a tunnel', energy: 'big' },
    { id: 'shatter', label: 'The LED room shatters', energy: 'big' },
    { id: 'space', label: 'The room opens into space', energy: 'deep' },
  ];
  private mat: THREE.ShaderMaterial;
  private visMat = new THREE.MeshBasicMaterial({ visible: false });
  private audio = new AudioTexture();
  private steps: { x: number; z: number }[];
  private rip: THREE.Vector4[] = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
  private ripN = 0;
  private drop = 0;
  private dropKind = 0;

  constructor() {
    super({ roomId: 'ledcube', roomName: 'LED Cube', w: W, h: H, d: D, back: BACK, fog: 0x020205, fogDensity: 0.01, hemi: 0.2, booth: { strip: '#ffffff' } });
    this.ambient = 0.6;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uVis: { value: null },
        uAudio: { value: this.audio.texture },
        uMode: { value: 0 },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uDrop: { value: 0 },
        uDropKind: { value: 0 },
        uFlash: { value: 0 },
        uInvert: { value: 0 },
        uHasVis: { value: 0 },
        uRippleGain: { value: 1 },
        uDrive: { value: new THREE.Vector3() },
        uC0: { value: new THREE.Color() },
        uC1: { value: new THREE.Color() },
        uC2: { value: new THREE.Color() },
        uRip: { value: this.rip },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: FRAG,
      side: THREE.BackSide,
    });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + BACK), this.mat);
    shell.position.set(0, H / 2, (BACK - D) / 2);
    this.group.add(shell);
    // the visual player feeds the room through a hidden material (the stage fills its map)
    this.visMaterials.push(this.visMat);
    this.visObjects.push(shell);
    // the screens light the room: soft washes in the screen's colours
    this.wash(V(0, H - 0.5, -D * 0.5), 0, 2.4, 16);
    this.wash(V(-W + 0.6, 2, -6), 1, 1.8, 10);
    this.wash(V(W - 0.6, 2, -10), 2, 1.8, 10);
    this.people(0.9, 1301, { phones: 0.22, drinks: 0.2, clothes: ['#0e0e10', '#1d1f24', '#f0f0f0', '#2a2d33', '#16171a', '#3a3d45'] });
    this.steps = crowdArea(this.x0 + 1, this.x1 - 1, -1.6, this.z0 + 1.4, 0.35, 1302).map((p) => ({ x: p.x, z: p.z }));
  }

  protected tick(s: ShowState, f: Features, dt: number): void {
    const u = this.mat.uniforms;
    this.audio.update(f);
    u.uVis.value = this.visMat.map;
    u.uHasVis.value = this.visMat.map ? 1 : 0;
    u.uMode.value = this.look.mode;
    u.uTime.value = this.time;
    u.uBeat.value = s.beat;
    (u.uDrive.value as THREE.Vector3).set(this.drive.floor, this.drive.walls, this.drive.ceil);
    (u.uC0.value as THREE.Color).copy(this.cols[0]).multiplyScalar(1.2 * s.master + 0.2);
    (u.uC1.value as THREE.Color).copy(this.cols[1]).multiplyScalar(1.2 * s.master + 0.2);
    (u.uC2.value as THREE.Color).copy(this.cols[2]).multiplyScalar(1.2 * s.master + 0.2);
    // footsteps: a few people stamp on each kick
    const kickHit = this.parts ? this.parts.kickHit : s.kick > 0.85;
    if (kickHit && s.playing && this.steps.length) {
      const n = 2 + Math.round(this.drive.floor * 4);
      for (let i = 0; i < n; i++) {
        const p = this.steps[Math.floor(Math.random() * this.steps.length)];
        this.rip[this.ripN++ % RIPPLES].set(p.x, p.z, this.time, 0.6 + Math.random() * 0.6);
      }
    }
    u.uRippleGain.value = this.on('stomp') ? 2.2 : 1;
    u.uFlash.value = this.since('flash') < 0.5 ? 1 - this.since('flash') / 0.5 : 0;
    u.uInvert.value += ((this.on('invert') ? 1 : 0) - u.uInvert.value) * Math.min(1, dt * (s.reduceFlash ? 2 : 8));
    // the room falls away: a held pad or the drop's moment
    let want = 0;
    if (this.on('tunnel')) {
      want = 1;
      this.dropKind = 0;
    } else if (this.on('space')) {
      want = 1;
      this.dropKind = 1;
    } else if (this.moment) {
      want = this.momentK();
      this.dropKind = this.moment.id === 'tunnel' ? 0 : this.moment.id === 'space' ? 1 : 2;
    }
    this.drop += (want - this.drop) * Math.min(1, dt * (want > this.drop ? 3 : 1.5));
    u.uDrop.value = this.drop;
    u.uDropKind.value = this.dropKind;
    this.lookUp = this.drop * 0.8;
  }

  dispose(): void {
    this.audio.dispose();
    super.dispose();
  }
}

export const ledCube: VenueDef = {
  id: 'ledcube',
  name: 'LED Cube',
  short: 'LED Cube',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Every surface is an LED screen playing the visuals; on the drop the room falls away.',
  palette: ['#ff2e88', '#3dd6ff', '#b6ff3b'],
  ui: '#ff2e88',
  capacity: '260',
  build: () => new LedCube(),
  thumb(g, w, h) {
    g.fillStyle = '#05050a';
    g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#ff2e88');
    grad.addColorStop(0.5, '#3dd6ff');
    grad.addColorStop(1, '#b6ff3b');
    g.fillStyle = grad;
    for (let y = 0; y < h; y += 5) for (let x = 0; x < w; x += 5) if ((x * 7 + y * 13) % 11 > 3) g.fillRect(x, y, 3, 3);
    g.fillStyle = 'rgba(5,5,10,0.55)';
    g.fillRect(w * 0.18, h * 0.22, w * 0.64, h * 0.56);
  },
};
