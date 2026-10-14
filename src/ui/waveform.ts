/*
 * Waveform rendering shared by the software UI and the 3D board screens.
 * Full-resolution waveforms are pre-rendered once per track into canvas tiles
 * (WAVE_RATE px per second) and blitted with scaling each frame; beat grid,
 * cues and loops are drawn on top.
 * Colours follow the scheme picked in Settings (3-band by default: lows
 * blue, mids orange, highs white, layered).
 */
import type { Deck } from '../audio/Deck';
import type { GridStyle, WaveScheme } from '../core/prefs';
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

/**
 * Colour schemes (Settings → Appearance). "add" blends the three bands
 * additively (low red + mid green + high blue); "layer" nests them, loudest
 * behind and quietest in front; "mono" draws the loudest band in one colour.
 */
type Scheme = { mode: 'add' | 'layer' | 'mono'; colors: [string, string, string] };
const SCHEMES: Record<WaveScheme, Scheme> = {
  rgb: { mode: 'add', colors: ['rgb(225,38,64)', 'rgb(40,170,80)', 'rgb(52,104,240)'] },
  threeband: { mode: 'layer', colors: ['#2a5cff', '#ff9a1f', '#f4f1ea'] },
  blue: { mode: 'layer', colors: ['#1c47c9', '#3f8cff', '#cfe6ff'] },
  mono: { mode: 'mono', colors: ['#f0cf8e', '#f0cf8e', '#f0cf8e'] },
};
let scheme: Scheme = SCHEMES.threeband;

/** Switch the waveform colours; the cached waveform images are redrawn on next use. */
export function setWaveScheme(id: WaveScheme): void {
  const next = SCHEMES[id] ?? SCHEMES.threeband;
  if (next === scheme) return;
  scheme = next;
  tileCache.clear();
  overviewCache.clear();
}

