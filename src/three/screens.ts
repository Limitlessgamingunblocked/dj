/* Canvas renderers for the on-device screens of the 3D boards. */
import type { Deck } from '../audio/Deck';
import { beatLabel } from '../audio/Deck';
import { camelotColor, formatKey } from '../analysis/keys';
import { nearEnd } from '../core/prefs';
import { DECK_COLORS, type DeckId } from '../core/types';
import { formatBpm, formatTime } from '../core/util';
import { drawOverview, drawZoomed } from '../ui/waveform';
import type { PartCtx } from './parts';

function chip(g: CanvasRenderingContext2D, x: number, y: number, text: string, on: boolean, color: string, h = 18): number {
  g.font = `700 ${h * 0.7}px "Barlow Condensed", sans-serif`;
  const w = g.measureText(text).width + h * 0.7;
  g.fillStyle = on ? color : '#161b22';
  g.fillRect(x, y, w, h);
  g.fillStyle = on ? '#05070a' : '#4b5566';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(text, x + h * 0.35, y + h / 2 + 1);
  return w + 4;
}

let ovCanvas: HTMLCanvasElement | null = null;

/** Full media-player screen: title, BPM, key, time, zoomed + overview waveform. */
export function drawPlayerScreen(g: CanvasRenderingContext2D, W: number, H: number, d: Deck, c: PartCtx): void {
  const color = DECK_COLORS[d.id as DeckId];
  g.fillStyle = '#020305';
  g.fillRect(0, 0, W, H);
  const pad = W * 0.02;
  // header
  g.fillStyle = color;
  g.font = `700 ${H * 0.085}px "Barlow Condensed", sans-serif`;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.fillText(`DECK ${d.id}`, pad, pad);
  g.fillStyle = '#e7ecf3';
  g.font = `600 ${H * 0.07}px "Barlow", sans-serif`;
  const title = d.track ? `${d.track.meta.title}${d.track.meta.artist ? ' — ' + d.track.meta.artist : ''}` : 'NO TRACK — press LOAD';
  g.fillText(title.slice(0, 48), pad + W * 0.14, pad + H * 0.01);
  // readouts row
  const rowY = H * 0.14;
  g.font = `700 ${H * 0.13}px "JetBrains Mono", monospace`;
  g.fillStyle = '#ffffff';
  g.fillText(d.loaded ? formatBpm(d.bpm) : '--.-', pad, rowY);
  g.font = `600 ${H * 0.05}px "Barlow Condensed", sans-serif`;
  g.fillStyle = '#8a94a6';
  g.fillText('BPM', pad + W * 0.2, rowY + H * 0.02);
  g.fillStyle = d.tempoPercent === 0 ? '#8a94a6' : '#ffd23f';
  g.font = `700 ${H * 0.06}px "JetBrains Mono", monospace`;
  g.fillText(`${d.tempoPercent >= 0 ? '+' : ''}${d.tempoPercent.toFixed(2)}%`, pad + W * 0.2, rowY + H * 0.075);
  g.fillStyle = '#8a94a6';
  g.fillText(`±${Math.round(d.range * 100)}`, pad + W * 0.34, rowY + H * 0.075);
  const key = d.currentKey();
  if (key) {
    g.fillStyle = camelotColor(key);
    g.fillRect(pad + W * 0.44, rowY + H * 0.01, W * 0.11, H * 0.1);
    g.fillStyle = '#05070a';
    g.font = `700 ${H * 0.07}px "JetBrains Mono", monospace`;
    g.textAlign = 'center';
    g.fillText(formatKey(key), pad + W * 0.495, rowY + H * 0.025);
    g.textAlign = 'left';
  }
  g.fillStyle = nearEnd(d) && d.playing ? '#ff3b5c' : '#ffffff';
  g.font = `700 ${H * 0.11}px "JetBrains Mono", monospace`;
  g.textAlign = 'right';
  g.fillText(d.loaded ? `-${formatTime(d.remaining, true)}` : '-:--.-', W - pad, rowY);
  g.font = `600 ${H * 0.05}px "JetBrains Mono", monospace`;
  g.fillStyle = '#8a94a6';
  g.fillText(d.loaded ? formatTime(d.position(), true) : '', W - pad, rowY + H * 0.12);
  g.textAlign = 'left';
  // status chips
  let x = pad;
  const cy = H * 0.33;
  const ch = H * 0.065;
  x += chip(g, x, cy, 'MASTER', d.isMaster, '#ff9f1c', ch);
  x += chip(g, x, cy, 'SYNC', d.sync, '#2ec4f1', ch);
  x += chip(g, x, cy, 'KEY LOCK', d.keylock, '#ff5fcf', ch);
  x += chip(g, x, cy, 'Q', d.quantize, '#ff3b5c', ch);
  x += chip(g, x, cy, 'SLIP', d.slip, '#b36bff', ch);
  x += chip(g, x, cy, d.vinyl ? 'VINYL' : 'CDJ', true, '#e7ecf3', ch);
  x += chip(g, x, cy, `LOOP ${beatLabel(d.loopBeats)}`, d.loop.active, '#3ddc97', ch);
  // zoomed waveform
  const wy = H * 0.42;
  const wh = H * 0.34;
  drawZoomed(g, d, 0, wy, W, wh, { pxPerSec: W / 5.5, deckColor: color, compact: false });
  // hot cue strip
  const hy = wy + wh + H * 0.01;
  const hw = W / 8;
  d.hotCues.forEach((cue, i) => {
    g.fillStyle = cue ? cue.color : '#12161d';
    g.fillRect(i * hw + 2, hy, hw - 4, H * 0.045);
    g.fillStyle = cue ? '#05070a' : '#3a4454';
    g.font = `700 ${H * 0.038}px "Barlow Condensed", sans-serif`;
    g.fillText(`${String.fromCharCode(65 + i)}${cue?.name ? ' ' + cue.name : ''}`.slice(0, 12), i * hw + 6, hy + H * 0.004);
  });
  // overview
  const oy = hy + H * 0.06;
  const oh = H - oy - pad * 0.5;
  if (!ovCanvas) ovCanvas = document.createElement('canvas');
  if (ovCanvas.width !== W || ovCanvas.height !== Math.round(oh)) {
    ovCanvas.width = W;
    ovCanvas.height = Math.max(1, Math.round(oh));
  }
  const og = ovCanvas.getContext('2d')!;
  drawOverview(og, d, W, ovCanvas.height, 1);
  g.drawImage(ovCanvas, 0, oy);
  if (!d.loaded) {
    g.fillStyle = '#3a4454';
    g.font = `600 ${H * 0.06}px "Barlow", sans-serif`;
    g.fillText('Load a track from the library', pad, wy + wh / 2);
  }
  void c;
}

