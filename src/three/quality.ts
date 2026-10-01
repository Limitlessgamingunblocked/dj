/*
 * Adaptive quality: watches frame times and steps the render load down when
 * frames run long, and back up when there's headroom, below the ceiling the
 * user picked (Low / Medium / High).
 *
 * Each step trades a little sharpness or detail for time:
 *   level 0  full render scale, full crowd detail, all effects
 *   level 1  render scale 0.85
 *   level 2  render scale 0.72, crowd switches to low detail sooner
 *   level 3  render scale 0.6, lens streaks off, visual player at 30 fps
 *   level 4  render scale 0.5, crowd low detail almost everywhere, no bloom on the screens
 *
 * Frame times are vsync-quantised (16.7 / 33.3 ms on a 60 Hz display), so
 * stepping down uses the share of slow frames over a window, and stepping up
 * is a probe: try a level higher after a long calm spell, and if it drops
 * frames, come back down and wait twice as long before trying again.
 */

export interface QualityStep {
  /** multiplier on the device-pixel-ratio cap */
  renderScale: number;
  /** multiplier on the crowd's high-detail distance */
  crowdDetail: number;
  /** anamorphic streaks / ghosts in the lens pass */
  lensFx: boolean;
  /** render the visual player every frame (false: every second frame) */
  visualizerFull: boolean;
  /** bloom inside the visual player */
  visualizerBloom: boolean;
}

export const QUALITY_STEPS: QualityStep[] = [
  { renderScale: 1, crowdDetail: 1, lensFx: true, visualizerFull: true, visualizerBloom: true },
  { renderScale: 0.85, crowdDetail: 1, lensFx: true, visualizerFull: true, visualizerBloom: true },
  { renderScale: 0.72, crowdDetail: 0.7, lensFx: true, visualizerFull: true, visualizerBloom: true },
  { renderScale: 0.6, crowdDetail: 0.5, lensFx: false, visualizerFull: false, visualizerBloom: true },
  { renderScale: 0.5, crowdDetail: 0.3, lensFx: false, visualizerFull: false, visualizerBloom: false },
];

export interface AdaptiveOptions {
  /** frame budget in ms (16.7 for 60 fps) */
  budget?: number;
  /** frames counted when deciding */
  window?: number;
  /** share of slow frames that triggers a step down */
  slowShare?: number;
  /** seconds without trouble before probing a level up */
  calm?: number;
  /** seconds to wait after any change */
  cooldown?: number;
}

export class AdaptiveQuality {
  /** current step index into QUALITY_STEPS (0 = best) */
  level = 0;
  enabled = true;
  private budget: number;
  private window: number;
  private slowShare: number;
  private calm: number;
  private cooldown: number;
  private ring: number[] = [];
  private lastChange = -1e9;
  private calmSince = 0;
  private now = 0;
  /** grows each time a probe up fails */
  private backoff = 1;
  private probing: { from: number; at: number } | null = null;

  constructor(o: AdaptiveOptions = {}) {
    this.budget = o.budget ?? 1000 / 60;
    this.window = o.window ?? 90;
    this.slowShare = o.slowShare ?? 0.25;
    this.calm = o.calm ?? 8;
    this.cooldown = o.cooldown ?? 2.5;
  }

  get step(): QualityStep {
    return QUALITY_STEPS[this.level];
  }

  reset(level = 0): void {
    this.level = Math.max(0, Math.min(QUALITY_STEPS.length - 1, level));
    this.ring.length = 0;
    this.lastChange = this.now;
    this.calmSince = this.now;
    this.probing = null;
    this.backoff = 1;
  }

  /**
   * Feed one frame's duration (ms). Returns true when the level changed.
   * Very long frames (tab switches, shader compiles) are ignored.
   */
  sample(frameMs: number): boolean {
    this.now += Math.min(frameMs, 250) / 1000;
    if (!this.enabled || frameMs > 250 || frameMs <= 0) return false;
    this.ring.push(frameMs);
    if (this.ring.length > this.window) this.ring.shift();
    const sinceChange = this.now - this.lastChange;
    if (this.ring.length < Math.min(30, this.window) || sinceChange < this.cooldown) return false;
    const slowLimit = this.budget * 1.35;
    let slow = 0;
    for (const t of this.ring) if (t > slowLimit) slow++;
    const share = slow / this.ring.length;
    if (share > this.slowShare) {
      // a failed probe goes back and waits longer next time
      if (this.probing && this.level === this.probing.from - 1) this.backoff = Math.min(8, this.backoff * 2);
      this.probing = null;
      this.calmSince = this.now;
      if (this.level < QUALITY_STEPS.length - 1) return this.change(this.level + 1);
      return false;
    }
    if (share > this.slowShare / 3) {
      this.calmSince = this.now;
      return false;
    }
    if (this.probing && this.now - this.probing.at > this.calm * 0.75) {
      // the probe held: accept it
      this.probing = null;
      this.backoff = Math.max(1, this.backoff / 2);
    }
    if (this.level > 0 && !this.probing && this.now - this.calmSince > this.calm * this.backoff) {
      this.probing = { from: this.level, at: this.now };
      return this.change(this.level - 1);
    }
    return false;
  }

  private change(level: number): boolean {
    if (level === this.level) return false;
    this.level = level;
    this.lastChange = this.now;
    this.calmSince = this.now;
    this.ring.length = 0;
    return true;
  }
}

/** Distance (m) inside which a crowd chunk uses the detailed dancer model. */
export function crowdDetailDistance(base: number, detail: number): number {
  return base * detail;
}

/** Pick the detail level for something `distance` metres away. */
export function lodFor(distance: number, nearDistance: number): 0 | 1 {
  return distance <= nearDistance ? 0 : 1;
}
