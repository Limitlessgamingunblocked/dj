/*
 * The Water Room: the dance floor is a shallow pool, the crowd ankle-deep in
 * it, with curtains of rain falling from the ceiling in light. The water
 * mirrors the room (a MirrorProbe, bent by the ripples): every kick sends
 * rings out from where people stamp, and the strobe "freezes" the rain into
 * hanging drops (the drops shorten to points; nothing flashes faster).
 *
 *   modes    calm pool, storm, mirror lake, lava (a red glow from below)
 *   pads     heavy rain (hold), splash, freeze (hold), still water
 *   moments  downpour (big), splash (big), still (deep: the rain stops and
 *            the pool goes glassy)
 *   stems    the ripples follow the drums, the rain the melody, the lights
 *            in it the vocals
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import { crowdArea, MovingHeads } from '../fixtures';
import type { ShowState } from '../show';
import { CrazyRoom, MirrorProbe, PROBE_GLSL, V, type RoomAction, type RoomMoment } from './kit';

const W = 7.5;
const H = 5.5;
const D = 14;
const RIPPLES = 20;
const DROPS = 1800;
const CURTAINS = [-3.2, -7.4, -11.4];

const WATER_FRAG = /* glsl */ `
  ${PROBE_GLSL}
  uniform float uTime, uStill, uLava, uGain;
  uniform vec4 uRip[${RIPPLES}];
  uniform vec3 uDeep, uGlow;
  varying vec3 vW;
  void main() {
    // the surface's slope from the ripples and a slow swell
    vec2 p = vW.xz;
    vec2 g = vec2(0.0);
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 rp = uRip[i];
      float age = uTime - rp.z;
      if (age < 0.0 || age > 3.0) continue;
      vec2 d = p - rp.xy;
      float r = length(d) + 0.001;
      float k = (r - age * 1.8) * 9.0;
      g += d / r * cos(k) * exp(-k * k * 0.04) * (1.0 - age / 3.0) * rp.w * 0.25;
    }
    g += vec2(sin(p.x * 1.7 + uTime * 0.9), cos(p.y * 1.3 + uTime * 0.7)) * 0.02;
    g *= uGain * (1.0 - uStill * 0.95);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 Vd = normalize(vW - cameraPosition);
    vec3 R = reflect(Vd, N);
    float fres = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(-Vd, N)), 5.0);
    vec3 refl = probe(vW + vec3(0.0, 0.02, 0.0), R);
    vec3 col = mix(uDeep, refl, clamp(0.35 + fres, 0.0, 1.0));
    // lava: a glow from below that the ripples break up
    col += uGlow * uLava * (0.6 + 0.4 * sin(p.x * 2.0 + uTime) * cos(p.y * 1.7 - uTime * 0.6)) * (1.0 - fres);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const RAIN_VERT = /* glsl */ `
  attribute vec3 aDrop;
  uniform float uTime, uSpeed, uFreeze, uHeight;
  varying float vA;
  void main() {
    // aDrop: x, the curtain's z, a phase
    float fall = fract(aDrop.z + uTime * uSpeed * (0.8 + fract(aDrop.z * 13.0) * 0.4));
    float y = uHeight - fall * uHeight;
    float len = mix(0.45, 0.03, uFreeze);
    vec3 p = vec3(aDrop.x + position.x * 0.012, y + position.y * len, aDrop.y);
    vA = 1.0 - fall * 0.4;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }
