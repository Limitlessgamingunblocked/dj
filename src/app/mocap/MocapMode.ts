/*
 * Body tracking: your DJ moves like you in front of the webcam. The camera
 * and models are in tracker.ts (and its worker), the pose for the character
 * in retarget.ts, the moves the room answers in reactions.ts and the window
 * on the stage in ui/MocapPanel.ts; this ties them to the game.
 *
 * The camera's frames come in a few dozen times a second; the game draws
 * faster, so each game frame eases the character towards the latest pose
 * (update()), and when you step out of view, or tracking's off, each part
 * fades back to the character's own moves.
 */
import { easeFrame, frameActive, newFrame, MOCAP_PARTS, type MocapFrame } from '../../character/mocapFrame';
import type { ControlRegistry } from '../../core/controls';
import { loadSetting, saveSetting } from '../../core/settings';
import { crowdShow } from '../../three/venues/crowdShow';
import { toast } from '../../ui/toast';
import { MocapPanel } from '../../ui/MocapPanel';
import { introSeen, openMocapGuide } from '../../ui/MocapIntro';
import type { MocapIn } from './landmarks';
import { Reactions } from './reactions';
import { DEFAULT_OPTS, Retargeter, type MocapOpts } from './retarget';
import { BodyTracker, startError } from './tracker';

const OPTS = 'mocap.opts';
/** how long the last camera frame counts for before the character starts letting go (s) */
const STALE = 0.5;

export class MocapMode {
  on = false;
  /** what the character shows, eased each game frame */
  readonly frame: MocapFrame = newFrame();
  opts: MocapOpts = { ...DEFAULT_OPTS, ...loadSetting<Partial<MocapOpts>>(OPTS, {}) };
  private tracker = new BodyTracker();
  private retarget = new Retargeter();
  private reactions: Reactions;
  private panel: MocapPanel;
  private sinceSeen = 1e9;

  constructor(
    reg: ControlRegistry,
    private stageEl: HTMLElement,
    private changed: (on: boolean) => void = () => {},
    /** whether the player's character can pull faces (a scanned one only turns its head) */
    private hasFace: () => boolean = () => true,
  ) {
    this.reactions = new Reactions({
      handsUp: () => reg.press('dj.move.1', 'air'),
      crowdSway: (lean) => crowdShow.setSway(lean),
    });
    this.panel = new MocapPanel(this.tracker.video, this.opts, {
      close: () => this.set(false),
      guide: () => openMocapGuide(),
      recenter: () => this.retarget.recenter(),
      set: (key, on) => {
        this.opts = { ...this.opts, [key]: on };
        saveSetting(OPTS, this.opts);
        this.parts();
      },
    });
    this.parts();
    this.tracker.onStatus = (s, message) => this.panel.setStatus(s, message);
    this.tracker.onSeen = (seen, dt) => this.seen(seen, dt);
  }

  /** the face and hand models only run while they're wanted */
  private parts(): void {
    this.tracker.parts = { face: this.opts.face, hands: this.opts.hands };
  }

  private seen(seen: MocapIn, dt: number): void {
    this.sinceSeen = 0;
    this.retarget.update(seen, dt, this.opts);
    this.reactions.update(seen.pose, dt);
    const r = this.reactions;
    this.panel.draw(seen, frameActive(this.frame) ? this.frame : null, r.handsUpFlash > 0, r.crowd ? r.lean : null, !!seen.pose && !this.retarget.calibrated, this.opts.face && !this.hasFace());
  }

  set(on: boolean): void {
    if (on === this.on) return;
    if (on && !navigator.mediaDevices?.getUserMedia) {
      toast('Body tracking needs a webcam, and a browser that lets this page use it.', 'error');
      return;
    }
    // the first time, the guide explains it all before the camera asks
    if (on && !introSeen()) return openMocapGuide(() => this.set(true));
    this.on = on;
    if (on) {
      this.panel.recolor();
      this.panel.showHelp(false);
      this.retarget.recenter();
      this.stageEl.append(this.panel.el);
      this.tracker.start().catch((e) => {
        const msg = startError(e);
        this.panel.setStatus('error', msg);
        toast(msg, 'error');
      });
    } else {
      this.tracker.stop();
      this.reactions.release();
      this.panel.el.remove();
    }
    this.changed(this.on);
  }

  /**
   * Every game frame: the character eased towards the latest pose, or back
   * to its own moves when there's no one to copy. Null once nothing of the
   * player shows.
   */
  update(dt: number): MocapFrame | null {
    this.sinceSeen += dt;
    const f = this.frame;
    const live = this.on && this.sinceSeen < STALE;
    if (live) easeFrame(f, this.retarget.frame, 1 - Math.exp(-dt * 22), 1 - Math.exp(-dt * 6), 1 - Math.exp(-dt * 3));
    else {
      // (the pose stays where it was while it fades, so nothing swings on the way out)
      const k = 1 - Math.exp(-dt * 3);
      for (const p of MOCAP_PARTS) f.w[p] = f.w[p] < 1e-3 ? 0 : f.w[p] * (1 - k);
      if (this.on && this.sinceSeen > 1) this.reactions.release();
    }
    return frameActive(f) ? f : null;
  }
}
