/*
 * The highlight card: a picture of the set's best moment, made for posting.
 * The stage at the crowd's peak (taken when it happened, or a replay still),
 * with the grade, the venue, the score, the peak and your DJ name over it.
 * Portrait, 1080 × 1350, to save or copy.
 */
import { saveFile } from '../core/download';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface HighlightInfo {
  dj: string;
  grade: string;
  venue: string;
  slot: string;
  score: number;
  /** the crowd's peak, 0..1, and when it came (seconds into the set) */
  peak: number;
  peakAt: number;
  /** the best transition, if there was one ("Long blend") */
  best: string | null;
  date: Date;
}

const GRADE_COL: Record<string, string> = { S: '#ffd23f', A: '#b6ff3b', B: '#3dd6ff', C: '#c48bff', D: '#ff8a8a' };

async function loadImage(blob: Blob | null): Promise<CanvasImageSource | null> {
  if (!blob) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** the card, drawn */
export async function drawHighlight(info: HighlightInfo, shot: Blob | null): Promise<HTMLCanvasElement> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#07080c';
  g.fillRect(0, 0, W, H);
  // the moment: cover the top of the card
  const img = await loadImage(shot);
  if (img) {
    const iw = (img as ImageBitmap).width;
    const ih = (img as ImageBitmap).height;
    const area = { w: W, h: 1000 };
    const k = Math.max(area.w / iw, area.h / ih);
    g.drawImage(img, (W - iw * k) / 2, (area.h - ih * k) / 2, iw * k, ih * k);
  } else {
    const grad = g.createLinearGradient(0, 0, W, 1000);
    grad.addColorStop(0, '#7a3cff');
    grad.addColorStop(1, '#ff2e88');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, 1000);
  }
  // fade into the info panel
  const fade = g.createLinearGradient(0, 640, 0, 1040);
  fade.addColorStop(0, 'rgba(7,8,12,0)');
  fade.addColorStop(1, 'rgba(7,8,12,1)');
  g.fillStyle = fade;
  g.fillRect(0, 640, W, 420);
  g.fillStyle = '#07080c';
  g.fillRect(0, 1040, W, H - 1040);
  // the grade, stamped
  const col = GRADE_COL[info.grade] ?? '#ffffff';
  g.save();
  g.translate(W - 190, 170);
  g.rotate(-0.12);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.roundRect(-120, -120, 240, 240, 36);
  g.fill();
  g.strokeStyle = col;
  g.lineWidth = 10;
  g.stroke();
  g.fillStyle = col;
  g.font = '900 190px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(info.grade, 0, 10);
  g.restore();
  // the words
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffb547';
  g.font = '700 36px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillText(`${info.venue.toUpperCase()} · ${info.slot.toUpperCase()}`, 70, 960);
  g.fillStyle = '#ffffff';
  let size = 120;
  g.font = `900 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  const name = (info.dj || 'DJ').toUpperCase();
  while (g.measureText(name).width > W - 140 && size > 50) {
    size -= 6;
    g.font = `900 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  }
  g.fillText(name, 70, 1080);
  // the numbers
  const stats: [string, string][] = [
    ['SCORE', info.score.toLocaleString('en-GB')],
    ['CROWD PEAK', `${Math.round(info.peak * 100)}%`],
    ['AT', `${Math.floor(info.peakAt / 60)}:${String(Math.floor(info.peakAt % 60)).padStart(2, '0')}`],
  ];
  stats.forEach(([k, v], i) => {
    const x = 70 + i * 320;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = '600 28px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(k, x, 1160);
    g.fillStyle = '#ffffff';
    g.font = '800 64px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(v, x, 1228);
  });
  if (info.best) {
    g.fillStyle = col;
    g.font = '700 32px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(`BEST MOMENT: ${info.best.toUpperCase()}`, 70, 1290);
  }
  // the date and the game's name, small
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.font = '600 24px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'right';
  g.fillText(`${info.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · DECKHOUSE`, W - 60, H - 34);
  return c;
}

/** show the card with Save and Copy */
export async function openHighlight(info: HighlightInfo, shot: Blob | null): Promise<void> {
  const canvas = await drawHighlight(info, shot);
  canvas.classList.add('highlight-card');
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  const file = `deckhouse-${(info.dj || 'set').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${info.grade}.png`;
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Save picture');
  save.addEventListener('click', () => blob && void saveFile(blob, file, 'image/png'));
  const copy = h('button', { type: 'button', class: 'btn' }, 'Copy picture');
  copy.addEventListener('click', async () => {
    try {
      if (!blob || typeof ClipboardItem === 'undefined') throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Picture copied');
    } catch {
      toast('Couldn’t copy here: save the picture instead');
    }
  });
  openModal('Highlight card', h('div', { class: 'highlight-wrap' }, canvas, h('div', { class: 'gs-actions' }, copy, save)), { wide: true });
}
