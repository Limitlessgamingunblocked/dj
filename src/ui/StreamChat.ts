/*
 * The Bedroom's crowd (Section 5.2): a livestream chat scrolling beside the
 * stream, and a viewer count that climbs (3 to about 50) as the mix gets
 * better. Chat reacts to what you do: drops, clean transitions, trainwrecks,
 * dead air. The signature moment is a raid: viewers spike, chat floods with
 * your name, and the LED strip goes full rainbow (the venue does that part).
 * All handles are made up.
 */
import type { VibeEvent } from '../game/vibe';
import { h, setText } from './dom';

const HANDLES = ['lowend_lou', 'basslinebecca', 'tape_head', 'shufflekid', 'nightbus99', 'subwoofer_sam', 'vinyl_vic', 'hihat_hana', 'garage_gaz', 'kettle_on', 'two_step_tom', 'cdj_cat', 'jungle_jules', 'warehouse_wren', 'rollingmo', 'ravepiano', 'sunrise_sid', 'deepcut_dee'];
const COLORS = ['#ff2e88', '#b6ff3b', '#3ad7ff', '#ffb547', '#c9b6ff', '#ffb38a', '#7affc0'];

const LINES = {
  cold: ['first time catching a stream', 'hello from the sofa', 'is this live?', 'what we listening to', 'volume up pls'],
  warming: ['this is nice', 'ooh the bassline', 'proper groove', 'nodding along', 'chef’s kiss on this one'],
  grooving: ['this is going OFF', 'my neighbours hate me now', 'the swing on this', 'ID??', 'kitchen rave activated'],
  peak: ['YESSS', 'this mix 🔥', 'turn it UP', 'absolutely rinsing it', 'can’t sit still'],
  euphoric: ['BEST STREAM ON HERE', 'I’m crying in the club (my kitchen)', 'never stop', 'sending this to everyone', 'LEGEND'],
};
const REACT: Partial<Record<string, string[]>> = {
  drop: ['DROP 🔥', 'here it comes', 'WOAH'],
  transition: ['clean', 'smooth as', 'that blend 👌', 'didn’t even notice the switch'],
  trainwreck: ['uh oh', 'trainwreck lol', 'beats fighting'],
  dead_air: ['?? sound gone', 'hello??', 'did it crash'],
  comeback: ['saved it!!', 'back from the dead'],
};

export class StreamChat {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private count: HTMLElement;
  viewers = 3;
  private wanted = 3;
  private t = 0;
  private nextLine = 2;
  private raidT = -1;
  private raided = false;
  private highFor = 0;
  private rnd = Math.random;

  constructor(
    private name: () => string,
    private onRaid: () => void,
  ) {
    this.count = h('b', {}, '3');
    this.list = h('div', { class: 'sc-list', role: 'log', 'aria-label': 'Stream chat', 'aria-live': 'off' });
    this.el = h('div', { class: 'stream-chat' }, h('div', { class: 'sc-head' }, h('span', { class: 'sc-live' }, 'LIVE'), this.count, h('span', {}, ' watching')), this.list);
  }

  private post(text: string, who?: string): void {
    const handle = who ?? HANDLES[Math.floor(this.rnd() * HANDLES.length)];
    const color = COLORS[(handle.length * 7 + handle.charCodeAt(0)) % COLORS.length];
    this.list.append(h('div', { class: 'sc-msg' }, h('b', { style: { color } }, handle), ' ', text));
    while (this.list.children.length > 14) this.list.firstElementChild?.remove();
  }

  react(e: VibeEvent): void {
    const key = e.kind === 'mistake' ? e.name : e.kind;
    const lines = REACT[key];
    if (lines && this.rnd() < 0.8) this.post(lines[Math.floor(this.rnd() * lines.length)]);
  }

  /** every frame: the count follows the vibe; chat talks more when it's busy */
  update(dt: number, vibe: number, mood: keyof typeof LINES): void {
    this.t += dt;
    this.wanted = 3 + Math.round(47 * vibe * vibe);
    // the raid: a long run at the top brings another streamer's whole audience in
    if (vibe > 0.85) this.highFor += dt;
    else this.highFor = Math.max(0, this.highFor - dt * 2);
    if (!this.raided && this.highFor > 15) {
      this.raided = true;
      this.raidT = this.t;
      const raiders = 220 + Math.round(this.rnd() * 180);
      this.viewers += raiders;
      this.post(`is raiding with ${raiders} viewers!`, 'midnight_radio');
      this.onRaid();
    }
    const raiding = this.raidT >= 0 && this.t - this.raidT < 12;
    // after a raid most of them stay a while, then drift off
    const floor = this.raided ? this.wanted + 80 * Math.exp(-(this.t - this.raidT) / 240) : this.wanted;
    if (!raiding) this.viewers += (floor - this.viewers) * Math.min(1, dt * 0.3);
    setText(this.count, String(Math.max(1, Math.round(this.viewers))));
    this.nextLine -= dt * (raiding ? 8 : 0.4 + vibe * 1.6);
    if (this.nextLine <= 0) {
      this.nextLine = 1 + this.rnd() * 2;
      if (raiding) this.post(this.name().toUpperCase() + ' ' + this.name().toUpperCase() + (this.rnd() < 0.5 ? ' 🔥' : '!!'));
      else {
        const pool = LINES[mood];
        this.post(pool[Math.floor(this.rnd() * pool.length)]);
      }
    }
  }
}
