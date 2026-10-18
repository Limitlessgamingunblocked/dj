/*
 * Pass the aux: a party game for 3 to 8 friends. One track each, in turns,
 * and you have to mix into whatever the last person left you, before the
 * clock runs out. Every mix is scored (how clean the beatmatch was, the key,
 * the tempo jump, how fast you got in, a big drop), the room votes for the
 * mix of the night at the end, and the awards go out: smoothest blend,
 * trainwreck of the night and the rest.
 *
 * The rules only: app/passAux.ts watches the decks and the vibe meter and
 * feeds them in; ui/PassAux.ts draws it; app/auxLink.ts carries it to the
 * players' own phones.
 */
import { compatibility } from '../analysis/keys';
import type { KeyInfo } from '../core/types';
import type { Band } from './vibe';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
/** seconds to get your track in */
export const TURN_TIMES = [60, 90, 120, 180] as const;
export const ROUND_CHOICES = [1, 2, 3] as const;
/** after your track is in, this long to take theirs out before the turn ends anyway */
export const BLEND_GRACE = 75;
/** the opener's track has to play this long to count as in */
export const OPENER_HOLD = 4;

/** each player's colour on the HUD, the scoreboard and their phone */
export const AUX_COLORS = ['#ff2e88', '#4cc9f0', '#ffd23f', '#3ddc97', '#c77dff', '#ff9f1c', '#7fb3ff', '#ff6b6b'];

export interface AuxPlayer {
  id: string;
  name: string;
  color: string;
  /** joined from their own phone */
  device?: boolean;
}

export interface AuxConfig {
  players: AuxPlayer[];
  rounds: number;
  turnSecs: number;
}

/** a track as the game sees it */
export interface AuxTrack {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: KeyInfo | null;
}

/** what happened while a player mixed, from the vibe meter */
export interface MixCalls {
  /** the best beatmatch band of a transition the meter called */
  band: Band | null;
  /** the transition's name ("Clean bass swap"), if it called one */
  move: string | null;
  trainwreck: boolean;
  keyClash: boolean;
  /** the room went silent: they let the last track run out */
  deadAir: boolean;
  /** a built-up drop landed */
  drop: boolean;
}

export const NO_CALLS: MixCalls = { band: null, move: null, trainwreck: false, keyClash: false, deadAir: false, drop: false };

export interface AuxTurn {
  player: string;
  round: number;
  from: AuxTrack | null;
  to: AuxTrack | null;
  /** seconds from "ready" to their track being in (null: never got in) */
  inAfter: number | null;
  calls: MixCalls;
  /** out of 100 */
  score: number;
  /** the parts of the score, for the card after the mix */
  notes: string[];
  /** how clean it was, 0..1 (null: the opener, nothing to blend) */
  clean: number | null;
  keyMatch: 'same' | 'harmonic' | 'boost' | 'clash' | 'unknown';
  tempoJump: number;
  skipped?: boolean;
}

const BAND_CLEAN: Record<Band, number> = { perfect: 1, good: 0.78, loose: 0.45, trainwreck: 0 };
const BAND_TEXT: Record<Band, string> = { perfect: 'Perfect beatmatch', good: 'Tight beatmatch', loose: 'Loose beatmatch', trainwreck: 'Off the beat' };

/** tempo difference between two tracks, folding double and half time, as a fraction (0.03 = 3%) */
export function tempoJump(a: number, b: number): number {
  if (!a || !b) return 0;
  let r = b / a;
  if (r > 1.5) r /= 2;
  else if (r < 0.75) r *= 2;
  return Math.abs(r - 1);
}

export function keyMatch(a: KeyInfo | null, b: KeyInfo | null): AuxTurn['keyMatch'] {
  if (!a || !b) return 'unknown';
  return compatibility(a, b) ?? 'clash';
}

