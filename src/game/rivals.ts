/*
 * The rivals (Section 6.10): four fictional DJs, each with a style and a
 * personality. They turn up in B2B offers from fame tier 5; the B2B set
 * itself (app/b2b.ts) takes turns with you on the decks and keeps a
 * chemistry meter from how your mixes land with them.
 */
import { compatibility } from '../analysis/keys';
import type { KeyInfo } from '../core/types';
import type { Tag } from './tracks';

export const RIVAL_IDS = ['marlowe', 'kiki_volt', 'double_dutch', 'nox'] as const;
export type RivalId = (typeof RIVAL_IDS)[number];

export interface Rival {
  id: RivalId;
  name: string;
  /** one line for the offer and the intro */
  style: string;
  /** their colour on the HUD and the flyer */
  color: string;
}

export const RIVALS: Record<RivalId, Rival> = {
  marlowe: { id: 'marlowe', name: 'MARLOWE', style: 'Deep purist. Long blends. Judges you for big drops.', color: '#7fb3ff' },
  kiki_volt: { id: 'kiki_volt', name: 'KIKI VOLT', style: 'Rave energy and piano stabs. Pushes the tempo up.', color: '#ff4fb0' },
  double_dutch: { id: 'double_dutch', name: 'DOUBLE DUTCH', style: 'Bouncy tech house, vocal hooks, playful.', color: '#ffb547' },
  nox: { id: 'nox', name: 'NOX', style: 'Afterhours minimalist. Hypnotic. Barely speaks.', color: '#9d8cff' },
};

/** the rival in a 'b2b:<id>' special, if any */
export function rivalOf(special: string | null | undefined): Rival | null {
  if (!special?.startsWith('b2b:')) return null;
  return RIVALS[special.slice(4) as RivalId] ?? null;
}

/* ------------------------------------------------------------------ */
/* the B2B: what they pick, how they judge you, chemistry               */
/* ------------------------------------------------------------------ */


/** a track as the B2B sees it */
export interface B2BTrack {
  id: string;
  bpm: number;
  key: KeyInfo | null;
  /** 1..10 */
  energy: number;
  tags: Tag[];
}

interface Taste {
  /** the energy they like to play */
  energy: [number, number];
  likes: Tag[];
  dislikes: Tag[];
  /** which way they push the tempo: down, hold, up */
  tempo: -1 | 0 | 1;
  /** which way they answer your energy: pull it back, match it, push it on */
  answer: -1 | 0 | 1;
  /** bars they take to mix in */
  mixBars: number;
  /** how often they say something (NOX barely speaks) */
  talk: number;
}

export const TASTE: Record<RivalId, Taste> = {
  marlowe: { energy: [3, 6], likes: ['deep', 'rolling', 'groovy'], dislikes: ['rave', 'peak'], tempo: 0, answer: -1, mixBars: 32, talk: 0.6 },
  kiki_volt: { energy: [7, 10], likes: ['rave', 'piano', 'peak'], dislikes: ['deep', 'afterhours'], tempo: 1, answer: 1, mixBars: 8, talk: 0.9 },
  double_dutch: { energy: [5, 8], likes: ['groovy', 'vocal', 'garage'], dislikes: ['afterhours'], tempo: 0, answer: 0, mixBars: 16, talk: 0.8 },
  nox: { energy: [2, 5], likes: ['deep', 'afterhours', 'rolling'], dislikes: ['vocal', 'rave', 'piano'], tempo: -1, answer: -1, mixBars: 32, talk: 0.15 },
};

/** what they say to open the set, with your name in it (Section 3, 6.10) */
export const INTROS: Record<RivalId, string> = {
  marlowe: '{name}. Let’s keep it deep, yeah? Nothing cheap.',
  kiki_volt: '{NAME}!! Let’s go! Faster, faster, FASTER!',
  double_dutch: 'Yo {name}! Let’s have some fun with this one.',
  nox: '…{name}.',
};

const LINES: Record<RivalId, { good: string[]; bad: string[]; drop?: string }> = {
  marlowe: { good: ['Lovely blend.', 'That’s the one. Patience.', 'Mm. Tasteful.'], bad: ['Bit much, no?', 'Easy. It’s not a stadium.', 'Rushed that one.'], drop: 'A big drop? Really?' },
  kiki_volt: { good: ['YES! Harder!', 'Ooh that piano!', 'Keep it UP!'], bad: ['Snooze…', 'Where’s the energy?!', 'Faster, come on!'] },
  double_dutch: { good: ['Ha! Love it.', 'Bounce bounce bounce!', 'That hook though!'], bad: ['Hmm, bit flat.', 'Not feeling that one.', 'Close, close…'] },
  nox: { good: ['…yes.', '…'], bad: ['…no.'] },
};

