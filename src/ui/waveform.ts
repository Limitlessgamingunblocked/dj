/*
 * Waveform rendering shared by the software UI and the 3D board screens.
 * Full-resolution waveforms are pre-rendered once per track into canvas tiles
 * (WAVE_RATE px per second) and blitted with scaling each frame; beat grid,
 * cues and loops are drawn on top.
 * Colours: low = red, mid = green, high = blue (additively blended).
 */
import type { Deck } from '../audio/Deck';
import type { TrackAnalysis } from '../core/types';

const TILE_W = 2048;
export const WAVE_H = 72;

interface Tiles {
  tiles: HTMLCanvasElement[];
  rate: number;
  points: number;
}

const tileCache = new Map<TrackAnalysis, Tiles>();
const overviewCache = new Map<string, HTMLCanvasElement>();

const BAND_COLORS = ['rgb(225,38,64)', 'rgb(40,170,80)', 'rgb(52,104,240)'];

function drawBands(g: CanvasRenderingContext2D, wf: Uint8Array, from: number, to: number, x0: number, pxPerPoint: number, h: number): void {
  const mid = h / 2;
  g.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 3; band++) {
    g.fillStyle = BAND_COLORS[band];
    for (let i = from; i < to; i++) {
      const a = wf[i * 4 + band] / 255;
      if (a <= 0.01) continue;
      const hh = Math.max(1, a * mid);
      g.fillRect(x0 + (i - from) * pxPerPoint, mid - hh, Math.max(1, pxPerPoint), hh * 2);
    }
  }
  g.globalCompositeOperation = 'source-over';
}

export function getTiles(a: TrackAnalysis): Tiles {
  let t = tileCache.get(a);
  if (t) return t;
  const points = a.waveform.length / 4;
  const tiles: HTMLCanvasElement[] = [];
  for (let start = 0; start < points; start += TILE_W) {
    const w = Math.min(TILE_W, points - start);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = WAVE_H;
    const g = c.getContext('2d')!;
    drawBands(g, a.waveform, start, start + w, 0, 1, WAVE_H);
    tiles.push(c);
  }
  t = { tiles, rate: a.waveRate, points };
  tileCache.set(a, t);
  while (tileCache.size > 8) tileCache.delete(tileCache.keys().next().value!);
  return t;
}

export function getOverview(a: TrackAnalysis, key: string, w: number, h: number): HTMLCanvasElement {
  const ck = `${key}|${w}|${h}|${a.version}`;
  let c = overviewCache.get(ck);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext('2d')!;
  const points = a.waveform.length / 4;
  const per = points / w;
  const pooled = new Uint8Array(w * 4);
  for (let x = 0; x < w; x++) {
    const s = Math.floor(x * per);
    const e = Math.max(s + 1, Math.floor((x + 1) * per));
    for (let b = 0; b < 4; b++) {
      let m = 0;
      for (let i = s; i < e && i < points; i++) m = Math.max(m, a.waveform[i * 4 + b]);
      pooled[x * 4 + b] = m;
    }
  }
  drawBands(g, pooled, 0, w, 0, 1, h);
  overviewCache.set(ck, c);
  while (overviewCache.size > 24) overviewCache.delete(overviewCache.keys().next().value!);
  return c;
}

export interface ZoomOpts {
  pxPerSec: number; // pixels per second of real time
  playheadX?: number; // fraction of width
  showGrid?: boolean;
  showCues?: boolean;
  deckColor?: string;
  compact?: boolean;
}

