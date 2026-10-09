/*
 * The avatar's painted textures, drawn on canvases:
 *   skin    the tone with its undertone, grain, freckles, beauty marks, a
 *           birthmark, vitiligo; on the face also eyeliner, eyeshadow,
 *           glitter, face paint, face gems and stubble; on a limb its tattoos
 *   uvPaint the parts of face paint that glow under blacklight
 *   iris    natural irises (with a different colour per eye allowed) and the
 *           fantasy ones: UV glow, mirrored, smiley and star pupils
 *   fabric  each pattern (solid, tie-dye, checkerboard, floral, camo,
 *           smiley, stripes, rave-flyer print) in the 3 colour zones, with
 *           the weave of the material (denim twill, mesh holes, sequins)
 * TODO: procedural stand-ins for the hand-painted textures the Blender
 * pipeline will bring (Section 14).
 */
import * as THREE from 'three';
import type { Look, Tattoo } from '../core/models';

const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgb = (c: [number, number, number], a = 1) => `rgba(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')},${a})`;
function shade(h: string, k: number): string {
  const [r, g, b] = hexToRgb(h);
  return rgb([r * k, g * k, b * k]);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

/** the skin tone with its undertone (warm pulls towards gold, cool towards rose) */
export function skinTone(look: Look): [number, number, number] {
  const [r, g, b] = hexToRgb(look.colors.skin ?? '#c48a64');
  const u = look.sliders.undertone ?? 0;
  return [r + (u > 0 ? u * 6 : -u * 10), g + (u > 0 ? -u * 4 : u * -2), b + (u > 0 ? u * 10 : u * 8)];
}

/**
 * Where a direction on the head sphere lands on its texture: three's sphere
 * UVs, u around (front = 0.25), v from the bottom.
 */
export function headUV(x: number, y: number, z: number): [number, number] {
  const len = Math.hypot(x, y, z) || 1;
  const theta = Math.acos(Math.max(-1, Math.min(1, y / len)));
  let phi = Math.atan2(z, -x);
  if (phi < 0) phi += Math.PI * 2;
  return [phi / (Math.PI * 2), 1 - theta / Math.PI];
}

export interface SkinOpts {
  face?: boolean;
  /** tattoos to paint (already filtered to this part) */
  tattoos?: Tattoo[];
  djName?: string;
  seed?: number;
}

/** The skin canvas for the head (face: true) or a body part. Returns colour and UV-glow canvases. */
export function skinCanvas(look: Look, o: SkinOpts = {}): { color: HTMLCanvasElement; glow: HTMLCanvasElement | null } {
  const W = o.face ? 1024 : 512;
  const H = o.face ? 512 : 512;
  const [c, g] = canvas(W, H);
  const r = rand((o.seed ?? 7) * 7919 + 13);
  const base = skinTone(look);
  g.fillStyle = rgb(base);
  g.fillRect(0, 0, W, H);
  // grain: a little mottling, more with "skin texture"
  const tex = look.sliders.skin_texture ?? 0;
  for (let i = 0; i < 1800 + tex * 4000; i++) {
    const k = 0.92 + r() * 0.16;
    g.fillStyle = rgb([base[0] * k, base[1] * k, base[2] * k], 0.12 + tex * 0.18);
    g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3);
  }
  // vitiligo: lighter, soft-edged patches
  const vit = look.sliders.vitiligo ?? 0;
  if (vit > 0.02) {
    const light = rgb([Math.min(255, base[0] * 0.55 + 120), Math.min(255, base[1] * 0.55 + 108), Math.min(255, base[2] * 0.55 + 100)]);
    for (let i = 0; i < Math.round(vit * 9); i++) {
      const x = r() * W;
      const y = r() * H;
      const rad = (0.04 + r() * 0.12) * Math.min(W, H) * (0.5 + vit);
      g.save();
      g.translate(x, y);
      g.fillStyle = light;
      g.filter = 'blur(2px)';
      g.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.4) {
        const rr = rad * (0.6 + r() * 0.5);
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.restore();
    }
    g.filter = 'none';
  }
  const fd = look.sliders.freckles_density ?? 0;
  const fs = look.sliders.freckles_spread ?? 0;
  const freckle = rgb([base[0] * 0.62, base[1] * 0.5, base[2] * 0.42], 0.55);
  const dot = (x: number, y: number, rad: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  };
  if (o.face) {
    // the face sits around u = 0.25: features are placed by where they are on the head
    const at = (x: number, y: number, z: number): [number, number] => {
      const [u, v] = headUV(x, y, z);
      return [u * W, (1 - v) * H];
    };
    // freckles across the nose and cheeks, wider with "spread"
    for (let i = 0; i < fd * 260; i++) {
      const ang = (r() - 0.5) * (0.9 + fs * 1.2);
      const y = -0.05 - r() * (0.25 + fs * 0.3);
      const [x, yy] = at(Math.sin(ang), y, Math.cos(ang));
      dot(x, yy, 0.8 + r() * 1.6, freckle);
    }
    // stubble and beard shadow on the lower face
    const fh = look.options.facial_hair ?? 'clean';
    if (fh !== 'clean') {
      const amount = fh.startsWith('stubble') ? { stubble_light: 0.25, stubble_medium: 0.45, stubble_heavy: 0.65 }[fh as 'stubble_light'] ?? 0.4 : 0.35;
      const hc = hexToRgb(look.colors.facial_hair ?? '#1d140e');
      for (let i = 0; i < 9000 * amount; i++) {
        const ang = (r() - 0.5) * 2.4;
        const y = -0.35 - r() * 0.6;
        const [x, yy] = at(Math.sin(ang), y, Math.cos(ang) * 0.9);
        g.fillStyle = rgb(hc, 0.18 + amount * 0.3);
        g.fillRect(x, yy, 1, 1.6);
      }
    }
    // beauty marks and a birthmark
    for (let i = 0; i < Math.round((look.sliders.beauty_marks ?? 0) * 4); i++) {
      const [x, yy] = at((r() - 0.5) * 1.2, -0.1 - r() * 0.5, 0.9);
      dot(x, yy, 1.6 + r(), rgb([base[0] * 0.4, base[1] * 0.3, base[2] * 0.25], 0.85));
    }
    if ((look.sliders.birthmark ?? 0) > 0.05) {
      const [x, yy] = at(0.7, 0.15, 0.6);
      g.fillStyle = rgb([base[0] * 0.8, base[1] * 0.6, base[2] * 0.55], 0.35 + (look.sliders.birthmark ?? 0) * 0.3);
      g.beginPath();
      g.ellipse(x, yy, 12, 8, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    // lips a touch deeper than the skin
    // (the lips are their own mesh; this is the blush of the cheeks)
    for (const side of [-1, 1]) {
      const [x, yy] = at(side * 0.62, -0.28, 0.75);
      const gr = g.createRadialGradient(x, yy, 0, x, yy, 34);
      gr.addColorStop(0, rgb([base[0] * 1.05 + 10, base[1] * 0.85, base[2] * 0.85], 0.25));
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - 40, yy - 40, 80, 80);
    }
    // eye makeup round each eye
    const liner = look.options.eyeliner ?? 'none';
    const shadowCol = look.colors.eyeshadow;
    const eyeX = 0.3 + (look.sliders.eye_spacing ?? 0) * 0.05;
    for (const side of [-1, 1]) {
      const [x, yy] = at(side * eyeX, 0.13, 0.93);
      if (shadowCol && liner !== 'none') {
        const gr = g.createRadialGradient(x, yy - 6, 2, x, yy - 6, 26);
        gr.addColorStop(0, rgb(hexToRgb(shadowCol), 0.55));
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x - 30, yy - 32, 60, 50);
      }
      if (liner !== 'none') {
        g.strokeStyle = liner === 'smudged' ? 'rgba(15,15,18,0.55)' : 'rgba(10,10,12,0.95)';
        g.lineWidth = liner === 'graphic' ? 4 : liner === 'smudged' ? 6 : 2.5;
        g.beginPath();
        g.moveTo(x - side * 16, yy - 2);
        g.quadraticCurveTo(x, yy - 7, x + side * 16, yy - 3);
        if (liner === 'wing' || liner === 'graphic') g.lineTo(x + side * 27, yy - 11);
        g.stroke();
        if (liner === 'graphic') {
          g.beginPath();
          g.moveTo(x - side * 14, yy + 7);
          g.lineTo(x + side * 20, yy + 4);
          g.stroke();
        }
      }
      // glitter on the lids and cheekbones
      const gl = look.sliders.glitter ?? 0;
      for (let i = 0; i < gl * 140; i++) {
        g.fillStyle = `hsla(${r() * 360},90%,85%,${0.6 + r() * 0.4})`;
        g.fillRect(x + (r() - 0.5) * 50, yy - 14 + (r() - 0.3) * 40, 1.5, 1.5);
      }
    }
  } else {
    // body: freckles on the shoulders and arms
    for (let i = 0; i < fd * 400 * (0.4 + fs); i++) dot(r() * W, r() * H, 0.8 + r() * 1.4, freckle);
    for (let i = 0; i < Math.round((look.sliders.beauty_marks ?? 0) * 3); i++) dot(r() * W, r() * H, 1.8, rgb([base[0] * 0.4, base[1] * 0.3, base[2] * 0.25], 0.8));
  }

  // tattoos on this part: limbs wrap round, so the design sits at the front (u 0.25) of the part
  for (const tt of o.tattoos ?? []) {
    const size = Math.min(W, H) * 0.36 * tt.size;
    drawTattoo(g, tt.design, W * 0.5, H * 0.5, size, tt.rot, tt.color, o.djName ?? '');
  }

  // face paint: printed parts on the skin, UV parts on a glow layer too
  let glow: HTMLCanvasElement | null = null;
  if (o.face) {
    const paint = look.options.face_paint ?? 'none';
    if (paint !== 'none') {
      const col = look.colors.paint ?? '#b6ff3b';
      const at = (x: number, y: number, z: number): [number, number] => {
        const [u, v] = headUV(x, y, z);
        return [u * W, (1 - v) * H];
      };
      const draw = (gg: CanvasRenderingContext2D) => {
        gg.fillStyle = col;
        gg.strokeStyle = col;
        if (paint === 'stripes' || paint === 'uv_stripes') {
          gg.lineWidth = 6;
          gg.lineCap = 'round';
          for (const side of [-1, 1])
            for (let k = 0; k < 3; k++) {
              const [x0, y0] = at(side * 0.42, -0.08 - k * 0.07, 0.85);
              const [x1, y1] = at(side * 0.72, -0.12 - k * 0.07, 0.6);
              gg.beginPath();
              gg.moveTo(x0, y0);
              gg.lineTo(x1, y1);
              gg.stroke();
            }
        } else if (paint === 'dots' || paint === 'uv_dots') {
          for (const side of [-1, 1])
            for (let k = 0; k < 7; k++) {
              const a = k / 6;
              const [x, y] = at(side * (0.35 + a * 0.35), 0.24 - Math.sin(a * Math.PI) * 0.12 - a * 0.1, 0.85 - a * 0.25);
              gg.beginPath();
              gg.arc(x, y, 3.2 - a * 1.2, 0, Math.PI * 2);
              gg.fill();
            }
        } else if (paint === 'gems') {
          for (const side of [-1, 1])
            for (let k = 0; k < 5; k++) {
              const [x, y] = at(side * (0.4 + k * 0.05), 0.05 - k * 0.012, 0.85);
              gg.fillStyle = `hsl(${(k * 60 + (side > 0 ? 30 : 200)) % 360},85%,70%)`;
              gg.beginPath();
              gg.moveTo(x, y - 4);
              gg.lineTo(x + 3, y);
              gg.lineTo(x, y + 4);
              gg.lineTo(x - 3, y);
              gg.fill();
            }
        }
      };
      draw(g);
      if (paint.startsWith('uv_') || paint === 'gems') {
        const [gc, gg] = canvas(W, H);
        gg.fillStyle = '#000';
        gg.fillRect(0, 0, W, H);
        draw(gg);
        glow = gc;
      }
    }
  }
  return { color: c, glow };
}

