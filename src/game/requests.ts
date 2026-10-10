/*
 * Crowd requests: every couple of minutes the floor asks for something, and
 * you have a while to give it to them. When the room is off the slot's curve
 * they ask to get back on it (more energy, or take it down); otherwise for a
 * moment: a drop, a long blend, a filter fade, something new. A request met
 * pays points and lifts the vibe; one that runs out costs a little.
 *
 * Pure: the gig feeds it the room's energy, the slot's target and the vibe
 * meter's events.
 */
import type { SlotId, VibeEvent } from './vibe';

export type RequestKind = 'lift' | 'calm' | 'drop' | 'blend' | 'filter' | 'fresh';

export interface CrowdRequest {
  kind: RequestKind;
  /** what the crowd says */
  text: string;
  /** set seconds it was asked, and when it runs out */
  at: number;
  until: number;
  points: number;
  /** the room's energy when it was asked */
  from: number;
}

export type RequestEvent = { kind: 'request'; what: 'ask' | 'met' | 'missed'; req: CrowdRequest; t: number };

const TEXT: Record<RequestKind, string> = {
  lift: 'More energy!',
  calm: 'Take it down a notch',
  drop: 'Drop it!',
  blend: 'Give us a long blend',
  filter: 'Filter the next one in',
  fresh: 'Something new!',
};

/** seconds to answer, and what it pays */
const TERMS: Record<RequestKind, [number, number]> = {
  lift: [75, 120],
  calm: [75, 120],
  drop: [120, 150],
  blend: [150, 160],
  filter: [150, 140],
  fresh: [120, 100],
};

/** what met requests and missed ones do to the vibe */
export const REQUEST_VIBE = { met: 0.05, missed: -0.02 };

export interface RequestInput {
  t: number;
  energy: number;
  target: number;
  /** seconds left in the set */
  remaining: number;
  live: boolean;
}

export class Requests {
  current: CrowdRequest | null = null;
  met = 0;
  asked = 0;
  private nextAt = 75;

  constructor(
    private slot: SlotId,
    private rnd: () => number = Math.random,
  ) {}

  /** what the floor wants now, given how the room sits against the slot */
  choose(i: RequestInput): RequestKind {
    if (i.energy < i.target - 0.08) return 'lift';
    if (i.energy > i.target + 0.1) return 'calm';
    const pool: RequestKind[] = ['blend', 'fresh', 'filter'];
    // warm-ups and afterhours don't want drops
    if (this.slot === 'peak' || this.slot === 'closing') pool.push('drop', 'drop');
    return pool[Math.floor(this.rnd() * pool.length) % pool.length];
  }

  update(i: RequestInput, events: VibeEvent[]): RequestEvent[] {
    const out: RequestEvent[] = [];
    const r = this.current;
    if (r) {
      if (this.answered(r, i, events)) {
        this.met++;
        this.current = null;
        this.nextAt = i.t + 100 + this.rnd() * 60;
        out.push({ kind: 'request', what: 'met', req: r, t: i.t });
      } else if (i.t >= r.until || !i.live) {
        this.current = null;
        this.nextAt = i.t + 90 + this.rnd() * 50;
        out.push({ kind: 'request', what: 'missed', req: r, t: i.t });
      }
      return out;
    }
    // ask: not in the last 45 seconds, and only while the set runs
    if (i.live && i.t >= this.nextAt && i.remaining > 45) {
      const kind = this.choose(i);
      const [secs, points] = TERMS[kind];
      const req: CrowdRequest = { kind, text: TEXT[kind], at: i.t, until: i.t + Math.min(secs, i.remaining - 5), points, from: i.energy };
      this.current = req;
      this.asked++;
      out.push({ kind: 'request', what: 'ask', req, t: i.t });
    }
    return out;
  }

  private answered(r: CrowdRequest, i: RequestInput, events: VibeEvent[]): boolean {
    switch (r.kind) {
      case 'lift':
        return i.energy >= r.from + 0.1 || i.energy >= i.target - 0.02;
      case 'calm':
        return i.energy <= r.from - 0.1 || i.energy <= i.target + 0.03;
      case 'drop':
        return events.some((e) => (e.kind === 'drop' && e.built) || (e.kind === 'transition' && e.name === 'double_drop'));
      case 'blend':
        return events.some((e) => e.kind === 'transition' && (e.name === 'long_blend' || e.name === 'bass_swap'));
      case 'filter':
        return events.some((e) => e.kind === 'transition' && e.name === 'filter_fade');
      case 'fresh':
        return events.some((e) => e.kind === 'transition');
    }
  }
}
