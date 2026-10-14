/*
 * Grid edit ("slip grid"): line a track's beat grid up with the music by
 * hand, like Grid Adjust on a CDJ or the grid editor in rekordbox and Serato.
 * While a deck is in grid edit its jog wheel and a drag on its waveform slide
 * the grid instead of the music, so the audio keeps playing untouched. Buttons
 * nudge the grid a few milliseconds, stretch the tempo around the playhead
 * (the beat under the playhead stays put), set bar 1, move bar 1 by a beat,
 * shift half a beat, or snap the grid to the kicks near the playhead. Edits are
 * saved to the track like the other grid fixes; Reset goes back to the grid
 * the deck had when grid edit was switched on.
 */
import type { Deck } from '../audio/Deck';
import type { ControlRegistry, LedState } from '../core/controls';
import type { LibraryTrack, TrackAnalysis } from '../core/types';
import { GRID_EDIT_COLOR } from '../ui/waveform';

export interface Grid {
  bpm: number;
  firstBeat: number;
}

/** one press of a nudge button, in seconds */
export const NUDGE = 0.005;
/** one press of a tempo button, in BPM (Shift: ten times that) */
export const BPM_STEP = 0.01;
/** the jog wheel in grid edit: one turn slides the grid half a beat */
export const JOG_BEATS_PER_REV = 0.5;

const beatLen = (g: Grid) => 60 / g.bpm;

/** slide every beat by `secs` (positive: later in the track) */
export function slideGrid(g: Grid, secs: number): Grid {
  return { bpm: g.bpm, firstBeat: g.firstBeat + secs };
}

/** change the tempo, keeping the beat nearest `at` where it is */
export function stretchGrid(g: Grid, bpm: number, at: number): Grid {
  const n = Math.round((at - g.firstBeat) / beatLen(g));
  const anchor = g.firstBeat + n * beatLen(g);
  return { bpm, firstBeat: anchor - n * (60 / bpm) };
}

/** make `t` a downbeat; whole bars are added so the first downbeat stays near where it was */
export function downbeatAt(g: Grid, t: number): Grid {
  const bar = 4 * beatLen(g);
  return { bpm: g.bpm, firstBeat: t + Math.round((g.firstBeat - t) / bar) * bar };
}

/** the time of the grid's beat nearest `t` */
export function nearestBeat(g: Grid, t: number): number {
  const bl = beatLen(g);
  return g.firstBeat + Math.round((t - g.firstBeat) / bl) * bl;
}

/** how far (seconds) the beat nearest `at` sits from where the `from` grid had it */
export function gridOffset(g: Grid, from: Grid, at: number): number {
  const b = nearestBeat(g, at);
  return b - nearestBeat(from, b);
}

/**
 * Find the slide (seconds) that puts the grid's beats around `at` on the hits
 * in the music: onsets in the waveform's low and full bands, scored over 32
 * beats either side, small moves preferred. Returns 0 when nothing stands out.
 */
export function snapOffset(a: Pick<TrackAnalysis, 'waveform' | 'waveRate'>, g: Grid, at: number, beats = 32): number {
  const rate = a.waveRate;
  const wf = a.waveform;
  const n = wf.length / 4;
  if (n < 4 || !(g.bpm > 0)) return 0;
  const bl = beatLen(g);
  const onset = (i: number) => {
    if (i < 1 || i >= n) return 0;
    const now = wf[i * 4] + wf[i * 4 + 3];
    const before = wf[(i - 1) * 4] + wf[(i - 1) * 4 + 3];
    return Math.max(0, now - before);
  };
  const at0 = nearestBeat(g, at);
  const span = Math.max(1, Math.floor(bl * rate * 0.5));
  const scores: number[] = [];
  let best = 0;
  let bestScore = 0;
  let total = 0;
  for (let d = -span; d <= span; d++) {
    let s = 0;
    for (let k = -beats; k <= beats; k++) {
      const i = Math.round((at0 + k * bl) * rate) + d;
      s += onset(i);
    }
    // a slight pull towards no change, so an even pattern doesn't jump a whole off-beat
    s *= 1 - 0.15 * (Math.abs(d) / span);
    scores.push(s);
    total += s;
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  const mean = total / scores.length;
  if (bestScore <= 0 || bestScore < mean * 1.5) return 0;
  // parabolic refinement between the neighbouring offsets
  const k = best + span;
  let frac = 0;
  if (k > 0 && k < scores.length - 1) {
    const l = scores[k - 1];
    const r = scores[k + 1];
    const den = l - 2 * scores[k] + r;
    if (den < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den));
  }
  return (best + frac) / rate;
}

interface Session {
  track: LibraryTrack;
  /** the deck's grid being edited (the track's analysis) */
  grid: TrackAnalysis;
  start: Grid;
}

/** Grid edit for every deck. `save` stores a grid on its track (the library's grid fix). */
export class GridEditor {
  private sessions = new Map<Deck, Session>();
  private timers = new Map<Deck, ReturnType<typeof setTimeout>>();

  constructor(
    decks: readonly Deck[],
    private save: (t: LibraryTrack, g: Grid) => void,
  ) {
    // loading another track (or ejecting) ends grid edit on that deck
    for (const d of decks)
      d.on('loaded', () => {
        if (this.sessions.has(d)) this.stop(d);
      });
  }

  active(d: Deck): boolean {
    return this.sessions.has(d);
  }

