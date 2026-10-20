/*
 * Silent disco showdown: two DJs play at the same time, each on their own
 * headphone channel (blue and red), and the room picks. Everyone's on one
 * channel or the other, and their headphones glow its colour; a better mix
 * pulls people over to yours. Friends watching can flip channels themselves.
 * Whoever holds most of the room when the time's up wins.
 *
 * Pure logic, run by the host: each DJ's pull comes from their own vibe
 * meter (game/vibe.ts) plus a kick for a clean transition or a big drop and
 * a knock for a trainwreck or dead air; the room drifts towards the stronger
 * pull, never all at once.
 */
import type { VibeEvent } from './vibe';

export type Channel = 'blue' | 'red';
export const CHANNELS: Channel[] = ['blue', 'red'];
export const CHANNEL_COLOR: Record<Channel, string> = { blue: '#2f8bff', red: '#ff3b4a' };
export const CHANNEL_NAME: Record<Channel, string> = { blue: 'Blue', red: 'Red' };
export const other = (c: Channel): Channel => (c === 'blue' ? 'red' : 'blue');

/** how long a showdown runs, in minutes */
export const LENGTHS = [5, 10, 20];

/** the room's dancers count as this many people against the friends watching */
export const CROWD_PEOPLE = 40;
/** how far the room moves in a second at most (a full swing takes a while) */
const DRIFT = 0.025;
/** however good one side is, a few stay loyal to the other */
const HOLD_OUT = 0.08;

/** how clean a named transition was, 0..1 */
const BAND_CLEAN: Record<string, number> = { perfect: 1, good: 0.75, loose: 0.4, trainwreck: 0 };

/**
 * One DJ's pull on the room, 0..~1.3: their vibe meter, plus a kick that
 * fades over a few seconds after a clean transition or a big drop (and a
 * knock after a mistake). Silence pulls nobody.
 */
export class Pull {
  value = 0;
  private kick = 0;

  event(ev: VibeEvent): void {
    if (ev.kind === 'transition') this.kick += 0.1 + 0.2 * (BAND_CLEAN[ev.band] ?? 0.5);
    else if (ev.kind === 'drop') this.kick += ev.built ? 0.22 : 0.05;
    else if (ev.kind === 'comeback') this.kick += 0.12;
    else if (ev.kind === 'mistake') this.kick -= ev.name === 'trainwreck' ? 0.28 : ev.name === 'dead_air' ? 0.3 : ev.name === 'key_clash' ? 0.12 : 0.06;
    this.kick = Math.max(-0.5, Math.min(0.5, this.kick));
  }

  update(dt: number, vibe: number, playing: boolean): number {
    this.kick *= Math.exp(-dt / 8);
    this.value = playing ? Math.max(0, Math.min(1.3, vibe + this.kick)) : 0;
    return this.value;
  }
}

/** where the room wants to be (blue's share) for the two pulls */
export function targetShare(blue: number, red: number): number {
  const lean = Math.tanh(2.5 * (blue - red));
  return 0.5 + (0.5 - HOLD_OUT) * lean;
}

/** blue's share of everyone: the dancers, and the friends watching on each channel */
export function roomShare(crowd: number, watching: { blue: number; red: number }): number {
  const n = CROWD_PEOPLE + watching.blue + watching.red;
  return (crowd * CROWD_PEOPLE + watching.blue) / n;
}

export function winnerOf(share: number): Channel | 'tie' {
  if (share > 0.505) return 'blue';
  if (share < 0.495) return 'red';
  return 'tie';
}

export type ShowdownNote =
  | { kind: 'lead'; to: Channel }
  | { kind: 'swing'; to: Channel }
  | { kind: 'final' }
  | { kind: 'over'; winner: Channel | 'tie'; share: number };

/** the showdown as the host runs it */
export class Showdown {
  phase: 'live' | 'over' = 'live';
  t = 0;
  /** blue's share of the dancers, 0..1 */
  crowd = 0.5;
  readonly pulls = { blue: 0, red: 0 };
  /** blue's share of the room every 5 seconds, for the results */
  readonly history: number[] = [0.5];
  private watchers = new Map<string, Channel>();
  private lead: Channel | null = null;
  private swingAt = -1e9;
  private finalSaid = false;
  private sampleT = 0;

  constructor(readonly minutes: number) {}

  get length(): number {
    return this.minutes * 60;
  }

  get remaining(): number {
    return Math.max(0, this.length - this.t);
  }

  /** friends on each channel */
  get watching(): { blue: number; red: number } {
    const w = { blue: 0, red: 0 };
    for (const c of this.watchers.values()) w[c]++;
    return w;
  }

  /** blue's share of the whole room */
  get share(): number {
    return roomShare(this.crowd, this.watching);
  }

  setPull(ch: Channel, v: number): void {
    this.pulls[ch] = Number.isFinite(v) ? Math.max(0, Math.min(1.3, v)) : 0;
  }

  /** a friend watching flips to a channel */
  flip(id: string, ch: Channel): void {
    if (this.phase === 'live') this.watchers.set(id, ch);
  }

  leave(id: string): void {
    this.watchers.delete(id);
  }

  update(dt: number): ShowdownNote[] {
    const out: ShowdownNote[] = [];
    if (this.phase !== 'live') return out;
    this.t += dt;
    const want = targetShare(this.pulls.blue, this.pulls.red);
    const step = Math.max(-DRIFT * dt, Math.min(DRIFT * dt, want - this.crowd));
    this.crowd += step;
    const share = this.share;
    this.sampleT += dt;
    if (this.sampleT >= 5) {
      this.sampleT -= 5;
      this.history.push(share);
    }
    // who's ahead (it has to be clear: no flip-flopping round the middle)
    const lead: Channel | null = share > 0.53 ? 'blue' : share < 0.47 ? 'red' : this.lead;
    if (lead && lead !== this.lead) {
      this.lead = lead;
      out.push({ kind: 'lead', to: lead });
    }
    // a big swing over the last 15 seconds
    const back = this.history[Math.max(0, this.history.length - 4)];
    if (this.t - this.swingAt > 25 && Math.abs(share - back) > 0.1) {
      this.swingAt = this.t;
      out.push({ kind: 'swing', to: share > back ? 'blue' : 'red' });
    }
    if (!this.finalSaid && this.remaining <= 60 && this.length > 90) {
      this.finalSaid = true;
      out.push({ kind: 'final' });
    }
    if (this.remaining <= 0) {
      this.phase = 'over';
      this.history.push(share);
      out.push({ kind: 'over', winner: winnerOf(share), share });
    }
    return out;
  }
}

/** a stand-in DJ to practise against: a pull that wanders, with a good mix now and then and the odd slip */
export class PracticeRival {
  private v = 0.45;
  private kick = 0;
  private nextMix = 40;
  t = 0;

  constructor(
    /** 0..1: how good they are */
    readonly skill = 0.5,
    private rand: () => number = Math.random,
  ) {}

  update(dt: number): number {
    this.t += dt;
    const base = 0.35 + 0.35 * this.skill;
    this.v += (base - this.v) * Math.min(1, dt * 0.05) + (this.rand() - 0.5) * 0.04 * Math.sqrt(dt);
    this.kick *= Math.exp(-dt / 8);
    if (this.t >= this.nextMix) {
      this.nextMix = this.t + 45 + this.rand() * 50;
      this.kick += this.rand() < 0.15 + 0.6 * this.skill ? 0.25 : -0.25;
    }
    return Math.max(0, Math.min(1.3, this.v + this.kick));
  }
}
