/*
 * Set dressing: everything that makes a room look lived in and wired up,
 * rather than built for the shot. A Dresser collects pieces into merged
 * meshes (plain colours share four materials with the colour per vertex, so
 * a whole venue's ducts, cases, doors and rails come to a handful of draw
 * calls), plus a few instanced extras, and animates its own lights (rack
 * LEDs on the kick, neon that hums and sometimes stutters, warm bulbs that
 * breathe).
 *
 *   overhead   ducts with hangers, cable trays, sprinkler pipe, conduit,
 *              cables slung between points
 *   walls      fire extinguishers, call points, breaker panels, caged bulkhead
 *              lamps, fire doors with push bars, flyer walls, neon words,
 *              wall speakers, vents
 *   floor      road cases, amp racks, monitor wedges, hazers, cable ramps,
 *              pallets, crowd barriers, poseur tables and stools, plants,
 *              litter (cups and cans, instanced) and the floor's own wear
 *              (scuffs, spills, gaffer tape) as one decal
 *   production a front-of-house desk with lit screens, light masts
 *   outdoors   street lamps, palms, umbrellas, loungers, torches, patio
 *              heaters, AC units, tanks, life rings, flags, food trucks,
 *              portable toilets, chain-link fence, benches, bins
 *
 * Every flyer and sign is a made-up night or a generic word: no real
 * brands, promoters or artists.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bevelBox } from '../bevel';
import { exitSign } from './details';
import type { Fixture } from './fixtures';
import type { ShowState } from './show';
import { canvasTexture, grilleTexture, rng } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

export type MatKey =
  | 'steel'
  | 'galv'
  | 'blackMetal'
  | 'black'
  | 'alu'
  | 'red'
  | 'rubber'
  | 'yellow'
  | 'grey'
  | 'wood'
  | 'darkWood'
  | 'white'
  | 'cream'
  | 'duct'
  | 'case'
  | 'green'
  | 'canvas'
  | 'terracotta'
  | 'leaf'
  | 'trunk'
  | 'sand'
  | 'blue'
  | 'trackway'
  | 'straw'
  | 'foliage'
  | 'stone'
  | 'cloth'
  | 'rust';

const MATS: Record<MatKey, () => THREE.Material> = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0x80858c, metalness: 0.8, roughness: 0.38 }),
  galv: () => new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.65, roughness: 0.5 }),
  blackMetal: () => new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.55, roughness: 0.45 }),
  black: () => new THREE.MeshStandardMaterial({ color: 0x0d0d0f, metalness: 0.05, roughness: 0.8 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.9, roughness: 0.3 }),
  red: () => new THREE.MeshStandardMaterial({ color: 0xb0101a, metalness: 0.2, roughness: 0.38 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x101011, metalness: 0, roughness: 0.92 }),
  yellow: () => new THREE.MeshStandardMaterial({ color: 0xd6a312, metalness: 0.05, roughness: 0.6 }),
  grey: () => new THREE.MeshStandardMaterial({ color: 0x5b5f65, metalness: 0.3, roughness: 0.6 }),
  wood: () => new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.78 }),
  darkWood: () => new THREE.MeshStandardMaterial({ color: 0x3a2716, roughness: 0.7 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.75 }),
  cream: () => new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.8 }),
  duct: () => new THREE.MeshStandardMaterial({ color: 0xa6abb1, metalness: 0.85, roughness: 0.36 }),
  case: () => new THREE.MeshStandardMaterial({ color: 0x19191c, metalness: 0.1, roughness: 0.55 }),
  green: () => new THREE.MeshStandardMaterial({ color: 0x1f4d2b, roughness: 0.6 }),
  canvas: () => new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: 0.9, side: THREE.DoubleSide }),
  terracotta: () => new THREE.MeshStandardMaterial({ color: 0x9a4e2e, roughness: 0.85 }),
  leaf: () => new THREE.MeshStandardMaterial({ color: 0x2d5a2a, roughness: 0.8, side: THREE.DoubleSide }),
  trunk: () => new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 0.95 }),
  sand: () => new THREE.MeshStandardMaterial({ color: 0xcbb68e, roughness: 0.95 }),
  blue: () => new THREE.MeshStandardMaterial({ color: 0x1d4f8c, roughness: 0.55 }),
  trackway: () => new THREE.MeshStandardMaterial({ color: 0x2c312d, roughness: 0.85 }),
  straw: () => new THREE.MeshStandardMaterial({ color: 0xb08c48, roughness: 1 }),
  foliage: () => new THREE.MeshStandardMaterial({ color: 0x22381c, roughness: 0.9, flatShading: true }),
  stone: () => new THREE.MeshStandardMaterial({ color: 0x67635d, roughness: 0.95, flatShading: true }),
  cloth: () => new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.92, side: THREE.DoubleSide }),
  rust: () => new THREE.MeshStandardMaterial({ color: 0x4a3426, metalness: 0.45, roughness: 0.8 }),
};

/**
 * Plain-coloured pieces are drawn in one of four shared materials, their
 * colour carried per vertex, so a venue's whole dressing is a handful of
 * meshes rather than one per colour.
 */
type Family = 'metal' | 'matte' | 'cloth' | 'flat';
const FAMILY: Record<MatKey, Family> = {
  steel: 'metal',
  galv: 'metal',
  blackMetal: 'metal',
  alu: 'metal',
  duct: 'metal',
  black: 'matte',
  red: 'matte',
  rubber: 'matte',
  yellow: 'matte',
  grey: 'matte',
  wood: 'matte',
  darkWood: 'matte',
  white: 'matte',
  cream: 'matte',
  case: 'matte',
  green: 'matte',
  terracotta: 'matte',
  trunk: 'matte',
  sand: 'matte',
  blue: 'matte',
  trackway: 'matte',
  straw: 'matte',
  rust: 'matte',
  canvas: 'cloth',
  leaf: 'cloth',
  cloth: 'cloth',
  foliage: 'flat',
  stone: 'flat',
};
const FAMILIES: Record<Family, () => THREE.MeshStandardMaterial> = {
  metal: () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.72, roughness: 0.42 }),
  matte: () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.06, roughness: 0.76 }),
  cloth: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
  flat: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }),
};
const tints = new Map<MatKey, THREE.Color>();
/** a key's colour, in the working (linear) space vertex colours use */
function tint(k: MatKey): THREE.Color {
  let c = tints.get(k);
  if (!c) {
    const m = MATS[k]() as THREE.MeshStandardMaterial;
    tints.set(k, (c = m.color.clone()));
    m.dispose();
  }
  return c;
}

export type GlowMode = 'steady' | 'kick' | 'level' | 'flicker' | 'blink' | 'breathe' | 'flame' | 'palette';

interface Glow {
  mat: THREE.MeshBasicMaterial;
  base: THREE.Color;
  mode: GlowMode;
  phase: number;
  /** for 'palette': which show colour */
  slot: number;
}

/** move a geometry: rotate (Euler, radians) then translate */
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): THREE.BufferGeometry {
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')));
  return g.translate(x, y, z);
}

/** points along a hanging cable from a to b, sagging `sag` metres in the middle */
export function catenary(a: THREE.Vector3, b: THREE.Vector3, sag: number, n = 12): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* textures                                                             */
/* ------------------------------------------------------------------ */

const NIGHTS = ['LOW END', 'NIGHT SHIFT', 'PRESSURE', 'SUB RITUAL', 'DEEP END', 'AFTER DARK', 'FLOOR FILLER', 'NO SLEEP', 'BASSLINE', 'HEAT', 'RED LIGHT', 'WAREHOUSE 9', 'LATE NIGHT', 'SOUNDCLASH', 'GROOVE', 'DUSK TIL DAWN'];
const INK = ['#e9e2cf', '#ff2e88', '#ffb547', '#0e0e10', '#2ec4f1', '#d4ff3a', '#f2f2ee', '#7a3cff'];

/** eight made-up flyers on one texture (2 rows of 4), so a whole flyer wall is one material */
function posterAtlas(): THREE.CanvasTexture {
  return canvasTexture('dress-posters', 1024, 720, (g, w, h) => {
    const cw = w / 4;
    const ch = h / 2;
    for (let i = 0; i < 8; i++) {
      const r = rng(900 + i);
      const x = (i % 4) * cw;
      const y = Math.floor(i / 4) * ch;
      const bg = INK[i % INK.length];
      const fg = bg === '#0e0e10' || bg === '#7a3cff' ? '#f2f2ee' : '#0e0e10';
      g.fillStyle = bg;
      g.fillRect(x, y, cw, ch);
      // a graphic: rings, bars or a big dot
      g.save();
      g.beginPath();
      g.rect(x, y, cw, ch);
      g.clip();
      g.strokeStyle = fg;
      g.fillStyle = fg;
      g.globalAlpha = 0.85;
      const kind = i % 3;
      if (kind === 0) for (let k = 0; k < 7; k++) g.beginPath(), g.arc(x + cw / 2, y + ch * 0.36, 12 + k * 14, 0, Math.PI * 2), (g.lineWidth = 4), g.stroke();
      else if (kind === 1) for (let k = 0; k < 14; k++) g.fillRect(x + 14 + k * 16, y + ch * 0.12 + r() * 40, 8, ch * 0.3 * (0.4 + r() * 0.6));
      else g.beginPath(), g.arc(x + cw * (0.3 + r() * 0.4), y + ch * 0.34, 60 + r() * 30, 0, Math.PI * 2), g.fill();
      g.restore();
      g.globalAlpha = 1;
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.font = '800 40px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText(NIGHTS[(i * 3) % NIGHTS.length], x + cw / 2, y + ch * 0.72);
      g.font = '600 17px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillText(['FRIDAYS · 11–6', 'ALL NIGHT LONG', 'SAT · LATE', 'EVERY THURSDAY'][i % 4], x + cw / 2, y + ch * 0.82);
      g.font = '500 12px "Barlow", sans-serif';
      g.fillText('LIMITED CAPACITY · OVER 18s', x + cw / 2, y + ch * 0.9);
      // wear: specks and a fold
      g.globalAlpha = 0.25;
      for (let k = 0; k < 90; k++) g.fillRect(x + r() * cw, y + r() * ch, 2, 2);
      g.fillStyle = '#000000';
      g.fillRect(x, y + ch * (0.45 + r() * 0.1), cw, 2);
      g.globalAlpha = 1;
    }
  });
}

/** scuffs, old spills, gaffer tape and a drain: the floor after a few hundred nights */
function wearTexture(key: string, seed: number, tone: 'dark' | 'light'): THREE.CanvasTexture {
  return canvasTexture(`dress-wear:${key}`, 1024, 1024, (g, w, h) => {
    const r = rng(seed);
    g.clearRect(0, 0, w, h);
    const ink = tone === 'dark' ? '0,0,0' : '30,24,20';
    // spills: soft blotches
    for (let i = 0; i < 26; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 20 + r() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${ink},${0.18 + r() * 0.2})`);
      grad.addColorStop(1, `rgba(${ink},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // scuffs: short dark arcs
    g.lineCap = 'round';
    for (let i = 0; i < 220; i++) {
      g.strokeStyle = `rgba(${ink},${0.12 + r() * 0.2})`;
      g.lineWidth = 1 + r() * 3;
      const x = r() * w;
      const y = r() * h;
      g.beginPath();
      g.arc(x, y, 8 + r() * 30, r() * 6, r() * 6 + 0.4 + r());
      g.stroke();
    }
    // gaffer tape: marks and old cable runs
    for (let i = 0; i < 9; i++) {
      g.save();
      g.translate(r() * w, r() * h);
      g.rotate(r() * Math.PI);
      g.fillStyle = r() < 0.6 ? 'rgba(20,20,22,0.92)' : r() < 0.5 ? 'rgba(230,200,40,0.85)' : 'rgba(235,235,230,0.8)';
      const len = r() < 0.3 ? 400 + r() * 300 : 30 + r() * 50;
      g.fillRect(-len / 2, -9, len, 18);
      g.restore();
    }
    // glitter and confetti trodden in
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `hsla(${r() * 360},80%,${60 + r() * 30}%,${0.3 + r() * 0.4})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
    }
  });
}

/** trodden ground: mud, boot prints and loose straw */
function mudTexture(seed: number): THREE.CanvasTexture {
  return canvasTexture(`dress-mud:${seed}`, 512, 512, (g, w, h) => {
    const r = rng(seed);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 30 + r() * 80;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(48,34,20,${0.45 + r() * 0.3})`);
      grad.addColorStop(0.6, `rgba(52,38,22,${0.2 + r() * 0.15})`);
      grad.addColorStop(1, 'rgba(52,38,22,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y, rad, rad * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(26,18,10,${0.2 + r() * 0.25})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 2.5, 5, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(196,164,96,${0.35 + r() * 0.3})`;
      g.lineWidth = 1;
      const x = r() * w;
      const y = r() * h;
      const a = r() * Math.PI;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
      g.stroke();
    }
  });
}

