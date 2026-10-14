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

/** print is drawn a little bigger and bolder than the real silk-screen: on screen it's read from much further away */
const LEGIBLE = 1.4;
/** line weights (ticks, outlines, scales) likewise */
const LINE = 1.5;

function mixHex(a: string, b: string, k: number): string {
  const pa = new THREE.Color(a);
  const pb = new THREE.Color(b);
  return `#${pa.lerp(pb, k).getHexString()}`;
}

export class Faceplate {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly ppm: number; // pixels per metre
  private ops: ((g: CanvasRenderingContext2D) => void)[] = [];
  /** where hands work the panel: fader slots and the surrounds of jogs and platters */
  private worn: ({ kind: 'slot'; x: number; z: number; len: number; axis: 'x' | 'z' } | { kind: 'ring'; x: number; z: number; r: number })[] = [];

  readonly style: FaceStyle;

  constructor(
    readonly w: number,
    readonly d: number,
    style: FaceStyle,
    ppm = 4200,
  ) {
    // secondary print (scales, outlines, small labels) pulled towards the main print so it reads
    this.style = { ...style, sub: mixHex(style.sub, style.print, 0.38) };
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
      const size = this.m((o.size ?? 0.0032) * LEGIBLE);
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
        g.lineWidth = this.m((o.line ?? 0.0004) * LINE);
        g.stroke();
      }
    });
  }

  line(x0: number, z0: number, x1: number, z1: number, color?: string, width = 0.0004): void {
    this.draw((g) => {
      const [a, b] = this.px(x0, z0);
      const [c, d] = this.px(x1, z1);
      g.strokeStyle = color ?? this.style.sub;
      g.lineWidth = this.m(width * LINE);
      g.beginPath();
      g.moveTo(a, b);
      g.lineTo(c, d);
      g.stroke();
    });
  }

  /** Fader slot with a printed scale. axis 'z' = vertical fader, 'x' = horizontal. */
  slot(x: number, z: number, len: number, axis: 'x' | 'z', o: { ticks?: number; center?: boolean; labels?: [string, string]; width?: number } = {}): void {
    this.worn.push({ kind: 'slot', x, z, len, axis });
    this.draw((g) => {
      const w = o.width ?? 0.0035;
      const [px, py] = this.px(axis === 'x' ? x - len / 2 : x - w / 2, axis === 'x' ? z - w / 2 : z - len / 2);
      g.fillStyle = '#020203';
      g.beginPath();
      g.roundRect(px, py, this.m(axis === 'x' ? len : w), this.m(axis === 'x' ? w : len), this.m(w / 2));
      g.fill();
      // a lit rim so the slot reads on a dark panel
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = this.m(0.00045);
      g.stroke();
      const ticks = o.ticks ?? 10;
      g.strokeStyle = this.style.sub;
      g.lineWidth = this.m(0.0003 * LINE);
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
      g.lineWidth = this.m(0.00035 * LINE);
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
    if (r > 0.05) this.worn.push({ kind: 'ring', x, z, r });
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
        g.lineWidth = this.m((o.line ?? 0.0005) * LINE);
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
        const size = this.m(0.0028 * LEGIBLE);
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

  /** a seeded random source for the wear, from the panel's size (the same scuffs on every build) */
  private wearRng(): () => number {
    let a = (Math.round(this.w * 1e4) * 7919 + Math.round(this.d * 1e4)) & 0x7fffffff || 1;
    return () => {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      return a / 0x7fffffff;
    };
  }

  /**
   * Light use, not dirt: a few faint hairline scuffs beside each fader slot,
   * where the cap's edge and fingertips rub, and round the jogs and platters.
   */
  private scuffs(g: CanvasRenderingContext2D): void {
    const r = this.wearRng();
    const c = new THREE.Color(this.style.base);
    const lit = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.45;
    const ink = (a: number) => (lit ? `rgba(30,30,32,${a})` : `rgba(210,214,222,${a})`);
    g.lineCap = 'round';
    g.lineWidth = Math.max(1, this.m(0.00018));
    for (const w of this.worn) {
      if (w.kind === 'slot') {
        for (let i = 0; i < 9; i++) {
          const along = (r() - 0.5) * w.len * 1.05;
          const off = (r() < 0.5 ? -1 : 1) * (0.0028 + r() * 0.0065);
          const len = 0.002 + r() * 0.007;
          const tilt = (r() - 0.5) * 0.002;
          const [x0, z0] = w.axis === 'z' ? [w.x + off, w.z + along] : [w.x + along, w.z + off];
          const [x1, z1] = w.axis === 'z' ? [x0 + tilt, z0 + len] : [x0 + len, z0 + tilt];
          g.strokeStyle = ink(0.05 + r() * 0.07);
          g.beginPath();
          g.moveTo(...this.px(x0, z0));
          g.lineTo(...this.px(x1, z1));
          g.stroke();
        }
      } else {
        const [cx, cy] = this.px(w.x, w.z);
        for (let i = 0; i < 10; i++) {
          // mostly on the near side, where the hand comes in
          const a = Math.PI * (0.05 + r() * 0.9);
          const rr = this.m(w.r + 0.002 + r() * 0.01);
          g.strokeStyle = ink(0.04 + r() * 0.05);
          g.beginPath();
          g.arc(cx, cy, rr, a, a + 0.05 + r() * 0.12);
          g.stroke();
        }
      }
    }
  }

  /**
   * Roughness for the faceplate (multiplies the panel's own): polished bands
   * along the fader slots and round the jogs, and a palm-worn strip along the
   * front edge. Drawn at a quarter of the print's resolution: wear is soft.
   */
  wearMap(): THREE.CanvasTexture {
    const k = 0.25;
    const c = document.createElement('canvas');
    c.width = Math.max(4, Math.round(this.canvas.width * k));
    c.height = Math.max(4, Math.round(this.canvas.height * k));
    const g = c.getContext('2d')!;
    const px = (x: number, z: number): [number, number] => [(x + this.w / 2) * this.ppm * k, (z + this.d / 2) * this.ppm * k];
    const m = (v: number) => v * this.ppm * k;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    // the front edge, where wrists rest
    const front = g.createLinearGradient(0, c.height, 0, c.height - m(0.035));
    front.addColorStop(0, 'rgba(150,150,150,0.8)');
    front.addColorStop(1, 'rgba(150,150,150,0)');
    g.fillStyle = front;
    g.fillRect(0, c.height - m(0.035), c.width, m(0.035));
    g.filter = `blur(${Math.max(1, m(0.0025))}px)`;
    for (const w of this.worn) {
      if (w.kind === 'slot') {
        const [x, y] = px(w.x, w.z);
        const [lw, lh] = w.axis === 'z' ? [m(0.02), m(w.len * 1.08)] : [m(w.len * 1.08), m(0.02)];
        g.fillStyle = 'rgba(120,120,120,0.75)';
        g.beginPath();
        g.roundRect(x - lw / 2, y - lh / 2, lw, lh, Math.min(lw, lh) / 2);
        g.fill();
      } else {
        const [x, y] = px(w.x, w.z);
        g.strokeStyle = 'rgba(150,150,150,0.6)';
        g.lineWidth = m(0.014);
        g.beginPath();
        // the near half, where hands come in
        g.arc(x, y, m(w.r + 0.008), 0, Math.PI);
        g.stroke();
      }
    }
    g.filter = 'none';
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  render(): THREE.CanvasTexture {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = this.style.base;
    g.fillRect(0, 0, W, H);
    if (this.style.texture === 'brushed') {
      g.globalAlpha = 0.045;
      for (let y = 0; y < H; y += 2) {
        const v = Math.random() * 255;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(0, y, W, 1);
      }
      g.globalAlpha = 1;
    } else if (this.style.texture === 'matte') {
      g.globalAlpha = 0.03;
      for (let i = 0; i < (W * H) / 260; i++) {
        const v = Math.random() * 255;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
      }
      g.globalAlpha = 1;
    }
    for (const op of this.ops) op(g);
    this.scuffs(g);
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
}
