/*
 * The cutscene's first act, painted in 2D while the game loads: the ride
 * across town in the back of a cab (rain on the window, streetlights and neon
 * sliding past out of focus), then the club's door down a side street (wet
 * brick under one red bulb, light leaking round the door on every kick), and
 * the door swinging open into white.
 *
 * Runs in a worker on an OffscreenCanvas where it can, so it stays smooth
 * while the main thread is busy building the 3D room; on the main thread
 * otherwise. No DOM, no fonts: the words are the page's job.
 */
import { BAR, BEAT, type Cut, doorStart, kickEnv } from './plan';

type C2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

export interface FilmState {
  cut: Cut;
  /** when the door opens (intro seconds), once the game's ready */
  open: number | null;
  /** reduced motion: no flash, no push in */
  calm: boolean;
}

/** the letterbox (intro.css has the same) */
export const ASPECT = 2.2;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647), s / 2147483647);
}

function canvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** the street: when the cab slows to a stop, and when we're out of it (bars) */
const STOP_FROM = 6.2;
const STOP_AT = 7;
const OUT_AT = 7 + 1 / 4;

interface Light {
  x: number;
  y: number;
  r: number;
  color: string;
  a: number;
  depth: number;
  tw: number;
}

interface Drop {
  x: number;
  y: number;
  r: number;
}

const WARM = ['#ffb35c', '#ff9a3c', '#ffd8a0', '#ffcf86'];
const COOL = ['#7fd8ff', '#bfe8ff', '#5fe3c8'];
const HOT = ['#ff3048', '#ff4f6d', '#ff2a8a'];

export class Film {
  private g: C2D;
  private w = 1;
  private h = 1;
  private lights: Light[] = [];
  private drops: Drop[] = [];
  private blocks: { x: number; w: number; top: number }[] = [];
  private grain: AnyCanvas[] = [];
  private brick: AnyCanvas | null = null;
  private frame = 0;

  constructor(private cv: AnyCanvas) {
    this.g = cv.getContext('2d', { alpha: false }) as C2D;
    const r = rng(11);
    // the street's lights, at three depths, scattered along a long strip that wraps
    // far: windows and street lights along the far side of the street; mid: shop fronts and cars; near: a few big soft ones
    for (let i = 0; i < 74; i++) {
      const depth = i < 52 ? 0 : i < 68 ? 1 : 2;
      const pal = r() < 0.66 ? WARM : r() < 0.55 ? COOL : HOT;
      this.lights.push({
        x: r() * 1.4,
        y: depth === 0 ? (r() < 0.7 ? lerp(0.5, 0.62, r()) : lerp(0.3, 0.5, r())) : depth === 1 ? lerp(0.46, 0.72, r()) : lerp(0.2, 0.85, r()),
        r: depth === 0 ? lerp(0.0025, 0.007, r()) : depth === 1 ? lerp(0.016, 0.034, r()) : lerp(0.07, 0.11, r()),
        color: pal[Math.floor(r() * pal.length)],
        a: depth === 0 ? lerp(0.45, 0.95, r()) : depth === 1 ? lerp(0.2, 0.38, r()) : lerp(0.06, 0.12, r()),
        depth,
        tw: r() * 6.28,
      });
    }
    // the far side of the street: blocks of flats, darker than the sky's glow
    const b = rng(31);
    for (let x = 0; x < 1.4; x += 0.03 + b() * 0.09) this.blocks.push({ x, w: 0.04 + b() * 0.1, top: lerp(0.2, 0.42, b()) });
    const d = rng(5);
    for (let i = 0; i < 150; i++) this.drops.push({ x: d(), y: d(), r: d() < 0.85 ? lerp(0.001, 0.0024, d()) : lerp(0.003, 0.0055, d()) });
    // film grain: a few tiles, cycled
    for (let k = 0; k < 4; k++) {
      const c = canvas(192, 192);
      const cg = c.getContext('2d') as C2D;
      const img = cg.createImageData(192, 192);
      const n = rng(100 + k);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.floor(n() * 255);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      cg.putImageData(img, 0, 0);
      this.grain.push(c);
    }
  }

  resize(w: number, h: number): void {
    this.w = this.cv.width = Math.max(2, Math.round(w));
    this.h = this.cv.height = Math.max(2, Math.round(h));
  }