function drawBands(g: CanvasRenderingContext2D, wf: Uint8Array, from: number, to: number, x0: number, pxPerPoint: number, h: number): void {
  const mid = h / 2;
  const bar = (i: number, a: number) => {
    const hh = Math.max(1, a * mid);
    g.fillRect(x0 + (i - from) * pxPerPoint, mid - hh, Math.max(1, pxPerPoint), hh * 2);
  };
  if (scheme.mode === 'mono') {
    g.fillStyle = scheme.colors[0];
    for (let i = from; i < to; i++) {
      const a = Math.max(wf[i * 4], wf[i * 4 + 1], wf[i * 4 + 2]) / 255;
      if (a > 0.01) bar(i, a);
    }
    return;
  }
  if (scheme.mode === 'layer') {
    // per point, the loudest band behind and the quietest in front, so all three show
    const ord = [0, 1, 2];
    for (let i = from; i < to; i++) {
      ord.sort((x, y) => wf[i * 4 + y] - wf[i * 4 + x]);
      for (const band of ord) {
        const a = wf[i * 4 + band] / 255;
        if (a <= 0.01) continue;
        g.fillStyle = scheme.colors[band];
        bar(i, a);
      }
    }
    return;
  }
  g.globalCompositeOperation = 'lighter';
  for (let band = 0; band < 3; band++) {
    g.fillStyle = scheme.colors[band];
    for (let i = from; i < to; i++) {
      const a = wf[i * 4 + band] / 255;
      if (a > 0.01) bar(i, a);
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

let gridStyle: GridStyle = 'bold';

/** Beat grid look (Settings → Appearance). */
export function setGridStyle(style: GridStyle): void {
  gridStyle = style;
}

/** the colour grid edit paints the grid, so it's clear the grid (not the music) is what moves */
export const GRID_EDIT_COLOR = '#ffd23f';

/** The original faint grid: bar lines, beat ticks top and bottom. */
function drawSubtleGrid(g: CanvasRenderingContext2D, bpm: number, firstBeat: number, pos: number, cx: number, pxPerSec: number, t0: number, t1: number, y: number, h: number, compact: boolean): void {
  const bl = 60 / bpm;
  const firstIdx = Math.ceil((t0 - firstBeat) / bl);
  const lastIdx = Math.floor((t1 - firstBeat) / bl);
  if (lastIdx - firstIdx >= 400) return;
  for (let i = firstIdx; i <= lastIdx; i++) {
    const bx = Math.round(cx + (firstBeat + i * bl - pos) * pxPerSec) + 0.5;
    const bar = ((i % 4) + 4) % 4 === 0;
    g.fillStyle = bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
    g.fillRect(bx, y, 1, bar ? h : h * 0.18);
    if (!bar) g.fillRect(bx, y + h - h * 0.18, 1, h * 0.18);
    if (bar && !compact && ((i / 4) | 0) % 4 === 0) {
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.font = '600 9px "JetBrains Mono", monospace';
      g.fillText(String(Math.floor(i / 4) + 1), bx + 3, y + 10);
    }
  }
}

/**
 * The bold grid: a line on every beat with bright ticks top and bottom, a
 * thicker outlined line on every bar with red markers like a CDJ's, phrase
 * starts (every 4 bars) in red, and bar numbers. In grid edit it all turns
 * amber.
 */
function drawBoldGrid(g: CanvasRenderingContext2D, bpm: number, firstBeat: number, pos: number, cx: number, pxPerSec: number, t0: number, t1: number, y: number, h: number, edit: boolean, compact: boolean): void {
  const bl = 60 / bpm;
  const firstIdx = Math.ceil((t0 - firstBeat) / bl);
  const lastIdx = Math.floor((t1 - firstBeat) / bl);
  if (lastIdx - firstIdx >= 800) return;
  const u = Math.max(1, Math.round(h / 64));
  const beatPx = bl * pxPerSec;
  const showBeats = beatPx >= 5 * u;
  const showBars = beatPx * 4 >= 6 * u;
  const numberEvery = beatPx * 4 >= 34 * u ? 1 : beatPx * 16 >= 34 * u ? 4 : 16;
  const tick = Math.max(3 * u, Math.round(h * 0.13));
  const beatLine = edit ? 'rgba(255,210,63,0.45)' : 'rgba(255,255,255,0.26)';
  const beatTick = edit ? GRID_EDIT_COLOR : 'rgba(255,255,255,0.9)';
  const barLine = edit ? GRID_EDIT_COLOR : 'rgba(255,255,255,0.9)';
  const phraseLine = edit ? '#ff9f1c' : '#ff3b5c';
  const font = `700 ${Math.max(9, 9 * u)}px "JetBrains Mono", monospace`;
  g.textAlign = 'left';
  for (let i = firstIdx; i <= lastIdx; i++) {
    const bx = Math.round(cx + (firstBeat + i * bl - pos) * pxPerSec);
    const inBar = ((i % 4) + 4) % 4;
    const barNo = Math.floor(i / 4);
    const phrase = inBar === 0 && ((barNo % 4) + 4) % 4 === 0;
    if (inBar !== 0) {
      if (!showBeats) continue;
      g.fillStyle = beatLine;
      g.fillRect(bx, y, u, h);
      g.fillStyle = beatTick;
      g.fillRect(bx, y, u, tick);
      g.fillRect(bx, y + h - tick, u, tick);
      continue;
    }
    if (!showBars && !phrase) continue;
    const lw = 2 * u;
    // a dark edge either side keeps the line readable over loud, bright waveform
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(bx - u, y, lw + 2 * u, h);
    g.fillStyle = phrase ? phraseLine : barLine;
    g.fillRect(bx, y, lw, h);
    // CDJ-style markers top and bottom
    g.fillStyle = phrase ? phraseLine : edit ? GRID_EDIT_COLOR : '#ff3b5c';
    g.fillRect(bx - u, y, lw + 2 * u, tick);
    g.fillRect(bx - u, y + h - tick, lw + 2 * u, tick);
    if (!compact && ((barNo % numberEvery) + numberEvery) % numberEvery === 0) {
      const label = String(barNo + 1);
      g.font = font;
      const tw = g.measureText(label).width;
      const lh = Math.max(11, 11 * u);
      g.fillStyle = 'rgba(4,6,10,0.78)';
      g.fillRect(bx + lw + u, y + tick + u, tw + 4 * u, lh);
      g.fillStyle = phrase ? phraseLine : edit ? GRID_EDIT_COLOR : '#ffffff';
      g.fillText(label, bx + lw + 3 * u, y + tick + u + lh - 2.5 * u);
    }
  }
}

export interface ZoomOpts {
  pxPerSec: number; // pixels per second of real time
  playheadX?: number; // fraction of width
  showGrid?: boolean;
  showCues?: boolean;
  deckColor?: string;
  compact?: boolean;
  /** a "GRID EDIT" tag in the corner while the deck is in grid edit (the software strip shows its own) */
  editTag?: boolean;
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

  // every other 4-bar phrase a shade lighter, so phrases read at a glance
  if (opts.showGrid !== false && a.bpm > 0 && (gridStyle === 'bold' || deck.gridEdit)) {
    const phrase = (60 / a.bpm) * 16;
    const k0 = Math.floor((t0 - a.firstBeat) / phrase);
    const k1 = Math.floor((t1 - a.firstBeat) / phrase);
    if (k1 - k0 < 200) {
      g.fillStyle = deck.gridEdit ? 'rgba(255,210,63,0.05)' : 'rgba(255,255,255,0.035)';
      for (let k = k0; k <= k1; k++) {
        if (((k % 2) + 2) % 2 === 1) continue;
        const px0 = cx + (a.firstBeat + k * phrase - pos) * pxPerTrackSec;
        g.fillRect(px0, y, phrase * pxPerTrackSec, h);
      }
    }
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

  // beat grid (on top of the waveform)
  if (opts.showGrid !== false && a.bpm > 0) {
    if (deck.gridEdit || gridStyle === 'bold') drawBoldGrid(g, a.bpm, a.firstBeat, pos, cx, pxPerTrackSec, t0, t1, y, h, deck.gridEdit, !!opts.compact);
    else if (gridStyle === 'subtle') drawSubtleGrid(g, a.bpm, a.firstBeat, pos, cx, pxPerTrackSec, t0, t1, y, h, !!opts.compact);
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
  if (deck.gridEdit && opts.editTag !== false) {
    const u = Math.max(1, Math.round(h / 64));
    const fs = Math.max(10, 10 * u);
    g.font = `700 ${fs}px "Barlow Condensed", sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const label = 'GRID EDIT';
    const tw = g.measureText(label).width;
    const bh = fs + 4 * u;
    g.fillStyle = GRID_EDIT_COLOR;
    g.fillRect(x + w - tw - 12 * u, y + 4 * u, tw + 8 * u, bh);
    g.fillStyle = '#05070a';
    g.fillText(label, x + w - tw - 8 * u, y + 4 * u + bh / 2);
    g.textBaseline = 'alphabetic';
  }
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
    g.fillStyle = gridStyle === 'bold' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.14)';
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
  // inside a zoomed panel (Settings → interface size) a CSS pixel covers more device pixels
  const zoom = (c as HTMLCanvasElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1) * zoom;
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return dpr;
}
