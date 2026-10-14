/*
 * The main LED wall's drop show. On a drop at a venue with a big wall, the
 * wall does one of two things:
 *   – the box: the wall becomes a window into a deep box that really is
 *     behind it. Glowing grid lines in the show's colours line its inside, a
 *     pulse runs from the back to the front on every beat, a few cubes turn
 *     slowly in it, and the visual player plays faintly on its back face. A
 *     giant chrome blob pushes out through the wall over a beat and a half,
 *     hangs over the front of the room for eight bars, wobbling with the
 *     kick and reflecting the room, then sinks back into the box.
 *   – the tiles: the wall is cut into panels of about 1.5 m, each still
 *     playing its own piece of the picture with the LED look. They blow apart
 *     towards the crowd and tumble, showing their dark cabinet backs, then
 *     fly back together into a flat wall over two bars. In a high-energy
 *     groove after a drop the panels ripple gently like a flag, a little wave
 *     crossing the wall on every beat.
 * Between drops the wall is the visual player as before.
 *
 * Each venue has a default (its wall's character); the other one comes as a
 * surprise every third drop. The lighting desk can pin one or turn them off
 * (Show → LED wall: Auto / Box / Tiles / Off).
 *
 * How the box shows through the wall: the box (and the blob and cubes) is
 * drawn before the rest of the room, then the wall's own plane writes only
 * depth there (its picture fading out), so nothing behind the wall (the
 * room's back wall, a frame, the sky) can draw over the window, while
 * everything in front of it (the crowd, the rig, the haze) still does. The
 * box is real geometry, so it holds from every angle, and so is the blob.
 * The blob is sized and placed for each room (fitBlob): well above the raised
 * hands, under the rig, and short of whatever stands in front of the wall.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShowState } from './show';
import { fxTier } from '../fx';
import { ledScreen } from './led';
import type { Fixture } from './fixtures';

export type WallMode = 'auto' | 'box' | 'tiles' | 'off';
export type WallFx = 'box' | 'tiles';
export const WALL_MODES: { id: WallMode; name: string }[] = [
  { id: 'auto', name: 'Auto' },
  { id: 'box', name: 'Box' },
  { id: 'tiles', name: 'Tiles' },
  { id: 'off', name: 'Off' },
];
export const isWallMode = (v: unknown): v is WallMode => WALL_MODES.some((m) => m.id === v);

/* ------------------------------------------------------------------ */
/* timing (in beats from the drop)                                      */
/* ------------------------------------------------------------------ */

/** the box: the window opens, the blob pushes out, hangs, sinks back, the window closes */
export const BOX_BEATS = { open: 0.5, push: 1.5, hold: 32, sink: 4, close: 1 };
export const BOX_END = BOX_BEATS.hold + BOX_BEATS.sink + BOX_BEATS.close;
/** the tiles: they burst out, drift and tumble, then fly home */
export const TILE_BEATS = { burst: 1, drift: 6, back: 8 };
export const TILES_END = TILE_BEATS.drift + TILE_BEATS.back;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** ease out with a little overshoot: the blob pushes past its spot and settles back */
const backOut = (x: number) => {
  const t = clamp01(x) - 1;
  const c = 1.70158;
  return 1 + (c + 1) * t * t * t + c * t * t;
};

/** The box at `b` beats after its drop: how open the window is, and how far out the blob is (0 in the box, 1 hanging, a little over 1 as it overshoots). */
export function boxAt(b: number): { open: number; out: number } {
  const B = BOX_BEATS;
  if (!(b >= 0) || b >= BOX_END) return { open: 0, out: 0 };
  const shut = B.hold + B.sink;
  const open = b < B.open ? smooth(b / B.open) : b > shut ? 1 - smooth((b - shut) / B.close) : 1;
  const out = b < B.push ? backOut(b / B.push) : b < B.hold ? 1 : 1 - smooth((b - B.hold) / B.sink);
  return { open, out };
}

/** The tiles at `b` beats after the drop: how far out they are (0 home, ~1 at full spread) and how far round their tumble (0..1 of their whole turns). */
export function tilesAt(b: number): { out: number; turn: number } {
  const T = TILE_BEATS;
  if (!(b >= 0) || b >= TILES_END) return { out: 0, turn: 0 };
  let out: number;
  if (b < T.burst) out = 1 - Math.pow(1 - b / T.burst, 3);
  else if (b < T.drift) out = 1 + 0.12 * ((b - T.burst) / (T.drift - T.burst));
  else out = 1.12 * (1 - smooth((b - T.drift) / T.back));
  // fast as they blow apart, slowing to land flat after whole turns
  const turn = 1 - Math.pow(1 - b / TILES_END, 2.5);
  return { out: Math.max(0, out), turn };
}

