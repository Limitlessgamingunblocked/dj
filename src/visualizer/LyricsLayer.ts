/*
 * Kinetic typography for the lyrics, drawn on a canvas every frame and
 * composited into the visual player before bloom (so neon glows):
 *   neon     – glowing outlines in the light show's colours
 *   glitch   – RGB split and slice displacement on words, snares and hooks
 *   wave     – the line ripples with the vocal's intensity
 *   tracking – letter-spacing glides in, lines slide through
 *   karaoke  – the whole line waits dimly, each word fills as it's sung
 *   auto     – hooks go neon + glitch, verses track and wave
 * Words pop in on their onset, the size follows the line length, hooks are
 * set bigger in capitals, and everything breathes with the beat.
 */
import * as THREE from 'three';
import type { LyricFrame } from '../lyrics/LyricsEngine';
import type { LyricLine } from '../lyrics/lyrics';
import type { Features } from './AudioFeatures';

export type LyricStyle = 'auto' | 'neon' | 'glitch' | 'wave' | 'tracking' | 'karaoke';
export const LYRIC_STYLES: { id: LyricStyle; name: string }[] = [
  { id: 'auto', name: 'Auto' },
  { id: 'neon', name: 'Neon' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'wave', name: 'Wave' },
  { id: 'tracking', name: 'Tracking' },
  { id: 'karaoke', name: 'Karaoke' },
];

export interface LyricFx {
  on: number;
  wave: number;
  glitch: number;
}

const FONT = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif';
const easeOutBack = (x: number) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);

