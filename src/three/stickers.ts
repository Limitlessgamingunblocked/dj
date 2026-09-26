/*
 * Old stickers and gaffer tape on the hardware, like every well-used booth.
 * Designs are drawn procedurally, then aged: sun fade, yellowing, scratches,
 * grime, worn edges, a torn or peeling corner. Placement is seeded per board
 * and finish, only in free space (never over a control), mostly near edges,
 * on the unit tops (painted into the faceplate) and on the front panels.
 */
import * as THREE from 'three';
import type { BoardBuild, Unit } from './builder';
import { hashString, rng } from './venues/tex';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void;

interface Design {
  id: string;
  /** width / height */
  aspect: number;
  /** typical width in metres */
  size: number;
  shape: 'rect' | 'round' | 'circle' | 'tape';
  draw: Draw;
}

const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
const HAND = '"Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800, font = FONT): void {
  g.font = `${weight} ${size}px ${font}`;
  const m = g.measureText(text).width;
  if (m > maxW) g.font = `${weight} ${Math.floor((size * maxW) / m)}px ${font}`;
}

const DESIGNS: Design[] = [
  {
    id: 'smiley',
    aspect: 1,
    size: 0.034,
    shape: 'circle',
    draw(g, w, h) {
      g.fillStyle = '#ffd400';
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.beginPath();
      g.ellipse(w * 0.36, h * 0.38, w * 0.05, h * 0.09, 0, 0, Math.PI * 2);
      g.ellipse(w * 0.64, h * 0.38, w * 0.05, h * 0.09, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = w * 0.05;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(w / 2, h * 0.5, w * 0.27, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    },
  },
  {
    id: 'vinyl-only',
    aspect: 1,
    size: 0.045,
    shape: 'circle',
    draw(g, w, h) {
      g.fillStyle = '#0c0c0c';
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let r = w * 0.2; r < w * 0.48; r += 3) {
        g.beginPath();
        g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#ff6b1a';
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.19, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'VINYL', w * 0.3, w * 0.1);
      g.fillText('VINYL', w / 2, h * 0.46);
      fitText(g, 'ONLY', w * 0.3, w * 0.1);
      g.fillText('ONLY', w / 2, h * 0.56);
    },
  },
  {
    id: 'no-sync',
    aspect: 1,
    size: 0.036,
    shape: 'circle',
    draw(g, w, h) {
      g.fillStyle = '#f4f1ea';
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'SYNC', w * 0.62, w * 0.26, 900);
      g.fillText('SYNC', w / 2, h / 2);
      g.strokeStyle = '#e2231a';
      g.lineWidth = w * 0.09;
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
      g.moveTo(w * 0.2, h * 0.2);
      g.lineTo(w * 0.8, h * 0.8);
      g.stroke();
    },
  },
  {
    id: 'acid',
    aspect: 1.7,
    size: 0.05,
    shape: 'round',
    draw(g, w, h) {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#d9dde3');
      grad.addColorStop(0.5, '#9aa1ab');
      grad.addColorStop(1, '#e6e9ee');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, '303', w * 0.8, h * 0.62, 900);
      g.fillText('303', w / 2, h * 0.44);
      fitText(g, 'ACID BASS LINE', w * 0.8, h * 0.16, 700);
      g.fillText('ACID BASS LINE', w / 2, h * 0.82);
    },
  },
  {
    id: '909',
    aspect: 1.6,
    size: 0.048,
    shape: 'rect',
    draw(g, w, h) {
      g.fillStyle = '#ff7a1a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#141414';
      g.fillRect(0, h * 0.7, w, h * 0.3);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      fitText(g, '909', w * 0.8, h * 0.56, 900);
      g.fillText('909', w * 0.08, h * 0.36);
      g.fillStyle = '#ff7a1a';
      for (let i = 0; i < 8; i++) g.fillRect(w * (0.08 + i * 0.11), h * 0.8, w * 0.07, h * 0.1);
    },
  },
  {
    id: 'plur',
    aspect: 2,
    size: 0.05,
    shape: 'round',
    draw(g, w, h) {
      g.fillStyle = '#111';
      g.fillRect(0, 0, w, h);
      const grad = g.createLinearGradient(0, 0, w, 0);
      ['#ff3b3b', '#ffb000', '#ffe600', '#3ddc5c', '#2ec4f1', '#9b5cff'].forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
      g.fillStyle = grad;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'PLUR', w * 0.86, h * 0.8, 900);
      g.fillText('PLUR', w / 2, h * 0.54);
    },
  },
  {
    id: 'house',
    aspect: 2.6,
    size: 0.062,
    shape: 'rect',
    draw(g, w, h) {
      g.fillStyle = '#f1e7d0';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#1a1a1a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'HOUSE MUSIC', w * 0.86, h * 0.4, 900);
      g.fillText('HOUSE MUSIC', w / 2, h * 0.36);
      fitText(g, 'ALL LIFE LONG', w * 0.7, h * 0.26, 700);
      g.fillText('ALL LIFE LONG', w / 2, h * 0.72);
    },
  },
  {
    id: 'ibiza',
    aspect: 1,
    size: 0.042,
    shape: 'circle',
    draw(g, w, h) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#ff3d7f');
      grad.addColorStop(0.6, '#ff9a3d');
      grad.addColorStop(1, '#ffd36b');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff3c4';
      g.beginPath();
      g.arc(w / 2, h * 0.62, w * 0.2, Math.PI, 0);
      g.fill();
      g.fillStyle = '#2a0f1f';
      g.fillRect(0, h * 0.62, w, h * 0.4);
      g.strokeStyle = '#2a0f1f';
      g.lineWidth = w * 0.025;
      g.beginPath();
      g.moveTo(w * 0.7, h * 0.62);
      g.quadraticCurveTo(w * 0.74, h * 0.4, w * 0.68, h * 0.28);
      g.stroke();
      for (const a of [-1.2, -0.6, 0, 0.6, 1.2]) {
        g.beginPath();
        g.ellipse(w * 0.68 + Math.cos(a - 1.57) * w * 0.07, h * 0.28 + Math.sin(a - 1.57) * h * 0.02, w * 0.09, h * 0.022, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'IBIZA', w * 0.5, h * 0.16, 900);
      g.fillText('IBIZA', w / 2, h * 0.8);
    },
  },
  {
    id: 'berlin',
    aspect: 2.4,
    size: 0.055,
    shape: 'rect',
    draw(g, w, h) {
      g.fillStyle = '#0d0d0d';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f2f2f2';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'BERLIN TECHNO', w * 0.9, h * 0.5, 900);
      g.fillText('BERLIN TECHNO', w / 2, h * 0.44);
      g.fillRect(w * 0.1, h * 0.76, w * 0.8, h * 0.05);
    },
  },
  {
    id: 'caution',
    aspect: 2.8,
    size: 0.06,
    shape: 'rect',
    draw(g, w, h) {
      g.fillStyle = '#ffd400';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111';
      for (let x = -h; x < w + h; x += h * 0.5) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + h * 0.25, 0);
        g.lineTo(x + h * 0.25 - h * 0.22, h * 0.22);
        g.lineTo(x - h * 0.22, h * 0.22);
        g.fill();
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + h * 0.25, h);
        g.lineTo(x + h * 0.25 + h * 0.22, h * 0.78);
        g.lineTo(x + h * 0.22, h * 0.78);
        g.fill();
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'CAUTION: LOUD', w * 0.86, h * 0.36, 900);
      g.fillText('CAUTION: LOUD', w / 2, h / 2);
    },
  },
  {
    id: 'label',
    aspect: 1,
    size: 0.04,
    shape: 'circle',
    draw(g, w, h, r) {
      const hue = Math.floor(r() * 360);
      g.fillStyle = `hsl(${hue}, 55%, 42%)`;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = w * 0.02;
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#0a0a0a';
      g.beginPath();
      g.arc(w / 2, h / 2, w * 0.05, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const names = ['NIGHT SHIFT', 'DEEP CUTS', 'LOW TIDE', 'BASEMENT', 'SUNDAY SERVICE', 'WAREHOUSE 91'];
      const n = names[Math.floor(r() * names.length)];
      fitText(g, n, w * 0.7, w * 0.12, 900);
      g.fillText(n, w / 2, h * 0.28);
      fitText(g, 'RECORDS', w * 0.5, w * 0.08, 700);
      g.fillText('RECORDS', w / 2, h * 0.73);
    },
  },
  {
    id: 'afterhours',
    aspect: 2.3,
    size: 0.052,
    shape: 'round',
    draw(g, w, h) {
      g.fillStyle = '#21082e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff4fd8';
      g.shadowColor = '#ff4fd8';
      g.shadowBlur = h * 0.15;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'afterhours', w * 0.86, h * 0.6, 700, '"Brush Script MT", "Segoe Script", cursive');
      g.fillText('afterhours', w / 2, h * 0.52);
      g.shadowBlur = 0;
    },
  },
  {
    id: 'volt',
    aspect: 1.1,
    size: 0.034,
    shape: 'rect',
    draw(g, w, h) {
      g.fillStyle = '#ffd400';
      g.beginPath();
      g.moveTo(w / 2, h * 0.04);
      g.lineTo(w * 0.97, h * 0.93);
      g.lineTo(w * 0.03, h * 0.93);
      g.closePath();
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = w * 0.05;
      g.stroke();
      g.fillStyle = '#111';
      g.beginPath();
      g.moveTo(w * 0.54, h * 0.3);
      g.lineTo(w * 0.4, h * 0.6);
      g.lineTo(w * 0.52, h * 0.6);
      g.lineTo(w * 0.44, h * 0.84);
      g.lineTo(w * 0.62, h * 0.52);
      g.lineTo(w * 0.5, h * 0.52);
      g.closePath();
      g.fill();
    },
  },
  {
    id: 'rave',
    aspect: 1.9,
    size: 0.046,
    shape: 'rect',
    draw(g, w, h) {
      const s = h / 4;
      for (let y = 0; y < 4; y++) for (let x = 0; x < Math.ceil(w / s); x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * s, y * s, s, s);
      }
      g.fillStyle = '#e2231a';
      g.fillRect(w * 0.12, h * 0.25, w * 0.76, h * 0.5);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'RAVE', w * 0.6, h * 0.42, 900);
      g.fillText('RAVE', w / 2, h / 2 + 1);
    },
  },
  {
    id: 'ears',
    aspect: 2.2,
    size: 0.05,
    shape: 'round',
    draw(g, w, h) {
      g.fillStyle = '#1f6fd1';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'PROTECT', w * 0.8, h * 0.34, 900);
      g.fillText('PROTECT', w / 2, h * 0.33);
      fitText(g, 'YOUR EARS', w * 0.8, h * 0.34, 900);
      g.fillText('YOUR EARS', w / 2, h * 0.7);
    },
  },
  {
    id: 'star',
    aspect: 1,
    size: 0.036,
    shape: 'circle',
    draw(g, w, h) {
      g.fillStyle = '#e2231a';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 ? w * 0.22 : w * 0.5;
        g.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'ALL NIGHT', w * 0.42, w * 0.1, 900);
      g.fillText('ALL NIGHT', w / 2, h * 0.5);
    },
  },
  {
    id: 'love',
    aspect: 1.1,
    size: 0.03,
    shape: 'rect',
    draw(g, w, h) {
      g.fillStyle = '#ff4f8b';
      g.beginPath();
      g.moveTo(w / 2, h * 0.92);
      g.bezierCurveTo(w * -0.1, h * 0.5, w * 0.12, h * -0.05, w / 2, h * 0.28);
      g.bezierCurveTo(w * 0.88, h * -0.05, w * 1.1, h * 0.5, w / 2, h * 0.92);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, 'LOVE', w * 0.5, h * 0.2, 900);
      g.fillText('LOVE', w / 2, h * 0.47);
    },
  },
  {
    id: 'tape',
    aspect: 4.2,
    size: 0.07,
    shape: 'tape',
    draw(g, w, h, r) {
      const notes = ['CH1 = VINYL', 'DECK 3 GLITCHY', "DON'T TOUCH!!", 'NO DRINKS', 'RESIDENT ONLY', 'USB → HERE', 'GAIN STAYS AT 12', 'LOOK UP ↑', 'B2B ??', 'CUE = SPLIT'];
      g.fillStyle = r() < 0.6 ? '#d7d4cc' : '#3b3d42';
      const dark = g.fillStyle === '#3b3d42';
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.18;
      for (let x = 0; x < w; x += 3) {
        g.fillStyle = r() < 0.5 ? '#fff' : '#000';
        g.fillRect(x, 0, 1, h);
      }
      g.globalAlpha = 1;
      g.fillStyle = dark ? '#f2f2f2' : '#1a1a1a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const n = notes[Math.floor(r() * notes.length)];
      fitText(g, n, w * 0.86, h * 0.62, 700, HAND);
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate((r() - 0.5) * 0.08);
      g.fillText(n, 0, 0);
      g.restore();
    },
  },
];

