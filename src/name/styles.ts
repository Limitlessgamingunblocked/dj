/*
 * The looks the DJ name comes in (Section 3.3), each drawn on a 2D canvas:
 *   led_sign       a dot-matrix sign (the naming scene), warm white dots
 *   pixel_led      a festival LED wall: big RGB dots in a pink → cyan sweep
 *   neon_red       red neon tube, glowing
 *   neon_script    pink neon in a script hand (the rooftop)
 *   chrome_led     chrome 3D lettering (the warehouse's LED walls, booth panels)
 *   marker         black marker on a sheet of paper taped up (the bedroom)
 *   handpainted    cream paint on wooden planks (the beach club)
 *   white_install  thin, wide-spaced white light (the sunrise set)
 *   sticker        a die-cut vinyl sticker (decks, laptop lid)
 * Emissive styles are drawn on transparent black and glow in the club;
 * printed ones are opaque and lit like any surface.
 */
import type { Laid } from './layout';

export type NameStyle = 'led_sign' | 'pixel_led' | 'neon_red' | 'neon_script' | 'chrome_led' | 'marker' | 'handpainted' | 'white_install' | 'sticker';

export interface DrawOpts {
  /** per-letter brightness 0..1 (the naming scene lights letters as they're typed) */
  lit?: number[];
  /** solid background behind an emissive style (a panel), or none */
  bg?: string | null;
  accent?: string;
}

export interface StyleDef {
  id: NameStyle;
  label: string;
  /** CSS font for a given px size */
  font(size: number): string;
  lineHeight: number;
  tracking: number;
  pad: number;
  /** glows (drawn on transparent black, additive) rather than printed */
  emissive: boolean;
  draw(g: CanvasRenderingContext2D, w: number, h: number, laid: Laid, o: DrawOpts): void;
}

const CONDENSED = '"Barlow Condensed", "Arial Narrow", sans-serif';
const SCRIPT = '"Pacifico", "Brush Script MT", cursive';
const MARKER = '"Permanent Marker", "Comic Sans MS", cursive';
const SANS = '"Barlow", "Helvetica Neue", Arial, sans-serif';

/** draw the laid-out lines, whole (keeps the font's kerning and joins) */
function lines(g: CanvasRenderingContext2D, w: number, laid: Laid, fill: boolean, dx = 0, dy = 0): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  laid.lines.forEach((l, i) => (fill ? g.fillText(l, w / 2 + dx, laid.ys[i] + dy) : g.strokeText(l, w / 2 + dx, laid.ys[i] + dy)));
}

/** draw letter by letter at their boxes (tracking, per-letter brightness) */
function letters(g: CanvasRenderingContext2D, w: number, laid: Laid, alpha?: (i: number) => number): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let k = 0;
  laid.lines.forEach((l, li) => {
    for (const ch of l) {
      if (ch === ' ') continue;
      const b = laid.boxes[k];
      if (!b) return;
      g.globalAlpha = alpha ? alpha(k) : 1;
      g.fillText(ch, ((b.x0 + b.x1) / 2) * w, laid.ys[li]);
      k++;
    }
  });
  g.globalAlpha = 1;
}

