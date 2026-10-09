/*
 * The flyer for a booking (Section 9.3): accepting an offer puts your name on
 * a poster in the venue's own look: a stream card for the Bedroom, a
 * photocopied red-on-black for the Basement, a sunset for the Rooftop, a
 * hazard-striped stencil for the Warehouse, and so on. The name is drawn in
 * the venue's sign style by the NameService, the same as on its walls.
 */
import { nameStyleFor } from '../name/venueStyles';
import { nameService } from '../name/NameService';

export interface FlyerInfo {
  venue: string;
  venueName: string;
  promoter: string;
  dj: string;
  slotLabel: string;
  minutes: number;
  night: number;
  /** 'boat' or 'b2b:<rival>' */
  special: string | null;
  /** the rival's display name, for a B2B */
  rival?: string;
}

interface Theme {
  bg: (g: CanvasRenderingContext2D, w: number, h: number) => void;
  ink: string;
  accent: string;
  font: string;
  /** a dark plate behind the name, for glowing styles on light paper */
  plate?: string;
}

const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';
const MARK = '"Permanent Marker", "Comic Sans MS", cursive';

/** a little speckle, for photocopies and paper */
function grain(g: CanvasRenderingContext2D, w: number, h: number, alpha: number, seed = 7): void {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let i = 0; i < (w * h) / 90; i++) g.fillRect(r() * w, r() * h, 1, 1);
  g.fillStyle = `rgba(0,0,0,${alpha * 1.5})`;
  for (let i = 0; i < (w * h) / 120; i++) g.fillRect(r() * w, r() * h, 1.4, 1.4);
}

const THEMES: Record<string, Theme> = {
  bedroom: {
    ink: '#1f2430',
    accent: '#7a3cff',
    font: MARK,
    bg(g, w, h) {
      // a stream-schedule card: lined paper, a tape strip
      g.fillStyle = '#f4f1e8';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,110,200,0.25)';
      g.lineWidth = 1;
      for (let y = 40; y < h; y += 22) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      g.strokeStyle = 'rgba(220,60,60,0.35)';
      g.beginPath();
      g.moveTo(34, 0);
      g.lineTo(34, h);
      g.stroke();
      g.fillStyle = 'rgba(255,220,120,0.7)';
      g.save();
      g.translate(w / 2, 10);
      g.rotate(-0.04);
      g.fillRect(-50, -10, 100, 24);
      g.restore();
    },
  },
  basement: {
    ink: '#f2e9e4',
    accent: '#ff2a3d',
    font: COND,
    bg(g, w, h) {
      g.fillStyle = '#0b0a0a';
      g.fillRect(0, 0, w, h);
      const r = g.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h * 0.4, h * 0.7);
      r.addColorStop(0, 'rgba(255,40,60,0.28)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
      grain(g, w, h, 0.08, 11);
    },
  },
  rooftop: {
    ink: '#2a1030',
    accent: '#ffe08a',
    font: COND,
    bg(g, w, h) {
      const l = g.createLinearGradient(0, 0, 0, h);
      l.addColorStop(0, '#ff9a5a');
      l.addColorStop(0.55, '#ff5f8a');
      l.addColorStop(1, '#5a2a78');
      g.fillStyle = l;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,236,170,0.85)';
      g.beginPath();
      g.arc(w * 0.7, h * 0.62, w * 0.16, 0, Math.PI * 2);
      g.fill();
      // the skyline
      g.fillStyle = '#2a1030';
      let x = 0;
      let s = 5;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      while (x < w) {
        const bw = 14 + r() * 28;
        const bh = h * (0.08 + r() * 0.16);
        g.fillRect(x, h * 0.78 - bh, bw, bh + h);
        x += bw + 2;
      }
    },
  },
  warehouse: {
    ink: '#111',
    accent: '#ffd200',
    font: COND,
    bg(g, w, h) {
      g.fillStyle = '#9a9a96';
      g.fillRect(0, 0, w, h);
      grain(g, w, h, 0.12, 21);
      // hazard stripes top and bottom
      for (const y0 of [0, h - 26]) {
        g.save();
        g.beginPath();
        g.rect(0, y0, w, 26);
        g.clip();
        g.fillStyle = '#ffd200';
        g.fillRect(0, y0, w, 26);
        g.fillStyle = '#111';
        for (let x = -30; x < w + 30; x += 28) {
          g.beginPath();
          g.moveTo(x, y0 + 26);
          g.lineTo(x + 14, y0 + 26);
          g.lineTo(x + 40, y0);
          g.lineTo(x + 26, y0);
          g.fill();
        }
        g.restore();
      }
    },
    plate: '#111',
  },
  beach: {
    ink: '#14444a',
    accent: '#ff7a4a',
    font: COND,
    bg(g, w, h) {
      const l = g.createLinearGradient(0, 0, 0, h);
      l.addColorStop(0, '#9fe3e0');
      l.addColorStop(0.6, '#f6e2b8');
      l.addColorStop(1, '#e8c890');
      g.fillStyle = l;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(20,68,74,0.25)';
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 6) g.lineTo(x, h * 0.6 + i * 9 + Math.sin(x / 18 + i) * 3);
        g.stroke();
      }
      g.fillStyle = 'rgba(255,122,74,0.85)';
      g.beginPath();
      g.arc(w * 0.22, h * 0.22, w * 0.1, 0, Math.PI * 2);
      g.fill();
    },
  },
  boat: {
    ink: '#eaf2ff',
    accent: '#5ad1ff',
    font: COND,
    bg(g, w, h) {
      const l = g.createLinearGradient(0, 0, 0, h);
      l.addColorStop(0, '#0a1430');
      l.addColorStop(1, '#0e2a4a');
      g.fillStyle = l;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(90,209,255,0.35)';
      g.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        for (let x = 0; x <= w; x += 5) g.lineTo(x, h * 0.72 + i * 10 + Math.sin(x / 14 + i * 1.3) * 2.5);
        g.stroke();
      }
    },
  },
  festival: {
    ink: '#ffffff',
    accent: '#b6ff3b',
    font: COND,
    bg(g, w, h) {
      const l = g.createLinearGradient(0, 0, w, h);
      l.addColorStop(0, '#ff2e88');
      l.addColorStop(0.5, '#7a3cff');
      l.addColorStop(1, '#00b3ff');
      g.fillStyle = l;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let i = 0; i < 12; i++) {
        g.beginPath();
        g.moveTo(w / 2, h * 1.1);
        g.lineTo((i / 12) * w * 1.6 - w * 0.3, -10);
        g.lineTo(((i + 0.5) / 12) * w * 1.6 - w * 0.3, -10);
        g.fill();
      }
    },
  },
  sunrise: {
    ink: '#3a3550',
    accent: '#ff9a5a',
    font: COND,
    bg(g, w, h) {
      const l = g.createLinearGradient(0, 0, 0, h);
      l.addColorStop(0, '#3a4a7a');
      l.addColorStop(0.5, '#f0a8a0');
      l.addColorStop(1, '#ffe6b0');
      g.fillStyle = l;
      g.fillRect(0, 0, w, h);
      const r = g.createRadialGradient(w / 2, h, 4, w / 2, h, h * 0.5);
      r.addColorStop(0, 'rgba(255,240,200,0.95)');
      r.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    },
    plate: 'rgba(30,30,50,0.55)',
  },
};