const BASE_PX = 256;
const cache = new Map<string, HTMLCanvasElement>();

/** A finished, aged sticker canvas. */
function stickerCanvas(d: Design, seed: number): HTMLCanvasElement {
  const key = `${d.id}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rng(seed);
  const w = d.aspect >= 1 ? BASE_PX : Math.round(BASE_PX * d.aspect);
  const h = d.aspect >= 1 ? Math.round(BASE_PX / d.aspect) : BASE_PX;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  // cut the shape, with a thin white vinyl border
  g.save();
  g.beginPath();
  if (d.shape === 'circle') g.arc(w / 2, h / 2, Math.min(w, h) / 2 - 1, 0, Math.PI * 2);
  else if (d.shape === 'round') g.roundRect(1, 1, w - 2, h - 2, Math.min(w, h) * 0.18);
  else if (d.shape === 'tape') {
    // torn ends
    g.moveTo(0, 0);
    for (let y = 0; y <= h; y += 6) g.lineTo(r() * 7, y);
    g.lineTo(w - r() * 7, h);
    for (let y = h; y >= 0; y -= 6) g.lineTo(w - r() * 7, y);
    g.closePath();
  } else g.rect(1, 1, w - 2, h - 2);
  g.clip();
  if (d.shape !== 'tape') {
    g.fillStyle = '#f7f5ef';
    g.fillRect(0, 0, w, h);
    const inset = Math.min(w, h) * 0.05;
    g.save();
    g.translate(inset, inset);
    g.scale((w - inset * 2) / w, (h - inset * 2) / h);
    d.draw(g, w, h, r);
    g.restore();
  } else d.draw(g, w, h, r);

  // ageing: sun fade and yellowing, booth grime, scratches, worn edges
  const age = 0.35 + r() * 0.65;
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(196, 184, 156, ${0.12 + age * 0.22})`;
  g.fillRect(0, 0, w, h);
  // (still clipped to the sticker's shape, so multiply only darkens the sticker)
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgb(${Math.round(200 - age * 30)}, ${Math.round(194 - age * 34)}, ${Math.round(182 - age * 40)})`;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 180 * age; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '40,30,20' : '255,255,255'},${0.08 + r() * 0.2})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * w, r() * h, s, s);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 14 * age; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.35})`;
    g.lineWidth = 0.6 + r() * 1.4;
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI;
    const l = 10 + r() * 60;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // rubbed-off edges
  g.strokeStyle = `rgba(255,255,255,${0.25 + age * 0.35})`;
  g.lineWidth = 4 + age * 5;
  g.setLineDash([2 + r() * 6, 3 + r() * 10]);
  g.beginPath();
  if (d.shape === 'circle') g.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
  else g.rect(2, 2, w - 4, h - 4);
  g.stroke();
  g.setLineDash([]);
  g.restore();
  g.globalCompositeOperation = 'source-over';

  // a torn-off or peeling corner
  if (d.shape !== 'tape' && d.shape !== 'circle' && r() < 0.55) {
    const cx = r() < 0.5 ? 0 : w;
    const cy = r() < 0.5 ? 0 : h;
    const s = Math.min(w, h) * (0.18 + r() * 0.2);
    const sx = cx ? -1 : 1;
    const sy = cy ? -1 : 1;
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + sx * s, cy);
    for (let t = 0; t <= 1; t += 0.2) g.lineTo(cx + sx * s * (1 - t) + (r() - 0.5) * 5, cy + sy * s * t + (r() - 0.5) * 5);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'source-over';
    if (r() < 0.6) {
      // the corner still hangs on, curled back showing the paper
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.moveTo(cx + sx * s, cy);
      g.lineTo(cx, cy + sy * s);
      g.lineTo(cx + sx * s * 0.62, cy + sy * s * 0.62);
      g.closePath();
      g.fill();
      g.fillStyle = '#e9e4d8';
      g.beginPath();
      g.moveTo(cx + sx * s, cy);
      g.lineTo(cx, cy + sy * s);
      g.lineTo(cx + sx * s * 0.5, cy + sy * s * 0.5);
      g.closePath();
      g.fill();
    }
  }
  cache.set(key, c);
  return c;
}

