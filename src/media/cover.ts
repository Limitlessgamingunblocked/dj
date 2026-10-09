/*
 * Auto cover art (Section 11.6): a square flyer for every set, with your
 * name in the venue's lettering, the venue, the date and how long you
 * played, over a still from the set in the venue's flyer style:
 *   notebook  the Bedroom: lined paper, tape, marker
 *   xerox     basements and dark rooms: photocopied black and white, one red
 *   rave      warehouses and big rooms: acid colours, a grid, chrome
 *   sunset    open-air rooms: a warm sky and a sun
 * All drawn here, no images needed.
 */
import { nameService, type NameStyle } from '../name/NameService';

export type FlyerStyle = 'notebook' | 'xerox' | 'rave' | 'sunset';

const FLYER: Record<string, FlyerStyle> = {
  bedroom: 'notebook',
  basement: 'xerox',
  boilerroom: 'xerox',
  berghain: 'xerox',
  warehouse: 'rave',
  printworks: 'rave',
  festival: 'rave',
  allypally: 'rave',
  'allypally-round': 'rave',
  rooftop: 'sunset',
  beach: 'sunset',
  boat: 'sunset',
  dc10: 'sunset',
  sunrise: 'sunset',
};

export const flyerFor = (venue: string): FlyerStyle => FLYER[venue] ?? 'rave';

export interface CoverInfo {
  name: string;
  nameStyle: NameStyle;
  venueId: string;
  venue: string;
  date: Date;
  seconds: number;
  /** a line under the name: "Peak time", "Save That Mix"… */
  sub?: string;
  /** a still from the set */
  still?: CanvasImageSource | null;
}

const LABEL = "'Barlow Condensed', 'Arial Narrow', sans-serif";
const MARKER = "'Permanent Marker', 'Comic Sans MS', cursive";

