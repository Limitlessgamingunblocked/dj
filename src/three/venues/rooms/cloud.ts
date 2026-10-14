/*
 * The Cloud Room: a round deck floating above a sea of clouds at sunset.
 * The sky glows from gold at the horizon to deep blue overhead, the clouds
 * below catch the sun from the side, and on the drop lightning flickers
 * inside them and forks between the banks.
 *
 *   modes    sunset, dawn (pink), storm (dark and bruised), aurora (night, curtains of light)
 *   pads     lightning, wind (the clouds race), rise (hold: the deck climbs), night
 *   moments  storm (big: lightning everywhere), breakthrough (big: up through a cloud bank), golden hour (deep)
 *   stems    the lightning follows the drums, the clouds' glow the melody, the sky the vocals
 *   safety   lightning flashes stay under 3 a second with Reduce flashing
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { ShowState } from '../show';
import { CrazyRoom, V, type RoomAction, type RoomMoment } from './kit';

const DECK = 10;
const CZ = -7;
const BOLTS = 4;

const SKY_FRAG = /* glsl */ `
  uniform float uMode, uTime, uNight, uVocal, uFlash;
  uniform vec3 uSunDir;
  varying vec3 vD;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vD);
    float y = d.y;
    vec3 horizon = uMode < 0.5 ? vec3(1.0, 0.55, 0.2) : uMode < 1.5 ? vec3(1.0, 0.55, 0.65) : uMode < 2.5 ? vec3(0.35, 0.3, 0.4) : vec3(0.05, 0.08, 0.15);
    vec3 zenith = uMode < 0.5 ? vec3(0.08, 0.15, 0.4) : uMode < 1.5 ? vec3(0.3, 0.35, 0.7) : uMode < 2.5 ? vec3(0.06, 0.06, 0.1) : vec3(0.0, 0.01, 0.04);
    vec3 col = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.6));
    col = mix(col, zenith * 0.3, uNight);
    // the sun, and its glow
    float sd = max(0.0, dot(d, normalize(uSunDir)));
    col += vec3(1.0, 0.75, 0.4) * (pow(sd, 600.0) * 6.0 + pow(sd, 12.0) * 0.5) * (1.0 - uNight) * (uMode > 2.5 ? 0.0 : 1.0);
    // stars at night
    vec2 sp = floor(d.xz / max(0.05, d.y + 0.2) * 260.0);
    col += vec3(1.0) * step(0.997, h21(sp)) * max(uNight, uMode > 2.5 ? 1.0 : 0.0) * step(0.05, y);
    // the aurora: curtains swaying overhead
    if (uMode > 2.5) {
      float band = sin(d.x * 6.0 + uTime * 0.3 + sin(d.z * 4.0 + uTime * 0.2) * 2.0);
      float a = smoothstep(0.2, 1.0, band) * smoothstep(0.1, 0.4, y) * smoothstep(0.9, 0.5, y);
      col += mix(vec3(0.1, 1.0, 0.5), vec3(0.6, 0.2, 1.0), clamp(y * 1.5, 0.0, 1.0)) * a * (0.6 + uVocal);
    }
    col *= 0.8 + uVocal * 0.4;
    col += vec3(0.6, 0.65, 0.9) * uFlash * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform float uTime, uWind, uGlow, uFlash, uLayer;
  uniform vec3 uSun, uShade, uFlashAt;
  varying vec3 vP;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec2 p = vP.xz * 0.025 + vec2(uTime * uWind * 0.02, uLayer * 3.7);
    float n = fbm(p);
    float dens = smoothstep(0.38 - uLayer * 0.03, 0.75, n);
    if (dens < 0.01) discard;
    // lit from the sun's side, darker underneath
    float lit = fbm(p + vec2(0.04, 0.0)) - n;
    vec3 col = mix(uShade, uSun, clamp(0.55 + lit * 6.0 + uGlow * 0.3, 0.0, 1.0));
    // lightning inside the clouds
    float fl = uFlash * exp(-length(vP.xz - uFlashAt.xz) * 0.03);
    col += vec3(0.75, 0.8, 1.0) * fl * 2.5 * dens;
    float edge = 1.0 - smoothstep(60.0, 140.0, length(vP.xz));
    gl_FragColor = vec4(col, dens * edge * (0.9 - uLayer * 0.15));
  }
`;