interface Spot {
  x: number;
  z: number;
  w: number;
  h: number;
  rot: number;
}

/** footprints of the unit's parts in unit-local XZ (with a margin to keep labels readable) */
function footprints(b: BoardBuild, u: Unit): THREE.Box2[] {
  const out: THREE.Box2[] = [];
  const box = new THREE.Box3();
  for (const p of b.parts) {
    if (p.object.parent !== u.group) continue;
    box.setFromObject(p.object);
    const m = 0.0045;
    out.push(new THREE.Box2(new THREE.Vector2(box.min.x - u.group.position.x - m, box.min.z - u.group.position.z - m), new THREE.Vector2(box.max.x - u.group.position.x + m, box.max.z - u.group.position.z + m)));
  }
  return out;
}

function rotatedBox(s: Spot): THREE.Box2 {
  const c = Math.abs(Math.cos(s.rot));
  const n = Math.abs(Math.sin(s.rot));
  const hw = (s.w * c + s.h * n) / 2;
  const hh = (s.w * n + s.h * c) / 2;
  return new THREE.Box2(new THREE.Vector2(s.x - hw, s.z - hh), new THREE.Vector2(s.x + hw, s.z + hh));
}

/** Put stickers on every unit of a board (call after the layout, before finishAll). */
export function applyStickers(b: BoardBuild, seedKey: string): void {
  b.root.updateMatrixWorld(true);
  const r = rng(hashString(seedKey));
  const used = new Set<string>();
  const pick = (tape: boolean): Design => {
    let pool = DESIGNS.filter((d) => (tape ? d.shape === 'tape' : d.shape !== 'tape') && (tape || !used.has(d.id)));
    if (!pool.length) {
      used.clear();
      pool = DESIGNS.filter((d) => d.shape !== 'tape');
    }
    const d = pool[Math.floor(r() * pool.length)];
    used.add(d.id);
    return d;
  };
  b.units.forEach((u) => {
    const blocked = footprints(b, u);
    const placed: THREE.Box2[] = [];
    const area = u.w * u.d;
    const want = Math.min(4, 1 + Math.floor(area / 0.045) + (r() < 0.5 ? 1 : 0));
    for (let k = 0; k < want; k++) {
      const tape = k === want - 1 && r() < 0.45;
      const d = pick(tape);
      const sw = d.size * (0.85 + r() * 0.3);
      const sh = sw / d.aspect;
      let best: { s: Spot; score: number } | null = null;
      for (let t = 0; t < 260; t++) {
        const s: Spot = { x: (r() - 0.5) * (u.w - 0.02), z: (r() - 0.5) * (u.d - 0.02), w: sw, h: sh, rot: tape ? (r() - 0.5) * 0.25 : (r() - 0.5) * 0.7 };
        const bb = rotatedBox(s);
        if (bb.min.x < -u.w / 2 + 0.007 || bb.max.x > u.w / 2 - 0.007 || bb.min.y < -u.d / 2 + 0.007 || bb.max.y > u.d / 2 - 0.007) continue;
        if (blocked.some((f) => f.intersectsBox(bb)) || placed.some((f) => f.intersectsBox(bb))) continue;
        const edge = Math.min(bb.min.x + u.w / 2, u.w / 2 - bb.max.x, bb.min.y + u.d / 2, u.d / 2 - bb.max.y);
        const score = -edge + r() * 0.01;
        if (!best || score > best.score) best = { s, score };
      }
      if (!best) continue;
      const s = best.s;
      placed.push(rotatedBox(s));
      const canvas = stickerCanvas(d, Math.floor(r() * 1e6));
      u.face.draw((g) => {
        const [px, py] = u.face.px(s.x, s.z);
        g.save();
        g.translate(px, py);
        g.rotate(s.rot);
        g.shadowColor = 'rgba(0,0,0,0.35)';
        g.shadowBlur = u.face.m(0.0008);
        g.drawImage(canvas, -u.face.m(s.w) / 2, -u.face.m(s.h) / 2, u.face.m(s.w), u.face.m(s.h));
        g.restore();
      });
    }
    // a sticker or two on the front panel facing the DJ
    if (u.h >= 0.045 && r() < 0.65) {
      const n = u.w > 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const d = pick(r() < 0.3);
        const sh = Math.min(u.h * 0.62, d.size / d.aspect);
        const sw = sh * d.aspect;
        if (sw > u.w * 0.4) continue;
        const x = (k === 0 ? -1 : 1) * (u.w * (0.12 + r() * 0.22));
        const tex = new THREE.CanvasTexture(stickerCanvas(d, Math.floor(r() * 1e6)));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.25, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
        m.position.set(x, u.h * (0.42 + (r() - 0.5) * 0.15), u.d / 2 + 0.0008);
        m.rotation.z = (r() - 0.5) * 0.3;
        u.group.add(m);
      }
    }
  });
}
