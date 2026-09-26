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

/** Glowing neon lettering on a transparent background (used additively). */
export function neonTextTexture(key: string, lines: string[], color: string, o: { w?: number; h?: number; font?: string; outline?: boolean } = {}): THREE.CanvasTexture {
  const W = o.w ?? 1024;
  const H = o.h ?? 512;
  return canvasTexture(`neon:${key}`, W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const size = (H / lines.length) * 0.62;
    g.font = o.font ?? `900 ${size}px "Barlow Condensed", "Arial Black", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((line, i) => {
      const y = (H / lines.length) * (i + 0.5);
      for (const [blur, alpha, width] of [
        [28, 0.55, 10],
        [12, 0.8, 6],
        [0, 1, 3],
      ] as const) {
        g.shadowColor = color;
        g.shadowBlur = blur;
        g.globalAlpha = alpha;
        g.strokeStyle = blur ? color : '#fff4f6';
        g.lineWidth = width;
        if (o.outline !== false) g.strokeText(line, W / 2, y);
        else {
          g.fillStyle = blur ? color : '#fff4f6';
          g.fillText(line, W / 2, y);
        }
      }
    });
    g.globalAlpha = 1;
    g.shadowBlur = 0;
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

/** Lettering on a light box / wall sign (opaque). */
export function signTexture(key: string, text: string, o: { bg: string; fg: string; font: string; w?: number; h?: number; glow?: string }): THREE.CanvasTexture {
  const W = o.w ?? 1024;
  const H = o.h ?? 256;
  return canvasTexture(`sign:${key}`, W, H, (g) => {
    g.fillStyle = o.bg;
    g.fillRect(0, 0, W, H);
    g.font = o.font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (o.glow) {
      g.shadowColor = o.glow;
      g.shadowBlur = 30;
    }
    g.fillStyle = o.fg;
    g.fillText(text, W / 2, H / 2 + H * 0.03);
    g.shadowBlur = 0;
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