/** clip a line of text to a width, with an ellipsis */
function fit(g: CanvasRenderingContext2D, s: string, w: number): string {
  if (g.measureText(s).width <= w) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(s.slice(0, mid) + '…').width <= w) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + '…';
}

const ovCanvases = new Map<string, HTMLCanvasElement>();
/** a deck's whole-track overview, drawn into its own canvas (cached per size) and blitted */
function overview(g: CanvasRenderingContext2D, d: Deck, x: number, y: number, w: number, h: number): void {
  const key = `${d.id}:${Math.round(w)}x${Math.round(h)}`;
  let c = ovCanvases.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    ovCanvases.set(key, c);
  }
  drawOverview(c.getContext('2d')!, d, c.width, c.height, 1);
  g.drawImage(c, x, y, w, h);
}

/** one deck's header: number, title and artist, BPM and tempo, key, time left */
function deckHeader(g: CanvasRenderingContext2D, d: Deck, x: number, y: number, w: number, h: number): void {
  const color = DECK_COLORS[d.id as DeckId];
  g.fillStyle = color;
  g.fillRect(x, y, h, h);
  g.fillStyle = '#05070a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${h * 0.7}px "Barlow Condensed", sans-serif`;
  g.fillText(String(d.id), x + h / 2, y + h / 2 + 1);
  const right = x + w;
  // time left, BPM, key from the right
  g.textAlign = 'right';
  g.font = `700 ${h * 0.62}px "JetBrains Mono", monospace`;
  g.fillStyle = nearEnd(d) && d.playing ? '#ff3b5c' : '#ffffff';
  const time = d.loaded ? `-${formatTime(d.remaining, true)}` : '-:--.-';
  g.fillText(time, right, y + h / 2);
  const tw = g.measureText(time).width;
  let rx = right - tw - h * 0.5;
  const key = d.loaded ? d.currentKey() : null;
  if (key) {
    const kw = h * 1.5;
    g.fillStyle = camelotColor(key);
    g.fillRect(rx - kw, y + h * 0.1, kw, h * 0.8);
    g.fillStyle = '#05070a';
    g.textAlign = 'center';
    g.font = `700 ${h * 0.52}px "JetBrains Mono", monospace`;
    g.fillText(formatKey(key), rx - kw / 2, y + h / 2 + 1);
    rx -= kw + h * 0.4;
  }
  g.textAlign = 'right';
  g.fillStyle = '#ffffff';
  g.font = `700 ${h * 0.72}px "JetBrains Mono", monospace`;
  const bpm = d.loaded ? formatBpm(d.bpm) : '--.-';
  g.fillText(bpm, rx, y + h / 2);
  const bw = g.measureText(bpm).width;
  // a narrow header (half a laptop screen) gives the tempo column's room to the title
  const narrow = w < h * 14;
  if (!narrow) {
    g.font = `600 ${h * 0.36}px "JetBrains Mono", monospace`;
    g.fillStyle = d.tempoPercent === 0 ? '#6b7586' : '#ffd23f';
    g.fillText(`${d.tempoPercent >= 0 ? '+' : ''}${d.tempoPercent.toFixed(1)}%`, rx - bw - h * 0.25, y + h * 0.72);
    g.fillStyle = d.sync ? '#2ec4f1' : d.isMaster ? '#ff9f1c' : '#3a4454';
    g.fillText(d.isMaster ? 'MASTER' : d.sync ? 'SYNC' : '', rx - bw - h * 0.25, y + h * 0.3);
  }
  // title and artist in what's left
  const tx = x + h * 1.25;
  const room = rx - bw - (narrow ? h * 0.4 : h * 2.6) - tx;
  g.textAlign = 'left';
  g.fillStyle = d.track ? '#eef2f7' : '#3a4454';
  g.font = `700 ${h * 0.5}px "Barlow", sans-serif`;
  g.fillText(fit(g, d.track ? d.track.meta.title : 'Empty: load a track', room), tx, y + h * 0.3);
  g.fillStyle = '#8a94a6';
  g.font = `500 ${h * 0.38}px "Barlow", sans-serif`;
  g.fillText(fit(g, d.track?.meta.artist ?? '', room), tx, y + h * 0.76);
}

