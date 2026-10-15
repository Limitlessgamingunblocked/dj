/*
 * Whole-picture camera looks: they redraw the club camera's whole frame, not
 * just colour it. One pass after the scene is lit and measured and before the
 * bloom, so whatever they draw bright (a scan line, a lit glyph, a light
 * trail) glows like a real light. Off (no cost) unless one of them is on.
 *
 *   – LiDAR scan: the room, the booth and every dancer as dots on a screen
 *     grid, on black, coloured by height through a rainbow. A scan plane
 *     leaves the camera on every bar and sweeps out through the room (the
 *     distance of each dot comes from the scene's depth): dots light up as it
 *     passes, then fade to a faint residue. In a build it sweeps two and then
 *     four times a bar; on the drop the whole room floods bright for a moment
 *     (a soft swell instead with reduce flashing).
 *   – Scanline club: a video synth (after the Rutt-Etra): the frame redrawn as
 *     glowing horizontal lines, each lifted by the brightness of the picture
 *     under it and coloured by it. The lines bounce on the kick, lift harder
 *     on the drop and jitter sideways through a build.
 *   – ASCII club: the frame as text on black, about a hundred columns across
 *     at any size. Brightness picks the glyph, the picture tints it. Through a
 *     build the cells scramble into random glyphs, more as it climbs; on the
 *     drop they snap back clean.
 *   – Long exposure: the shutter held open. A buffer keeps the brighter of
 *     itself (fading over a second or two) and the frame's highlights, so
 *     beams, lamps, lasers and LED walls leave trails while the darker room
 *     stays sharp. A cut or a jump of the camera starts it again, and it
 *     doesn't take in strobe and blinder frames (they'd hang over the whole
 *     picture). Half resolution on Low.
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { DepthTap } from './ao';
import { FINITE_GLSL } from './lens';
import type { ShowState } from './venues/show';

/* ------------------------------------------------------------------ */
/* the timing and sizes (plain maths, tested)                           */
/* ------------------------------------------------------------------ */

/** beats one LiDAR sweep takes: a bar in the groove, half a bar through a build, a beat at its top */
export function sweepBeats(build: number): number {
  return build >= 0.9 ? 1 : build >= 0.6 ? 2 : 4;
}

/**
 * Where the LiDAR's scan plane is, 0 (at the camera) .. 1 (the far end).
 * It leaves the camera on every downbeat; its speed is picked on the bar line
 * from how built-up the music is, and every speed divides the bar, so a change
 * never makes the plane jump. With nothing playing it sweeps on its own clock.
 */
export class SweepClock {
  /** beats the sweep takes this bar */
  beats = 4;
  phase = 0;
  private bar = Number.NaN;
  private free = 0;

  update(beat: number, build: number, playing: boolean, dt: number): number {
    if (!playing || !Number.isFinite(beat)) {
      this.free = (this.free + Math.max(0, dt) / FREE_SWEEP) % 1;
      this.phase = this.free;
      this.bar = Number.NaN;
      return this.phase;
    }
    const bar = Math.floor(beat / 4);
    if (bar !== this.bar) {
      this.bar = bar;
      this.beats = sweepBeats(build);
    }
    this.phase = ((beat - bar * 4) / this.beats) % 1;
    this.free = this.phase;
    return this.phase;
  }
}

/** seconds a sweep takes with no music */
const FREE_SWEEP = 2.4;

/**
 * The LiDAR's flood on the drop, 0..1, `since` seconds after it: the whole
 * room lit at once, gone within a second. With reduce flashing it's a soft
 * swell to about a third instead of a full-frame flash.
 */
export function lidarFlood(since: number, reduceFlash: boolean): number {
  if (!(since >= 0)) return 0;
  if (reduceFlash) return 0.48 * (1 - Math.exp(-since * 6)) * Math.exp(-since * 1.4);
  return Math.exp(-since * 2.6);
}

/**
 * How many ASCII cells scramble into random glyphs, 0..1: none in the groove,
 * more as a build climbs (most of the frame at its top, never all of it), and
 * none for a moment after the drop, so the picture snaps back clean.
 */
export function scrambleAmount(build: number, sinceDrop: number): number {
  if (sinceDrop >= 0 && sinceDrop < 1.5) return 0;
  const x = Math.min(1, Math.max(0, ((build || 0) - 0.3) / 0.65));
  return x * x * 0.85;
}

