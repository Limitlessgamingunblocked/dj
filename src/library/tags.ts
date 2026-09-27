/*
 * Metadata readers: ID3v2.2/2.3/2.4 (MP3, WAV and AIFF chunks), FLAC and Ogg
 * Vorbis/Opus comments, MP4/M4A ilst atoms and RIFF INFO. Returns text tags
 * and embedded cover art bytes.
 */
export interface RawTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  /** record label / publisher */
  label?: string;
  year?: string;
  bpm?: number;
  key?: string;
  picture?: { mime: string; data: Uint8Array };
  /** unsynchronised lyrics (plain text, sometimes LRC) */
  lyrics?: string;
  /** synchronised lyrics events (ID3 SYLT), seconds */
  synced?: { t: number; text: string }[];
  format: string;
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function str4(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function decodeText(b: Uint8Array, enc: number): string {
  let s: string;
  if (enc === 0) s = latin1.decode(b);
  else if (enc === 3) s = utf8.decode(b);
  else {
    let le = true;
    let start = 0;
    if (enc === 1 && b.length >= 2) {
      if (b[0] === 0xfe && b[1] === 0xff) le = false;
      start = b[0] === 0xff || b[0] === 0xfe ? 2 : 0;
    } else if (enc === 2) le = false;
    s = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(start, start + ((b.length - start) & ~1)));
  }
  return s.replace(/\0+$/, '').split('\0')[0].trim();
}

/** Like decodeText but keeps newlines and inner text (lyrics are multi-line). */
function decodeLyric(b: Uint8Array, enc: number): string {
  let s: string;
  if (enc === 0) s = latin1.decode(b);
  else if (enc === 3) s = utf8.decode(b);
  else {
    let le = true;
    let start = 0;
    if (enc === 1 && b.length >= 2) {
      if (b[0] === 0xfe && b[1] === 0xff) le = false;
      start = b[0] === 0xff || b[0] === 0xfe ? 2 : 0;
    } else if (enc === 2) le = false;
    s = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(start, start + ((b.length - start) & ~1)));
  }
  return s.replace(/\0+$/, '').replace(/\r\n?/g, '\n');
}

