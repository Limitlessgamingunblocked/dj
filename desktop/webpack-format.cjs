// The game's files as one download for the updater: gzip of
//   [4-byte big-endian header length][header JSON: [{ path, size }]][each file's bytes, in order]
// pack-web.mjs writes it at release time; updater.cjs reads it in the app.
const path = require('node:path');
const zlib = require('node:zlib');

function pack(files) {
  const header = Buffer.from(JSON.stringify(files.map((f) => ({ path: f.path, size: f.data.length }))));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return zlib.gzipSync(Buffer.concat([len, header, ...files.map((f) => f.data)]), { level: 9 });
}

/** the files in a pack; refuses paths that would land outside the folder they're unpacked into */
function unpack(gz) {
  const buf = zlib.gunzipSync(gz);
  const n = buf.readUInt32BE(0);
  const header = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'));
  let at = 4 + n;
  return header.map(({ path: p, size }) => {
    const clean = path.posix.normalize(String(p));
    if (!clean || clean.startsWith('..') || path.posix.isAbsolute(clean) || clean.includes('\0')) throw new Error(`bad path in update: ${p}`);
    if (!Number.isInteger(size) || size < 0 || at + size > buf.length) throw new Error('update is truncated');
    const data = buf.subarray(at, at + size);
    at += size;
    return { path: clean, data };
  });
}

module.exports = { pack, unpack };
