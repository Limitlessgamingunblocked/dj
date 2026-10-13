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
  // cached across board builds: a board switch must not dispose it
  t.userData.shared = true;
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

/* ------------------------------------------------------------------ */
/* the record                                                           */
/* ------------------------------------------------------------------ */

/** a 12-inch record's radius (metres) */
export const RECORD_R = 0.1524;
const GROOVE_OUT = 0.06; // the run-out groove ends here
const GROOVE_IN = 0.1465; // the lead-in starts here
/** the silent bands between tracks: smooth, so they catch the light differently */
const TRACK_GAPS = [0.1305, 0.1135, 0.0975, 0.0795];

function recordZone(r: number): 'groove' | 'gap' | 'land' {
  if (r < GROOVE_OUT || r > GROOVE_IN) return 'land';
  for (const g of TRACK_GAPS) if (Math.abs(r - g) < 0.0009) return 'gap';
  return 'groove';
}

/** a small seeded random source, so a texture comes out the same on every build */
export function seeded(seed: number): () => number {
  let a = seed & 0x7fffffff;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

/** a texture across a disc of radius RECORD_R, filled pixel by pixel from (radius, planar uv offset) */
function discTex(key: string, S: number, srgb: boolean, px: (r: number, ux: number, uy: number, out: number[]) => void): THREE.CanvasTexture {
  return canvasTex(
    key,
    S,
    S,
    (g) => {
      const img = g.createImageData(S, S);
      const d = img.data;
      const out = [0, 0, 0];
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          // planar uv across the disc (canvas rows run down, v runs up)
          const ux = (x + 0.5) / S - 0.5;
          const uy = 0.5 - (y + 0.5) / S;
          px(Math.hypot(ux, uy) * 2 * RECORD_R, ux, uy, out);
          const i = (y * S + x) * 4;
          d[i] = out[0];
          d[i + 1] = out[1];
          d[i + 2] = out[2];
          d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    },
    srgb,
  );
}

/**
 * The record's surface, for a planar uv across the disc (discUV): a colour map
 * with the grooves' fine rings, a roughness map (the silent bands between
 * tracks and the run-out are smoother than the music) and an anisotropy map
 * pointing each texel's highlight along the radius. Across concentric grooves
 * a light spreads into a bright streak along the radius, the way a lamp over
 * the decks lights a real record, and the streak stays put as the record turns.
 */
export function vinylMaps(): { map: THREE.Texture; rough: THREE.Texture; aniso: THREE.Texture } {
  const rnd = seeded(0x2f6b1d);
  const RINGS = 4096;
  const ring = Array.from({ length: RINGS }, () => rnd());
  // louder passages cut wider grooves: they show as slightly brighter bands
  const band = Array.from({ length: 96 }, () => rnd());
  const ringAt = (r: number) => ring[Math.min(RINGS - 1, Math.floor((r / RECORD_R) * RINGS))];
  const bandAt = (r: number) => band[Math.min(95, Math.floor((r / RECORD_R) * 96))];
  const map = discTex('vinyl:map', 2048, true, (r, _x, _y, o) => {
    const z = recordZone(r);
    let v: number;
    if (z === 'groove') v = 8 + ringAt(r) * 9 + bandAt(r) * 7;
    else if (z === 'gap') v = 5;
    else v = r > RECORD_R - 0.0015 ? 12 : 6;
    o[0] = o[1] = v;
    o[2] = v + 1;
  });
  const rough = discTex('vinyl:rough', 1024, false, (r, _x, _y, o) => {
    const z = recordZone(r);
    const v = z === 'groove' ? 0.27 + ringAt(r) * 0.07 + bandAt(r) * 0.06 : z === 'gap' ? 0.14 : 0.12;
    o[0] = o[1] = o[2] = Math.round(v * 255);
  });
  const aniso = discTex('vinyl:aniso', 1024, false, (r, ux, uy, o) => {
    const z = recordZone(r);
    const len = Math.hypot(ux, uy) || 1;
    // the highlight's direction in the uv frame (the shader builds its tangent frame from the uv), packed 0..1
    o[0] = Math.round((0.5 + (0.5 * ux) / len) * 255);
    o[1] = Math.round((0.5 + (0.5 * uy) / len) * 255);
    o[2] = Math.round((z === 'groove' ? 1 : z === 'gap' ? 0.35 : 0.15) * 255);
  });
  // averaging directions across mip levels would shrink them towards nothing near the centre
  aniso.minFilter = THREE.LinearMipmapNearestFilter;
  return { map, rough, aniso };
}

/** Planar uvs across a disc of radius `r` lying in XZ (lathed records, mats and jog tops). */
export function discUV<T extends THREE.BufferGeometry>(g: T, r: number): T {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = 0.5 + p.getX(i) / (2 * r);
    uv[i * 2 + 1] = 0.5 - p.getZ(i) / (2 * r);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
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

/** A felt slipmat for a disc's planar uv: matted fibres with a logo screen-printed into them. */
export function slipmatTexture(text: string, color: string): THREE.Texture {
  return canvasTex(`slipmat:${text}:${color}`, 1024, 1024, (g, w, h) => {
    const r = seeded(0x51f15e);
    g.fillStyle = '#131315';
    g.fillRect(0, 0, w, h);
    const fibres = (n: number, alpha: number) => {
      g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const x = r() * w;
        const y = r() * h;
        const ang = r() * Math.PI * 2;
        const len = 2 + r() * 8;
        const v = r() < 0.16 ? 64 + r() * 46 : r() * 24;
        g.strokeStyle = `rgba(${v | 0},${v | 0},${(v + 3) | 0},${alpha * (0.5 + r() * 0.5)})`;
        g.lineWidth = 0.6 + r() * 0.9;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(ang + 1.2) * len * 0.6, y + Math.sin(ang + 1.2) * len * 0.6, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        g.stroke();
      }
    };
    fibres(22000, 0.42);
    g.save();
    g.translate(w / 2, h / 2);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.globalAlpha = 0.88;
    g.font = '700 92px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k < 2; k++) {
      g.fillText(text, 0, -300);
      g.rotate(Math.PI);
    }
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 0, 372, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
    // the fibres stand up through the print, so it reads as ink in felt, not a sticker
    fibres(7000, 0.3);
  });
}

