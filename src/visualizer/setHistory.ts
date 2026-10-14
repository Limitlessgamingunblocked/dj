/*
 * The set so far, for "Your Set as a Sculpture" (modes5.ts). Every track
 * played this session becomes a ribbon of samples taken from its own audio
 * while it plays, laid along one rising spiral.
 *   - a track is on while its deck plays it and it's open past the channel
 *     fader and the crossfader (a deck only in the headphones doesn't count)
 *   - while anything is on, the set's own beat clock runs; it stops in
 *     silence, so the sculpture has no gaps
 *   - four samples a beat for every track that's on: the level, the kick and
 *     the bass, each in proportion to how loud that track is in the mix
 *   - two tracks on at once is a mix: their ribbons braid round the path on
 *     opposite sides, opening over a few beats and closing when one leaves
 *   - the spiral rises and widens as the set grows, a fixed length a beat, so
 *     a long night ends up a wide funnel rather than a needle
 *   - a sample budget: past it the oldest ribbons are halved (neighbouring
 *     samples merged), so older tracks are coarser than newer ones and the
 *     geometry never grows past the budget
 * In memory for this session only. Pure: the visual player feeds it every
 * frame (whichever mode is on screen) and the sculpture draws it.
 */

/** one deck as the room hears it (the audio features carry these) */
export interface DeckFeed {
  /** the track it's playing, or null when it's stopped or empty */
  track: string | null;
  /** its channel fader and crossfader gain, 0..1 */
  gain: number;
  /** its level before the fader (the channel meter's peak) */
  peak: number;
}

export interface HistoryInput {
  dt: number;
  bpm: number;
  /** the music's level, kick and bass, 0..1 */
  level: number;
  kick: number;
  sub: number;
  decks: readonly DeckFeed[] | undefined;
}

/** beats between samples */
export const STEP = 0.25;
/** the most samples kept, all ribbons together */
export const CAP = 12000;
/** a deck counts as on past this gain (about −26 dB) */
export const GAIN_ON = 0.05;
/** seconds a track can be off before its ribbon ends */
export const QUIET_CLOSE = 6;
/** the samples at the tip of a playing ribbon are never merged */
export const KEEP_TAIL = 128;
/** beats for one twist of a braid, and how far the strands sit from the path */
export const BRAID_BEATS = 16;
export const BRAID_R = 0.3;
/** about how many beats a braid takes to open or close */
export const MIX_BEATS = 3;

/* the spiral */
/** path length a beat */
export const ARC = 0.04;
/** the first turn's radius, how much wider and higher each turn goes */
export const R0 = 2.4;
export const GROW = 0.9;
export const RISE = 1.6;

export type RGB = [number, number, number];