/** ASCII cell size in pixels for a frame this wide: about 100 columns at any resolution */
export function asciiCell(widthPx: number): number {
  return Math.max(6, Math.round(widthPx / 100));
}

/** LiDAR grid spacing in pixels for a frame this tall: about 96 rows of dots */
export function lidarCell(heightPx: number): number {
  return Math.max(4, Math.round(heightPx / 96));
}

/** the farthest the LiDAR reaches, metres: past it there's no return (the sky, a far field) */
export const LIDAR_MAX = 80;
/** distances are measured into bytes on a log scale up to this many metres */
const RANGE_LOG = Math.log2(1 + 160);

/**
 * Where the scan plane is (0..1) at `dist` metres, for a sweep from `near` to
 * `far`: on a log scale, so it crosses the booth, the crowd and the far wall
 * in even steps. The shader does the same.
 */
export function sweepAt(dist: number, near: number, far: number): number {
  const a = Math.log2(1 + Math.max(0, near));
  const b = Math.log2(1 + Math.max(near + 1, far));
  return Math.min(1, Math.max(0, (Math.log2(1 + Math.max(0, dist)) - a) / (b - a)));
}

/** a distance to its byte in the range meter, and back */
export function rangeByte(dist: number): number {
  return Math.round(Math.min(1, Math.max(0, Math.log2(1 + Math.max(0, dist)) / RANGE_LOG)) * 255);
}
export function byteRange(b: number): number {
  return 2 ** ((b / 255) * RANGE_LOG) - 1;
}

/**
 * What the sweep should cover in this shot: from the nearest things in frame
 * (the 10th percentile of each patch's nearest return) to the far ones (the
 * 90th of each patch's farthest), from the meter's cells (red: nearest,
 * green: farthest, blue: some return at all). Null with too few returns.
 */
export function sweepRange(bytes: Uint8Array, cells: number): { near: number; far: number } | null {
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (bytes[i * 4 + 2] < 128) continue;
    lo.push(byteRange(bytes[i * 4]));
    hi.push(byteRange(bytes[i * 4 + 1]));
  }
  if (lo.length < Math.max(3, cells * 0.05)) return null;
  lo.sort((a, b) => a - b);
  hi.sort((a, b) => a - b);
  const near = Math.min(LIDAR_MAX - 4, lo[Math.floor(lo.length * 0.1)]);
  const far = Math.min(LIDAR_MAX, Math.max(near + 3, hi[Math.min(hi.length - 1, Math.floor(hi.length * 0.9))]));
  return { near, far };
}

/** the video synth's lines over the frame's height, and how many lines below a pixel the shader looks for one lifted up to it */
export const SYNTH_LINES = 96;
export const SYNTH_REACH = 18;
/** the most a line can lift (frame heights): what the shader can still find */
export const SYNTH_MAX_LIFT = (SYNTH_REACH - 2) / SYNTH_LINES;

/** how far the brightest picture lifts a line (frame heights): more on the kick, more again on the drop */
export function synthLift(kick: number, drop: number): number {
  const k = Math.min(1, Math.max(0, kick || 0));
  const d = Math.min(1, Math.max(0, drop || 0));
  return Math.min(SYNTH_MAX_LIFT, 0.075 + 0.03 * k + 0.06 * d);
}

/** how far the lines jitter sideways through a build (frame widths) */
export function synthJitter(build: number): number {
  const b = Math.min(1, Math.max(0, ((build || 0) - 0.4) / 0.6));
  return 0.045 * b * b;
}

/** seconds for a light trail to fade to about a third (it's gone in a second or two) */
export const TRAIL_SECONDS = 0.7;

/** what's left of the trail after dt seconds */
export function trailDecay(dt: number): number {
  return Math.exp(-Math.max(0, dt) / TRAIL_SECONDS);
}

/** where the camera is, which way it looks (unit vector) and its lens (vertical fov, degrees) */
export interface CamPose {
  pos: [number, number, number];
  dir: [number, number, number];
  fov: number;
}

/**
 * Did the camera cut or jump since the last frame (dt seconds ago)? Faster
 * than any move the rig flies (about 30 m/s, 650°/s or a big change of lens
 * in a frame): then the long exposure starts again, so a cut doesn't smear one
 * shot's lights over the next.
 */
