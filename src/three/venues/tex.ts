/* Procedural canvas textures for the venues (cached, shared between builds). */
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

export function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, o: { srgb?: boolean; repeat?: boolean } = {}): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.userData.shared = true;
  cache.set(key, t);
  return t;
}

/** Seeded RNG so procedural details are the same on every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Box truss side: two chords along the length (v) and a zig-zag lattice (alpha-tested). */
export function trussTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'truss',
    64,
    256,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#d7dbe2';
      g.lineCap = 'round';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(5, 0);
      g.lineTo(5, h);
      g.moveTo(w - 5, 0);
      g.lineTo(w - 5, h);
      g.stroke();
      g.lineWidth = 4;
      g.beginPath();
      for (let i = 0; i <= 4; i++) {
        const y = (i / 4) * h;
        g.moveTo(5, y);
        g.lineTo(w - 5, y + h / 8);
        g.lineTo(5, y + h / 4);
      }
      g.stroke();
    },
    { repeat: true },
  );
}

/** Speaker front: grille mesh with the cone layout showing through. */
export function grilleTexture(layout: 'mid' | 'sub' | 'monitor' | 'top'): THREE.CanvasTexture {
  return canvasTexture(`grille:${layout}`, 256, 256, (g, w, h) => {
    g.fillStyle = '#0b0b0d';
    g.fillRect(0, 0, w, h);
    const cone = (x: number, y: number, r: number) => {
      const grad = g.createRadialGradient(x, y, r * 0.1, x, y, r);
      grad.addColorStop(0, '#2a2b30');
      grad.addColorStop(0.25, '#101114');
      grad.addColorStop(0.8, '#1b1c20');
      grad.addColorStop(0.95, '#333439');
      grad.addColorStop(1, '#0b0b0d');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    if (layout === 'sub') cone(w / 2, h / 2, w * 0.42);
    else if (layout === 'mid') {
      cone(w * 0.3, h * 0.62, w * 0.2);
      cone(w * 0.7, h * 0.62, w * 0.2);
      g.fillStyle = '#16171b';
      g.fillRect(w * 0.18, h * 0.12, w * 0.64, h * 0.22);
    } else if (layout === 'monitor') {
      cone(w / 2, h * 0.64, w * 0.3);
      cone(w / 2, h * 0.22, w * 0.1);
    } else {
      cone(w * 0.28, h / 2, w * 0.17);
      cone(w * 0.72, h / 2, w * 0.17);
      g.fillStyle = '#16171b';
      g.fillRect(w * 0.45, h * 0.3, w * 0.1, h * 0.4);
    }
    g.globalAlpha = 0.35;
    g.fillStyle = '#000';
    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < w; x += 4) g.fillRect(x, y, 2, 2);
    g.globalAlpha = 1;
  });
}

/** Board-marked concrete. */
export function concreteTexture(tone = 60): THREE.CanvasTexture {
  return canvasTexture(
    `concrete:${tone}`,
    512,
    512,
    (g, w, h) => {
      g.fillStyle = `rgb(${tone},${tone},${tone + 2})`;
      g.fillRect(0, 0, w, h);
      const r = rng(tone * 7 + 3);
      for (let i = 0; i < 9000; i++) {
        const v = tone + (r() - 0.5) * 36;
        g.fillStyle = `rgba(${v},${v},${v + 2},0.35)`;
        const s = 1 + r() * 3;
        g.fillRect(r() * w, r() * h, s, s);
      }
      // formwork lines and stains
      g.strokeStyle = `rgba(0,0,0,0.25)`;
      g.lineWidth = 2;
      for (let y = 0; y < h; y += 128) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      for (let i = 0; i < 14; i++) {
        const x = r() * w;
        const grad = g.createLinearGradient(x, 0, x, h);
        grad.addColorStop(0, 'rgba(0,0,0,0.18)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x, r() * h * 0.5, 6 + r() * 20, h * 0.5);
      }
    },
    { repeat: true },
  );
}

/** Dark painted floor with scuffs. */
export function floorTexture(base: string, key: string): THREE.CanvasTexture {
  return canvasTexture(
    `floor:${key}`,
    512,
    512,
    (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      const r = rng(hashString(key));
      for (let i = 0; i < 260; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.015 + r() * 0.03})`;
        g.lineWidth = 1 + r() * 2;
        g.beginPath();
        const x = r() * w;
        const y = r() * h;
        g.moveTo(x, y);
        g.quadraticCurveTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60, x + (r() - 0.5) * 120, y + (r() - 0.5) * 120);
        g.stroke();
      }
      for (let i = 0; i < 6000; i++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.25})`;
        g.fillRect(r() * w, r() * h, 2, 2);
      }
    },
    { repeat: true },
  );
}

