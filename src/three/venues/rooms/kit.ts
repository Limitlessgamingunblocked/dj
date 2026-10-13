/*
 * The crazy rooms' shared engine. Every crazy room is a venue (VenueBase)
 * where the room itself is the light show, and they all work the same way:
 *
 *   stems    the music drives the room's surfaces: by default the drums drive
 *            the floor, the melody the walls and the vocals the ceiling
 *            (Show tab → Room: swap them, or let the drums drive it all)
 *   actions  a pad bank plays the room itself (the mirrors spin, the LED
 *            floor drops, the cage closes): the Show tab's Room pads, the
 *            room.pad.1–8 controls (keys and MIDI learn), 1–6 for the room's
 *            actions and 7–8 to recall scene slots A and B
 *   looks    each room has a few modes, a colour shift and a level; a look
 *            saves to one of four scene slots and recalls on a pad or, armed,
 *            on the next drop
 *   moments  what the room does on a drop: picked by the music (Auto) or
 *            chosen beforehand. A chosen moment that suits the drop (a big
 *            moment on a high-energy drop, a deep one on a softer one) scores
 *            in a gig
 *   crowd    people look up and point when the room moves, cheer and film
 *            its moments
 *
 * roomShow is the shared state between the room, the app and the Show tab;
 * the pure helpers (routeStems, pickMoment, the look store) are tested.
 */
import * as THREE from 'three';
import type { Features } from '../../../visualizer/AudioFeatures';
import type { Parts } from '../../../visualizer/parts';
import { loadSetting, saveSetting } from '../../../core/settings';
import { VenueBase, type VenueViews } from '../base';
import { booth, Crowd, crowdArea, TABLE_Y } from '../fixtures';
import type { CrowdOptions, CrowdSpot } from '../crowd';
import { moments } from '../moments';
import type { ShowState } from '../show';
import type { NameStyle } from '../../../name/NameService';

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------ */
/* the shared state                                                     */
/* ------------------------------------------------------------------ */

export type Routing = 'stems' | 'swap' | 'drums';
export type ActionKind = 'hit' | 'toggle' | 'hold';

export interface RoomAction {
  id: string;
  label: string;
  kind: ActionKind;
}

export interface RoomMoment {
  id: string;
  label: string;
  /** 'big' suits a high-energy drop, 'deep' a softer one */
  energy: 'big' | 'deep';
}

export interface RoomLook {
  /** which of the room's modes */
  mode: number;
  /** colour shift round the wheel, 0..1 */
  hue: number;
  /** how hard the room works, 0.2..1.5 */
  level: number;
  /** the toggle actions that are on */
  toggles: string[];
}

export interface RoomMomentEvent {
  room: string;
  moment: string;
  label: string;
  /** chosen beforehand (not Auto) */
  chosen: boolean;
  /** a chosen moment that suits the drop's energy */
  matched: boolean;
}

/** the room's controls as the app, the pads and the Show tab see them */
export interface RoomControls {
  readonly roomId: string;
  readonly roomName: string;
  readonly modes: string[];
  readonly actions: RoomAction[];
  readonly moments: RoomMoment[];
  look: RoomLook;
  /** is this action on (a toggle that's on, a hold that's held, a hit just fired) */
  active(id: string): boolean;
  /** set the look (a scene recalled, the Show tab) */
  setLook(l: RoomLook): void;
  /** start one of the room's moments now */
  startMoment(id: string, len?: number): void;
}

const momentListeners = new Set<(e: RoomMomentEvent) => void>();
const changeListeners = new Set<() => void>();

const pressListeners = new Set<(id: string, from: 'you' | 'rival') => void>();
const popListeners = new Set<(label: string, points: number, bad: boolean) => void>();