export interface Ribbon {
  /** its number in the set, from 1 */
  n: number;
  track: string;
  deck: number;
  /** which strand of a braid: the other track in a mix always has the other side */
  side: 0 | 1;
  color: RGB;
  /** the samples, side by side: the set's beat, level, kick, bass and how far into a mix */
  s: number[];
  level: number[];
  kick: number[];
  sub: number[];
  mix: number[];
  open: boolean;
  /** seconds since it was last on */
  quiet: number;
  /** the sample being gathered */
  accN: number;
  accLevel: number;
  accKick: number;
  accSub: number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** a colour for a track before its look arrives: a hue from its id */
export function fallbackColor(track: string): RGB {
  let h = 2166136261;
  for (let i = 0; i < track.length; i++) {
    h ^= track.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return hslToRgb(((h >>> 0) % 360) / 360, 0.85, 0.58);
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const sat = (c: RGB) => {
  const mx = Math.max(...c);
  return mx > 0 ? (mx - Math.min(...c)) / mx : 0;
};
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Which of a song's colours its ribbon takes: its main colour, unless that's
 * too close to the ribbon before it, so neighbouring tracks (and the two
 * strands of a braid) stay apart.
 */
export function pickRibbonColor(colors: RGB[], prev: RGB | null): RGB {
  if (!colors.length) return [1, 1, 1];
  if (!prev) return colors[0];
  let best = colors[0];
  let score = -Infinity;
  colors.forEach((c, i) => {
    const v = Math.min(0.6, dist(c, prev)) + sat(c) * 0.25 + (i === 0 ? 0.15 : 0);
    if (v > score) {
      score = v;
      best = c;
    }
  });
  return best;
}

/** samples a beat over a ribbon's length */
export function density(r: Ribbon): number {
  const n = r.s.length;
  if (n < 2) return n;
  return (n - 1) / Math.max(1e-6, r.s[n - 1] - r.s[0]);
}

/**
 * Merge neighbouring samples in pairs, except the last `keep`: the level and
 * the bass are averaged, the kick keeps its peak. Returns how many went.
 */
export function halve(r: Ribbon, keep = 0): number {
  const n = r.s.length;
  const upto = n - Math.max(0, keep);
  const pairs = Math.floor(upto / 2);
  if (pairs < 1) return 0;
  const cols = [r.s, r.level, r.kick, r.sub, r.mix];
  for (let p = 0; p < pairs; p++) {
    const a = p * 2;
    r.s[p] = (r.s[a] + r.s[a + 1]) / 2;
    r.level[p] = (r.level[a] + r.level[a + 1]) / 2;
    r.kick[p] = Math.max(r.kick[a], r.kick[a + 1]);
    r.sub[p] = (r.sub[a] + r.sub[a + 1]) / 2;
    r.mix[p] = (r.mix[a] + r.mix[a + 1]) / 2;
  }
  // the odd one out and the tail move down after the merged pairs
  for (const c of cols) c.splice(pairs, pairs);
  return pairs;
}

/**
 * The ribbon to thin next: the oldest finished one still at the finest level
 * (within a factor of 1.5 of the finest). Repeated, every finished ribbon
 * comes down a level, oldest first, so density never rises with age.
 */
export function pickToHalve(ribbons: readonly Ribbon[]): Ribbon | null {
  const done = ribbons.filter((r) => !r.open && r.s.length >= 2);
  let top = 0;
  for (const r of done) top = Math.max(top, density(r));
  return done.find((r) => density(r) >= top / 1.5) ?? null;
}

/* ------------------------------------------------------------------ */
/* the path                                                             */
/* ------------------------------------------------------------------ */

/** how far round the spiral (radians) at a beat of the set */
export function spiralAngle(s: number): number {
  const b = GROW / TAU;
  const len = Math.max(0, s) * ARC;
  // the arc of r = R0 + bθ is about R0θ + bθ²/2
  return (-R0 + Math.sqrt(R0 * R0 + 2 * b * len)) / b;
}

/** the path at a beat of the set */
export function spiral(s: number, out: RGB = [0, 0, 0]): RGB {
  const th = spiralAngle(s);
  const r = R0 + (GROW / TAU) * th;
  out[0] = Math.cos(th) * r;
  out[1] = (th / TAU) * RISE;
  out[2] = Math.sin(th) * r;
  return out;
}

/** a braid strand's offset from the path, across (out from the axis) and up */
export function braidOffset(s: number, side: number, mix: number): [number, number] {
  const ph = (s / BRAID_BEATS) * TAU + side * Math.PI;
  const r = clamp(mix, 0, 1) * BRAID_R;
  return [Math.cos(ph) * r, Math.sin(ph) * r];
}

const pa: RGB = [0, 0, 0];
const pb: RGB = [0, 0, 0];

/**
 * Where a sample sits and which way its rung points: on the path, moved out
 * to its braid strand in a mix, the rung upright and twisting with the braid.
 */
export function place(s: number, side: number, mix: number, pos: RGB, dir: RGB): void {
  spiral(s - 0.5, pa);
  spiral(s + 0.5, pb);
  let tx = pb[0] - pa[0];
  let ty = pb[1] - pa[1];
  let tz = pb[2] - pa[2];
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const th = spiralAngle(s);
  const rx = Math.cos(th);
  const rz = Math.sin(th);
  // up: across the path, square to it and to the way out from the axis
  let ux = ty * rz;
  let uy = tz * rx - tx * rz;
  let uz = -ty * rx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  // out: square to the path and to up
  const nx = uy * tz - uz * ty;
  const ny = uz * tx - ux * tz;
  const nz = ux * ty - uy * tx;
  const [a, b] = braidOffset(s, side, mix);
  spiral(s, pos);
  pos[0] += nx * a + ux * b;
  pos[1] += ny * a + uy * b;
  pos[2] += nz * a + uz * b;
  const tw = clamp(mix, 0, 1) * (s / BRAID_BEATS) * TAU;
  const c = Math.cos(tw);
  const sn = Math.sin(tw);
  dir[0] = ux * c + nx * sn;
  dir[1] = uy * c + ny * sn;
  dir[2] = uz * c + nz * sn;
}

/** a rung's reach below and above the path: up with the level, down with the bass, both with the kick */
export function rung(level: number, kick: number, sub: number): [number, number] {
  return [0.03 + 0.2 * clamp(sub, 0, 1) + 0.08 * clamp(kick, 0, 1), 0.03 + 0.24 * clamp(level, 0, 1) + 0.06 * clamp(kick, 0, 1)];
}

/** the words under the sculpture */
export function setLabel(on: readonly number[], tracks: number, whole: boolean): string {
  if (!tracks) return 'Your set starts here';
  if (whole || !on.length) return `${on.length ? 'The whole set' : 'The set so far'} · ${tracks} ${tracks === 1 ? 'track' : 'tracks'}`;
  const sorted = [...on].sort((a, b) => a - b);
  if (sorted.length >= 2) return `Mixing ${sorted[sorted.length - 2]} into ${sorted[sorted.length - 1]}`;
  return `Track ${sorted[0]}`;
}

/* ------------------------------------------------------------------ */
/* the history                                                          */
/* ------------------------------------------------------------------ */

export class SetHistory {
  /** the set's beat clock: it runs while anything is on */
  beat = 0;
  readonly ribbons: Ribbon[] = [];
  /** bumps whenever samples already recorded change (thinning): redraw it all */
  revision = 0;
  /** bumps whenever a ribbon's colour changes */
  colorRev = 0;
  /** how far into a mix, 0..1, eased */
  mix = 0;
  private next = STEP;
  private count = 0;
  private looks = new Map<string, RGB[]>();

  constructor(private cap = CAP) {}

  /** samples held, all ribbons together */
  get samples(): number {
    return this.count;
  }

  /** the ribbons being drawn now */
  get open(): Ribbon[] {
    return this.ribbons.filter((r) => r.open);
  }

  /** a track's look arrived (it became the lead): its ribbons take its colours */
  setLook(track: string, colors: readonly string[]): void {
    const rgb = colors.map(hexToRgb).filter((c): c is RGB => !!c);
    if (!rgb.length) return;
    this.looks.set(track, rgb);
    for (const r of this.ribbons) {
      if (r.track !== track) continue;
      r.color = pickRibbonColor(rgb, this.ribbons[r.n - 2]?.color ?? null);
      this.colorRev++;
    }
  }

  record(i: HistoryInput): void {
    const decks = i.decks ?? [];
    const dt = Math.max(0, i.dt);
    const isOn = (k: number) => !!decks[k]?.track && decks[k].gain > GAIN_ON;
    // tracks that stop end their ribbons, after a little while (a fader dip in a scratch doesn't)
    for (const r of this.ribbons) {
      if (!r.open) continue;
      if (isOn(r.deck) && decks[r.deck].track === r.track) r.quiet = 0;
      else if ((r.quiet += dt) > QUIET_CLOSE) r.open = false;
    }
    let on = 0;
    let wmax = 0;
    for (let k = 0; k < decks.length; k++) {
      if (!isOn(k)) continue;
      on++;
      wmax = Math.max(wmax, decks[k].peak * decks[k].gain);
    }
    if (!on) return;
    const beats = (dt * clamp(i.bpm || 120, 60, 200)) / 60;
    this.beat += beats;
    this.mix += ((on >= 2 ? 1 : 0) - this.mix) * Math.min(1, beats / MIX_BEATS);
    for (let k = 0; k < decks.length; k++) {
      if (!isOn(k)) continue;
      const d = decks[k];
      const r = this.ribbonFor(k, d.track!);
      const share = wmax > 1e-6 ? (d.peak * d.gain) / wmax : 1;
      r.accN++;
      r.accLevel += clamp(i.level, 0, 1) * share;
      r.accKick = Math.max(r.accKick, clamp(i.kick, 0, 1) * share);
      r.accSub += clamp(i.sub, 0, 1) * share;
    }
    if (this.beat < this.next) return;
    const s = Math.floor(this.beat / STEP) * STEP;
    this.next = s + STEP;
    for (const r of this.ribbons) {
      if (!r.open || !r.accN) continue;
      r.s.push(s);
      r.level.push(r.accLevel / r.accN);
      r.kick.push(r.accKick);
      r.sub.push(r.accSub / r.accN);
      r.mix.push(this.mix);
      r.accN = r.accLevel = r.accKick = r.accSub = 0;
      this.count++;
    }
    if (this.count > this.cap) this.trim();
  }

  private ribbonFor(deck: number, track: string): Ribbon {
    const open = this.ribbons.find((r) => r.open && r.deck === deck && r.track === track);
    if (open) return open;
    // the other strand of a braid: opposite whichever track is on now
    const other = this.ribbons.find((r) => r.open && r.quiet === 0);
    const last = this.ribbons[this.ribbons.length - 1];
    const side: 0 | 1 = other ? (other.side === 0 ? 1 : 0) : last ? (last.side === 0 ? 1 : 0) : 0;
    const look = this.looks.get(track);
    const r: Ribbon = {
      n: this.ribbons.length + 1,
      track,
      deck,
      side,
      color: look ? pickRibbonColor(look, last?.color ?? null) : fallbackColor(track),
      s: [],
      level: [],
      kick: [],
      sub: [],
      mix: [],
      open: true,
      quiet: 0,
      accN: 0,
      accLevel: 0,
      accKick: 0,
      accSub: 0,
    };
    this.ribbons.push(r);
    this.colorRev++;
    return r;
  }

  /** over budget: thin the oldest finished ribbons first, then the old part of the playing ones */
  private trim(): void {
    let guard = 64;
    while (this.count > this.cap && guard-- > 0) {
      const r = pickToHalve(this.ribbons);
      let gone = r ? halve(r) : 0;
      if (!gone) for (const o of this.ribbons) if (o.open) gone += halve(o, KEEP_TAIL);
      if (!gone) break;
      this.count -= gone;
      this.revision++;
    }
  }

  /** forget the set (a new session) */
  clear(): void {
    this.ribbons.length = 0;
    this.beat = 0;
    this.mix = 0;
    this.next = STEP;
    this.count = 0;
    this.revision++;
    this.colorRev++;
  }
}

/** this session's set, fed by the visual player */
export const sessionSet = new SetHistory();