/** score one turn: what they mixed from, into, how fast, what the meter called */
export function scoreTurn(o: { player: string; round: number; from: AuxTrack | null; to: AuxTrack | null; inAfter: number | null; turnSecs: number; calls: MixCalls }): AuxTurn {
  const base = { player: o.player, round: o.round, from: o.from, to: o.to, inAfter: o.inAfter, calls: o.calls };
  if (!o.to || o.inAfter === null) {
    return { ...base, score: 0, notes: ['Out of time'], clean: o.from ? 0 : null, keyMatch: 'unknown', tempoJump: 0 };
  }
  const speed = Math.max(0, 1 - o.inAfter / Math.max(1, o.turnSecs));
  // the opener: nothing to mix into, so it's the pick and the speed
  if (!o.from) {
    const score = Math.round(60 + 30 * speed + (o.calls.drop ? 10 : 0));
    return { ...base, score: Math.min(100, score), notes: ['Opened the night', `In after ${Math.round(o.inAfter)}s`], clean: null, keyMatch: 'unknown', tempoJump: 0 };
  }
  const notes: string[] = [];
  // clean: the meter's call; a trainwreck or dead air wipes it
  let clean = o.calls.band ? BAND_CLEAN[o.calls.band] : 0.45;
  if (o.calls.band) notes.push(o.calls.move ? `${o.calls.move} · ${BAND_TEXT[o.calls.band]}` : BAND_TEXT[o.calls.band]);
  if (o.calls.trainwreck) {
    clean = 0;
    notes.push('Trainwreck');
  }
  if (o.calls.deadAir) {
    clean = Math.min(clean, 0.1);
    notes.push('Dead air');
  }
  const km = keyMatch(o.from.key, o.to.key);
  const keyPts = km === 'same' || km === 'harmonic' ? 20 : km === 'boost' ? 14 : km === 'unknown' ? 10 : 0;
  notes.push(km === 'same' ? 'Same key' : km === 'harmonic' ? 'In key' : km === 'boost' ? 'Energy boost key' : km === 'clash' || o.calls.keyClash ? 'Keys clash' : 'Key unknown');
  const tj = tempoJump(o.from.bpm, o.to.bpm);
  const tempoPts = tj < 0.02 ? 15 : tj < 0.05 ? 9 : tj < 0.08 ? 4 : 0;
  if (tj >= 0.05) notes.push(`Tempo jump ${Math.round(tj * 100)}%`);
  notes.push(`In after ${Math.round(o.inAfter)}s`);
  if (o.calls.drop) notes.push('Big drop');
  const score = Math.round(clean * 50 + (o.calls.keyClash ? 0 : keyPts) + tempoPts + speed * 10 + (o.calls.drop ? 5 : 0));
  return { ...base, score: Math.max(0, Math.min(100, score)), notes, clean, keyMatch: o.calls.keyClash ? 'clash' : km, tempoJump: tj };
}

/** the order of play: everyone once a round, the same order each round */
export function turnOrder(players: AuxPlayer[], rounds: number): { player: string; round: number }[] {
  const out: { player: string; round: number }[] = [];
  for (let r = 1; r <= rounds; r++) for (const p of players) out.push({ player: p.id, round: r });
  return out;
}

/* ------------------------------------------------------------------ */
/* the vote and the awards                                              */
/* ------------------------------------------------------------------ */

/** the mixes a player can vote for: anyone's but their own, and not the opener or a miss */
export function votable(turns: AuxTurn[], voter: string): number[] {
  return turns.map((t, i) => (t.player !== voter && t.from && t.to && t.inAfter !== null && !t.skipped ? i : -1)).filter((i) => i >= 0);
}

/** a vote is good if it's for a mix they can vote for */
export function validVote(turns: AuxTurn[], voter: string, turn: number): boolean {
  return votable(turns, voter).includes(turn);
}

export interface AuxStanding {
  player: string;
  points: number;
  votes: number;
  /** points plus the room's votes */
  total: number;
}

/** points per vote from the room */
export const VOTE_POINTS = 25;

export function standings(players: AuxPlayer[], turns: AuxTurn[], votes: Record<string, number>): AuxStanding[] {
  const votesFor = new Map<string, number>();
  for (const [voter, i] of Object.entries(votes)) {
    const t = turns[i];
    if (t && validVote(turns, voter, i)) votesFor.set(t.player, (votesFor.get(t.player) ?? 0) + 1);
  }
  return players
    .map((p) => {
      const points = turns.filter((t) => t.player === p.id).reduce((s, t) => s + t.score, 0);
      const v = votesFor.get(p.id) ?? 0;
      return { player: p.id, points, votes: v, total: points + v * VOTE_POINTS };
    })
    .sort((a, b) => b.total - a.total || b.votes - a.votes);
}

export interface AuxAward {
  id: 'champion' | 'crowd' | 'smoothest' | 'trainwreck' | 'key' | 'quickest' | 'drop';
  title: string;
  player: string;
  /** what it was for ("Bass swap into Night Drive") */
  why: string;
  /** the turn it was for, if one */
  turn?: number;
}

const name = (t: AuxTrack | null) => t?.title ?? 'nothing';

