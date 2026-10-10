/*
 * Playlists from other apps, turned into crates. Reads M3U / M3U8, PLS, XSPF,
 * rekordbox XML, Traktor NML, an Apple Music / iTunes library XML, CSV track
 * lists (what playlist export tools write for streaming playlists) and plain
 * "Artist - Title" lists. A playlist only names tracks: each entry is matched
 * to your own imported files by file name, or by artist and title.
 *
 * Pure (no DOM): the XML formats go through a small tokenizer here, so the
 * same code runs in the tests.
 */

export interface PlaylistEntry {
  title?: string;
  artist?: string;
  /** a file path or file:// URL, when the playlist has one */
  path?: string;
}

export interface Playlist {
  name: string;
  entries: PlaylistEntry[];
}

export const PLAYLIST_ACCEPT = '.m3u,.m3u8,.pls,.xspf,.xml,.nml,.csv,.txt';
const PLAYLIST_EXT = /\.(m3u8?|pls|xspf|xml|nml|csv|txt)$/i;

export function isPlaylistFile(name: string): boolean {
  return PLAYLIST_EXT.test(name);
}

const baseName = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

/** the playlists in a file (several for library exports and grouped CSVs) */
export function parsePlaylistFile(fileName: string, text: string): Playlist[] {
  const t = text.replace(/^﻿/, '');
  const name = baseName(fileName) || 'Playlist';
  const ext = (/\.([^.]+)$/.exec(fileName)?.[1] ?? '').toLowerCase();
  const head = t.slice(0, 2000);
  let out: Playlist[];
  if (ext === 'm3u' || ext === 'm3u8' || /^#EXTM3U/m.test(head)) out = [parseM3U(t, name)];
  else if (ext === 'pls' || /^\[playlist\]/im.test(head)) out = [parsePLS(t, name)];
  else if (/<playlist[\s>]/i.test(head) && /xspf/i.test(head)) out = [parseXSPF(t, name)];
  else if (/<DJ_PLAYLISTS/i.test(head)) out = parseRekordbox(t);
  else if (/<NML[\s>]/i.test(head)) out = parseNML(t);
  else if (/<plist[\s>]/i.test(head)) out = parseITunes(t);
  else if (ext === 'csv' || looksLikeCsv(head)) out = parseCSV(t, name);
  else out = [parseText(t, name)];
  return out.filter((p) => p.entries.length);
}

/* ------------------------------------------------------------------ */
/* line formats                                                         */
/* ------------------------------------------------------------------ */

/** "Artist - Title" (also with an en/em dash), or just a title */
export function splitArtistTitle(s: string): PlaylistEntry {
  const clean = s.trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(clean);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  const by = /^(.+?)\s+by\s+(.+)$/i.exec(clean);
  if (by) return { title: by[1].trim(), artist: by[2].trim() };
  return { title: clean };
}

export function parseM3U(text: string, name: string): Playlist {
  const entries: PlaylistEntry[] = [];
  let info: PlaylistEntry | null = null;
  let title = name;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const inf = /^#EXTINF:[^,]*,(.*)$/i.exec(line);
      if (inf) info = splitArtistTitle(inf[1]);
      const pl = /^#PLAYLIST:(.+)$/i.exec(line);
      if (pl) title = pl[1].trim();
      continue;
    }
    entries.push({ ...(info ?? {}), path: line });
    info = null;
  }
  return { name: title, entries };
}

export function parsePLS(text: string, name: string): Playlist {
  const files = new Map<number, PlaylistEntry>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(File|Title)(\d+)\s*=\s*(.*)$/i.exec(raw);
    if (!m) continue;
    const i = +m[2];
    const e = files.get(i) ?? {};
    if (m[1].toLowerCase() === 'file') e.path = m[3].trim();
    else Object.assign(e, splitArtistTitle(m[3]));
    files.set(i, e);
  }
  return { name, entries: [...files.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e) };
}

export function parseText(text: string, name: string): Playlist {
  const entries = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)]\s*|[-*•]\s+)/, '').trim())
    .filter((l) => l && !/^https?:\/\//i.test(l))
    .map(splitArtistTitle);
  return { name, entries };
}

/* ------------------------------------------------------------------ */
/* CSV (playlist export tools)                                          */
/* ------------------------------------------------------------------ */