`;

class WaterRoom extends CrazyRoom {
  readonly modes = ['Calm pool', 'Storm', 'Mirror lake', 'Lava'];
  readonly actions: RoomAction[] = [
    { id: 'rain', label: 'Heavy rain', kind: 'hold' },
    { id: 'splash', label: 'Splash', kind: 'hit' },
    { id: 'freeze', label: 'Freeze drops', kind: 'hold' },
    { id: 'still', label: 'Still water', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'downpour', label: 'The rain comes down', energy: 'big' },
    { id: 'splash', label: 'A wave crosses the pool', energy: 'big' },
    { id: 'still', label: 'The rain stops and the pool goes still', energy: 'deep' },
  ];
  private probe: MirrorProbe;
  private water: THREE.ShaderMaterial;
  private rain: THREE.ShaderMaterial;
  private rip: THREE.Vector4[] = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
  private ripN = 0;
  private spots: { x: number; z: number }[];
  private still = 0;
  private freeze = 0;
  private speed = 0.6;

  constructor() {
    super({ roomId: 'water', roomName: 'Water Room', w: W, h: H, d: D, back: 3, fog: 0x03070a, fogDensity: 0.025, hemi: 0.25, hemiSky: 0x203040, booth: { strip: '#3dd6ff' } });
    const walls = new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.4, metalness: 0.2, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), walls);
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    this.probe = new MirrorProbe(160, V(0, 1.6, -D * 0.45), new THREE.Box3(V(-W, 0, -D), V(W, H, 3)));
    this.water = new THREE.ShaderMaterial({
      uniforms: { ...this.probe.uniforms, uTime: { value: 0 }, uStill: { value: 0 }, uLava: { value: 0 }, uGain: { value: 1 }, uRip: { value: this.rip }, uDeep: { value: new THREE.Color(0.01, 0.03, 0.04) }, uGlow: { value: new THREE.Color(1.4, 0.25, 0.05) } },
      vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: WATER_FRAG,
    });
    // the pool: in front of the booth; the booth stands on a dry deck
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D - 1.1).rotateX(-Math.PI / 2), this.water);
    pool.position.set(0, 0.06, -1.1 - (D - 1.1) / 2);
    this.group.add(pool);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.1, 4.1), new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.5 }));
    deck.position.set(0, 0.05, 0.95);
    this.group.add(deck);
    // the rain curtains
    this.rain = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSpeed: { value: 0.6 }, uFreeze: { value: 0 }, uHeight: { value: H - 0.1 }, uColor: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: RAIN_VERT,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor * vA, 1.0); }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const quad = new THREE.PlaneGeometry(1, 1);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = quad.index;
    ig.setAttribute('position', quad.attributes.position);
    const drops = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) drops.set([(Math.random() - 0.5) * (W * 2 - 0.6), CURTAINS[i % CURTAINS.length] + (Math.random() - 0.5) * 0.3, Math.random()], i * 3);
    ig.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 3));
    ig.instanceCount = DROPS;
    const rainMesh = new THREE.Mesh(ig, this.rain);
    rainMesh.frustumCulled = false;
    this.group.add(rainMesh);
    // lights shining down through the curtains
    this.add(new MovingHeads([-5, 0, 5].flatMap((x) => CURTAINS.map((z) => ({ pos: V(x, H - 0.25, z + 0.6) }))), { length: 8, radius: 0.45, gain: 1.2, floorY: 0, haze: [0.2, H] }));
    this.wash(V(0, H - 0.5, -D * 0.5), 0, 2.2, 14);
    this.wash(V(0, 0.3, -6), 2, 1.2, 9);
    const spots = crowdArea(this.x0 + 1, this.x1 - 1, -1.8, this.z0 + 1.4, 0.85, 2101, { y: -0.04 });
    this.spots = spots.map((p) => ({ x: p.x, z: p.z }));
    this.people(0, 2101, { spots, phones: 0.15, shorts: 0.6, clothes: ['#f2f2f2', '#3dd6ff', '#101114', '#2b2d33', '#d8f0ff', '#16171a'] });
  }

  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    this.probe.update(renderer, this.sceneRoot(), dt);
  }

  private ripple(x: number, z: number, k: number): void {
    this.rip[this.ripN++ % RIPPLES].set(x, z, this.time, k);
  }

  protected onAction(id: string): void {
    if (id === 'splash') for (let i = 0; i < 5; i++) this.ripple((Math.random() - 0.5) * 3, -6 + (Math.random() - 0.5) * 3, 2);
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const mode = this.look.mode;
    const wu = this.water.uniforms;
    wu.uTime.value = this.time;
    // ripples from people stamping on the kick
    const kickHit = this.parts ? this.parts.kickHit : s.kick > 0.9;
    if (kickHit && s.playing && this.spots.length) {
      const n = 1 + Math.round(this.drive.floor * 3);
      for (let i = 0; i < n; i++) {
        const p = this.spots[Math.floor(Math.random() * this.spots.length)];
        this.ripple(p.x, p.z, 0.5 + Math.random() * 0.6);
      }
    }
    if (this.moment?.id === 'splash' && this.moment.t < 0.05) for (let i = 0; i < 6; i++) this.ripple(0, -1.5, 2.5);
    const stillWant = this.on('still') || this.momentK('still') > 0.1 || mode === 2 ? 1 : 0;
    this.still += (stillWant - this.still) * Math.min(1, dt * 1.2);
    wu.uStill.value = this.still;
    wu.uGain.value = mode === 1 ? 1.8 : 1;
    wu.uLava.value = mode === 3 ? 1 : 0;
    (wu.uDeep.value as THREE.Color).copy(this.cols[2]).multiplyScalar(0.03).add(new THREE.Color(0.005, 0.02, 0.03));
    // the rain: heavier with the melody, a storm, the pad or the downpour; none when it's still
    const heavy = this.on('rain') || this.momentK('downpour') > 0.1 || mode === 1;
    const speedWant = (heavy ? 1.3 : 0.55 + (this.parts?.melody ?? 0) * 0.4) * (1 - (this.momentK('still') > 0.1 ? 1 : 0));
    this.speed += (speedWant - this.speed) * Math.min(1, dt * 2);
    const ru = this.rain.uniforms;
    ru.uTime.value += dt * this.speed;
    ru.uSpeed.value = 1;
    // the strobe freezes the drops (they shorten to points)
    const freezeWant = this.on('freeze') ? 1 : Math.min(1, s.strobe * 1.5 + s.flash);
    this.freeze += (freezeWant - this.freeze) * Math.min(1, dt * 12);
    ru.uFreeze.value = this.freeze;
    const rainGain = (heavy ? 1 : 0.55) * (0.4 + this.drive.ceil * 0.8 + s.flash * 1.5) * (0.4 + 0.6 * s.master) * (this.momentK('still') > 0.5 ? 0.05 : 1);
    (ru.uColor.value as THREE.Color).copy(this.cols[1]).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(rainGain * 0.35);
    this.lookUp = heavy ? 0.5 : 0.1;
  }

  dispose(): void {
    this.probe.dispose();
    super.dispose();
  }
}

export const waterRoom: VenueDef = {
  id: 'water',
  name: 'Water Room',
  short: 'Water Room',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A shallow pool for a dance floor and curtains of rain falling in light. Every kick ripples the water.',
  palette: ['#3dd6ff', '#ffffff', '#7a3cff'],
  ui: '#3dd6ff',
  capacity: '180',
  build: () => new WaterRoom(),
  thumb(g, w, h) {
    g.fillStyle = '#03080c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,220,255,0.6)';
    for (let i = 0; i < 60; i++) {
      const x = (i * 37) % w;
      const y = (i * 23) % (h * 0.6);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 8);
      g.stroke();
    }
    for (const r of [8, 16, 24]) {
      g.strokeStyle = `rgba(61,214,255,${0.8 - r / 40})`;
      g.beginPath();
      g.ellipse(w / 2, h * 0.82, r * 1.6, r * 0.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  },
};