/** the night's awards; each one needs someone who earned it */
export function awards(players: AuxPlayer[], turns: AuxTurn[], votes: Record<string, number>): AuxAward[] {
  const out: AuxAward[] = [];
  const st = standings(players, turns, votes);
  if (st[0] && (st[0].total > 0 || turns.length)) {
    const s = st[0];
    out.push({ id: 'champion', title: 'Champion of the night', player: s.player, why: `${s.total} points${s.votes ? `, ${s.votes} vote${s.votes > 1 ? 's' : ''}` : ''}` });
  }
  // the mix of the night: the one with the most votes (the higher score breaks a tie)
  const tally = new Map<number, number>();
  for (const [voter, i] of Object.entries(votes)) if (validVote(turns, voter, i)) tally.set(i, (tally.get(i) ?? 0) + 1);
  const fav = [...tally.entries()].sort((a, b) => b[1] - a[1] || turns[b[0]].score - turns[a[0]].score)[0];
  if (fav) {
    const t = turns[fav[0]];
    out.push({ id: 'crowd', title: 'Mix of the night', player: t.player, why: `${name(t.from)} into ${name(t.to)} · ${fav[1]} vote${fav[1] > 1 ? 's' : ''}`, turn: fav[0] });
  }
  const mixes = turns.map((t, i) => ({ t, i })).filter(({ t }) => t.from && t.clean !== null && !t.skipped);
  const landed = mixes.filter(({ t }) => t.inAfter !== null);
  // the smoothest: a beatmatch the meter actually called, the cleanest of them
  const smooth = landed.filter(({ t }) => t.calls.band && !t.calls.trainwreck).sort((a, b) => b.t.clean! - a.t.clean! || b.t.score - a.t.score)[0];
  if (smooth && smooth.t.clean! >= 0.45) out.push({ id: 'smoothest', title: 'Smoothest blend', player: smooth.t.player, why: `${name(smooth.t.from)} into ${name(smooth.t.to)}`, turn: smooth.i });
  // the trainwreck: a real one, or dead air, or a miss; the worst of them
  const wrecks = mixes.filter(({ t }) => t.calls.trainwreck || t.calls.deadAir || t.inAfter === null || (t.clean ?? 1) < 0.3);
  const wreck = wrecks.sort((a, b) => a.t.score - b.t.score)[0];
  if (wreck) {
    const w = wreck.t;
    out.push({ id: 'trainwreck', title: 'Trainwreck of the night', player: w.player, why: w.inAfter === null ? `Never got in over ${name(w.from)}` : w.calls.deadAir ? `Let ${name(w.from)} run out` : `${name(w.from)} into ${name(w.to)}`, turn: wreck.i });
  }
  // the key wizard: the most mixes in key (at least two)
  const inKey = new Map<string, number>();
  for (const { t } of landed) if (t.keyMatch === 'same' || t.keyMatch === 'harmonic' || t.keyMatch === 'boost') inKey.set(t.player, (inKey.get(t.player) ?? 0) + 1);
  const kw = [...inKey.entries()].sort((a, b) => b[1] - a[1])[0];
  if (kw && kw[1] >= 2) out.push({ id: 'key', title: 'Key wizard', player: kw[0], why: `${kw[1]} mixes in key` });
  // the quickest hands: the fastest single mix in
  const quick = [...landed].sort((a, b) => a.t.inAfter! - b.t.inAfter!)[0];
  if (quick) out.push({ id: 'quickest', title: 'Quickest hands', player: quick.t.player, why: `In after ${Math.round(quick.t.inAfter!)}s`, turn: quick.i });
  const drop = turns.map((t, i) => ({ t, i })).filter(({ t }) => t.calls.drop && t.inAfter !== null)[0];
  if (drop) out.push({ id: 'drop', title: 'Biggest drop', player: drop.t.player, why: `Dropped ${name(drop.t.to)}`, turn: drop.i });
  return out;
}

/** the night as text to paste in the group chat */
export function shareText(players: AuxPlayer[], turns: AuxTurn[], votes: Record<string, number>): string {
  const who = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const st = standings(players, turns, votes);
  const lines = ['🎛️ Pass the aux · Deckhouse DJ'];
  st.forEach((s, i) => lines.push(`${i + 1}. ${who(s.player)} · ${s.total}${s.votes ? ` (${s.votes}🗳️)` : ''}`));
  for (const a of awards(players, turns, votes)) if (a.id !== 'champion') lines.push(`🏆 ${a.title}: ${who(a.player)}`);
  return lines.join('\n');
}

/** clean up the names typed in: trimmed, not empty, not repeated */
export function cleanNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim().slice(0, 18);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, MAX_PLAYERS);
}