/** What a drop plays: `n` is how many drops this venue has had (from 0). Auto plays the venue's own, and the other every third drop. */
export function pickWallFx(mode: WallMode, home: WallFx, n: number): WallFx | null {
  if (mode === 'off') return null;
  if (mode === 'box' || mode === 'tiles') return mode;
  return n % 3 === 2 ? (home === 'box' ? 'tiles' : 'box') : home;
}

export type WallInput = Pick<ShowState, 'dropHit' | 'playing' | 'bpm' | 'energy' | 'build' | 'peak'>;

/**
 * The wall show's timing: which effect is running and how far into it, in
 * beats (counted from the tempo, so a seek or a new track can't jump it), and
 * how much the tiles ripple. A drop while one is running doesn't restart it.
 * Turning the wall off or stopping the music winds it down (the blob sinks,
 * the tiles fly home) instead of cutting.
 */
export class WallDirector {
  fx: WallFx | null = null;
  /** beats since the running effect's drop */
  b = 0;
  /** drops seen at this venue */
  drops = 0;
  /** 0..1 how much the panels ripple (a high-energy groove after a drop) */
  ripple = 0;

  constructor(readonly home: WallFx) {}

  update(s: WallInput, mode: WallMode, dt: number): void {
    const bps = (s.bpm > 0 ? Math.min(200, Math.max(60, s.bpm)) : 120) / 60;
    if (this.fx) {
      this.b += dt * bps;
      if (mode === 'off' || !s.playing) this.windDown();
      if (this.b >= (this.fx === 'box' ? BOX_END : TILES_END)) {
        this.fx = null;
        this.b = 0;
      }
    }
    if (s.dropHit && !this.fx) {
      this.fx = pickWallFx(mode, this.home, this.drops);
      this.b = 0;
      this.drops++;
    }
    // a gentle ripple in a high-energy groove after the drop: not while the box is up, not in a build
    const want = this.fx === 'box' || mode === 'off' || mode === 'box' || !s.playing ? 0 : clamp01((s.energy - 0.5) / 0.3) * clamp01(s.peak) * (1 - clamp01(s.build * 2));
    if (this.fx === 'box') this.ripple = 0;
    else this.ripple += (want - this.ripple) * Math.min(1, dt * 1.5);
  }

  private windDown(): void {
    if (this.fx === 'box' && this.b < BOX_BEATS.hold) this.b = BOX_BEATS.hold;
    if (this.fx === 'tiles' && this.b < TILE_BEATS.drift) this.b = TILE_BEATS.drift;
  }
}

/* ------------------------------------------------------------------ */
/* layout                                                               */
/* ------------------------------------------------------------------ */

/** Cut a w × h metre wall into near-square panels of about `target` metres, at most `max` of them. */
export function tileLayout(w: number, h: number, target = 1.5, max = 240): { nx: number; ny: number; tw: number; th: number } {
  let t = target;
  for (;;) {
    const nx = Math.max(1, Math.round(w / t));
    const ny = Math.max(1, Math.round(h / t));
    if (nx * ny <= max || (nx === 1 && ny === 1)) return { nx, ny, tw: w / nx, th: h / ny };
    t *= 1.04;
  }
}

/** The room round a wall, in metres from the wall's centre (y up, z out into the room). */
export interface WallRoom {
  /** the raised hands under where the blob hangs (on a stage: the DJ's), height */
  hands: number;
  /** the lowest thing overhead there (the rig, a ceiling), height */
  top: number;
  /** how far out the blob may reach before the rig, a scrim or the front of the stage */
  reach: number;
}

/** clearance kept above the hands and under the rig, metres */
export const BLOB_CLEAR = 0.5;

/**
 * The biggest blob that fits the room (radius up to 0.42 of the wall's
 * height), centred a little above the wall's middle where it can be, hanging
 * out from the wall by up to 2.2 radii but never past `reach`. In a tight room
 * its centre stays behind the wall and it only bulges out. Null when there's
 * no room for one that would read (under 0.12 of the wall's height).
 */
export function fitBlob(h: number, room: WallRoom): { r: number; y: number; z: number } | null {
  const lo = room.hands + BLOB_CLEAR;
  const hi = room.top - BLOB_CLEAR;
  const r = Math.min(h * 0.42, (hi - lo) / 2);
  if (!(r >= h * 0.12)) return null;
  const y = Math.min(hi - r, Math.max(lo + r, h * 0.15));
  const z = Math.min(room.reach - r, 2.2 * r);
  return { r, y, z };
}

/** how deep the box behind a w × h wall is, metres */
export const boxDepth = (w: number, h: number) => Math.min(22, Math.max(6, 0.4 * w + 0.5 * h));

/* ------------------------------------------------------------------ */
/* the venues' main walls                                               */
/* ------------------------------------------------------------------ */