/** Building facade: grid of windows, some lit. */
export function windowsTexture(key: string, lit: string, density = 0.45): THREE.CanvasTexture {
  return canvasTexture(
    `windows:${key}`,
    256,
    512,
    (g, w, h) => {
      g.fillStyle = '#0d0f14';
      g.fillRect(0, 0, w, h);
      const r = rng(hashString(key));
      const cols = 8;
      const rows = 24;
      const cw = w / cols;
      const rh = h / rows;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const on = r() < density;
          g.fillStyle = on ? lit : '#151923';
          g.globalAlpha = on ? 0.55 + r() * 0.45 : 1;
          g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.6);
        }
      }
      g.globalAlpha = 1;
    },
    { repeat: true },
  );
}

/** Night sky with city glow at the horizon (vertical gradient, used on a dome). */
export function skyTexture(key: string, top: string, mid: string, horizon: string): THREE.CanvasTexture {
  return canvasTexture(`sky:${key}`, 16, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(0.55, mid);
    grad.addColorStop(0.9, horizon);
    grad.addColorStop(1, horizon);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** Soft round sprite for particles and glows. */
export function softDotTexture(): THREE.CanvasTexture {
  return canvasTexture('softdot', 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** Cloudy smoke puff for CO2 and haze. */
export function smokeTexture(): THREE.CanvasTexture {
  return canvasTexture('smoke', 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(99);
    for (let i = 0; i < 26; i++) {
      const x = w / 2 + (r() - 0.5) * w * 0.45;
      const y = h / 2 + (r() - 0.5) * h * 0.45;
      const rad = w * (0.12 + r() * 0.22);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  });
}

/** Mirror ball facets. */
export function mirrorBallTexture(): THREE.CanvasTexture {
  return canvasTexture('mirrorball', 512, 256, (g, w, h) => {
    const r = rng(5);
    const n = 48;
    const m = 24;
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < n; x++) {
        const v = 120 + r() * 135;
        g.fillStyle = `rgb(${v},${v},${v + 8})`;
        g.fillRect((x / n) * w, (y / m) * h, w / n - 1, h / m - 1);
      }
    }
  });
}

/** Foliage clump alpha texture for trees. */
export function foliageTexture(): THREE.CanvasTexture {
  return canvasTexture('foliage', 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(42);
    for (let i = 0; i < 420; i++) {
      const x = w / 2 + (r() - 0.5) * w * 0.85 * Math.sqrt(r());
      const y = h / 2 + (r() - 0.5) * h * 0.85 * Math.sqrt(r());
      const v = 18 + r() * 40;
      g.fillStyle = `rgb(${v * 0.7},${v},${v * 0.6})`;
      g.beginPath();
      g.ellipse(x, y, 5 + r() * 9, 3 + r() * 6, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/* ------------------------------------------------------------------ */
/* surface detail: normal + roughness maps from a procedural height field */
/* ------------------------------------------------------------------ */

const surfaceCache = new Map<string, { normal: THREE.CanvasTexture; rough: THREE.CanvasTexture }>();

export interface SurfaceOptions {
  /** large-scale undulation (0..1) */
  bumps?: number;
  /** small aggregate pits and grains (0..1) */
  grain?: number;
  /** straight seams (formwork lines, floor joints) every `seams` px of the 256 px tile, 0 = none */
  seams?: number;
  /** base roughness (0..1) and how much it varies */
  rough?: number;
  roughVar?: number;
  /** worn, polished paths: patches that are smoother than the rest (0..1) */
  polish?: number;
}

/** Tileable value noise on a size×size grid. */
function tileNoise(size: number, cells: number, r: () => number): Float32Array {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx) % cells;
      const y0 = Math.floor(fy) % cells;
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      let tx = fx - Math.floor(fx);
      let ty = fy - Math.floor(fy);
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const a = g[y0 * cells + x0] + (g[y0 * cells + x1] - g[y0 * cells + x0]) * tx;
      const b = g[y1 * cells + x0] + (g[y1 * cells + x1] - g[y1 * cells + x0]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/**
 * The pixel data behind `surfaceMaps`: RGBA normal map (tangent space, +Z out
 * of the surface) and RGBA roughness map, size×size, tileable, deterministic
 * per key. Pure, so it runs (and is tested) without a canvas.
 */
export function surfaceData(key: string, o: SurfaceOptions = {}, S = 256): { normal: Uint8ClampedArray; rough: Uint8ClampedArray } {
  const r = rng(hashString(key));
  const bumps = o.bumps ?? 0.5;
  const grain = o.grain ?? 0.5;
  const h = new Float32Array(S * S);
  const n1 = tileNoise(S, 6, r);
  const n2 = tileNoise(S, 16, r);
  const n3 = tileNoise(S, 48, r);
  for (let i = 0; i < h.length; i++) h[i] = n1[i] * bumps * 0.6 + n2[i] * 0.25 + n3[i] * grain * 0.35;
  // aggregate pits
  for (let k = 0; k < 900 * grain * (S / 256) ** 2; k++) {
    const cx = Math.floor(r() * S);
    const cy = Math.floor(r() * S);
    const rad = 1 + Math.floor(r() * 2.5);
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const i = ((cy + dy + S) % S) * S + ((cx + dx + S) % S);
        h[i] -= 0.25;
      }
  }
  if (o.seams) for (let y = 0; y < S; y += o.seams) for (let x = 0; x < S; x++) h[y * S + x] -= 0.4;
  // normals by central differences (wrapping, so the tile stays seamless)
  const normal = new Uint8ClampedArray(S * S * 4);
  const strength = 2.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hl = h[y * S + ((x + S - 1) % S)];
      const hr = h[y * S + ((x + 1) % S)];
      const hu = h[((y + S - 1) % S) * S + x];
      const hd = h[((y + 1) % S) * S + x];
      let nx = (hl - hr) * strength;
      let ny = (hu - hd) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const j = (y * S + x) * 4;
      normal[j] = (nx * 0.5 + 0.5) * 255;
      normal[j + 1] = (ny * 0.5 + 0.5) * 255;
      normal[j + 2] = (nz * 0.5 + 0.5) * 255;
      normal[j + 3] = 255;
    }
  }
  // roughness in every channel (three.js reads G)
  const rough = new Uint8ClampedArray(S * S * 4);
  const base = o.rough ?? 0.8;
  const vary = o.roughVar ?? 0.15;
  const polish = o.polish ?? 0;
  for (let i = 0; i < S * S; i++) {
    let v = base + (n2[i] - 0.5) * vary * 2 + (n3[i] - 0.5) * vary;
    if (polish > 0) v -= Math.max(0, n1[i] - 0.45) * polish * 1.4;
    const c = Math.max(0.04, Math.min(1, v)) * 255;
    const j = i * 4;
    rough[j] = c;
    rough[j + 1] = c;
    rough[j + 2] = c;
    rough[j + 3] = 255;
  }
  return { normal, rough };
}

/**
 * Normal and roughness maps (linear, tileable, 256 px) for concrete, painted
 * floors and similar surfaces, so lights catch real relief and patchy shine.
 */
export function surfaceMaps(key: string, o: SurfaceOptions = {}): { normal: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const hit = surfaceCache.get(key);
  if (hit) return hit;
  const S = 256;
  const data = surfaceData(key, o, S);
  const mk = (px: Uint8ClampedArray) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    img.data.set(px);
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.userData.shared = true;
    return t;
  };
  const out = { normal: mk(data.normal), rough: mk(data.rough) };
  surfaceCache.set(key, out);
  return out;
}

/**
 * Apply surface detail to a standard material: normal + roughness maps with
 * the same repeat as its colour map (or `repeat`).
 */
export function withSurface<T extends THREE.MeshStandardMaterial>(m: T, key: string, o: SurfaceOptions & { repeat?: number; normalScale?: number } = {}): T {
  const maps = surfaceMaps(key, o);
  const rep = o.repeat ?? (m.map ? m.map.repeat.x : 4);
  // shared maps can't carry per-material repeats: clone the textures (same image, own repeat)
  const normal = maps.normal.clone();
  const rough = maps.rough.clone();
  for (const t of [normal, rough]) {
    t.repeat.set(rep, rep);
    t.userData.shared = false;
    t.needsUpdate = true;
  }
  m.normalMap = normal;
  m.normalScale.set(o.normalScale ?? 0.8, o.normalScale ?? 0.8);
  m.roughnessMap = rough;
  m.roughness = 1;
  m.needsUpdate = true;
  return m;
}