class CloudRoom extends CrazyRoom {
  readonly modes = ['Sunset', 'Dawn', 'Storm', 'Aurora'];
  readonly actions: RoomAction[] = [
    { id: 'bolt', label: 'Lightning', kind: 'hit' },
    { id: 'wind', label: 'Wind', kind: 'toggle' },
    { id: 'rise', label: 'Rise', kind: 'hold' },
    { id: 'night', label: 'Night', kind: 'toggle' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'storm', label: 'Lightning tears through the clouds', energy: 'big' },
    { id: 'breakthrough', label: 'The deck bursts up through the clouds', energy: 'big' },
    { id: 'golden', label: 'Golden hour', energy: 'deep' },
  ];
  private sky: THREE.ShaderMaterial;
  private clouds: THREE.ShaderMaterial[] = [];
  private layers: THREE.Mesh[] = [];
  private bolts: { mesh: THREE.Mesh; t: number }[] = [];
  private boltMat: THREE.MeshBasicMaterial;
  private flash = 0;
  private flashAt = new THREE.Vector3();
  private lastFlash = -99;
  private lift = 0;
  private night = 0;
  private wind = 0.3;
  private lastBeat = -1;
  private sunCol = new THREE.Color();

  constructor() {
    super({ roomId: 'cloud', roomName: 'Cloud Room', w: DECK, h: 10, d: -CZ + DECK, back: 3, fog: 0x8a6a6a, fogDensity: 0.002, hemi: 0.8, hemiSky: 0xffc89a, hemiGround: 0x5a4a6a, booth: { strip: '#ffd8a0' } });
    this.views.wide = { pos: V(-DECK - 4, 3.5, CZ - DECK + 2), target: V(0, 1.5, CZ + 4) };
    this.views.wideLabel = 'Above the clouds';
    this.views.drone = [V(0, 6, CZ - DECK - 6), V(DECK + 6, 5, CZ), V(DECK, 4, 4), V(0, 5, 8), V(-DECK, 4, 4), V(-DECK - 6, 5, CZ)];
    this.sky = new THREE.ShaderMaterial({
      uniforms: { uMode: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 }, uVocal: { value: 0 }, uFlash: { value: 0 }, uSunDir: { value: new THREE.Vector3(-0.6, 0.06, -1) } },
      vertexShader: /* glsl */ `varying vec3 vD; void main() { vD = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.sky);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);
    // the cloud sea: stacked layers below the deck
    for (let i = 0; i < 4; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uWind: { value: 0.3 }, uGlow: { value: 0 }, uFlash: { value: 0 }, uLayer: { value: i }, uSun: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uFlashAt: { value: new THREE.Vector3() } },
        vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.clouds.push(m);
      const layer = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), m);
      layer.position.set(0, -3 - i * 1.6, CZ);
      layer.renderOrder = -5 + i;
      this.layers.push(layer);
      this.group.add(layer);
    }
    // the deck: a round platform with a glowing rim and a glass rail
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(DECK, DECK * 0.92, 0.5, 64), new THREE.MeshStandardMaterial({ color: 0xe8e4de, roughness: 0.35, metalness: 0.2 }));
    deck.position.set(0, -0.25, CZ);
    this.group.add(deck);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(DECK, 0.06, 8, 128).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd8a0, toneMapped: false }));
    rim.position.set(0, 0.02, CZ);
    this.group.add(rim);
    this.strip(rim.material as THREE.MeshBasicMaterial);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(DECK - 0.1, DECK - 0.1, 1.05, 64, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, roughness: 0.05, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    rail.position.set(0, 0.52, CZ);
    this.group.add(rail);
    // lightning bolts: jagged ribbons between the cloud banks
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < BOLTS; i++) {
      const pts: THREE.Vector3[] = [];
      let x = 0;
      let z = 0;
      for (let k = 0; k <= 10; k++) {
        pts.push(V(x, -k * 0.8, z));
        x += (Math.random() - 0.5) * 1.6;
        z += (Math.random() - 0.5) * 1.6;
      }
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.06, 4), this.boltMat);
      mesh.visible = false;
      this.group.add(mesh);
      this.bolts.push({ mesh, t: 99 });
    }
    this.people(0.85, 2501, { area: [-DECK + 2, DECK - 2, -1.6, CZ - DECK + 2], phones: 0.35, clothes: ['#f4efe6', '#ffd8a0', '#2a2d33', '#d0d4dc', '#ff8a6a', '#16171a'] });
    this.wash(V(-20, 4, CZ - 30), 0, 2.5, 60, 0.3);
    this.wash(V(0, 6, CZ), 1, 1.2, 16);
  }

  protected onAction(id: string): void {
    if (id === 'bolt') this.strike(true);
  }

  startMoment(id: string, len = 8): void {
    super.startMoment(id, len);
    if (id === 'storm') this.strike(true);
  }

  /** a lightning strike (held back to under 3 a second with Reduce flashing) */
  private strike(force: boolean, safe = false): void {
    if (this.time - this.lastFlash < (safe ? 0.36 : 0.08) && !force) return;
    if (safe && this.time - this.lastFlash < 0.36) return;
    this.lastFlash = this.time;
    this.flash = 1;
    const a = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 50;
    this.flashAt.set(Math.cos(a) * r, -4, CZ + Math.sin(a) * r);
    const b = this.bolts[Math.floor(Math.random() * BOLTS)];
    b.t = 0;
    b.mesh.position.set(this.flashAt.x, -1.5, this.flashAt.z);
    b.mesh.rotation.y = Math.random() * 6;
  }

  protected tick(s: ShowState, _f: Features, dt: number): void {
    const mode = this.look.mode;
    const safe = s.reduceFlash;
    // lightning on the beat through a storm, on the drums in the storm mode
    const beat = Math.floor(s.beat);
    const stormy = this.momentK('storm') > 0.1 || (mode === 2 && this.drive.floor > 0.6);
    if (beat !== this.lastBeat && s.playing) {
      this.lastBeat = beat;
      if (stormy && Math.random() < 0.6) this.strike(false, safe);
    }
    this.flash *= Math.exp(-dt * (safe ? 4 : 9));
    for (const b of this.bolts) {
      b.t += dt;
      b.mesh.visible = b.t < (safe ? 0.3 : 0.15);
    }
    this.boltMat.opacity = Math.min(1, this.flash * 1.5) * (safe ? 0.6 : 1);
    // the deck rises (the clouds fall away) on the pad and the breakthrough
    const want = (this.on('rise') ? 6 : 0) + this.momentK('breakthrough') * 10;
    this.lift += (want - this.lift) * Math.min(1, dt * 0.8);
    this.layers.forEach((l, i) => (l.position.y = -3 - i * 1.6 - this.lift + (this.momentK('breakthrough') > 0.5 ? 0 : 0)));
    this.wind += ((this.on('wind') ? 2.5 : 0.3) - this.wind) * Math.min(1, dt);
    this.night += ((this.on('night') ? 1 : 0) - this.night) * Math.min(1, dt * 0.5);
    const golden = this.momentK('golden');
    // cloud colours: the sun's side and the shade, by mode
    const sun = [0xffb070, 0xffb0c8, 0x8a8a9a, 0x3a5a8a][mode];
    const shade = [0x6a4a6a, 0x7a6a9a, 0x2a2a34, 0x0a1020][mode];
    this.sunCol.set(sun).lerp(new THREE.Color(0xffc870), golden * 0.6).multiplyScalar(1 - this.night * 0.7);
    for (const m of this.clouds) {
      const u = m.uniforms;
      u.uTime.value = this.time;
      u.uWind.value = this.wind;
      u.uGlow.value = (this.parts?.melody ?? s.high) * 0.8 + golden;
      u.uFlash.value = this.flash;
      (u.uFlashAt.value as THREE.Vector3).copy(this.flashAt);
      (u.uSun.value as THREE.Color).copy(this.sunCol);
      (u.uShade.value as THREE.Color).set(shade).multiplyScalar(1 - this.night * 0.6);
    }
    const su = this.sky.uniforms;
    su.uMode.value = mode;
    su.uTime.value = this.time;
    su.uNight.value = this.night;
    su.uVocal.value = this.drive.ceil * 0.6 + golden * 0.5;
    su.uFlash.value = this.flash;
    (su.uSunDir.value as THREE.Vector3).set(-0.6, 0.06 + golden * 0.05 - this.night * 0.3, -1);
    this.fogBase.set(mode === 3 ? 0x0a1020 : mode === 2 ? 0x3a3a44 : 0x9a7a7a).multiplyScalar(1 - this.night * 0.7);
    this.flashLight.intensity += this.flash * 18;
    this.lookUp = Math.min(1, this.flash * 0.8 + this.momentK('breakthrough') * 0.7);
  }
}

export const cloudRoom: VenueDef = {
  id: 'cloud',
  name: 'Cloud Room',
  short: 'Clouds',
  place: 'Secret room',
  kind: 'Crazy room',
  blurb: 'A floating deck above a sea of clouds at sunset, with lightning in the clouds on the drop.',
  palette: ['#ffd8a0', '#ff8a6a', '#8ab4ff'],
  ui: '#ffc89a',
  capacity: '300',
  build: () => new CloudRoom(),
  thumb(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1a2a5a');
    grad.addColorStop(0.55, '#ff9a4a');
    grad.addColorStop(1, '#6a4a6a');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,220,200,0.85)';
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.ellipse(Math.random() * w, h * (0.7 + Math.random() * 0.25), 20 + Math.random() * 20, 6 + Math.random() * 5, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffe6b0';
    g.beginPath();
    g.arc(w * 0.25, h * 0.55, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8e4de';
    g.fillRect(w * 0.3, h * 0.6, w * 0.4, 4);
  },
};
