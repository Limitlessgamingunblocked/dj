/*
 * Rooms you build yourself (the Room editor): pick the walls, the floor, the
 * ceiling and the extras, three colours and a size, and it's a crazy room
 * like the others, with the same pads, scenes and drop moments, saved as a
 * venue of its own. The parts are simpler cousins of the crazy rooms':
 *
 *   walls    mirrors, LED screens, moving pins, neon stripes, glow paint, dark
 *   floor    LED (rings out on the kick), mirror, water, polished dark
 *   ceiling  LED, stars, mirror, dark
 *   extras   light-beam grid (at body height: light, never lasers), rain, thick fog,
 *            blacklight, moving heads, lasers (overhead), a light sculpture
 *
 * Saved rooms live in settings ("customRooms", at most 8) and are added to
 * the venue list as "custom-<id>".
 */
import * as THREE from 'three';
import { loadSetting, saveSetting } from '../../../core/settings';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { VenueDef } from '../base';
import type { Crowd } from '../crowd';
import { Lasers, MovingHeads } from '../fixtures';
import type { ShowState } from '../show';
import { CrazyRoom, MirrorProbe, PROBE_GLSL, V, glowMaterial, type RoomAction, type RoomMoment } from './kit';

export const WALLS = ['mirror', 'led', 'pins', 'neon', 'paint', 'dark'] as const;
export const FLOORS = ['led', 'mirror', 'water', 'plain'] as const;
export const CEILINGS = ['led', 'stars', 'mirror', 'plain'] as const;
export const EXTRAS = ['beams', 'rain', 'fog', 'uv', 'movers', 'lasers', 'sculpture'] as const;
export const SIZES = ['small', 'medium', 'large'] as const;

export type WallKind = (typeof WALLS)[number];
export type FloorKind = (typeof FLOORS)[number];
export type CeilingKind = (typeof CEILINGS)[number];
export type ExtraKind = (typeof EXTRAS)[number];
export type RoomSize = (typeof SIZES)[number];

export const PART_LABEL: Record<string, string> = {
  mirror: 'Mirrors',
  led: 'LED screens',
  pins: 'Moving pins',
  neon: 'Neon stripes',
  paint: 'Glow paint',
  dark: 'Dark',
  water: 'Water',
  plain: 'Polished dark',
  stars: 'Stars',
  beams: 'Light-beam grid',
  rain: 'Rain curtains',
  fog: 'Thick fog',
  uv: 'Blacklight',
  movers: 'Moving heads',
  lasers: 'Lasers overhead',
  sculpture: 'Light sculpture',
  small: 'Small (club)',
  medium: 'Medium (hall)',
  large: 'Large (warehouse)',
};

export interface CustomRoomConfig {
  id: string;
  name: string;
  size: RoomSize;
  walls: WallKind;
  floor: FloorKind;
  ceiling: CeilingKind;
  extras: ExtraKind[];
  colors: [string, string, string];
}

export const MAX_CUSTOM_ROOMS = 8;

const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);

/** a room from storage or a share: always complete and valid */
export function cleanRoomConfig(raw: unknown, fallbackId = 'room'): CustomRoomConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 28) : 'My room';
  const id = typeof r.id === 'string' && /^[a-z0-9]{1,16}$/.test(r.id) ? r.id : fallbackId;
  const colors = Array.isArray(r.colors) ? r.colors : [];
  return {
    id,
    name,
    size: pick(SIZES, r.size, 'medium'),
    walls: pick(WALLS, r.walls, 'mirror'),
    floor: pick(FLOORS, r.floor, 'led'),
    ceiling: pick(CEILINGS, r.ceiling, 'stars'),
    extras: Array.isArray(r.extras) ? [...new Set(r.extras.filter((e): e is ExtraKind => EXTRAS.includes(e as ExtraKind)))] : [],
    colors: [hex(colors[0], '#ff2e88'), hex(colors[1], '#3dd6ff'), hex(colors[2], '#ffd23f')],
  };
}

