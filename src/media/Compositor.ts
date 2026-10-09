/*
 * The recording's picture (Sections 11.2, 11.5, 11.6): the stage's frame,
 * cropped to the chosen aspect (16:9, 9:16 vertical, 1:1 square), with the
 * overlays drawn on top, each one optional:
 *   your name as a watermark, in a corner and a style you pick
 *   the venue and the date
 *   "now playing", sliding in on each new track
 *   the tracklist building up in a corner
 *   a VHS timestamp filter
 * Overlays keep out of each other's way: the watermark takes its corner and
 * the rest move to the free ones.
 */
import { nameService, type NameStyle } from '../name/NameService';
import type { TracklistEntry } from '../core/models';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface OverlayOpts {
  watermark: boolean;
  corner: Corner;
  /** a name style, or the venue's own */
  style: NameStyle | 'venue';
  venueDate: boolean;
  nowPlaying: boolean;
  tracklist: boolean;
  vhs: boolean;
}

export const DEFAULT_OVERLAYS: OverlayOpts = { watermark: true, corner: 'tr', style: 'venue', venueDate: true, nowPlaying: true, tracklist: false, vhs: false };

export interface OverlayState {
  /** the name as shown (empty: no watermark) */
  name: string;
  /** the style the venue writes the name in */
  venueStyle: NameStyle;
  venue: string;
  date: Date;
  /** seconds since the recording started */
  t: number;
  tracklist: TracklistEntry[];
}

