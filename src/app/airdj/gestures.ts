/*
 * Air DJ's gestures: hand landmarks in, deck moves out. No camera or
 * browser in here (tracker.ts finds the hands), so it runs in the tests.
 *
 * Each hand works the deck on its side of the picture (the picture is
 * mirrored, so your right hand is on the right):
 * - pinch (thumb and index together): grab the record. Move the hand left
 *   and right to scratch; let go to drop it.
 * - open palm: the channel filter. Raise the hand to sweep the high-pass up,
 *   lower it for the low-pass; take the hand away and it glides back to off.
 * - peace sign (index and middle up): beat FX on that channel while held,
 *   higher for more.
 * - point (index only): the crossfader. Slide the finger left and right.
 * - both open palms up high: the "hands up" DJ move, and the crowd copies it.
 *   Keep them up and you have crowd control: sway your arms left and right
 *   and the whole room's arms go up and sway with yours, until you bring
 *   them down.
 * - a fist does nothing: rest there between moves.
 *
 * Every move is relative to where it starts (the filter and crossfader pick
 * up from where they are), so nothing jumps when a hand comes into view.
 */

export interface Pt {
  x: number;
  y: number;
}

export type Side = 'L' | 'R';
export type Pose = 'pinch' | 'open' | 'peace' | 'point' | 'fist' | 'none';

/** what Air DJ moves: the app binds these to its controls */
export interface AirTarget {
  touchJog(side: Side, on: boolean): void;
  turnJog(side: Side, revs: number): void;
  filter(side: Side): number;
  setFilter(side: Side, v: number): void;
  fx(side: Side, on: boolean): void;
  setFxDepth(v: number): void;
  crossfader(): number;
  setCrossfader(v: number): void;
  handsUp(): void;
  /** crowd control: your arms' lean, -1 (your left) to +1 (your right), or null when they come down */
  crowdSway?(lean: number | null): void;
}

/** one hand's state, for drawing over the camera picture */
export interface HandView {
  side: Side;
  pose: Pose;
  /** what it's doing right now ("SCRATCH", "FILTER HPF 40%"…), or '' */
  action: string;
  lm: Pt[];
}

/* MediaPipe's 21 hand landmarks */
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX = { mcp: 5, pip: 6, tip: 8 };
const MIDDLE = { mcp: 9, pip: 10, tip: 12 };
const RING = { mcp: 13, pip: 14, tip: 16 };
const PINKY = { mcp: 17, pip: 18, tip: 20 };

/** record turns per full picture width of hand travel (1.8 s of audio per turn) */
export const SCRATCH_GAIN = 0.8;
/** filter travel per picture height of hand travel (0.5 is centre to full) */
export const FILTER_GAIN = 1.4;
/** crossfader travel per picture width */
export const XFADE_GAIN = 1.6;
/** the band above this height (0 top, 1 bottom) is for "hands up" */
export const TOP_ZONE = 0.22;
/** frames a new pose must hold before it counts (pinch counts at once) */
const SETTLE = 2;
/** how long a hand can vanish before its move is let go (s) */
const LOST = 0.15;
/** filter glide back to off after the palm leaves (s) */
const GLIDE = 0.35;
const HANDS_UP_HOLD = 0.35;
const HANDS_UP_COOLDOWN = 4;
/** once crowd control's on, a hand counts as "up" while its wrist is above this */
export const CROWD_ZONE = 0.45;
/** picture widths of sway from the middle for a full lean */
export const SWAY_RANGE = 0.22;
/** how long crowd control waits for a hand to come back up before it lets go (s) */
const CROWD_LOST = 0.5;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function extended(lm: Pt[], f: { mcp: number; pip: number; tip: number }): boolean {
  const w = lm[WRIST];
  return dist(w, lm[f.tip]) > dist(w, lm[f.pip]) * 1.12 && dist(w, lm[f.tip]) > dist(w, lm[f.mcp]) * 1.3;
}

/** the hand's size in the picture (wrist to the middle knuckle), so gestures work near or far */
export function handSize(lm: Pt[]): number {
  return Math.max(1e-3, dist(lm[WRIST], lm[MIDDLE.mcp]));
}