/** a painted sign: a generic word (BAR, TOILETS, WATER), never a brand */
function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  return canvasTexture(`dress-sign:${text}:${bg}:${fg}`, 256, 96, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 64;
    g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    while (g.measureText(text).width > w - 36 && size > 20) g.font = `800 ${(size -= 4)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.fillText(text, w / 2, h / 2 + 3);
  });
}

/** a woven rug: a field, borders, a medallion, a scatter of motifs */
function rugTexture(seed: number): THREE.CanvasTexture {
  return canvasTexture(`dress-rug:${seed}`, 256, 384, (g, w, h) => {
    const r = rng(seed);
    const sets = [
      ['#7a1e22', '#1d2a4a', '#e2c79a', '#c8873a'],
      ['#1d2a4a', '#7a1e22', '#d8c8a0', '#3a6a6a'],
      ['#a8642a', '#3a1e1a', '#efe0bc', '#2a4a5a'],
      ['#2e4a3a', '#d8b878', '#efe6cc', '#7a2a2a'],
    ];
    const [field, band, light, accent] = sets[seed % sets.length];
    g.fillStyle = field;
    g.fillRect(0, 0, w, h);
    for (const [inset, col, lw] of [[10, band, 16], [30, light, 4], [40, accent, 6], [50, light, 2]] as [number, string, number][]) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    }
    // the medallion
    g.save();
    g.translate(w / 2, h / 2);
    for (const [s, col] of [[70, band], [52, light], [36, accent], [18, light]] as [number, string][]) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, -s * 1.4);
      g.lineTo(s, 0);
      g.lineTo(0, s * 1.4);
      g.lineTo(-s, 0);
      g.fill();
    }
    g.restore();
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() < 0.5 ? light : accent;
      const x = 62 + r() * (w - 124);
      const y = 62 + r() * (h - 124);
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    // wear
    for (let i = 0; i < 600; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
  });
}

/** pennant colours, one column each */
function pennantTexture(): THREE.CanvasTexture {
  return canvasTexture('dress-pennants', 96, 8, (g, w, h) => {
    ['#e8343a', '#ffd23f', '#2ec4f1', '#f2efe8', '#ff7ab6', '#3ddc97'].forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect((i * w) / 6, 0, w / 6, h);
    });
  });
}

/** a front-of-house console's screens: waveforms, meters, cue list */
function consoleTexture(): THREE.CanvasTexture {
  return canvasTexture('dress-console', 512, 128, (g, w, h) => {
    const r = rng(77);
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, w, h);
    for (let s = 0; s < 3; s++) {
      const x0 = 6 + s * (w / 3);
      const sw = w / 3 - 12;
      g.fillStyle = '#0b1220';
      g.fillRect(x0, 6, sw, h - 12);
      if (s === 1) {
        for (let i = 0; i < 24; i++) {
          const v = r();
          g.fillStyle = v > 0.85 ? '#ff4b3e' : v > 0.6 ? '#ffd23f' : '#3ddc97';
          g.fillRect(x0 + 6 + i * (sw / 24), h - 12 - v * (h - 30), sw / 24 - 2, v * (h - 30));
        }
      } else {
        g.fillStyle = s === 0 ? '#2ec4f1' : '#ff5fcf';
        for (let row = 0; row < 7; row++) {
          g.globalAlpha = row === 2 ? 1 : 0.55;
          g.fillRect(x0 + 6, 14 + row * 15, sw * (0.3 + r() * 0.6), 8);
        }
        g.globalAlpha = 1;
      }
    }
  });
}

/** chain-link, see-through */
function chainLinkTexture(): THREE.CanvasTexture {
  const t = canvasTexture(
    'dress-chainlink',
    128,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(200,205,210,1)';
      g.lineWidth = 3;
      for (let i = -2; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 64, 0);
        g.lineTo(i * 64 + 128, h);
        g.moveTo(i * 64 + 128, 0);
        g.lineTo(i * 64, h);
        g.stroke();
      }
    },
    { repeat: true },
  );
  return t;
}

/** a word in neon tubes on black, for an additive sign */
function neonTexture(text: string, color: string): THREE.CanvasTexture {
  return canvasTexture(`dress-neon:${text}:${color}`, 512, 160, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.font = '700 92px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.shadowColor = color;
    for (const [blur, lw, a] of [
      [28, 10, 0.5],
      [12, 7, 0.8],
      [0, 3, 1],
    ] as [number, number, number][]) {
      g.shadowBlur = blur;
      g.globalAlpha = a;
      g.strokeStyle = blur ? color : '#ffffff';
      g.lineWidth = lw;
      g.strokeText(text, w / 2, h / 2 + 4);
    }
  });
}

const TAGS = ['BASS', 'RAVE', 'LOVE', 'NO SLEEP', 'DANCE', 'LOUD', 'UNITY', 'FREE', 'PLUR', 'HEAT', 'GROOVE', 'ONE LOVE'];

/** spray paint on a wall: bubble letters with outlines and drips, generic words */
function graffitiTexture(seed: number): THREE.CanvasTexture {
  return canvasTexture(`dress-graffiti:${seed}`, 1024, 384, (g, w, h) => {
    const r = rng(seed);
    g.clearRect(0, 0, w, h);
    for (let k = 0; k < 3; k++) {
      const word = TAGS[Math.floor(r() * TAGS.length)];
      const x = w * (0.15 + k * 0.33 + (r() - 0.5) * 0.08);
      const y = h * (0.45 + (r() - 0.5) * 0.3);
      const size = 90 + r() * 60;
      const fill = `hsl(${Math.floor(r() * 360)},${70 + r() * 25}%,${50 + r() * 15}%)`;
      g.save();
      g.translate(x, y);
      g.rotate((r() - 0.5) * 0.25);
      g.font = `900 ${size}px "Barlow Condensed", "Arial Black", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.strokeStyle = '#0b0b0d';
      g.lineWidth = 18;
      g.strokeText(word, 0, 0);
      g.fillStyle = fill;
      g.fillText(word, 0, 0);
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.lineWidth = 3;
      g.strokeText(word, -3, -3);
      // drips
      g.fillStyle = fill;
      for (let i = 0; i < 6; i++) g.fillRect((r() - 0.5) * size * 1.6, size * 0.3, 4, 20 + r() * 60);
      g.restore();
    }
    // overspray specks
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(${Math.floor(r() * 255)},${Math.floor(r() * 255)},${Math.floor(r() * 255)},0.25)`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
  });
}

/** a food truck's lit menu board */
function menuTexture(seed: number): THREE.CanvasTexture {
  return canvasTexture(`dress-menu:${seed}`, 256, 128, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = ['#1b1b1d', '#24120c', '#0c1a24'][seed % 3];
    g.fillRect(0, 0, w, h);
    g.fillStyle = ['#ffd23f', '#ff7a3c', '#7ef3ff'][seed % 3];
    g.font = '800 30px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText(['STREET FOOD', 'WOOD FIRED', 'TACOS & MORE'][seed % 3], w / 2, 34);
    g.font = '600 15px "Barlow", sans-serif';
    g.textAlign = 'left';
    g.fillStyle = '#f2f2ee';
    for (let i = 0; i < 4; i++) {
      g.fillText(['Loaded fries', 'Grilled wrap', 'Veggie box', 'Cold drinks', 'Hot dog', 'Noodles'][(i + seed) % 6], 18, 62 + i * 17);
      g.textAlign = 'right';
      g.fillText(`${6 + Math.floor(r() * 6)}.${r() < 0.5 ? '00' : '50'}`, w - 18, 62 + i * 17);
      g.textAlign = 'left';
    }
  });
}

/* ------------------------------------------------------------------ */
/* the dresser                                                          */
/* ------------------------------------------------------------------ */

export class Dresser implements Fixture {
  readonly object = new THREE.Group();
  readonly r: () => number;
  private bins = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private mats = new Map<string, THREE.Material>();
  private family = new Set<THREE.Material>();
  private glows: Glow[] = [];
  private glowCache = new Map<string, THREE.MeshBasicMaterial>();
  private t = 0;
  private extras: THREE.Object3D[] = [];

  constructor(seed = 1) {
    this.r = rng(seed);
  }

  /** the shared material a key is drawn with (its family's) */
  mat(k: MatKey): THREE.Material {
    const f = FAMILY[k];
    let m = this.mats.get(`family:${f}`);
    if (!m) {
      this.mats.set(`family:${f}`, (m = FAMILIES[f]()));
      this.family.add(m);
    }
    return m;
  }

  /** a geometry already in place, in material k (a plain colour, or a material of its own) */
  put(k: MatKey | THREE.Material, g: THREE.BufferGeometry): void {
    const m = typeof k === 'string' ? this.mat(k) : k;
    if (typeof k === 'string') g.userData.tint = tint(k);
    let list = this.bins.get(m);
    if (!list) this.bins.set(m, (list = []));
    list.push(g);
  }

  box(k: MatKey | THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): void {
    this.put(k, place(bevelBox(w, h, d), x, y, z, ry, rx, rz));
  }

  /** a cylinder (or pipe) from a to b */
  rod(k: MatKey | THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8): void {
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
    const m = a.clone().add(b).multiplyScalar(0.5);
    this.put(k, g.translate(m.x, m.y, m.z));
  }

  /** a tube along points (cables, rails) */
  tube(k: MatKey | THREE.Material, pts: THREE.Vector3[], r: number, seg = 6): void {
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts);
    this.put(k, new THREE.TubeGeometry(curve, Math.max(4, pts.length * 3), r, seg, false));
  }

  /** a light that the show animates: a basic, untonemapped material */
  glow(color: THREE.ColorRepresentation, mode: GlowMode = 'steady', gain = 1.6, slot = 0, map?: THREE.Texture): THREE.MeshBasicMaterial {
    // lights of one kind share a material (one draw call for all of them); the
    // ones that pulse on their own time get one of four phases so they don't pulse together
    const phased = mode === 'blink' || mode === 'breathe' || mode === 'flicker' || mode === 'flame';
    const bucket = phased ? Math.floor(this.r() * 4) : 0;
    const key = `${new THREE.Color(color).getHexString()}|${mode}|${gain}|${slot}|${map?.uuid ?? ''}|${bucket}`;
    const had = this.glowCache.get(key);
    if (had) return had;
    const base = new THREE.Color(color).multiplyScalar(gain);
    const mat = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false, map: map ?? null });
    this.glows.push({ mat, base, mode, phase: bucket * 1.9 + 0.4, slot });
    this.glowCache.set(key, mat);
    return mat;
  }

  /** an object to add as it is (instanced meshes, transparent planes) */
  extra(o: THREE.Object3D): void {
    this.extras.push(o);
  }

  /* ---------------- overhead ---------------- */

  /** a round duct from a to b, ribbed every half metre, hung from `ceil` (galvanised unless `k` says otherwise) */
  duct(a: THREE.Vector3, b: THREE.Vector3, r: number, ceil: number, k: MatKey = 'duct'): void {
    this.rod(k, a, b, r, 16);
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    for (let s = 0.25; s < len; s += 0.5) {
      const p = a.clone().addScaledVector(dir, s);
      const g = new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.025, 16, 1, true).applyQuaternion(q);
      this.put(k, g.translate(p.x, p.y, p.z));
    }
    for (let s = 0.6; s < len; s += 2.4) {
      const p = a.clone().addScaledVector(dir, s);
      if (ceil > p.y + r) {
        this.rod('blackMetal', V(p.x, p.y + r, p.z), V(p.x, ceil, p.z), 0.008, 4);
        // a strap round the duct
        const g = new THREE.TorusGeometry(r * 1.05, 0.008, 4, 16, Math.PI).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
        this.put('blackMetal', g.translate(p.x, p.y, p.z));
      }
    }
    // a vent grille now and then, facing down
    for (let s = 1.5; s < len - 0.5; s += 4.5) {
      const p = a.clone().addScaledVector(dir, s);
      this.box('blackMetal', 0.3, 0.02, 0.3, p.x, p.y - r * 0.92, p.z);
    }
  }

  /** a ladder cable tray from a to b (level), with cables in it, hung from `ceil` */
  tray(a: THREE.Vector3, b: THREE.Vector3, ceil: number, w = 0.3): void {
    const dir = b.clone().sub(a).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(w / 2);
    for (const s of [1, -1]) this.rod('galv', a.clone().addScaledVector(side, s), b.clone().addScaledVector(side, s), 0.012, 4);
    const len = a.distanceTo(b);
    for (let t = 0; t <= len; t += 0.3) {
      const p = a.clone().addScaledVector(dir, t);
      this.rod('galv', p.clone().add(side), p.clone().sub(side), 0.006, 4);
    }
    for (let i = 0; i < 4; i++) {
      const o = side.clone().multiplyScalar(-0.7 + i * 0.45);
      this.rod('rubber', a.clone().add(o).setY(a.y + 0.018), b.clone().add(o).setY(b.y + 0.018), 0.012 + (i % 2) * 0.006, 5);
    }
    for (let t = 0.4; t < len; t += 2) {
      const p = a.clone().addScaledVector(dir, t);
      for (const s of [1, -1]) this.rod('galv', p.clone().addScaledVector(side, s), p.clone().addScaledVector(side, s).setY(ceil), 0.006, 4);
    }
  }

  /** a sprinkler main with drop heads */
  sprinkler(a: THREE.Vector3, b: THREE.Vector3, ceil: number): void {
    this.rod('red', a, b, 0.03, 8);
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    for (let t = 1; t < len; t += 3) {
      const p = a.clone().addScaledVector(dir, t);
      this.rod('red', p, p.clone().setY(p.y - 0.18), 0.012, 6);
      this.box('alu', 0.05, 0.02, 0.05, p.x, p.y - 0.19, p.z);
      if (ceil > p.y) this.rod('blackMetal', p, p.clone().setY(ceil), 0.006, 4);
    }
  }

  /** conduit along points, with a junction box at every corner */
  conduit(pts: THREE.Vector3[], r = 0.012): void {
    for (let i = 0; i < pts.length - 1; i++) this.rod('galv', pts[i], pts[i + 1], r, 6);
    for (let i = 1; i < pts.length - 1; i++) this.box('grey', 0.09, 0.09, 0.05, pts[i].x, pts[i].y, pts[i].z);
  }

  /** a cable slung from a to b */
  cable(a: THREE.Vector3, b: THREE.Vector3, sag: number, r = 0.01): void {
    this.tube('rubber', catenary(a, b, sag), r, 5);
  }

  /* ---------------- walls (each faces +Z before `yaw`) ---------------- */

  /** extinguisher on a bracket, with its sign above */
  extinguisher(pos: THREE.Vector3, yaw = 0): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const at = (g: THREE.BufferGeometry) => g.applyMatrix4(m);
    this.put('red', at(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 12).translate(0, 0.25, 0.1)));
    this.put('red', at(new THREE.SphereGeometry(0.075, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.5, 0.1)));
    this.put('black', at(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 8).translate(0, 0.58, 0.1)));
    this.put('black', at(new THREE.TorusGeometry(0.09, 0.01, 4, 10, Math.PI).rotateZ(-Math.PI / 2).translate(0.06, 0.45, 0.12)));
    this.put('blackMetal', at(bevelBox(0.12, 0.05, 0.08).translate(0, 0.4, 0.03)));
    this.put('red', at(bevelBox(0.2, 0.2, 0.01).translate(0, 0.9, 0.005)));
    this.put('white', at(bevelBox(0.07, 0.12, 0.012).translate(0, 0.9, 0.006)));
  }

  /** fire alarm call point */
  callPoint(pos: THREE.Vector3, yaw = 0): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('red', bevelBox(0.1, 0.1, 0.05).translate(0, 0, 0.025).applyMatrix4(m));
    this.put('white', bevelBox(0.06, 0.06, 0.01).translate(0, 0, 0.051).applyMatrix4(m));
  }

  /** a grey electrical panel with conduit running up to `ceil` */
  panel(pos: THREE.Vector3, yaw: number, w = 0.6, h = 0.8, ceil?: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('grey', bevelBox(w, h, 0.18).translate(0, h / 2, 0.09).applyMatrix4(m));
    this.put('blackMetal', bevelBox(0.03, 0.12, 0.03).translate(w / 2 - 0.06, h / 2, 0.19).applyMatrix4(m));
    this.put('yellow', bevelBox(0.12, 0.1, 0.005).translate(0, h * 0.78, 0.182).applyMatrix4(m));
    if (ceil !== undefined) {
      for (let i = 0; i < 3; i++) {
        const x = -w / 3 + (i * w) / 3;
        const a = V(x, h, 0.06).applyMatrix4(m);
        this.rod('galv', a, a.clone().setY(ceil), 0.014, 6);
      }
    }
  }

  /** a caged bulkhead lamp, warm */
  bulkhead(pos: THREE.Vector3, yaw = 0, warm: THREE.MeshBasicMaterial): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('blackMetal', bevelBox(0.26, 0.16, 0.04).translate(0, 0, 0.02).applyMatrix4(m));
    this.put(warm, new THREE.SphereGeometry(0.07, 10, 6).scale(1.4, 0.8, 0.6).translate(0, 0, 0.06).applyMatrix4(m));
    for (let i = -1; i <= 1; i++) this.put('blackMetal', bevelBox(0.008, 0.13, 0.008).translate(i * 0.06, 0, 0.11).applyMatrix4(m));
    this.put('blackMetal', bevelBox(0.2, 0.008, 0.008).translate(0, 0, 0.115).applyMatrix4(m));
  }

  /** double fire doors with push bars, a kick plate, a little window and the exit sign over them */
  fireDoor(pos: THREE.Vector3, yaw: number, w = 1.6, h = 2.15, sign = true): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const at = (g: THREE.BufferGeometry) => this.put('blackMetal', g.applyMatrix4(m));
    at(bevelBox(0.08, h + 0.06, 0.12).translate(-w / 2 - 0.04, h / 2, 0.03));
    at(bevelBox(0.08, h + 0.06, 0.12).translate(w / 2 + 0.04, h / 2, 0.03));
    at(bevelBox(w + 0.16, 0.08, 0.12).translate(0, h + 0.04, 0.03));
    for (const s of [-1, 1]) {
      this.put('grey', bevelBox(w / 2 - 0.01, h, 0.05).translate((s * w) / 4, h / 2, 0.02).applyMatrix4(m));
      this.put('alu', bevelBox(w / 2 - 0.16, 0.05, 0.05).translate((s * w) / 4, 1.0, 0.07).applyMatrix4(m));
      this.put('alu', bevelBox(w / 2 - 0.08, 0.25, 0.006).translate((s * w) / 4, 0.14, 0.047).applyMatrix4(m));
      this.put('black', bevelBox(0.16, 0.5, 0.006).translate((s * w) / 4, 1.55, 0.047).applyMatrix4(m));
    }
    if (sign) this.extra(exitSign(V(0, h + 0.32, 0.04).applyMatrix4(m), yaw));
  }

  /** a cluster of flyers pasted over each other, w × h, at `pos` (centre) */
  posters(pos: THREE.Vector3, yaw: number, w: number, h: number, n = 10): void {
    const atlas = posterAtlas();
    let mat = this.mats.get('posters') as THREE.MeshStandardMaterial | undefined;
    if (!mat) this.mats.set('posters', (mat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.92 })));
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (let i = 0; i < n; i++) {
      const pw = 0.42 + this.r() * 0.12;
      const ph = pw * 1.4;
      const g = new THREE.PlaneGeometry(pw, ph);
      const k = Math.floor(this.r() * 8);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      // the atlas is 4 across, 2 down; row 0 is the top half
      const col = k % 4;
      const row = Math.floor(k / 4);
      for (let j = 0; j < uv.count; j++) uv.setXY(j, (col + uv.getX(j)) / 4, (uv.getY(j) + 1 - row) / 2);
      g.rotateZ((this.r() - 0.5) * 0.08);
      g.translate((this.r() - 0.5) * (w - pw), (this.r() - 0.5) * (h - ph), 0.004 + i * 0.0015);
      this.put(mat, g.applyMatrix4(m));
    }
  }

  /** spray paint across a wall, w × h, facing +Z after `yaw` */
  graffiti(pos: THREE.Vector3, yaw: number, w: number, h: number, seed: number): void {
    const mat = new THREE.MeshStandardMaterial({ map: graffitiTexture(seed), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    plane.position.copy(pos);
    plane.rotation.y = yaw;
    this.extra(plane);
  }

  /** a high-bay lamp hanging from the roof on a chain: a shade and a dim glow */
  highBay(pos: THREE.Vector3, drop: number, glow: THREE.MeshBasicMaterial): void {
    this.rod('blackMetal', pos, pos.clone().setY(pos.y - drop), 0.008, 4);
    const y = pos.y - drop;
    this.put('blackMetal', new THREE.ConeGeometry(0.32, 0.3, 14, 1, true).translate(pos.x, y - 0.12, pos.z));
    this.put(glow, new THREE.CircleGeometry(0.22, 14).rotateX(Math.PI / 2).translate(pos.x, y - 0.25, pos.z));
  }

  /** a word in neon on the wall, facing +Z after `yaw`, h metres tall */
  neon(text: string, color: string, pos: THREE.Vector3, yaw: number, h = 0.4, mode: GlowMode = 'flicker'): void {
    const mat = this.glow('#ffffff', mode, 1.4, 0, neonTexture(text, color));
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(h * 3.2, h), mat);
    plane.position.copy(pos);
    plane.rotation.y = yaw;
    this.extra(plane);
  }

  /** a small wall speaker on a bracket, angled down at the floor */
  wallSpeaker(pos: THREE.Vector3, yaw: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('black', bevelBox(0.32, 0.5, 0.28).rotateX(0.3).translate(0, 0, 0.2).applyMatrix4(m));
    this.put('blackMetal', bevelBox(0.05, 0.05, 0.2).translate(0, 0, 0.06).applyMatrix4(m));
  }

  /** an old pipe from a to b with flanges every two metres */
  pipe(a: THREE.Vector3, b: THREE.Vector3, r: number, k: MatKey = 'rust'): void {
    this.rod(k, a, b, r, 12);
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    for (let t = 1; t < len; t += 2) {
      const p = a.clone().addScaledVector(dir, t);
      this.put(k, new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.05, 12).applyQuaternion(q).translate(p.x, p.y, p.z));
    }
  }

  /** a valve wheel facing +Z after `yaw`, on a short stem */
  valve(pos: THREE.Vector3, yaw: number, r = 0.18): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('red', new THREE.TorusGeometry(r, r * 0.12, 6, 18).translate(0, 0, 0.12).applyMatrix4(m));
    for (let i = 0; i < 4; i++) this.put('red', bevelBox(r * 2, r * 0.12, r * 0.12).rotateZ((i * Math.PI) / 4).translate(0, 0, 0.12).applyMatrix4(m));
    this.put('rust', new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8).rotateX(Math.PI / 2).translate(0, 0, 0.05).applyMatrix4(m));
  }

  /** a round pressure gauge facing +Z after `yaw` */
  gauge(pos: THREE.Vector3, yaw: number, r = 0.1): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('rust', new THREE.CylinderGeometry(r, r, 0.05, 16).rotateX(Math.PI / 2).translate(0, 0, 0.03).applyMatrix4(m));
    this.put('cream', new THREE.CircleGeometry(r * 0.85, 16).translate(0, 0, 0.056).applyMatrix4(m));
    this.put('black', bevelBox(r * 0.7, 0.008, 0.004).rotateZ(0.7).translate(r * 0.2, r * 0.15, 0.06).applyMatrix4(m));
  }

  /** a row of old control cabinets facing +Z after `yaw`, dials and a few lamps still lit */
  cabinets(pos: THREE.Vector3, yaw: number, n = 4): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const green = this.glow('#3ddc97', 'level', 1.3);
    const red = this.glow('#ff3b3e', 'blink', 1.4);
    const amber = this.glow('#ffb547', 'kick', 1.3);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.82;
      this.put('grey', bevelBox(0.8, 2.2, 0.6).translate(x, 1.1, 0).applyMatrix4(m));
      this.put('blackMetal', bevelBox(0.01, 2.0, 0.005).translate(x, 1.1, 0.302).applyMatrix4(m));
      this.put('blackMetal', bevelBox(0.03, 0.14, 0.03).translate(x + 0.08, 1.1, 0.31).applyMatrix4(m));
      for (let k = 0; k < 2; k++) this.gauge(V(x - 0.2 + k * 0.4, 1.72, 0.3).applyMatrix4(m), yaw, 0.08);
      for (let k = 0; k < 5; k++) {
        const l = this.r();
        this.put(l < 0.5 ? green : l < 0.75 ? amber : red, new THREE.SphereGeometry(0.018, 6, 4).translate(x - 0.24 + k * 0.12, 1.45, 0.305).applyMatrix4(m));
      }
      this.put('white', bevelBox(0.2, 0.06, 0.004).translate(x - 0.2, 1.95, 0.302).applyMatrix4(m));
    }
  }

  /** a steel spiral stair round a pole, rising h, treads of radius r */
  spiralStair(pos: THREE.Vector3, h: number, r = 1.1, start = 0): void {
    const n = Math.ceil(h / 0.2);
    const rise = h / n;
    this.rod('steel', pos, pos.clone().setY(pos.y + h + 1), 0.06, 10);
    const rail: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = start + i * 0.4;
      const y = pos.y + (i + 1) * rise;
      const tread = new THREE.CylinderGeometry(r, r, 0.04, 6, 1, false, 0, 0.42).rotateY(a);
      this.put('blackMetal', tread.translate(pos.x, y, pos.z));
      if (i % 2 === 0) rail.push(V(pos.x + Math.sin(a + 0.21) * r, y + 0.95, pos.z + Math.cos(a + 0.21) * r));
      this.rod('steel', V(pos.x + Math.sin(a + 0.21) * r, y, pos.z + Math.cos(a + 0.21) * r), V(pos.x + Math.sin(a + 0.21) * r, y + 0.95, pos.z + Math.cos(a + 0.21) * r), 0.012, 4);
    }
    this.tube('steel', rail, 0.02, 6);
  }

  /** an open steel stair from bottom to top: treads between two stringers, handrails both sides */
  stairFlight(bottom: THREE.Vector3, top: THREE.Vector3, w = 1.0): void {
    const rise = top.y - bottom.y;
    const n = Math.max(2, Math.round(rise / 0.2));
    const flat = top.clone().setY(bottom.y);
    const run = bottom.distanceTo(flat);
    const dir = flat.sub(bottom).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(w / 2);
    const ang = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < n; i++) {
      const p = bottom.clone().addScaledVector(dir, (run * (i + 0.5)) / n).setY(bottom.y + (rise * (i + 1)) / n - 0.02);
      this.put('blackMetal', place(bevelBox(w, 0.04, run / n + 0.02), p.x, p.y, p.z, ang));
    }
    for (const sd of [1, -1]) {
      const a = bottom.clone().addScaledVector(side, sd);
      const b = top.clone().addScaledVector(side, sd);
      this.rod('blackMetal', a.clone().setY(a.y - 0.1), b.clone().setY(b.y - 0.1), 0.05, 4);
      this.rod('steel', a.clone().setY(a.y + 0.95), b.clone().setY(b.y + 0.95), 0.02, 6);
      for (let t = 0; t <= 1.001; t += 0.25) {
        const p = a.clone().lerp(b, t);
        this.rod('steel', p, p.clone().setY(p.y + 0.95), 0.016, 4);
      }
    }
  }

  /** a fixed ladder from a up to height h, with a safety cage of hoops on the side facing +Z after `yaw` */
  ladder(pos: THREE.Vector3, h: number, yaw: number, cage = true): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (const sx of [-0.22, 0.22]) this.rod('steel', V(sx, 0, 0).applyMatrix4(m), V(sx, h + 1.0, 0).applyMatrix4(m), 0.02, 5);
    for (let y = 0.3; y < h; y += 0.3) this.rod('steel', V(-0.22, y, 0).applyMatrix4(m), V(0.22, y, 0).applyMatrix4(m), 0.012, 4);
    if (!cage) return;
    for (let y = 2.4; y < h + 0.9; y += 0.8) this.put('steel', new THREE.TorusGeometry(0.36, 0.012, 4, 14, Math.PI).rotateX(Math.PI / 2).translate(0, y, 0).applyMatrix4(m));
    for (const a of [0.4, Math.PI / 2, Math.PI - 0.4]) this.rod('steel', V(Math.cos(a) * 0.36, 2.4, Math.sin(a) * 0.36).applyMatrix4(m), V(Math.cos(a) * 0.36, h + 0.8, Math.sin(a) * 0.36).applyMatrix4(m), 0.01, 4);
  }

  /** queue posts with a belt between them, from a to b */
  stanchions(a: THREE.Vector3, b: THREE.Vector3, belt: MatKey = 'black'): void {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      this.put('alu', new THREE.CylinderGeometry(0.16, 0.17, 0.03, 14).translate(p.x, p.y + 0.015, p.z));
      this.rod('alu', p, p.clone().setY(p.y + 0.95), 0.03, 8);
      this.put('alu', new THREE.SphereGeometry(0.04, 8, 6).translate(p.x, p.y + 0.97, p.z));
    }
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / n);
      this.put(belt, place(bevelBox(0.004, 0.05, len / n - 0.06), p.x, p.y + 0.88, p.z, ang));
    }
  }

  /** a garment rail of shirts (plain, no prints), facing +Z after `yaw` */
  garmentRail(pos: THREE.Vector3, yaw: number, w = 1.4): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (const sx of [-1, 1]) this.rod('alu', V((sx * w) / 2, 0, 0).applyMatrix4(m), V((sx * w) / 2, 1.6, 0).applyMatrix4(m), 0.015, 5);
    this.rod('alu', V(-w / 2, 1.6, 0).applyMatrix4(m), V(w / 2, 1.6, 0).applyMatrix4(m), 0.012, 5);
    const kinds: MatKey[] = ['black', 'white', 'grey', 'red', 'blue', 'black', 'cream'];
    for (let x = -w / 2 + 0.1; x < w / 2 - 0.05; x += 0.09) this.put(kinds[Math.floor(this.r() * kinds.length)], bevelBox(0.03, 0.7, 0.5).rotateY(0.15 * (this.r() - 0.5)).translate(x, 1.22, 0).applyMatrix4(m));
  }

  /** a heavy chain hanging from a to b */
  chain(a: THREE.Vector3, b: THREE.Vector3): void {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    for (let t = 0.05, i = 0; t < len; t += 0.085, i++) {
      const p = a.clone().addScaledVector(dir, t);
      this.put('rust', new THREE.TorusGeometry(0.035, 0.01, 4, 8).scale(0.8, 1.4, 1).rotateY((i % 2) * (Math.PI / 2)).applyQuaternion(q).translate(p.x, p.y, p.z));
    }
  }

  /* ---------------- floor ---------------- */

  /** a road case (flight case): laminate body, aluminium edges, corner caps, handles, a tape label */
  roadCase(pos: THREE.Vector3, yaw: number, w: number, h: number, d: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const at = (k: MatKey, g: THREE.BufferGeometry) => this.put(k, g.applyMatrix4(m));
    at('case', bevelBox(w, h, d).translate(0, h / 2, 0));
    const e = 0.022;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        at('alu', bevelBox(e, h, e).translate((sx * w) / 2, h / 2, (sz * d) / 2));
        for (const sy of [0, 1]) at('alu', bevelBox(0.06, 0.06, 0.06).translate((sx * (w - 0.03)) / 2, sy * h + (sy ? -0.03 : 0.03), (sz * (d - 0.03)) / 2));
      }
    for (const sy of [0, 1])
      for (const sz of [-1, 1]) at('alu', bevelBox(w, e, e).translate(0, sy * h, (sz * d) / 2));
    for (const sy of [0, 1])
      for (const sx of [-1, 1]) at('alu', bevelBox(e, e, d).translate((sx * w) / 2, sy * h, 0));
    at('alu', bevelBox(w + 0.004, 0.02, 0.02).translate(0, h * 0.62, d / 2));
    for (const sx of [-1, 1]) at('blackMetal', bevelBox(0.004, 0.06, 0.16).translate((sx * (w + 0.004)) / 2, h * 0.7, 0));
    at('white', bevelBox(Math.min(0.3, w * 0.5), 0.05, 0.003).translate(-w * 0.18, h * 0.85, d / 2 + 0.002));
    if (h < 0.7) for (const sx of [-1, 1]) for (const sz of [-1, 1]) at('rubber', new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8).translate((sx * (w - 0.1)) / 2, -0.025, (sz * (d - 0.1)) / 2));
  }

  /** an amp rack on castors: a frame of units, each with a row of LEDs */
  ampRack(pos: THREE.Vector3, yaw: number, units = 6): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const h = units * 0.135 + 0.12;
    this.put('case', bevelBox(0.6, h, 0.65).translate(0, h / 2 + 0.06, 0).applyMatrix4(m));
    const green = this.glow('#3ddc97', 'level', 1.8);
    const amber = this.glow('#ffb547', 'kick', 1.8);
    const red = this.glow('#ff3b3e', 'blink', 1.6);
    for (let u = 0; u < units; u++) {
      const y = 0.12 + u * 0.135;
      this.put('blackMetal', bevelBox(0.5, 0.12, 0.02).translate(0, y + 0.06, 0.33).applyMatrix4(m));
      for (let k = 0; k < 6; k++) this.put(k < 4 ? green : k < 5 ? amber : red, bevelBox(0.014, 0.01, 0.006).translate(-0.18 + k * 0.022, y + 0.09, 0.343).applyMatrix4(m));
      this.put('alu', bevelBox(0.04, 0.04, 0.03).translate(0.17, y + 0.06, 0.345).applyMatrix4(m));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.put('rubber', new THREE.CylinderGeometry(0.035, 0.035, 0.06, 8).rotateZ(Math.PI / 2).translate(sx * 0.24, 0.035, sz * 0.26).applyMatrix4(m));
  }

  /** a monitor wedge facing +Z after `yaw` (towards whoever stands there) */
  wedge(pos: THREE.Vector3, yaw: number): void {
    // side profile: back at x = 0, front at x = 0.5, the sloped baffle facing up and forward
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 0.12), new THREE.Vector2(0, 0.36)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false }).translate(-0.25, 0, -0.275).rotateY(-Math.PI / 2);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('black', g.applyMatrix4(m));
    let grille = this.mats.get('wedgeGrille');
    if (!grille) this.mats.set('wedgeGrille', (grille = new THREE.MeshStandardMaterial({ map: grilleTexture('monitor'), roughness: 0.85 })));
    const a = Math.atan2(0.24, 0.5);
    const face = new THREE.PlaneGeometry(0.5, Math.hypot(0.5, 0.24)).rotateX(-(Math.PI / 2 - a)).translate(0, 0.24 + Math.cos(a) * 0.004, Math.sin(a) * 0.004);
    this.put(grille, face.applyMatrix4(m));
  }

  /** a hazer on the floor, with its little status light */
  hazer(pos: THREE.Vector3, yaw: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('case', bevelBox(0.5, 0.28, 0.32).translate(0, 0.14, 0).applyMatrix4(m));
    this.put('blackMetal', new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10).rotateX(Math.PI / 2).translate(0, 0.16, 0.17).applyMatrix4(m));
    this.put(this.glow('#3ddc97', 'blink', 1.6), bevelBox(0.02, 0.02, 0.01).translate(0.18, 0.22, 0.165).applyMatrix4(m));
  }

  /** a yellow-and-black cable ramp from a to b along the floor */
  cableRamp(a: THREE.Vector3, b: THREE.Vector3): void {
    const len = a.distanceTo(b);
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    for (let t = -len / 2; t < len / 2; t += 0.9) {
      const sh = new THREE.Shape([new THREE.Vector2(-0.25, 0), new THREE.Vector2(0.25, 0), new THREE.Vector2(0.12, 0.05), new THREE.Vector2(-0.12, 0.05)]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.86, bevelEnabled: false }).translate(0, 0, -0.43);
      this.put(Math.round(t / 0.9) % 2 ? 'yellow' : 'black', place(g, mid.x + Math.sin(ang) * (t + 0.45), mid.y, mid.z + Math.cos(ang) * (t + 0.45), ang));
    }
  }

  /** a stack of pallets */
  pallets(pos: THREE.Vector3, yaw: number, n = 3): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (let i = 0; i < n; i++) {
      const y = i * 0.145;
      for (let k = 0; k < 3; k++) this.put('wood', bevelBox(1.2, 0.1, 0.1).translate(0, y + 0.05, -0.45 + k * 0.45).applyMatrix4(m));
      for (let k = 0; k < 7; k++) this.put('wood', bevelBox(0.12, 0.022, 1.0).translate(-0.54 + k * 0.18, y + 0.111, 0).applyMatrix4(m));
    }
  }

  /** crowd barrier (the steel kind in front of a stage) from a to b; the footplate is on the left going a to b (the crowd's side) */
  barrier(a: THREE.Vector3, b: THREE.Vector3, h = 1.2): void {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const n = Math.max(1, Math.round(len / 1));
    const back = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.5);
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      this.rod('galv', p, p.clone().setY(p.y + h), 0.025, 6);
      this.rod('galv', p.clone().setY(p.y + h), p.clone().add(back).setY(p.y + 0.05), 0.02, 6);
    }
    this.rod('galv', a.clone().setY(a.y + h), b.clone().setY(b.y + h), 0.03, 8);
    this.rod('galv', a.clone().setY(a.y + h * 0.5), b.clone().setY(b.y + h * 0.5), 0.015, 6);
    const plate = bevelBox(len, 0.01, 0.6);
    const ang = Math.atan2(dir.x, dir.z) - Math.PI / 2;
    const mid = a.clone().add(b).multiplyScalar(0.5).add(back.clone().multiplyScalar(0.55));
    this.put('galv', place(plate, mid.x, mid.y + 0.005, mid.z, ang));
  }

  /** a poseur table with a couple of drinks */
  table(pos: THREE.Vector3, h = 1.08): void {
    this.put('blackMetal', new THREE.CylinderGeometry(0.3, 0.3, 0.03, 18).translate(pos.x, pos.y + h, pos.z));
    this.put('blackMetal', new THREE.CylinderGeometry(0.03, 0.03, h, 8).translate(pos.x, pos.y + h / 2, pos.z));
    this.put('blackMetal', new THREE.CylinderGeometry(0.22, 0.24, 0.02, 16).translate(pos.x, pos.y + 0.01, pos.z));
    let glass = this.mats.get('glass');
    if (!glass) this.mats.set('glass', (glass = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.45 })));
    for (let i = 0; i < 2 + Math.floor(this.r() * 2); i++) {
      const a = this.r() * Math.PI * 2;
      const rr = 0.08 + this.r() * 0.14;
      this.put(glass, new THREE.CylinderGeometry(0.035, 0.03, 0.12, 10).translate(pos.x + Math.cos(a) * rr, pos.y + h + 0.075, pos.z + Math.sin(a) * rr));
    }
  }

  /** a bar stool */
  stool(pos: THREE.Vector3, h = 0.76): void {
    this.put('blackMetal', new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14).translate(pos.x, pos.y + h, pos.z));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      this.rod('blackMetal', V(pos.x + Math.cos(a) * 0.08, pos.y + h, pos.z + Math.sin(a) * 0.08), V(pos.x + Math.cos(a) * 0.2, pos.y, pos.z + Math.sin(a) * 0.2), 0.012, 5);
    }
    this.put('blackMetal', new THREE.TorusGeometry(0.15, 0.008, 4, 16).rotateX(Math.PI / 2).translate(pos.x, pos.y + 0.28, pos.z));
  }

  /** a potted plant: a pot and a few leafy blades */
  plant(pos: THREE.Vector3, h = 1.2, pot: MatKey = 'terracotta'): void {
    this.put(pot, new THREE.CylinderGeometry(0.22, 0.17, 0.4, 14).translate(pos.x, pos.y + 0.2, pos.z));
    this.put('trunk', new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12).translate(pos.x, pos.y + 0.39, pos.z));
    for (let i = 0; i < 9; i++) {
      const a = this.r() * Math.PI * 2;
      const lean = 0.3 + this.r() * 0.5;
      const len = h * (0.6 + this.r() * 0.4);
      const g = new THREE.PlaneGeometry(0.16, len, 1, 3);
      // a gentle droop
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < p.count; j++) {
        const t = (p.getY(j) + len / 2) / len;
        p.setZ(j, -t * t * 0.25);
      }
      g.translate(0, len / 2, 0).rotateX(-lean).rotateY(a);
      this.put('leaf', g.translate(pos.x, pos.y + 0.38, pos.z));
    }
  }

  /** stairs climbing in +Z after `yaw` */
  steps(pos: THREE.Vector3, yaw: number, n: number, w = 1.2, rise = 0.18, run = 0.28, k: MatKey = 'blackMetal'): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (let i = 0; i < n; i++) this.put(k, bevelBox(w, rise * (i + 1), run).translate(0, (rise * (i + 1)) / 2, run * i + run / 2).applyMatrix4(m));
    for (const s of [-1, 1]) {
      const a = V((s * w) / 2, 1, 0).applyMatrix4(m);
      const b = V((s * w) / 2, 1 + rise * n, run * n).applyMatrix4(m);
      this.rod('steel', a, b, 0.02, 6);
    }
  }

  /** a handrail along points at height h */
  rail(pts: THREE.Vector3[], h = 1.05, posts = 1.5): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      this.rod('steel', a.clone().setY(a.y + h), b.clone().setY(b.y + h), 0.022, 8);
      this.rod('steel', a.clone().setY(a.y + h * 0.5), b.clone().setY(b.y + h * 0.5), 0.012, 6);
      const len = a.distanceTo(b);
      for (let t = 0; t <= len + 1e-3; t += posts) {
        const p = a.clone().lerp(b, t / len);
        this.rod('steel', p, p.clone().setY(p.y + h), 0.018, 6);
      }
    }
  }

  /** front of house: a desk with a lighting console and a sound console, screens lit */
  foh(pos: THREE.Vector3, yaw: number, w = 2.4): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('case', bevelBox(w, 0.85, 0.9).translate(0, 0.425, 0).applyMatrix4(m));
    this.put('black', bevelBox(w * 0.45, 0.08, 0.6).rotateX(-0.15).translate(-w * 0.25, 0.9, 0).applyMatrix4(m));
    this.put('black', bevelBox(w * 0.45, 0.08, 0.6).rotateX(-0.15).translate(w * 0.25, 0.9, 0).applyMatrix4(m));
    const screens = this.glow('#ffffff', 'steady', 1.1, 0, consoleTexture());
    for (const x of [-w * 0.25, w * 0.25]) this.put(screens, new THREE.PlaneGeometry(w * 0.42, 0.22).rotateX(-0.5).rotateY(Math.PI).translate(x, 1.08, 0.24).applyMatrix4(m));
    const leds = this.glow('#2ec4f1', 'kick', 1.4);
    for (let i = 0; i < 16; i++) this.put(leds, bevelBox(0.02, 0.006, 0.02).translate(-w * 0.45 + i * 0.06, 0.95, -0.18).applyMatrix4(m));
    // a little desk lamp on a gooseneck
    this.tube('blackMetal', [V(w * 0.45, 0.9, 0.3), V(w * 0.45, 1.2, 0.25), V(w * 0.4, 1.28, 0.1)].map((v) => v.applyMatrix4(m)), 0.008, 4);
  }

  /** a mobile light mast: a trailer, a mast and a head of four lamps */
  lightMast(pos: THREE.Vector3, yaw: number, h = 7): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('yellow', bevelBox(1.2, 0.8, 2).translate(0, 0.7, 0).applyMatrix4(m));
    for (const s of [-1, 1]) this.put('rubber', new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12).rotateZ(Math.PI / 2).translate(s * 0.65, 0.3, 0).applyMatrix4(m));
    this.rod('galv', V(0, 1, 0).applyMatrix4(m), V(0, h, 0).applyMatrix4(m), 0.06, 8);
    this.put('galv', bevelBox(1.2, 0.06, 0.06).translate(0, h, 0).applyMatrix4(m));
    const lamp = this.glow('#fff1d6', 'steady', 2.4);
    for (let i = 0; i < 4; i++) this.put(lamp, bevelBox(0.26, 0.2, 0.06).translate(-0.45 + i * 0.3, h + 0.15, 0.06).applyMatrix4(m));
  }

  /* ---------------- outdoors ---------------- */

  /** a street lamp with a warm head */
  streetLamp(pos: THREE.Vector3, yaw: number, h = 5): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.rod('blackMetal', V(0, 0, 0).applyMatrix4(m), V(0, h, 0).applyMatrix4(m), 0.06, 8);
    this.tube('blackMetal', [V(0, h - 0.1, 0), V(0, h + 0.2, 0.2), V(0, h + 0.2, 0.7)].map((v) => v.applyMatrix4(m)), 0.04, 6);
    this.put('blackMetal', bevelBox(0.3, 0.12, 0.5).translate(0, h + 0.18, 0.85).applyMatrix4(m));
    this.put(this.glow('#ffb35a', 'steady', 2.2), bevelBox(0.24, 0.02, 0.4).translate(0, h + 0.11, 0.85).applyMatrix4(m));
  }

  /** a palm: a curving segmented trunk and a crown of drooping fronds */
  palm(pos: THREE.Vector3, h = 6, lean = 0.2): void {
    const dir = this.r() * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(V(pos.x + Math.cos(dir) * lean * h * t * t, pos.y + h * t, pos.z + Math.sin(dir) * lean * h * t * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    this.put('trunk', new THREE.TubeGeometry(curve, 18, 0.16, 8, false));
    for (let i = 1; i < 12; i++) {
      const p = curve.getPoint(i / 12);
      this.put('trunk', new THREE.TorusGeometry(0.17, 0.025, 4, 10).rotateX(Math.PI / 2).translate(p.x, p.y, p.z));
    }
    const top = pts[pts.length - 1];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + this.r() * 0.3;
      const len = 2.2 + this.r() * 0.8;
      const g = new THREE.PlaneGeometry(0.5, len, 1, 5);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < p.count; j++) {
        const t = (p.getY(j) + len / 2) / len;
        p.setZ(j, -t * t * 1.1);
        p.setX(j, p.getX(j) * (1 - t * 0.7));
      }
      g.translate(0, len / 2, 0).rotateX(-1.1 - this.r() * 0.3).rotateY(a);
      this.put('leaf', g.translate(top.x, top.y, top.z));
    }
  }

  /** a parasol: pole and a shallow cone of fabric */
  umbrella(pos: THREE.Vector3, color: MatKey = 'canvas', r = 1.3): void {
    this.rod('wood', pos, pos.clone().setY(pos.y + 2.3), 0.025, 6);
    this.put(color, new THREE.ConeGeometry(r, 0.45, 12, 1, true).translate(pos.x, pos.y + 2.25, pos.z));
  }

  /** a sun lounger facing +Z after `yaw` */
  lounger(pos: THREE.Vector3, yaw: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('wood', bevelBox(0.65, 0.06, 1.3).translate(0, 0.32, 0.2).applyMatrix4(m));
    this.put('wood', bevelBox(0.65, 0.06, 0.7).rotateX(0.9).translate(0, 0.55, -0.6).applyMatrix4(m));
    this.put('white', bevelBox(0.6, 0.05, 1.25).translate(0, 0.37, 0.2).applyMatrix4(m));
    for (const sx of [-1, 1]) for (const sz of [-0.3, 0.7]) this.put('wood', bevelBox(0.05, 0.3, 0.05).translate(sx * 0.28, 0.15, sz).applyMatrix4(m));
  }

  /** a bamboo torch with a live flame */
  torch(pos: THREE.Vector3, h = 1.8): void {
    this.rod('wood', pos, pos.clone().setY(pos.y + h), 0.025, 6);
    this.put('blackMetal', new THREE.CylinderGeometry(0.05, 0.04, 0.14, 8).translate(pos.x, pos.y + h + 0.05, pos.z));
    this.put(this.glow('#ff8a2a', 'flame', 2.6), new THREE.ConeGeometry(0.05, 0.22, 6).translate(pos.x, pos.y + h + 0.22, pos.z));
  }

  /** a patio heater with its glowing head */
  heater(pos: THREE.Vector3): void {
    this.rod('steel', pos, pos.clone().setY(pos.y + 2.1), 0.04, 8);
    this.put('steel', new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12).translate(pos.x, pos.y + 0.25, pos.z));
    this.put('steel', new THREE.ConeGeometry(0.45, 0.2, 14, 1, true).rotateX(Math.PI).translate(pos.x, pos.y + 2.35, pos.z));
    this.put(this.glow('#ff5a1a', 'breathe', 2.2), new THREE.CylinderGeometry(0.1, 0.1, 0.3, 10).translate(pos.x, pos.y + 2.1, pos.z));
  }

  /** a rooftop AC unit with a fan grille on top */
  acUnit(pos: THREE.Vector3, yaw: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('galv', bevelBox(1.4, 1.0, 1).translate(0, 0.5, 0).applyMatrix4(m));
    this.put('blackMetal', new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16).translate(0, 1.02, 0).applyMatrix4(m));
    for (let i = 0; i < 8; i++) this.put('galv', bevelBox(1.42, 0.02, 0.02).translate(0, 0.15 + i * 0.1, 0.505).applyMatrix4(m));
    this.rod('galv', V(0.5, 0.3, -0.5).applyMatrix4(m), V(0.5, 0.3, -1.4).applyMatrix4(m), 0.04, 6);
  }

  /** a water tank on legs */
  tank(pos: THREE.Vector3, r = 1, h = 2): void {
    this.put('galv', new THREE.CylinderGeometry(r, r, h, 20).translate(pos.x, pos.y + 1 + h / 2, pos.z));
    this.put('galv', new THREE.ConeGeometry(r * 1.02, 0.3, 20).translate(pos.x, pos.y + 1.15 + h, pos.z));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.78;
      this.rod('steel', V(pos.x + Math.cos(a) * r * 0.8, pos.y, pos.z + Math.sin(a) * r * 0.8), V(pos.x + Math.cos(a) * r * 0.8, pos.y + 1, pos.z + Math.sin(a) * r * 0.8), 0.04, 6);
    }
    for (let i = 0; i < 4; i++) this.put('steel', new THREE.TorusGeometry(r * 1.01, 0.012, 4, 24).rotateX(Math.PI / 2).translate(pos.x, pos.y + 1.3 + i * (h / 4), pos.z));
  }

  /** a life ring on a post or rail */
  lifebuoy(pos: THREE.Vector3, yaw: number): void {
    const g = new THREE.TorusGeometry(0.3, 0.07, 8, 20);
    this.put('red', place(g.clone(), pos.x, pos.y, pos.z, yaw));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      this.put('white', place(new THREE.TorusGeometry(0.3, 0.072, 8, 3, 0.45), pos.x, pos.y, pos.z, yaw, 0, a));
    }
  }

  /** a flag on a pole, the cloth caught mid-wave */
  flag(pos: THREE.Vector3, h: number, cloth: MatKey): void {
    this.rod('galv', pos, pos.clone().setY(pos.y + h), 0.03, 6);
    const g = new THREE.PlaneGeometry(1.2, 0.8, 8, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let j = 0; j < p.count; j++) p.setZ(j, Math.sin(p.getX(j) * 4 + this.r()) * 0.08);
    this.put(cloth, g.translate(pos.x + 0.6, pos.y + h - 0.45, pos.z));
  }

  /** a food truck facing +Z after `yaw`, with a lit hatch and menu */
  foodTruck(pos: THREE.Vector3, yaw: number, seed: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const body: MatKey = (['white', 'red', 'blue', 'yellow'] as MatKey[])[seed % 4];
    this.put(body, bevelBox(4.5, 2.2, 2.1).translate(0, 1.5, 0).applyMatrix4(m));
    this.put('black', bevelBox(1.4, 1.6, 2.1).translate(-2.9, 1.2, 0).applyMatrix4(m));
    for (const x of [-2.6, 1.4]) for (const z of [-1, 1]) this.put('rubber', new THREE.CylinderGeometry(0.42, 0.42, 0.25, 14).rotateX(Math.PI / 2).translate(x, 0.42, z).applyMatrix4(m));
    const hatch = this.glow('#ffd9a0', 'steady', 1.4);
    this.put(hatch, new THREE.PlaneGeometry(2.4, 0.9).translate(0, 1.8, 1.06).applyMatrix4(m));
    this.put(body, bevelBox(2.6, 0.04, 0.8).rotateX(-0.5).translate(0, 2.45, 1.4).applyMatrix4(m));
    this.put('steel', bevelBox(2.6, 0.05, 0.35).translate(0, 1.25, 1.2).applyMatrix4(m));
    const menu = this.glow('#ffffff', 'steady', 1.2, 0, menuTexture(seed));
    this.put(menu, new THREE.PlaneGeometry(1.6, 0.8).translate(0, 2.95, 1.06).applyMatrix4(m));
    const bulbs = this.glow('#ffcf7a', 'breathe', 2);
    for (let i = 0; i < 10; i++) this.put(bulbs, new THREE.SphereGeometry(0.04, 6, 4).translate(-1.3 + i * 0.29, 2.62 - Math.sin((i / 9) * Math.PI) * 0.12, 1.75).applyMatrix4(m));
  }

  /** a yacht at anchor: hull, cabin, mast, a lit cabin and an anchor light */
  yacht(pos: THREE.Vector3, yaw: number, len = 12): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const sh = new THREE.Shape([new THREE.Vector2(-len / 2, 0.4), new THREE.Vector2(len / 2, 0.4), new THREE.Vector2(len / 2 + 1.2, 1.4), new THREE.Vector2(-len / 2, 1.4)]);
    const hull = new THREE.ExtrudeGeometry(sh, { depth: len * 0.3, bevelEnabled: false }).translate(0, -0.4, -len * 0.15);
    this.put('white', hull.applyMatrix4(m));
    this.put('white', bevelBox(len * 0.35, 0.9, len * 0.2).translate(-len * 0.05, 1.45, 0).applyMatrix4(m));
    this.put(this.glow('#ffd29a', 'steady', 1.6), bevelBox(len * 0.33, 0.22, len * 0.205).translate(-len * 0.05, 1.5, 0).applyMatrix4(m));
    this.rod('alu', V(0, 1.4, 0).applyMatrix4(m), V(0, 1.4 + len * 1.1, 0).applyMatrix4(m), 0.06, 6);
    this.put(this.glow('#ffffff', 'steady', 2.4), new THREE.SphereGeometry(0.15, 6, 4).translate(0, 1.5 + len * 1.1, 0).applyMatrix4(m));
  }

  /** a lifeguard tower on the sand, its red flag flying */
  lifeguard(pos: THREE.Vector3, yaw: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (const sx of [-0.8, 0.8]) for (const sz of [-0.8, 0.8]) this.rod('white', V(sx, 0, sz).applyMatrix4(m), V(sx * 0.8, 2.2, sz * 0.8).applyMatrix4(m), 0.06, 6);
    this.put('white', bevelBox(1.8, 0.1, 1.8).translate(0, 2.2, 0).applyMatrix4(m));
    this.put('yellow', bevelBox(1.4, 1.2, 1.3).translate(0, 2.85, -0.15).applyMatrix4(m));
    this.put('red', bevelBox(1.7, 0.08, 1.6).translate(0, 3.5, -0.15).applyMatrix4(m));
    for (let i = 0; i < 7; i++) this.put('white', bevelBox(0.6, 0.04, 0.08).translate(0, 0.3 * i + 0.1, 1.2 - i * 0.05).applyMatrix4(m));
    this.flag(V(0.7, 3.5, -0.15).applyMatrix4(m), 1.6, 'red');
  }

  /** a daybed with posts and a fabric canopy, facing +Z after `yaw` */
  daybed(pos: THREE.Vector3, yaw: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('wood', bevelBox(2, 0.3, 2).translate(0, 0.15, 0).applyMatrix4(m));
    this.put('white', bevelBox(1.9, 0.2, 1.9).translate(0, 0.4, 0).applyMatrix4(m));
    for (let i = 0; i < 3; i++) this.put('cream', bevelBox(0.5, 0.25, 0.18).translate(-0.6 + i * 0.6, 0.62, -0.8).applyMatrix4(m));
    for (const sx of [-0.95, 0.95]) for (const sz of [-0.95, 0.95]) this.rod('wood', V(sx, 0, sz).applyMatrix4(m), V(sx, 2.3, sz).applyMatrix4(m), 0.04, 6);
    const g = new THREE.PlaneGeometry(2.1, 2.1, 6, 6).rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let j = 0; j < p.count; j++) p.setY(j, -Math.sin(((p.getX(j) / 2.1) + 0.5) * Math.PI) * Math.sin(((p.getZ(j) / 2.1) + 0.5) * Math.PI) * 0.15);
    this.put('canvas', g.translate(0, 2.3, 0).applyMatrix4(m));
    for (const sx of [-1.02, 1.02]) {
      const curtain = new THREE.PlaneGeometry(0.4, 2.1, 6, 1);
      const cp = curtain.attributes.position as THREE.BufferAttribute;
      for (let j = 0; j < cp.count; j++) cp.setZ(j, Math.sin(cp.getX(j) * 30) * 0.03);
      this.put('canvas', curtain.rotateY(Math.PI / 2).translate(sx, 1.2, 0.85).applyMatrix4(m));
    }
  }

  /** a row of portable toilets facing +Z after `yaw` */
  portaloos(pos: THREE.Vector3, yaw: number, n = 4): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 1.2;
      this.put(i % 2 ? 'blue' : 'green', bevelBox(1.1, 2.3, 1.2).translate(x, 1.15, 0).applyMatrix4(m));
      this.put('white', bevelBox(1.15, 0.1, 1.25).translate(x, 2.35, 0).applyMatrix4(m));
      this.put('grey', bevelBox(0.12, 0.04, 0.02).translate(x + 0.3, 1.2, 0.61).applyMatrix4(m));
    }
  }

  /** chain-link fence from a to b, with posts */
  fence(a: THREE.Vector3, b: THREE.Vector3, h = 2.2): void {
    const len = a.distanceTo(b);
    let mat = this.mats.get('chainlink') as THREE.MeshStandardMaterial | undefined;
    if (!mat) {
      const t = chainLinkTexture().clone();
      t.userData = {};
      t.repeat.set(1, 1);
      this.mats.set('chainlink', (mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, alphaToCoverage: true, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide, color: 0xb8bdc2 })));
    }
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, (uv.getX(j) * len) / 0.6, (uv.getY(j) * h) / 0.6);
    const ang = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.put(mat, place(g, mid.x, mid.y + h / 2, mid.z, ang));
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      this.rod('galv', p, p.clone().setY(p.y + h + 0.05), 0.03, 6);
    }
    this.rod('galv', a.clone().setY(a.y + h), b.clone().setY(b.y + h), 0.02, 6);
  }

  /** a bench facing +Z after `yaw` */
  bench(pos: THREE.Vector3, yaw: number, len = 1.8): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (let i = 0; i < 3; i++) this.put('wood', bevelBox(len, 0.04, 0.12).translate(0, 0.45, -0.15 + i * 0.14).applyMatrix4(m));
    for (let i = 0; i < 2; i++) this.put('wood', bevelBox(len, 0.12, 0.04).translate(0, 0.65 + i * 0.16, -0.24).applyMatrix4(m));
    for (const s of [-1, 1]) this.put('blackMetal', bevelBox(0.06, 0.45, 0.45).translate((s * (len - 0.2)) / 2, 0.22, -0.05).applyMatrix4(m));
  }

  /** a street bin */
  bin(pos: THREE.Vector3): void {
    this.put('blackMetal', new THREE.CylinderGeometry(0.26, 0.24, 0.9, 12, 1, true).translate(pos.x, pos.y + 0.45, pos.z));
    this.put('blackMetal', new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12).translate(pos.x, pos.y + 0.92, pos.z));
  }

  /* ---------------- open-air sites ---------------- */

  /** plastic ground protection (trackway) panels from a to b, w wide */
  trackway(a: THREE.Vector3, b: THREE.Vector3, w = 2.4): void {
    const len = a.distanceTo(b);
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
    for (let t = 0; t < len - 0.1; t += 1.22) {
      const l = Math.min(1.2, len - t);
      const p = a.clone().lerp(b, (t + l / 2) / len);
      this.box('trackway', w, 0.03, l, p.x, p.y + 0.015, p.z, ang);
    }
  }

  /** a string of bulbs slung from a to b */
  festoon(a: THREE.Vector3, b: THREE.Vector3, sag: number, bulb: THREE.MeshBasicMaterial, spacing = 0.7): void {
    const pts = catenary(a, b, sag, 16);
    this.tube('rubber', pts, 0.006, 4);
    const curve = new THREE.CatmullRomCurve3(pts);
    const n = Math.max(2, Math.floor(curve.getLength() / spacing));
    for (let i = 1; i < n; i++) {
      const p = curve.getPointAt(i / n);
      this.put(bulb, new THREE.SphereGeometry(0.04, 6, 4).translate(p.x, p.y - 0.06, p.z));
    }
  }

  /** a line of triangular pennants slung from a to b */
  bunting(a: THREE.Vector3, b: THREE.Vector3, sag: number, spacing = 0.42): void {
    let mat = this.mats.get('pennants');
    if (!mat) this.mats.set('pennants', (mat = new THREE.MeshStandardMaterial({ map: pennantTexture(), roughness: 0.85, side: THREE.DoubleSide })));
    const pts = catenary(a, b, sag, 16);
    this.tube('white', pts, 0.004, 3);
    const curve = new THREE.CatmullRomCurve3(pts);
    const n = Math.max(2, Math.floor(curve.getLength() / spacing));
    for (let i = 1; i < n; i++) {
      const p = curve.getPointAt(i / n);
      const t = curve.getTangentAt(i / n).setY(0).normalize().multiplyScalar(0.13);
      const k = (Math.floor(this.r() * 6) + 0.5) / 6;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([p.x - t.x, p.y, p.z - t.z, p.x + t.x, p.y, p.z + t.z, p.x, p.y - 0.3, p.z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([k, 0.9, k, 0.9, k, 0.1], 2));
      g.computeVertexNormals();
      this.put(mat, g);
    }
  }

  /** a broadleaf tree: a trunk, a few limbs and clumps of leaves, h tall */
  tree(pos: THREE.Vector3, h = 7): void {
    const s = h / 7;
    const top = pos.clone().setY(pos.y + h * 0.45);
    this.put('trunk', new THREE.CylinderGeometry(0.12 * s, 0.22 * s, h * 0.45, 7).translate(pos.x, pos.y + h * 0.225, pos.z));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + this.r();
      const end = top.clone().add(V(Math.cos(a) * 1.4 * s, (0.8 + this.r() * 0.8) * s, Math.sin(a) * 1.4 * s));
      this.rod('trunk', top, end, 0.07 * s, 5);
    }
    for (let i = 0; i < 7; i++) {
      const a = this.r() * Math.PI * 2;
      const rr = (i === 0 ? 0 : 1 + this.r() * 0.9) * s;
      const rad = (1.3 + this.r() * 0.9) * s;
      const g = new THREE.IcosahedronGeometry(rad, 1).scale(1, 0.75 + this.r() * 0.2, 1);
      this.put('foliage', g.translate(pos.x + Math.cos(a) * rr, pos.y + h * (0.62 + this.r() * 0.22), pos.z + Math.sin(a) * rr));
    }
  }

  /** a conifer: a trunk and stacked cones */
  pine(pos: THREE.Vector3, h = 9): void {
    this.put('trunk', new THREE.CylinderGeometry(0.1, 0.18, h * 0.35, 6).translate(pos.x, pos.y + h * 0.175, pos.z));
    for (let i = 0; i < 4; i++) {
      const y = h * (0.25 + i * 0.17);
      const r = h * (0.24 - i * 0.045);
      this.put('foliage', new THREE.ConeGeometry(r, h * 0.32, 8).rotateY(this.r()).translate(pos.x, pos.y + y + h * 0.16, pos.z));
    }
  }

  /** a round hay bale lying on its side (round = true), or a small square one for sitting on */
  hayBale(pos: THREE.Vector3, yaw: number, round = false): void {
    if (round) this.put('straw', place(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 14).rotateZ(Math.PI / 2), pos.x, pos.y + 0.72, pos.z, yaw));
    else {
      this.box('straw', 1.0, 0.42, 0.5, pos.x, pos.y + 0.21, pos.z, yaw);
      // the twine round it
      for (const s of [-0.25, 0.25]) this.put('trunk', place(bevelBox(0.02, 0.43, 0.51), pos.x + Math.cos(yaw) * s, pos.y + 0.21, pos.z - Math.sin(yaw) * s, yaw));
    }
  }

  /** a bell tent, its door facing +Z after `yaw`, a lamp lit inside */
  bellTent(pos: THREE.Vector3, yaw: number, r = 2.2, lamp?: THREE.MeshBasicMaterial): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('canvas', new THREE.CylinderGeometry(r, r, 0.6, 18, 1, true).translate(0, 0.3, 0).applyMatrix4(m));
    this.put('canvas', new THREE.ConeGeometry(r * 1.06, r * 1.15, 18, 1, true).translate(0, 0.6 + r * 0.575, 0).applyMatrix4(m));
    this.rod('wood', V(0, 0, 0).applyMatrix4(m), V(0, 0.75 + r * 1.15, 0).applyMatrix4(m), 0.03, 5);
    // guy ropes to pegs
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      this.rod('cream', V(Math.cos(a) * r * 1.02, 0.62, Math.sin(a) * r * 1.02).applyMatrix4(m), V(Math.cos(a) * r * 1.7, 0, Math.sin(a) * r * 1.7).applyMatrix4(m), 0.006, 3);
    }
    // the open door: a dark triangle, warm inside
    const door = new THREE.BufferGeometry();
    door.setAttribute('position', new THREE.Float32BufferAttribute([-0.45, 0, 0, 0.45, 0, 0, 0, 1.6, 0], 3));
    door.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    door.computeVertexNormals();
    door.translate(0, 0.01, r + 0.02);
    this.put(lamp ?? 'black', door.applyMatrix4(m));
  }

  /** a fire pit: a ring of stones, logs and flames */
  firePit(pos: THREE.Vector3): void {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.put('stone', new THREE.DodecahedronGeometry(0.14 + this.r() * 0.05).scale(1, 0.7, 1).translate(pos.x + Math.cos(a) * 0.55, pos.y + 0.08, pos.z + Math.sin(a) * 0.55));
    }
    for (let i = 0; i < 4; i++) this.put('trunk', place(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6).rotateZ(Math.PI / 2 - 0.25), pos.x, pos.y + 0.12, pos.z, (i / 4) * Math.PI));
    this.put(this.glow('#ff5a14', 'breathe', 1.6), new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2).translate(pos.x, pos.y + 0.03, pos.z));
    for (let i = 0; i < 4; i++) {
      const a = this.r() * Math.PI * 2;
      this.put(this.glow('#ff8a2a', 'flame', 2.4), new THREE.ConeGeometry(0.1 + this.r() * 0.06, 0.4 + this.r() * 0.3, 6).translate(pos.x + Math.cos(a) * 0.12, pos.y + 0.32, pos.z + Math.sin(a) * 0.12));
    }
  }

  /** a post-and-rail fence through points (already at ground height) */
  postRail(pts: THREE.Vector3[]): void {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this.box('wood', 0.1, 1.1, 0.1, p.x, p.y + 0.55, p.z);
      if (i > 0) for (const y of [0.45, 0.95]) this.rod('wood', pts[i - 1].clone().setY(pts[i - 1].y + y), p.clone().setY(p.y + y), 0.035, 5);
    }
  }

  /** a site cabin on blocks, door and windows facing +Z after `yaw`, the windows lit */
  cabin(pos: THREE.Vector3, yaw: number, w = 6, lit?: THREE.MeshBasicMaterial): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('white', bevelBox(w, 2.6, 2.6).translate(0, 1.55, 0).applyMatrix4(m));
    this.put('grey', bevelBox(w + 0.06, 0.12, 2.66).translate(0, 2.9, 0).applyMatrix4(m));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.put('stone', bevelBox(0.4, 0.25, 0.4).translate((sx * (w - 0.5)) / 2, 0.125, (sz * 2.1) / 2).applyMatrix4(m));
    this.put('grey', bevelBox(0.9, 2.0, 0.04).translate(w / 2 - 0.8, 1.25, 1.31).applyMatrix4(m));
    this.put('galv', bevelBox(1.0, 0.24, 0.4).translate(w / 2 - 0.8, 0.12, 1.5).applyMatrix4(m));
    const glass = lit ?? this.glow('#d8e4ff', 'steady', 0.9);
    for (let x = -w / 2 + 0.9; x < w / 2 - 1.6; x += 1.5) this.put(glass, new THREE.PlaneGeometry(1.0, 0.7).translate(x, 1.9, 1.31).applyMatrix4(m));
    this.put('galv', bevelBox(0.6, 0.45, 0.3).translate(-w / 2 + 0.5, 2.3, -1.45).applyMatrix4(m));
  }

  /** a mobile generator with its exhaust stack and a panel that shows the load */
  generator(pos: THREE.Vector3, yaw: number): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('green', bevelBox(4, 2.1, 1.4).translate(0, 1.25, 0).applyMatrix4(m));
    this.put('grey', bevelBox(4.2, 0.2, 1.5).translate(0, 0.1, 0).applyMatrix4(m));
    for (let i = 0; i < 9; i++) this.put('blackMetal', bevelBox(0.06, 1.2, 0.02).translate(-1.6 + i * 0.12, 1.3, 0.71).applyMatrix4(m));
    this.rod('blackMetal', V(1.4, 2.3, 0).applyMatrix4(m), V(1.4, 3.2, 0).applyMatrix4(m), 0.08, 8);
    this.put('blackMetal', bevelBox(0.6, 0.5, 0.03).translate(1.1, 1.4, 0.71).applyMatrix4(m));
    this.put(this.glow('#3ddc97', 'level', 1.6), bevelBox(0.3, 0.06, 0.01).translate(1.1, 1.5, 0.728).applyMatrix4(m));
    this.put(this.glow('#ffb547', 'blink', 1.6), bevelBox(0.04, 0.04, 0.01).translate(1.3, 1.3, 0.728).applyMatrix4(m));
  }

  /** an articulated lorry: cab and trailer, the cab facing +Z after `yaw` */
  lorry(pos: THREE.Vector3, yaw: number, len = 13.6, cab: MatKey = 'blue'): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('white', bevelBox(2.5, 2.8, len).translate(0, 2.6, -len / 2).applyMatrix4(m));
    this.put('grey', bevelBox(2.3, 0.3, len).translate(0, 1.05, -len / 2).applyMatrix4(m));
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) this.put('rubber', new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14).rotateZ(Math.PI / 2).translate(s * 1.0, 0.5, -len + 1.2 + i * 1.3).applyMatrix4(m));
    for (const s of [-1, 1]) this.rod('grey', V(s * 0.9, 1.0, -2.2).applyMatrix4(m), V(s * 0.9, 0, -2.2).applyMatrix4(m), 0.06, 6);
    this.put(cab, bevelBox(2.5, 2.9, 2.3).translate(0, 2.05, 1.6).applyMatrix4(m));
    this.put('black', bevelBox(2.3, 1.0, 0.02).rotateX(-0.08).translate(0, 2.7, 2.76).applyMatrix4(m));
    this.put('grey', bevelBox(2.5, 0.4, 0.1).translate(0, 0.8, 2.76).applyMatrix4(m));
    for (const s of [-1, 1]) this.put('rubber', new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14).rotateZ(Math.PI / 2).translate(s * 1.0, 0.5, 1.6).applyMatrix4(m));
    for (const s of [-1, 1]) this.put(this.glow('#fff4dd', 'steady', 1.2), bevelBox(0.3, 0.15, 0.02).translate(s * 0.9, 0.95, 2.82).applyMatrix4(m));
  }

  /** a scaffold tower w × d, h tall, boarded on top, with a rail */
  scaffold(pos: THREE.Vector3, w: number, d: number, h: number, lift = 2): void {
    const xs = [-w / 2, w / 2];
    const zs = [-d / 2, d / 2];
    const nx = Math.max(1, Math.round(w / 2.4));
    const nz = Math.max(1, Math.round(d / 2.4));
    const cols: [number, number][] = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) if (i === 0 || j === 0 || i === nx || j === nz) cols.push([-w / 2 + (i * w) / nx, -d / 2 + (j * d) / nz]);
    for (const [x, z] of cols) this.rod('galv', V(pos.x + x, pos.y, pos.z + z), V(pos.x + x, pos.y + h + 1.05, pos.z + z), 0.024, 6);
    for (let y = lift; y <= h + 1e-3; y += lift)
      for (const z of zs) this.rod('galv', V(pos.x - w / 2, pos.y + y, pos.z + z), V(pos.x + w / 2, pos.y + y, pos.z + z), 0.024, 6);
    for (let y = lift; y <= h + 1e-3; y += lift)
      for (const x of xs) this.rod('galv', V(pos.x + x, pos.y + y, pos.z - d / 2), V(pos.x + x, pos.y + y, pos.z + d / 2), 0.024, 6);
    // diagonal braces up the long faces
    for (const z of zs)
      for (let y = 0; y < h - 1e-3; y += lift) this.rod('galv', V(pos.x - w / 2, pos.y + y, pos.z + z), V(pos.x - w / 2 + Math.min(w, 2.4), pos.y + Math.min(h, y + lift), pos.z + z), 0.02, 5);
    for (let x = -w / 2 + 0.12; x < w / 2 - 0.1; x += 0.24) this.box('wood', 0.22, 0.04, d, pos.x + x, pos.y + h + 0.02, pos.z);
    for (const z of zs) {
      this.rod('galv', V(pos.x - w / 2, pos.y + h + 1.0, pos.z + z), V(pos.x + w / 2, pos.y + h + 1.0, pos.z + z), 0.024, 6);
      this.box('wood', w, 0.15, 0.03, pos.x, pos.y + h + 0.1, pos.z + z);
    }
    for (const x of xs) this.rod('galv', V(pos.x + x, pos.y + h + 1.0, pos.z - d / 2), V(pos.x + x, pos.y + h + 1.0, pos.z + d / 2), 0.024, 6);
    for (const [x, z] of cols) this.box('wood', 0.25, 0.04, 0.25, pos.x + x, pos.y + 0.02, pos.z + z);
  }

  /** an IBC water tank in its cage, on a pallet (ballast for towers) */
  ibc(pos: THREE.Vector3, yaw = 0): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('cream', bevelBox(1.0, 1.0, 1.15).translate(0, 0.65, 0).applyMatrix4(m));
    this.put('galv', bevelBox(1.06, 0.14, 1.2).translate(0, 0.07, 0).applyMatrix4(m));
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) this.put('galv', bevelBox(1.04, 0.02, 0.02).translate(0, 0.3 + i * 0.25, s * 0.585).applyMatrix4(m));
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) this.put('galv', bevelBox(0.02, 1.04, 0.02).translate(-0.4 + i * 0.27, 0.66, s * 0.585).applyMatrix4(m));
  }

  /** wheelie bins in a row (general, recycling, glass), lids facing +Z after `yaw` */
  wheelieBins(pos: THREE.Vector3, yaw: number, n = 3): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const kinds: MatKey[] = ['black', 'green', 'blue'];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.78;
      this.put(kinds[i % 3], bevelBox(0.7, 1.0, 0.75).translate(x, 0.55, 0).applyMatrix4(m));
      this.put(kinds[i % 3], bevelBox(0.74, 0.05, 0.8).translate(x, 1.07, 0.02).applyMatrix4(m));
      for (const s of [-1, 1]) this.put('rubber', new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10).rotateZ(Math.PI / 2).translate(x + s * 0.3, 0.1, -0.3).applyMatrix4(m));
    }
  }

  /** a drink ledge on a wall from a to b at height h above a.y (it sticks out to the right of a→b, seen from above), on brackets, a few cups left on it */
  ledge(a: THREE.Vector3, b: THREE.Vector3, h = 1.1, depth = 0.24): void {
    const len = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    const ang = Math.atan2(dir.x, dir.z);
    const out = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(depth / 2);
    const mid = a.clone().add(b).multiplyScalar(0.5).add(out);
    this.put('darkWood', place(bevelBox(depth, 0.04, len), mid.x, a.y + h, mid.z, ang));
    const lip = mid.clone().add(out.clone().multiplyScalar(0.92));
    this.put('darkWood', place(bevelBox(0.03, 0.03, len), lip.x, a.y + h + 0.03, lip.z, ang));
    for (let t = 0.3; t < len; t += 1.4) {
      const p = a.clone().addScaledVector(dir, t).add(out);
      this.put('blackMetal', place(bevelBox(depth * 0.8, 0.12, 0.02), p.x, a.y + h - 0.08, p.z, ang));
    }
    let glass = this.mats.get('glass');
    if (!glass) this.mats.set('glass', (glass = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.45 })));
    for (let t = 0.2; t < len; t += 0.3 + this.r() * 1.1) {
      const p = a.clone().addScaledVector(dir, t).add(out.clone().multiplyScalar(0.6 + this.r() * 0.8));
      this.put(this.r() < 0.6 ? glass : 'white', new THREE.CylinderGeometry(0.04, 0.03, 0.12, 8).translate(p.x, a.y + h + 0.08, p.z));
    }
  }

  /** a small speaker on a pole, aimed along +Z after `yaw` and a little down */
  poleSpeaker(pos: THREE.Vector3, yaw: number, h = 4): void {
    this.rod('galv', pos, pos.clone().setY(pos.y + h), 0.045, 6);
    this.put('black', place(bevelBox(0.45, 0.7, 0.4), pos.x, pos.y + h + 0.1, pos.z, yaw, 0.2));
  }

  /** a sign board with a word on it, facing +Z after `yaw`; on two posts down to `ground` if given */
  sign(text: string, pos: THREE.Vector3, yaw: number, w = 1.6, h = 0.6, bg = '#14161a', fg = '#f2efe8', ground?: number): void {
    const key = `sign:${text}:${bg}:${fg}`;
    let mat = this.mats.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!mat) {
      const t = signTexture(text, bg, fg);
      this.mats.set(key, (mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.8 })));
    }
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('blackMetal', bevelBox(w + 0.06, h + 0.06, 0.04).applyMatrix4(m));
    this.put(mat, new THREE.PlaneGeometry(w, h).translate(0, 0, 0.022).applyMatrix4(m));
    if (ground !== undefined) for (const s of [-1, 1]) this.rod('galv', V((s * w) / 2.5, ground - pos.y, -0.03).applyMatrix4(m), V((s * w) / 2.5, h / 2, -0.03).applyMatrix4(m), 0.03, 6);
  }

  /** a bar under a peaked canvas roof: counter, lit back bar of bottles, bulbs along the eave; faces +Z after `yaw` */
  barTent(pos: THREE.Vector3, yaw: number, w = 10, word = 'BAR'): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    const at = (v: THREE.Vector3) => v.applyMatrix4(m);
    const dp = 4;
    for (const x of [-w / 2, 0, w / 2]) for (const z of [-dp / 2, dp / 2]) this.rod('galv', at(V(x, 0, z)), at(V(x, 2.6, z)), 0.04, 6);
    for (const sd of [-1, 1]) {
      const a = sd * 0.42;
      const depth = dp / 2 + 0.3;
      const c = depth / 2 - 0.15;
      this.put('canvas', new THREE.PlaneGeometry(w + 0.4, depth).rotateX(-Math.PI / 2).rotateX(a).translate(0, 2.6 + Math.sin(0.42) * (dp / 2 - c), sd * c * Math.cos(a)).applyMatrix4(m));
    }
    this.put('darkWood', bevelBox(w - 0.6, 1.05, 0.6).translate(0, 0.525, dp / 2 - 0.6).applyMatrix4(m));
    this.put('steel', bevelBox(w - 0.5, 0.05, 0.72).translate(0, 1.075, dp / 2 - 0.6).applyMatrix4(m));
    this.put('darkWood', bevelBox(w - 1, 2.0, 0.4).translate(0, 1.0, -dp / 2 + 0.4).applyMatrix4(m));
    const shelf = this.glow('#ffcf8a', 'steady', 1.1);
    const bottles: MatKey[] = ['green', 'cream', 'red', 'blue', 'alu'];
    for (let i = 0; i < 3; i++) {
      const y = 0.95 + i * 0.42;
      this.put(shelf, bevelBox(w - 1.2, 0.02, 0.06).translate(0, y - 0.02, -dp / 2 + 0.62).applyMatrix4(m));
      for (let x = -w / 2 + 0.8; x < w / 2 - 0.8; x += 0.11 + this.r() * 0.06) {
        const bh = 0.22 + this.r() * 0.1;
        this.put(bottles[Math.floor(this.r() * bottles.length)], new THREE.CylinderGeometry(0.03, 0.035, bh, 6).translate(x, y + bh / 2, -dp / 2 + 0.68).applyMatrix4(m));
      }
    }
    this.festoon(at(V(-w / 2, 2.5, dp / 2 + 0.05)), at(V(w / 2, 2.5, dp / 2 + 0.05)), 0.22, this.glow('#ffcf7a', 'breathe', 2), 0.5);
    this.sign(word, at(V(0, 3.1, dp / 2 + 0.2)), yaw, 2.2, 0.7, '#14161a', '#ffd23f');
  }

  /** a rug or blanket on the floor, tilted `tilt` (radians, front edge down) for a slope */
  rug(pos: THREE.Vector3, yaw: number, w: number, d: number, seed = 1, tilt = 0): void {
    const key = `rug:${seed % 4}`;
    let mat = this.mats.get(key);
    if (!mat) this.mats.set(key, (mat = new THREE.MeshStandardMaterial({ map: rugTexture(seed % 4), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    this.put(mat, place(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateX(tilt), pos.x, pos.y + 0.006, pos.z, yaw));
  }

  /** a pop-up gazebo w × w: legs, a pyramid roof and a valance */
  gazebo(pos: THREE.Vector3, yaw: number, w = 3, k: MatKey = 'cloth'): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.rod('alu', V((sx * w) / 2, 0, (sz * w) / 2).applyMatrix4(m), V((sx * w) / 2, 2.2, (sz * w) / 2).applyMatrix4(m), 0.022, 6);
    this.put(k, new THREE.ConeGeometry(w * Math.SQRT1_2 * 1.02, 0.8, 4, 1, true).rotateY(Math.PI / 4).translate(0, 2.6, 0).applyMatrix4(m));
    for (const [x, z, ry] of [[0, w / 2, 0], [0, -w / 2, 0], [w / 2, 0, Math.PI / 2], [-w / 2, 0, Math.PI / 2]]) this.put(k, new THREE.PlaneGeometry(w, 0.24).rotateY(ry).translate(x, 2.08, z).applyMatrix4(m));
  }

  /** a white folding table, its front +Z after `yaw`; `laptops` open on it, their screens lit and facing the front */
  foldingTable(pos: THREE.Vector3, yaw: number, w = 1.8, laptops = 0): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put('white', bevelBox(w, 0.04, 0.75).translate(0, 0.74, 0).applyMatrix4(m));
    for (const sx of [-1, 1]) {
      this.rod('galv', V((sx * (w - 0.2)) / 2, 0, -0.3).applyMatrix4(m), V((sx * (w - 0.2)) / 2, 0.72, -0.3).applyMatrix4(m), 0.014, 5);
      this.rod('galv', V((sx * (w - 0.2)) / 2, 0, 0.3).applyMatrix4(m), V((sx * (w - 0.2)) / 2, 0.72, 0.3).applyMatrix4(m), 0.014, 5);
    }
    const screen = this.glow('#9fc2ff', 'steady', 0.9);
    for (let i = 0; i < laptops; i++) {
      const x = (i - (laptops - 1) / 2) * 0.5;
      this.put('alu', bevelBox(0.33, 0.015, 0.23).translate(x, 0.768, 0.05).applyMatrix4(m));
      this.put('alu', bevelBox(0.33, 0.22, 0.008).rotateX(0.25).translate(x, 0.88, -0.08).applyMatrix4(m));
      this.put(screen, new THREE.PlaneGeometry(0.3, 0.19).rotateX(0.25).translate(x, 0.88, -0.075).applyMatrix4(m));
    }
  }

  /** steel crowd-control barriers (the bike-rack kind) from a to b */
  bikeRack(a: THREE.Vector3, b: THREE.Vector3, h = 1.1): void {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / 2.3));
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.3);
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, i / n).add(dir.clone().multiplyScalar(0.03));
      const q = a.clone().lerp(b, (i + 1) / n).sub(dir.clone().multiplyScalar(0.03));
      for (const y of [0.12, h]) this.rod('galv', p.clone().setY(a.y + y), q.clone().setY(a.y + y), 0.02, 5);
      for (const e of [p, q]) {
        this.rod('galv', e.clone().setY(a.y + 0.12), e.clone().setY(a.y + h), 0.02, 5);
        this.rod('galv', e.clone().add(side).setY(a.y), e.clone().sub(side).setY(a.y), 0.02, 4);
      }
      const seg = p.distanceTo(q);
      for (let t = 0.12; t < seg - 0.05; t += 0.13) {
        const c = p.clone().addScaledVector(dir, t);
        this.rod('galv', c.clone().setY(a.y + 0.12), c.clone().setY(a.y + h), 0.008, 4);
      }
    }
  }

  /** a parked car, nose +Z after `yaw`, its lights off but the side lights on */
  car(pos: THREE.Vector3, yaw: number, k: MatKey = 'grey'): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(pos);
    this.put(k, bevelBox(1.8, 0.7, 4.4).translate(0, 0.6, 0).applyMatrix4(m));
    // the cabin, its glass a dark band round the sides
    this.put(k, bevelBox(1.56, 0.5, 2.1).translate(0, 1.2, -0.25).applyMatrix4(m));
    this.put('black', bevelBox(1.6, 0.32, 1.9).translate(0, 1.2, -0.25).applyMatrix4(m));
    this.put('black', bevelBox(1.4, 0.34, 0.02).rotateX(-0.5).translate(0, 1.18, 0.82).applyMatrix4(m));
    for (const sx of [-1, 1]) for (const sz of [-1.35, 1.35]) this.put('rubber', new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14).rotateZ(Math.PI / 2).translate(sx * 0.85, 0.33, sz).applyMatrix4(m));
    const tail = this.glow('#ff2a1a', 'steady', 0.8);
    for (const sx of [-1, 1]) this.put(tail, bevelBox(0.3, 0.08, 0.02).translate(sx * 0.65, 0.78, -2.21).applyMatrix4(m));
  }

  /** a concrete planter with a shrub */
  planter(pos: THREE.Vector3, w = 1.2): void {
    this.box('stone', w, 0.55, w, pos.x, pos.y + 0.275, pos.z);
    this.box('trunk', w - 0.12, 0.02, w - 0.12, pos.x, pos.y + 0.55, pos.z);
    for (let i = 0; i < 4; i++) this.put('foliage', new THREE.IcosahedronGeometry(0.3 + this.r() * 0.15, 0).translate(pos.x + (this.r() - 0.5) * w * 0.5, pos.y + 0.75 + this.r() * 0.25, pos.z + (this.r() - 0.5) * w * 0.5));
  }

  /** sandbags weighing down a foot (a truss tower, a stand) */
  sandbags(pos: THREE.Vector3, n = 4, r = 0.45): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      this.put('canvas', place(new THREE.SphereGeometry(0.2, 8, 5).scale(1.4, 0.45, 0.9), pos.x + Math.cos(a) * r, pos.y + 0.08, pos.z + Math.sin(a) * r, -a));
    }
  }

  /* ---------------- instanced and decal extras ---------------- */

  /** plastic cups and cans on the floor (instanced), inside the rectangle; `ground` gives the height on a slope */
  litter(x0: number, x1: number, z0: number, z1: number, n: number, y = 0, ground?: (x: number, z: number) => number): void {
    const cups = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.032, 0.11, 8, 1, true), new THREE.MeshStandardMaterial({ roughness: 0.4, side: THREE.DoubleSide }), n);
    const cans = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 8), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.8 }), Math.ceil(n / 2));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const lying = this.r() < 0.7;
      q.setFromEuler(new THREE.Euler(lying ? Math.PI / 2 : 0, this.r() * Math.PI * 2, 0, 'YXZ'));
      const x = x0 + this.r() * (x1 - x0);
      const z = z0 + this.r() * (z1 - z0);
      m.compose(V(x, (ground ? ground(x, z) + 0.02 : y) + (lying ? 0.04 : 0.055), z), q, one);
      cups.setMatrixAt(i, m);
      cups.setColorAt(i, c.set(this.r() < 0.5 ? 0xd9e4ea : this.r() < 0.5 ? 0xc81f2a : 0x1f6fd0));
    }
    for (let i = 0; i < cans.count; i++) {
      q.setFromEuler(new THREE.Euler(Math.PI / 2, this.r() * Math.PI * 2, 0, 'YXZ'));
      const x = x0 + this.r() * (x1 - x0);
      const z = z0 + this.r() * (z1 - z0);
      m.compose(V(x, (ground ? ground(x, z) + 0.02 : y) + 0.033, z), q, one);
      cans.setMatrixAt(i, m);
      cans.setColorAt(i, c.setHSL(this.r(), 0.6, 0.45));
    }
    cups.frustumCulled = cans.frustumCulled = false;
    this.extra(cups);
    this.extra(cans);
  }

  /** the floor's wear (spills, scuffs, gaffer tape, glitter) over a rectangle, a few mm up */
  wear(x0: number, x1: number, z0: number, z1: number, y = 0, key = 'club', seed = 7, tone: 'dark' | 'light' = 'dark'): void {
    const t = wearTexture(key, seed, tone);
    const w = x1 - x0;
    const d = z1 - z0;
    const tex = t.clone();
    tex.userData = {};
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, w / 8), Math.max(1, d / 8));
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((x0 + x1) / 2, y + 0.004, (z0 + z1) / 2);
    plane.renderOrder = 1;
    this.extra(plane);
  }

  /** trodden mud over grass, a few cm up; `ground` makes it follow a slope */
  mud(x0: number, x1: number, z0: number, z1: number, y = 0, seed = 3, ground?: (x: number, z: number) => number): void {
    const w = x1 - x0;
    const d = z1 - z0;
    const tex = mudTexture(seed).clone();
    tex.userData = {};
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, w / 14), Math.max(1, d / 14));
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const g = new THREE.PlaneGeometry(w, d, ground ? Math.ceil(w / 2) : 1, ground ? Math.ceil(d / 2) : 1).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, ground ? ground(p.getX(i), p.getZ(i)) + 0.03 : y + 0.005);
    g.computeVertexNormals();
    const plane = new THREE.Mesh(g, mat);
    plane.renderOrder = 1;
    this.extra(plane);
  }

  /* ---------------- build and run ---------------- */

  /** merge everything into one mesh per material; call once, after the last piece */
  done(): this {
    for (const [mat, geos] of this.bins) {
      const tinted = this.family.has(mat);
      const flat = geos.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
        if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
        if (!n.attributes.normal) n.computeVertexNormals();
        if (tinted) {
          const c = (g.userData.tint as THREE.Color | undefined) ?? new THREE.Color(1, 1, 1);
          const col = new Float32Array(n.attributes.position.count * 3);
          for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
          n.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        return n;
      });
      const merged = mergeGeometries(flat, false);
      for (const g of geos) g.dispose();
      for (const g of flat) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.object.add(mesh);
    }
    this.bins.clear();
    for (const o of this.extras) this.object.add(o);
    this.extras = [];
    return this;
  }

  update(s: ShowState, dt: number): void {
    this.t += dt;
    const t = this.t;
    const m = 0.35 + 0.65 * s.master;
    for (const g of this.glows) {
      let k = 1;
      switch (g.mode) {
        case 'kick':
          k = 0.35 + s.kick * 1.1;
          break;
        case 'level':
          k = 0.3 + Math.min(1, s.level * 1.4);
          break;
        case 'blink':
          k = Math.sin(t * 3 + g.phase) > 0.6 ? 1 : 0.15;
          break;
        case 'flicker': {
          // neon hums, and now and then stutters (held steady when flashing is reduced)
          if (s.reduceFlash) break;
          const n = Math.sin(t * 47 + g.phase) * Math.sin(t * 13.3 + g.phase * 2);
          k = 0.92 + 0.08 * Math.sin(t * 120);
          if (n > 0.93) k *= 0.25;
          break;
        }
        case 'breathe':
          k = 0.8 + 0.2 * Math.sin(t * 0.9 + g.phase);
          break;
        case 'flame':
          k = 0.75 + 0.25 * Math.sin(t * 17 + g.phase) * Math.sin(t * 7.3 + g.phase);
          break;
        case 'palette':
          g.mat.color.copy(s.colors[g.slot % s.colors.length]).multiplyScalar(g.base.r * (0.6 + s.kick * 0.6) * m);
          continue;
      }
      g.mat.color.copy(g.base).multiplyScalar(k * (g.mode === 'steady' || g.mode === 'flame' || g.mode === 'breathe' ? 1 : m));
    }
  }
}
