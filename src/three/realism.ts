/*
 * Detail that makes the boards' hardware read as real, from how the gear is
 * actually made:
 *   knobs       rubber-coated bodies with fine vertical knurling for grip, a
 *               flange skirt at the base, a chamfered top (club mixer EQs are
 *               ~16–18 mm)
 *   fader caps  pro caps are ~22 mm across the slot, ~12 mm along it, ~14 mm
 *               tall, with grip ridges across the top
 * TODO: procedural stand-ins for the Blender component models (Section 14).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const geoCache = new Map<string, THREE.BufferGeometry>();

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

/* ------------------------------------------------------------------ */
/* merging static detail                                                */
/* ------------------------------------------------------------------ */

/** one piece of a merged mesh: a geometry, where it goes, and (for vertex-coloured merges) its colour */
export interface Piece {
  g: THREE.BufferGeometry;
  m?: THREE.Matrix4;
  color?: THREE.ColorRepresentation;
}

const tmpColor = new THREE.Color();

/**
 * Merge many small static pieces into one geometry, so the detail they add
 * (screws, connector shells, a tonearm's parts) costs one draw call per
 * material, not one per piece. Keeps position, normal and uv (filled with 0
 * where a piece has none); with `colors`, bakes each piece's colour into a
 * colour attribute for a vertexColors material.
 */
export function mergePieces(pieces: Piece[], colors = false): THREE.BufferGeometry {
  const list = pieces.map(({ g, m, color }) => {
    const q = g.index ? g.toNonIndexed() : g.clone();
    if (m) q.applyMatrix4(m);
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') q.deleteAttribute(k);
    const n = q.getAttribute('position').count;
    if (!q.getAttribute('normal')) q.computeVertexNormals();
    if (!q.getAttribute('uv')) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (colors) {
      tmpColor.set(color ?? 0xffffff);
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        c[i * 3] = tmpColor.r;
        c[i * 3 + 1] = tmpColor.g;
        c[i * 3 + 2] = tmpColor.b;
      }
      q.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    q.morphAttributes = {};
    q.clearGroups();
    return q;
  });
  const out = mergeGeometries(list, false)!;
  for (const q of list) q.dispose();
  return out;
}

/** a placement matrix: translate, then rotate (XYZ euler), then scale */
export function place(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): THREE.Matrix4 {
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), sc);
}

/** a lathe round Y from a (radius, height) profile */
export function lathe(profile: [number, number][], segs = 32): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
  );
}

/**
 * A ridged band for a lathe profile: `n` grooves `depth` deep between heights
 * y0 and y1 at radius r. For counterweight rings, height-adjust collars and
 * knurled dials.
 */
export function grooves(r: number, y0: number, y1: number, n: number, depth: number): [number, number][] {
  const out: [number, number][] = [];
  const step = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = y0 + i * step;
    out.push([r, a], [r, a + step * 0.5], [r - depth, a + step * 0.62], [r - depth, a + step * 0.88], [r, a + step]);
  }
  return out;
}

/** a button-head screw with its socket, head up, base at y = 0 (merged by the dozen into a unit's hardware) */
export function screwHead(r: number): THREE.BufferGeometry {
  return cached(`screw|${r}`, () =>
    lathe(
      // up the outside, over the dome and down into the socket (the lathe faces outward along this path)
      [
        [r, 0],
        [r, r * 0.2],
        [r * 0.9, r * 0.42],
        [r * 0.62, r * 0.55],
        [r * 0.42, r * 0.5],
        [r * 0.42, r * 0.18],
        [0, r * 0.18],
      ],
      12,
    ),
  );
}
