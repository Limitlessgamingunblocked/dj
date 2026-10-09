/*
 * Detail that makes hardware read as real (shared by the preset boards and
 * the Board Builder's parts), from how the gear is actually made:
 *   knobs       rubber-coated bodies with fine vertical knurling for grip, a
 *               flange skirt at the base, a chamfered top with a contrasting
 *               cap and a white pointer line (club mixer EQs are ~16–18 mm)
 *   fader caps  pro caps are ~22 mm across the slot, ~12 mm along it, ~14 mm
 *               tall, with grip ridges across the top and a centre line
 *   slots       the slot is cut through the faceplate, dark inside, with a
 *               printed scale either side
 *   metal tops  jog plates and knob inserts are turned aluminium: fine
 *               concentric rings that catch the light
 *   vinyl       fine grooves in bands, with the run-out near the label
 *   panels      held together with screws at the corners
 * TODO: procedural stand-ins for the Blender component models (Section 14).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const geoCache = new Map<string, THREE.BufferGeometry>();
const texCache = new Map<string, THREE.Texture>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/**
 * A knob body: flange skirt, knurled grip band, chamfered top. `ribs` grip
 * ridges round the side (0 for smooth), `depth` how far they stand out.
 */
export function knurledKnob(r: number, h: number, ribs = 40, depth = 0.045): THREE.BufferGeometry {
  return cached(`knob|${r.toFixed(5)}|${h.toFixed(5)}|${ribs}|${depth}`, () => {
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(r * 1.16, 0),
      new THREE.Vector2(r * 1.16, h * 0.1),
      new THREE.Vector2(r * 1.1, h * 0.16),
      new THREE.Vector2(r, h * 0.2),
      new THREE.Vector2(r, h * 0.84),
      new THREE.Vector2(r * 0.94, h * 0.95),
      new THREE.Vector2(r * 0.86, h),
      new THREE.Vector2(0, h),
    ];
    const segs = ribs > 0 ? Math.min(240, ribs * 4) : 48;
    const g = new THREE.LatheGeometry(pts, segs);
    if (ribs > 0) {
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < h * 0.22 || y > h * 0.83) continue;
        const x = p.getX(i);
        const z = p.getZ(i);
        const a = Math.atan2(x, z);
        // flat-topped ridges: grip you can see from across the booth
        const k = 1 + depth * Math.min(1, Math.max(0, Math.cos(a * ribs) * 1.6 + 0.2));
        p.setXYZ(i, x * k, y, z * k);
      }
      g.computeVertexNormals();
    }
    return g;
  });
}

/** a pro fader cap: rounded body with grip ridges across the top (w across the slot, d along it) */
export function faderCapGeometry(w: number, h: number, d: number, ridges = 3): THREE.BufferGeometry {
  return cached(`cap|${w}|${h}|${d}|${ridges}`, () => {
    const parts: THREE.BufferGeometry[] = [new RoundedBoxGeometry(w, h, d, 3, Math.min(w, d) * 0.18).translate(0, h / 2, 0)];
    for (let i = 0; i < ridges; i++) {
      const z = ridges === 1 ? 0 : (i / (ridges - 1) - 0.5) * d * 0.62;
      parts.push(new RoundedBoxGeometry(w * 0.9, h * 0.08, d * 0.09, 1, d * 0.03).translate(0, h + h * 0.03, z));
    }
    return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  });
}

/** canvas texture helper (shared, never disposed per use) */
function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  let t = texCache.get(key) as THREE.CanvasTexture | undefined;
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.shared = true;
  texCache.set(key, t);
  return t;
}