const LABEL = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const p2 = (n: number) => String(n).padStart(2, '0');
export const mmss = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(Math.floor(s % 60))}` : `${p2(Math.floor(s / 60))}:${p2(Math.floor(s % 60))}`);

/** the part of a `sw`×`sh` source that fills a `dw`×`dh` frame (centred crop) */
export function cropRect(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const sa = sw / sh;
  const da = dw / dh;
  if (sa > da) {
    const w = sh * da;
    return { x: (sw - w) / 2, y: 0, w, h: sh };
  }
  const h = sw / da;
  return { x: 0, y: (sh - h) / 2, w: sw, h };
}

/** where each overlay goes, given the watermark's corner */
export function layout(o: OverlayOpts): { nowPlaying: Corner; venueDate: Corner; tracklist: Corner; vhsPlay: Corner; vhsDate: Corner } {
  const used = new Set<Corner | null>([o.watermark ? o.corner : null]);
  const pick = (want: Corner[]): Corner => {
    const c = want.find((x) => !used.has(x)) ?? want[0];
    used.add(c);
    return c;
  };
  const bottom = o.nowPlaying || o.venueDate ? pick(['bl', 'br']) : 'bl';
  const top = o.tracklist ? pick(['tr', 'tl']) : 'tr';
  const vhsPlay = o.vhs ? pick(['tl', 'tr', 'bl', 'br']) : 'tl';
  const vhsDate = o.vhs ? pick(['br', 'bl', 'tr', 'tl']) : 'br';
  return { nowPlaying: bottom, venueDate: bottom, tracklist: top, vhsPlay, vhsDate };
}

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private mark: HTMLCanvasElement | null = null;
  private markKey = '';
  private shownTrack = -1;
  private trackShownAt = -1e9;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
  }

  /** draw a frame: the source cropped to fill, then the overlays */
  draw(src: CanvasImageSource & { width: number; height: number }, o: OverlayOpts, s: OverlayState, sw = src.width, sh = src.height): void {
    const g = this.g;
    const W = this.width;
    const H = this.height;
    const c = cropRect(sw, sh, W, H);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, W, H);
    this.overlays(o, s);
  }

  /** the overlays alone (also used over a decoded frame when exporting a clip) */
  overlays(o: OverlayOpts, s: OverlayState): void {
    const W = this.width;
    const H = this.height;
    const u = Math.min(W, H) / 1080; // one "pixel" at 1080p
    const pad = Math.round(36 * u);
    const L = layout(o);
    if (o.vhs) this.vhs(s, L.vhsPlay, L.vhsDate, u, pad);
    if (o.watermark && s.name) this.watermark(o, s, u, pad);
    let bottomY = H - pad;
    if (o.venueDate) bottomY = this.venueDate(s, L.venueDate, u, pad) - Math.round(14 * u);
    if (o.nowPlaying) this.nowPlaying(s, L.nowPlaying, u, pad, bottomY);
    if (o.tracklist) this.tracklist(s, L.tracklist, u, pad);
  }

  private watermark(o: OverlayOpts, s: OverlayState, u: number, pad: number): void {
    const style: NameStyle = o.style === 'venue' ? s.venueStyle : o.style;
    const mw = Math.round(Math.min(this.width * 0.34, 520 * u * (this.width > this.height ? 1 : 1.25)));
    const mh = Math.round(mw * 0.32);
    const key = `${style}|${s.name}|${mw}x${mh}`;
    if (key !== this.markKey) {
      const c = document.createElement('canvas');
      c.width = mw;
      c.height = mh;
      nameService.draw(c, style, s.name, { bg: null });
      this.mark = c;
      this.markKey = key;
    }
    const g = this.g;
    const x = o.corner.endsWith('l') ? pad : this.width - pad - mw;
    const y = o.corner.startsWith('t') ? pad - mh * 0.1 : this.height - pad - mh;
    // glowing styles add light; printed ones sit on top
    const glow = !['marker', 'handpainted', 'sticker'].includes(style);
    g.save();
    g.globalAlpha = 0.9;
    g.globalCompositeOperation = glow ? 'lighter' : 'source-over';
    g.drawImage(this.mark!, x, y);
    g.restore();
  }

  private venueDate(s: OverlayState, corner: Corner, u: number, pad: number): number {
    const g = this.g;
    const size = Math.round(26 * u);
    const text = `${s.venue.toUpperCase()}  ·  ${s.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}`;
    g.save();
    g.font = `600 ${size}px ${LABEL}`;
    g.textBaseline = 'alphabetic';
    g.letterSpacing = `${Math.round(3 * u)}px`;
    const right = corner.endsWith('r');
    g.textAlign = right ? 'right' : 'left';
    const x = right ? this.width - pad : pad;
    const y = corner.startsWith('t') ? pad + size : this.height - pad;
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 8 * u;
    g.fillStyle = 'rgba(255,255,255,0.86)';
    g.fillText(text, x, y);
    g.restore();
    return y - size;
  }

  private nowPlaying(s: OverlayState, corner: Corner, u: number, pad: number, bottomY: number): void {
    const list = s.tracklist;
    if (!list.length) return;
    const idx = list.length - 1;
    const cur = list[idx];
    if (idx !== this.shownTrack) {
      this.shownTrack = idx;
      this.trackShownAt = Math.max(cur.at, s.t - 0.01);
    }
    const age = s.t - this.trackShownAt;
    const HOLD = 7;
    if (age < 0 || age > HOLD + 0.5) return;
    // slide in for 0.4 s, hold, slide out
    const kIn = Math.min(1, age / 0.4);
    const kOut = Math.min(1, Math.max(0, (HOLD + 0.5 - age) / 0.4));
    const k = Math.min(kIn, kOut);
    const ease = 1 - Math.pow(1 - k, 3);
    const g = this.g;
    const tSize = Math.round(44 * u);
    const aSize = Math.round(28 * u);
    const lSize = Math.round(18 * u);
    g.save();
    g.font = `800 ${tSize}px ${LABEL}`;
    const tw = g.measureText(cur.title).width;
    g.font = `500 ${aSize}px ${LABEL}`;
    const aw = g.measureText(cur.artist).width;
    const w = Math.min(this.width - pad * 2, Math.max(tw, aw) + 48 * u);
    const h = Math.round(lSize + tSize + aSize + 44 * u);
    const right = corner.endsWith('r');
    const x0 = right ? this.width - pad - w : pad;
    const slide = (1 - ease) * (w + pad) * (right ? 1 : -1);
    const x = x0 + slide;
    const y = bottomY - h;
    g.globalAlpha = ease;
    g.fillStyle = 'rgba(8,8,12,0.78)';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#ff2e88';
    g.fillRect(right ? x + w - 6 * u : x, y, 6 * u, h);
    const tx = x + (right ? 24 * u : 30 * u);
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `700 ${lSize}px ${LABEL}`;
    g.letterSpacing = `${Math.round(3 * u)}px`;
    g.fillStyle = '#ff2e88';
    g.fillText('NOW PLAYING', tx, y + 14 * u);
    g.letterSpacing = '0px';
    g.font = `800 ${tSize}px ${LABEL}`;
    g.fillStyle = '#fff';
    g.fillText(cur.title, tx, y + 14 * u + lSize + 6 * u, w - 48 * u);
    g.font = `500 ${aSize}px ${LABEL}`;
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(cur.artist, tx, y + 14 * u + lSize + tSize + 10 * u, w - 48 * u);
    g.restore();
  }

  private tracklist(s: OverlayState, corner: Corner, u: number, pad: number): void {
    const list = s.tracklist.slice(-6);
    if (!list.length) return;
    const g = this.g;
    const size = Math.round(22 * u);
    const line = Math.round(size * 1.45);
    const w = Math.round(Math.min(this.width * 0.42, 560 * u));
    const h = Math.round(line * (list.length + 1) + 24 * u);
    const right = corner.endsWith('r');
    const x = right ? this.width - pad - w : pad;
    const y = corner.startsWith('t') ? pad : this.height - pad - h;
    g.save();
    g.fillStyle = 'rgba(8,8,12,0.62)';
    g.fillRect(x, y, w, h);
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.font = `700 ${Math.round(size * 0.8)}px ${LABEL}`;
    g.letterSpacing = `${Math.round(3 * u)}px`;
    g.fillStyle = '#ffb547';
    g.fillText('TRACKLIST', x + 16 * u, y + 12 * u);
    g.letterSpacing = '0px';
    list.forEach((e, i) => {
      // the newest line fades in over a second
      const age = s.t - e.at;
      g.globalAlpha = i === list.length - 1 ? Math.min(1, Math.max(0, age)) : 1;
      const ly = y + 12 * u + line * (i + 1);
      g.font = `500 ${size}px ${MONO}`;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillText(mmss(e.at), x + 16 * u, ly);
      g.font = `600 ${size}px ${LABEL}`;
      g.fillStyle = '#fff';
      g.fillText(`${e.title} — ${e.artist}`, x + 16 * u + size * 3.6, ly, w - size * 3.6 - 32 * u);
    });
    g.restore();
  }

  private vhs(s: OverlayState, play: Corner, date: Corner, u: number, pad: number): void {
    const g = this.g;
    const W = this.width;
    const H = this.height;
    g.save();
    // scanlines and a rolling noise band
    g.globalAlpha = 0.12;
    g.fillStyle = '#000';
    const step = Math.max(2, Math.round(3 * u));
    for (let y = 0; y < H; y += step * 2) g.fillRect(0, y, W, step);
    const band = ((s.t * 0.11) % 1.2) * H - 0.1 * H;
    g.globalAlpha = 0.07;
    g.fillStyle = '#fff';
    g.fillRect(0, band, W, H * 0.05);
    g.globalAlpha = 1;
    const size = Math.round(40 * u);
    g.font = `700 ${size}px ${MONO}`;
    g.textBaseline = 'top';
    g.shadowColor = 'rgba(0,0,0,0.9)';
    g.shadowOffsetX = 3 * u;
    g.shadowOffsetY = 3 * u;
    g.fillStyle = '#f2f2f2';
    const at = (c: Corner, text: string) => {
      const right = c.endsWith('r');
      g.textAlign = right ? 'right' : 'left';
      const y = c.startsWith('t') ? pad : H - pad - size;
      g.fillText(text, right ? W - pad : pad, y);
    };
    at(play, Math.floor(s.t * 2) % 2 ? 'PLAY ▶' : 'PLAY  ');
    const d = new Date(s.date.getTime() + s.t * 1000);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const hh = d.getHours();
    at(date, `${hh % 12 || 12}:${p2(d.getMinutes())}${hh < 12 ? 'AM' : 'PM'}  ${months[d.getMonth()]}. ${p2(d.getDate())} ${d.getFullYear()}`);
    g.restore();
  }
}