export function cameraJumped(a: CamPose, b: CamPose, dt: number): boolean {
  const t = Math.min(0.25, Math.max(1 / 120, dt || 0));
  const dist = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
  const dot = a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2];
  const turn = Math.acos(Math.min(1, Math.max(-1, dot)));
  if (!Number.isFinite(dist) || !Number.isFinite(turn)) return true;
  return dist > 0.4 + 6 * t || turn > 0.15 + 2.5 * t || Math.abs(b.fov - a.fov) > 6 + 40 * t;
}

/* ------------------------------------------------------------------ */
/* the ASCII glyphs                                                     */
/* ------------------------------------------------------------------ */

/** 5 × 5 glyphs from dark to bright: brightness picks one */
export const RAMP: string[][] = [
  ['.....', '.....', '.....', '.....', '.....'], // space
  ['.....', '.....', '.....', '.....', '..#..'], // .
  ['.....', '..#..', '.....', '..#..', '.....'], // :
  ['.....', '.....', '.###.', '.....', '.....'], // -
  ['.....', '..#..', '.###.', '..#..', '.....'], // +
  ['.....', '.###.', '.....', '.###.', '.....'], // =
  ['.....', '.###.', '.#.#.', '.###.', '.....'], // o
  ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], // x
  ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'], // *
  ['.###.', '#...#', '.###.', '#...#', '.###.'], // 8
  ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'], // #
  ['.###.', '#...#', '#.###', '#.##.', '.####'], // @
  ['#####', '##.##', '#.#.#', '##.##', '#####'], // ▓
];

/** what a scrambled cell shows: letters, digits and signs */
export const SCRAMBLE: string[][] = [
  ['.###.', '#..##', '#.#.#', '##..#', '.###.'], // 0
  ['..#..', '.##..', '..#..', '..#..', '.###.'], // 1
  ['#####', '...#.', '..#..', '.#...', '.#...'], // 7
  ['#..#.', '#..#.', '#####', '...#.', '...#.'], // 4
  ['.###.', '#...#', '#####', '#...#', '#...#'], // A
  ['#..#.', '#.#..', '##...', '#.#..', '#..#.'], // K
  ['#####', '...#.', '..#..', '.#...', '#####'], // Z
  ['.####', '#.#..', '.###.', '..#.#', '####.'], // $
  ['.###.', '#...#', '..##.', '.....', '..#..'], // ?
  ['....#', '...#.', '..#..', '.#...', '#....'], // /
  ['...#.', '..#..', '.#...', '..#..', '...#.'], // <
  ['.#...', '..#..', '...#.', '..#..', '.#...'], // >
];

/** lit pixels in a glyph */
export function coverage(g: string[]): number {
  return g.join('').split('#').length - 1;
}

/** the glyphs side by side in one strip (5 pixels each, the top row first): red 255 where lit */
export function glyphAtlas(): { data: Uint8Array; width: number; height: number } {
  const all = [...RAMP, ...SCRAMBLE];
  const width = all.length * 5;
  const data = new Uint8Array(width * 5 * 4);
  all.forEach((g, i) => {
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 5; col++) {
        const o = (row * width + i * 5 + col) * 4;
        const on = g[row][col] === '#' ? 255 : 0;
        data[o] = on;
        data[o + 1] = on;
        data[o + 2] = on;
        data[o + 3] = 255;
      }
  });
  return { data, width, height: 5 };
}

/* ------------------------------------------------------------------ */
/* the pass                                                             */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const ATLAS_W = (RAMP.length + SCRAMBLE.length) * 5;