/** turned aluminium: fine concentric rings (jog plates, knob caps, platter tops) */
export function turnedMetalTexture(): THREE.CanvasTexture {
  return tex('turned', 512, 512, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = '#9ea4ac';
    g.fillRect(0, 0, w, h);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let r = 2; r < w * 0.72; r += 1.2) {
      const l = 52 + rnd() * 22;
      g.strokeStyle = `hsl(215 6% ${l}%)`;
      g.lineWidth = 1.1;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    // the light catching the rings: a soft bright band across
    const lg = g.createLinearGradient(0, 0, w, h);
    lg.addColorStop(0.3, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    lg.addColorStop(0.7, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(0, 0, w, h);
  });
}

/** a record's surface: groove bands, run-out, the label hole left for the label mesh */
export function grooveTexture(): THREE.CanvasTexture {
  return tex('grooves', 1024, 1024, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = '#0b0b0d';
    g.fillRect(0, 0, w, h);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const R = w / 2;
    // tracks: bands of grooves with gaps between them
    const gaps = [0.97, 0.86, 0.74, 0.63, 0.52];
    for (let r = R * 0.98; r > R * 0.36; r -= 1) {
      const f = r / R;
      const gap = gaps.some((x) => Math.abs(x - f) < 0.006);
      g.strokeStyle = gap ? '#151518' : `rgb(${16 + rnd() * 10},${16 + rnd() * 10},${18 + rnd() * 10})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    // the sheen of the grooves under a light
    const lg = g.createConicGradient(0.6, cx, cy);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.08, 'rgba(255,255,255,0.10)');
    lg.addColorStop(0.16, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(0.58, 'rgba(255,255,255,0.08)');
    lg.addColorStop(0.66, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
    g.arc(cx, cy, R * 0.36, 0, Math.PI * 2, true);
    g.fill();
  });
}

/** vertical stripes to bump the side of a jog ring or knob into a knurl */
export function knurlBumpTexture(): THREE.CanvasTexture {
  const t = tex(
    'knurl',
    256,
    8,
    (g, w, h) => {
      for (let x = 0; x < w; x++) {
        const v = Math.round(128 + 127 * Math.sin((x / w) * Math.PI * 2 * 64));
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, 0, 1, h);
      }
    },
    false,
  );
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/**
 * The printed scale round a knob, as on a mixer's faceplate: 11 ticks over
 * 300°, longer at the ends and the centre. Transparent; lay it flat under the knob.
 */
export function knobScaleTexture(color: string, center = false): THREE.CanvasTexture {
  return tex(`kscale|${color}|${center}`, 256, 256, (g, w) => {
    const c = w / 2;
    g.strokeStyle = color;
    g.lineCap = 'round';
    for (let i = 0; i <= 10; i++) {
      const a = ((-150 + i * 30) * Math.PI) / 180;
      const major = i === 0 || i === 10 || (center && i === 5);
      const r0 = c * (major ? 0.74 : 0.8);
      g.lineWidth = major ? 7 : 4;
      g.beginPath();
      g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
      g.lineTo(c + Math.sin(a) * c * 0.94, c - Math.cos(a) * c * 0.94);
      g.stroke();
    }
  });
}

/** a fader's printed scale: ticks either side of the slot and numbers down one side */
export function faderScaleTexture(color: string, numbers: boolean, center: boolean): THREE.CanvasTexture {
  return tex(`fscale|${color}|${numbers}|${center}`, 128, 512, (g, w, h) => {
    g.fillStyle = color;
    g.strokeStyle = color;
    const n = 10;
    const top = h * 0.06;
    const bot = h * 0.94;
    g.font = '700 26px "Barlow Condensed", sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let i = 0; i <= n; i++) {
      const y = top + ((bot - top) * i) / n;
      const major = i % 5 === 0 || (center && i === n / 2);
      const len = major ? w * 0.16 : w * 0.1;
      g.lineWidth = major ? 4 : 2.5;
      g.beginPath();
      g.moveTo(w * 0.36 - len, y);
      g.lineTo(w * 0.36, y);
      g.moveTo(w * 0.64, y);
      g.lineTo(w * 0.64 + len, y);
      g.stroke();
      if (numbers && i % 2 === 0) g.fillText(String(n - i), w * 0.36 - len - 4, y);
    }
  });
}

/** a level meter's dB legend beside the LED ladder */
export function meterLegendTexture(color: string, n: number): THREE.CanvasTexture {
  return tex(`mleg|${color}|${n}`, 64, 512, (g, _w, h) => {
    g.fillStyle = color;
    g.font = '700 22px "Barlow Condensed", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const marks: [number, string][] = [
      [n - 1, 'CLIP'],
      [Math.round(n * 0.8), '+5'],
      [Math.round(n * 0.66), '0'],
      [Math.round(n * 0.45), '-6'],
      [Math.round(n * 0.25), '-15'],
      [0, '-24'],
    ];
    for (const [i, s] of marks) g.fillText(s, 4, h - ((i + 0.5) / n) * h);
  });
}

/** a Phillips-head panel screw */
export function screw(r = 0.0022): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(
    cached(`screw|${r}`, () => new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6)),
    screwMat(),
  );
  g.add(head);
  const slotM = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  for (const rot of [0, Math.PI / 2]) {
    const s = new THREE.Mesh(cached(`screwslot|${r}`, () => new THREE.BoxGeometry(r * 1.3, r * 0.5, r * 0.28)), slotM);
    s.position.y = r * 0.62;
    s.rotation.y = rot;
    g.add(s);
  }
  return g;
}

let screwM: THREE.MeshStandardMaterial | null = null;
function screwMat(): THREE.MeshStandardMaterial {
  screwM ??= new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.32 });
  screwM.userData.boardShared = true;
  return screwM;
}

/** the sheen on a screen's glass: a faint diagonal reflection, laid just above the picture */
export function glassSheen(w: number, d: number, round = false): THREE.Mesh {
  const t = tex('sheen', 256, 256, (g, W, H) => {
    const lg = g.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0, 'rgba(255,255,255,0.10)');
    lg.addColorStop(0.35, 'rgba(255,255,255,0.03)');
    lg.addColorStop(0.36, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(255,255,255,0.02)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
  });
  const m = new THREE.Mesh(round ? new THREE.CircleGeometry(w / 2, 48) : new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** a flat decal (scale, legend, print) lying on a surface */
export function decal(t: THREE.Texture, w: number, d: number, opacity = 0.9): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}
