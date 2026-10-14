/*
 * Small helpers that turn a track's sections and beat grid into mixing
 * prompts on the waveforms: a countdown to the next drop (or to the outro,
 * where you mix out), the mix-in and mix-out points, and whether two decks'
 * 8-bar phrases line up.
 */
import type { Section, SectionKind } from './tracks';

/** dance music changes every 8 bars: the phrase two decks should line up on */
export const PHRASE_BEATS = 32;
/** how far ahead the countdown starts, in bars */
export const COUNTDOWN_BARS = 16;

export interface Countdown {
  kind: Extract<SectionKind, 'drop' | 'outro'>;
  /** beats until it lands */
  beats: number;
}

/** the next drop, or the outro (time to mix out), within `bars` bars of `t` */
export function countdown(sections: Section[] | null, t: number, beatLen: number, bars = COUNTDOWN_BARS): Countdown | null {
  if (!sections || !(beatLen > 0)) return null;
  for (const s of sections) {
    if (s.kind !== 'drop' && s.kind !== 'outro') continue;
    const beats = (s.t - t) / beatLen;
    // just past the line still counts as landing (the audible playhead lags a hair)
    if (beats <= -0.05) continue;
    return beats <= bars * 4 ? { kind: s.kind, beats: Math.max(0, beats) } : null;
  }
  return null;
}

/** "8 BARS", "2 BARS", then the last bar counted in beats: "3", "2", "1", "NOW" */
export function countdownText(c: Countdown): string {
  if (c.beats < 0.5) return 'NOW';
  if (c.beats > 4) return `${Math.ceil(c.beats / 4 - 1e-6)} BAR${Math.ceil(c.beats / 4 - 1e-6) === 1 ? '' : 'S'}`;
  return String(Math.ceil(c.beats - 1e-6));
}

/** where to have the next track fully in (the end of the intro) and where to start mixing out (the outro) */
export function mixPoints(sections: Section[] | null): { mixIn: number | null; mixOut: number | null } {
  if (!sections) return { mixIn: null, mixOut: null };
  const groove = sections.find((s) => s.kind !== 'intro');
  const outro = sections.find((s) => s.kind === 'outro');
  return { mixIn: groove && groove.bar > 0 ? groove.t : null, mixOut: outro ? outro.t : null };
}

/**
 * How far a deck's 8-bar phrase sits from the master's, in beats, from their
 * beat positions on their own grids: 0 when a phrase starts on both decks at
 * once, +8 when this deck is two bars ahead. Wrapped to half a phrase.
 */
export function phraseOffset(beatPos: number, masterBeatPos: number, phrase = PHRASE_BEATS): number {
  const d = (((beatPos - masterBeatPos) % phrase) + phrase) % phrase;
  return d > phrase / 2 ? d - phrase : d;
}

export type PhraseState = { kind: 'in' } | { kind: 'bars'; bars: number } | { kind: 'beats'; beats: number } | { kind: 'offbeat' };

/** in phrase; whole bars off; on the beat but not the bar; or not on the beat at all */
export function phraseState(offsetBeats: number): PhraseState {
  const beat = Math.round(offsetBeats);
  if (Math.abs(offsetBeats - beat) > 0.2) return { kind: 'offbeat' };
  if (beat === 0) return { kind: 'in' };
  if (beat % 4 !== 0) return { kind: 'beats', beats: beat };
  return { kind: 'bars', bars: beat / 4 };
}

/** the phrase badge: what it says and its colour */
export function phraseLabel(p: PhraseState): { text: string; color: string } {
  const sign = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
  switch (p.kind) {
    case 'in':
      return { text: 'IN PHRASE', color: '#3ddc97' };
    case 'bars':
      return { text: `PHRASE ${sign(p.bars)} BAR${Math.abs(p.bars) === 1 ? '' : 'S'}`, color: '#ffb020' };
    case 'beats':
      return { text: `${sign(p.beats)} BEAT${Math.abs(p.beats) === 1 ? '' : 'S'} OFF THE BAR`, color: '#ff8a3d' };
    default:
      return { text: 'OFF THE BEAT', color: '#ff3b5c' };
  }
}

interface PhraseDeck {
  loaded: boolean;
  playing: boolean;
  bpm: number;
  analysis: unknown;
  beatPosition(t: number): number;
  displayPosition(): number;
}

/** where a playing deck's phrase sits against the playing master's (null when there's nothing to compare) */
export function deckPhrase(d: PhraseDeck, master: PhraseDeck | null): PhraseState | null {
  if (!master || master === d) return null;
  if (!d.loaded || !master.loaded || !d.analysis || !master.analysis || !d.playing || !master.playing) return null;
  // only once the tempos match: before that the phrases drift anyway
  if (!(master.bpm > 0) || Math.abs(d.bpm / master.bpm - 1) > 0.02) return null;
  return phraseState(phraseOffset(d.beatPosition(d.displayPosition()), master.beatPosition(master.displayPosition())));
}