export function loadCustomRooms(): CustomRoomConfig[] {
  const raw = loadSetting<unknown[]>('customRooms', []);
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_CUSTOM_ROOMS).map((x, i) => cleanRoomConfig(x, `r${i}`));
}

export function saveCustomRooms(list: CustomRoomConfig[]): void {
  saveSetting('customRooms', list.slice(0, MAX_CUSTOM_ROOMS).map((r) => cleanRoomConfig(r, r.id)));
}

export const customVenueId = (c: Pick<CustomRoomConfig, 'id'>) => `custom-${c.id}`;
export const isCustomRoom = (id: string) => id.startsWith('custom-');

const DIMS: Record<RoomSize, [number, number, number]> = { small: [5.5, 4.6, 10], medium: [7.5, 6.2, 14], large: [10, 8, 20] };

const SHELL_FRAG = /* glsl */ `
  ${PROBE_GLSL}
  uniform float uWall, uFloor, uCeil, uTime, uBeat, uKick, uSpin, uInvert, uFlash, uUV, uMoment, uHasProbe;
  uniform vec3 uDrive;
  uniform vec3 uC0, uC1, uC2;
  uniform sampler2D uVis;
  varying vec3 vW;
  varying vec3 vN;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 led(vec2 m, float drive) {
    vec3 c = texture2D(uVis, fract(m * 0.08 + vec2(uSpin * 0.05, 0.0))).rgb * (0.6 + drive);
    vec2 px = fract(m / 0.04) - 0.5;
    return c * (0.35 + 0.9 * (1.0 - smoothstep(0.32, 0.5, length(px))));
  }
  vec3 mirror(vec3 n, float tint) {
    vec3 V = normalize(vW - cameraPosition);
    vec3 R = reflect(V, normalize(n));
    vec3 c = uHasProbe > 0.5 ? probe(vW + n * 0.02, R) : vec3(0.05);
    return c * (0.82 + tint * 0.1);
  }
  void main() {
    vec3 n = normalize(vN);
    float isFloor = step(0.5, n.y);
    float isCeil = step(0.5, -n.y);
    vec2 m = abs(n.x) > 0.5 ? vW.zy : abs(n.z) > 0.5 ? vW.xy : vW.xz;
    float kind = isFloor > 0.5 ? uFloor + 10.0 : isCeil > 0.5 ? uCeil + 20.0 : uWall;
    float drive = isFloor > 0.5 ? uDrive.x : isCeil > 0.5 ? uDrive.z : uDrive.y;
    vec3 col = vec3(0.03);
    // walls: 0 mirror, 1 LED, 2 pins (dark behind), 3 neon, 4 glow paint, 5 dark
    if (kind < 0.5) col = mirror(n + vec3(sin(m.x * 3.0 + uSpin) * 0.02, 0.0, 0.0), drive);
    else if (kind < 1.5) col = led(m, drive);
    else if (kind < 2.5) col = vec3(0.02);
    else if (kind < 3.5) {
      float band = fract(m.y * 1.1 - uTime * 0.5 * (0.4 + drive));
      float tube = exp(-pow((band - 0.5) * 30.0, 2.0));
      col = vec3(0.015) + mix(uC0, uC1, step(0.5, fract(m.y * 0.55))) * tube * (1.2 + drive * 2.0);
    } else if (kind < 4.5) {
      float splat = smoothstep(0.62, 0.66, h21(floor(m * 1.6)) * 0.6 + h21(floor(m * 4.3)) * 0.4);
      vec3 paint = h21(floor(m * 1.6) + 3.0) < 0.5 ? uC0 : h21(floor(m * 1.6) + 5.0) < 0.5 ? uC1 : uC2;
      col = vec3(0.01) + paint * splat * (0.25 + uUV * 1.6 + drive * 0.6);
    } else if (kind < 5.5) col = vec3(0.025);
    // floors: 10 LED rings, 11 mirror, 12 water, 13 polished dark
    else if (kind < 10.5) {
      float r = length(m - vec2(0.0, -5.0));
      float ring = exp(-pow(fract(r * 0.3 - uBeat * 0.5) - 0.5, 2.0) * 60.0);
      vec2 g = abs(fract(m) - 0.5);
      float grid = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
      col = mix(uC1, uC2, 0.5 + 0.5 * sin(r * 0.4 - uTime)) * (ring * (0.4 + drive * 1.6 + uKick) + grid * 0.15);
      vec2 px = fract(m / 0.06) - 0.5;
      col *= 0.4 + 0.9 * (1.0 - smoothstep(0.3, 0.5, length(px)));
    } else if (kind < 11.5) col = mirror(n, 0.0);
    else if (kind < 12.5) {
      float t = uTime * 1.5;
      vec3 wn = n + vec3(sin(m.x * 4.0 + t) * 0.03 + sin(m.y * 3.0 - t * 1.3) * 0.02 * (1.0 + uKick * 3.0), 0.0, cos(m.y * 4.0 + t) * 0.03);
      col = mirror(wn, 0.0) * vec3(0.7, 0.85, 1.0) + vec3(0.0, 0.02, 0.04);
    } else if (kind < 13.5) col = vec3(0.03) + mirror(n, 0.0) * 0.15;
    // ceilings: 20 LED, 21 stars, 22 mirror, 23 dark
    else if (kind < 20.5) col = led(m, drive);
    else if (kind < 21.5) col = vec3(0.005, 0.005, 0.02) + vec3(1.0) * step(0.992, h21(floor(m * 8.0))) * (0.5 + 0.5 * sin(uTime * 3.0 + h21(floor(m * 8.0)) * 40.0)) * (0.6 + drive);
    else if (kind < 22.5) col = mirror(n, 0.0);
    else col = vec3(0.02);
    col += uC0 * uMoment * 0.25 + vec3(1.0) * uFlash * 0.4 * (isFloor + 0.3);
    col = mix(col, vec3(1.0) - clamp(col, 0.0, 1.0), uInvert);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const RAIN = 1400;
const PIN = 0.4;

class CustomRoom extends CrazyRoom {
  readonly modes = ['Your colours', 'Warm', 'Cold', 'Rainbow'];
  readonly actions: RoomAction[] = [
    { id: 'flash', label: 'Flash', kind: 'hit' },
    { id: 'spin', label: 'Spin', kind: 'toggle' },
    { id: 'invert', label: 'Invert', kind: 'toggle' },
    { id: 'storm', label: 'Storm', kind: 'hold' },
  ];
  readonly moments: RoomMoment[] = [
    { id: 'burst', label: 'The room bursts into light', energy: 'big' },
    { id: 'storm', label: 'Everything at once', energy: 'big' },
    { id: 'calm', label: 'The room goes calm', energy: 'deep' },
  ];
  private mat: THREE.ShaderMaterial;
  private visMat = new THREE.MeshBasicMaterial();
  private probe: MirrorProbe | null = null;
  private cfg: CustomRoomConfig;
  private H: number;
  private spin = 0;
  private flashT = 99;
  private pins: THREE.InstancedMesh | null = null;
  private pinCells: { x: number; y: number; z: number; side: number; band: number }[] = [];
  private rain: THREE.Points | null = null;
  private rainV: Float32Array | null = null;
  private beams: THREE.ShaderMaterial | null = null;
  private sculpture: { group: THREE.Group; mats: THREE.ShaderMaterial[] } | null = null;
  private crowd: Crowd;
  private dummy = new THREE.Object3D();
  private palette: [THREE.Color, THREE.Color, THREE.Color];

  constructor(cfg: CustomRoomConfig) {
    const [W, H, D] = DIMS[cfg.size];
    const has = (e: ExtraKind) => cfg.extras.includes(e);
    super({ roomId: customVenueId(cfg), roomName: cfg.name, w: W, h: H, d: D, back: 3, fog: 0x06060a, fogDensity: has('fog') ? 0.07 : 0.015, hemi: has('uv') ? 0.08 : 0.3, booth: { strip: cfg.colors[0] } });
    this.cfg = cfg;
    this.H = H;
    this.palette = [new THREE.Color(cfg.colors[0]), new THREE.Color(cfg.colors[1]), new THREE.Color(cfg.colors[2])];
    if (has('uv')) this.ambient = 0.15;
    this.visMaterials.push(this.visMat);
    const needProbe = cfg.walls === 'mirror' || cfg.floor === 'mirror' || cfg.floor === 'water' || cfg.ceiling === 'mirror' || cfg.floor === 'plain';
    if (needProbe) this.probe = new MirrorProbe(cfg.size === 'large' ? 160 : 192, V(0, 1.6, -D * 0.45), new THREE.Box3(V(-W, 0, -D), V(W, H, 3)));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...(this.probe?.uniforms ?? { uCube: { value: null }, uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() }, uProbe: { value: new THREE.Vector3() }, uSphere: { value: 0 } }),
        uHasProbe: { value: this.probe ? 1 : 0 },
        uWall: { value: WALLS.indexOf(cfg.walls) },
        uFloor: { value: FLOORS.indexOf(cfg.floor) },
        uCeil: { value: CEILINGS.indexOf(cfg.ceiling) },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uKick: { value: 0 },
        uSpin: { value: 0 },
        uInvert: { value: 0 },
        uFlash: { value: 0 },
        uUV: { value: has('uv') ? 1 : 0 },
        uMoment: { value: 0 },
        uDrive: { value: new THREE.Vector3() },
        uC0: { value: new THREE.Color() },
        uC1: { value: new THREE.Color() },
        uC2: { value: new THREE.Color() },
        uVis: { value: null },
      },
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vN; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; vN = -normal; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: SHELL_FRAG,
      side: THREE.BackSide,
    });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, D + 3), this.mat);
    shell.position.set(0, H / 2, (3 - D) / 2);
    this.group.add(shell);
    // moving pins on the side walls
    if (cfg.walls === 'pins') {
      for (const side of [-1, 1])
        for (let z = -0.6; z > -D + 0.3; z -= PIN)
          for (let y = PIN / 2; y < H - 0.2; y += PIN) this.pinCells.push({ x: side * (W - 0.02), y, z, side, band: Math.floor(((-z) / D) * 24) });
      this.pins = new THREE.InstancedMesh(new THREE.BoxGeometry(1, PIN * 0.86, PIN * 0.86), new THREE.MeshStandardMaterial({ color: 0x8a8d94, roughness: 0.35, metalness: 0.7 }), this.pinCells.length);
      this.group.add(this.pins);
    }
    if (has('movers') || has('fog')) {
      this.add(
        new MovingHeads(
          [-W * 0.6, 0, W * 0.6].flatMap((x) => [-D * 0.25, -D * 0.6].map((z) => ({ pos: V(x, H - 0.25, z) }))),
          { length: H + 3, radius: 0.45, gain: has('fog') ? 1.5 : 1.1, floorY: 0, haze: [0.3, H] },
        ),
      );
    }
    if (has('lasers') && H >= 4.5) {
      this.add(
        new Lasers(
          [
            { pos: V(-W + 0.4, H - 0.5, -D + 1), dir: V(0.6, -0.05, 1), side: -1, beams: 10, length: 30 },
            { pos: V(W - 0.4, H - 0.5, -D + 1), dir: V(-0.6, -0.05, 1), side: 1, beams: 10, length: 30, alt: true },
          ],
          { room: { floorY: 0, x0: -W, x1: W, z0: -D, z1: 3, ceilY: H }, audience: { floorY: 0, x0: -W, x1: W, z0: -D, z1: -1 }, haze: [0.5, H] },
        ),
      );
    }
    // a grid of light beams across the room at body height (light, not lasers)
    if (has('beams')) {
      this.beams = glowMaterial(new THREE.Color(1, 1, 1));
      for (let k = 0; k < 7; k++) {
        const z = -2 - k * ((D - 3) / 7);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W * 2, 6).rotateZ(Math.PI / 2), this.beams);
        beam.position.set(0, 0.9 + (k % 3) * 0.25, z);
        this.group.add(beam);
      }
    }
    // curtains of rain either side of the floor
    if (has('rain')) {
      const pos = new Float32Array(RAIN * 3);
      this.rainV = new Float32Array(RAIN);
      for (let i = 0; i < RAIN; i++) {
        const side = i % 2 ? 1 : -1;
        pos.set([side * (W * 0.55 + Math.random() * 0.6), Math.random() * H, -1 - Math.random() * (D - 2)], i * 3);
        this.rainV[i] = 5 + Math.random() * 3;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.05, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.group.add(this.rain);
    }
    // a sculpture of glowing rings over the crowd (out of reach)
    if (has('sculpture')) {
      const group = new THREE.Group();
      const mats: THREE.ShaderMaterial[] = [];
      for (const r of [0.9, 1.5, 2.1]) {
        const m = glowMaterial(new THREE.Color(1, 1, 1));
        mats.push(m);
        group.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 64), m));
      }
      group.position.set(0, Math.max(3.6, H - 2.2), -D * 0.5);
      this.group.add(group);
      this.sculpture = { group, mats };
    }
    this.wash(V(0, H - 0.4, -D * 0.4), 0, 2, 14);
    this.wash(V(0, 2, -D * 0.8), 1, 1.4, 12);
    this.crowd = this.people(0.85, 2601 + cfg.id.length, { phones: 0.25, clothes: ['#f2f2f2', '#101114', cfg.colors[0], cfg.colors[1], '#2b2d33', '#16171a'] });
    if (has('uv')) this.crowd.uv = 1;
  }

  prerender(renderer: THREE.WebGLRenderer, dt: number): void {
    this.probe?.update(renderer, this.sceneRoot(), dt);
  }

  protected onAction(id: string): void {
    if (id === 'flash') this.flashT = 0;
  }

  protected tick(s: ShowState, f: Features, dt: number): void {
    const u = this.mat.uniforms;
    const mode = this.look.mode;
    // colours: yours, or the mode's take on them
    const cols = this.palette.map((c, i) => {
      const out = c.clone();
      if (mode === 1) out.lerp(new THREE.Color(0xff8a2a), 0.5);
      else if (mode === 2) out.lerp(new THREE.Color(0x3a8aff), 0.5);
      else if (mode === 3) out.setHSL((this.time * 0.05 + i / 3) % 1, 0.8, 0.55);
      if (this.look.hue > 0.01) out.offsetHSL(this.look.hue, 0, 0);
      return out;
    });
    (u.uC0.value as THREE.Color).copy(cols[0]);
    (u.uC1.value as THREE.Color).copy(cols[1]);
    (u.uC2.value as THREE.Color).copy(cols[2]);
    this.spin += (this.on('spin') ? 0.4 : 0.05) * dt;
    this.flashT += dt;
    u.uSpin.value = this.spin;
    u.uTime.value = this.time;
    u.uBeat.value = s.beat;
    u.uKick.value = s.kick;
    u.uInvert.value = this.on('invert') ? 1 : 0;
    u.uFlash.value = Math.max(0, 1 - this.flashT * 4) + s.flash * 0.5;
    const storm = this.on('storm') ? 1 : 0;
    const calm = this.momentK('calm');
    u.uMoment.value = Math.max(this.momentK('burst'), this.momentK('storm'), storm * 0.6) * (1 - calm);
    (u.uDrive.value as THREE.Vector3).set(this.drive.floor, this.drive.walls, this.drive.ceil).multiplyScalar(1 - calm * 0.6);
    u.uVis.value = this.visMat.map;
    // pins push out with the spectrum, banded down the room
    if (this.pins) {
      const sp = f.spectrum;
      for (let i = 0; i < this.pinCells.length; i++) {
        const c = this.pinCells[i];
        const bin = sp ? sp[Math.min(sp.length - 1, 2 + c.band * 6 + Math.floor((c.y / this.H) * 8))] ?? 0 : 0;
        const out = 0.05 + bin * (0.6 + this.drive.walls) * 1.2 + storm * 0.3;
        this.dummy.position.set(c.x - c.side * out * 0.5, c.y, c.z);
        this.dummy.scale.set(out, 1, 1);
        this.dummy.updateMatrix();
        this.pins.setMatrixAt(i, this.dummy.matrix);
      }
      this.pins.instanceMatrix.needsUpdate = true;
    }
    // rain falls; a strobe or a flash freezes it in the air
    if (this.rain && this.rainV) {
      const frozen = s.flash > 0.3 || this.flashT < 0.25;
      const p = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const a = p.array as Float32Array;
      if (!frozen) {
        for (let i = 0; i < RAIN; i++) {
          a[i * 3 + 1] -= this.rainV[i] * dt * (1 + storm);
          if (a[i * 3 + 1] < 0) a[i * 3 + 1] += this.H;
        }
        p.needsUpdate = true;
      }
      (this.rain.material as THREE.PointsMaterial).color.copy(cols[2]).lerp(new THREE.Color(1, 1, 1), 0.6);
    }
    if (this.beams) {
      (this.beams.uniforms.uColor.value as THREE.Color).copy(cols[0]);
      this.beams.uniforms.uGain.value = (0.6 + this.drive.walls * 1.4 + storm) * (0.4 + 0.6 * s.master);
    }
    if (this.sculpture) {
      this.sculpture.group.rotation.y += dt * (0.2 + storm);
      this.sculpture.group.rotation.x = Math.sin(this.time * 0.3) * 0.4;
      this.sculpture.mats.forEach((m, i) => {
        (m.uniforms.uColor.value as THREE.Color).copy(cols[i % 3]);
        m.uniforms.uGain.value = (0.8 + this.drive.ceil * 1.5 + this.momentK('burst') * 2) * (0.4 + 0.6 * s.master);
      });
    }
    this.fogDensity = (this.cfg.extras.includes('fog') ? 0.07 : 0.015) * (1 + storm * 0.6);
    this.lookUp = Math.min(1, this.momentK() * 0.8 + (this.sculpture ? 0.3 : 0));
  }

  dispose(): void {
    this.probe?.dispose();
    super.dispose();
  }
}

/** a saved room as a venue for the venue list */
export function customVenue(cfg: CustomRoomConfig): VenueDef {
  return {
    id: customVenueId(cfg),
    name: cfg.name,
    short: cfg.name.slice(0, 12),
    place: 'Your room',
    kind: 'Crazy room (yours)',
    blurb: `${PART_LABEL[cfg.walls]} walls, ${PART_LABEL[cfg.floor].toLowerCase()} floor, ${PART_LABEL[cfg.ceiling].toLowerCase()} ceiling${cfg.extras.length ? `, ${cfg.extras.map((e) => PART_LABEL[e].toLowerCase()).join(', ')}` : ''}.`,
    palette: cfg.colors,
    ui: cfg.colors[0],
    capacity: cfg.size === 'small' ? '150' : cfg.size === 'medium' ? '300' : '600',
    build: () => new CustomRoom(cfg),
    thumb(g, w, h) {
      g.fillStyle = '#06060a';
      g.fillRect(0, 0, w, h);
      // a little room in perspective, in the room's colours
      g.fillStyle = cfg.walls === 'mirror' ? '#8a93a6' : cfg.walls === 'dark' ? '#16161c' : cfg.colors[0];
      g.globalAlpha = 0.55;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w * 0.3, h * 0.3);
      g.lineTo(w * 0.3, h * 0.7);
      g.lineTo(0, h);
      g.fill();
      g.beginPath();
      g.moveTo(w, 0);
      g.lineTo(w * 0.7, h * 0.3);
      g.lineTo(w * 0.7, h * 0.7);
      g.lineTo(w, h);
      g.fill();
      g.fillStyle = cfg.colors[1];
      g.beginPath();
      g.moveTo(0, h);
      g.lineTo(w * 0.3, h * 0.7);
      g.lineTo(w * 0.7, h * 0.7);
      g.lineTo(w, h);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = cfg.colors[2];
      g.font = '700 14px sans-serif';
      g.textAlign = 'center';
      g.fillText(cfg.name.slice(0, 18), w / 2, h * 0.53);
    },
  };
}