/** a small seeded random, so the same set always gets the same cover */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function length(s: number): string {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}H ${m % 60}MIN` : `${Math.max(1, m)} MIN`;
}

/** the still, tinted between two colours (a duotone), covering the canvas */
function duotone(g: CanvasRenderingContext2D, img: CanvasImageSource, S: number, dark: [number, number, number], light: [number, number, number], alpha = 1): void {
  const c = document.createElement('canvas');
  c.width = c.height = 360;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const iw = (img as HTMLCanvasElement).width || 360;
  const ih = (img as HTMLCanvasElement).height || 360;
  const sz = Math.min(iw, ih);
  x.drawImage(img, (iw - sz) / 2, (ih - sz) / 2, sz, sz, 0, 0, 360, 360);
  const d = x.getImageData(0, 0, 360, 360);
  for (let i = 0; i < d.data.length; i += 4) {
    const l = Math.min(1, (0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2]) / 200);
    for (let k = 0; k < 3; k++) d.data[i + k] = dark[k] + (light[k] - dark[k]) * l;
  }
  x.putImageData(d, 0, 0);
  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.drawImage(c, 0, 0, S, S);
  g.restore();
}

function grain(g: CanvasRenderingContext2D, S: number, r: () => number, amount: number, light = false): void {
  g.save();
  g.globalAlpha = amount;
  g.fillStyle = light ? '#fff' : '#000';
  for (let i = 0; i < S * 6; i++) g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  g.restore();
}

function nameArt(info: CoverInfo, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  nameService.draw(c, info.nameStyle, info.name || 'DECKHOUSE', { bg: null });
  return c;
}

/** Draw the cover onto a square canvas. */
export function drawCover(canvas: HTMLCanvasElement, info: CoverInfo): void {
  const S = canvas.width;
  const g = canvas.getContext('2d')!;
  const style = flyerFor(info.venueId);
  const r = rng(Math.floor(info.date.getTime() / 1000) ^ info.name.length * 7919);
  const date = info.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (style === 'notebook') {
    g.fillStyle = '#f4efe2';
    g.fillRect(0, 0, S, S);
    if (info.still) {
      // a printed photo taped to the page
      g.save();
      g.translate(S * 0.5, S * 0.4);
      g.rotate(-0.05);
      g.fillStyle = '#fff';
      g.fillRect(-S * 0.33, -S * 0.25, S * 0.66, S * 0.5);
      const ph = document.createElement('canvas');
      ph.width = ph.height = S;
      duotone(ph.getContext('2d')!, info.still, S, [30, 20, 60], [255, 210, 230]);
      g.drawImage(ph, S * 0.1, S * 0.25, S * 0.8, S * 0.5, -S * 0.31, -S * 0.23, S * 0.62, S * 0.46);
      g.fillStyle = 'rgba(255,240,170,0.75)';
      g.fillRect(-S * 0.09, -S * 0.28, S * 0.18, S * 0.06);
      g.restore();
    }
    g.strokeStyle = 'rgba(80,120,200,0.35)';
    g.lineWidth = Math.max(1, S / 600);
    for (let y = S * 0.08; y < S; y += S * 0.045) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(220,60,60,0.5)';
    g.beginPath();
    g.moveTo(S * 0.1, 0);
    g.lineTo(S * 0.1, S);
    g.stroke();
    g.drawImage(nameArt(info, Math.round(S * 0.86), Math.round(S * 0.24)), S * 0.07, S * 0.66);
    g.fillStyle = '#1d2a6b';
    g.font = `${Math.round(S * 0.045)}px ${MARKER}`;
    g.fillText(`live from my ${info.venue.toLowerCase()} · ${date.toLowerCase()}`, S / 2, S * 0.93);
  } else if (style === 'xerox') {
    g.fillStyle = '#0b0b0b';
    g.fillRect(0, 0, S, S);
    if (info.still) duotone(g, info.still, S, [8, 8, 8], [235, 235, 225], 0.9);
    // photocopy: crushed contrast, toner speckle, a red bar
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, S, S);
    grain(g, S, r, 0.5);
    grain(g, S, r, 0.25, true);
    g.fillStyle = '#e0243c';
    g.fillRect(0, S * 0.08, S, S * 0.09);
    g.fillStyle = '#fff';
    g.font = `900 ${Math.round(S * 0.07)}px ${LABEL}`;
    g.fillText(info.venue.toUpperCase(), S / 2, S * 0.125 + S * 0.004);
    g.drawImage(nameArt(info, Math.round(S * 0.9), Math.round(S * 0.3)), S * 0.05, S * 0.55);
    g.font = `700 ${Math.round(S * 0.04)}px ${LABEL}`;
    g.fillStyle = '#f2f2f2';
    g.fillText(`${date}  ·  ${length(info.seconds)}${info.sub ? `  ·  ${info.sub.toUpperCase()}` : ''}`, S / 2, S * 0.92);
  } else if (style === 'rave') {
    const grd = g.createLinearGradient(0, 0, S, S);
    grd.addColorStop(0, '#2a0057');
    grd.addColorStop(0.55, '#ff2e88');
    grd.addColorStop(1, '#b6ff3b');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    if (info.still) {
      g.globalCompositeOperation = 'multiply';
      duotone(g, info.still, S, [20, 0, 40], [255, 255, 255], 0.85);
      g.globalCompositeOperation = 'source-over';
    }
    // a perspective grid on the floor
    g.strokeStyle = 'rgba(182,255,59,0.55)';
    g.lineWidth = Math.max(1, S / 500);
    for (let i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(S / 2 + i * S * 0.02, S * 0.62);
      g.lineTo(S / 2 + i * S * 0.16, S);
      g.stroke();
    }
    for (let k = 0; k < 8; k++) {
      const y = S * 0.62 + (S * 0.38 * (k * k)) / 49;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(S, y);
      g.stroke();
    }
    g.drawImage(nameArt(info, Math.round(S * 0.9), Math.round(S * 0.3)), S * 0.05, S * 0.3);
    g.font = `900 ${Math.round(S * 0.06)}px ${LABEL}`;
    g.fillStyle = '#fff';
    g.fillText(info.venue.toUpperCase(), S / 2, S * 0.12);
    g.font = `700 ${Math.round(S * 0.038)}px ${LABEL}`;
    g.fillText(`${date}  ·  ${length(info.seconds)}`, S / 2, S * 0.2);
    grain(g, S, r, 0.12, true);
  } else {
    const sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, '#2b1b54');
    sky.addColorStop(0.45, '#ff6a3d');
    sky.addColorStop(0.75, '#ffb547');
    sky.addColorStop(1, '#ffd9a0');
    g.fillStyle = sky;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,240,200,0.9)';
    g.beginPath();
    g.arc(S / 2, S * 0.62, S * 0.2, Math.PI, 0);
    g.fill();
    if (info.still) {
      g.globalCompositeOperation = 'soft-light';
      duotone(g, info.still, S, [40, 10, 40], [255, 220, 180], 0.7);
      g.globalCompositeOperation = 'source-over';
    }
    g.fillStyle = '#1a0f2e';
    g.fillRect(0, S * 0.62, S, S * 0.38);
    g.drawImage(nameArt(info, Math.round(S * 0.88), Math.round(S * 0.26)), S * 0.06, S * 0.66);
    g.font = `800 ${Math.round(S * 0.055)}px ${LABEL}`;
    g.fillStyle = '#fff';
    g.fillText(info.venue.toUpperCase(), S / 2, S * 0.12);
    g.font = `600 ${Math.round(S * 0.036)}px ${LABEL}`;
    g.fillText(`${date}  ·  ${length(info.seconds)}`, S / 2, S * 0.19);
  }
  g.restore();
}

/** the cover as a PNG */
export function coverPng(info: CoverInfo, size = 1200): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawCover(c, info);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

/** The tracklist as a text file (Section 11.6). */
export function tracklistText(o: { name: string; venue: string; date: Date; seconds: number; title?: string; tracklist: { at: number; title: string; artist: string }[] }): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const ts = (s: number) => (o.seconds >= 3600 ? `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(Math.floor(s % 60))}` : `${p2(Math.floor(s / 60))}:${p2(Math.floor(s % 60))}`);
  const date = o.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [`${o.name || 'DJ'} — ${o.title ?? o.venue}`, `${o.venue}, ${date} · ${ts(o.seconds)}`, ''];
  if (!o.tracklist.length) lines.push('(no tracks long enough to list)');
  for (const t of o.tracklist) lines.push(`${ts(t.at)}  ${t.title} — ${t.artist}`);
  lines.push('', 'Recorded in DeckHouse DJ');
  return lines.join('\n') + '\n';
}
