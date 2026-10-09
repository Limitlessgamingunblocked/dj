/*
 * Fitting the DJ name into a surface (Section 3.6): as big as it will go, on
 * one line if it reads well there, otherwise split at a space onto two lines;
 * never cut a letter off. Pure: the caller passes a text measurer (a canvas in
 * the game, a fake in tests), and gets every letter's box back, which the
 * beat effects use to chase letters on one by one.
 */

/** width of `s` in px at font size 1 */
export type Measure = (s: string) => number;

export interface LetterBox {
  /** 0..1 across the surface, left to right */
  x0: number;
  x1: number;
  /** 0..1 up the surface (texture v), bottom to top */
  y0: number;
  y1: number;
}

export interface Laid {
  lines: string[];
  /** font size in px */
  size: number;
  /** line height in px */
  lineHeight: number;
  /** middle of each line in px from the top */
  ys: number[];
  /** one box per visible (non-space) character, in reading order */
  boxes: LetterBox[];
}

export interface FitOptions {
  /** margin as a fraction of the shorter side */
  pad?: number;
  /** line height as a multiple of the font size */
  lineHeight?: number;
  /** allow a second line */
  wrap?: boolean;
  /** extra space between letters, in ems (wide-tracked styles) */
  tracking?: number;
}

/** width at size 1 including tracking */
function widthOf(measure: Measure, s: string, tracking: number): number {
  return measure(s) + tracking * Math.max(0, [...s].length - 1);
}

export function layoutName(text: string, w: number, h: number, measure: Measure, o: FitOptions = {}): Laid {
  const t = text.trim();
  const lh = o.lineHeight ?? 1.1;
  const tr = o.tracking ?? 0;
  const pad = (o.pad ?? 0.08) * Math.min(w, h);
  const aw = Math.max(1, w - pad * 2);
  const ah = Math.max(1, h - pad * 2);
  if (!t) return { lines: [], size: 0, lineHeight: 0, ys: [], boxes: [] };

  const one = Math.min(ah / lh, aw / Math.max(1e-6, widthOf(measure, t, tr)));
  let lines = [t];
  let size = one;
  // two lines: the split at a space that leaves the longer line shortest
  if (o.wrap !== false && t.includes(' ')) {
    let best: { a: string; b: string; size: number } | null = null;
    for (let i = t.indexOf(' '); i >= 0; i = t.indexOf(' ', i + 1)) {
      const a = t.slice(0, i).trim();
      const b = t.slice(i + 1).trim();
      if (!a || !b) continue;
      const s = Math.min(ah / (lh * 2), aw / Math.max(1e-6, widthOf(measure, a, tr), widthOf(measure, b, tr)));
      if (!best || s > best.size) best = { a, b, size: s };
    }
    // two lines only when they're clearly bigger: one line reads better
    if (best && best.size > one * 1.25) {
      lines = [best.a, best.b];
      size = best.size;
    }
  }
  const lineHeight = size * lh;
  const top = (h - lineHeight * lines.length) / 2;
  const ys = lines.map((_, i) => top + lineHeight * (i + 0.5));
  const boxes: LetterBox[] = [];
  lines.forEach((line, li) => {
    const chars = [...line];
    let x = (w - widthOf(measure, line, tr) * size) / 2;
    chars.forEach((ch, ci) => {
      const cw = measure(ch) * size;
      if (ch !== ' ') {
        const yTop = ys[li] - lineHeight / 2;
        boxes.push({ x0: x / w, x1: (x + cw) / w, y0: 1 - (yTop + lineHeight) / h, y1: 1 - yTop / h });
      }
      x += cw + (ci < chars.length - 1 ? tr * size : 0);
    });
  });
  return { lines, size, lineHeight, ys, boxes };
}
