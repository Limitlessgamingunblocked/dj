/* ID3v2.3 tags for MP3 exports: title, artist (your name), album (the venue), year and the cover art. */

export interface AudioTags {
  title: string;
  artist: string;
  album?: string;
  /** ISO date */
  date?: string;
  /** the cover art (PNG) */
  cover?: Uint8Array;
}

/* an ID3v2.3 tag: text frames plus an optional front cover */
function syncsafe(n: number): number[] {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

function frame(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + body.length);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  const n = body.length;
  out.set([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff], 4);
  out.set(body, 10);
  return out;
}

/** UTF-16 with a BOM (encoding 1), so any name survives */
function text(id: string, s: string): Uint8Array {
  const body = new Uint8Array(1 + 2 + s.length * 2);
  body[0] = 1;
  body[1] = 0xff;
  body[2] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    body[3 + i * 2] = c & 0xff;
    body[4 + i * 2] = c >> 8;
  }
  return frame(id, body);
}

export function id3(t: AudioTags): Uint8Array {
  const frames: Uint8Array[] = [text('TIT2', t.title), text('TPE1', t.artist)];
  if (t.album) frames.push(text('TALB', t.album));
  if (t.date) frames.push(text('TYER', t.date.slice(0, 4)));
  if (t.cover) {
    const mime = 'image/png';
    const head = new Uint8Array(1 + mime.length + 1 + 1 + 1);
    head[0] = 0; // ISO-8859-1 description
    for (let i = 0; i < mime.length; i++) head[1 + i] = mime.charCodeAt(i);
    head[1 + mime.length + 1] = 3; // front cover; the description stays empty
    const body = new Uint8Array(head.length + t.cover.length);
    body.set(head);
    body.set(t.cover, head.length);
    frames.push(frame('APIC', body));
  }
  const size = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(10 + size);
  out.set([0x49, 0x44, 0x33, 3, 0, 0, ...syncsafe(size)]);
  let o = 10;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return out;
}

