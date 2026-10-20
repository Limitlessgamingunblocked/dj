/*
 * Stacked scrolling waveforms for all visible decks (rekordbox-style), with
 * deck badges, effective BPM and a beat phase meter per lane. Dragging a lane
 * works like touching the jog: scratch (vinyl mode) or nudge. A deck in grid
 * edit gets a toolbar on its lane, and dragging that lane slides the beat grid
 * under the music instead (Shift for fine moves).
 */
import type { AppContext } from '../app/context';
import { SECONDS_PER_REV } from '../audio/Deck';
import { DECK_COLORS, type DeckId } from '../core/types';
import { clamp, formatBpm } from '../core/util';
import { loadSetting, saveSetting } from '../core/settings';
import { h } from './dom';
import { drawZoomed, fitCanvas, GRID_EDIT_COLOR } from './waveform';
import type { Deck } from '../audio/Deck';

interface GridBar {
  el: HTMLElement;
  readout: HTMLElement;
}

export class WaveStrip {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private pxPerSec = loadSetting('waveZoom', 110);
  private labelW = 92;
  private gridBars = new Map<number, GridBar>();

  constructor(private app: AppContext) {
    this.canvas = h('canvas', { 'aria-label': 'Scrolling waveforms' });
    this.g = this.canvas.getContext('2d')!;
    const zoomOut = h('button', { class: 'btn small', title: 'Zoom out' }, '−');
    const zoomIn = h('button', { class: 'btn small', title: 'Zoom in' }, '+');
    zoomOut.addEventListener('click', () => this.zoom(1 / 1.25));
    zoomIn.addEventListener('click', () => this.zoom(1.25));
    this.el = h('div', { class: 'wavestrip' }, this.canvas, h('div', { class: 'zoom' }, zoomOut, zoomIn));
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
  }

  private zoom(f: number): void {
    this.pxPerSec = clamp(this.pxPerSec * f, 30, 500);
    saveSetting('waveZoom', this.pxPerSec);
  }

  /** lanes: the decks on the two sides, plus any other deck that has a track (empty decks 3/4 don't take space) */
  private decks(): number[] {
    const n = this.app.deckCount();
    const shown = new Set([this.app.sideDeck('L'), this.app.sideDeck('R')]);
    if (n === 4) for (let id = 1; id <= 4; id++) if (this.app.engine.deck(id).loaded) shown.add(id);
    return [...shown].sort((x, y) => x - y);
  }

  private laneAt(y: number): number {
    const ids = this.decks();
    const laneH = this.canvas.clientHeight / ids.length;
    return ids[clamp(Math.floor(y / laneH), 0, ids.length - 1)];
  }

