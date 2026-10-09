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