/** how far thumb and index tips are apart, in hand sizes */
export function pinchRatio(lm: Pt[]): number {
  return dist(lm[THUMB_TIP], lm[INDEX.tip]) / handSize(lm);
}

/**
 * The pose a hand is making. `wasPinch` adds hysteresis: a pinch closes
 * under 0.32 hand sizes and only opens again past 0.5.
 */
export function classify(lm: Pt[], wasPinch = false): Pose {
  if (lm.length < 21) return 'none';
  const ix = extended(lm, INDEX);
  const md = extended(lm, MIDDLE);
  const rg = extended(lm, RING);
  const pk = extended(lm, PINKY);
  // a pinch keeps the index out from the palm (a fist tucks it in, with the thumb over it)
  const indexOut = dist(lm[WRIST], lm[INDEX.tip]) > dist(lm[WRIST], lm[INDEX.mcp]) * 1.05;
  if (indexOut && pinchRatio(lm) < (wasPinch ? 0.5 : 0.32)) return 'pinch';
  if (ix && md && rg && pk) return 'open';
  if (ix && md && !rg && !pk) return 'peace';
  if (ix && !md && !rg && !pk) return 'point';
  if (!ix && !md && !rg && !pk) return 'fist';
  return 'none';
}

/** the point a pose works from: between the pinched fingers, the index tip, or the palm */
function anchor(lm: Pt[], pose: Pose): Pt {
  if (pose === 'pinch') return { x: (lm[THUMB_TIP].x + lm[INDEX.tip].x) / 2, y: (lm[THUMB_TIP].y + lm[INDEX.tip].y) / 2 };
  if (pose === 'point') return lm[INDEX.tip];
  return lm[MIDDLE.mcp];
}

function filterLabel(v: number): string {
  if (Math.abs(v - 0.5) < 0.02) return 'FILTER OFF';
  return `${v < 0.5 ? 'LPF' : 'HPF'} ${Math.round(Math.abs(v - 0.5) * 200)}%`;
}

interface Slot {
  side: Side;
  present: boolean;
  lostFor: number;
  lm: Pt[];
  pose: Pose;
  candidate: Pose;
  candidateFrames: number;
  /** the anchor, smoothed */
  at: Pt | null;
  /** the move under way, and where it started */
  move: Pose;
  start: Pt;
  startValue: number;
  lastX: number;
  /** the filter is gliding back to off */
  gliding: boolean;
  action: string;
}

const newSlot = (side: Side): Slot => ({
  side,
  present: false,
  lostFor: 0,
  lm: [],
  pose: 'none',
  candidate: 'none',
  candidateFrames: 0,
  at: null,
  move: 'none',
  start: { x: 0, y: 0 },
  startValue: 0,
  lastX: 0,
  gliding: false,
  action: '',
});

export class AirDJ {
  private slots: Record<Side, Slot> = { L: newSlot('L'), R: newSlot('R') };
  /** which hand has the crossfader (one at a time) */
  private xfadeBy: Side | null = null;
  private upFor = 0;
  private upCooldown = 0;
  /** set for a moment after "hands up" fires, for the picture */
  handsUpFlash = 0;
  /** crowd control is on: your arms are up and the crowd's sway with them */
  crowd = false;
  /** where your arms are, -1 (your left) to +1 (your right), while crowd control's on */
  lean = 0;
  private crowdCentre = 0.5;
  private crowdLost = 0;

  constructor(private t: AirTarget) {}

  /**
   * One camera frame: the hands seen (landmarks with x 0 at the viewer's
   * left, y 0 at the top) and the time since the last frame in seconds.
   */
  update(hands: Pt[][], dt: number): HandView[] {
    this.upCooldown = Math.max(0, this.upCooldown - dt);
    this.handsUpFlash = Math.max(0, this.handsUpFlash - dt);
    const seen = this.assign(hands);
    for (const side of ['L', 'R'] as Side[]) {
      const s = this.slots[side];
      const lm = seen[side];
      if (lm) {
        s.present = true;
        s.lostFor = 0;
        s.lm = lm;
        this.settle(s, classify(lm, s.pose === 'pinch'));
      } else if (s.present) {
        s.lostFor += dt;
        if (s.lostFor > LOST) {
          s.present = false;
          s.pose = s.candidate = 'none';
          s.lm = [];
        }
      }
    }
    this.checkHandsUp(dt);
    this.checkCrowd(dt);
    for (const side of ['L', 'R'] as Side[]) this.drive(this.slots[side], dt);
    return (['L', 'R'] as Side[])
      .map((side) => this.slots[side])
      .filter((s) => s.present && s.lm.length)
      .map((s) => ({ side: s.side, pose: s.pose, action: s.action, lm: s.lm }));
  }