export interface WallSpec {
  /** the wall in metres, and its LED pitch */
  size: [number, number];
  pitch: number;
  /** the venue's own effect */
  home: WallFx;
  room: WallRoom;
  /** how far the panels fly out at most, metres */
  fly: number;
  /** the wall's LED brightness */
  gain?: number;
  /** the picture's crop on the wall (scale x, y, offset x, y), as the flat wall's UVs have it */
  crop?: [number, number, number, number];
  /** something dark behind the panels when they fly (an open-air wall has nothing behind it) */
  backing?: boolean;
}

const allyCrop = ((7 / 23) * 16) / 9;

/**
 * The five main walls. Heights are from each wall's centre: the hands are
 * the floor (or the stage, when the blob hangs over the DJ) plus 2.3 m; the
 * top is the rig's lowest fixtures (or the ceiling) where the blob hangs.
 */
export const MAIN_WALLS: Record<'deckhouse' | 'warehouse' | 'printworks' | 'festival' | 'allypally', WallSpec> = {
  // the house warehouse: a 6.4 m ceiling and a row of kinetic lights 1.2 m in front of the wall
  // from 3.9 m up, so the blob only bulges through the wall, and the panels are the house look
  deckhouse: { size: [11.2, 6.3], pitch: 0.0039, home: 'tiles', room: { hands: -1.6, top: 3.0, reach: 0.85 }, fly: 2.4 },
  // the rave's wall stands behind the stage: the blob hangs over the DJ, under the roof truss (heads at 9 m)
  warehouse: { size: [16, 7], pitch: 0.0039, home: 'box', room: { hands: -2.2, top: 4.1, reach: 6.5 }, fly: 4.5 },
  // Printworks' far wall: the floor 1.5 m down, ducts at 19 m, nothing in front but the bars
  printworks: { size: [26, 14.6], pitch: 0.0059, home: 'box', room: { hands: -8.2, top: 10, reach: 14 }, fly: 9 },
  // the festival's wall behind the booth: heads in the roof at 23 m, the hologram scrim 13.45 m out
  festival: { size: [38, 17], pitch: 0.0052, home: 'box', room: { hands: -7.4, top: 12.9, reach: 13 }, fly: 9, backing: true },
  // Alexandra Palace: the stage trusses' heads at 10 m, the blob out over the booth
  allypally: { size: [23, 7], pitch: 0.0039, home: 'tiles', room: { hands: -2.3, top: 5.5, reach: 9 }, fly: 6, gain: 1.45, crop: [1, allyCrop, 0, 0.5 - 0.5 * allyCrop] },
};

/* ------------------------------------------------------------------ */
/* shaders                                                              */
/* ------------------------------------------------------------------ */