/**
 * The pro controller's raised centre display (16:9): both decks stacked,
 * each with its header, a wide zoomed waveform and the whole-track
 * overview; the master deck and beat FX along the bottom.
 */
export function drawCentreScreen(g: CanvasRenderingContext2D, W: number, H: number, c: PartCtx): void {
  g.fillStyle = '#020305';
  g.fillRect(0, 0, W, H);
  const pad = W * 0.015;
  const foot = H * 0.08;
  const laneH = (H - foot - pad) / 2;
  [c.deck('L'), c.deck('R')].forEach((d, i) => {
    const y = pad * 0.6 + i * laneH;
    const hh = laneH * 0.2;
    deckHeader(g, d, pad, y, W - pad * 2, hh);
    const wy = y + hh + laneH * 0.04;
    const wh = laneH * 0.48;
    drawZoomed(g, d, pad, wy, W - pad * 2, wh, { pxPerSec: W / 7, deckColor: DECK_COLORS[d.id as DeckId], compact: false });
    overview(g, d, pad, wy + wh + laneH * 0.04, W - pad * 2, laneH * 0.16);
  });
  // the footer: master deck, beat FX, the time
  const fy = H - foot / 2;
  g.fillStyle = '#0b0f15';
  g.fillRect(0, H - foot, W, foot);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `700 ${foot * 0.5}px "Barlow Condensed", sans-serif`;
  const m = c.engine.masterDeck;
  g.fillStyle = '#ff9f1c';
  g.fillText(`MASTER ${m ? `DECK ${m.id} · ${formatBpm(m.bpm)} BPM` : '—'}`, pad, fy);
  const fx = c.engine.fx;
  g.textAlign = 'center';
  g.fillStyle = fx.on ? '#ff5f7a' : '#6b7586';
  g.fillText(`BEAT FX  ${fx.type.toUpperCase()}  ${fx.on ? 'ON' : 'OFF'}`, W / 2, fy);
  g.textAlign = 'right';
  g.fillStyle = '#8a94a6';
  const now = new Date();
  g.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, W - pad, fy);
}

/**
 * A laptop running the DJ software, for the boards without a screen of
 * their own (16:10): both decks' headers and overviews, their waveforms in
 * parallel, and the library underneath with what's loaded marked.
 */