const FRAG = /* glsl */ `
  uniform sampler2D tColor, tTrail, tDist, tGlyphs;
  uniform vec2 uRes;
  uniform float uTime, uExposure;
  uniform float uTrails, uTrailLo, uTrailHi;
  uniform float uLidar, uSweep, uSweepNear, uSweepFar, uFlood, uLidarCell, uFar, uHasDist;
  uniform mat4 uProjInv, uCamWorld;
  uniform float uSynth, uSynthAmp, uSynthJit;
  uniform float uAscii, uAsciiCell, uScramble, uTick, uDrop;
  uniform vec3 uShowCol;
  varying vec2 vUv;
  ${FINITE_GLSL}
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(vec2(i, 1.7)), hash(vec2(i + 1.0, 1.7)), f);
  }
  vec3 scene(vec2 uv) { return finite3(texture2D(tColor, clamp(uv, 0.0, 1.0)).rgb); }
  // the bright part of a pixel: what a long exposure keeps
  vec3 highlight(vec3 c) { return c * smoothstep(uTrailLo, uTrailHi, dot(c, LUMA)); }

  // ---- LiDAR ----
  // the point in view space at this uv and this many metres along the view axis
  vec3 viewAt(vec2 uv, float z) {
    vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 d = p.xyz / p.w;
    return d * (z / max(1e-4, -d.z));
  }
  // the scan's distance scale: log from the nearest things in frame to the far ones (sweepAt above)
  float sweepAt(float dist) {
    float a = log2(1.0 + uSweepNear);
    float b = log2(1.0 + max(uSweepNear + 1.0, uSweepFar));
    return clamp((log2(1.0 + dist) - a) / (b - a), 0.0, 1.0);
  }
  vec3 rainbow(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
  bool hasReturn(float z) { return z > 0.0 && z < min(uFar * 0.97, ${LIDAR_MAX}.0); }
  vec3 lidar() {
    if (uHasDist < 0.5) return vec3(0.0);
    vec3 col = vec3(0.0);
    // the scan line, at full resolution: where this pixel's surface crosses the plane
    float zp = texture2D(tDist, vUv).x;
    if (hasReturn(zp)) col += vec3(0.7, 0.92, 1.0) * exp(-abs(sweepAt(length(viewAt(vUv, zp))) - uSweep) * 260.0) * 1.2;
    float C = uLidarCell;
    vec2 cell = floor(gl_FragCoord.xy / C);
    vec2 cc = (cell + 0.5) * C;
    vec2 cuv = cc / uRes;
    float z = texture2D(tDist, cuv).x;
    // the sky (or nothing in range): no return
    if (!hasReturn(z)) return col;
    vec3 P = viewAt(cuv, z);
    float dist = length(P);
    // the next points over each way: which way the surface faces, and whether this point is on an edge
    vec2 ox = vec2(C / uRes.x, 0.0);
    vec2 oy = vec2(0.0, C / uRes.y);
    float zr = texture2D(tDist, cuv + ox).x;
    float zl = texture2D(tDist, cuv - ox).x;
    float zu = texture2D(tDist, cuv + oy).x;
    float zd = texture2D(tDist, cuv - oy).x;
    float jump = max(max(abs(zr - z), abs(zl - z)), max(abs(zu - z), abs(zd - z))) / z;
    float edge = smoothstep(0.06, 0.25, jump);
    float facing = 0.6;
    if (edge < 0.5) {
      vec3 n = cross(viewAt(cuv + ox, zr) - viewAt(cuv - ox, zl), viewAt(cuv + oy, zu) - viewAt(cuv - oy, zd));
      float nl = length(n);
      if (nl > 1e-9) facing = abs(dot(n / nl, P / max(dist, 1e-4)));
    }
    float zn = sweepAt(dist);
    // like a real scanner, few returns off grazing surfaces and far away: the floor and the far end thin
    // out, people, walls and edges stay solid
    if (hash(cell * 0.73 + 3.1) < (1.0 - facing) * 0.6 + zn * 0.3 - edge) return col;
    // how long since the plane went by (in sweeps): it lit the point, the point fades to a residue
    float age = uSweep - zn;
    if (age < 0.0) age += 1.0;
    float lit = exp(-age * 4.0);
    float on = exp(-abs(uSweep - zn) * 45.0);
    // the show's light in the room picks up in the points (the LED wall, a beam across them)
    float light = min(dot(scene(cuv), LUMA) * uExposure, 3.0);
    float b = 0.05 + 1.1 * lit + uFlood + light * 0.25 + edge * 0.5;
    // distance through the rainbow (near warm, far blue), shifted a little by height
    float y = (uCamWorld * vec4(P, 1.0)).y;
    vec3 pal = rainbow(0.98 - 0.62 * zn + 0.03 * y);
    vec3 c = pal * b * (0.35 + 0.65 * facing) + mix(pal, vec3(1.0), 0.6) * (on * 0.9 + uFlood * 0.35);
    // the point: round, a little bigger while it's lit, with a soft halo
    float r = length(gl_FragCoord.xy - cc) / C;
    float k = clamp(lit + uFlood + on, 0.0, 1.0);
    float dr = 0.14 + 0.2 * k + 0.06 * edge;
    float aa = 1.0 / C;
    float dotm = 1.0 - smoothstep(dr - aa, dr + aa, r);
    float halo = exp(-r * r * 18.0) * 0.22 * k;
    // the far points fade into the dark
    return col + c * (dotm + halo) * mix(1.0, 0.45, zn);
  }

  // ---- video synth ----
  vec3 synth() {
    float N = ${SYNTH_LINES}.0;
    float y = vUv.y;
    // the line's core, in pixels (thicker on a bigger frame)
    float w = max(0.8, uRes.y / 900.0);
    vec3 col = vec3(0.0);
    float i0 = floor(y * N) + 1.0;
    for (int k = 0; k < ${SYNTH_REACH + 1}; k++) {
      float idx = i0 - float(k);
      if (idx < 0.0) break;
      float by = (idx + 0.5) / N;
      float jit = uSynthJit * (noise1(idx * 3.1 + uTime * 9.0) - 0.5) * 2.0;
      vec3 s = scene(vec2(vUv.x + jit, by));
      float l = dot(s, LUMA) * uExposure;
      float a = l / (1.0 + l);
      float dd = abs(y - (by + a * uSynthAmp)) * uRes.y;
      float core = 1.0 - smoothstep(w * 0.5, w * 1.6, dd);
      float halo = exp(-dd * 0.45) * 0.1;
      // the picture's own colour, brighter where it's bright
      vec3 hue = s / max(max(s.r, max(s.g, s.b)), 1e-4);
      col += mix(vec3(0.55, 0.6, 0.75), hue, 0.85) * (0.08 + a * 2.3) * (core + halo);
    }
    return col / max(uExposure, 0.05);
  }

  // ---- ASCII ----
  float glyphBit(float gi, vec2 g) {
    return texture2D(tGlyphs, vec2((gi * 5.0 + g.x + 0.5) / ${ATLAS_W}.0, (g.y + 0.5) / 5.0)).r;
  }
  vec3 ascii() {
    float C = uAsciiCell;
    vec2 cell = floor(gl_FragCoord.xy / C);
    vec2 cuv = (cell + 0.5) * C / uRes;
    // the picture under the cell: four taps, so it doesn't crawl as the camera moves
    vec2 q = vec2(C * 0.25) / uRes;
    vec3 s = (scene(cuv - q) + scene(cuv + vec2(q.x, -q.y)) + scene(cuv + vec2(-q.x, q.y)) + scene(cuv + q)) * 0.25;
    float l = dot(s, LUMA) * uExposure;
    // a perceptual curve: a dark club still reads, the screens and lamps go dense
    float g = clamp((1.0 - exp(-sqrt(l) * 1.8)) * (1.0 + uDrop * 0.3), 0.0, 1.0);
    float gi = floor(min(g, 0.999) * ${RAMP.length}.0);
    vec3 tint = mix(vec3(0.72, 0.76, 0.82), s / max(max(s.r, max(s.g, s.b)), 1e-4), 0.9);
    if (hash(cell + uTick * 0.37) < uScramble) {
      gi = ${RAMP.length}.0 + floor(hash(cell * 1.7 + uTick) * ${SCRAMBLE.length}.0);
      g = max(g, 0.5);
      tint = mix(vec3(0.85, 0.9, 1.0), uShowCol, 0.6);
    }
    // the glyph's 5 x 5 in a 6 x 6 grid over the cell: a gap column on the right, a gap row underneath
    vec2 gp = floor((gl_FragCoord.xy - cell * C) / C * 6.0);
    if (gp.x > 4.0 || gp.y < 1.0) return vec3(0.0);
    return tint * glyphBit(gi, vec2(gp.x, 5.0 - gp.y)) * (0.2 + g * 1.6) / max(uExposure, 0.05);
  }

  void main() {
    vec3 c = scene(vUv);
    if (uTrails > 0.001) {
      // the long exposure: the trail where it's brighter than the frame's own highlight
      vec3 tr = finite3(texture2D(tTrail, vUv).rgb);
      c += max(tr - highlight(c), 0.0) * uTrails;
    }
    if (uLidar > 0.001) c = mix(c, lidar(), uLidar);
    if (uSynth > 0.001) c = mix(c, synth(), uSynth);
    if (uAscii > 0.001) c = mix(c, ascii(), uAscii);
    gl_FragColor = vec4(finite3(c), 1.0);
  }
`;