/** "FRI 9 JAN": the night's date on the career's calendar */
export function nightDate(night: number): string {
  const d = new Date(Date.UTC(2026, 0, 1) + night * 86_400_000);
  const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()];
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${mon}`;
}

/** Draw the flyer onto a canvas (any size; 3:4 looks right). */
export function drawFlyer(c: HTMLCanvasElement, f: FlyerInfo): void {
  const g = c.getContext('2d');
  if (!g) return;
  const w = c.width;
  const h = c.height;
  const t = THEMES[f.venue] ?? THEMES.basement;
  g.save();
  t.bg(g, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  // the promoter presents
  g.fillStyle = t.ink;
  g.font = `600 ${Math.round(w * 0.055)}px ${COND}`;
  fitText(g, `${f.promoter.toUpperCase()} PRESENTS`, w / 2, h * 0.11, w * 0.88);
  // the night
  g.fillStyle = t.accent;
  g.font = `800 ${Math.round(w * 0.13)}px ${t.font}`;
  const title = f.special === 'boat' ? 'BOAT PARTY' : f.special?.startsWith('b2b:') ? 'BACK TO BACK' : f.venueName.toUpperCase();
  fitText(g, title, w / 2, h * 0.25, w * 0.9);
  // the name, in the venue's sign style
  const style = nameStyleFor(f.venue);
  const nameC = document.createElement('canvas');
  nameC.width = Math.round(w * 0.9);
  nameC.height = Math.round(h * 0.26);
  try {
    nameService.draw(nameC, style.sign ?? style.booth, f.dj, { bg: null });
  } catch {
    // no canvas text (a test page): plain letters instead
  }
  const ny = h * 0.33;
  if (t.plate) {
    g.fillStyle = t.plate;
    g.fillRect(w * 0.04, ny - h * 0.01, w * 0.92, nameC.height + h * 0.02);
  }
  g.drawImage(nameC, w * 0.05, ny);
  if (f.rival) {
    g.fillStyle = t.ink;
    g.font = `700 ${Math.round(w * 0.07)}px ${COND}`;
    g.fillText(`B2B ${f.rival}`, w / 2, ny + nameC.height + h * 0.06);
  }
  // when and how long
  g.fillStyle = t.ink;
  g.font = `700 ${Math.round(w * 0.075)}px ${COND}`;
  g.fillText(nightDate(f.night), w / 2, h * 0.78);
  g.font = `500 ${Math.round(w * 0.05)}px ${COND}`;
  g.fillText(`${f.slotLabel.toUpperCase()} · ${f.minutes} MIN SET`, w / 2, h * 0.85);
  if (f.special === 'boat' || f.special?.startsWith('b2b:')) g.fillText(f.venueName.toUpperCase(), w / 2, h * 0.91);
  g.restore();
}

function fitText(g: CanvasRenderingContext2D, s: string, x: number, y: number, max: number): void {
  const m = g.measureText(s).width;
  if (m <= max) g.fillText(s, x, y);
  else {
    g.save();
    g.translate(x, y);
    g.scale(max / m, 1);
    g.fillText(s, 0, 0);
    g.restore();
  }
}