  toggle(d: Deck): void {
    if (this.active(d)) this.stop(d);
    else this.start(d);
  }

  start(d: Deck): boolean {
    if (!d.loaded || !d.track || !d.analysis || !(d.analysis.bpm > 0)) return false;
    this.sessions.set(d, { track: d.track, grid: d.analysis, start: { bpm: d.analysis.bpm, firstBeat: d.analysis.firstBeat } });
    d.jogTouch(null);
    d.gridJog = (revs) => this.slide(d, revs * JOG_BEATS_PER_REV * d.beatLen);
    d.emit('change', d);
    return true;
  }

  stop(d: Deck): void {
    if (!this.sessions.has(d)) return;
    this.flush(d);
    this.sessions.delete(d);
    d.gridJog = null;
    d.emit('change', d);
  }

  /** the grid's move at the playhead since grid edit started, in seconds */
  offset(d: Deck): number {
    const s = this.sessions.get(d);
    if (!s || !d.analysis) return 0;
    return gridOffset(d.analysis, s.start, d.displayPosition());
  }

  slide(d: Deck, secs: number): void {
    this.edit(d, (g) => slideGrid(g, secs));
  }

  nudge(d: Deck, dir: number): void {
    this.slide(d, dir * NUDGE);
  }

  tempo(d: Deck, dir: number, big = false): void {
    this.edit(d, (g) => stretchGrid(g, Math.max(20, Math.round((g.bpm + dir * BPM_STEP * (big ? 10 : 1)) * 1000) / 1000), d.displayPosition()));
  }

  downbeatHere(d: Deck): void {
    this.edit(d, (g) => downbeatAt(g, nearestBeat(g, d.displayPosition())));
  }

  /** bar 1 one beat later (the grid's beats stay, the downbeats move) */
  moveDownbeat(d: Deck, dir: number): void {
    this.edit(d, (g) => slideGrid(g, dir * beatLen(g)));
  }

  halfBeat(d: Deck): void {
    this.edit(d, (g) => slideGrid(g, beatLen(g) / 2));
  }

  /** slide the grid onto the hits around the playhead; false when nothing clear was found */
  snap(d: Deck): boolean {
    const a = d.analysis;
    if (!a) return false;
    const off = snapOffset(a, a, d.displayPosition());
    if (Math.abs(off) < 0.0005) return false;
    this.slide(d, off);
    return true;
  }

  reset(d: Deck): void {
    const s = this.sessions.get(d);
    if (s) this.edit(d, () => ({ ...s.start }));
  }

  private edit(d: Deck, fn: (g: Grid) => Grid): void {
    if (!this.sessions.has(d) && !this.start(d)) return;
    const a = this.sessions.get(d)!.grid;
    const g = fn({ bpm: a.bpm, firstBeat: a.firstBeat });
    if (!Number.isFinite(g.bpm) || !Number.isFinite(g.firstBeat) || g.bpm <= 0) return;
    a.bpm = g.bpm;
    a.firstBeat = g.firstBeat;
    d.emit('change', d);
    // dragging and jogging edit many times a second: save once it settles
    clearTimeout(this.timers.get(d));
    this.timers.set(
      d,
      setTimeout(() => this.flush(d), 400),
    );
  }

  /** save a pending edit to the track being edited (which may have just left the deck) */
  private flush(d: Deck): void {
    if (!this.timers.has(d)) return;
    clearTimeout(this.timers.get(d));
    this.timers.delete(d);
    const s = this.sessions.get(d);
    if (s) this.save(s.track, { bpm: s.grid.bpm, firstBeat: s.grid.firstBeat });
  }
}

/** Grid edit on the control map, so the panels, the keyboard and MIDI controllers can drive it. */
export function registerGridControls(reg: ControlRegistry, decks: readonly Deck[], grid: GridEditor, say: (msg: string) => void): void {
  for (const d of decks) {
    const p = `deck.${d.id}.`;
    const L = (s: string) => `Deck ${d.id} ${s}`;
    const btn = (id: string, label: string, press: () => void, lit?: () => LedState) => reg.register({ id: p + id, label: L(label), kind: 'button', press, lit: lit ?? (() => false) });
    btn('gridedit', 'Grid edit (slip the beat grid)', () => {
      if (grid.active(d)) grid.stop(d);
      else if (!grid.start(d)) say(`Load a track on deck ${d.id} to edit its beat grid.`);
    }, () => (grid.active(d) ? GRID_EDIT_COLOR : false));
    btn('grid.left', 'Grid: nudge earlier', () => grid.nudge(d, -1));
    btn('grid.right', 'Grid: nudge later', () => grid.nudge(d, 1));
    btn('grid.slower', 'Grid: tempo −0.01', () => grid.tempo(d, -1, reg.shift));
    btn('grid.faster', 'Grid: tempo +0.01', () => grid.tempo(d, 1, reg.shift));
    btn('grid.downbeat', 'Grid: bar 1 here', () => grid.downbeatHere(d));
    btn('grid.beat', 'Grid: move bar 1 a beat later', () => grid.moveDownbeat(d, 1));
    btn('grid.half', 'Grid: shift half a beat', () => grid.halfBeat(d));
    btn('grid.snap', 'Grid: snap to the beats', () => {
      if (!grid.snap(d)) say('The grid already sits on the beats here.');
    });
    btn('grid.reset', 'Grid: undo edits', () => grid.reset(d));
  }
}
