/*
 * Faceplate: the printed top panel of a hardware unit, drawn on a canvas in
 * board coordinates (metres, x → right, z → towards the DJ) and applied as
 * the unit's top texture. Holds section outlines, labels, fader scales and
 * knob scale rings like the silk-screen on real gear.
 */
import * as THREE from 'three';

export interface FaceStyle {
  base: string; // panel colour
  print: string; // main print colour
  accent: string; // section accent
  sub: string; // secondary print
  texture: 'matte' | 'brushed' | 'gloss';
}

export class Faceplate {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly ppm: number; // pixels per metre
  private ops: ((g: CanvasRenderingContext2D) => void)[] = [];

  constructor(
    readonly w: number,
    readonly d: number,
    readonly style: FaceStyle,
    ppm = 4200,
  ) {
    const maxPx = 4096;
    this.ppm = Math.min(ppm, maxPx / Math.max(w, d));
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * this.ppm);
    this.canvas.height = Math.round(d * this.ppm);
    this.g = this.canvas.getContext('2d')!;
  }

  px(x: number, z: number): [number, number] {
    return [(x + this.w / 2) * this.ppm, (z + this.d / 2) * this.ppm];
  }

  m(v: number): number {
    return v * this.ppm;
  }

  /** Queue drawing (executed on top of the background in render()). */
  draw(fn: (g: CanvasRenderingContext2D) => void): void {
    this.ops.push(fn);
  }

  text(
    x: number,
    z: number,
    str: string,
    o: { size?: number; color?: string; align?: CanvasTextAlign; weight?: number; font?: 'label' | 'mono'; spacing?: number; baseline?: CanvasTextBaseline } = {},
  ): void {
    this.draw((g) => {
      const [px, py] = this.px(x, z);
      const size = this.m(o.size ?? 0.0032);
      g.fillStyle = o.color ?? this.style.print;
      g.font = `${o.weight ?? 700} ${size}px ${o.font === 'mono' ? '"JetBrains Mono", monospace' : '"Barlow Condensed", "Arial Narrow", sans-serif'}`;
      g.textAlign = o.align ?? 'center';
      g.textBaseline = o.baseline ?? 'middle';
      if (o.spacing && 'letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${size * o.spacing}px`;
      g.fillText(str, px, py);
      if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '0px';
    });
  }

  rect(x: number, z: number, w: number, d: number, o: { stroke?: string; fill?: string; radius?: number; line?: number } = {}): void {
    this.draw((g) => {
      const [px, py] = this.px(x - w / 2, z - d / 2);
      const r = this.m(o.radius ?? 0.003);
      g.beginPath();
      g.roundRect(px, py, this.m(w), this.m(d), r);
      if (o.fill) {
        g.fillStyle = o.fill;
        g.fill();
      }
      if (o.stroke) {
        g.strokeStyle = o.stroke;
        g.lineWidth = this.m(o.line ?? 0.0004);
        g.stroke();
      }
    });
  }

  line(x0: number, z0: number, x1: number, z1: number, color?: string, width = 0.0004): void {
    this.draw((g) => {
      const [a, b] = this.px(x0, z0);
      const [c, d] = this.px(x1, z1);
      g.strokeStyle = color ?? this.style.sub;
      g.lineWidth = this.m(width);
      g.beginPath();
      g.moveTo(a, b);
      g.lineTo(c, d);
      g.stroke();
    });
  }

  /** Fader slot with a printed scale. axis 'z' = vertical fader, 'x' = horizontal. */
  slot(x: number, z: number, len: number, axis: 'x' | 'z', o: { ticks?: number; center?: boolean; labels?: [string, string]; width?: number } = {}): void {
    this.draw((g) => {
      const w = o.width ?? 0.0035;
      const [px, py] = this.px(axis === 'x' ? x - len / 2 : x - w / 2, axis === 'x' ? z - w / 2 : z - len / 2);
      g.fillStyle = '#020203';
      g.beginPath();
      g.roundRect(px, py, this.m(axis === 'x' ? len : w), this.m(axis === 'x' ? w : len), this.m(w / 2));
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = this.m(0.0003);
      g.stroke();
      const ticks = o.ticks ?? 10;
      g.strokeStyle = this.style.sub;
      g.lineWidth = this.m(0.0003);
      for (let i = 0; i <= ticks; i++) {
        const t = i / ticks;
        const major = i === 0 || i === ticks || (o.center && i === ticks / 2);
        const tl = this.m(major ? 0.004 : 0.0025);
        if (axis === 'z') {
          const [tx, ty] = this.px(x, z - len / 2 + t * len);
          g.beginPath();
          g.moveTo(tx - this.m(0.004), ty);
          g.lineTo(tx - this.m(0.004) - tl, ty);
          g.moveTo(tx + this.m(0.004), ty);
          g.lineTo(tx + this.m(0.004) + tl, ty);
          g.stroke();
        } else {
          const [tx, ty] = this.px(x - len / 2 + t * len, z);
          g.beginPath();
          g.moveTo(tx, ty - this.m(0.004));
          g.lineTo(tx, ty - this.m(0.004) - tl);
          g.stroke();
        }
      }
    });
    if (o.labels) {
      if (axis === 'z') {
        this.text(x, z - len / 2 - 0.005, o.labels[0], { size: 0.0026, color: this.style.sub });
        this.text(x, z + len / 2 + 0.005, o.labels[1], { size: 0.0026, color: this.style.sub });
      } else {
        this.text(x - len / 2 - 0.006, z, o.labels[0], { size: 0.0028, color: this.style.sub });
        this.text(x + len / 2 + 0.006, z, o.labels[1], { size: 0.0028, color: this.style.sub });
      }
    }
  }

  /** Scale ring printed around a knob (−150°..+150°). */
  knobScale(x: number, z: number, r: number, o: { center?: boolean; ticks?: number } = {}): void {
    this.draw((g) => {
      const [cx, cy] = this.px(x, z);
      const ticks = o.ticks ?? 11;
      g.strokeStyle = this.style.sub;
      g.lineWidth = this.m(0.00035);
      for (let i = 0; i < ticks; i++) {
        const t = i / (ticks - 1);
        const a = ((-150 + t * 300 - 90) * Math.PI) / 180;
        const major = i === 0 || i === ticks - 1 || (o.center && i === (ticks - 1) / 2);
        const r0 = this.m(r + 0.0012);
        const r1 = this.m(r + (major ? 0.0035 : 0.0022));
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }
    });
  }

  circle(x: number, z: number, r: number, o: { stroke?: string; fill?: string; line?: number } = {}): void {
    this.draw((g) => {
      const [cx, cy] = this.px(x, z);
      g.beginPath();
      g.arc(cx, cy, this.m(r), 0, Math.PI * 2);
      if (o.fill) {
        g.fillStyle = o.fill;
        g.fill();
      }
      if (o.stroke) {
        g.strokeStyle = o.stroke;
        g.lineWidth = this.m(o.line ?? 0.0005);
        g.stroke();
      }
    });
  }

  /** Section frame with a title tab, like the printed zones on a mixer. */
  section(x: number, z: number, w: number, d: number, title?: string): void {
    this.rect(x, z, w, d, { stroke: this.style.sub, radius: 0.004, line: 0.00035 });
    if (title) {
      this.draw((g) => {
        const [px, py] = this.px(x - w / 2 + 0.006, z - d / 2);
        const size = this.m(0.0028);
        g.font = `700 ${size}px "Barlow Condensed", sans-serif`;
        const tw = g.measureText(title).width + this.m(0.003);
        g.fillStyle = this.style.base;
        g.fillRect(px - this.m(0.0012), py - size * 0.6, tw, size * 1.2);
        g.fillStyle = this.style.accent;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(title, px, py);
      });
    }
  }

  render(): THREE.CanvasTexture {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = this.style.base;
    g.fillRect(0, 0, W, H);
    if (this.style.texture === 'brushed') {
      g.globalAlpha = 0.07;
      for (let y = 0; y < H; y += 2) {
        const v = Math.random() * 255;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(0, y, W, 1);
      }
      g.globalAlpha = 1;
    } else if (this.style.texture === 'matte') {
      g.globalAlpha = 0.05;
      for (let i = 0; i < (W * H) / 200; i++) {
        const v = Math.random() * 255;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
      }
      g.globalAlpha = 1;
    }
    for (const op of this.ops) op(g);
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
}