  /** let everything go (the camera stopped) */
  release(): void {
    for (const side of ['L', 'R'] as Side[]) {
      const s = this.slots[side];
      this.end(s);
      if (s.gliding) this.t.setFilter(side, 0.5);
      this.slots[side] = newSlot(side);
    }
    this.xfadeBy = null;
    if (this.crowd) this.t.crowdSway?.(null);
    this.crowd = false;
    this.lean = 0;
    this.upFor = 0;
  }

  /** which side each hand is: by position, but a hand mid-move keeps its side */
  private assign(hands: Pt[][]): Partial<Record<Side, Pt[]>> {
    const hs = hands.filter((lm) => lm.length >= 21).slice(0, 2);
    if (hs.length === 2) {
      const [a, b] = hs[0][WRIST].x <= hs[1][WRIST].x ? hs : [hs[1], hs[0]];
      return { L: a, R: b };
    }
    if (hs.length === 1) {
      const lm = hs[0];
      const w = lm[WRIST];
      for (const side of ['L', 'R'] as Side[]) {
        const s = this.slots[side];
        if (s.move !== 'none' && s.lm.length && dist(s.lm[WRIST], w) < 0.25) return { [side]: lm };
      }
      return { [w.x < 0.5 ? 'L' : 'R']: lm };
    }
    return {};
  }

  /** a new pose has to hold for a couple of frames, so a blur between two poses doesn't fire a third */
  private settle(s: Slot, pose: Pose): void {
    if (pose === s.pose) {
      s.candidate = pose;
      s.candidateFrames = 0;
      return;
    }
    if (pose === s.candidate) s.candidateFrames++;
    else {
      s.candidate = pose;
      s.candidateFrames = 1;
    }
    // grabbing the record has to be instant, like touching a platter
    if (pose === 'pinch' || s.candidateFrames >= SETTLE) s.pose = pose;
  }

  private checkHandsUp(dt: number): void {
    const { L, R } = this.slots;
    const up = (s: Slot) => s.present && s.pose === 'open' && s.lm[MIDDLE.mcp].y < TOP_ZONE;
    if (up(L) && up(R)) {
      this.upFor += dt;
      if (this.upFor >= HANDS_UP_HOLD && this.upCooldown <= 0) {
        this.t.handsUp();
        this.upCooldown = HANDS_UP_COOLDOWN;
        this.handsUpFlash = 1.2;
      }
    } else this.upFor = 0;
  }

  /** a hand in the air, for crowd control (any open-ish hand, not a pinch, point or peace sign) */
  private high(s: Slot): boolean {
    return s.present && (s.pose === 'open' || s.pose === 'fist' || s.pose === 'none') && s.lm[WRIST].y < CROWD_ZONE;
  }

  /**
   * Crowd control: starts with "hands up" (both palms up high) and stays on
   * while a hand's in the air. The lean is where the raised hands are, from
   * the middle of where you've been swaying (so standing off to one side of
   * the picture doesn't tip the crowd over).
   */
  private checkCrowd(dt: number): void {
    const { L, R } = this.slots;
    if (!this.crowd) {
      if (this.upFor < HANDS_UP_HOLD) return;
      this.crowd = true;
      this.crowdLost = 0;
      this.crowdCentre = (L.lm[MIDDLE.mcp].x + R.lm[MIDDLE.mcp].x) / 2;
      this.lean = 0;
    }
    const up = [L, R].filter((s) => this.high(s));
    if (!up.length) {
      this.crowdLost += dt;
      if (this.crowdLost > CROWD_LOST) {
        this.crowd = false;
        this.lean = 0;
        this.t.crowdSway?.(null);
      }
      return;
    }
    this.crowdLost = 0;
    const x = up.reduce((a, s) => a + s.lm[MIDDLE.mcp].x, 0) / up.length;
    this.crowdCentre += (x - this.crowdCentre) * Math.min(1, dt * 0.2);
    this.lean = clamp01(0.5 + (x - this.crowdCentre) / (SWAY_RANGE * 2)) * 2 - 1;
    this.t.crowdSway?.(this.lean);
  }