function looksLikeCsv(head: string): boolean {
  const first = head.split(/\r?\n/)[0] ?? '';
  return /,/.test(first) && /(track|title|song|name)/i.test(first) && /artist/i.test(first);
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes */
export function csvRows(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const col = (header: string[], ...names: RegExp[]) => {
  for (const n of names) {
    const i = header.findIndex((h) => n.test(h.trim()));
    if (i >= 0) return i;
  }
  return -1;
};

export function parseCSV(text: string, name: string): Playlist[] {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows = csvRows(text, sep);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const ti = col(header, /^track ?name$/, /^title$/, /^song( ?name)?$/, /^name$/, /track/);
  const ai = col(header, /^artist ?name\(s\)$/, /^artist ?names?$/, /^artists?$/, /artist/);
  const pi = col(header, /^playlist( ?name)?$/, /playlist/);
  if (ti < 0) return [parseText(rows.map((r) => r.join(' - ')).join('\n'), name)];
  const lists = new Map<string, PlaylistEntry[]>();
  for (const r of rows.slice(1)) {
    const title = (r[ti] ?? '').trim();
    if (!title) continue;
    // several artists: "A, B" or "A;B" (keep the first as the lead)
    const artist = ai >= 0 ? (r[ai] ?? '').trim() : undefined;
    const list = pi >= 0 ? (r[pi] ?? '').trim() || name : name;
    if (!lists.has(list)) lists.set(list, []);
    lists.get(list)!.push({ title, artist: artist || undefined });
  }
  return [...lists.entries()].map(([n, entries]) => ({ name: n, entries }));
}

/* ------------------------------------------------------------------ */
/* XML formats                                                          */
/* ------------------------------------------------------------------ */

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** a small, forgiving XML parser: elements, attributes and text (no DTDs, no namespaces) */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      // close: pop to the matching element (forgiving of stray tags)
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[4] ?? ''))) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      const node: XNode = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decodeEntities(m[6]);
  }
  return root;
}

const kids = (n: XNode, name: string) => n.children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
const kid = (n: XNode, name: string) => kids(n, name)[0];
function find(n: XNode, name: string): XNode | undefined {
  for (const c of n.children) {
    if (c.name.toLowerCase() === name.toLowerCase()) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
}

export function parseXSPF(text: string, name: string): Playlist {
  const root = parseXml(text);
  const pl = find(root, 'playlist');
  const list = pl ? kid(pl, 'trackList') : undefined;
  const entries = (list ? kids(list, 'track') : []).map((t) => ({
    title: kid(t, 'title')?.text.trim() || undefined,
    artist: kid(t, 'creator')?.text.trim() || undefined,
    path: kid(t, 'location')?.text.trim() || undefined,
  }));
  return { name: (pl && kid(pl, 'title')?.text.trim()) || name, entries };
}

export function parseRekordbox(text: string): Playlist[] {
  const root = parseXml(text);
  const coll = find(root, 'COLLECTION');
  const byId = new Map<string, PlaylistEntry>();
  const byLoc = new Map<string, PlaylistEntry>();
  for (const t of coll ? kids(coll, 'TRACK') : []) {
    const e = { title: t.attrs.Name || undefined, artist: t.attrs.Artist || undefined, path: t.attrs.Location || undefined };
    if (t.attrs.TrackID) byId.set(t.attrs.TrackID, e);
    if (t.attrs.Location) byLoc.set(t.attrs.Location, e);
  }
  const out: Playlist[] = [];
  const walk = (n: XNode) => {
    for (const c of kids(n, 'NODE')) {
      if (c.attrs.Type === '1') {
        const byLocation = c.attrs.KeyType === '1';
        const entries = kids(c, 'TRACK')
          .map((t) => (byLocation ? byLoc.get(t.attrs.Key) ?? { path: t.attrs.Key } : byId.get(t.attrs.Key)))
          .filter((e): e is PlaylistEntry => !!e);
        out.push({ name: c.attrs.Name || 'Playlist', entries });
      } else walk(c);
    }
  };
  const pls = find(root, 'PLAYLISTS');
  if (pls) walk(pls);
  return out;
}

/** Traktor writes paths as "VOLUME/:Users/:me/:Music/:file.mp3" */
const nmlPath = (vol: string, dir: string, file: string) => `${vol}${dir}${file}`.replace(/\/:/g, '/');

export function parseNML(text: string): Playlist[] {
  const root = parseXml(text);
  const coll = find(root, 'COLLECTION');
  const byKey = new Map<string, PlaylistEntry>();
  for (const e of coll ? kids(coll, 'ENTRY') : []) {
    const loc = kid(e, 'LOCATION');
    if (!loc) continue;
    const key = `${loc.attrs.VOLUME ?? ''}${loc.attrs.DIR ?? ''}${loc.attrs.FILE ?? ''}`;
    byKey.set(key, { title: e.attrs.TITLE || undefined, artist: e.attrs.ARTIST || undefined, path: nmlPath(loc.attrs.VOLUME ?? '', loc.attrs.DIR ?? '', loc.attrs.FILE ?? '') });
  }
  const out: Playlist[] = [];
  const walk = (n: XNode) => {
    for (const c of n.children) {
      if (c.name === 'NODE' && c.attrs.TYPE === 'PLAYLIST') {
        const pl = kid(c, 'PLAYLIST');
        const entries = (pl ? kids(pl, 'ENTRY') : [])
          .map((e) => {
            const k = kid(e, 'PRIMARYKEY')?.attrs.KEY ?? '';
            return byKey.get(k) ?? (k ? { path: k.replace(/\/:/g, '/') } : null);
          })
          .filter((e): e is PlaylistEntry => !!e);
        if (c.attrs.NAME !== '_LOOPS' && c.attrs.NAME !== '_RECORDINGS') out.push({ name: c.attrs.NAME || 'Playlist', entries });
      } else walk(c);
    }
  };
  const pls = find(root, 'PLAYLISTS');
  if (pls) walk(pls);
  return out;
}

/** a plist <dict> as key → node */
function dict(n: XNode): Map<string, XNode> {
  const m = new Map<string, XNode>();
  for (let i = 0; i < n.children.length - 1; i++) if (n.children[i].name === 'key') m.set(n.children[i].text.trim(), n.children[++i]);
  return m;
}

export function parseITunes(text: string): Playlist[] {
  const root = parseXml(text);
  const top = find(root, 'dict');
  if (!top) return [];
  const d = dict(top);
  const tracks = new Map<string, PlaylistEntry>();
  const td = d.get('Tracks');
  if (td) for (const [id, node] of dict(td)) {
    const t = dict(node);
    tracks.set(id, { title: t.get('Name')?.text.trim(), artist: t.get('Artist')?.text.trim(), path: t.get('Location')?.text.trim() });
  }
  const out: Playlist[] = [];
  const pls = d.get('Playlists');
  for (const p of pls ? kids(pls, 'dict') : []) {
    const pd = dict(p);
    // skip the built-in lists (Library, Music, Downloaded…) and folders
    if (pd.has('Master') || pd.has('Distinguished Kind') || pd.has('Folder')) continue;
    const items = pd.get('Playlist Items');
    const entries = (items ? kids(items, 'dict') : []).map((it) => tracks.get(dict(it).get('Track ID')?.text.trim() ?? '')).filter((e): e is PlaylistEntry => !!e);
    out.push({ name: pd.get('Name')?.text.trim() || 'Playlist', entries });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* matching entries to your files                                       */
/* ------------------------------------------------------------------ */

export interface MatchTarget {
  id: string;
  fileName: string;
  title: string;
  artist: string;
}

/** lower-case, no accents, no "(Original Mix)", "feat. x" or punctuation */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([](original mix|original|extended mix|extended|radio edit|clean|explicit|remastered[^)\]]*|\d{4} remaster[^)\]]*)[)\]]/g, '')
    // streaming titles put the version after a dash: "Song - Original Mix", "Song - Remastered 2011"
    .replace(/\s+-\s+(original mix|extended mix|radio edit|original|extended|remastered.*|\d{4} remaster.*)$/g, '')
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const artistSet = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .split(/\s*(?:,|&|;|\/|\band\b|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/)
      .map((a) => a.replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim())
      .filter(Boolean),
  );