const TRAIL_FRAG = /* glsl */ `
  uniform sampler2D tColor, tPrev;
  uniform float uDecay, uIntake, uLo, uHi, uMax;
  varying vec2 vUv;
  ${FINITE_GLSL}
  void main() {
    vec3 c = finite3(texture2D(tColor, vUv).rgb);
    vec3 h = c * smoothstep(uLo, uHi, dot(c, vec3(0.2126, 0.7152, 0.0722))) * uIntake;
    vec3 p = finite3(texture2D(tPrev, vUv).rgb) * uDecay;
    gl_FragColor = vec4(min(max(p, h), vec3(uMax)), 1.0);
  }
`;

/** the long exposure's highlight band (linear, at exposure 1): below `lo` nothing trails, above `hi` all of it */
const TRAIL_LO = 0.7;
const TRAIL_HI = 2.0;
/** no trail brighter than this (at exposure 1) */
const TRAIL_MAX = 8;
/** the range meter's grid: each cell the nearest and farthest return in its patch */
const RANGE_W = 16;
const RANGE_H = 9;

const RANGE_FRAG = /* glsl */ `
  uniform sampler2D tDist;
  uniform mat4 uProjInv;
  uniform float uMax;
  varying vec2 vUv;
  void main() {
    vec2 cell = vec2(${1 / RANGE_W}, ${1 / RANGE_H});
    vec2 o = vUv - cell * 0.5;
    float lo = 1e5;
    float hi = 0.0;
    float n = 0.0;
    for (int y = 0; y < 4; y++)
      for (int x = 0; x < 4; x++) {
        vec2 uv = o + cell * (vec2(float(x), float(y)) + 0.5) / 4.0;
        float z = texture2D(tDist, uv).x;
        if (z > 0.0 && z < uMax) {
          vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
          vec3 d = p.xyz / p.w;
          float dist = length(d) * z / max(1e-4, -d.z);
          lo = min(lo, dist);
          hi = max(hi, dist);
          n += 1.0;
        }
      }
    float L = ${RANGE_LOG};
    gl_FragColor = n > 0.0 ? vec4(log2(1.0 + lo) / L, log2(1.0 + hi) / L, 1.0, 1.0) : vec4(0.0);
  }
`;

