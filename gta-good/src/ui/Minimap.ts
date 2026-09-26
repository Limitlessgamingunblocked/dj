import { EDGE, N, P, RW, SIZE, SW, type City } from '../core/city';
import type { Vec2 } from '../core/math';

const ZONE: Record<string, string> = {
  residential: '#2f4a33',
  downtown: '#3a3f4a',
  industrial: '#3d3b36',
  park: '#2f5a33',
  hospital: '#4a3a40',
  training: '#3a4046',
  stadium: '#2d4f5e',
  rural: '#3f4a2c',
};

export interface MapDot {
  x: number;
  z: number;
  color: string;
  size?: number;
  pulse?: boolean;
  label?: string;
}

/** Rotating GPS minimap drawn from a pre-rendered city image. */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  readonly size = 210;

  constructor(private city: City) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.width = this.size * this.dpr;
    this.el.height = this.size * this.dpr;
    this.ctx = this.el.getContext('2d')!;
    this.base = this.renderBase();
  }

  private renderBase(): HTMLCanvasElement {
    const W = SIZE + EDGE * 2;
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1f2a22';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(EDGE, EDGE);
    for (const col of this.city.blocks) {
      for (const b of col) {
        ctx.fillStyle = '#56585c';
        ctx.fillRect(b.x0 - SW, b.z0 - SW, b.x1 - b.x0 + SW * 2, b.z1 - b.z0 + SW * 2);
        ctx.fillStyle = ZONE[b.zone];
        ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
        ctx.fillStyle = b.zone === 'hospital' ? '#d9d9de' : '#6b7079';
        for (const bd of b.buildings) ctx.fillRect(bd.x0, bd.z0, bd.x1 - bd.x0, bd.z1 - bd.z0);
      }
    }
    ctx.fillStyle = '#16181c';
    for (let i = 0; i <= N; i++) {
      ctx.fillRect(i * P - RW / 2, -RW / 2, RW, SIZE + RW);
      ctx.fillRect(-RW / 2, i * P - RW / 2, SIZE + RW, RW);
    }
    for (const b of this.city.parks) {
      ctx.fillStyle = '#3f7fa6';
      ctx.beginPath();
      ctx.arc((b.x0 + b.x1) / 2 + 8, (b.z0 + b.z1) / 2 - 6, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  /** Draws the map centred on `pos`, rotated so `heading` points up. */
  draw(pos: Vec2, heading: number, zoom: number, route: Vec2[] | null, dots: MapDot[], time: number, closed: { a: Vec2; b: Vec2 }[]) {
    const { ctx, dpr, size } = this;
    const half = size / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1f2a22';
    ctx.fillRect(0, 0, size, size);
    // World → map: rotate so the heading faces up. Heading 0 faces +z (south), which should point up.
    ctx.translate(half, half);
    ctx.rotate(Math.PI + heading);
    ctx.scale(zoom, zoom);
    ctx.translate(-pos.x, -pos.z);
    ctx.drawImage(this.base, -EDGE, -EDGE);
    ctx.lineCap = 'round';
    for (const c of closed) {
      ctx.strokeStyle = '#e5383b';
      ctx.lineWidth = 6 / zoom;
      ctx.setLineDash([6 / zoom, 5 / zoom]);
      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.z);
      ctx.lineTo(c.b.x, c.b.z);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (route && route.length > 1) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 9 / zoom;
      ctx.beginPath();
      route.forEach((p, k) => (k ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)));
      ctx.stroke();
      ctx.strokeStyle = '#ffd21f';
      ctx.lineWidth = 5 / zoom;
      ctx.stroke();
    }
    ctx.restore();

    // Dots are drawn upright in screen space.
    const cos = Math.cos(Math.PI + heading);
    const sin = Math.sin(Math.PI + heading);
    const toScreen = (x: number, z: number) => {
      const dx = (x - pos.x) * zoom;
      const dz = (z - pos.z) * zoom;
      return { x: half + dx * cos - dz * sin, y: half + dx * sin + dz * cos };
    };
    for (const d of dots) {
      let s = toScreen(d.x, d.z);
      const r = Math.hypot(s.x - half, s.y - half);
      const edge = half - 10;
      const clamped = r > edge;
      if (clamped) s = { x: half + ((s.x - half) / r) * edge, y: half + ((s.y - half) / r) * edge };
      const pulse = d.pulse ? 1 + 0.35 * Math.sin(time * 6) : 1;
      ctx.fillStyle = d.color;
      ctx.strokeStyle = '#0b0d10';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, (d.size ?? 4.5) * pulse * (clamped ? 0.85 : 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (d.label) {
        ctx.fillStyle = '#fff';
        ctx.font = '700 10px Barlow, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.label, s.x, s.y + 0.5);
      }
    }
    // Player arrow.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b0d10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(half, half - 9);
    ctx.lineTo(half + 7, half + 7);
    ctx.lineTo(half, half + 3);
    ctx.lineTo(half - 7, half + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // North marker on the rim.
    const nx = half + sin * (half - 12);
    const ny = half - cos * (half - 12);
    ctx.fillStyle = '#e5383b';
    ctx.font = '700 11px Barlow, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
  }
}
