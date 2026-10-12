/*
 * Inside a Speaker: you play on the dust cap of a giant woofer. The cone
 * rises round you like a crater, the crowd on its slope, the rubber surround
 * at the rim and the grille high overhead, light streaming through its holes.
 * Every kick pumps the cone: the paper flexes, the crowd on it bounces, and
 * a shockwave runs out to the rim.
 *
 *   modes    classic paper, carbon weave, gold, neon (the ribs glow)
 *   pads     boom (one huge push), grille lights, shockwave rings, sub (hold: slow deep excursions)
 *   moments  blowout (big: the cone at its limit, dust flying), shockwave (big), breathe (deep)
 *   stems    the cone follows the drums, the rings the melody, the grille's light the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { Crowd, CrowdSpot } from '../crowd';
import { getCrowdScale } from '../crowd';
import { MovingHeads } from '../fixtures';
import type { ShowState } from '../show';
import { CrazyRoom, V, type RoomAction, type RoomMoment } from './kit';

const CAP = 2.4;
const RIM = 14;
const RISE = 5.2;
const GRILLE = 13;
const DUST = 600;

/** the cone's height at radius r (a gentle curve up from the cap to the surround) */
export function coneY(r: number): number {
  if (r <= CAP) return 0;
  const t = Math.min(1, (r - CAP) / (RIM - CAP));
  return RISE * Math.pow(t, 1.35);
}

/** how far the cone moves at radius r for an excursion of 1 (most near the cap, none at the rim) */
export function coneFlex(r: number): number {
  if (r <= CAP) return 1;
  return Math.max(0, 1 - (r - CAP) / (RIM - CAP));
}

const CONE_VERT = /* glsl */ `
  uniform float uPush, uTime, uWave, uWaveR;
  varying vec3 vP;
  varying float vR;
  void main() {
    vec3 p = position;
    float r = length(p.xz);
    float flex = clamp(1.0 - (r - ${CAP.toFixed(1)}) / ${(RIM - CAP).toFixed(1)}, 0.0, 1.0);
    // the push, and the shockwave's ripple running out to the rim
    p.y += uPush * flex * 0.6;
    p.y += uWave * 0.25 * exp(-pow((r - uWaveR) * 1.2, 2.0)) * flex;
    vR = r;
    vP = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
  }
`;

const CONE_FRAG = /* glsl */ `
  uniform float uMode, uTime, uWave, uWaveR, uGlow;
  uniform vec3 uC0, uC1;
  varying vec3 vP;
  varying float vR;
  void main() {
    float a = atan(vP.z, vP.x);
    // ribs running out from the centre, rings of corrugation near the rim
    float rib = smoothstep(0.46, 0.485, abs(fract(a * 18.0 / 6.2831853) - 0.5));
    float corr = 0.5 + 0.5 * sin(vR * 6.0);
    vec3 base;
    if (uMode < 0.5) base = vec3(0.06, 0.06, 0.07) * (0.8 + 0.2 * corr);
    else if (uMode < 1.5) {
      float weave = step(0.5, fract(vP.x * 2.0)) == step(0.5, fract(vP.z * 2.0)) ? 1.0 : 0.6;
      base = vec3(0.07, 0.07, 0.08) * weave;
    }
    else if (uMode < 2.5) base = vec3(0.55, 0.42, 0.16) * (0.75 + 0.25 * corr);
    else base = vec3(0.03, 0.03, 0.05);
    vec3 col = base * (1.0 - rib * 0.4);
    // neon: the ribs glow in the show's colours
    col += mix(uC0, uC1, 0.5 + 0.5 * sin(a * 3.0 + uTime)) * rib * (uMode > 2.5 ? 1.5 : 0.15) * (0.4 + uGlow);
    // the shockwave: a bright ring
    col += uC1 * uWave * exp(-pow((vR - uWaveR) * 2.5, 2.0)) * 1.5;
    gl_FragColor = vec4(col, 1.0);
  }
`;

class SpeakerRoom extends CrazyRoom {
  readonly modes = ['Classic', 'Carbon', 'Gold', 'Neon'];
  readonly actions: RoomAction[] = [
    { id: 'boom', label: 'Boom', kind: 'hit' },
    { id: 'grille', label: 'Grille lights', kind: 'toggle' },
    { id: 'rings', label: 'Shockwaves', kind: 'toggle' },
    { id: 'sub', label: 'Sub', kind: 'hold' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'blowout', label: 'The cone hits its limit', energy: 'big' },
    { id: 'shockwave', label: 'A shockwave rolls out to the rim', energy: 'big' },
    { id: 'breathe', label: 'The speaker breathes', energy: 'deep' },
  ];
  private cone: THREE.ShaderMaterial;
  private grilleMat: THREE.ShaderMaterial;
  private rings: { crowd: Crowd; r: number }[] = [];
  private push = 0;
  private pushV = 0;
  private wave = 0;
  private waveR = CAP;
  private boomAt = -99;
  private dust: THREE.Points;
  private dustV: Float32Array;
  private lastBeat = -1;