/** the file name a path or URL ends in */
export function pathFileName(p: string): string {
  let s = p.trim();
  try {
    if (/^file:/i.test(s) || /%[0-9a-f]{2}/i.test(s)) s = decodeURIComponent(s.replace(/^file:\/\/(localhost)?/i, ''));
  } catch {
    /* keep it as it is */
  }
  return s.replace(/^.*[\\/]/, '').toLowerCase();
}

/** the library track an entry names, or null */
export function matchEntry(e: PlaylistEntry, tracks: MatchTarget[]): string | null {
  if (e.path) {
    const f = pathFileName(e.path);
    const hit = tracks.find((t) => t.fileName.toLowerCase() === f);
    if (hit) return hit.id;
  }
  if (!e.title) return null;
  const nt = normTitle(e.title);
  if (!nt) return null;
  const cands = tracks.filter((t) => normTitle(t.title) === nt || normTitle(t.fileName.replace(/\.[^.]+$/, '')).endsWith(nt));
  if (!cands.length) return null;
  if (!e.artist) return cands.length === 1 ? cands[0].id : null;
  const want = artistSet(e.artist);
  const withArtist = cands.find((t) => {
    const have = artistSet(t.artist || t.fileName);
    for (const a of want) if (have.has(a) || [...have].some((h) => h.includes(a) || a.includes(h))) return true;
    return false;
  });
  return withArtist?.id ?? (cands.length === 1 && !cands[0].artist ? cands[0].id : null);
}

export function matchPlaylist(p: Playlist, tracks: MatchTarget[]): { ids: string[]; missing: PlaylistEntry[] } {
  const ids: string[] = [];
  const missing: PlaylistEntry[] = [];
  for (const e of p.entries) {
    const id = matchEntry(e, tracks);
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else missing.push(e);
  }
  return { ids, missing };
}

/** how an entry reads in a list */
export function entryLabel(e: PlaylistEntry): string {
  if (e.title) return e.artist ? `${e.artist} – ${e.title}` : e.title;
  return e.path ? pathFileName(e.path) : '?';
}
