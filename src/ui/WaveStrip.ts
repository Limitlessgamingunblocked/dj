/*
 * Stacked scrolling waveforms for all visible decks (rekordbox-style), with
 * deck badges, effective BPM and a beat phase meter per lane. Dragging a lane
 * works like touching the jog: scratch (vinyl mode) or nudge.
 */
import type { AppContext } from '../app/context';
import { SECONDS_PER_REV } from '../audio/Deck';
import { DECK_COLORS, type DeckId } from '../core/types';
import { clamp, formatBpm } from '../core/util';
import { loadSetting, saveSetting } from '../core/settings';
import { h } from './dom';
import { drawZoomed, fitCanvas } from './waveform';

export class WaveStrip {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private pxPerSec = loadSetting('waveZoom', 110);
  private labelW = 92;

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

  private decks(): number[] {
    const n = this.app.deckCount();
    return n === 4 ? [1, 2, 3, 4] : [this.app.sideDeck('L'), this.app.sideDeck('R')];
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

  update(): void {
    const ids = this.decks();
    this.el.classList.toggle('four', ids.length === 4);
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
      drawZoomed(g, d, lw, y, W - lw, lh, { pxPerSec: this.pxPerSec * dpr, deckColor: color, compact: lh < 50 * dpr });
      if (!d.loaded) {
        g.fillStyle = '#3a4454';
        g.font = `600 ${Math.round(12 * dpr)}px "Barlow", sans-serif`;
        g.fillText('Drop a track here or load one from the library', lw + 14 * dpr, y + lh / 2 + 4 * dpr);
      }
    });
  }
}