/** Scrolling waveform around the playhead with beat grid, cues and loop region. */
export function drawZoomed(g: CanvasRenderingContext2D, deck: Deck, x: number, y: number, w: number, h: number, opts: ZoomOpts): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#04060a';
  g.fillRect(x, y, w, h);
  const a = deck.analysis;
  if (!a || !deck.loaded) {
    g.restore();
    return;
  }
  const pos = deck.displayPosition();
  const rate = Math.max(0.05, deck.baseRate);
  const pxPerTrackSec = opts.pxPerSec / rate;
  const cx = x + w * (opts.playheadX ?? 0.5);
  const t0 = pos - (cx - x) / pxPerTrackSec;
  const t1 = pos + (x + w - cx) / pxPerTrackSec;

  // loop region
  if (deck.loop.active || deck.loop.end > deck.loop.start) {
    const lx0 = cx + (deck.loop.start - pos) * pxPerTrackSec;
    const lx1 = cx + (deck.loop.end - pos) * pxPerTrackSec;
    g.fillStyle = deck.loop.active ? 'rgba(61,220,151,0.16)' : 'rgba(61,220,151,0.05)';
    g.fillRect(lx0, y, lx1 - lx0, h);
  }

  // waveform tiles
  const tiles = getTiles(a);
  const scale = pxPerTrackSec / tiles.rate;
  const p0 = Math.max(0, Math.floor(t0 * tiles.rate));
  const p1 = Math.min(tiles.points, Math.ceil(t1 * tiles.rate));
  for (let ti = Math.floor(p0 / TILE_W); ti <= Math.floor((p1 - 1) / TILE_W) && ti < tiles.tiles.length; ti++) {
    const tile = tiles.tiles[ti];
    const tStart = (ti * TILE_W) / tiles.rate;
    const dx = cx + (tStart - pos) * pxPerTrackSec;
    g.drawImage(tile, 0, 0, tile.width, WAVE_H, dx, y + 2, tile.width * scale, h - 4);
  }

  // beat grid
  if (opts.showGrid !== false && a.bpm > 0) {
    const bl = 60 / a.bpm;
    const firstIdx = Math.ceil((t0 - a.firstBeat) / bl);
    const lastIdx = Math.floor((t1 - a.firstBeat) / bl);
    if (lastIdx - firstIdx < 400) {
      for (let i = firstIdx; i <= lastIdx; i++) {
        const bx = Math.round(cx + (a.firstBeat + i * bl - pos) * pxPerTrackSec) + 0.5;
        const bar = ((i % 4) + 4) % 4 === 0;
        g.fillStyle = bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
        g.fillRect(bx, y, 1, bar ? h : h * 0.18);
        if (!bar) g.fillRect(bx, y + h - h * 0.18, 1, h * 0.18);
        if (bar && !opts.compact && ((i / 4) | 0) % 4 === 0) {
          g.fillStyle = 'rgba(255,255,255,0.45)';
          g.font = '600 9px "JetBrains Mono", monospace';
          g.fillText(String(Math.floor(i / 4) + 1), bx + 3, y + 10);
        }
      }
    }
  }

  // cues
  if (opts.showCues !== false) {
    const mark = (t: number, color: string, label: string) => {
      const mx = cx + (t - pos) * pxPerTrackSec;
      if (mx < x - 20 || mx > x + w + 20) return;
      g.fillStyle = color;
      g.fillRect(Math.round(mx), y, 2, h);
      g.beginPath();
      g.moveTo(mx - 5, y);
      g.lineTo(mx + 6, y);
      g.lineTo(mx + 0.5, y + 7);
      g.fill();
      if (label && !opts.compact) {
        g.font = '700 10px "Barlow Condensed", sans-serif';
        g.fillRect(mx + 2, y + h - 13, 12, 13);
        g.fillStyle = '#05070a';
        g.fillText(label, mx + 4, y + h - 3);
      }
    };
    mark(deck.cuePoint, '#ff9f1c', '');
    deck.hotCues.forEach((c, i) => c && mark(c.pos, c.color, String.fromCharCode(65 + i)));
  }

  // slip ghost playhead
  const slip = deck.slipPosition();
  if (Math.abs(slip - deck.position()) > 0.05) {
    const sx = cx + (slip - pos) * pxPerTrackSec;
    g.fillStyle = 'rgba(179,107,255,0.8)';
    g.fillRect(Math.round(sx), y, 2, h);
  }

  // playhead
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(cx) - 1, y, 2, h);
  g.fillStyle = opts.deckColor ?? '#ff3b5c';
  g.beginPath();
  g.moveTo(cx - 5, y);
  g.lineTo(cx + 5, y);
  g.lineTo(cx, y + 6);
  g.fill();
  g.restore();
}

/** Whole-track overview with played region, cues, loop and playhead. */
export function drawOverview(g: CanvasRenderingContext2D, deck: Deck, w: number, h: number, dpr: number): void {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, w, h);
  const a = deck.analysis;
  if (!a || !deck.loaded || !deck.track) return;
  const img = getOverview(a, deck.track.id, Math.round(w), Math.round(h));
  g.drawImage(img, 0, 0, w, h);
  const dur = deck.duration || 1;
  const px = (t: number) => (t / dur) * w;
  const pos = deck.displayPosition();
  g.fillStyle = 'rgba(5,7,10,0.55)';
  g.fillRect(0, 0, px(pos), h);
  // phrase markers every 16 bars
  if (a.bpm > 0) {
    const phrase = (60 / a.bpm) * 64;
    g.fillStyle = 'rgba(255,255,255,0.14)';
    for (let t = a.firstBeat; t < dur; t += phrase) g.fillRect(Math.round(px(t)), 0, 1 * dpr, h);
  }
  if (deck.loop.end > deck.loop.start) {
    g.fillStyle = deck.loop.active ? 'rgba(61,220,151,0.35)' : 'rgba(61,220,151,0.12)';
    g.fillRect(px(deck.loop.start), 0, Math.max(2, px(deck.loop.end) - px(deck.loop.start)), h);
  }
  g.fillStyle = '#ff9f1c';
  g.fillRect(Math.round(px(deck.cuePoint)), 0, 2 * dpr, h * 0.4);
  deck.hotCues.forEach((c) => {
    if (!c) return;
    g.fillStyle = c.color;
    g.fillRect(Math.round(px(c.pos)), h * 0.6, 2 * dpr, h * 0.4);
  });
  g.fillStyle = '#fff';
  g.fillRect(Math.round(px(pos)) - dpr, 0, 2 * dpr, h);
  // warn when less than 30 s remain
  if (deck.playing && dur - pos < 30 && Math.floor(performance.now() / 350) % 2 === 0) {
    g.strokeStyle = '#ff3b5c';
    g.lineWidth = 2 * dpr;
    g.strokeRect(dpr, dpr, w - 2 * dpr, h - 2 * dpr);
  }
}

/** Resize a canvas to its CSS box at device pixel ratio. Returns the ratio used. */
export function fitCanvas(c: HTMLCanvasElement, maxDpr = 2): number {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return dpr;
}