export const roomShow = {
  /** the crazy room that's up now (null in an ordinary venue) */
  current: null as RoomControls | null,
  /** the track's key, for the rooms that play notes (pitch class 0..11) */
  key: { tonic: 9, minor: true },
  /** 0..1: how much the DJ is breaking the music up (scratching, echo, a stutter loop): the Glitch Room */
  glitch: 0,
  /** actions pressed since the room last looked */
  queue: [] as string[],
  /** actions held down */
  held: new Set<string>(),
  /** 'auto' or one of the room's moment ids */
  dropMoment: 'auto',
  routing: 'stems' as Routing,
  /** a scene slot to recall on the next drop (-1 none) */
  armed: -1,
  /** the rooms' own sounds (the light grid's notes) */
  sounds: true,
  /** plays a note (midi number, 0..1): the app wires it to the audio output */
  note: null as ((midi: number, vel: number) => void) | null,
  /** a Room Battle: the actions that are yours to play (null: all of them) */
  owned: null as string[] | null,
  onMoment(fn: (e: RoomMomentEvent) => void): () => void {
    momentListeners.add(fn);
    return () => momentListeners.delete(fn);
  },
  emitMoment(e: RoomMomentEvent): void {
    for (const fn of momentListeners) fn(e);
  },
  /** the room changed (built, gone, its look recalled): the Show tab redraws */
  onChange(fn: () => void): () => void {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  },
  changed(): void {
    for (const fn of changeListeners) fn();
  },
  /** press an action (pads, keys, MIDI, the Show tab; the Room Battle's rival). False if it isn't yours to press. */
  press(id: string, from: 'you' | 'rival' = 'you'): boolean {
    if (from === 'you' && this.owned && !this.owned.includes(id)) return false;
    this.queue.push(id);
    this.held.add(id);
    for (const fn of pressListeners) fn(id, from);
    return true;
  },
  /** a scored moment in the mix (a transition, a drop, a mistake): the arcade's score counter pops */
  pop(label: string, points: number, bad = false): void {
    for (const fn of popListeners) fn(label, points, bad);
  },
  onPop(fn: (label: string, points: number, bad: boolean) => void): () => void {
    popListeners.add(fn);
    return () => popListeners.delete(fn);
  },
  /** hear every press that went through (the Room Battle scores yours) */
  onPress(fn: (id: string, from: 'you' | 'rival') => void): () => void {
    pressListeners.add(fn);
    return () => pressListeners.delete(fn);
  },
  release(id: string): void {
    this.held.delete(id);
  },
};

/* ------------------------------------------------------------------ */
/* pure helpers                                                         */
/* ------------------------------------------------------------------ */

export interface Drive {
  floor: number;
  walls: number;
  ceil: number;
}

type StemIn = Pick<Parts, 'drums' | 'melody'> | undefined;

/** what drives the floor, the walls and the ceiling, from the music's parts */
export function routeStems(parts: StemIn, s: Pick<ShowState, 'kick' | 'level' | 'vocal' | 'high'>, routing: Routing): Drive {
  const drums = parts ? parts.drums : Math.min(1, s.kick * 0.8 + s.level * 0.3);
  const melody = parts ? parts.melody : Math.min(1, s.high * 0.6 + s.level * 0.4);
  const vocal = s.vocal;
  if (routing === 'swap') return { floor: melody, walls: vocal, ceil: drums };
  if (routing === 'drums') return { floor: drums, walls: drums, ceil: drums };
  return { floor: drums, walls: melody, ceil: vocal };
}

/** the drop's moment: the chosen one, or (Auto) one that suits the drop; and whether a chosen one suits it */
export function pickMoment(list: RoomMoment[], chosen: string, energy: number, n = 0): { moment: RoomMoment; chosen: boolean; matched: boolean } | null {
  if (!list.length) return null;
  const big = energy > 0.6;
  const pick = list.find((m) => m.id === chosen);
  if (pick) return { moment: pick, chosen: true, matched: (pick.energy === 'big') === big };
  const fit = list.filter((m) => (m.energy === 'big') === big);
  const pool = fit.length ? fit : list;
  return { moment: pool[n % pool.length], chosen: false, matched: false };
}

export const DEFAULT_LOOK: RoomLook = { mode: 0, hue: 0, level: 1, toggles: [] };

/** a look loaded or imported: always complete and in range */
export function cleanLook(raw: unknown, modes: number): RoomLook {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    mode: Math.round(num(r.mode, 0, Math.max(0, modes - 1), 0)),
    hue: num(r.hue, 0, 1, 0),
    level: num(r.level, 0.2, 1.5, 1),
    toggles: Array.isArray(r.toggles) ? r.toggles.filter((t): t is string => typeof t === 'string').slice(0, 12) : [],
  };
}