function syncsafe(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function findTerminator(b: Uint8Array, o: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = o; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  for (let i = o; i < b.length; i++) if (b[i] === 0) return i;
  return b.length;
}

export function parseId3(b: Uint8Array, out: RawTags): void {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return;
  const ver = b[3];
  const flags = b[5];
  const size = syncsafe(b, 6);
  let o = 10;
  const end = Math.min(b.length, 10 + size);
  if (flags & 0x40 && ver >= 3) {
    const ext = ver === 4 ? syncsafe(b, o) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) + 4;
    o += ext;
  }
  const idLen = ver === 2 ? 3 : 4;
  const hdr = ver === 2 ? 6 : 10;
  while (o + hdr <= end) {
    const id = String.fromCharCode(...b.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize: number;
    if (ver === 2) fsize = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
    else if (ver === 4) fsize = syncsafe(b, o + 4);
    else fsize = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
    const body = b.subarray(o + hdr, Math.min(end, o + hdr + fsize));
    o += hdr + fsize;
    if (!body.length) continue;
    const text = () => decodeText(body.subarray(1), body[0]);
    switch (id) {
      case 'TIT2':
      case 'TT2':
        out.title ??= text();
        break;
      case 'TPE1':
      case 'TP1':
        out.artist ??= text();
        break;
      case 'TALB':
      case 'TAL':
        out.album ??= text();
        break;
      case 'TCON':
      case 'TCO':
        out.genre ??= text().replace(/^\((\d+)\)/, '');
        break;
      case 'TPUB':
      case 'TPB':
        out.label ??= text();
        break;
      case 'TYER':
      case 'TDRC':
      case 'TYE':
        out.year ??= text().slice(0, 4);
        break;
      case 'TBPM':
      case 'TBP': {
        const v = parseFloat(text());
        if (v > 0) out.bpm ??= v;
        break;
      }
      case 'TKEY':
      case 'TKE':
        out.key ??= text();
        break;
      case 'USLT':
      case 'ULT': {
        // encoding, language(3), descriptor, text
        const enc = body[0];
        const dz = findTerminator(body, 4, enc);
        const start = dz + (enc === 1 || enc === 2 ? 2 : 1);
        if (start < body.length && !out.lyrics) out.lyrics = decodeLyric(body.subarray(start), enc);
        break;
      }
      case 'SYLT':
      case 'SLT': {
        // encoding, language(3), timestamp format, content type, descriptor, then (text, 32-bit time)*
        const enc = body[0];
        const fmt = body[4];
        if (fmt !== 2 || out.synced) break; // milliseconds only (MPEG-frame stamps are rare)
        const wide = enc === 1 || enc === 2;
        let p = findTerminator(body, 6, enc) + (wide ? 2 : 1);
        const events: { t: number; text: string }[] = [];
        while (p < body.length) {
          const z = findTerminator(body, p, enc);
          const txt = decodeLyric(body.subarray(p, z), enc);
          const q = z + (wide ? 2 : 1);
          if (q + 4 > body.length) break;
          const ms = ((body[q] << 24) | (body[q + 1] << 16) | (body[q + 2] << 8) | body[q + 3]) >>> 0;
          events.push({ t: ms / 1000, text: txt });
          p = q + 4;
        }
        if (events.length) out.synced = events;
        break;
      }
      case 'APIC':
      case 'PIC': {
        if (out.picture) break;
        const enc = body[0];
        let p = 1;
        let mime: string;
        if (id === 'PIC') {
          const fmt = latin1.decode(body.subarray(1, 4)).toLowerCase();
          mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
          p = 4;
        } else {
          const z = findTerminator(body, 1, 0);
          mime = latin1.decode(body.subarray(1, z)) || 'image/jpeg';
          if (!mime.includes('/')) mime = `image/${mime.toLowerCase()}`;
          p = z + 1;
        }
        p += 1; // picture type
        const dz = findTerminator(body, p, enc);
        p = dz + (enc === 1 || enc === 2 ? 2 : 1);
        if (p < body.length) out.picture = { mime, data: body.slice(p) };
        break;
      }
      default:
        break;
    }
  }
}

function applyVorbis(key: string, value: string, out: RawTags): void {
  switch (key.toUpperCase()) {
    case 'TITLE':
      out.title ??= value;
      break;
    case 'ARTIST':
      out.artist ??= value;
      break;
    case 'ALBUM':
      out.album ??= value;
      break;
    case 'GENRE':
      out.genre ??= value;
      break;
    case 'LABEL':
    case 'ORGANIZATION':
    case 'PUBLISHER':
      out.label ??= value;
      break;
    case 'DATE':
    case 'YEAR':
      out.year ??= value.slice(0, 4);
      break;
    case 'BPM':
    case 'TEMPO': {
      const v = parseFloat(value);
      if (v > 0) out.bpm ??= v;
      break;
    }
    case 'LYRICS':
    case 'UNSYNCEDLYRICS':
    case 'UNSYNCED LYRICS':
    case 'SYNCEDLYRICS':
      out.lyrics ??= value;
      break;
    case 'INITIALKEY':
    case 'KEY':
      out.key ??= value;
      break;
    case 'METADATA_BLOCK_PICTURE':
      if (!out.picture) {
        try {
          const bin = atob(value);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          parseFlacPicture(bytes, out);
        } catch {
          /* ignore malformed picture */
        }
      }
      break;
    default:
      break;
  }
}

function parseVorbisComment(b: Uint8Array, out: RawTags): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const vendorLen = v.getUint32(o, true);
  o += 4 + vendorLen;
  const count = v.getUint32(o, true);
  o += 4;
  for (let i = 0; i < count && o + 4 <= b.length; i++) {
    const len = v.getUint32(o, true);
    o += 4;
    const s = utf8.decode(b.subarray(o, o + len));
    o += len;
    const eq = s.indexOf('=');
    if (eq > 0) applyVorbis(s.slice(0, eq), s.slice(eq + 1), out);
  }
}

function parseFlacPicture(b: Uint8Array, out: RawTags): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 4;
  const mimeLen = v.getUint32(o);
  o += 4;
  const mime = latin1.decode(b.subarray(o, o + mimeLen));
  o += mimeLen;
  const descLen = v.getUint32(o);
  o += 4 + descLen + 16;
  const len = v.getUint32(o);
  o += 4;
  out.picture = { mime, data: b.slice(o, o + len) };
}

function parseFlac(b: Uint8Array, out: RawTags): void {
  let o = 4;
  for (;;) {
    if (o + 4 > b.length) break;
    const last = b[o] & 0x80;
    const type = b[o] & 0x7f;
    const len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const body = b.subarray(o + 4, o + 4 + len);
    if (type === 4) parseVorbisComment(body, out);
    else if (type === 6 && !out.picture) parseFlacPicture(body, out);
    o += 4 + len;
    if (last) break;
  }
}