/** iris texture: sclera, the iris (with its style) and the pupil */
export function irisCanvas(color: string, style: string): HTMLCanvasElement {
  const [c, g] = canvas(256, 128);
  // the eyeball's UVs: front of the sphere at u = 0.25
  g.fillStyle = '#f2efe9';
  g.fillRect(0, 0, 256, 128);
  const cx = 64;
  const cy = 64;
  const R = 26;
  if (style === 'mirrored') {
    const gr = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, '#8c96a6');
    gr.addColorStop(1, '#e9eef5');
    g.fillStyle = gr;
  } else {
    const [r, gg, b] = hexToRgb(color);
    const gr = g.createRadialGradient(cx, cy, 4, cx, cy, R);
    gr.addColorStop(0, rgb([r * 1.4, gg * 1.4, b * 1.4]));
    gr.addColorStop(0.7, rgb([r, gg, b]));
    gr.addColorStop(1, rgb([r * 0.45, gg * 0.45, b * 0.45]));
    g.fillStyle = gr;
  }
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  // fibres
  if (style !== 'mirrored') {
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let a = 0; a < Math.PI * 2; a += 0.18) {
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
      g.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95);
      g.stroke();
    }
  }
  g.fillStyle = '#050505';
  if (style === 'star') {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? 4.5 : 11;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.fill();
  } else if (style === 'smiley') {
    g.beginPath();
    g.arc(cx, cy, 11, 0, Math.PI * 2);
    g.fillStyle = '#ffd400';
    g.fill();
    g.fillStyle = '#050505';
    g.fillRect(cx - 5, cy - 5, 2.5, 4);
    g.fillRect(cx + 2.5, cy - 5, 2.5, 4);
    g.lineWidth = 1.8;
    g.strokeStyle = '#050505';
    g.beginPath();
    g.arc(cx, cy, 6, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  } else if (style !== 'mirrored') {
    g.beginPath();
    g.arc(cx, cy, 9, 0, Math.PI * 2);
    g.fill();
  }
  // the catch-light
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.arc(cx - 8, cy - 9, 3.5, 0, Math.PI * 2);
  g.fill();
  return c;
}