export class PicturePass extends Pass {
  /** how much of each look is on this frame (the stage sets them from looks.ts) */
  lidar = 0;
  synth = 0;
  ascii = 0;
  trails = 0;
  /** the camera's exposure: the looks draw at the same brightness whatever the auto exposure does */
  exposure = 1;
  /** Low quality: the long exposure's buffer at half resolution */
  low = false;
  /** a photo is being drawn at another size: leave the long exposure's buffer as it is */
  still = false;
  private readonly sweep = new SweepClock();
  private sinceDrop = 1e9;
  private tick = 0;
  private mat: THREE.ShaderMaterial;
  private trailMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private trailQuad: FullScreenQuad;
  private trailA: THREE.WebGLRenderTarget | null = null;
  private trailB: THREE.WebGLRenderTarget | null = null;
  /** seconds of the show since the long exposure last took in a frame (the stage's clock, not the wall's: a slow frame is a frame) */
  private trailDt = 1e9;
  private resetWanted = true;
  private pose: CamPose = { pos: [0, 0, 0], dir: [0, 0, -1], fov: 0 };
  private glyphs: THREE.DataTexture;
  private size = new THREE.Vector2(1, 1);
  /** the LiDAR sweeps from the nearest things in the shot to the far ones: measured a few times a second, eased */
  private near = 2;
  private far = 30;
  private wantNear = 2;
  private wantFar = 30;
  private rangeRT = new THREE.WebGLRenderTarget(RANGE_W, RANGE_H, { type: THREE.UnsignedByteType, depthBuffer: false });
  private rangeMat: THREE.ShaderMaterial;
  private rangeQuad: FullScreenQuad;
  private rangeBuf = new Uint8Array(RANGE_W * RANGE_H * 4);
  private rangePending = false;
  private rangeFrame = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private tap: DepthTap,
  ) {
    super();
    this.needsSwap = true;
    this.enabled = false;
    const atlas = glyphAtlas();
    this.glyphs = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.glyphs.minFilter = THREE.NearestFilter;
    this.glyphs.magFilter = THREE.NearestFilter;
    this.glyphs.generateMipmaps = false;
    this.glyphs.colorSpace = THREE.NoColorSpace;
    this.glyphs.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      name: 'PictureLook',
      uniforms: {
        tColor: { value: null },
        tTrail: { value: null },
        tDist: { value: null },
        tGlyphs: { value: this.glyphs },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        uTrails: { value: 0 },
        uTrailLo: { value: TRAIL_LO },
        uTrailHi: { value: TRAIL_HI },
        uLidar: { value: 0 },
        uSweep: { value: 0 },
        uSweepNear: { value: 2 },
        uSweepFar: { value: 30 },
        uFlood: { value: 0 },
        uLidarCell: { value: 8 },
        uFar: { value: 100 },
        uHasDist: { value: 0 },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uSynth: { value: 0 },
        uSynthAmp: { value: 0.08 },
        uSynthJit: { value: 0 },
        uAscii: { value: 0 },
        uAsciiCell: { value: 12 },
        uScramble: { value: 0 },
        uTick: { value: 0 },
        uDrop: { value: 0 },
        uShowCol: { value: new THREE.Color(0.6, 0.4, 1) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.trailMat = new THREE.ShaderMaterial({
      name: 'LongExposure',
      uniforms: { tColor: { value: null }, tPrev: { value: null }, uDecay: { value: 0 }, uIntake: { value: 1 }, uLo: { value: TRAIL_LO }, uHi: { value: TRAIL_HI }, uMax: { value: TRAIL_MAX } },
      vertexShader: VERT,
      fragmentShader: TRAIL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.rangeMat = new THREE.ShaderMaterial({
      name: 'LidarRange',
      uniforms: { tDist: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uMax: { value: LIDAR_MAX } },
      vertexShader: VERT,
      fragmentShader: RANGE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
    this.trailQuad = new FullScreenQuad(this.trailMat);
    this.rangeQuad = new FullScreenQuad(this.rangeMat);
  }

  /** the LiDAR's readout (the text burnt into its picture): its range in metres, sweeps a bar, dots on the grid */
  get range(): number {
    return Math.round(this.far);
  }
  get sweepsPerBar(): number {
    return 4 / this.sweep.beats;
  }
  get points(): number {
    const c = lidarCell(this.size.y);
    return Math.floor(this.size.x / c) * Math.floor(this.size.y / c);
  }

  /** any of the looks on (the stage turns the pass off otherwise) */
  get active(): boolean {
    return this.lidar > 0 || this.synth > 0 || this.ascii > 0 || this.trails > 0;
  }

  /** this frame's music: the sweep's clock, the drop, the build */
  follow(s: ShowState, dt: number): void {
    const u = this.mat.uniforms;
    this.trailDt += dt;
    this.sinceDrop = s.dropHit ? 0 : this.sinceDrop + dt;
    u.uTime.value = s.t;
    u.uSweep.value = this.sweep.update(s.beat, s.build, s.playing, dt);
    // the sweep's range follows the shot (quickly, but without snapping on a cut)
    const k = 1 - Math.exp(-Math.max(0, dt) * 4);
    this.near += (this.wantNear - this.near) * k;
    this.far += (this.wantFar - this.far) * k;
    u.uSweepNear.value = this.near;
    u.uSweepFar.value = this.far;
    u.uFlood.value = lidarFlood(this.sinceDrop, s.reduceFlash);
    u.uSynthAmp.value = synthLift(s.kick, s.drop);
    u.uSynthJit.value = synthJitter(s.build);
    u.uScramble.value = scrambleAmount(s.build, this.sinceDrop);
    u.uDrop.value = s.drop;
    // the scrambled glyphs change a dozen times a second (under three with reduce flashing)
    this.tick += dt * (s.reduceFlash ? 2.5 : 12);
    u.uTick.value = Math.floor(this.tick) % 9973;
    (u.uShowCol.value as THREE.Color).copy(s.colors[0]);
    // a strobe or blinder lights the whole room: those frames don't go into the long exposure
    this.trailMat.uniforms.uIntake.value = 1 - Math.min(1, s.flash * 1.4);
  }

  /** start the long exposure again (the camera cut) */
  resetTrails(): void {
    this.resetWanted = true;
  }

  setSize(width: number, height: number): void {
    this.size.set(Math.max(1, width), Math.max(1, height));
    const u = this.mat.uniforms;
    (u.uRes.value as THREE.Vector2).copy(this.size);
    u.uAsciiCell.value = asciiCell(this.size.x);
    u.uLidarCell.value = lidarCell(this.size.y);
  }

  private camPose(): CamPose {
    const e = this.camera.matrixWorld.elements;
    return { pos: [e[12], e[13], e[14]], dir: [-e[8], -e[9], -e[10]], fov: this.camera.fov };
  }

  /** the long exposure: fold this frame's highlights into the buffer (unless a photo is being drawn) */
  private updateTrails(renderer: THREE.WebGLRenderer, frame: THREE.Texture): void {
    if (this.still && this.trailA) return;
    const dt = Math.min(0.25, this.trailDt);
    // not drawn for a while (the look was off, the picture held): start again
    const stale = this.trailDt > 0.5;
    this.trailDt = 0;
    const k = this.low ? 0.5 : 1;
    const w = Math.max(1, Math.round(this.size.x * k));
    const h = Math.max(1, Math.round(this.size.y * k));
    let reset = this.resetWanted || stale;
    if (!this.trailA || !this.trailB || this.trailA.width !== w || this.trailA.height !== h) {
      const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
      this.trailA?.dispose();
      this.trailB?.dispose();
      this.trailA = new THREE.WebGLRenderTarget(w, h, opts);
      this.trailB = new THREE.WebGLRenderTarget(w, h, opts);
      reset = true;
    }
    const pose = this.camPose();
    if (cameraJumped(this.pose, pose, dt)) reset = true;
    this.pose = pose;
    this.resetWanted = false;
    const tu = this.trailMat.uniforms;
    const ex = Math.max(0.05, this.exposure);
    tu.tColor.value = frame;
    tu.tPrev.value = this.trailA.texture;
    tu.uDecay.value = reset ? 0 : trailDecay(dt);
    tu.uLo.value = TRAIL_LO / ex;
    tu.uHi.value = TRAIL_HI / ex;
    tu.uMax.value = TRAIL_MAX / ex;
    renderer.setRenderTarget(this.trailB);
    this.trailQuad.render(renderer);
    const t = this.trailA;
    this.trailA = this.trailB;
    this.trailB = t;
  }

  /** a few times a second: how near and far the returns in this shot are (read back without stalling) */
  private measureRange(renderer: THREE.WebGLRenderer, dist: THREE.Texture): void {
    if (this.rangePending || this.still || ++this.rangeFrame % 6) return;
    const ru = this.rangeMat.uniforms;
    ru.tDist.value = dist;
    (ru.uProjInv.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    ru.uMax.value = Math.min(this.camera.far * 0.97, LIDAR_MAX);
    renderer.setRenderTarget(this.rangeRT);
    this.rangeQuad.render(renderer);
    this.rangePending = true;
    renderer
      .readRenderTargetPixelsAsync(this.rangeRT, 0, 0, RANGE_W, RANGE_H, this.rangeBuf)
      .then(() => {
        const r = sweepRange(this.rangeBuf, RANGE_W * RANGE_H);
        if (r) {
          this.wantNear = r.near;
          this.wantFar = r.far;
        }
      })
      .catch(() => {})
      .finally(() => (this.rangePending = false));
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.mat.uniforms;
    const ex = Math.max(0.05, this.exposure);
    u.tColor.value = readBuffer.texture;
    u.uExposure.value = ex;
    u.uTrails.value = this.trails;
    if (this.trails > 0.001) {
      this.updateTrails(renderer, readBuffer.texture);
      u.tTrail.value = this.trailA?.texture ?? null;
      u.uTrailLo.value = TRAIL_LO / ex;
      u.uTrailHi.value = TRAIL_HI / ex;
    } else this.resetWanted = true;
    u.uLidar.value = this.lidar;
    if (this.lidar > 0.001) {
      // the distance of every pixel, from the depth the scene left (kept coming while the look is on)
      this.tap.requestDistance();
      u.tDist.value = this.tap.distance;
      u.uHasDist.value = this.tap.distance ? 1 : 0;
      (u.uProjInv.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
      (u.uCamWorld.value as THREE.Matrix4).copy(this.camera.matrixWorld);
      u.uFar.value = this.camera.far;
      if (this.tap.distance) this.measureRange(renderer, this.tap.distance);
    }
    u.uSynth.value = this.synth;
    u.uAscii.value = this.ascii;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.mat.dispose();
    this.trailMat.dispose();
    this.rangeMat.dispose();
    this.rangeRT.dispose();
    this.rangeQuad.dispose();
    this.quad.dispose();
    this.trailQuad.dispose();
    this.trailA?.dispose();
    this.trailB?.dispose();
    this.glyphs.dispose();
  }
}
