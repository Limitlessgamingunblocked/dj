/*
 * The backs of the boards: rear panels with real connectors (RCA, XLR, 1/4"
 * TRS, USB, IEC power, a ground post), vents and printed labels, and the
 * cables plugged into them, sagging onto the desk and running off it through
 * a cable grommet (or across to the mixer's inputs).
 *
 * Kept cheap: per unit, one textured mesh for the printed panel and every
 * dark plastic part (rubber feet, jack inserts: they sample solid swatches
 * kept in a strip of the panel's texture) and one vertex-coloured metal mesh
 * (screws, jack shells); per board, one vertex-coloured mesh for the cables,
 * plug bodies and grommets and one for the plugs' metal.
 *
 * Unit space: metres, +X right, +Y up from the unit's base, the rear panel at
 * z = −d/2 facing −Z (the crowd).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { grooves, lathe, mergePieces, place, screwHead, type Piece } from './realism';

export type JackKind = 'rca' | 'xlr' | 'trs' | 'usb' | 'iec' | 'dc' | 'gnd' | 'lan';

/** where a plugged jack's cable goes: off the desk, or to another unit's jack */
export type CableTo = 'floor' | { unit: number; jack: number };

export interface Jack {
  kind: JackKind;
  /** across the panel (unit x) and up it (unit y) */
  x: number;
  y: number;
  label: string;
  /** an RCA's insert colour (red right, white left, orange digital) */
  insert?: string;
  /** a deck's line out: the patcher wires it to a mixer input pair */
  out?: 'L' | 'R';
  /** a mixer's input: channel pair index (0-based, left to right) and side */
  input?: { pair: number; side: 'L' | 'R' };
  /** plug a cable in and run it off the desk */
  floor?: boolean;
  /** the cable's colour (power and signal cables are black; RCA pairs are moulded red / white) */
  cable?: string;
}

export type RearKind = 'turntable' | 'player' | 'mixer' | 'controller' | 'starter';

/* ------------------------------------------------------------------ */
/* panel layouts                                                        */
/* ------------------------------------------------------------------ */

const RED = '#b3241f';
const WHITE = '#d9d8d2';
const ORANGE = '#d9741f';

/**
 * The connectors on a unit's rear panel. x runs in the unit's own frame (+x
 * is the DJ's right), so from behind the panel reads mirrored, as it does on
 * real gear.
 */