/* ------------------------------------------------------------------ */
/* fabric                                                               */
/* ------------------------------------------------------------------ */

/**
 * A tileable fabric texture: the pattern in its 3 zones (zone 1 the main
 * colour, 2 the second, 3 the accent/print), plus the material's weave.
 */
export function fabricCanvas(pattern: string, zones: [string, string, string], material: string, seed = 1): HTMLCanvasElement {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rand(seed * 31 + 7);
  const [z1, z2, z3] = zones;
  g.fillStyle = z1;
  g.fillRect(0, 0, S, S);
  switch (pattern) {
    case 'tie_dye': {
      for (let i = 0; i < 6; i++) {
        const gr = g.createRadialGradient(r() * S, r() * S, 0, r() * S, r() * S, S * (0.3 + r() * 0.4));
        gr.addColorStop(0, [z2, z3][i % 2]);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, S, S);
      }
      g.strokeStyle = shade(z3, 1.1);
      g.globalAlpha = 0.25;
      for (let k = 1; k < 8; k++) {
        g.beginPath();
        g.arc(S / 2, S / 2, k * 18, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'checkerboard': {
      const n = 8;
      g.fillStyle = z2;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) % 2) g.fillRect((x * S) / n, (y * S) / n, S / n, S / n);
      break;
    }
    case 'floral': {
      for (let i = 0; i < 9; i++) {
        const x = r() * S;
        const y = r() * S;
        const rad = 14 + r() * 16;
        // wraps at the edges so it tiles
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          g.fillStyle = i % 2 ? z2 : z3;
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2;
            g.beginPath();
            g.ellipse(x + ox + Math.cos(a) * rad * 0.6, y + oy + Math.sin(a) * rad * 0.6, rad * 0.5, rad * 0.32, a, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = shade(z1, 0.6);
          g.beginPath();
          g.arc(x + ox, y + oy, rad * 0.22, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case 'camo': {
      for (const col of [z2, z3, shade(z1, 0.7)])
        for (let i = 0; i < 9; i++) {
          const x = r() * S;
          const y = r() * S;
          g.fillStyle = col;
          g.beginPath();
          for (let a = 0; a < Math.PI * 2; a += 0.5) {
            const rr = 16 + r() * 18;
            g.lineTo(x + Math.cos(a) * rr * 1.4, y + Math.sin(a) * rr);
          }
          g.fill();
        }
      break;
    }
    case 'smiley': {
      const face = (x: number, y: number, rad: number) => {
        g.fillStyle = z2 === z1 ? '#ffd400' : z2;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = z3;
        g.beginPath();
        g.ellipse(x - rad * 0.33, y - rad * 0.25, rad * 0.1, rad * 0.18, 0, 0, Math.PI * 2);
        g.ellipse(x + rad * 0.33, y - rad * 0.25, rad * 0.1, rad * 0.18, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = z3;
        g.lineWidth = rad * 0.1;
        g.beginPath();
        g.arc(x, y, rad * 0.58, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
      };
      // the one big print plus small ones round it (for the tee, the big one lands on the chest)
      face(S / 2, S / 2, S * 0.3);
      break;
    }
    case 'stripes': {
      g.fillStyle = z2;
      for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 14);
      g.fillStyle = z3;
      for (let y = 14; y < S; y += 32) g.fillRect(0, y, S, 3);
      break;
    }
    case 'flyer': {
      // a 90s flyer collage: chrome-ish blocks of type and stars
      g.fillStyle = z2;
      for (let i = 0; i < 7; i++) g.fillRect(r() * S, r() * S, 30 + r() * 80, 10 + r() * 16);
      g.fillStyle = z3;
      g.font = '900 30px "Barlow Condensed", sans-serif';
      for (let i = 0; i < 5; i++) g.fillText(['RAVE', 'HOUSE', 'ALL NITE', '★', 'LIVE'][i], r() * S * 0.8, 20 + r() * S);
      break;
    }
    default:
      break;
  }
  // the weave
  if (material === 'denim') {
    g.globalAlpha = 0.18;
    g.strokeStyle = '#ffffff';
    for (let k = -S; k < S; k += 4) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + S, S);
      g.stroke();
    }
    g.globalAlpha = 1;
  } else if (material === 'sequin') {
    for (let y = 0; y < S; y += 8)
      for (let x = (y / 8) % 2 ? 4 : 0; x < S; x += 8) {
        g.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.45})`;
        g.beginPath();
        g.arc(x, y, 3.2, 0, Math.PI * 2);
        g.fill();
      }
  } else if (material === 'cotton' || material === 'velvet') {
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},0.035)`;
      g.fillRect(r() * S, r() * S, 2, 2);
    }
  }
  return c;
}

/** mesh fabric: holes (alpha) */
export function meshAlphaCanvas(): HTMLCanvasElement {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#000';
  for (let y = 4; y < 64; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < 64; x += 8) {
    g.beginPath();
    g.arc(x, y, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* tattoos                                                              */
/* ------------------------------------------------------------------ */

const SCRIPTS: Record<string, string> = {
  script_house: 'house music',
  script_all_night: 'all night long',
  script_no_sleep: 'no sleep',
  script_love: 'love',
  script_one_more: 'one more tune',
  script_vibes: 'good vibes',
  script_date: '04 · 06 · 98',
  script_bass: 'BASS',
  script_dance: 'dance',
};

/** One of the 54 designs, drawn centred at (x, y), `size` across. Script designs can carry the DJ's name. */
export function drawTattoo(g: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, rot: number, color: string, djName = ''): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const s = size / 2;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = Math.max(1.5, size * 0.035);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.globalAlpha = 0.88;
  const circle = (cx: number, cy: number, r: number, fill = false) => {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) g.fill();
    else g.stroke();
  };
  const poly = (pts: [number, number][], close = true, fill = false) => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s)));
    if (close) g.closePath();
    if (fill) g.fill();
    else g.stroke();
  };
  const star = (n: number, r0: number, r1: number) => poly(Array.from({ length: n * 2 }, (_, i) => [Math.cos((i / (n * 2)) * Math.PI * 2 - Math.PI / 2) * (i % 2 ? r1 : r0), Math.sin((i / (n * 2)) * Math.PI * 2 - Math.PI / 2) * (i % 2 ? r1 : r0)]));
  const heart = (k = 1, fill = false) => {
    g.beginPath();
    g.moveTo(0, s * 0.6 * k);
    g.bezierCurveTo(-s * 1.1 * k, -s * 0.1 * k, -s * 0.5 * k, -s * 0.9 * k, 0, -s * 0.35 * k);
    g.bezierCurveTo(s * 0.5 * k, -s * 0.9 * k, s * 1.1 * k, -s * 0.1 * k, 0, s * 0.6 * k);
    if (fill) g.fill();
    else g.stroke();
  };
  if (id.startsWith('script_')) {
    const text = id === 'script_name' ? djName || 'DJ' : (SCRIPTS[id] ?? 'house');
    g.font = `400 ${Math.round(size * 0.32)}px "Pacifico", cursive`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = g.measureText(text).width;
    if (w > size * 1.6) g.scale((size * 1.6) / w, (size * 1.6) / w);
    g.fillText(text, 0, 0);
    g.restore();
    return;
  }
  switch (id) {
    case 'flash_heart':
      heart(1, true);
      g.fillStyle = 'rgba(255,255,255,0.0)';
      break;
    case 'flash_rose':
      for (let k = 0; k < 4; k++) circle(0, -s * 0.2, s * (0.15 + k * 0.12));
      poly([[0, 0.3], [0, 1]], false);
      poly([[0, 0.6], [-0.35, 0.45], [-0.15, 0.7]], true, true);
      break;
    case 'flash_swallow':
      poly([[-1, -0.2], [-0.2, 0], [0.4, -0.5], [0.2, 0.05], [1, 0.3], [0.1, 0.2], [-0.3, 0.6], [-0.2, 0.1]], true, true);
      break;
    case 'flash_anchor':
      poly([[0, -0.85], [0, 0.8]], false);
      circle(0, -s * 0.9, s * 0.12);
      poly([[-0.4, -0.5], [0.4, -0.5]], false);
      g.beginPath();
      g.arc(0, s * 0.35, s * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      break;
    case 'flash_dagger':
      poly([[0, -1], [0.15, 0.3], [0, 0.4], [-0.15, 0.3]], true, true);
      poly([[-0.4, 0.4], [0.4, 0.4]], false);
      poly([[0, 0.4], [0, 0.9]], false);
      break;
    case 'flash_star':
      star(5, 1, 0.42);
      break;
    case 'flash_lightning':
    case 'rave_bolt':
      poly([[0.2, -1], [-0.4, 0.1], [0, 0.1], [-0.2, 1], [0.45, -0.15], [0.05, -0.15]], true, true);
      break;
    case 'flash_eye':
    case 'rave_eye_pyramid':
      if (id === 'rave_eye_pyramid') poly([[0, -0.95], [0.95, 0.7], [-0.95, 0.7]]);
      g.beginPath();
      g.ellipse(0, 0, s * 0.6, s * 0.3, 0, 0, Math.PI * 2);
      g.stroke();
      circle(0, 0, s * 0.15, true);
      break;
    case 'flash_moon':
      g.beginPath();
      g.arc(0, 0, s * 0.8, 0.3 * Math.PI, 1.7 * Math.PI);
      g.arc(s * 0.3, 0, s * 0.62, 1.6 * Math.PI, 0.4 * Math.PI, true);
      g.fill();
      break;
    case 'flash_sun':
      circle(0, 0, s * 0.4);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        poly([[Math.cos(a) * 0.5, Math.sin(a) * 0.5], [Math.cos(a) * 0.9, Math.sin(a) * 0.9]], false);
      }
      break;
    case 'flash_snake':
      g.beginPath();
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        g.lineTo((t - 0.5) * size, Math.sin(t * Math.PI * 3) * s * 0.4);
      }
      g.lineWidth *= 2.2;
      g.stroke();
      break;
    case 'flash_wave':
    case 'music_waveform':
      g.beginPath();
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        const amp = id === 'music_waveform' ? Math.sin(t * 37) * Math.sin(t * Math.PI) : Math.sin(t * Math.PI * 2);
        g.lineTo((t - 0.5) * size, amp * s * 0.5);
      }
      g.stroke();
      break;
    case 'geo_triangle':
      poly([[0, -0.9], [0.8, 0.6], [-0.8, 0.6]]);
      poly([[0, -0.4], [0.4, 0.35], [-0.4, 0.35]]);
      break;
    case 'geo_circle':
      circle(0, 0, s * 0.85);
      circle(0, 0, s * 0.5);
      circle(0, 0, s * 0.12, true);
      break;
    case 'geo_hexagon':
      poly(Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * Math.PI * 2) * 0.85, Math.sin((i / 6) * Math.PI * 2) * 0.85] as [number, number]));
      poly(Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * Math.PI * 2 + 0.52) * 0.45, Math.sin((i / 6) * Math.PI * 2 + 0.52) * 0.45] as [number, number]));
      break;
    case 'geo_mandala':
      for (let k = 0; k < 12; k++) {
        g.save();
        g.rotate((k / 12) * Math.PI * 2);
        g.beginPath();
        g.ellipse(0, -s * 0.5, s * 0.13, s * 0.38, 0, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
      circle(0, 0, s * 0.18);
      break;
    case 'geo_lines':
      for (let k = -3; k <= 3; k++) poly([[k * 0.22, -0.9], [k * 0.22, 0.9]], false);
      break;
    case 'geo_dots':
      for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) circle(xx * s * 0.35, yy * s * 0.35, s * 0.07, true);
      break;
    case 'geo_cube':
      poly([[0, -0.9], [0.8, -0.45], [0.8, 0.45], [0, 0.9], [-0.8, 0.45], [-0.8, -0.45]]);
      poly([[0, 0], [0, 0.9]], false);
      poly([[0, 0], [0.8, -0.45]], false);
      poly([[0, 0], [-0.8, -0.45]], false);
      break;
    case 'geo_diamond':
      poly([[0, -0.95], [0.6, 0], [0, 0.95], [-0.6, 0]]);
      poly([[-0.6, 0], [0.6, 0]], false);
      break;
    case 'geo_spiral':
      g.beginPath();
      for (let k = 0; k < 200; k++) {
        const a = k * 0.12;
        g.lineTo(Math.cos(a) * a * s * 0.035, Math.sin(a) * a * s * 0.035);
      }
      g.stroke();
      break;
    case 'geo_grid':
      for (let k = -2; k <= 2; k++) {
        poly([[k * 0.35, -0.8], [k * 0.35, 0.8]], false);
        poly([[-0.8, k * 0.35], [0.8, k * 0.35]], false);
      }
      break;
    case 'geo_arrows':
      for (const d of [-0.5, 0, 0.5]) poly([[-0.8, d + 0.2], [0.6, d + 0.2], [0.6, d], [0.9, d + 0.25], [0.6, d + 0.5], [0.6, d + 0.3], [-0.8, d + 0.3]], true, true);
      break;
    case 'geo_bands':
      g.lineWidth = size * 0.1;
      poly([[-1, -0.3], [1, -0.3]], false);
      poly([[-1, 0.3], [1, 0.3]], false);
      break;
    case 'rave_smiley':
      circle(0, 0, s * 0.85);
      circle(-s * 0.3, -s * 0.2, s * 0.1, true);
      circle(s * 0.3, -s * 0.2, s * 0.1, true);
      g.beginPath();
      g.arc(0, 0, s * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      break;
    case 'rave_peace':
      circle(0, 0, s * 0.85);
      poly([[0, -0.85], [0, 0.85]], false);
      poly([[0, 0.1], [-0.6, 0.6]], false);
      poly([[0, 0.1], [0.6, 0.6]], false);
      break;
    case 'rave_yinyang':
      circle(0, 0, s * 0.85);
      g.beginPath();
      g.arc(0, 0, s * 0.85, -Math.PI / 2, Math.PI / 2);
      g.arc(0, s * 0.425, s * 0.425, Math.PI / 2, -Math.PI / 2, true);
      g.arc(0, -s * 0.425, s * 0.425, Math.PI / 2, -Math.PI / 2);
      g.fill();
      break;
    case 'rave_alien':
      g.beginPath();
      g.ellipse(0, 0, s * 0.6, s * 0.85, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(-s * 0.25, -s * 0.05, s * 0.2, s * 0.12, -0.5, 0, Math.PI * 2);
      g.ellipse(s * 0.25, -s * 0.05, s * 0.2, s * 0.12, 0.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'rave_flower':
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        circle(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45, s * 0.3);
      }
      circle(0, 0, s * 0.2, true);
      break;
    case 'rave_globe':
      circle(0, 0, s * 0.85);
      g.beginPath();
      g.ellipse(0, 0, s * 0.35, s * 0.85, 0, 0, Math.PI * 2);
      g.stroke();
      poly([[-0.85, 0], [0.85, 0]], false);
      break;
    case 'rave_planet':
      circle(0, 0, s * 0.5);
      g.beginPath();
      g.ellipse(0, 0, s * 0.95, s * 0.25, -0.3, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'rave_heart_beat':
      heart(0.9);
      poly([[-0.9, 0], [-0.3, 0], [-0.15, -0.4], [0.05, 0.4], [0.2, 0], [0.9, 0]], false);
      break;
    case 'music_note':
      circle(-s * 0.25, s * 0.55, s * 0.22, true);
      poly([[-0.03, 0.55], [-0.03, -0.8], [0.5, -0.6]], false);
      break;
    case 'music_headphones':
      g.beginPath();
      g.arc(0, 0, s * 0.7, Math.PI, 0);
      g.stroke();
      g.fillRect(-s * 0.85, 0, s * 0.3, s * 0.55);
      g.fillRect(s * 0.55, 0, s * 0.3, s * 0.55);
      break;
    case 'music_vinyl':
      circle(0, 0, s * 0.9);
      circle(0, 0, s * 0.6);
      circle(0, 0, s * 0.25, true);
      break;
    case 'music_eq':
      for (let k = 0; k < 7; k++) {
        const h = 0.3 + Math.abs(Math.sin(k * 1.7)) * 0.6;
        g.fillRect((k - 3.5) * s * 0.24, s * 0.8 - h * size * 0.8, s * 0.16, h * size * 0.8);
      }
      break;
    case 'music_speaker':
      g.strokeRect(-s * 0.6, -s * 0.9, s * 1.2, s * 1.8);
      circle(0, -s * 0.4, s * 0.25);
      circle(0, s * 0.35, s * 0.42);
      break;
    case 'music_cassette':
      g.strokeRect(-s * 0.9, -s * 0.55, s * 1.8, s * 1.1);
      circle(-s * 0.4, -s * 0.05, s * 0.15);
      circle(s * 0.4, -s * 0.05, s * 0.15);
      break;
    case 'music_turntable':
      g.strokeRect(-s * 0.9, -s * 0.7, s * 1.8, s * 1.4);
      circle(-s * 0.15, 0, s * 0.5);
      poly([[0.7, -0.5], [0.55, 0.2], [0.25, 0.3]], false);
      break;
    case 'music_mic':
      g.beginPath();
      g.ellipse(0, -s * 0.45, s * 0.28, s * 0.42, 0, 0, Math.PI * 2);
      g.stroke();
      poly([[0, 0], [0, 0.9]], false);
      poly([[-0.3, 0.9], [0.3, 0.9]], false);
      break;
    case 'music_clef':
      g.beginPath();
      for (let k = 0; k < 120; k++) {
        const a = k * 0.09;
        g.lineTo(Math.cos(a) * s * (0.6 - k * 0.004), Math.sin(a) * s * 0.5 + s * 0.2 - k * 0.006 * s);
      }
      g.stroke();
      poly([[0.05, -1], [0.05, 0.9]], false);
      break;
    default:
      star(5, 0.8, 0.35);
  }
  g.restore();
}