const BOX_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vPos;
  varying vec3 vN;
  void main() {
    vPos = position;
    vN = normal;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const BOX_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uC0, uC1, uC2;
  uniform float uBeat, uKick, uFlash, uLevel, uDepth, uCell, uVisOn;
  uniform vec2 uSize;
  uniform vec4 uCrop;
  uniform sampler2D uVis;
  varying vec3 vPos;
  varying vec3 vN;
  void main() {
    vec3 n = abs(vN);
    // grid lines on the inner faces: a few centimetres wide up close, at least a pixel (and dimmer) far away
    vec3 g = vPos / uCell;
    vec3 fw = max(fwidth(g), vec3(1e-4));
    vec3 dist = 0.5 - abs(fract(g) - 0.5);
    const float W = 0.022;
    vec3 w = max(vec3(W), fw);
    vec3 cov = (1.0 - smoothstep(w - fw * 0.75, w + fw * 0.75, dist)) * (W / w) * (1.0 - n);
    float line = max(cov.x, max(cov.y, cov.z));
    float k = clamp(-vPos.z / uDepth, 0.0, 1.0);
    vec3 col = mix(uC0, uC1, k);
    // a pulse from the back to the front on every beat
    float zp = -uDepth * (1.0 - fract(uBeat) * 1.08);
    float pulse = exp(-abs(vPos.z - zp) / (uDepth * 0.035));
    vec3 pc = mix(col, uC2, 0.6) + 0.25;
    vec3 c = col * line * (0.6 + 0.7 * uKick + 2.2 * uFlash) + pc * line * pulse * 2.4;
    // the pulse lights the faces a little as it passes, and the back of the box glows
    c += pc * pulse * 0.05 + col * 0.012 * (0.4 + k);
    // the window's rim: a bright frame where the box meets the wall
    float rim = exp(vPos.z / (uCell * 0.18)) * (1.0 - n.z);
    c += mix(col, vec3(1.0), 0.45) * rim * (0.7 + 1.1 * uKick + 2.5 * uFlash);
    // the visual player, faint on the back face
    if (vN.z > 0.5) {
      vec2 uv = (vPos.xy / uSize + 0.5) * uCrop.xy + uCrop.zw;
      c += texture2D(uVis, uv).rgb * uVisOn * (0.2 + 0.12 * uKick);
    }
    c *= uLevel * mix(1.0, 0.6, k);
    gl_FragColor = vec4(clamp(c, 0.0, 6.0), 1.0);
    #include <fog_fragment>
  }
`;

/** the blob's wobble: a unit sphere's point pushed out by a few overlapping waves, harder while it moves and on the kick */
const BLOB_FN = /* glsl */ `
  uniform float uBlobT, uWob, uBlobKick;
  float blobD(vec3 p) {
    float t = uBlobT;
    float d = 0.07 * sin(p.x * 3.1 + t * 1.9) * sin(p.y * 3.7 - t * 1.3) * sin(p.z * 2.9 + t * 1.1);
    d += 0.035 * sin(p.y * 5.3 + p.x * 1.7 + t * 2.3);
    d += 0.025 * sin(p.z * 6.1 + p.y * 2.1 - t * 2.9);
    return d * (0.6 + 1.4 * uWob) + 0.045 * uBlobKick * (0.6 + 0.4 * sin(p.y * 4.0 + t * 5.0));
  }
  vec3 blobP(vec3 n) { return n * (1.0 + blobD(n)); }
`;

const BLOB_NORMAL = /* glsl */ `
  vec3 bn = normalize(position);
  vec3 bt = normalize(cross(bn, abs(bn.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 bb = cross(bn, bt);
  vec3 bp0 = blobP(bn);
  vec3 bp1 = blobP(normalize(bn + bt * 0.02));
  vec3 bp2 = blobP(normalize(bn + bb * 0.02));
  vec3 objectNormal = normalize(cross(bp1 - bp0, bp2 - bp0));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
`;

/** what the chrome reflects besides the environment map: the box's glow behind it, the rig overhead, bands of beams and a hot spot (world directions) */
const BLOB_ENV = /* glsl */ `
  uniform vec3 uE0, uE1, uE2, uBack, uSide;
  uniform float uEnvGain, uEnvT;
  vec3 blobEnv(vec3 r) {
    vec3 c = uE0 * pow(max(dot(r, uBack), 0.0), 3.0) * 1.3;
    c += uE1 * pow(max(r.y, 0.0), 4.0) * 0.9;
    c += uE2 * smoothstep(0.93, 1.0, sin(r.y * 9.0 + dot(r, uSide) * 3.0 + uEnvT * 0.7)) * 0.8;
    c += vec3(1.0) * smoothstep(0.94, 1.0, dot(r, normalize(vec3(0.35, 0.8, 0.45)))) * 1.6;
    // the room's own light: a bright upper half, the lit haze on the horizon, a dark floor
    c += mix(uE1, vec3(0.9, 0.92, 1.0), 0.6) * smoothstep(-0.02, 0.35, r.y) * 0.28;
    c += mix(uE0, vec3(1.0), 0.5) * exp(-abs(r.y - 0.04) * 22.0) * 0.9;
    c += vec3(0.02, 0.022, 0.03) * (1.0 - abs(r.y));
    return c * uEnvGain;
  }
`;

/* ------------------------------------------------------------------ */
/* the show on one wall                                                 */
/* ------------------------------------------------------------------ */

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** five planes facing into (or out of) a w × h × d box open at z = 0 */
function boxFaces(w: number, h: number, d: number, inward: boolean): THREE.BufferGeometry {
  const s = inward ? 1 : -1;
  const back = new THREE.PlaneGeometry(w, h).translate(0, 0, -d);
  const left = new THREE.PlaneGeometry(d, h).rotateY((s * Math.PI) / 2).translate(-w / 2, 0, -d / 2);
  const right = new THREE.PlaneGeometry(d, h).rotateY((-s * Math.PI) / 2).translate(w / 2, 0, -d / 2);
  const floor = new THREE.PlaneGeometry(w, d).rotateX((-s * Math.PI) / 2).translate(0, -h / 2, -d / 2);
  const ceil = new THREE.PlaneGeometry(w, d).rotateX((s * Math.PI) / 2).translate(0, h / 2, -d / 2);
  if (!inward) back.rotateY(Math.PI).translate(0, 0, -2 * d);
  return mergeGeometries([back, left, right, floor, ceil])!;
}

interface TileData {
  /** rest centre on the wall, metres */
  x: number;
  y: number;
  /** where it flies at full spread, metres from rest */
  dx: number;
  dy: number;
  dz: number;
  /** tumble axis; whole turns (a flip), or 0 to tilt by `tilt` radians as it flies and straighten coming home */
  axis: THREE.Vector3;
  turns: number;
  tilt: number;
}

interface TileSet {
  nx: number;
  ny: number;
  tw: number;
  th: number;
  tiles: TileData[];
}

const TILE_DEPTH = 0.09;
/** the panels' size: about 1.5 m, bigger (fewer of them) on Low */
export const TILE_SIZE = { normal: 1.5, low: 2.2 };

/**
 * The wall show on one venue's main wall: the box, the blob, the panels and
 * the director that times them. Lives in the wall's own frame (x right, y up,
 * z out of the wall into the room); `screen` is the venue's flat LED wall,
 * which it fades, masks or hides as the effects need.
 */
export class WallShow implements Fixture {
  readonly object = new THREE.Group();
  readonly director: WallDirector;
  readonly blobFit: { r: number; y: number; z: number } | null;
  readonly depth: number;
  private screenMat: THREE.MeshBasicMaterial;
  private screenOrder: number;
  private masking = false;
  private overlays: { o: THREE.Object3D; z: number }[];
  private w: number;
  private h: number;
  // the box
  private box = new THREE.Group();
  private boxU: Record<string, THREE.IUniform>;
  private cubes: THREE.InstancedMesh;
  private cubeEdge: { value: THREE.Color };
  private blobs: THREE.Mesh[] = [];
  private blobU: Record<string, THREE.IUniform>;
  private flash = 0;
  private prevOut = 0;
  // the panels
  readonly tilesMat: THREE.MeshBasicMaterial;
  private tiles: THREE.InstancedMesh;
  private tileC: THREE.InstancedBufferAttribute;
  private tileSize = { value: new THREE.Vector2(1, 1) };
  private sets: Record<'normal' | 'low', TileSet>;
  private set: TileSet | null = null;
  private backing: THREE.Mesh | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(
    private screen: THREE.Mesh,
    private spec: WallSpec,
  ) {
    const [w, h] = spec.size;
    this.w = w;
    this.h = h;
    this.director = new WallDirector(spec.home);
    this.blobFit = fitBlob(h, spec.room);
    this.depth = boxDepth(w, h);
    this.screenMat = screen.material as THREE.MeshBasicMaterial;
    this.screenOrder = screen.renderOrder;
    this.overlays = screen.children.map((o) => ({ o, z: o.position.z }));
    this.object.position.copy(screen.position);
    this.object.quaternion.copy(screen.quaternion);
    const crop = spec.crop ?? [1, 1, 0, 0];
    const D = this.depth;

    // the box: its inside lined with the grid, a dark shell round the outside (it hides the
    // inside from the floor's reflection, and from anywhere outside the building)
    this.boxU = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
      uC2: { value: new THREE.Color() },
      uBeat: { value: 0 },
      uKick: { value: 0 },
      uFlash: { value: 0 },
      uLevel: { value: 1 },
      uDepth: { value: D },
      uCell: { value: h / 6 },
      uVisOn: { value: 0 },
      uSize: { value: new THREE.Vector2(w, h) },
      uCrop: { value: new THREE.Vector4(...crop) },
      uVis: { value: null },
    };
    const inner = new THREE.Mesh(boxFaces(w, h, D, true), new THREE.ShaderMaterial({ uniforms: this.boxU, vertexShader: BOX_VERT, fragmentShader: BOX_FRAG, fog: true, toneMapped: false }));
    const shell = new THREE.Mesh(boxFaces(w + 0.3, h + 0.3, D + 0.15, false), new THREE.MeshBasicMaterial({ color: 0x010102, toneMapped: false }));
    // the cubes: dark chrome with glowing edges
    this.cubeEdge = { value: new THREE.Color() };
    const cubeMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.9, roughness: 0.22 });
    cubeMat.onBeforeCompile = (sh) => {
      sh.uniforms.uEdge = this.cubeEdge;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCubeUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCubeUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCubeUv;\nuniform vec3 uEdge;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec2 ce = min(vCubeUv, 1.0 - vCubeUv);
          totalEmissiveRadiance += uEdge * (1.0 - smoothstep(0.025, 0.07, min(ce.x, ce.y)));`,
        );
    };
    this.cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cubeMat, 3);
    this.cubes.frustumCulled = false;
    this.box.add(inner, shell, this.cubes);

    // the blob: chrome, lit by the room, with its own reflections of the show; a cheaper unlit one on Low
    this.blobU = {
      uBlobT: { value: 0 },
      uWob: { value: 0 },
      uBlobKick: { value: 0 },
      uE0: { value: new THREE.Color() },
      uE1: { value: new THREE.Color() },
      uE2: { value: new THREE.Color() },
      uBack: { value: new THREE.Vector3(0, 0, -1) },
      uSide: { value: new THREE.Vector3(1, 0, 0) },
      uEnvGain: { value: 1 },
      uEnvT: { value: 0 },
    };
    if (this.blobFit) {
      const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e9ef, metalness: 1, roughness: 0.06 });
      chrome.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.blobU);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\n${BLOB_FN}`)
          .replace('#include <beginnormal_vertex>', BLOB_NORMAL)
          .replace('#include <begin_vertex>', 'vec3 transformed = bp0;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${BLOB_ENV}`).replace(
          '#include <opaque_fragment>',
          `outgoingLight += blobEnv(inverseTransformDirection(reflect(normalize(-vViewPosition), normal), viewMatrix)) * 0.55;
          outgoingLight = min(outgoingLight, vec3(16.0));
          #include <opaque_fragment>`,
        );
      };
      chrome.customProgramCacheKey = () => 'wallblob';
      // Low: no lights, only the painted reflections (a big blob filling the frame is a lot of lit pixels)
      const cheap = new THREE.MeshBasicMaterial({ color: 0xffffff });
      cheap.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.blobU);
        // (a basic material only computes normals with an environment map: do it here)
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\n${BLOB_FN}\nvarying vec3 vBlobN;\nvarying vec3 vBlobW;`)
          .replace('#include <begin_vertex>', `${BLOB_NORMAL}\nvec3 transformed = bp0;`)
          .replace('#include <project_vertex>', '#include <project_vertex>\nvBlobN = normalize(mat3(modelMatrix) * objectNormal);\nvBlobW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${BLOB_ENV}\nvarying vec3 vBlobN;\nvarying vec3 vBlobW;`).replace(
          '#include <opaque_fragment>',
          `vec3 bv = normalize(vBlobW - cameraPosition);
          vec3 bnn = normalize(vBlobN);
          float fres = pow(1.0 - abs(dot(bv, bnn)), 3.0);
          outgoingLight = blobEnv(reflect(bv, bnn)) * (0.75 + 0.5 * fres) + vec3(0.03, 0.032, 0.04);
          #include <opaque_fragment>`,
        );
      };
      cheap.customProgramCacheKey = () => 'wallblob-low';
      for (const [detail, mat] of [
        [32, chrome],
        [18, chrome],
        [10, cheap],
      ] as const) {
        const geo = new THREE.IcosahedronGeometry(1, detail);
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
        const mesh = new THREE.Mesh(geo, mat);
        this.blobs.push(mesh);
        this.box.add(mesh);
      }
    }
    // everything in the box draws before the room, then the wall's plane masks the window (see the top)
    this.box.traverse((o) => (o.renderOrder = -1000));
    this.object.add(this.box);

    // the panels: an instanced unit box per panel, scaled to the layout
    this.sets = { normal: this.tileSet(tileLayout(w, h, TILE_SIZE.normal), 1), low: this.tileSet(tileLayout(w, h, TILE_SIZE.low), 2) };
    const max = Math.max(this.sets.normal.tiles.length, this.sets.low.tiles.length);
    this.tilesMat = new THREE.MeshBasicMaterial({ color: 0x050608, toneMapped: false });
    ledScreen(this.tilesMat, [w, h], spec.pitch, { tiles: { tile: this.tileSize, crop } }).uLEDGain.value = spec.gain ?? 1.15;
    const tileGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tileC = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.tileC.setUsage(THREE.DynamicDrawUsage);
    tileGeo.setAttribute('aTileC', this.tileC);
    this.tiles = new THREE.InstancedMesh(tileGeo, this.tilesMat, max);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // always drawn (with no panels between drops) so its shader is ready before the first drop
    this.tiles.frustumCulled = false;
    this.tiles.count = 0;
    this.object.add(this.tiles);
    if (spec.backing) {
      this.backing = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55, metalness: 0.6 }));
      this.backing.position.z = -0.25;
      this.object.add(this.backing);
    }
    // the box, blob and backing start out shown so the stage compiles them with the venue; the first update hides them
  }

  /** the panels of one layout, each with its flight (seeded, so a venue's tiles always fly the same way) */
  private tileSet(l: { nx: number; ny: number; tw: number; th: number }, seed: number): TileSet {
    const { w, h } = this;
    const fly = this.spec.fly;
    const hands = this.spec.room.hands;
    const tiles: TileData[] = [];
    for (let j = 0; j < l.ny; j++) {
      for (let i = 0; i < l.nx; i++) {
        const k = (j * l.nx + i) * 7 + seed * 1000;
        const x = -w / 2 + (i + 0.5) * l.tw;
        const y = -h / 2 + (j + 0.5) * l.th;
        const u = x / (w / 2);
        const v = y / (h / 2);
        // out towards the crowd and spreading from the middle; the panels under the hands stay close to the wall and lift
        const low = THREE.MathUtils.smoothstep(y, hands - 0.5, hands + 1.5);
        const dz = fly * (0.5 + 0.5 * hash(k)) * (0.2 + 0.8 * low);
        const dx = fly * 0.4 * (u * 0.8 + (hash(k + 1) - 0.5) * 0.7);
        const dy = fly * 0.3 * (v * 0.6 + 0.25 + (hash(k + 2) - 0.5) * 0.6) * (low < 0.5 ? 0.5 : 1) + (1 - low) * 0.3;
        const axis = new THREE.Vector3(hash(k + 3) - 0.5, (hash(k + 4) - 0.5) * 1.4, (hash(k + 5) - 0.5) * 0.6).normalize();
        // most keep playing their piece of the picture, tilting as they fly; about a third flip right over
        const sign = hash(k + 6) < 0.5 ? -1 : 1;
        const flip = hash(k + 7) < 0.3;
        tiles.push({ x, y, dx, dy, dz, axis, turns: flip ? sign : 0, tilt: sign * (0.45 + 0.75 * hash(k + 8)) });
      }
    }
    return { ...l, tiles };
  }

  private useSet(s: TileSet): void {
    if (this.set === s) return;
    this.set = s;
    this.tileSize.value.set(s.tw, s.th);
    s.tiles.forEach((t, i) => this.tileC.setXY(i, t.x, t.y));
    this.tileC.needsUpdate = true;
  }

  update(s: ShowState, dt: number): void {
    const d = this.director;
    d.update(s, s.wall ?? 'auto', dt);
    const tier = fxTier();
    const box = d.fx === 'box' ? boxAt(d.b) : null;
    const open = box?.open ?? 0;
    const tilesOn = d.fx === 'tiles' || d.ripple > 0.004;

    // the flat wall: faded out over the box and masking its window, hidden behind the panels
    const sm = this.screenMat;
    sm.visible = !tilesOn;
    if (open > 0) {
      if (!this.masking) {
        this.masking = true;
        this.screen.renderOrder = -999;
        sm.blending = THREE.CustomBlending;
        sm.blendSrc = THREE.SrcAlphaFactor;
        sm.blendDst = THREE.OneMinusSrcAlphaFactor;
        sm.blendSrcAlpha = THREE.ZeroFactor;
        sm.blendDstAlpha = THREE.OneFactor;
      }
      sm.opacity = 1 - open;
    } else if (this.masking) {
      this.masking = false;
      this.screen.renderOrder = this.screenOrder;
      sm.blending = THREE.NormalBlending;
      sm.opacity = 1;
    }

    this.box.visible = open > 0;
    if (open > 0) this.updateBox(s, d.b, open, box!.out, tier, dt);
    else for (const b of this.blobs) b.visible = false;

    // the panels
    const set = tier === 'low' ? this.sets.low : this.sets.normal;
    this.useSet(set);
    this.tiles.count = tilesOn ? set.tiles.length : 0;
    if (this.backing) this.backing.visible = tilesOn;
    let lift = 0;
    if (tilesOn) lift = this.updateTiles(s, set, d.fx === 'tiles' ? tilesAt(d.b) : { out: 0, turn: 0 }, d.ripple);
    // the name over the wall stays in front of the panels
    for (const ov of this.overlays) ov.o.position.z = ov.z + lift;
  }

  private updateBox(s: ShowState, b: number, open: number, out: number, tier: 'low' | 'medium' | 'high', dt: number): void {
    const u = this.boxU;
    const { w, h } = this;
    const D = this.depth;
    (u.uC0.value as THREE.Color).copy(s.colors[0]);
    (u.uC1.value as THREE.Color).copy(s.colors[1]);
    (u.uC2.value as THREE.Color).copy(s.colors[2]);
    u.uBeat.value = s.beat;
    u.uKick.value = s.kick * (s.reduceFlash ? 0.5 : 1);
    // the window opening: a burst of light along the grid, softer with reduce flashing
    if (b < 0.1 && this.flash < 0.5) this.flash = 1;
    this.flash *= Math.exp(-dt * 2.5);
    u.uFlash.value = this.flash * (s.reduceFlash ? 0.3 : 1) * open;
    u.uLevel.value = (0.85 + 0.15 * s.master) * open;
    const vis = this.screenMat.map;
    u.uVis.value = vis;
    u.uVisOn.value = vis ? 1 : 0;
    // the cubes: drifting slowly, turning, deep in the box
    const cube = [
      [-0.27, 0.12, 0.4, 0.13],
      [0.05, -0.2, 0.63, 0.1],
      [0.3, 0.22, 0.82, 0.16],
    ];
    cube.forEach(([x, y, z, sz], i) => {
      this.p.set(x * w, y * h + 0.05 * h * Math.sin(s.beat * Math.PI * 0.25 + i * 2.1), -z * D);
      this.q.setFromEuler(this.e.set(s.beat * 0.09 + i, s.beat * 0.13 + i * 1.3, s.beat * 0.05));
      const k = sz * h;
      this.cubes.setMatrixAt(i, this.m.compose(this.p, this.q, this.sc.set(k, k, k)));
    });
    this.cubes.instanceMatrix.needsUpdate = true;
    this.cubeEdge.value.copy(s.colors[2]).multiplyScalar((1.4 + 1.6 * s.kick) * open);

    // the blob
    const fit = this.blobFit;
    const lod = tier === 'high' ? 0 : tier === 'medium' ? 1 : 2;
    this.blobs.forEach((m, i) => (m.visible = !!fit && i === lod && open > 0));
    if (!fit) return;
    const blob = this.blobs[lod];
    const o = out;
    const vel = Math.abs(o - this.prevOut) / Math.max(1e-3, dt * (Math.max(60, s.bpm || 120) / 60));
    this.prevOut = o;
    const settled = Math.min(1, Math.max(0, o));
    // from just inside the box out to where it hangs, a little drift and a bob on the beat once it's out
    const z0 = -0.3 * D;
    const hang = settled * settled;
    this.p.set(
      fit.r * 0.12 * Math.sin(s.beat * Math.PI * 0.0625) * hang,
      THREE.MathUtils.lerp(0, fit.y, o) + 0.04 * fit.r * Math.sin(s.beat * Math.PI * 0.5) * hang,
      THREE.MathUtils.lerp(z0, fit.z, o),
    );
    // stretched along its path as it pushes through, squashed back as it lands
    const st = Math.min(0.45, vel * 0.25);
    const r = fit.r * (0.5 + 0.5 * settled);
    const side = 1 / Math.sqrt(1 + st);
    blob.position.copy(this.p);
    blob.scale.set(r * side, r * side, r * (1 + st));
    blob.rotation.set(0.25 * Math.sin(s.t * 0.21), s.t * 0.2, 0);
    const bu = this.blobU;
    bu.uBlobT.value = s.t;
    bu.uEnvT.value = s.t;
    bu.uWob.value = Math.min(1.4, 0.25 + vel * 0.6);
    bu.uBlobKick.value = s.kick * (0.5 + 0.5 * hang);
    const lvl = 0.6 + 0.4 * s.master;
    (bu.uE0.value as THREE.Color).copy(s.colors[0]).multiplyScalar(lvl);
    (bu.uE1.value as THREE.Color).copy(s.colors[1]).multiplyScalar(lvl);
    (bu.uE2.value as THREE.Color).copy(s.colors[2]).multiplyScalar(lvl * (1 + s.kick));
    bu.uEnvGain.value = 1 + 0.6 * s.kick + 0.5 * s.flash;
    // the box's direction (into the wall) and the wall's sideways, in the world
    this.object.getWorldQuaternion(this.q2);
    (bu.uBack.value as THREE.Vector3).set(0, 0, -1).applyQuaternion(this.q2);
    (bu.uSide.value as THREE.Vector3).set(1, 0, 0).applyQuaternion(this.q2);
    // the stage lowers every venue material's reflections; chrome is all reflection
    const mat = blob.material as THREE.MeshStandardMaterial;
    if (mat.isMeshStandardMaterial) mat.envMapIntensity = 2.2;
  }

  /** place every panel: home, plus the flag ripple, plus the burst; returns how far forward the ripple reaches */
  private updateTiles(s: ShowState, set: TileSet, t: { out: number; turn: number }, ripple: number): number {
    const { w, h } = this;
    const A = 0.16 * set.tw;
    const B = 0.12 * set.tw;
    const beat = s.beat;
    set.tiles.forEach((tile, i) => {
      const u = tile.x / w + 0.5;
      const v = tile.y / h + 0.5;
      // the flag: a slow wave crossing the wall every bar, and a little kick wave on every beat
      const ph = beat * Math.PI * 0.5 - u * Math.PI * 2 - v * 0.8;
      const kb = beat - u * 0.75;
      const kick = Math.exp(-(kb - Math.floor(kb)) * 5);
      const rz = ripple * (A * (0.5 + 0.5 * Math.sin(ph)) + B * kick);
      this.e.set(ripple * 0.05 * Math.sin(ph * 1.3 + v * 2), ripple * 0.1 * Math.cos(ph), 0);
      this.q.setFromEuler(this.e);
      this.p.set(tile.x + tile.dx * t.out, tile.y + tile.dy * t.out, TILE_DEPTH / 2 - TILE_DEPTH + 0.004 + rz + tile.dz * t.out);
      if (t.turn > 0) {
        const swing = Math.min(1, t.out) * (0.75 + 0.25 * Math.sin(t.turn * 9 + i));
        const a = tile.turns ? Math.PI * 2 * tile.turns * t.turn : tile.tilt * swing;
        this.q.premultiply(this.q2.setFromAxisAngle(tile.axis, a));
      }
      this.tiles.setMatrixAt(i, this.m.compose(this.p, this.q, this.sc.set(set.tw, set.th, TILE_DEPTH)));
    });
    this.tiles.instanceMatrix.needsUpdate = true;
    return ripple * (A + B) + 0.01;
  }

  dispose(): void {
    // the meshes are freed with the venue; the visual player's texture belongs to the visualizer
    this.boxU.uVis.value = null;
  }
}
