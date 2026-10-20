/*
 * Readers for the MakeHuman (CC0) source data the crowd's body is built from:
 * the base mesh (base.obj), the default skeleton (default.mhskel) and its
 * weights (default_weights.mhw), and the shape targets (targets.npz, as
 * shipped in the makehuman 1.x package).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** the base mesh: positions (decimetres), faces (quads or triangles, 0-based) with their group */
export function readObj(file) {
  const pos = [];
  const faces = [];
  let group = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      pos.push(+x, +y, +z);
    } else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) faces.push({ v: line.trim().split(/\s+/).slice(1).map((t) => +t.split('/')[0] - 1), group });
  }
  return { pos: new Float64Array(pos), faces };
}

/** the arrays in a .npz (a zip of .npy files): { name: { shape, data } } for the names wanted */
export function readNpz(file, want) {
  const buf = fs.readFileSync(file);
  const out = {};
  // the central directory: find its end record, then walk its entries
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen).replace(/\.npy$/, '');
    p += 46 + nameLen + extraLen + commentLen;
    if (want && !want(name)) continue;
    const lName = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    const raw = buf.subarray(start, start + csize);
    out[name] = parseNpy(method === 8 ? zlib.inflateRawSync(raw) : raw);
  }
  return out;
}

function parseNpy(b) {
  const major = b[6];
  const hlen = major >= 2 ? b.readUInt32LE(8) : b.readUInt16LE(8);
  const hstart = major >= 2 ? 12 : 10;
  const header = b.toString('latin1', hstart, hstart + hlen);
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)[1].split(',').filter((s) => s.trim()).map(Number);
  const body = b.subarray(hstart + hlen);
  const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  const T = { '<u2': Uint16Array, '<i2': Int16Array, '<f4': Float32Array, '<i4': Int32Array, '<u4': Uint32Array }[descr];
  if (!T) throw new Error(`npy type ${descr}`);
  return { shape, data: new T(ab) };
}

export function loadMH(dir) {
  const obj = readObj(path.join(dir, 'base.obj'));
  const skel = JSON.parse(fs.readFileSync(path.join(dir, 'default.mhskel'), 'utf8'));
  const weights = JSON.parse(fs.readFileSync(path.join(dir, 'default_weights.mhw'), 'utf8')).weights;
  const npz = readNpz(path.join(dir, 'targets.npz'), (n) => n.startsWith('targets/macrodetails/'));
  const targets = {};
  for (const [k, v] of Object.entries(npz)) {
    const m = /^targets\/macrodetails\/(.+)\.(index|vector)$/.exec(k);
    if (!m) continue;
    (targets[m[1]] ??= {})[m[2]] = v.data;
  }
  return { obj, skel, weights, targets };
}

/** a target's offsets as a dense array over the base mesh (decimetres) */
export function dense(t, nverts) {
  const out = new Float64Array(nverts * 3);
  for (let i = 0; i < t.index.length; i++) for (let k = 0; k < 3; k++) out[t.index[i] * 3 + k] = t.vector[i * 3 + k] * 1e-3;
  return out;
}
