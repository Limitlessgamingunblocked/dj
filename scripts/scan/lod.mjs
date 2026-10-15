// Give a fitted scanned person a light copy of their body for the crowd further back:
//   node scripts/scan/lod.mjs assets/models/character_scan_<name>_01.glb [triangles]
// Adds a second mesh, `scan_lod`, to the file: the same points, skin and material as the full
// body (so it costs only its triangle list), simplified to about `triangles` (default 9,000; the people use 8,000).
// Run it again after a refit (fit.mjs writes the file afresh); running it twice replaces the copy.
import fs from 'fs';
import { MeshoptSimplifier } from 'meshoptimizer';

const [file, want = '9000'] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/scan/lod.mjs <character_scan_*.glb> [triangles]');
  process.exit(1);
}
await MeshoptSimplifier.ready;

const glb = fs.readFileSync(file);
const jsonLen = glb.readUInt32LE(12);
const j = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
let bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));

// drop an earlier copy (its index data stays behind in the buffer, unused: harmless, and gone on a refit)
const old = j.nodes.findIndex((n) => n.name === 'scan_lod');
if (old >= 0) {
  const mesh = j.nodes[old].mesh;
  for (const n of j.nodes) if (n.children) n.children = n.children.filter((c) => c !== old).map((c) => (c > old ? c - 1 : c));
  j.nodes.splice(old, 1);
  j.meshes.splice(mesh, 1);
  for (const n of j.nodes) if (n.mesh !== undefined && n.mesh > mesh) n.mesh--;
}

const bodyIdx = j.nodes.findIndex((n) => n.name === 'scan_body');
const body = j.nodes[bodyIdx];
const prim = j.meshes[body.mesh].primitives[0];
const read = (a, Type, comps) => {
  const acc = j.accessors[a];
  const bv = j.bufferViews[acc.bufferView];
  const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = bv.byteStride ?? Type.BYTES_PER_ELEMENT * comps;
  const out = new Type(acc.count * comps);
  const view = new DataView(bin.buffer, bin.byteOffset);
  for (let i = 0; i < acc.count; i++)
    for (let c = 0; c < comps; c++) {
      const at = off + i * stride + c * Type.BYTES_PER_ELEMENT;
      out[i * comps + c] = Type === Float32Array ? view.getFloat32(at, true) : Type === Uint16Array ? view.getUint16(at, true) : view.getUint32(at, true);
    }
  return out;
};
const ia = j.accessors[prim.indices];
const indices = Uint32Array.from(read(prim.indices, ia.componentType === 5125 ? Uint32Array : Uint16Array, 1));
const pos = read(prim.attributes.POSITION, Float32Array, 3);
const nrm = read(prim.attributes.NORMAL, Float32Array, 3);
const uv = read(prim.attributes.TEXCOORD_0, Float32Array, 2);
const n = pos.length / 3;
const attrs = new Float32Array(n * 5);
for (let i = 0; i < n; i++) attrs.set([nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]], i * 5);

// keep the texture's patches whole (their edges are seams) and the outline; a little error is fine far off
const target = Math.min(indices.length, Number(want) * 3);
const [lod, err] = MeshoptSimplifier.simplifyWithAttributes(indices, pos, 3, attrs, 5, [0.3, 0.3, 0.3, 1, 1], null, target, 0.02, []);
let out = lod;
if (out.length > target * 1.5) {
  // the seams held it back: let go of them a little
  [out] = MeshoptSimplifier.simplifyWithAttributes(indices, pos, 3, attrs, 5, [0.3, 0.3, 0.3, 0.5, 0.5], null, target, 0.03, ['Permissive']);
}
console.log(file, 'triangles', indices.length / 3, '->', out.length / 3, 'error', err.toFixed(4));

// append the index list
const pad = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
bin = pad(Buffer.from(bin));
const idxBuf = n < 65536 ? Buffer.from(Uint16Array.from(out).buffer) : Buffer.from(out.buffer, out.byteOffset, out.byteLength);
j.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: idxBuf.length, target: 34963 });
j.accessors.push({ bufferView: j.bufferViews.length - 1, componentType: n < 65536 ? 5123 : 5125, count: out.length, type: 'SCALAR' });
bin = pad(Buffer.concat([bin, idxBuf]));
j.buffers[0].byteLength = bin.length;
j.meshes.push({ name: 'scan_lod', primitives: [{ ...prim, indices: j.accessors.length - 1 }] });
j.nodes.push({ name: 'scan_lod', mesh: j.meshes.length - 1, skin: body.skin });
const lodIdx = j.nodes.length - 1;
for (const nd of j.nodes) if (nd.children?.includes(bodyIdx)) nd.children.push(lodIdx);

let json = Buffer.from(JSON.stringify(j), 'utf8');
if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0);
head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const chunk = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
fs.writeFileSync(file, Buffer.concat([head, chunk(json.length, 0x4e4f534a), json, chunk(bin.length, 0x004e4942), bin]));
