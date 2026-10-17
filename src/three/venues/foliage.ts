/*
 * A clump of leaves for shrubs, planters and small trees: a ball pushed in and
 * out so its outline is ragged, flattened underneath where the leaves hang.
 * Drawn flat-shaded, its small faces catch the light like leaves do (or
 * smooth, with `leafTexture` on it); a plain twenty-sided ball reads as a cut
 * gem.
 */
import * as THREE from 'three';
import { canvasTexture, rng } from './tex';

/** a clump about `radius` across, its lumps set by `r` (a seeded rng) */
export function leafClump(radius: number, r: () => number, detail = 2): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const a = r() * 6.28;
  const b = r() * 6.28;
  const c = r() * 6.28;
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize();
    // the lumps follow the direction, so the copies of a corner the faces share move together and the clump stays closed
    const lump = 1 + 0.16 * Math.sin(n.x * 5 + a) * Math.sin(n.y * 6 + b) * Math.sin(n.z * 5 + c) + 0.07 * Math.sin(n.x * 13 + b) * Math.sin(n.z * 11 + a);
    const k = radius * lump;
    p.setXYZ(i, n.x * k, n.y * k * (n.y < 0 ? 0.72 : 1), n.z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** small overlapping leaves in light and shadow, tiling, pale so a material's colour tints them */
export function leafTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'leaves',
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#5a6652';
      g.fillRect(0, 0, w, h);
      const r = rng(311);
      for (let i = 0; i < 900; i++) {
        const x = r() * w;
        const y = r() * h;
        const v = 70 + r() * 150;
        g.fillStyle = `rgb(${Math.round(v * 0.86)},${Math.round(v)},${Math.round(v * 0.72)})`;
        const rx = 4 + r() * 6;
        const ry = 2 + r() * 2.5;
        const a = r() * Math.PI;
        // drawn again across the edges so the tile repeats without a seam
        for (const dx of [-w, 0, w])
          for (const dy of [-h, 0, h]) {
            if (x + dx < -12 || x + dx > w + 12 || y + dy < -12 || y + dy > h + 12) continue;
            g.beginPath();
            g.ellipse(x + dx, y + dy, rx, ry, a, 0, Math.PI * 2);
            g.fill();
          }
      }
    },
    { repeat: true },
  );
}
