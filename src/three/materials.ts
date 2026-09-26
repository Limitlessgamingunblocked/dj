/* Shared PBR materials and procedurally generated textures. */
import * as THREE from 'three';

const texCache = new Map<string, THREE.Texture>();

function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const hit = texCache.get(key) as THREE.CanvasTexture | undefined;
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/** Radial brushed-metal roughness map (for platters and jog tops). */
export function radialBrushed(): THREE.Texture {
  return canvasTex(
    'radialBrushed',
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#7a7a7a';
      g.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      for (let r = 2; r < w / 2; r += 1) {
        const v = 100 + Math.random() * 70;
        g.strokeStyle = `rgb(${v},${v},${v})`;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      }
    },
    false,
  );
}

/** Linear brushed metal (top plates). */
export function linearBrushed(): THREE.Texture {
  const t = canvasTex(
    'linearBrushed',
    1024,
    256,
    (g, w, h) => {
      g.fillStyle = '#808080';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y++) {
        const v = 110 + Math.random() * 60;
        g.fillStyle = `rgba(${v},${v},${v},0.6)`;
        g.fillRect(0, y, w, 1);
      }
    },
    false,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Vinyl record surface with grooves and a label area left transparent-ish. */
export function vinylTexture(): THREE.Texture {
  return canvasTex('vinyl', 1024, 1024, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = '#060606';
    g.fillRect(0, 0, w, h);
    for (let r = w * 0.17; r < w * 0.495; r += 1.3) {
      const shade = 8 + Math.random() * 16 + (Math.floor(r) % 97 < 3 ? 18 : 0); // track gaps
      g.strokeStyle = `rgb(${shade},${shade},${shade + 2})`;
      g.lineWidth = 0.8;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    // sheen
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0.35, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    grad.addColorStop(0.65, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, w * 0.495, 0, Math.PI * 2);
    g.fill();
  });
}

/** Strobe dot pattern for the platter edge. */
export function strobeTexture(): THREE.Texture {
  const t = canvasTex('strobe', 1024, 64, (g, w, h) => {
    g.fillStyle = '#b8bcc4';
    g.fillRect(0, 0, w, h);
    const rows = 4;
    const counts = [180, 183, 186, 189];
    for (let r = 0; r < rows; r++) {
      const n = counts[r] / 3;
      for (let i = 0; i < n; i++) {
        g.fillStyle = '#2a2d33';
        g.fillRect((i / n) * w, r * (h / rows) + 3, (w / n) * 0.45, h / rows - 6);
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Oiled walnut for mixer cheeks. */
export function woodTexture(): THREE.Texture {
  return canvasTex('walnut', 256, 512, (g, w, h) => {
    g.fillStyle = '#4a2e1a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w;
      const v = Math.random();
      g.strokeStyle = v < 0.5 ? `rgba(30,16,8,${0.2 + v * 0.4})` : `rgba(120,80,45,${(v - 0.5) * 0.5})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * 0.02 + i) * 6 + Math.sin(y * 0.005 + i * 3) * 10, y);
      g.stroke();
    }
  });
}

export function slipmatTexture(text: string, color: string): THREE.Texture {
  return canvasTex(`slipmat:${text}:${color}`, 512, 512, (g, w, h) => {
    g.fillStyle = '#101012';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const v = Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.save();
    g.translate(w / 2, h / 2);
    g.fillStyle = color;
    g.font = '700 46px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    for (let k = 0; k < 2; k++) {
      g.fillText(text, 0, -150);
      g.rotate(Math.PI);
    }
    g.restore();
  });
}

export interface MatSet {
  rubber: THREE.MeshStandardMaterial;
  rubberLight: THREE.MeshStandardMaterial;
  plasticDark: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  aluminium: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  white: THREE.MeshBasicMaterial;
  slot: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  faderCap: THREE.MeshStandardMaterial;
  jogRing: THREE.MeshStandardMaterial;
  platterMetal: THREE.MeshStandardMaterial;
}

let shared: MatSet | null = null;

export function mats(): MatSet {
  if (shared) return shared;
  shared = {
    rubber: new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.78, metalness: 0 }),
    rubberLight: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0 }),
    plasticDark: new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.45, metalness: 0.1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.18, metalness: 1 }),
    aluminium: new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.38, metalness: 1, roughnessMap: radialBrushed() }),
    black: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 }),
    white: new THREE.MeshBasicMaterial({ color: 0xf2f4f8 }),
    slot: new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
    faderCap: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.2 }),
    jogRing: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 }),
    platterMetal: new THREE.MeshStandardMaterial({ color: 0xc7cbd2, roughness: 0.32, metalness: 1, roughnessMap: radialBrushed() }),
  };
  return shared;
}

/** Rounded rectangle plane lying in XZ, facing +Y, with 0..1 UVs across the full rect. */
export function roundedRectPlane(w: number, d: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -d / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + d - r);
  s.quadraticCurveTo(x0 + w, y0 + d, x0 + w - r, y0 + d);
  s.lineTo(x0 + r, y0 + d);
  s.quadraticCurveTo(x0, y0 + d, x0, y0 + d - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const g = new THREE.ShapeGeometry(s, 6);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, (x - x0) / w, (y - y0) / d);
  }
  // shape lies in XY facing +Z; rotate to face +Y. Shape +Y maps to −Z (far edge),
  // which with flipY textures puts the top row of the canvas at the far edge.
  g.rotateX(-Math.PI / 2);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

export function color(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