export const SCENE_SLOTS = 4;

/** the room's four scene slots (null: empty) */
export function loadScenes(room: string, modes: number): (RoomLook | null)[] {
  const raw = loadSetting<unknown[]>(`roomScenes:${room}`, []);
  return Array.from({ length: SCENE_SLOTS }, (_, i) => (raw && raw[i] ? cleanLook(raw[i], modes) : null));
}

export function saveScene(room: string, slot: number, look: RoomLook | null, modes: number): void {
  const list = loadScenes(room, modes);
  list[slot] = look ? cleanLook(look, modes) : null;
  saveSetting(`roomScenes:${room}`, list);
}

/* ------------------------------------------------------------------ */
/* shared pieces                                                        */
/* ------------------------------------------------------------------ */

/**
 * A mirror's view of the room: the scene rendered into a cube from one point
 * and looked up as if from the surface (box- or sphere-projected), so flat
 * mirrors and domes show the room in the right place. The cube ping-pongs
 * between two targets and the mirrors are in it, so each update adds one
 * more bounce: mirrors facing mirrors go on forever, dimming as they go.
 */
export class MirrorProbe {
  readonly uniforms = {
    uCube: { value: null as THREE.CubeTexture | null },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxMax: { value: new THREE.Vector3() },
    uProbe: { value: new THREE.Vector3() },
    uSphere: { value: 0 },
  };
  private rts: [THREE.WebGLCubeRenderTarget, THREE.WebGLCubeRenderTarget];
  private cams: [THREE.CubeCamera, THREE.CubeCamera];
  private flip = 0;
  private age = 1;

  constructor(size: number, center: THREE.Vector3, box: THREE.Box3, sphereRadius = 0) {
    const opts = { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter } as const;
    this.rts = [new THREE.WebGLCubeRenderTarget(size, opts), new THREE.WebGLCubeRenderTarget(size, opts)];
    this.cams = [new THREE.CubeCamera(0.1, 120, this.rts[0]), new THREE.CubeCamera(0.1, 120, this.rts[1])];
    for (const c of this.cams) c.position.copy(center);
    this.uniforms.uProbe.value.copy(center);
    this.uniforms.uBoxMin.value.copy(box.min);
    this.uniforms.uBoxMax.value.copy(box.max);
    this.uniforms.uSphere.value = sphereRadius;
    this.uniforms.uCube.value = this.rts[1].texture;
  }

  /** render the room into the back cube (every `every` seconds), then show it */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, dt: number, every = 1 / 30): void {
    this.age += dt;
    if (this.age < every) return;
    this.age = 0;
    const i = this.flip;
    const prev = renderer.getRenderTarget();
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.cams[i].update(renderer, scene as THREE.Scene);
    renderer.shadowMap.autoUpdate = auto;
    renderer.setRenderTarget(prev);
    this.uniforms.uCube.value = this.rts[i].texture;
    this.flip = 1 - i;
  }

  dispose(): void {
    for (const r of this.rts) r.dispose();
  }
}

/** GLSL: look a reflected ray up in a MirrorProbe (box- or sphere-projected) */
export const PROBE_GLSL = /* glsl */ `
  uniform samplerCube uCube;
  uniform vec3 uBoxMin, uBoxMax, uProbe;
  uniform float uSphere;
  vec3 probeDir(vec3 pos, vec3 dir) {
    if (uSphere > 0.0) {
      vec3 o = pos - uProbe;
      float b = dot(o, dir);
      float c = dot(o, o) - uSphere * uSphere;
      float t = -b + sqrt(max(0.0, b * b - c));
      return o + dir * t;
    }
    vec3 t1 = (uBoxMax - pos) / dir;
    vec3 t2 = (uBoxMin - pos) / dir;
    vec3 tf = max(t1, t2);
    float t = min(min(tf.x, tf.y), tf.z);
    return pos + dir * t - uProbe;
  }
  vec3 probe(vec3 pos, vec3 dir) { return textureCube(uCube, probeDir(pos, dir)).rgb; }
`;