/* ------------------------------------------------------------------ */
/* wear                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Roughness for a knob cap that gets turned all night: one polished patch
 * where the fingertip rests and a few hairline scratches, for a cap's planar
 * uv. Multiplies the cap's own roughness (white = as made).
 */
export function wornCapRoughness(): THREE.Texture {
  return canvasTex(
    'wear:cap',
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      const grad = g.createRadialGradient(w * 0.56, h * 0.44, 0, w * 0.56, h * 0.44, w * 0.44);
      grad.addColorStop(0, 'rgb(96,96,96)');
      grad.addColorStop(0.55, 'rgb(165,165,165)');
      grad.addColorStop(1, 'rgb(255,255,255)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,70,70,0.55)';
      g.lineWidth = 0.7;
      for (let i = 0; i < 7; i++) {
        const a = i * 2.3;
        g.beginPath();
        g.arc(w / 2, h / 2, 18 + i * 6, a, a + 0.6 + (i % 3) * 0.3);
        g.stroke();
      }
    },
    false,
  );
}

/**
 * Roughness along a lathed knob's profile (uv v runs base to top): the top of
 * the grip and the chamfer, where the fingers hold it, rubbed to a sheen.
 */
export function wornRubberRoughness(): THREE.Texture {
  return canvasTex(
    'wear:rubber',
    4,
    128,
    (g, w, h) => {
      // canvas top is v = 1, the knob's top
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgb(225,225,225)');
      grad.addColorStop(0.12, 'rgb(118,118,118)');
      grad.addColorStop(0.34, 'rgb(130,130,130)');
      grad.addColorStop(0.48, 'rgb(240,240,240)');
      grad.addColorStop(1, 'rgb(255,255,255)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    },
    false,
  );
}

/**
 * A jog top's roughness, for a disc's planar uv: the clean surface (`base`,
 * optionally finely brushed round the centre) with faint fingerprints and a
 * palm smear (`smudge`) on the half nearest the DJ, where the hand lands.
 */
export function fingerprintRoughness(base: number, smudge: number, brushed = false): THREE.Texture {
  return canvasTex(
    `wear:prints:${base}:${smudge}:${brushed}`,
    512,
    512,
    (g, w, h) => {
      const r = seeded(0x7e57);
      const b = Math.round(base * 255);
      g.fillStyle = `rgb(${b},${b},${b})`;
      g.fillRect(0, 0, w, h);
      if (brushed) {
        for (let k = 2; k < w / 2; k++) {
          const v = Math.max(0, Math.min(255, b + (r() - 0.5) * 60)) | 0;
          g.strokeStyle = `rgb(${v},${v},${v})`;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(w / 2, h / 2, k, 0, Math.PI * 2);
          g.stroke();
        }
      }
      const s = Math.round(smudge * 255);
      const print = (x: number, y: number, rx: number, ry: number, rot: number) => {
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.strokeStyle = `rgba(${s},${s},${s},0.3)`;
        g.lineWidth = 1.1;
        for (let k = 1; k < 9; k++) {
          const f = k / 9;
          g.beginPath();
          g.ellipse(r() * 1.5, k * 0.35, rx * f, ry * f, 0, -Math.PI * (0.85 + r() * 0.1), Math.PI * (0.05 + r() * 0.1));
          g.stroke();
        }
        g.restore();
      };
      // the near half of the disc is the canvas's lower half
      for (let i = 0; i < 6; i++) {
        const ang = Math.PI * (0.15 + r() * 0.7);
        const rad = w * (0.18 + r() * 0.22);
        print(w / 2 + Math.cos(ang) * rad, h / 2 + Math.sin(ang) * rad, 11 + r() * 5, 15 + r() * 6, ang + Math.PI / 2 + (r() - 0.5) * 0.6);
      }
      const grad = g.createRadialGradient(w * 0.42, h * 0.7, 0, w * 0.42, h * 0.7, w * 0.2);
      grad.addColorStop(0, `rgba(${s},${s},${s},0.22)`);
      grad.addColorStop(1, `rgba(${s},${s},${s},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    },
    false,
  );
}

/**
 * Knurling round a jog ring's rim, for a cylinder side's uv (u round, v up):
 * a fine diamond knurl in a band, as a normal map.
 */
export function knurlNormal(): THREE.Texture {
  const t = canvasTex(
    'knurl:normal',
    1024,
    32,
    (g, w, h) => {
      const img = g.createImageData(w, h);
      const d = img.data;
      const N = 360; // ridges round the rim
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = y / h;
          // a band of knurl across the middle of the rim, plain lands above and below
          const inBand = v > 0.18 && v < 0.82 ? 1 : 0;
          const a = (x / w) * N * Math.PI * 2;
          const k = 0.5 * (Math.sin(a + v * 24) + Math.sin(a - v * 24));
          const nx = -Math.cos(a) * 0.55 * inBand;
          const ny = 0.12 * k * inBand;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          const i = (y * w + x) * 4;
          d[i] = (nx * 0.5 + 0.5) * 255;
          d[i + 1] = (ny * 0.5 + 0.5) * 255;
          d[i + 2] = (nz * 0.5 + 0.5) * 255;
          d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    },
    false,
  );
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export interface MatSet {
  rubber: THREE.MeshStandardMaterial;
  /** the rubber of a knob that gets turned all night: polished where the fingers grip */
  rubberWorn: THREE.MeshStandardMaterial;
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
    rubber: new THREE.MeshStandardMaterial({ color: 0x25282e, roughness: 0.6, metalness: 0 }),
    rubberWorn: new THREE.MeshStandardMaterial({ color: 0x272a30, roughness: 0.62, metalness: 0, roughnessMap: wornRubberRoughness() }),
    rubberLight: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0 }),
    plasticDark: new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.45, metalness: 0.1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.18, metalness: 1 }),
    aluminium: new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.38, metalness: 1, roughnessMap: radialBrushed() }),
    black: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 }),
    white: new THREE.MeshBasicMaterial({ color: 0xf2f4f8 }),
    slot: new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
    faderCap: new THREE.MeshStandardMaterial({ color: 0x33373e, roughness: 0.42, metalness: 0.15 }),
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