  constructor() {
    super({ roomId: 'speaker', roomName: 'Inside a Speaker', w: RIM - 2, h: GRILLE, d: RIM - 1, back: 4, fog: 0x060608, fogDensity: 0.012, hemi: 0.35, booth: { strip: '#ff5a2a' } });
    this.views.wide = { pos: V(-6, coneY(9) + 1.8, -8), target: V(0, 1.2, 0) };
    this.views.wideLabel = 'From the cone';
    this.views.extra = { ...this.views.extra, rig: { pos: V(0, GRILLE - 1, -0.5), target: V(0, 0, -0.51) } };
    const shared = { uPush: { value: 0 }, uTime: { value: 0 }, uWave: { value: 0 }, uWaveR: { value: CAP } };
    this.cone = new THREE.ShaderMaterial({
      uniforms: { ...shared, uMode: { value: 0 }, uGlow: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() } },
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      side: THREE.DoubleSide,
    });
    // the cone, lathed from the cap out to the rim
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 40; i++) {
      const r = CAP + ((RIM - CAP) * i) / 40;
      prof.push(new THREE.Vector2(r, coneY(r)));
    }
    this.group.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 96), this.cone));
    // the dust cap: a shallow dome you stand on, flattened in the middle for the booth
    const cap = new THREE.Mesh(new THREE.SphereGeometry(CAP * 2.2, 48, 8, 0, Math.PI * 2, 0, 0.47).translate(0, -CAP * 2.2 + 0.25, 0), new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.4, metalness: 0.3 }));
    cap.scale.set(1, 0.4, 1);
    this.group.add(cap);
    const deck = new THREE.Mesh(new THREE.CircleGeometry(CAP * 0.9, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.35, metalness: 0.5 }));
    deck.position.y = 0.005;
    this.group.add(deck);
    // the surround: a rubber roll at the rim
    const surround = new THREE.Mesh(new THREE.TorusGeometry(RIM + 0.7, 0.8, 16, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.75 }));
    surround.position.y = RISE + 0.3;
    this.group.add(surround);
    // the basket's edge beyond, and the grille overhead: perforated metal, light through the holes
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(RIM + 2, RIM + 2, 3, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5, metalness: 0.7, side: THREE.BackSide }));
    basket.position.y = RISE + 1.2;
    this.group.add(basket);
    this.grilleMat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: 0 }, uC0: { value: new THREE.Color() }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uLight, uTime; uniform vec3 uC0; varying vec3 vP;
        void main() {
          vec2 q = vP.xz * 1.6;
          vec2 cell = fract(q + vec2(step(0.5, fract(q.y * 0.5)) * 0.5, 0.0)) - 0.5;
          float hole = 1.0 - smoothstep(0.24, 0.28, length(cell));
          vec3 metal = vec3(0.16, 0.16, 0.18);
          vec3 light = uC0 * uLight * (0.6 + 0.4 * sin(length(vP.xz) * 0.8 - uTime * 2.0)) + vec3(0.02);
          gl_FragColor = vec4(mix(metal, light, hole), 1.0);
        }`,
      side: THREE.BackSide,
    });
    const grille = new THREE.Mesh(new THREE.SphereGeometry(RIM + 2, 64, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.grilleMat);
    grille.scale.y = (GRILLE - RISE) / (RIM + 2);
    grille.position.y = RISE + 0.5;
    this.group.add(grille);
    // beams down through the grille
    this.add(
      new MovingHeads(
        Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return { pos: V(Math.cos(a) * 7, GRILLE - 2.2, Math.sin(a) * 7 - 1) };
        }),
        { length: 12, radius: 0.4, gain: 1.4, floorY: 0, haze: [0.3, GRILLE] },
      ),
    );
    // the crowd on the cone, in three rings so each bounces with its own part of the cone
    const scale = getCrowdScale();
    [
      [CAP + 0.8, CAP + 3],
      [CAP + 3, CAP + 5.5],
      [CAP + 5.5, CAP + 8],
    ].forEach(([r0, r1], k) => {
      const spots: CrowdSpot[] = [];
      const ring = (r0 + r1) / 2;
      const n = Math.round((r1 - r0) * ring * Math.PI * 1.4 * 0.85 * scale);
      for (let i = 0; i < n; i++) {
        // in front and to the sides of the booth (not right behind it)
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
        const r = r0 + Math.random() * (r1 - r0);
        spots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: coneY(r) });
      }
      const c = this.people(0, 2201 + k * 5, { spots, phones: 0.25, booth: V(0, 0, 0), clothes: ['#e8eaf0', '#ff5a2a', '#16171a', '#2a2d33', '#ffd23f', '#d0d4dc'] });
      this.rings.push({ crowd: c, r: ring });
    });
    // dust on the cone, jumping when it moves hard
    const pos = new Float32Array(DUST * 3);
    this.dustV = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = CAP + 1 + Math.random() * (RIM - CAP - 2);
      pos.set([Math.cos(a) * r, coneY(r) + 0.02, Math.sin(a) * r], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd8d0c0, size: 0.05, transparent: true, opacity: 0.8 }));
    this.group.add(this.dust);
    this.wash(V(0, GRILLE - 3, -5), 0, 2.2, 18);
    this.wash(V(0, 2.5, 0.6), 1, 1.2, 8);
  }

  protected onAction(id: string): void {
    if (id === 'boom') this.boom(1.4);
  }

  private boom(k: number): void {
    this.pushV += k * 3.2;
    this.wave = Math.max(this.wave, k);
    this.waveR = CAP;
    this.boomAt = this.time;
  }

  startMoment(id: string, len = 8): void {
    super.startMoment(id, len);
    if (id === 'blowout') this.boom(2.2);
    if (id === 'shockwave') this.boom(1.2);
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const u = this.cone.uniforms;
    // the cone: a spring pushed by every kick (more with the sub held, slower and deeper)
    const sub = this.on('sub') ? 1 : 0;
    const drive = this.drive.floor * (0.8 + s.kick * 1.2) * (s.playing ? 1 : 0.2);
    const beat = Math.floor(s.beat);
    if (beat !== this.lastBeat && s.playing) {
      this.lastBeat = beat;
      this.pushV += (0.6 + drive * 1.4) * (1 + sub);
      if (this.on('rings') || this.momentK('shockwave') > 0.1) {
        this.wave = Math.max(this.wave, 0.6 + (this.parts?.melody ?? s.high) * 0.6);
        this.waveR = CAP;
      }
    }
    const stiff = sub ? 14 : 40;
    const breathe = this.momentK('breathe') * Math.sin(this.time * 1.3) * 0.35;
    this.pushV += (-stiff * (this.push - breathe) - this.pushV * (sub ? 3 : 7)) * dt;
    this.push += this.pushV * dt;
    const limit = this.momentK('blowout') > 0.1 ? 1.3 : 0.9;
    this.push = Math.max(-0.4, Math.min(limit, this.push));
    u.uPush.value = this.push;
    this.wave *= Math.exp(-dt * 0.9);
    this.waveR += dt * 7;
    u.uWave.value = this.wave;
    u.uWaveR.value = this.waveR;
    u.uTime.value = this.time;
    u.uMode.value = this.look.mode;
    u.uGlow.value = this.drive.walls + s.kick * 0.5;
    (u.uC0.value as THREE.Color).copy(this.cols[0]);
    (u.uC1.value as THREE.Color).copy(this.cols[1]);
    // the crowd rides the cone
    for (const ring of this.rings) {
      const wave = this.wave * 0.25 * Math.exp(-Math.pow((ring.r - this.waveR) * 1.2, 2)) * coneFlex(ring.r);
      ring.crowd.object.position.y = this.push * coneFlex(ring.r) * 0.6 + wave;
    }
    // dust jumps off the cone when it kicks hard
    const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const hard = this.pushV > 4 || this.time - this.boomAt < 0.1;
    for (let i = 0; i < DUST; i++) {
      const x = arr[i * 3];
      const z = arr[i * 3 + 2];
      const r = Math.hypot(x, z);
      const ground = coneY(r) + this.push * coneFlex(r) * 0.6 + 0.02;
      if (hard && arr[i * 3 + 1] <= ground + 0.01) this.dustV[i] = (0.5 + Math.random()) * 2.4 * coneFlex(r);
      this.dustV[i] -= 9.8 * dt;
      arr[i * 3 + 1] = Math.max(ground, arr[i * 3 + 1] + this.dustV[i] * dt);
      if (arr[i * 3 + 1] <= ground) this.dustV[i] = 0;
    }
    p.needsUpdate = true;
    // the grille's light
    const gl = this.grilleMat.uniforms;
    gl.uLight.value = (this.on('grille') ? 1.4 : 0.35) * (0.3 + this.drive.ceil * 1.4) * (0.4 + 0.6 * s.master);
    (gl.uC0.value as THREE.Color).copy(this.cols[2]);
    gl.uTime.value = this.time;
    this.lookUp = Math.min(1, this.momentK() * 0.7 + (this.on('grille') ? 0.3 : 0));
  }
}

export const insideSpeaker: VenueDef = {
  id: 'speaker',
  name: 'Inside a Speaker',
  short: 'Speaker',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'Play on the dust cap of a giant woofer: the cone pumps with every kick and the crowd bounces on it.',
  palette: ['#ff5a2a', '#ffd23f', '#3dd6ff'],
  ui: '#ff8a3c',
  capacity: '350',
  build: () => new SpeakerRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#060608';
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    for (let r = h * 0.48; r > 6; r -= 6) {
      g.fillStyle = r > h * 0.44 ? '#1a1a1e' : r % 12 < 6 ? '#121216' : '#0c0c0f';
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#222226';
    g.beginPath();
    g.arc(cx, cy, h * 0.12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ff5a2a';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, h * 0.3, 0, Math.PI * 2);
    g.stroke();
  },
};
