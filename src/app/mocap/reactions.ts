/*
 * The moves the room answers, from body tracking's pose. No camera or
 * browser in here (tracker.ts finds the body), so it runs in the tests.
 *
 * - Both hands up above your head, held a moment: the "hands up" DJ move,
 *   and the crowd copies it.
 * - Keep them up and you have crowd control: sway your arms left and right
 *   and the whole room's arms go up and sway with yours, until you bring
 *   them down.
 *
 * Everything is measured against your own shoulders, so it works sitting
 * close to the camera or standing back from it.
 */
import { POSE, seen, type PoseIn } from './landmarks';

export interface ReactionTarget {
  handsUp(): void;
  /** crowd control: your arms' lean, -1 (your left) to +1 (your right), or null when they come down */
  crowdSway(lean: number | null): void;
}

/** a wrist this far above the nose (in shoulder widths) is a hand up */
export const UP_ABOVE_NOSE = 0.15;
const HANDS_UP_HOLD = 0.35;
const HANDS_UP_COOLDOWN = 4;
/** shoulder widths of sway from the middle for a full lean */
export const SWAY_RANGE = 1.1;
/** how long crowd control waits for a hand to come back up before it lets go (s) */
const CROWD_LOST = 0.5;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** the hands, nose and shoulders in a mirror picture (x 0 at your left), with how wide the shoulders are */
interface Body {
  wrists: ({ x: number; y: number } | null)[];
  noseY: number;
  shoulderY: number;
  width: number;
}

function read(p: PoseIn): Body | null {
  const sl = p.lm[POSE.shoulder.L];
  const sr = p.lm[POSE.shoulder.R];
  if (!seen(sl) || !seen(sr)) return null;
  const width = Math.max(0.03, Math.hypot(sl.x - sr.x, sl.y - sr.y));
  const nose = p.lm[POSE.nose];
  const shoulderY = (sl.y + sr.y) / 2;
  const wrists = [POSE.wrist.L, POSE.wrist.R].map((i) => {
    const w = p.lm[i];
    return seen(w, 0.4) ? { x: 1 - w.x, y: w.y } : null;
  });
  return { wrists, noseY: seen(nose) ? nose.y : shoulderY - width * 0.6, shoulderY, width };
}

export class Reactions {
  private upFor = 0;
  private upCooldown = 0;
  /** set for a moment after "hands up" fires, for the camera window */
  handsUpFlash = 0;
  /** crowd control is on: your arms are up and the crowd's sway with them */
  crowd = false;
  /** where your arms are, -1 (your left) to +1 (your right), while crowd control's on */
  lean = 0;
  private centre = 0.5;
  private lost = 0;

  constructor(private t: ReactionTarget) {}

  /** one camera frame's pose (null: nobody in view), `dt` seconds since the last */
  update(pose: PoseIn | null, dt: number): void {
    this.upCooldown = Math.max(0, this.upCooldown - dt);
    this.handsUpFlash = Math.max(0, this.handsUpFlash - dt);
    const b = pose ? read(pose) : null;
    const up = b ? b.wrists.filter((w): w is { x: number; y: number } => !!w && w.y < b.noseY - UP_ABOVE_NOSE * b.width) : [];
    if (up.length === 2) {
      this.upFor += dt;
      if (this.upFor >= HANDS_UP_HOLD && this.upCooldown <= 0) {
        this.t.handsUp();
        this.upCooldown = HANDS_UP_COOLDOWN;
        this.handsUpFlash = 1.2;
      }
    } else this.upFor = 0;
    this.checkCrowd(b, dt);
  }

  /**
   * Crowd control: starts with "hands up" and stays on while a hand's above
   * the shoulders. The lean is where the raised hands are, from the middle
   * of where you've been swaying (so standing off to one side of the
   * picture doesn't tip the crowd over).
   */
  private checkCrowd(b: Body | null, dt: number): void {
    if (!this.crowd) {
      if (this.upFor < HANDS_UP_HOLD || !b) return;
      this.crowd = true;
      this.lost = 0;
      this.centre = (b.wrists[0]!.x + b.wrists[1]!.x) / 2;
      this.lean = 0;
    }
    const high = b ? b.wrists.filter((w): w is { x: number; y: number } => !!w && w.y < b.shoulderY) : [];
    if (!b || !high.length) {
      this.lost += dt;
      if (this.lost > CROWD_LOST) this.release();
      return;
    }
    this.lost = 0;
    const x = high.reduce((a, w) => a + w.x, 0) / high.length;
    this.centre += (x - this.centre) * Math.min(1, dt * 0.2);
    this.lean = clamp01(0.5 + (x - this.centre) / (SWAY_RANGE * b.width * 2)) * 2 - 1;
    this.t.crowdSway(this.lean);
  }

  /** let the crowd go (the camera stopped, or nobody's there) */
  release(): void {
    if (this.crowd) this.t.crowdSway(null);
    this.crowd = false;
    this.lean = 0;
    this.upFor = 0;
    this.lost = 0;
  }
}