  private onDown(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (e.clientX - rect.left < this.labelW) return;
    const deck = this.app.engine.deck(this.laneAt(e.clientY - rect.top));
    if (!deck.loaded) return;
    if (this.app.grid.active(deck)) {
      this.slideGrid(e, deck);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    deck.jogTouch('top');
    let lastX = e.clientX;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      const secs = -dx / (this.pxPerSec / Math.max(0.05, deck.baseRate));
      deck.jogTurn(secs / (SECONDS_PER_REV * deck.jogScale));
    };
    const up = () => {
      deck.jogTouch(null);
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** grid edit: the grid follows the pointer (Shift: a quarter as far, for fine moves) */
  private slideGrid(e: PointerEvent, deck: Deck): void {
    this.canvas.setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      const pxPerTrackSec = this.pxPerSec / Math.max(0.05, deck.baseRate);
      this.app.grid.slide(deck, (dx / pxPerTrackSec) * (ev.shiftKey ? 0.25 : 1));
    };
    const up = () => {
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** the grid edit toolbar for a deck's lane */
  private gridBar(id: number): GridBar {
    let bar = this.gridBars.get(id);
    if (bar) return bar;
    const grid = this.app.grid;
    const deck = () => this.app.engine.deck(id);
    const b = (label: string, title: string, act: (e: PointerEvent) => void, repeat = false) => {
      const btn = h('button', { class: 'btn small', type: 'button', title }, label);
      let timer = 0;
      const stop = () => {
        clearTimeout(timer);
        clearInterval(timer);
      };
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        act(e);
        if (repeat) timer = window.setTimeout(() => (timer = window.setInterval(() => act(e), 60)), 350);
      });
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
      return btn;
    };
    const readout = h('span', { class: 'grid-readout mono' });
    const el = h(
      'div',
      { class: 'grid-bar', role: 'toolbar', 'aria-label': `Deck ${id} grid edit` },
      h('span', { class: 'grid-tag' }, 'Grid edit'),
      readout,
      b('◀', 'Nudge the grid earlier (hold to keep going)', () => grid.nudge(deck(), -1), true),
      b('▶', 'Nudge the grid later (hold to keep going)', () => grid.nudge(deck(), 1), true),
      b('BPM −', 'Tempo −0.01 (Shift: −0.1); the beat at the playhead stays put', (e) => grid.tempo(deck(), -1, e.shiftKey), true),
      b('BPM +', 'Tempo +0.01 (Shift: +0.1); the beat at the playhead stays put', (e) => grid.tempo(deck(), 1, e.shiftKey), true),
      b('Bar 1 here', 'Make the beat at the playhead the start of a bar', () => grid.downbeatHere(deck())),
      b('+1 beat', 'Move bar 1 one beat later', () => grid.moveDownbeat(deck(), 1)),
      b('½', 'Shift the grid half a beat', () => grid.halfBeat(deck())),
      b('Snap', 'Slide the grid onto the kicks around the playhead', () => this.app.reg.press(`deck.${id}.grid.snap`, 'ui')),
      b('Reset', 'Undo this grid edit', () => grid.reset(deck())),
      b('Done', 'Leave grid edit (changes are saved to the track)', () => grid.stop(deck())),
    );
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.append(el);
    bar = { el, readout };
    this.gridBars.set(id, bar);
    return bar;
  }

  /** place a toolbar on each lane whose deck is in grid edit, hide the others */
  private updateGridBars(ids: number[]): void {
    const laneH = this.canvas.clientHeight / Math.max(1, ids.length);
    const editing = new Set<number>();
    ids.forEach((id, i) => {
      const d = this.app.engine.deck(id);
      if (!this.app.grid.active(d)) return;
      editing.add(id);
      const bar = this.gridBar(id);
      bar.el.hidden = false;
      bar.el.style.top = `${Math.round(i * laneH) + 2}px`;
      bar.el.style.left = `${this.labelW + 6}px`;
      const ms = this.app.grid.offset(d) * 1000;
      const bpm = d.analysis ? formatBpm(d.analysis.bpm) : '--';
      bar.readout.textContent = `${ms >= 0 ? '+' : '−'}${Math.abs(ms).toFixed(0)} ms · ${bpm}`;
    });
    for (const [id, bar] of this.gridBars) if (!editing.has(id) && !bar.el.hidden) bar.el.hidden = true;
  }

  update(): void {
    const ids = this.decks();
    this.updateGridBars(ids);
    this.el.classList.toggle('four', ids.length > 2);
    const dpr = fitCanvas(this.canvas);
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, W, H);
    const laneH = H / ids.length;
    const lw = this.labelW * dpr;
    const engine = this.app.engine;
    ids.forEach((id, i) => {
      const d = engine.deck(id);
      const y = Math.round(i * laneH);
      const lh = Math.round(laneH) - 1;
      const color = DECK_COLORS[id as DeckId];
      // label area
      g.fillStyle = '#0b0f15';
      g.fillRect(0, y, lw, lh);
      g.fillStyle = color;
      g.fillRect(0, y, 3 * dpr, lh);
      g.font = `700 ${Math.round(18 * dpr)}px "Barlow Condensed", sans-serif`;
      g.fillText(String(id), 9 * dpr, y + 20 * dpr);
      g.fillStyle = '#e7ecf3';
      g.font = `700 ${Math.round(13 * dpr)}px "JetBrains Mono", monospace`;
      g.fillText(d.loaded ? formatBpm(d.bpm) : '---', 26 * dpr, y + 19 * dpr);
      if (lh > 40 * dpr) {
        g.font = `600 ${Math.round(10 * dpr)}px "Barlow Condensed", sans-serif`;
        g.fillStyle = d.isMaster ? '#ff9f1c' : d.sync ? '#2ec4f1' : '#5b6576';
        g.fillText(d.isMaster ? 'MASTER' : d.sync ? 'SYNC' : d.playing ? 'PLAY' : d.loaded ? 'CUE' : 'EMPTY', 9 * dpr, y + 34 * dpr);
      }
      // beat phase meter (4 beats of the bar)
      if (d.analysis && d.loaded && lh > 38 * dpr) {
        const beat = d.beatPosition(d.displayPosition());
        const inBar = ((Math.floor(beat) % 4) + 4) % 4;
        const bw = 16 * dpr;
        for (let b = 0; b < 4; b++) {
          g.fillStyle = b === inBar ? color : '#232b37';
          g.fillRect(9 * dpr + b * (bw + 2 * dpr), y + lh - 10 * dpr, bw, 4 * dpr);
        }
        const off = engine.phaseOffset(d);
        if (off !== null && Math.abs(off) > 0.01) {
          g.fillStyle = Math.abs(off) < 0.03 ? '#3ddc97' : '#ffd23f';
          g.font = `600 ${Math.round(9 * dpr)}px "JetBrains Mono", monospace`;
          const ms = (off * d.beatLen * 1000) / Math.max(0.05, d.baseRate);
          g.fillText(`${ms > 0 ? '+' : ''}${ms.toFixed(0)}ms`, 52 * dpr, y + 34 * dpr);
        }
      }
      drawZoomed(g, d, lw, y, W - lw, lh, { pxPerSec: this.pxPerSec * dpr, deckColor: color, compact: lh < 50 * dpr, editTag: false });
      if (this.app.grid.active(d)) {
        // amber frame: the grid, not the music, moves on this lane
        g.strokeStyle = GRID_EDIT_COLOR;
        g.lineWidth = 2 * dpr;
        g.strokeRect(lw + dpr, y + dpr, W - lw - 2 * dpr, lh - 2 * dpr);
      }
      if (!d.loaded) {
        g.fillStyle = '#3a4454';
        g.font = `600 ${Math.round(12 * dpr)}px "Barlow", sans-serif`;
        g.fillText('Drop a track here or load one from the library', lw + 14 * dpr, y + lh / 2 + 4 * dpr);
      }
    });
  }
}
