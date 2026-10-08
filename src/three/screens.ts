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

/** Centre screen of the pro controller: stacked waveforms of the active decks. */
export function drawDualScreen(g: CanvasRenderingContext2D, W: number, H: number, c: PartCtx): void {
  g.fillStyle = '#020305';
  g.fillRect(0, 0, W, H);
  const decks = [c.deck('L'), c.deck('R')];
  const lane = (H - 36) / 2;
  decks.forEach((d, i) => {
    const y = 4 + i * (lane + 2);
    drawZoomed(g, d, 0, y, W, lane, { pxPerSec: W / 6, deckColor: DECK_COLORS[d.id as DeckId], compact: true });
    g.fillStyle = 'rgba(2,3,5,0.7)';
    g.fillRect(0, y, 150, 26);
    g.fillStyle = DECK_COLORS[d.id as DeckId];
    g.font = '700 20px "Barlow Condensed", sans-serif';
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillText(`${d.id}`, 6, y + 3);
    g.fillStyle = '#fff';
    g.font = '700 18px "JetBrains Mono", monospace';
    g.fillText(d.loaded ? formatBpm(d.bpm) : '--.-', 24, y + 4);
  });
  // footer: master tempo + fx
  g.fillStyle = '#8a94a6';
  g.font = '600 16px "Barlow Condensed", sans-serif';
  g.textBaseline = 'middle';
  const m = c.engine.masterDeck;
  g.fillText(`MASTER ${m ? `DECK ${m.id} · ${formatBpm(m.bpm)} BPM` : '—'}`, 8, H - 15);
  const fx = c.engine.fx;
  g.textAlign = 'right';
  g.fillStyle = fx.on ? '#ff5f7a' : '#8a94a6';
  g.fillText(`FX ${fx.type.toUpperCase()} ${fx.on ? 'ON' : 'OFF'}`, W - 8, H - 15);
  g.textAlign = 'left';
}