function parseOgg(b: Uint8Array, out: RawTags): void {
  // concatenate the payload of the first pages (comment packets can span pages)
  const parts: Uint8Array[] = [];
  let o = 0;
  let total = 0;
  for (let page = 0; page < 40 && o + 27 <= b.length && total < 4_000_000; page++) {
    if (str4(b, o) !== 'OggS') break;
    const segs = b[o + 26];
    let size = 0;
    for (let i = 0; i < segs; i++) size += b[o + 27 + i];
    const start = o + 27 + segs;
    parts.push(b.subarray(start, start + size));
    total += size;
    o = start + size;
  }
  const all = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    all.set(part, p);
    p += part.length;
  }
  const find = (sig: number[]) => {
    outer: for (let i = 0; i + sig.length < all.length; i++) {
      for (let j = 0; j < sig.length; j++) if (all[i + j] !== sig[j]) continue outer;
      return i + sig.length;
    }
    return -1;
  };
  let at = find([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // \x03vorbis
  if (at < 0) at = find([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // OpusTags
  if (at >= 0) {
    try {
      parseVorbisComment(all.subarray(at), out);
    } catch {
      /* truncated */
    }
  }
}

function parseMp4(b: Uint8Array, out: RawTags): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const walk = (start: number, end: number, path: string[]) => {
    let o = start;
    while (o + 8 <= end) {
      let size = v.getUint32(o);
      const type = str4(b, o + 4);
      let hdr = 8;
      if (size === 1) {
        size = Number(v.getBigUint64(o + 8));
        hdr = 16;
      } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) break;
      const body = o + hdr;
      const inIlst = path[path.length - 1] === 'ilst';
      if (type === 'moov' || type === 'udta' || type === 'ilst') walk(body, o + size, [...path, type]);
      else if (type === 'meta') walk(body + 4, o + size, [...path, type]);
      else if (inIlst) {
        // item → 'data' atom: size, 'data', type(4), locale(4), payload
        const d = body;
        if (d + 16 <= o + size && str4(b, d + 4) === 'data') {
          const dsize = v.getUint32(d);
          const kind = v.getUint32(d + 8) & 0xffffff;
          const payload = b.subarray(d + 16, d + dsize);
          const text = () => utf8.decode(payload);
          switch (type) {
            case '©nam':
              out.title ??= text();
              break;
            case '©ART':
            case 'aART':
              out.artist ??= text();
              break;
            case '©alb':
              out.album ??= text();
              break;
            case '©gen':
              out.genre ??= text();
              break;
            case '©day':
              out.year ??= text().slice(0, 4);
              break;
            case 'tmpo':
              if (payload.length >= 2) out.bpm ??= (payload[0] << 8) | payload[1];
              break;
            case 'covr':
              out.picture ??= { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: payload.slice() };
              break;
            case '©lyr':
              out.lyrics ??= text();
              break;
            default:
              break;
          }
        }
      }
      o += size;
    }
  };
  walk(0, b.length, []);
}

function parseRiffInfo(b: Uint8Array, out: RawTags): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const aiff = str4(b, 0) === 'FORM';
  const le = !aiff;
  let o = 12;
  while (o + 8 <= b.length) {
    const id = str4(b, o);
    const size = v.getUint32(o + 4, le);
    const body = o + 8;
    if (id === 'id3 ' || id === 'ID3 ') parseId3(b.subarray(body, body + size), out);
    else if (id === 'NAME' && aiff) out.title ??= latin1.decode(b.subarray(body, body + size)).replace(/\0/g, '').trim();
    else if (id === 'LIST' && str4(b, body) === 'INFO') {
      let p = body + 4;
      while (p + 8 <= body + size) {
        const sid = str4(b, p);
        const ssize = v.getUint32(p + 4, true);
        const s = utf8.decode(b.subarray(p + 8, p + 8 + ssize)).replace(/\0/g, '').trim();
        if (sid === 'INAM') out.title ??= s;
        else if (sid === 'IART') out.artist ??= s;
        else if (sid === 'IPRD') out.album ??= s;
        else if (sid === 'IGNR') out.genre ??= s;
        else if (sid === 'ICRD') out.year ??= s.slice(0, 4);
        p += 8 + ssize + (ssize & 1);
      }
    }
    o = body + size + (size & 1);
  }
}

export function detectFormat(b: Uint8Array, fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (b.length >= 4) {
    const h = str4(b, 0);
    if (h === 'fLaC') return 'FLAC';
    if (h === 'OggS') return ext === 'opus' ? 'OPUS' : 'OGG';
    if (h === 'RIFF') return 'WAV';
    if (h === 'FORM') return 'AIFF';
    if (b.length >= 8 && str4(b, 4) === 'ftyp') return ext === 'aac' ? 'AAC' : 'M4A';
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'MP3';
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? 'AAC' : 'MP3';
  }
  return ext ? ext.toUpperCase() : 'AUDIO';
}

export function readTags(buf: ArrayBuffer, fileName: string): RawTags {
  const b = new Uint8Array(buf);
  const out: RawTags = { format: detectFormat(b, fileName) };
  try {
    switch (out.format) {
      case 'MP3':
      case 'AAC':
        parseId3(b, out);
        break;
      case 'FLAC':
        parseFlac(b, out);
        break;
      case 'OGG':
      case 'OPUS':
        parseOgg(b, out);
        break;
      case 'M4A':
        parseMp4(b, out);
        break;
      case 'WAV':
      case 'AIFF':
        parseRiffInfo(b, out);
        break;
      default:
        parseId3(b, out);
    }
  } catch (err) {
    console.warn('tag parse failed', fileName, err);
  }
  if (!out.title || !out.artist) {
    const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    const m = /^(?:\d+[\s.-]+)?(.+?)\s+[-–]\s+(.+)$/.exec(base);
    if (m) {
      out.artist ??= m[1].trim();
      out.title ??= m[2].trim();
    } else out.title ??= base;
  }
  return out;
}