export function rearLayout(kind: RearKind, w: number, h: number, channels = 2): Jack[] {
  const y = h * 0.5;
  const J: Jack[] = [];
  const rcaPair = (x: number, label: string, extra: Partial<Jack> = {}, gap = 0.015) => {
    J.push({ kind: 'rca', x: x - gap / 2, y, label: `${label} L`, insert: WHITE, ...extra, ...(extra.input ? { input: { ...extra.input, side: 'L' } } : {}), ...(extra.out ? { out: 'L' } : {}) });
    J.push({ kind: 'rca', x: x + gap / 2, y, label: 'R', insert: RED, ...extra, ...(extra.input ? { input: { ...extra.input, side: 'R' } } : {}), ...(extra.out ? { out: 'R' } : {}) });
  };
  switch (kind) {
    case 'turntable': {
      // the classic deck: phono out pair and a ground post at the left rear, mains inlet at the right
      rcaPair(-w / 2 + 0.07, 'PHONO OUT', { out: 'L' });
      J.push({ kind: 'gnd', x: -w / 2 + 0.105, y, label: 'GND', out: 'L' });
      J.push({ kind: 'iec', x: w / 2 - 0.06, y, label: 'AC IN ~', floor: true });
      break;
    }
    case 'player': {
      rcaPair(-w / 2 + 0.05, 'AUDIO OUT', { out: 'L' });
      J.push({ kind: 'rca', x: -w / 2 + 0.085, y, label: 'DIGITAL', insert: ORANGE });
      J.push({ kind: 'lan', x: -0.01, y, label: 'LINK' });
      J.push({ kind: 'usb', x: 0.035, y, label: 'USB' });
      J.push({ kind: 'iec', x: w / 2 - 0.05, y, label: 'AC IN ~', floor: true });
      break;
    }
    case 'mixer': {
      // inputs: one pair per channel across the middle; outputs and power at the sides
      const span = Math.min(w - 0.12, channels * 0.042);
      for (let c = 0; c < channels; c++) {
        const x = -span / 2 + (span / channels) * (c + 0.5);
        rcaPair(x, `CH${c + 1}`, { input: { pair: c, side: 'L' } }, 0.014);
      }
      J.push({ kind: 'gnd', x: -w / 2 + 0.03, y: h * 0.72, label: 'SIGNAL GND' });
      J.push({ kind: 'xlr', x: -w / 2 + 0.03, y: h * 0.38, label: 'MASTER L', floor: true });
      J.push({ kind: 'xlr', x: w / 2 - 0.058, y: h * 0.38, label: 'MASTER R', floor: true });
      J.push({ kind: 'iec', x: w / 2 - 0.03, y: h * 0.62, label: 'AC IN ~', floor: true });
      break;
    }
    case 'controller': {
      J.push({ kind: 'xlr', x: -w / 2 + 0.05, y, label: 'MASTER L', floor: true });
      J.push({ kind: 'xlr', x: -w / 2 + 0.085, y, label: 'MASTER R', floor: true });
      rcaPair(-w / 2 + 0.13, 'MASTER 2');
      J.push({ kind: 'trs', x: -w / 2 + 0.165, y, label: 'BOOTH L' });
      J.push({ kind: 'trs', x: -w / 2 + 0.185, y, label: 'R' });
      J.push({ kind: 'usb', x: w / 2 - 0.09, y, label: 'USB', floor: true });
      J.push({ kind: 'iec', x: w / 2 - 0.05, y, label: 'AC IN ~', floor: true });
      break;
    }
    case 'starter': {
      rcaPair(-w / 2 + 0.06, 'MASTER OUT', { floor: true });
      J.push({ kind: 'usb', x: w / 2 - 0.06, y, label: 'USB', floor: true });
      J.push({ kind: 'dc', x: w / 2 - 0.035, y, label: '5V DC' });
      break;
    }
  }
  return J;
}

/* ------------------------------------------------------------------ */
/* the panel texture                                                    */
/* ------------------------------------------------------------------ */

/** solid swatches in a strip under the panel art: dark parts merged into the panel mesh sample these */
const SWATCHES = ['#060607', '#0f0f11', RED, WHITE, ORANGE, '#3a3c41', '#1a1b1e'] as const;
type Swatch = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const STRIP = 16;

function swatchOf(insert: string | undefined): Swatch {
  return insert === RED ? 2 : insert === WHITE ? 3 : insert === ORANGE ? 4 : 1;
}