/** a dot-matrix rendering: the text sampled onto a grid of dots, lit or dark */
function dotMatrix(g: CanvasRenderingContext2D, w: number, h: number, laid: Laid, font: (s: number) => string, pitch: number, colour: (x: number, y: number) => [number, number, number], lit?: number[], dark = 'rgba(255,255,255,0.05)'): void {
  const cols = Math.max(8, Math.floor(w / pitch));
  const rows = Math.max(4, Math.floor(h / pitch));
  const m = document.createElement('canvas');
  m.width = cols;
  m.height = rows;
  const mg = m.getContext('2d')!;
  const sx = cols / w;
  const sy = rows / h;
  mg.scale(sx, sy);
  mg.fillStyle = '#fff';
  mg.font = font(laid.size);
  letters(mg, w, laid, lit ? (i) => lit[i] ?? 1 : undefined);
  const px = mg.getImageData(0, 0, cols, rows).data;
  const cw = w / cols;
  const ch = h / rows;
  const r = Math.min(cw, ch) * 0.4;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const a = px[(y * cols + x) * 4 + 3] / 255;
      const cx = (x + 0.5) * cw;
      const cy = (y + 0.5) * ch;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      if (a > 0.3) {
        const [cr, cg, cb] = colour(x / cols, y / rows);
        g.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, a * 1.15)})`;
        g.shadowColor = `rgba(${cr},${cg},${cb},0.9)`;
        g.shadowBlur = r * 1.6;
      } else {
        g.fillStyle = dark;
        g.shadowBlur = 0;
      }
      g.fill();
    }
  g.shadowBlur = 0;
}

function neon(g: CanvasRenderingContext2D, w: number, laid: Laid, glow: string, tube: string, core: string): void {
  const s = laid.size;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // wide soft glow, the tube, then the hot core
  g.shadowColor = glow;
  g.shadowBlur = s * 0.35;
  g.strokeStyle = glow;
  g.lineWidth = s * 0.09;
  lines(g, w, laid, false);
  g.shadowBlur = s * 0.12;
  g.strokeStyle = tube;
  g.lineWidth = s * 0.055;
  lines(g, w, laid, false);
  g.shadowBlur = 0;
  g.strokeStyle = core;
  g.lineWidth = s * 0.022;
  lines(g, w, laid, false);
}

function panel(g: CanvasRenderingContext2D, w: number, h: number, bg: string | null | undefined): void {
  g.clearRect(0, 0, w, h);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
}

/** a small deterministic random for paper grain and wood grain */
function rand(seed: number): () => number {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
}

export const STYLES: Record<NameStyle, StyleDef> = {
  led_sign: {
    id: 'led_sign',
    label: 'LED sign',
    font: (s) => `800 ${s}px ${CONDENSED}`,
    lineHeight: 1.05,
    tracking: 0.06,
    pad: 0.1,
    emissive: true,
    draw(g, w, h, laid, o) {
      panel(g, w, h, o.bg ?? '#050506');
      dotMatrix(g, w, h, laid, this.font, Math.max(6, h / 30), () => [255, 214, 160], o.lit);
    },
  },
  pixel_led: {
    id: 'pixel_led',
    label: 'Pixel LED',
    font: (s) => `900 ${s}px ${CONDENSED}`,
    lineHeight: 1.0,
    tracking: 0.05,
    pad: 0.08,
    emissive: true,
    draw(g, w, h, laid, o) {
      panel(g, w, h, o.bg);
      dotMatrix(g, w, h, laid, this.font, Math.max(5, h / 26), (x) => {
        // hot pink → UV purple → cyan across the wall
        const a = [255, 46, 136];
        const b = [122, 60, 255];
        const c = [60, 220, 255];
        const t = x * 2;
        const [p, q, k] = t < 1 ? [a, b, t] : [b, c, t - 1];
        return [0, 1, 2].map((i) => Math.round(p[i] + (q[i] - p[i]) * k)) as [number, number, number];
      }, o.lit, 'rgba(255,255,255,0.025)');
    },
  },
  neon_red: {
    id: 'neon_red',
    label: 'Red neon',
    font: (s) => `600 ${s}px ${CONDENSED}`,
    lineHeight: 1.15,
    tracking: 0,
    pad: 0.16,
    emissive: true,
    draw(g, w, h, laid, o) {
      panel(g, w, h, o.bg);
      g.font = this.font(laid.size);
      neon(g, w, laid, 'rgba(255,30,40,0.9)', '#ff3a3a', '#ffd6d0');
    },
  },
  neon_script: {
    id: 'neon_script',
    label: 'Neon script',
    font: (s) => `400 ${s}px ${SCRIPT}`,
    lineHeight: 1.35,
    tracking: 0,
    pad: 0.16,
    emissive: true,
    draw(g, w, h, laid, o) {
      panel(g, w, h, o.bg);
      g.font = this.font(laid.size);
      neon(g, w, laid, 'rgba(255,46,136,0.9)', '#ff5fa8', '#ffe1ee');
    },
  },
  chrome_led: {
    id: 'chrome_led',
    label: 'Chrome',
    font: (s) => `900 ${s}px ${CONDENSED}`,
    lineHeight: 1.0,
    tracking: 0.02,
    pad: 0.1,
    emissive: true,
    draw(g, w, h, laid, o) {
      panel(g, w, h, o.bg);
      const s = laid.size;
      g.font = this.font(s);
      g.lineJoin = 'round';
      // depth: a dark extrusion down and right
      g.fillStyle = '#20252e';
      for (let i = 1; i <= 4; i++) lines(g, w, laid, true, s * 0.012 * i, s * 0.016 * i);
      laid.lines.forEach((_, i) => {
        const top = laid.ys[i] - laid.size * 0.5;
        const gr = g.createLinearGradient(0, top, 0, top + laid.size);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.42, '#c9ced6');
        gr.addColorStop(0.5, '#6f7a8c');
        gr.addColorStop(0.62, '#e8edf4');
        gr.addColorStop(1, '#8c96a6');
        g.fillStyle = gr;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(laid.lines[i], w / 2, laid.ys[i]);
      });
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = Math.max(1, s * 0.012);
      lines(g, w, laid, false);
    },
  },
  marker: {
    id: 'marker',
    label: 'Marker on paper',
    font: (s) => `400 ${s}px ${MARKER}`,
    lineHeight: 1.2,
    tracking: 0,
    pad: 0.14,
    emissive: false,
    draw(g, w, h, laid) {
      const r = rand(7);
      g.clearRect(0, 0, w, h);
      // the sheet, slightly crooked, with a little grain
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-0.012);
      g.fillStyle = '#f3efe4';
      g.fillRect(-w * 0.48, -h * 0.46, w * 0.96, h * 0.92);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(90,80,60,${r() * 0.05})`;
        g.fillRect((r() - 0.5) * w * 0.96, (r() - 0.5) * h * 0.92, 1 + r() * 2, 1 + r() * 2);
      }
      g.restore();
      // tape on the corners
      g.fillStyle = 'rgba(232,222,190,0.75)';
      for (const [x, y, a] of [
        [0.06, 0.08, -0.6],
        [0.94, 0.08, 0.6],
        [0.06, 0.92, 0.6],
        [0.94, 0.92, -0.6],
      ]) {
        g.save();
        g.translate(x * w, y * h);
        g.rotate(a);
        g.fillRect(-w * 0.05, -h * 0.03, w * 0.1, h * 0.06);
        g.restore();
      }
      g.font = this.font(laid.size);
      g.fillStyle = '#121212';
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-0.02);
      g.translate(-w / 2, -h / 2);
      lines(g, w, laid, true);
      g.restore();
    },
  },
  handpainted: {
    id: 'handpainted',
    label: 'Hand-painted',
    font: (s) => `400 ${s}px ${MARKER}`,
    lineHeight: 1.2,
    tracking: 0.02,
    pad: 0.14,
    emissive: false,
    draw(g, w, h, laid) {
      const r = rand(11);
      // planks
      const n = 4;
      for (let i = 0; i < n; i++) {
        const y = (i / n) * h;
        g.fillStyle = ['#6b4a2e', '#7a5535', '#5f4128', '#734f31'][i % 4];
        g.fillRect(0, y, w, h / n);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(0, y, w, Math.max(1, h * 0.012));
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(40,25,10,${0.1 + r() * 0.15})`;
          g.fillRect(r() * w, y + r() * (h / n), w * (0.05 + r() * 0.25), 1);
        }
      }
      g.font = this.font(laid.size);
      g.fillStyle = 'rgba(30,20,10,0.5)';
      lines(g, w, laid, true, laid.size * 0.02, laid.size * 0.03);
      g.fillStyle = '#f4e7cc';
      lines(g, w, laid, true);
    },
  },
  white_install: {
    id: 'white_install',
    label: 'White light',
    font: (s) => `500 ${s}px ${SANS}`,
    lineHeight: 1.2,
    tracking: 0.38,
    pad: 0.12,
    emissive: true,
    draw(g, w, h, laid, o) {
      panel(g, w, h, o.bg);
      g.font = this.font(laid.size);
      g.fillStyle = '#ffffff';
      g.shadowColor = 'rgba(255,250,240,0.8)';
      g.shadowBlur = laid.size * 0.15;
      letters(g, w, laid);
      g.shadowBlur = 0;
    },
  },
  sticker: {
    id: 'sticker',
    label: 'Sticker',
    font: (s) => `900 ${s}px ${CONDENSED}`,
    lineHeight: 1.0,
    tracking: 0.02,
    pad: 0.2,
    emissive: false,
    draw(g, w, h, laid, o) {
      g.clearRect(0, 0, w, h);
      const m = Math.min(w, h) * 0.06;
      const rr = Math.min(w, h) * 0.22;
      const shape = () => {
        g.beginPath();
        g.roundRect(m, m, w - m * 2, h - m * 2, rr);
      };
      // white die-cut border, then the colour
      g.fillStyle = '#ffffff';
      shape();
      g.fill();
      g.fillStyle = o.accent ?? '#ff2e88';
      g.beginPath();
      g.roundRect(m * 2.2, m * 2.2, w - m * 4.4, h - m * 4.4, rr * 0.8);
      g.fill();
      g.font = this.font(laid.size);
      g.fillStyle = '#0a0a0c';
      lines(g, w, laid, true, laid.size * 0.03, laid.size * 0.04);
      g.fillStyle = '#ffffff';
      lines(g, w, laid, true);
    },
  },
};

/** The four looks the naming scene previews (Section 3.1). */
export const PREVIEW_STYLES: NameStyle[] = ['chrome_led', 'neon_red', 'pixel_led', 'handpainted'];
