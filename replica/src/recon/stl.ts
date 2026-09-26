import type { Mesh } from './types';

/**
 * Binary STL. The app works Y-up; slicers expect Z-up, so the model is rotated +90° about X
 * (x, y, z) → (x, −z, y), a proper rotation that keeps triangle winding outward.
 */
export function toBinaryStl(mesh: Mesh, name = 'replica'): ArrayBuffer {
  const { positions: p, indices: ix } = mesh;
  const count = ix.length / 3;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  const header = `Replica STL: ${name}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, count, true);
  let o = 84;
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < ix.length; t += 3) {
    for (let q = 0; q < 3; q++) {
      const s = ix[t + q] * 3;
      v[q * 3] = p[s];
      v[q * 3 + 1] = -p[s + 2];
      v[q * 3 + 2] = p[s + 1];
    }
    const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
    const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (let i = 0; i < 9; i++, o += 4) view.setFloat32(o, v[i], true);
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}

/** Reads a binary STL back into a Y-up mesh (inverse of toBinaryStl), for previewing saved models. */
export function fromBinaryStl(buffer: ArrayBuffer): Mesh {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  if (buffer.byteLength < 84 + count * 50) throw new Error('This STL file is truncated.');
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let o = 84;
  for (let t = 0; t < count; t++) {
    o += 12;
    for (let q = 0; q < 3; q++) {
      const x = view.getFloat32(o, true);
      const y = view.getFloat32(o + 4, true);
      const z = view.getFloat32(o + 8, true);
      o += 12;
      const d = (t * 3 + q) * 3;
      positions[d] = x;
      positions[d + 1] = z;
      positions[d + 2] = -y;
      indices[t * 3 + q] = t * 3 + q;
    }
    o += 2;
  }
  return { positions, indices };
}