  private drive(s: Slot, dt: number): void {
    // a hand in the air under crowd control works the crowd, not the decks
    if (this.crowd && this.high(s)) {
      if (s.move !== 'none') this.end(s);
      s.at = null;
      s.action = this.lean < -0.25 ? '◀ CROWD' : this.lean > 0.25 ? 'CROWD ▶' : 'CROWD';
      this.glide(s, dt);
      return;
    }
    if (s.move === 'none') s.action = '';
    const pose = s.present ? s.pose : 'none';
    const active = pose === 'pinch' || pose === 'open' || pose === 'peace' || (pose === 'point' && (this.xfadeBy === null || this.xfadeBy === s.side));
    const want: Pose = active ? pose : 'none';
    if (want !== s.move) {
      this.end(s);
      if (want !== 'none') this.begin(s, want);
    }
    if (s.move !== 'none') {
      const raw = anchor(s.lm, s.move);
      // light smoothing: enough to steady the jitter, little enough to keep a scratch tight
      s.at = s.at ? { x: s.at.x + (raw.x - s.at.x) * 0.65, y: s.at.y + (raw.y - s.at.y) * 0.65 } : raw;
      this.hold(s);
    } else s.at = null;
    this.glide(s, dt);
  }

  /** the filter sliding back to off after the palm's gone */
  private glide(s: Slot, dt: number): void {
    if (s.gliding) {
      const v = this.t.filter(s.side);
      const step = (0.5 / GLIDE) * dt;
      const next = Math.abs(v - 0.5) <= step ? 0.5 : v + Math.sign(0.5 - v) * step;
      this.t.setFilter(s.side, next);
      if (next === 0.5) s.gliding = false;
    }
  }

  private begin(s: Slot, pose: Pose): void {
    const at = anchor(s.lm, pose);
    s.move = pose;
    s.at = at;
    s.start = at;
    s.lastX = at.x;
    s.action = '';
    if (pose === 'pinch') {
      this.t.touchJog(s.side, true);
      s.action = 'SCRATCH';
    } else if (pose === 'open') {
      s.gliding = false;
      s.startValue = this.t.filter(s.side);
    } else if (pose === 'peace') {
      this.t.fx(s.side, true);
    } else if (pose === 'point') {
      this.xfadeBy = s.side;
      s.startValue = this.t.crossfader();
    }
  }

  private hold(s: Slot): void {
    const at = s.at!;
    if (s.move === 'pinch') {
      const dx = at.x - s.lastX;
      s.lastX = at.x;
      if (Math.abs(dx) > 0.0015) this.t.turnJog(s.side, dx * SCRATCH_GAIN);
    } else if (s.move === 'open') {
      // up in the "hands up" band the filter holds still
      if (at.y < TOP_ZONE) {
        s.action = 'HANDS UP?';
        return;
      }
      let v = clamp01(s.startValue + (s.start.y - at.y) * FILTER_GAIN);
      if (Math.abs(v - 0.5) < 0.03) v = 0.5;
      this.t.setFilter(s.side, v);
      s.action = filterLabel(v);
    } else if (s.move === 'peace') {
      const depth = clamp01(0.2 + (0.85 - at.y) * 1.25);
      this.t.setFxDepth(depth);
      s.action = `FX ${Math.round(depth * 100)}%`;
    } else if (s.move === 'point') {
      const v = clamp01(s.startValue + (at.x - s.start.x) * XFADE_GAIN);
      this.t.setCrossfader(v);
      s.action = `XFADE ${Math.round(v * 100)}`;
    }
  }

  private end(s: Slot): void {
    if (s.move === 'pinch') this.t.touchJog(s.side, false);
    else if (s.move === 'open') s.gliding = this.t.filter(s.side) !== 0.5;
    else if (s.move === 'peace') this.t.fx(s.side, false);
    else if (s.move === 'point' && this.xfadeBy === s.side) this.xfadeBy = null;
    s.move = 'none';
    s.action = '';
  }
}