/** set every uv of `g` onto one swatch of a panel texture `W` × `H` px */
function onSwatch(g: THREE.BufferGeometry, k: Swatch, W: number, H: number): THREE.BufferGeometry {
  const q = g.index ? g.toNonIndexed() : g.clone();
  const n = q.getAttribute('position').count;
  const uv = new Float32Array(n * 2);
  const u = (k * STRIP + STRIP / 2) / W;
  const v = STRIP / 2 / H;
  for (let i = 0; i < n; i++) {
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  q.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return q;
}

function mix(a: string, b: string, k: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;
}

/** relative luminance-ish: is this a light panel? */
function light(hex: string): boolean {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.45;
}

interface PanelArt {
  canvas: HTMLCanvasElement;
  W: number;
  H: number;
  /** panel px per metre */
  ppm: number;
}

/**
 * Paint the rear panel: the body colour with a fine brushed grain, vent slots,
 * a printed label by every connector, a rating plate, and the swatch strip.
 * The panel covers x ∈ [−pw/2, pw/2], y ∈ [y0, y0 + ph] in unit space.
 */
function paintPanel(body: string, pw: number, ph: number, y0: number, jacks: Jack[], model: string, seed: number): PanelArt {
  const ppm = Math.min(3200, 2048 / pw);
  const W = Math.max(SWATCHES.length * STRIP, Math.round(pw * ppm));
  const PH = Math.round(ph * ppm);
  const H = PH + STRIP;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const lit = light(body);
  const ink = lit ? '#1a1b1e' : '#d9dce2';
  const base = mix(body, lit ? '#000000' : '#ffffff', 0.04);
  g.fillStyle = base;
  g.fillRect(0, 0, W, PH);
  let a = seed | 1;
  const r = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
  // fine horizontal grain, like the sheet metal of a real panel
  g.globalAlpha = 0.05;
  for (let y = 0; y < PH; y += 2) {
    const v = (r() * 255) | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, W, 1);
  }
  g.globalAlpha = 1;
  // panel x (seen from behind: mirrored) to canvas px
  const px = (x: number) => (pw / 2 - x) * ppm;
  const py = (y: number) => (y0 + ph - y) * ppm;
  const m = (v: number) => v * ppm;
  // vents: the widest stretch of panel with no connector in it
  const xs = jacks.map((j) => j.x).sort((p, q) => p - q);
  const edges = [-pw / 2 + 0.01, ...xs, pw / 2 - 0.01];
  let best = [0, 0];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i] + (i > 0 ? 0.022 : 0);
    const hi = edges[i + 1] - (i < edges.length - 2 ? 0.022 : 0);
    if (hi - lo > best[1] - best[0]) best = [lo, hi];
  }
  const vw = Math.min(0.12, best[1] - best[0]);
  if (vw > 0.03) {
    const cx = (best[0] + best[1]) / 2;
    const n = Math.floor(vw / 0.0045);
    const sh = Math.min(0.022, ph * 0.42);
    for (let i = 0; i < n; i++) {
      const x = cx - vw / 2 + (i + 0.5) * (vw / n);
      g.fillStyle = '#050506';
      g.beginPath();
      g.roundRect(px(x) - m(0.0011), py(y0 + ph / 2) - m(sh / 2), m(0.0022), m(sh), m(0.0011));
      g.fill();
      // the lit lower lip of each slot
      g.fillStyle = lit ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)';
      g.fillRect(px(x) - m(0.0011), py(y0 + ph / 2) + m(sh / 2) - 1, m(0.0022), 1.5);
    }
  }
  // labels and ring outlines round the connectors
  const font = (size: number, weight = 700) => `${weight} ${m(size)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  for (const j of jacks) {
    const top = j.kind === 'xlr' ? 0.017 : j.kind === 'iec' ? 0.015 : 0.009;
    g.fillStyle = ink;
    g.font = font(0.0026);
    g.fillText(j.label, px(j.x), py(j.y + top) - 1);
    g.strokeStyle = lit ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.22)';
    g.lineWidth = Math.max(1, m(0.0003));
    if (j.kind === 'rca' || j.kind === 'trs' || j.kind === 'gnd' || j.kind === 'dc') {
      g.beginPath();
      g.arc(px(j.x), py(j.y), m(0.0068), 0, Math.PI * 2);
      g.stroke();
    }
  }
  // model name and the rating plate: a small silver sticker of fine print
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = ink;
  g.font = font(0.0042, 800);
  const plateW = 0.05;
  const plateH = Math.min(0.022, ph * 0.5);
  const plateX = vw > 0.03 ? Math.min(pw / 2 - 0.01 - plateW, (best[0] + best[1]) / 2 + vw / 2 + 0.006) : -pw / 2 + 0.01;
  if (best[1] - best[0] > vw + plateW + 0.012) {
    const x0 = px(plateX + plateW);
    const y0p = py(y0 + ph / 2 + plateH / 2);
    g.fillStyle = '#b9bcc2';
    g.fillRect(x0, y0p, m(plateW), m(plateH));
    g.fillStyle = '#2a2c30';
    g.font = font(0.0024, 800);
    g.fillText(model, x0 + m(0.002), y0p + m(0.0032));
    g.fillStyle = 'rgba(30,32,36,0.75)';
    for (let i = 0; i < 5; i++) g.fillRect(x0 + m(0.002), y0p + m(0.0065 + i * 0.0027), m(plateW * (0.55 + r() * 0.35)), Math.max(1, m(0.0008)));
  }
  // the swatch strip
  SWATCHES.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(i * STRIP, PH, STRIP, STRIP);
  });
  return { canvas, W, H, ppm };
}

/* ------------------------------------------------------------------ */
/* connector geometry                                                   */
/* ------------------------------------------------------------------ */

const NICKEL = '#c9ccd1';
const GOLD = '#d4b067';
const STEEL = '#8d9097';
const BLACKOX = '#2a2b2e';

/** pieces for a socket at (x, y) on a panel at z = zp, sticking out along −z */
function socket(j: Jack, zp: number, metal: Piece[], dark: { g: THREE.BufferGeometry; k: Swatch; m: THREE.Matrix4 }[]): void {
  const out = (dz: number) => zp - dz; // a point dz out from the panel
  const along = (x: number, y: number, dz: number) => place(x, y, out(dz), -Math.PI / 2, 0, 0); // lathe y → −z
  switch (j.kind) {
    case 'rca': {
      const gold = j.insert !== ORANGE;
      metal.push({ g: new THREE.CylinderGeometry(0.0056, 0.0056, 0.0016, 6), m: place(j.x, j.y, out(0.0008), Math.PI / 2, 0, 0), color: NICKEL });
      metal.push({ g: lathe([[0.0042, 0], [0.0042, 0.0075], [0.0036, 0.0082], [0.0026, 0.0082], [0.0026, 0.003]], 20), m: along(j.x, j.y, 0.0016), color: gold ? GOLD : NICKEL });
      dark.push({ g: new THREE.CircleGeometry(0.0026, 16), k: swatchOf(j.insert), m: place(j.x, j.y, out(0.0045), 0, Math.PI, 0) });
      break;
    }
    case 'trs':
    case 'dc': {
      const r = j.kind === 'trs' ? 0.0062 : 0.0045;
      metal.push({ g: new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.0018, 6), m: place(j.x, j.y, out(0.0009), Math.PI / 2, 0, 0), color: NICKEL });
      metal.push({ g: lathe([[r, 0], [r, 0.004], [r * 0.6, 0.0042], [r * 0.6, 0.001]], 18), m: along(j.x, j.y, 0.0018), color: NICKEL });
      dark.push({ g: new THREE.CircleGeometry(r * 0.6, 14), k: 0, m: place(j.x, j.y, out(0.0028), 0, Math.PI, 0) });
      break;
    }
    case 'gnd': {
      // a knurled thumb nut on a threaded post
      metal.push({ g: lathe([[0.0022, 0], [0.0022, 0.004], [0.0052, 0.0042], ...grooves(0.0052, 0.0042, 0.0105, 8, 0.0004), [0.0048, 0.0112], [0, 0.0112]], 14), m: along(j.x, j.y, 0), color: NICKEL });
      break;
    }
    case 'xlr': {
      // a round insert in a square metal flange with its latch
      metal.push({ g: new RoundedBoxGeometry(0.026, 0.031, 0.0012, 2, 0.003), m: place(j.x, j.y, out(0.0006)), color: STEEL });
      metal.push({ g: lathe([[0.0118, 0], [0.0118, 0.0035], [0.0108, 0.004], [0.0108, 0.0012]], 28), m: along(j.x, j.y, 0.0012), color: STEEL });
      dark.push({ g: new THREE.CircleGeometry(0.0108, 24), k: 0, m: place(j.x, j.y, out(0.0022), 0, Math.PI, 0) });
      metal.push({ g: new THREE.BoxGeometry(0.004, 0.003, 0.0026), m: place(j.x, j.y + 0.0128, out(0.0025)), color: STEEL });
      for (const s of [-1, 1]) metal.push({ g: screwHead(0.0014), m: place(j.x + s * 0.0098, j.y - s * 0.0122, out(0.0012), -Math.PI / 2, 0, 0), color: BLACKOX });
      break;
    }
    case 'usb': {
      metal.push({ g: new THREE.BoxGeometry(0.0125, 0.0115, 0.0035), m: place(j.x, j.y, out(0.0018)), color: NICKEL });
      dark.push({ g: new THREE.BoxGeometry(0.0095, 0.0085, 0.0002), k: 0, m: place(j.x, j.y, out(0.0036)) });
      dark.push({ g: new THREE.BoxGeometry(0.0055, 0.004, 0.0028), k: 6, m: place(j.x, j.y, out(0.0024)) });
      break;
    }
    case 'lan': {
      metal.push({ g: new THREE.BoxGeometry(0.0165, 0.0145, 0.003), m: place(j.x, j.y, out(0.0015)), color: NICKEL });
      dark.push({ g: new THREE.BoxGeometry(0.0125, 0.0105, 0.0002), k: 0, m: place(j.x, j.y, out(0.0031)) });
      break;
    }
    case 'iec': {
      // the moulded inlet, chamfered across the top, recessed into the panel
      const s = new THREE.Shape([new THREE.Vector2(-0.0145, -0.011), new THREE.Vector2(0.0145, -0.011), new THREE.Vector2(0.0145, 0.005), new THREE.Vector2(0.0085, 0.011), new THREE.Vector2(-0.0085, 0.011), new THREE.Vector2(-0.0145, 0.005)]);
      const frame = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelSize: 0.0008, bevelThickness: 0.0008, bevelSegments: 1 });
      dark.push({ g: frame, k: 1, m: place(j.x, j.y, out(0.0038), 0, Math.PI, 0) });
      for (const dx of [-0.004, 0, 0.004]) metal.push({ g: new THREE.BoxGeometry(0.0012, 0.0035, 0.004), m: place(j.x + dx, j.y + (dx === 0 ? 0.003 : -0.002), out(0.003)), color: NICKEL });
      break;
    }
  }
}

/** how far a plugged connector sticks out of the panel (where its cable leaves) */
export function plugLength(kind: JackKind): number {
  return kind === 'rca' ? 0.038 : kind === 'xlr' ? 0.052 : kind === 'iec' ? 0.045 : kind === 'usb' ? 0.032 : kind === 'gnd' ? 0.012 : 0.04;
}

/** a cable's radius for a connector type */
export function cableRadius(kind: JackKind): number {
  return kind === 'iec' ? 0.0036 : kind === 'xlr' ? 0.003 : kind === 'gnd' ? 0.0011 : kind === 'usb' ? 0.0024 : 0.0021;
}

/**
 * A plug in a socket at (x, y, zp), body along −z, as metal pieces (shells,
 * knurling) and moulded pieces (bodies, colour bands, strain reliefs) for the
 * board's cable mesh. Returns where the cable leaves the plug.
 */
export function plug(j: Jack, x: number, y: number, zp: number, metal: Piece[], moulded: Piece[]): THREE.Vector3 {
  const along = (dz: number) => place(x, y, zp - dz, -Math.PI / 2, 0, 0);
  const L = plugLength(j.kind);
  const black = '#111113';
  switch (j.kind) {
    case 'rca': {
      // knurled metal shell over the socket, then the moulded body with its colour band
      metal.push({ g: lathe([[0.0049, 0], ...grooves(0.0051, 0.0006, 0.0085, 7, 0.0003), [0.0051, 0.011], [0.0047, 0.0118]], 14), m: along(0.0006), color: NICKEL });
      moulded.push({ g: lathe([[0.0047, 0], [0.0052, 0.001], [0.0052, 0.016], [0.0046, 0.018], [0.0032, 0.0245], [0.0024, 0.026]], 18), m: along(0.012), color: black });
      moulded.push({ g: lathe([[0.00525, 0], [0.00525, 0.003]], 18), m: along(0.015), color: j.insert === RED ? RED : j.insert === ORANGE ? ORANGE : '#cfcfca' });
      break;
    }
    case 'xlr': {
      metal.push({ g: lathe([[0.0098, 0], [0.0102, 0.001], ...grooves(0.0102, 0.003, 0.016, 6, 0.0004), [0.0102, 0.024], [0.0094, 0.026]], 24), m: along(0.004), color: STEEL });
      moulded.push({ g: lathe([[0.0094, 0], [0.0092, 0.004], [0.0058, 0.016], [0.0038, 0.022]], 24), m: along(0.03), color: black });
      // the latch release
      metal.push({ g: new THREE.BoxGeometry(0.004, 0.0024, 0.007), m: place(x, y + 0.0103, zp - 0.008), color: STEEL });
      break;
    }
    case 'iec': {
      const body = new RoundedBoxGeometry(0.031, 0.024, 0.03, 2, 0.003);
      moulded.push({ g: body, m: place(x, y, zp - 0.003 - 0.015), color: black });
      moulded.push({ g: lathe([[0.0062, 0], [0.0058, 0.006], [0.0042, 0.013]], 16), m: along(0.033), color: black });
      // grip ridges along the body's sides
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) moulded.push({ g: new THREE.BoxGeometry(0.0012, 0.018, 0.0015), m: place(x + s * 0.0158, y, zp - 0.008 - i * 0.004), color: '#1c1c1f' });
      break;
    }
    case 'usb': {
      metal.push({ g: new THREE.BoxGeometry(0.0118, 0.0108, 0.007), m: place(x, y, zp - 0.0035), color: NICKEL });
      moulded.push({ g: new RoundedBoxGeometry(0.0155, 0.0135, 0.018, 2, 0.002), m: place(x, y, zp - 0.016), color: black });
      moulded.push({ g: lathe([[0.004, 0], [0.0036, 0.004], [0.0028, 0.008]], 14), m: along(0.025), color: black });
      break;
    }
    case 'gnd': {
      // a spade lug under the nut, the thin green-yellow wire leaving it
      metal.push({ g: new THREE.BoxGeometry(0.004, 0.0035, 0.0008), m: place(x, y - 0.0055, zp - 0.0046), color: GOLD });
      return new THREE.Vector3(x, y - 0.008, zp - 0.006);
    }
    default: {
      metal.push({ g: lathe([[0.004, 0], [0.004, 0.012]], 16), m: along(0), color: NICKEL });
      moulded.push({ g: lathe([[0.0055, 0], [0.0055, 0.02], [0.0035, 0.026]], 16), m: along(0.012), color: black });
    }
  }
  return new THREE.Vector3(x, y, zp - L);
}

/* ------------------------------------------------------------------ */
/* a unit's rear and underside                                          */
/* ------------------------------------------------------------------ */

export interface UnitHardwareSpec {
  w: number;
  d: number;
  h: number;
  radius: number;
  body: string;
  jacks: Jack[];
  /** screws in the faceplate's corners (mixers and players have them; turntable plinths don't) */
  topScrews: boolean;
  model: string;
  seed: number;
}

let metalMat: THREE.MeshStandardMaterial | null = null;

/** bright metal coloured per vertex (nickel, gold, steel, black oxide): screws, shells, pins */
export function hardwareMetal(): THREE.MeshStandardMaterial {
  return (metalMat ??= new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.3 }));
}

/**
 * The detail a unit's body carries: rubber feet, screws, the rear panel's
 * print and connectors. Two meshes: `dark` (the printed panel + every dark
 * plastic and rubber part) and `metal`.
 */
export function unitHardware(s: UnitHardwareSpec): { dark: THREE.Mesh; metal: THREE.Mesh } {
  const pw = s.w - 2 * s.radius - 0.002;
  const ph = s.h - 2 * s.radius - 0.002;
  const y0 = s.radius + 0.001;
  const zp = -s.d / 2 - 0.0004;
  const art = paintPanel(s.body, pw, ph, y0, s.jacks, s.model, s.seed);
  const metal: Piece[] = [];
  const dark: { g: THREE.BufferGeometry; k: Swatch; m: THREE.Matrix4 }[] = [];
  // the panel itself, facing the back
  const panel = new THREE.PlaneGeometry(pw, ph);
  const uv = panel.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, STRIP / art.H + uv.getY(i) * (1 - STRIP / art.H));
  panel.applyMatrix4(place(0, y0 + ph / 2, zp, 0, Math.PI, 0));
  for (const j of s.jacks) socket(j, zp, metal, dark);
  // rubber feet: a soft dome under each corner
  const foot = lathe([[0, -0.006], [0.0075, -0.006], [0.009, -0.0045], [0.0093, -0.001], [0.0093, 0], [0, 0]], 20);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) dark.push({ g: foot, k: 1, m: place(sx * (s.w / 2 - 0.02), 0, sz * (s.d / 2 - 0.02)) });
  // screws: two along the top of the rear panel, and in the faceplate's corners
  const screw = screwHead(0.0021);
  for (const sx of [-1, 1]) metal.push({ g: screw, m: place(sx * (pw / 2 - 0.008), y0 + ph - 0.006, zp + 0.0002, -Math.PI / 2, 0, 0), color: BLACKOX });
  if (s.topScrews) {
    const inset = Math.max(0.0075, s.radius * 0.75);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) metal.push({ g: screw, m: place(sx * (s.w / 2 - inset), s.h + 0.0002, sz * (s.d / 2 - inset)), color: light(s.body) ? STEEL : BLACKOX });
  }
  const tex = new THREE.CanvasTexture(art.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const darkGeo = mergePieces([{ g: panel }, ...dark.map((p) => ({ g: onSwatch(p.g, p.k, art.W, art.H), m: p.m }))]);
  const darkMesh = new THREE.Mesh(darkGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.15 }));
  darkMesh.receiveShadow = true;
  const metalMesh = new THREE.Mesh(mergePieces(metal, true), hardwareMetal());
  return { dark: darkMesh, metal: metalMesh };
}

/* ------------------------------------------------------------------ */
/* cables                                                               */
/* ------------------------------------------------------------------ */

export interface CableEnd {
  jack: Jack;
  /** where the jack sits, in board space (desk top at y = 0) */
  at: THREE.Vector3;
}

export interface CableJob {
  from: CableEnd;
  /** the other end: a jack, or a grommet in the desk (board space) */
  to: CableEnd | THREE.Vector3;
  /** keep the run in front of this z while it crosses x (a laptop stand's legs behind the mixer) */
  lane?: number;
}

const tmpV = new THREE.Vector3();
/** the booth's desk top stands this far above the board's base (its feet sink a touch into the surface) */
const DESK = 0.0025;

/**
 * One cable's path: out of the plug, sagging to the desk under its own weight,
 * along the desk with a lazy meander, then into a grommet (down through the
 * desk) or up into another plug.
 */
function cablePath(a: THREE.Vector3, to: THREE.Vector3, into: THREE.Vector3 | null, r: number, rnd: () => number, lane?: number): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const floor = DESK + r + 0.0002 + rnd() * 0.0012;
  // stiff for the first centimetre out of the strain relief, then drooping
  pts.push(a.clone(), a.clone().add(tmpV.set(0, -0.0015, -0.012)));
  const drop = a.y;
  const touchZ = lane !== undefined ? Math.max(lane, a.z - 0.03) : a.z - 0.035 - drop * 0.9;
  pts.push(new THREE.Vector3(a.x + (rnd() - 0.5) * 0.01, floor + drop * 0.38, (a.z - 0.012 + touchZ) / 2 - 0.004));
  pts.push(new THREE.Vector3(a.x + (rnd() - 0.5) * 0.016, floor, touchZ));
  const end = into ?? to;
  const endTouch = into ? new THREE.Vector3(to.x, floor, lane !== undefined ? Math.max(lane, to.z - 0.03) : to.z - 0.035 - to.y * 0.9) : new THREE.Vector3(to.x + (rnd() - 0.5) * 0.01, floor, to.z + 0.04);
  const start = pts[pts.length - 1];
  // along the desk: a couple of slack bends
  const n = Math.max(1, Math.min(4, Math.round(start.distanceTo(endTouch) / 0.12)));
  const dir = endTouch.clone().sub(start);
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const p = start.clone().lerp(endTouch, t).addScaledVector(side, (rnd() - 0.5) * 0.03);
    if (lane !== undefined) p.z = Math.max(lane, Math.min(p.z, lane + 0.006));
    p.y = floor;
    pts.push(p);
  }
  pts.push(endTouch);
  if (into) {
    // up into the other plug
    pts.push(new THREE.Vector3(to.x, floor + to.y * 0.38, (endTouch.z + to.z - 0.012) / 2 - 0.004), to.clone().add(tmpV.set(0, -0.0015, -0.012)), to.clone());
  } else {
    // down through the grommet
    pts.push(new THREE.Vector3(end.x + (rnd() - 0.5) * 0.012, DESK - 0.003, end.z + (rnd() - 0.5) * 0.012), new THREE.Vector3(end.x, -0.05, end.z));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

/** a rubber-lipped cable grommet set into the desk, centred on (x, z) */
function grommet(x: number, z: number, moulded: Piece[]): void {
  // up the outside, in over the lip, down the bore (the lathe faces outward along this path)
  moulded.push({ g: lathe([[0.0265, DESK - 0.0004], [0.0265, DESK + 0.0004], [0.024, DESK + 0.0011], [0.0175, DESK + 0.0008], [0.0175, DESK - 0.006]], 32), m: place(x, 0, z), color: '#141416' });
  moulded.push({ g: new THREE.CircleGeometry(0.0176, 24), m: place(x, DESK - 0.0035, z, -Math.PI / 2, 0, 0), color: '#030303' });
}

/**
 * Plug every patched jack and lay its cable. Returns the board's two cable
 * meshes (moulded + metal), grouped so callers can leave them out of the
 * board's framing.
 */
export function layCables(jobs: CableJob[], grommets: THREE.Vector2[], seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cables';
  if (!jobs.length) return group;
  let a = seed | 1;
  const rnd = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
  const metal: Piece[] = [];
  const moulded: Piece[] = [];
  for (const gm of grommets) grommet(gm.x, gm.y, moulded);
  for (const job of jobs) {
    const f = job.from;
    const tail = plug(f.jack, f.at.x, f.at.y, f.at.z, metal, moulded);
    const r = cableRadius(f.jack.kind);
    let curve: THREE.CatmullRomCurve3;
    if (job.to instanceof THREE.Vector3) curve = cablePath(tail, job.to, null, r, rnd, job.lane);
    else {
      const t = job.to;
      const tail2 = plug(t.jack, t.at.x, t.at.y, t.at.z, metal, moulded);
      curve = cablePath(tail, tail2, tail2, r, rnd, job.lane);
    }
    const len = curve.getLength();
    const color = f.jack.kind === 'gnd' ? '#3f7a3a' : f.jack.cable ?? '#101012';
    moulded.push({ g: new THREE.TubeGeometry(curve, Math.max(16, Math.round(len / 0.012)), r, f.jack.kind === 'gnd' ? 5 : 8), color });
  }
  const cableMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0 });
  const cables = new THREE.Mesh(mergePieces(moulded, true), cableMat);
  cables.castShadow = true;
  cables.receiveShadow = true;
  const shells = new THREE.Mesh(mergePieces(metal, true), hardwareMetal());
  group.add(cables, shells);
  return group;
}
