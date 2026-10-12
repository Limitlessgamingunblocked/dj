/*
 * What the crowd does beyond following the music, shared by every venue's
 * crowd (like the show state, one object for the whole app):
 *   - the dance style follows the genre: jacking to house, stomping to
 *     techno, bouncing to drum & bass, swaying to deep and slow music;
 *   - crowd moments: a conga line, everyone sitting down for the build and
 *     jumping up on the drop, a circle opening for a dancer, lighters (phone
 *     lights) up for the closing track. They come by themselves when the
 *     room's right for them, or from the Show tab;
 *   - fans copying your DJ moves (and your signature move on a big drop);
 *   - the hand-made cardboard signs: requests, messages and the regulars'.
 * The app feeds it (genre, moves, requests); the crowds read it each frame.
 */

export type CrowdMomentId = 'conga' | 'sitjump' | 'circle' | 'lighters';

export const CROWD_MOMENTS: { id: CrowdMomentId; label: string; blurb: string; len: number }[] = [
  { id: 'conga', label: 'Conga line', blurb: 'A line of dancers snakes round the floor', len: 32 },
  { id: 'sitjump', label: 'Sit down, jump up', blurb: 'Everyone gets down low for the build and jumps up on the drop', len: 40 },
  { id: 'circle', label: 'Dance circle', blurb: 'The floor opens up round a dancer showing off', len: 24 },
  { id: 'lighters', label: 'Lights up', blurb: 'Phone lights in the air, swaying, for a closing track', len: 45 },
];

/** jack (house), stomp (techno), bounce (drum & bass), sway (deep and slow) */
export type StyleWeights = [number, number, number, number];

const STYLE: Record<string, StyleWeights> = {
  House: [1, 0, 0, 0],
  'Tech House': [0.8, 0.2, 0, 0],
  'Afro House': [0.5, 0, 0, 0.5],
  Disco: [0.6, 0, 0, 0.4],
  'UK Garage': [0.5, 0, 0.5, 0],
  Pop: [0.4, 0, 0.6, 0],
  Techno: [0, 1, 0, 0],
  Hardstyle: [0, 0.8, 0.2, 0],
  Trance: [0, 0.5, 0.5, 0],
  'Drum & Bass': [0, 0, 1, 0],
  Dubstep: [0, 0.4, 0.6, 0],
  Trap: [0, 0.2, 0.8, 0],
  'Hip Hop': [0, 0, 0.6, 0.4],
  Reggaeton: [0, 0, 0.4, 0.6],
  'Deep House': [0.3, 0, 0, 0.7],
  'R&B': [0, 0, 0, 1],
  'Lo-fi': [0, 0, 0, 1],
  Ambient: [0, 0, 0, 1],
};

/** the crowd's dance style for a genre (a light mix of everything when unknown) */
export function styleFor(genre: string | null | undefined): StyleWeights {
  return (genre && STYLE[genre]) || [0.25, 0.25, 0.25, 0.25];
}

/** the style's name, for the Show tab */
export function styleName(w: StyleWeights): string {
  const names = ['Jacking', 'Stomping', 'Bouncing', 'Swaying'];
  const best = w.indexOf(Math.max(...w));
  return w[best] > 0.45 ? names[best] : 'Mixed';
}

export interface AutoMomentInput {
  playing: boolean;
  hype: number;
  build: number;
  peak: number;
  /** through the set (or the night), 0..1 */
  progress: number;
  /** the slot is the closing one (or it's the last part of a free night) */
  closing: boolean;
  /** seconds since the last crowd moment ended */
  since: number;
  /** 0..1, a fresh roll each check */
  roll: number;
}

/** a moment the room is ready for, if any (checked every few seconds) */
export function autoMoment(i: AutoMomentInput): CrowdMomentId | null {
  if (!i.playing || i.since < 75) return null;
  if (i.closing && i.progress > 0.82 && i.peak < 0.5 && i.hype > 0.45) return 'lighters';
  if (i.build > 0.55 && i.hype > 0.62 && i.roll < 0.45) return 'sitjump';
  if (i.hype > 0.8 && i.peak > 0.45 && i.roll < 0.2) return 'circle';
  if (i.hype > 0.45 && i.hype < 0.78 && i.peak < 0.3 && i.build < 0.2 && i.roll < 0.12) return 'conga';
  return null;
}

/** the moves the crowd copies, as weights for the crowd shader */
export interface CopyWeights {
  hands: number;
  point: number;
  pump: number;
  clap: number;
  jump: number;
}

const momentListeners = new Set<(id: CrowdMomentId, label: string) => void>();