  /** the picture band the letterbox leaves (2.2:1), y from and height */
  private band(): { y: number; h: number } {
    const bh = Math.min(this.h, this.w / ASPECT);
    return { y: (this.h - bh) / 2, h: bh };
  }

  draw(t: number, s: FilmState): void {
    const g = this.g;
    this.frame++;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.w, this.h);
    const d0 = doorStart(s.cut);
    if (t < d0) this.street(t);
    else this.door(t, s);
    this.finish(t, s);
  }

  /* ---------------------------------------------------------------- */
  /* the ride                                                           */
  /* ---------------------------------------------------------------- */

  /** how far the cab has gone (seconds of full speed): slowing to a stop */
  private travelled(t: number): number {
    const a = STOP_FROM * BAR;
    const b = STOP_AT * BAR;
    if (t < a) return t;
    if (t < b) return a + (t - a) - ((t - a) * (t - a)) / (2 * (b - a));
    return a + (b - a) / 2;
  }

  private street(t: number): void {
    const { g, w } = this;
    const band = this.band();
    const bars = t / BAR;
    // in from black on bar 1.5, out to black when we get out of the cab
    const vis = smooth(1.4, 2.6, bars) * (1 - smooth(OUT_AT - 0.04, OUT_AT, bars));
    if (vis <= 0) return;
    const x = this.travelled(t);
    const speed = t < STOP_FROM * BAR ? 1 : clamp(1 - (t - STOP_FROM * BAR) / ((STOP_AT - STOP_FROM) * BAR));
    const H = band.h;
    const cy = band.y;
    g.save();
    g.globalAlpha = vis;
    // the night: dark blue up top, a sodium glow from the street below
    // a bump in the road now and then
    const bump = speed * (Math.sin(t * 13.7) * Math.sin(t * 3.1)) * H * 0.0025;
    g.translate(0, bump);
    const sky = g.createLinearGradient(0, cy, 0, cy + H);
    sky.addColorStop(0, '#03050a');
    sky.addColorStop(0.45, '#080a12');
    sky.addColorStop(0.62, '#140e0e');
    sky.addColorStop(0.75, '#07070a');
    sky.addColorStop(1, '#0d0806');
    g.fillStyle = sky;
    g.fillRect(0, cy - H * 0.1, w, H * 1.2);
    // the buildings across the street, sliding past slower than the cars
    g.fillStyle = 'rgba(3,3,5,0.7)';
    for (const bk of this.blocks) {
      const span = 1.4;
      const px = (((bk.x - x * 0.09) % span) + span) % span - 0.2;
      g.fillRect(px * w, cy + bk.top * H, bk.w * w + 1, H * (0.62 - bk.top));
    }
    // the lights: far ones small and slow, near ones big, soft and fast (parallax)
    g.globalCompositeOperation = 'lighter';
    const rates = [0.09, 0.22, 0.5];
    for (const L of this.lights) {
      const span = 1.4;
      let px = ((L.x - x * rates[L.depth]) % span + span) % span - 0.2;
      px *= w;
      const py = cy + L.y * H;
      const r = L.r * w;
      const tw = 0.75 + 0.25 * Math.sin(t * 2.3 + L.tw);
      this.bokeh(px, py, r, L.color, L.a * tw * vis, L.depth > 0);
    }
    // a streetlamp passing every two beats, high up and huge, lighting the cab as it goes
    const lampEvery = BEAT * 2;
    const lampSpeed = 0.62;
    let lit = 0;
    for (let k = -1; k <= 2; k++) {
      const n = Math.floor(x / lampEvery) + k;
      const lx = (1.25 - (x - n * lampEvery) * lampSpeed) * w;
      const ly = cy + H * 0.12;
      if (lx < -0.4 * w || lx > 1.4 * w) continue;
      this.bokeh(lx, ly, H * 0.36, '#ff9a3c', 0.2 * vis, true);
      lit = Math.max(lit, 1 - Math.abs(lx / w - 0.5) * 1.6);
    }
    // a pink neon now and then, smeared by the speed
    {
      const n = Math.floor(x / (BAR * 1.5));
      const nx = (1.3 - (x - n * BAR * 1.5) * 0.5) * w;
      const ny = cy + H * (0.32 + 0.12 * Math.sin(n * 3.1));
      const len = w * (0.06 + 0.1 * speed);
      g.save();
      g.translate(nx, ny);
      g.scale(len / (H * 0.05), 1);
      this.bokeh(0, 0, H * 0.05, n % 2 ? '#ff2a8a' : '#2fe0d0', 0.5 * vis, false);
      g.restore();
    }
    // the cab lit by the lamps passing over it
    g.globalCompositeOperation = 'source-over';
    // the glass: drops that catch the light
    this.drops_(x, t, lit, cy, H, vis);
    // the cab's door round the window: the frame, the seal, the top sloping down to the front
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.beginPath();
    g.rect(0, cy, w, H);
    const wx0 = w * 0.06;
    const wx1 = w * 0.97;
    const wyT0 = cy + H * 0.06;
    const wyT1 = cy + H * 0.2;
    const wyB = cy + H * 0.86;
    const rr = H * 0.08;
    g.moveTo(wx0 + rr, wyT0);
    g.lineTo(wx1 - rr * 2, wyT1);
    g.quadraticCurveTo(wx1, wyT1 + rr * 0.3, wx1, wyT1 + rr * 1.6);
    g.lineTo(wx1, wyB);
    g.lineTo(wx0, wyB);
    g.lineTo(wx0, wyT0 + rr);
    g.quadraticCurveTo(wx0, wyT0, wx0 + rr, wyT0);
    g.fill('evenodd');
    // the door panel and the seal catch the lamps
    const shine = g.createLinearGradient(0, wyB, 0, cy + H);
    shine.addColorStop(0, `rgba(255,150,70,${0.1 + 0.25 * lit})`);
    shine.addColorStop(0.08, `rgba(255,140,60,${0.03 + 0.08 * lit})`);
    shine.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shine;
    g.fillRect(0, wyB, w, cy + H - wyB);
    g.strokeStyle = `rgba(255,170,100,${0.05 + 0.18 * lit})`;
    g.lineWidth = Math.max(1, H * 0.004);
    g.beginPath();
    g.moveTo(wx0 + rr, wyT0 + 1);
    g.lineTo(wx1 - rr * 2, wyT1 + 1);
    g.stroke();
    // the lamps washing over the whole picture
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(255,120,40,${0.045 * lit * vis})`;
    g.fillRect(0, cy, w, H);
    g.restore();
  }

  /** an out-of-focus light: a soft disc with a brighter rim (a lens's bokeh) */
  private bokeh(x: number, y: number, r: number, color: string, a: number, rim: boolean): void {
    if (a <= 0.003 || r < 0.5) return;
    const g = this.g;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    if (rim && color.startsWith('#')) {
      // a flat disc, a touch brighter at its edge, then a soft rim
      const n = parseInt(color.slice(1), 16);
      const c = `${n >> 16},${(n >> 8) & 255},${n & 255}`;
      grad.addColorStop(0, `rgba(${c},0.5)`);
      grad.addColorStop(0.8, `rgba(${c},0.62)`);
      grad.addColorStop(0.93, `rgba(${c},0.9)`);
      grad.addColorStop(1, `rgba(${c},0)`);
    } else {
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
    }
    g.globalAlpha = a;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  private drops_(x: number, t: number, lit: number, cy: number, H: number, vis: number): void {
    const { g, w } = this;
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const px = d.x * w;
      const py = cy + d.y * H;
      const r = d.r * w;
      // a dark lens with the light's colour bent through it, and a glint on top
      g.globalAlpha = 0.35 * vis;
      g.fillStyle = '#05050a';
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = (0.06 + 0.45 * lit) * vis;
      g.fillStyle = i % 5 === 0 ? '#ffd2a0' : '#ffb070';
      g.beginPath();
      g.arc(px - r * 0.25, py + r * 0.3, r * 0.55, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = (0.12 + 0.55 * lit) * vis;
      g.fillStyle = '#fff3e0';
      g.beginPath();
      g.arc(px + r * 0.3, py - r * 0.35, Math.max(0.6, r * 0.22), 0, Math.PI * 2);
      g.fill();
    }
    // a few running down the glass, blown back by the speed
    const r0 = rng(3);
    g.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const seed = r0();
      const life = 2.2 + seed * 1.8;
      const ph = ((t + seed * 10) % life) / life;
      const sx = (0.15 + 0.8 * r0()) * w;
      const sy = cy + H * (0.15 + 0.2 * r0());
      const ex = sx - w * 0.18 * ph;
      const ey = sy + H * 0.7 * ph * ph;
      const tail = g.createLinearGradient(sx, sy, ex, ey);
      tail.addColorStop(0, 'rgba(255,220,180,0)');
      tail.addColorStop(1, `rgba(255,220,180,${(0.06 + 0.22 * lit) * vis})`);
      g.globalAlpha = 1;
      g.strokeStyle = tail;
      g.lineWidth = Math.max(1, w * 0.0011);
      g.beginPath();
      g.moveTo(lerp(sx, ex, 0.4), lerp(sy, ey, 0.4 * 0.4));
      g.quadraticCurveTo(lerp(sx, ex, 0.8), lerp(sy, ey, 0.6), ex, ey);
      g.stroke();
      g.fillStyle = `rgba(255,236,210,${(0.3 + 0.5 * lit) * vis})`;
      g.beginPath();
      g.arc(ex, ey, w * 0.0026, 0, Math.PI * 2);
      g.fill();
    }
    void x;
    g.globalAlpha = 1;
  }

  /* ---------------------------------------------------------------- */
  /* the door                                                           */
  /* ---------------------------------------------------------------- */

  private bricks(): AnyCanvas {
    if (this.brick) return this.brick;
    const W = 1024;
    const H = 640;
    const c = canvas(W, H);
    const g = c.getContext('2d') as C2D;
    g.fillStyle = '#3a3330';
    g.fillRect(0, 0, W, H);
    const r = rng(42);
    const bw = 58;
    const bh = 21;
    for (let row = 0; row * bh < H; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < W + bw; x += bw) {
        const v = 0.62 + r() * 0.38;
        const red = Math.round(118 * v + r() * 14);
        const gr = Math.round(92 * v);
        const bl = Math.round(82 * v);
        g.fillStyle = `rgb(${red},${gr},${bl})`;
        g.fillRect(x + off + 2, row * bh + 2, bw - 3, bh - 3);
        // a little texture on each brick
        g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.1})`;
        g.fillRect(x + off + 2 + r() * bw * 0.6, row * bh + 2 + r() * bh * 0.5, bw * 0.3, bh * 0.3);
      }
    }
    // rain streaks down the wall and the grime at the bottom
    for (let i = 0; i < 22; i++) {
      const x = r() * W;
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.3 + r() * 0.4, `rgba(0,0,0,${0.08 + r() * 0.12})`);
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grad;
      g.fillRect(x, 0, 3 + r() * 12, H);
    }
    const dirt = g.createLinearGradient(0, H * 0.65, 0, H);
    dirt.addColorStop(0, 'rgba(0,0,0,0)');
    dirt.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = dirt;
    g.fillRect(0, 0, W, H);
    this.brick = c;
    return c;
  }

  private door(t: number, s: FilmState): void {
    const { g, w, h } = this;
    const band = this.band();
    const d0 = doorStart(s.cut);
    const since = t - d0;
    // the music's kick through the door, from the door's first bar
    const kick = kickEnv(t, 6);
    const open = s.open !== null ? clamp((t - s.open) / BAR) : 0;
    const swing = 1 - (1 - smooth(0.08, 1, open)) ** 2;
    // in from black, the camera creeping towards the door (and walking in as it opens)
    const fadeIn = s.cut === 'full' ? smooth(0, 0.5, since) : smooth(0, 0.8, since);
    const creep = s.calm ? 1 : 1 + 0.06 * clamp(since / (BAR * 4)) + 0.55 * smooth(0.3, 1, open) ** 1.6;
    const cx = w / 2;
    const groundY = band.y + band.h * 0.84;
    g.save();
    g.translate(cx, groundY - band.h * 0.3);
    g.scale(creep, creep);
    g.translate(-cx, -(groundY - band.h * 0.3));
    // a shudder as the bar goes down
    if (open > 0 && open < 0.12 && !s.calm) g.translate(Math.sin(open * 300) * w * 0.0012, 0);
    g.globalAlpha = fadeIn;
    // the wall, lit red from the bulb
    const dh = band.h * 0.5;
    const dw = dh * 0.5;
    const dx = cx - dw / 2;
    const dy = groundY - dh;
    const bulbX = cx;
    const bulbY = dy - band.h * 0.09;
    const B = this.bricks();
    const scale = (band.h * 1.25) / 640;
    const bwid = 1024 * scale;
    for (let x = cx - bwid * 1.5; x < w + bwid; x += bwid) g.drawImage(B, x, groundY - 640 * scale, bwid, 640 * scale);
    g.globalCompositeOperation = 'multiply';
    const flick = 0.92 + 0.08 * Math.sin(t * 31) * Math.sin(t * 7.3);
    const red = g.createRadialGradient(bulbX, bulbY, 0, bulbX, bulbY, band.h * 0.95);
    red.addColorStop(0, `rgba(255,${Math.round(90 * flick)},70,1)`);
    red.addColorStop(0.25, 'rgba(190,40,36,1)');
    red.addColorStop(0.6, 'rgba(60,8,12,1)');
    red.addColorStop(1, 'rgba(8,2,4,1)');
    g.fillStyle = red;
    g.fillRect(-w, -h, w * 3, h * 3);
    g.globalCompositeOperation = 'source-over';
    // the ground: wet tarmac, the bulb and the door's light smeared down it
    const ground = g.createLinearGradient(0, groundY, 0, band.y + band.h * 1.4);
    ground.addColorStop(0, '#0e0607');
    ground.addColorStop(1, '#030203');
    g.fillStyle = ground;
    g.fillRect(-w, groundY, w * 3, h);
    g.globalCompositeOperation = 'lighter';
    const leak = 0.3 + 0.7 * kick + swing * 3;
    // reflections: long vertical smears
    g.save();
    g.translate(cx, groundY);
    g.scale(1, 3.2);
    this.bokeh(0, band.h * 0.03, dw * 0.55, `rgba(255,60,50,${0.5 * flick})`, 0.35, false);
    this.bokeh(0, band.h * 0.02, dw * 0.6, '#cfe6ff', 0.1 * leak, false);
    g.restore();
    // the gap under the door spills out across the ground
    const spill = g.createRadialGradient(cx, groundY, 0, cx, groundY, dw * 1.6);
    spill.addColorStop(0, `rgba(200,225,255,${0.22 * leak})`);
    spill.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = spill;
    g.save();
    g.translate(cx, groundY);
    g.scale(1, 0.25);
    g.translate(-cx, -groundY);
    g.beginPath();
    g.arc(cx, groundY, dw * 1.6, 0, Math.PI);
    g.fill();
    g.restore();
    g.globalCompositeOperation = 'source-over';
    // the door's steel frame, then inside through the opening door: haze lit white and violet, heads against it
    g.fillStyle = '#121214';
    g.fillRect(dx - dw * 0.04, dy - dw * 0.04, dw * 1.08, dh + dw * 0.04);
    if (open > 0) this.inside(dx, dy, dw, dh, open, t);
    // the door: steel, a push bar, a sticker
    this.doorLeaf(dx, dy, dw, dh, swing, flick);
    // light round the door's edges, on the kick
    if (swing < 0.2) {
      // the gap under the door brightest, the latch side next, the top a hairline; the hinge side sealed
      const edge = dw * (1 - swing * 0.92);
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      const lines: [number, number, number, number, number][] = [
        [dx + dw * 0.02, groundY - 1, dx + edge - dw * 0.02, groundY - 1, 1],
        [dx + edge, dy + dh * 0.04, dx + edge, groundY - dh * 0.02, 0.55],
        [dx + dw * 0.06, dy, dx + edge - dw * 0.06, dy, 0.3],
      ];
      for (const [wid, a] of [[dw * 0.22, 0.035], [dw * 0.06, 0.1], [Math.max(1.2, dw * 0.01), 0.75]] as const) {
        g.lineWidth = wid;
        for (const [x0, y0, x1, y1, k] of lines) {
          g.strokeStyle = `rgba(200,220,255,${a * k * leak})`;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
        }
      }
      g.globalCompositeOperation = 'source-over';
    }
    // the bulb in its cage, and its glow
    g.globalCompositeOperation = 'lighter';
    this.bokeh(bulbX, bulbY, band.h * 0.22, '#ff3a2a', 0.42 * flick, false);
    this.bokeh(bulbX, bulbY, band.h * 0.05, '#ff9a80', 0.9 * flick, false);
    this.bokeh(bulbX, bulbY, band.h * 0.016, '#fff0e0', 1, false);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(10,4,4,0.85)';
    g.lineWidth = Math.max(1, band.h * 0.0035);
    g.beginPath();
    for (let i = -2; i <= 2; i++) {
      g.moveTo(bulbX + i * band.h * 0.009, bulbY - band.h * 0.024);
      g.lineTo(bulbX + i * band.h * 0.011, bulbY + band.h * 0.02);
    }
    g.moveTo(bulbX - band.h * 0.03, bulbY - band.h * 0.03);
    g.lineTo(bulbX + band.h * 0.03, bulbY - band.h * 0.03);
    g.stroke();
    // rain, only where the bulb catches it
    this.rain(t, bulbX, bulbY, band);
    // steam off a grate, drifting through the light
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const ph = ((t * 0.09 + i / 6) % 1 + 1) % 1;
      const sx = cx - dw * 2.2 + Math.sin(t * 0.4 + i) * dw * 0.4 + ph * dw * 0.8;
      const sy = groundY - ph * band.h * 0.6;
      this.bokeh(sx, sy, band.h * (0.08 + ph * 0.2), '#ff6a5a', 0.06 * Math.sin(ph * Math.PI), false);
    }
    g.globalCompositeOperation = 'source-over';
    g.restore();
    // the light floods out as the door opens
    if (open > 0) {
      g.globalCompositeOperation = 'lighter';
      // the room's light pours out of the doorway, then fills the frame as we walk into it
      const doorCx = w / 2;
      const doorCy = band.y + band.h * 0.6;
      const pour = smooth(0.1, 0.8, open);
      const glow = g.createRadialGradient(doorCx, doorCy, 0, doorCx, doorCy, band.h * (0.3 + pour * 1.4));
      glow.addColorStop(0, `rgba(235,240,255,${0.7 * pour})`);
      glow.addColorStop(0.4, `rgba(170,150,255,${0.25 * pour})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
      const flood = s.calm ? smooth(0.6, 1, open) : smooth(0.62, 1, open) ** 1.3;
      g.fillStyle = `rgba(255,250,246,${flood})`;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
  }

  private doorLeaf(dx: number, dy: number, dw: number, dh: number, swing: number, flick: number): void {
    const g = this.g;
    // hinged on the left: the free edge swings in, away from us (narrower, and shorter with perspective)
    const ew = dw * (1 - swing * 0.92);
    const shrink = dh * 0.06 * swing;
    g.beginPath();
    g.moveTo(dx, dy);
    g.lineTo(dx + ew, dy + shrink);
    g.lineTo(dx + ew, dy + dh - shrink);
    g.lineTo(dx, dy + dh);
    g.closePath();
    const steel = g.createLinearGradient(dx, dy, dx, dy + dh);
    steel.addColorStop(0, `rgb(${Math.round(92 * flick)},34,32)`);
    steel.addColorStop(0.4, '#3a1a1a');
    steel.addColorStop(1, '#140a0b');
    g.fillStyle = steel;
    g.fill();
    if (ew < dw * 0.2) return;
    const k = ew / dw;
    // panels and the push bar
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = Math.max(1, dw * 0.012);
    g.strokeRect(dx + dw * 0.1 * k, dy + dh * 0.06, dw * 0.8 * k, dh * 0.36);
    g.strokeRect(dx + dw * 0.1 * k, dy + dh * 0.5, dw * 0.8 * k, dh * 0.44);
    g.fillStyle = '#5a3a36';
    g.fillRect(dx + dw * 0.08 * k, dy + dh * 0.46, dw * 0.84 * k, dh * 0.025);
    g.fillStyle = 'rgba(255,120,100,0.25)';
    g.fillRect(dx + dw * 0.08 * k, dy + dh * 0.46, dw * 0.84 * k, dh * 0.006);
    // the house rule, on a sticker: no photos
    const sx = dx + dw * 0.5 * k;
    const sy = dy + dh * 0.25;
    const sr = dw * 0.09;
    g.save();
    g.translate(sx, sy);
    g.scale(k, 1);
    g.fillStyle = '#d9d2c8';
    g.beginPath();
    g.arc(0, 0, sr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1a1a';
    g.fillRect(-sr * 0.5, -sr * 0.28, sr, sr * 0.62);
    g.fillStyle = '#d9d2c8';
    g.beginPath();
    g.arc(0, sr * 0.03, sr * 0.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#b8231e';
    g.lineWidth = sr * 0.16;
    g.beginPath();
    g.arc(0, 0, sr * 0.84, 0, Math.PI * 2);
    g.moveTo(-sr * 0.6, -sr * 0.6);
    g.lineTo(sr * 0.6, sr * 0.6);
    g.stroke();
    g.restore();
  }

  /** what's through the door: white haze, a violet beam, the backs of heads */
  private inside(dx: number, dy: number, dw: number, dh: number, open: number, t: number): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(dx, dy, dw, dh);
    g.clip();
    const glow = g.createLinearGradient(0, dy, 0, dy + dh);
    glow.addColorStop(0, '#9fb8ff');
    glow.addColorStop(0.5, '#f4f2ff');
    glow.addColorStop(1, '#ffd9ef');
    g.fillStyle = glow;
    g.fillRect(dx, dy, dw, dh);
    g.globalCompositeOperation = 'lighter';
    const beat = kickEnv(t, 5);
    for (let i = 0; i < 4; i++) {
      const a = Math.sin(t * 1.3 + i * 1.7) * 0.6;
      g.save();
      g.translate(dx + dw * (0.2 + i * 0.2), dy);
      g.rotate(a);
      const beam = g.createLinearGradient(0, 0, 0, dh);
      beam.addColorStop(0, i % 2 ? `rgba(160,90,255,${0.6 + 0.4 * beat})` : `rgba(80,200,255,${0.5 + 0.4 * beat})`);
      beam.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = beam;
      g.fillRect(-dw * 0.05, 0, dw * 0.1, dh * 1.2);
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    // the crowd's heads and raised hands, black against the light
    g.fillStyle = `rgba(6,4,10,${0.85 * (1 - smooth(0.6, 1, open))})`;
    const r = rng(9);
    for (let i = 0; i < 9; i++) {
      const hx = dx + dw * (i / 8) + (r() - 0.5) * dw * 0.08;
      const bob = Math.sin(t * Math.PI * 2 * (60 / 124 / 1) * 0.5 + i) * dh * 0.01;
      const hy = dy + dh * (0.72 + r() * 0.06) + bob;
      const hr = dw * (0.07 + r() * 0.02);
      g.beginPath();
      g.arc(hx, hy, hr, 0, Math.PI * 2);
      g.fill();
      g.fillRect(hx - hr * 1.8, hy + hr * 0.7, hr * 3.6, dh);
      if (r() > 0.6) g.fillRect(hx + hr * 0.6, hy - hr * 3.5 + bob * 2, hr * 0.5, hr * 3.2);
    }
    g.restore();
  }

  private rain(t: number, bx: number, by: number, band: { y: number; h: number }): void {
    const g = this.g;
    const r = rng(21);
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = Math.max(1, band.h * 0.0018);
    g.lineCap = 'round';
    for (let i = 0; i < 110; i++) {
      const sx = bx + (r() - 0.5) * band.h * 1.6;
      const speed = 0.9 + r() * 0.5;
      const ph = ((t * speed + r()) % 1 + 1) % 1;
      const y = band.y + ph * band.h * 1.05;
      const len = band.h * 0.05;
      const x = sx - (y - band.y) * 0.06;
      const dist = Math.hypot(x - bx, y - by) / (band.h * 0.5);
      const a = 0.32 * Math.max(0, 1 - dist);
      if (a < 0.01) continue;
      g.strokeStyle = `rgba(255,150,130,${a})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - len * 0.06, y + len);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }

  /* ---------------------------------------------------------------- */
  /* film                                                               */
  /* ---------------------------------------------------------------- */

  private finish(t: number, s: FilmState): void {
    const { g, w, h } = this;
    // vignette
    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.58);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
    // grain, a fresh tile each frame
    const tile = this.grain[this.frame % this.grain.length];
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.09;
    const ts = Math.max(192, Math.round(Math.min(w, h) / 4.5));
    const ox = (this.frame * 37) % ts;
    const oy = (this.frame * 53) % ts;
    for (let y = -oy; y < h; y += ts) for (let x = -ox; x < w; x += ts) g.drawImage(tile, x, y, ts, ts);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    // a projector's breath
    if (!s.calm) {
      const fl = 0.025 * (Math.sin(t * 23) * 0.5 + Math.sin(t * 9.1) * 0.5);
      if (fl > 0) {
        g.fillStyle = `rgba(0,0,0,${fl})`;
        g.fillRect(0, 0, w, h);
      }
    }
  }
}