export function drawLaptopScreen(g: CanvasRenderingContext2D, W: number, H: number, c: PartCtx): void {
  g.fillStyle = '#05070b';
  g.fillRect(0, 0, W, H);
  const pad = W * 0.012;
  // title bar
  const bar = H * 0.05;
  g.fillStyle = '#10141c';
  g.fillRect(0, 0, W, bar);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `800 ${bar * 0.56}px "Barlow Condensed", sans-serif`;
  g.fillStyle = '#e7ecf3';
  g.fillText('DECKHOUSE', pad, bar / 2);
  const m = c.engine.masterDeck;
  g.textAlign = 'center';
  g.fillStyle = '#ff9f1c';
  g.fillText(m ? `${formatBpm(m.bpm)} BPM` : '—', W / 2, bar / 2);
  g.textAlign = 'right';
  g.fillStyle = '#8a94a6';
  const now = new Date();
  g.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, W - pad, bar / 2);
  const decks = [c.deck('L'), c.deck('R')];
  // the two decks side by side: header and overview
  const top = bar + pad;
  const halfW = (W - pad * 3) / 2;
  const hh = H * 0.06;
  decks.forEach((d, i) => {
    const x = pad + i * (halfW + pad);
    deckHeader(g, d, x, top, halfW, hh);
    overview(g, d, x, top + hh + pad * 0.5, halfW, H * 0.06);
  });
  // parallel waveforms
  const wy = top + hh + H * 0.06 + pad;
  const wh = H * 0.11;
  decks.forEach((d, i) => drawZoomed(g, d, 0, wy + i * (wh + 2), W, wh, { pxPerSec: W / 8, deckColor: DECK_COLORS[d.id as DeckId], compact: true }));
  // the library
  const ly = wy + wh * 2 + pad * 1.5;
  const b = c.browser;
  const rowH = H * 0.045;
  const cols: [string, number][] = [
    ['TITLE', 0.05],
    ['ARTIST', 0.42],
    ['BPM', 0.68],
    ['KEY', 0.77],
    ['TIME', 0.88],
  ];
  g.fillStyle = '#0d1118';
  g.fillRect(0, ly, W, rowH);
  g.font = `700 ${rowH * 0.5}px "Barlow Condensed", sans-serif`;
  g.fillStyle = '#6b7586';
  g.textAlign = 'left';
  for (const [label, fx] of cols) g.fillText(label, fx * W, ly + rowH / 2);
  const list = b?.tracks() ?? [];
  const sel = b?.selected()?.id;
  const loaded = decks.map((d) => d.track?.id);
  const rows = Math.floor((H - ly - rowH) / rowH);
  // keep the selection in view
  const si = sel ? list.findIndex((t) => t.id === sel) : -1;
  const first = Math.max(0, Math.min(list.length - rows, si - Math.floor(rows / 2)));
  for (let r = 0; r < rows; r++) {
    const t = list[first + r];
    const y = ly + rowH * (r + 1);
    g.fillStyle = t && t.id === sel ? '#1b2a3c' : r % 2 ? '#080b10' : '#05070b';
    g.fillRect(0, y, W, rowH);
    if (!t) continue;
    const on = loaded.indexOf(t.id);
    if (on >= 0) {
      g.fillStyle = DECK_COLORS[decks[on].id as DeckId];
      g.fillRect(pad * 0.6, y + rowH * 0.2, rowH * 0.6, rowH * 0.6);
    }
    const cy = y + rowH / 2;
    g.font = `600 ${rowH * 0.52}px "Barlow", sans-serif`;
    g.fillStyle = '#e7ecf3';
    g.fillText(fit(g, t.meta.title, (cols[1][1] - cols[0][1] - 0.01) * W), cols[0][1] * W, cy);
    g.fillStyle = '#9aa4b5';
    g.fillText(fit(g, t.meta.artist, (cols[2][1] - cols[1][1] - 0.01) * W), cols[1][1] * W, cy);
    g.font = `600 ${rowH * 0.5}px "JetBrains Mono", monospace`;
    g.fillStyle = '#e7ecf3';
    if (t.analysis?.bpm) g.fillText(formatBpm(t.analysis.bpm), cols[2][1] * W, cy);
    if (t.analysis?.key) {
      g.fillStyle = camelotColor(t.analysis.key);
      g.fillText(formatKey(t.analysis.key), cols[3][1] * W, cy);
    }
    g.fillStyle = '#9aa4b5';
    if (t.analysis?.duration) g.fillText(formatTime(t.analysis.duration), cols[4][1] * W, cy);
  }
  if (!list.length) {
    g.fillStyle = '#4b5566';
    g.font = `500 ${rowH * 0.6}px "Barlow", sans-serif`;
    g.fillText(b ? 'Your library is empty: import music in the Library tab' : 'Library', pad * 4, ly + rowH * 1.8);
  }
}