export const crowdShow = {
  /** the genre of what's playing (set by the app) and the style eased towards it */
  genre: '' as string,
  style: [0.25, 0.25, 0.25, 0.25] as StyleWeights,
  /** crowd moments start by themselves (the Show tab can turn it off) */
  auto: true,
  moment: null as { id: CrowdMomentId; t: number; len: number; dropped: number } | null,
  /** seconds since the last moment ended */
  since: 999,
  /** the DJ move the crowd's copying, and how long it's had */
  copy: null as { move: string; t: number; len: number; all: boolean } | null,
  /** the cardboard signs' messages (the first is the current request when there is one) */
  cards: ['PLAY SOMETHING!', 'BEST NIGHT EVER', 'WE ♥ YOU', 'BIRTHDAY GIRL', 'FIRST RAVE!', 'ONE MORE!'] as string[],
  cardsVersion: 0,
  /** the regulars at the front tonight: their shirt colours (their signs are cards 0-2) */
  front: [] as string[],
  /** 0..1: the sign holders go wild (their request was played) */
  wild: 0,

  start(id: CrowdMomentId): void {
    const m = CROWD_MOMENTS.find((x) => x.id === id);
    if (!m) return;
    this.moment = { id, t: 0, len: m.len, dropped: -1 };
    for (const fn of momentListeners) fn(id, m.label);
  },
  stop(): void {
    if (this.moment) this.since = 0;
    this.moment = null;
  },
  onMoment(fn: (id: CrowdMomentId, label: string) => void): () => void {
    momentListeners.add(fn);
    return () => momentListeners.delete(fn);
  },
  /** fans copy a move for a while: everyone (a big moment) or the front rows */
  copyMove(move: string, seconds: number, all = false): void {
    this.copy = { move, t: 0, len: seconds, all };
  },
  setCards(rows: string[]): void {
    const next = rows.slice(0, 8);
    if (next.join('|') === this.cards.join('|')) return;
    this.cards = next;
    this.cardsVersion++;
  },
  /** each frame: ease the style, run the moment, the sit-down's drop */
  update(dt: number, dropHit: boolean): void {
    const want = styleFor(this.genre);
    for (let i = 0; i < 4; i++) this.style[i] += (want[i] - this.style[i]) * Math.min(1, dt * 0.5);
    const m = this.moment;
    if (m) {
      m.t += dt;
      // sitting down holds until the drop comes, then everyone's up for a few seconds
      if (m.id === 'sitjump' && dropHit && m.dropped < 0) m.dropped = m.t;
      const done = m.id === 'sitjump' ? (m.dropped >= 0 ? m.t - m.dropped > 6 : m.t > m.len) : m.t > m.len;
      if (done) this.stop();
    } else this.since += dt;
    if (this.copy) {
      this.copy.t += dt;
      if (this.copy.t > this.copy.len) this.copy = null;
    }
    this.wild = Math.max(0, this.wild - dt * 0.25);
  },
  /** 0..1 eased in and out over a moment of this kind */
  momentK(id: CrowdMomentId): number {
    const m = this.moment;
    if (!m || m.id !== id) return 0;
    const end = m.id === 'sitjump' && m.dropped >= 0 ? m.dropped + 6 : m.len;
    return Math.min(1, m.t / 1.5, Math.max(0, (end - m.t) / 1.5));
  },
  /** the sit-down: 1 while down, 0 once the drop's hit */
  sitK(): number {
    const m = this.moment;
    if (!m || m.id !== 'sitjump') return 0;
    if (m.dropped >= 0) return 0;
    return Math.min(1, m.t / 2);
  },
  /** after the sit-down's drop: everyone jumping together */
  sitJumpK(): number {
    const m = this.moment;
    if (!m || m.id !== 'sitjump' || m.dropped < 0) return 0;
    return Math.max(0, 1 - (m.t - m.dropped) / 6);
  },
  copyWeights(): CopyWeights {
    const c = this.copy;
    const w: CopyWeights = { hands: 0, point: 0, pump: 0, clap: 0, jump: 0 };
    if (!c) return w;
    const k = Math.min(1, c.t / 0.4, Math.max(0, (c.len - c.t) / 0.6));
    if (c.move === 'hands_up' || c.move === 'climb' || c.move === 'headphones_up') w.hands = k;
    else if (c.move === 'point') w.point = k;
    else if (c.move === 'fist_pump') w.pump = k;
    else if (c.move === 'clap') w.clap = k;
    else if (c.move === 'jump') {
      w.jump = k;
      w.hands = k * 0.6;
    }
    return w;
  },
};