export class LyricsLayer {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private W = 1024;
  private H = 576;
  private fade = 0;
  private shown: LyricLine | null = null;
  private shownAt = 0;
  private lastPos = 0;
  private blank = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.premultiplyAlpha = true;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  /** Draw this frame's lyrics; returns the shader settings for the composite. */
  draw(frame: LyricFrame | null, f: Features, colors: THREE.Color[], style: LyricStyle, dt: number, t: number): LyricFx {
    const g = this.g;
    const { W, H } = this;
    // the line on screen: current, or the next one just before it starts (pre-roll)
    let line: LyricLine | null = frame?.line ?? null;
    if (!line && frame?.next && frame.next.t - frame.pos < 0.35) line = frame.next;
    const pos = frame?.pos ?? this.lastPos;
    if (frame) this.lastPos = pos;
    if (line !== this.shown && line) {
      this.shown = line;
      this.shownAt = t;
    }
    const target = line ? 1 : 0;
    this.fade += (target - this.fade) * Math.min(1, dt * (target ? 14 : 5));
    if (this.fade < 0.01 && !line) {
      if (!this.blank) {
        g.clearRect(0, 0, W, H);
        this.texture.needsUpdate = true;
        this.blank = true;
      }
      this.shown = null;
      return { on: 0, wave: 0, glitch: 0 };
    }
    const l = this.shown!;
    const hook = l.hook;
    const eff: Exclude<LyricStyle, 'auto'> = style === 'auto' ? (hook ? 'neon' : 'tracking') : style;
    g.clearRect(0, 0, W, H);
    this.blank = false;

    const A = `#${colors[0].getHexString()}`;
    const B = `#${colors[1].getHexString()}`;
    const words = (l.words.length ? l.words : [{ t: l.t, end: l.end, text: l.text }]).map((w) => ({ ...w, text: hook ? w.text.toUpperCase() : w.text }));
    const chars = words.reduce((s, w) => s + w.text.length + 1, 0);
    let size = Math.max(H * 0.075, Math.min(H * 0.2, (H * 0.19) / (1 + Math.max(0, chars - 10) / 16)));
    if (hook) size *= 1.15;
    size *= 1 + f.kickPulse * 0.035 * f.intensity;
    const inLine = pos - l.t;
    const lineLen = Math.max(0.3, l.end - l.t);
    // tracking: letters start wide and glide together
    const spacing = eff === 'tracking' ? size * (0.02 + 0.32 * Math.pow(Math.max(0, 1 - inLine / (lineLen * 0.45)), 2) + f.beatPulse * 0.02) : size * (0.02 + f.beatPulse * 0.015);
    g.font = `900 ${size}px ${FONT}`;
    const ls = (px: number) => {
      if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
    };
    ls(spacing);
    const gap = size * 0.28;
    const widths = words.map((w) => g.measureText(w.text).width);
    // up to three rows, balanced
    const rows: number[][] = [[]];
    const maxW = W * 0.86;
    let rowW = 0;
    words.forEach((_, i) => {
      const add = widths[i] + (rows[rows.length - 1].length ? gap : 0);
      if (rowW + add > maxW && rows[rows.length - 1].length && rows.length < 3) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(i);
      rowW += widths[i] + (rows[rows.length - 1].length > 1 ? gap : 0);
    });
    const lh = size * 1.08;
    const exitAt = l.end + 0.35;
    const exit = Math.max(0, Math.min(1, (pos - exitAt) / 0.45));
    let y0 = H / 2 - ((rows.length - 1) * lh) / 2;
    if (eff === 'tracking') y0 += (1 - Math.min(1, (t - this.shownAt) / 0.35)) * size * 0.6 - exit * size * 0.8;
    const alphaAll = this.fade * (1 - exit);
    g.textBaseline = 'middle';
    g.lineJoin = 'round';

    rows.forEach((row, r) => {
      const total = row.reduce((s, i, k) => s + widths[i] + (k ? gap : 0), 0);
      let x = W / 2 - total / 2;
      const y = y0 + r * lh;
      for (const i of row) {
        const w = words[i];
        const ww = widths[i];
        const cx = x + ww / 2;
        const since = pos - w.t;
        const future = since < 0;
        const active = !future && pos <= w.end + 0.05;
        const pop = future ? 0 : easeOutBack(Math.min(1, since / 0.2));
        const scale = future ? 1 : active ? 0.7 + 0.3 * pop + 0.12 * (1 - Math.min(1, since / 0.15)) : 1;
        let alpha = future ? (eff === 'karaoke' || eff === 'tracking' ? 0.2 : 0) : Math.min(1, since / 0.05);
        if (!future && !active) alpha *= 0.82;
        alpha *= alphaAll;
        if (alpha > 0.005) {
          g.save();
          g.translate(cx, y);
          g.scale(scale, scale);
          g.globalAlpha = alpha;
          const hot = active ? 1 : 0.55;
          if (eff === 'neon') {
            g.shadowColor = A;
            g.shadowBlur = size * (0.22 + 0.2 * hot);
            g.strokeStyle = A;
            g.lineWidth = size * 0.07;
            g.strokeText(w.text, -ww / 2, 0);
            g.shadowBlur = size * 0.08;
            g.strokeStyle = active ? '#ffffff' : B;
            g.lineWidth = size * 0.022;
            g.strokeText(w.text, -ww / 2, 0);
          } else if (eff === 'karaoke') {
            g.fillStyle = 'rgba(255,255,255,0.35)';
            g.fillText(w.text, -ww / 2, 0);
            const p = future ? 0 : active ? Math.min(1, since / Math.max(0.05, w.end - w.t)) : 1;
            if (p > 0) {
              g.save();
              g.beginPath();
              g.rect(-ww / 2 - 4, -size, (ww + 8) * p, size * 2);
              g.clip();
              g.shadowColor = A;
              g.shadowBlur = size * 0.25;
              g.fillStyle = A;
              g.fillText(w.text, -ww / 2, 0);
              g.restore();
            }
          } else {
            const grad = g.createLinearGradient(-ww / 2, -size / 2, ww / 2, size / 2);
            grad.addColorStop(0, active ? '#ffffff' : A);
            grad.addColorStop(1, active ? A : B);
            g.shadowColor = A;
            g.shadowBlur = size * (active ? 0.3 : 0.12);
            g.fillStyle = eff === 'glitch' ? (active ? '#ffffff' : A) : grad;
            g.fillText(w.text, -ww / 2, 0);
          }
          g.restore();
        }
        x += ww + gap;
      }
    });
    ls(0);
    this.texture.needsUpdate = true;
    // shader settings: wave with the vocal, glitch on word onsets and snares
    const onsetNear = words.some((w) => pos - w.t >= 0 && pos - w.t < 0.09);
    const wave = eff === 'wave' || (style === 'auto' && !hook) ? 0.25 + f.vocal * 0.9 : eff === 'tracking' ? 0.12 : 0;
    const glitch = eff === 'glitch' || (style === 'auto' && hook) ? Math.min(1, f.snarePulse * 0.7 + (onsetNear ? 0.7 : 0) + f.drop * 0.3) : 0;
    return { on: alphaAll, wave: wave * f.intensity, glitch: glitch * f.intensity };
  }
}