/** GLSL: hue rotation */
export const HUE_GLSL = /* glsl */ `
  vec3 hueShift(vec3 c, float h) {
    const vec3 k = vec3(0.57735);
    float a = h * 6.2831853;
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
  }
  vec3 hsv(float h, float s, float v) {
    vec3 p = abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
  }
`;

/** a 256-wide float texture of the spectrum (x 0..255) and the waveform (row 1), for the room shaders */
export class AudioTexture {
  readonly texture: THREE.DataTexture;
  private data = new Float32Array(256 * 2 * 4);

  constructor() {
    this.texture = new THREE.DataTexture(this.data, 256, 2, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  update(f: Features): void {
    const d = this.data;
    const sp = f.spectrum;
    const wf = f.waveform;
    for (let i = 0; i < 256; i++) {
      const v = sp ? sp[i] ?? 0 : 0;
      // ease the spectrum so columns and pins move smoothly
      d[i * 4] += (v - d[i * 4]) * 0.35;
      d[i * 4 + 1] = v;
      const w = wf ? wf[i * 2] ?? 0 : 0;
      d[(256 + i) * 4] = w;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** a soft additive glow material (beams, rings, holograms' edges): brightest along the middle of a tube or quad */
export function glowMaterial(color = new THREE.Color(1, 1, 1)): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uGain;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(uColor * uGain * pow(f, 2.5), 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/* ------------------------------------------------------------------ */
/* the base room                                                        */
/* ------------------------------------------------------------------ */

export interface CrazyRoomOptions {
  roomId: string;
  roomName: string;
  /** half-width, height, depth (in front of the booth) and depth behind it */
  w: number;
  h: number;
  d: number;
  back?: number;
  fog: number;
  fogDensity: number;
  hemi?: number;
  hemiSky?: number;
  hemiGround?: number;
  booth?: { strip?: string | null; front?: THREE.Material; name?: NameStyle };
}

const HIT_FLASH = 0.25;

export abstract class CrazyRoom extends VenueBase implements RoomControls {
  readonly roomId: string;
  readonly roomName: string;
  abstract readonly modes: string[];
  abstract readonly actions: RoomAction[];
  abstract readonly moments: RoomMoment[];
  look: RoomLook = { ...DEFAULT_LOOK, toggles: [] };
  readonly views: VenueViews;
  /** how much of the stage's own soft light reaches the room (a blacklight room wants almost none) */
  ambient = 1;
  /** the room's box */
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly h: number;
  /** the music driving the floor, walls and ceiling (0..1, eased) */
  protected drive: Drive = { floor: 0, walls: 0, ceil: 0 };
  /** the music's parts this frame */
  protected parts: Parts | undefined;
  /** the show's colours, shifted by the look's colour */
  protected cols: [THREE.Color, THREE.Color, THREE.Color] = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  /** a moment under way: which, how long it's been going, how long it lasts */
  protected moment: { id: string; t: number; len: number } | null = null;
  protected crowds: Crowd[] = [];
  /** how much the room is moving overhead right now: heads go up (0..1) */
  protected lookUp = 0;
  protected time = 0;
  private hits = new Map<string, number>();
  private dropN = 0;
  private lookK = 0;
  private reacting = 0;

  constructor(o: CrazyRoomOptions) {
    super({ fog: o.fog, fogDensity: o.fogDensity, hemiSky: o.hemiSky ?? 0x202030, hemiGround: o.hemiGround ?? 0x080810, hemi: o.hemi ?? 0.25, flashAt: V(0, o.h - 0.5, -o.d / 2), flashRange: o.d * 1.5 });
    this.roomId = o.roomId;
    this.roomName = o.roomName;
    this.x0 = -o.w;
    this.x1 = o.w;
    this.z0 = -o.d;
    this.z1 = o.back ?? 3;
    this.h = o.h;
    this.keyLight = { color: 0xf0f0ff, intensity: 8 };
    const w = o.w;
    const d = o.d;
    const h = o.h;
    this.views = {
      wide: { pos: V(-w * 0.75, h * 0.55, -d * 0.85), target: V(0, 1.4, -1) },
      wideLabel: 'Back of the room',
      director: {
        style: 'festival',
        scale: Math.min(4, d * 0.4),
        landmarks: [
          { label: 'The room', from: { pos: V(w * 0.8, h * 0.75, -d * 0.15), target: V(-w * 0.3, h * 0.3, -d * 0.8) }, to: { pos: V(w * 0.7, h * 0.7, -d * 0.3), target: V(-w * 0.5, h * 0.3, -d * 0.6) }, fov: 50 },
          { label: 'Up at the ceiling', from: { pos: V(-w * 0.4, 1.4, -d * 0.7), target: V(0, h, -d * 0.35) }, to: { pos: V(-w * 0.2, 1.4, -d * 0.75), target: V(w * 0.2, h, -d * 0.3) }, fov: 56 },
        ],
      },
      crowd: { pos: V(0.8, 1.6, -d * 0.35), target: V(0, 1.5, 0.4) },
      drone: [V(0, h * 0.6, -d * 0.9), V(w * 0.7, h * 0.55, -d * 0.6), V(w * 0.6, h * 0.5, -d * 0.15), V(0, h * 0.55, -1.5), V(-w * 0.6, h * 0.5, -d * 0.15), V(-w * 0.7, h * 0.55, -d * 0.6)],
      extra: {
        // straight down from the middle of the ceiling: the room as a pattern
        rig: { pos: V(0, h - 0.4, -d * 0.45), target: V(0, 0, -d * 0.45 - 0.01) },
        cctv: { pos: V(w - 0.4, h - 0.4, -d + 0.4), target: V(0, 1, -d * 0.3) },
        crane: { radius: 4, low: 1.4, high: Math.min(h - 0.6, 5) },
      },
    };
    if (o.booth !== undefined) {
      const b = booth({ w: 2.6, d: 0.9, strip: o.booth.strip ?? '#ffffff', front: o.booth.front, name: o.booth.name });
      this.group.add(b.group);
      this.strip(b.strip);
    }
    roomShow.current = this;
    // the room remembers the look it had
    this.look = cleanLook(loadSetting<unknown>(`roomLook:${o.roomId}`, null), 99);
    queueMicrotask(() => {
      this.look = cleanLook(this.look, this.modes.length);
      roomShow.changed();
    });
  }

  /** a crowd that reacts to the room (updated here, not as a plain fixture) */
  protected people(density: number, seed: number, o: CrowdOptions & { area?: [number, number, number, number]; y?: number; spots?: CrowdSpot[] } = {}): Crowd {
    const [ax0, ax1, az0, az1] = o.area ?? [this.x0 + 1, this.x1 - 1, -1.6, this.z0 + 1.4];
    const c = new Crowd(o.spots ?? crowdArea(ax0, ax1, az0, az1, density, seed, { y: o.y ?? 0 }), { seed, ...o });
    this.crowds.push(c);
    this.group.add(c.object);
    return c;
  }

  /* ---------------- controls ---------------- */

  active(id: string): boolean {
    const a = this.actions.find((x) => x.id === id);
    if (!a) return false;
    if (a.kind === 'toggle') return this.look.toggles.includes(id);
    if (a.kind === 'hold') return roomShow.held.has(id);
    return this.since(id) < HIT_FLASH;
  }

  /** seconds since a hit action was pressed (Infinity: never) */
  protected since(id: string): number {
    const t = this.hits.get(id);
    return t === undefined ? Infinity : this.time - t;
  }

  /** a toggle that's on, or a hold that's held */
  protected on(id: string): boolean {
    return this.look.toggles.includes(id) || roomShow.held.has(id);
  }

  /** 0..1 envelope of a moment that's playing (a quick rise, a hold, a slow fall) */
  protected momentK(id?: string): number {
    const m = this.moment;
    if (!m || (id && m.id !== id)) return 0;
    const rise = Math.min(1, m.t / 0.35);
    const fall = Math.min(1, Math.max(0, (m.len - m.t) / 1.2));
    return rise * fall;
  }

  /** set the look (a scene recalled, the Show tab), and remember it */
  setLook(l: RoomLook): void {
    this.look = cleanLook(l, this.modes.length);
    saveSetting(`roomLook:${this.roomId}`, this.look);
    roomShow.changed();
  }

  /** start a moment now (a drop, a pad, the Room Battle's rival) */
  startMoment(id: string, len = 8): void {
    const m = this.moments.find((x) => x.id === id);
    if (!m) return;
    this.moment = { id, t: 0, len };
    this.reacting = 1;
    moments.emit({ venue: this.roomId, label: `${this.roomName}: ${m.label}`, crowd: 'whoa' });
  }

  private press(id: string): void {
    const a = this.actions.find((x) => x.id === id);
    if (!a) return;
    if (a.kind === 'toggle') {
      const on = this.look.toggles.includes(id);
      this.look = { ...this.look, toggles: on ? this.look.toggles.filter((t) => t !== id) : [...this.look.toggles, id] };
      saveSetting(`roomLook:${this.roomId}`, this.look);
      roomShow.changed();
    }
    this.hits.set(id, this.time);
    this.reacting = Math.max(this.reacting, 0.6);
    this.onAction(id);
  }

  /** a room's own response to an action being pressed */
  protected onAction(_id: string): void {}

  /* ---------------- frame ---------------- */

  update(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void {
    super.update(s, f, dt, camera);
    this.time += dt;
    this.parts = f.parts;
    const want = routeStems(f.parts, s, roomShow.routing);
    const k = Math.min(1, dt * 10);
    const lvl = this.look.level;
    this.drive.floor += (want.floor * lvl - this.drive.floor) * k;
    this.drive.walls += (want.walls * lvl - this.drive.walls) * k;
    this.drive.ceil += (want.ceil * lvl - this.drive.ceil) * k;
    for (let i = 0; i < 3; i++) {
      const hsl = { h: 0, s: 0, l: 0 };
      s.colors[i].getHSL(hsl);
      this.cols[i].setHSL((hsl.h + this.look.hue) % 1, hsl.s, hsl.l);
    }
    // pads pressed since the last frame
    if (roomShow.current === this)
      while (roomShow.queue.length) {
        const id = roomShow.queue.shift()!;
        if (!id.startsWith('scene:')) this.press(id);
      }
    // the drop: the chosen (or a fitting) moment, and an armed scene
    if (s.dropHit && s.playing) {
      const pick = pickMoment(this.moments, roomShow.dropMoment, s.energy, this.dropN++);
      if (pick) {
        this.startMoment(pick.moment.id, 8);
        roomShow.emitMoment({ room: this.roomId, moment: pick.moment.id, label: pick.moment.label, chosen: pick.chosen, matched: pick.matched });
      }
      if (roomShow.armed >= 0) {
        const sc = loadScenes(this.roomId, this.modes.length)[roomShow.armed];
        if (sc) this.setLook(sc);
        roomShow.armed = -1;
        roomShow.changed();
      }
    }
    if (this.moment) {
      this.moment.t += dt;
      if (this.moment.t > this.moment.len) this.moment = null;
    }
    this.tick(s, f, dt, camera);
    // the crowd: heads up while the room moves overhead, arms up and phones out for its moments
    this.reacting = Math.max(0, this.reacting - dt * 0.5);
    const lookWant = Math.min(1, Math.max(this.lookUp, this.momentK() * 0.9, this.reacting * 0.7));
    this.lookK += (lookWant - this.lookK) * Math.min(1, dt * 2.5);
    const react: ShowState = { ...s, accent: Math.max(s.accent, this.reacting > 0.95 ? 1 : 0), photos: Math.max(s.photos, this.momentK() * 0.7) };
    for (const c of this.crowds) {
      c.look = this.lookK * (s.playing ? 1 : 0.3);
      c.update(react, dt, camera);
    }
  }

  /** the room's own frame: its surfaces, effects and moments */
  protected abstract tick(s: ShowState, f: Features, dt: number, camera: THREE.Camera): void;

  /** the scene the room is part of (for the mirror probes) */
  protected sceneRoot(): THREE.Object3D {
    let o: THREE.Object3D = this.group;
    while (o.parent) o = o.parent;
    return o;
  }

  dispose(): void {
    if (roomShow.current === this) {
      roomShow.current = null;
      roomShow.held.clear();
      roomShow.queue.length = 0;
      queueMicrotask(() => roomShow.changed());
    }
    for (const c of this.crowds) c.dispose?.();
    super.dispose();
  }
}

/** the booth's height, for rooms that hang things over it */
export const BOOTH_Y = TABLE_Y;