/** chemistry this high by the end of the set unlocks their outfit pieces */
export const CHEMISTRY_UNLOCK = 0.75;

/**
 * The rival's next track: a good mix from what's playing (key and tempo,
 * the way Auto DJ picks), in their taste, answering your energy their way.
 */
export function rivalPick(id: RivalId, cur: B2BTrack, pool: B2BTrack[], exclude: Set<string>, rand: () => number = Math.random): B2BTrack | null {
  const t = TASTE[id];
  const scored = pool
    .filter((c) => !exclude.has(c.id) && c.bpm > 0 && c.id !== cur.id)
    .map((c) => {
      const d = Math.min(...[0.5, 1, 2].map((m) => Math.abs(Math.log((c.bpm * m) / Math.max(1, cur.bpm)))));
      let s = d < 0.025 ? 3 : d < 0.05 ? 2 : d < 0.1 ? 1 : -3;
      const k = compatibility(cur.key, c.key);
      s += k === 'same' ? 3 : k === 'harmonic' ? 2.5 : k === 'boost' ? 1 : 0;
      if (c.energy >= t.energy[0] && c.energy <= t.energy[1]) s += 2;
      for (const tag of c.tags) s += t.likes.includes(tag) ? 1 : t.dislikes.includes(tag) ? -2 : 0;
      if (t.tempo > 0 && c.bpm > cur.bpm * 1.004) s += 1;
      if (t.tempo < 0 && c.bpm < cur.bpm * 0.996) s += 1;
      const de = c.energy - cur.energy;
      if (t.answer > 0 && de >= 0) s += 1;
      // pulling it back: the further down the better (up to a point)
      if (t.answer < 0 && de <= 0) s += 1 + Math.min(1, -de * 0.25);
      if (t.answer === 0 && Math.abs(de) <= 1) s += 1;
      return { c, s: s + rand() * 0.75 };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.c ?? null;
}

/**
 * How your track (mixed in after theirs) lands with them: the key and tempo
 * against theirs, whether it's their kind of thing, and how clean the mix
 * was (0 trainwreck … 1 perfect). Returns the chemistry change and maybe a
 * line for the HUD.
 */
export function judgeTransition(id: RivalId, o: { from: B2BTrack; to: B2BTrack; clean: number; bigDrop?: boolean }, rand: () => number = Math.random): { delta: number; line: string | null } {
  const t = TASTE[id];
  let d = 0;
  const k = compatibility(o.from.key, o.to.key);
  d += k === 'same' || k === 'harmonic' ? 0.06 : k === 'boost' ? 0.03 : -0.05;
  const td = Math.min(...[0.5, 1, 2].map((m) => Math.abs(Math.log((o.to.bpm * m) / Math.max(1, o.from.bpm)))));
  d += td < 0.03 ? 0.03 : td > 0.08 ? -0.04 : 0;
  d += o.to.energy >= t.energy[0] && o.to.energy <= t.energy[1] ? 0.04 : -0.02;
  let likes = 0;
  for (const tag of o.to.tags) {
    if (t.likes.includes(tag)) likes++;
    if (t.dislikes.includes(tag)) d -= 0.05;
  }
  d += Math.min(2, likes) * 0.02;
  d += o.clean * 0.08 - (o.clean < 0.2 ? 0.08 : 0);
  if (t.tempo > 0 && o.to.bpm > o.from.bpm * 1.004) d += 0.03;
  let line: string | null = null;
  if (id === 'marlowe' && o.bigDrop) {
    d -= 0.06;
    line = LINES.marlowe.drop!;
  }
  d = Math.max(-0.25, Math.min(0.25, d));
  if (!line && rand() < t.talk) {
    const pool = d >= 0 ? LINES[id].good : LINES[id].bad;
    line = pool[Math.floor(rand() * pool.length) % pool.length];
  }
  return { delta: d, line };
}

export function chemistryAfter(prev: number, delta: number): number {
  return Math.max(0, Math.min(1, prev + delta));
}
