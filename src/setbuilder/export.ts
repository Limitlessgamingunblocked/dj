/*
 * Set exports: M3U8 (Serato, VirtualDJ and most players), rekordbox XML and
 * Traktor NML with beat grids and mix-in / mix-out cues, a CSV cue sheet, a
 * plain track list and search links for streaming services.
 *
 * Deckhouse only knows each file's name, not where it lives on disk, so the
 * caller passes the folder the DJ software should look in.
 */
import type { SetEntry, SetPlan } from './generate';

export interface ExportTarget {
  /** playlist name */
  name: string;
  /** folder holding the audio files on the DJ's computer, e.g. /Users/me/Music/Techno or C:\Music */
  folder: string;
}

export function energyTen(level: number): number {
  return Math.max(1, Math.min(10, Math.round(1 + level * 9)));
}

function xml(s: string | number): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function time(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isWindows(folder: string): boolean {
  return /^[a-z]:/i.test(folder) || folder.includes('\\');
}

/** Full path of a track's file inside the export folder. */
export function filePath(folder: string, fileName: string): string {
  const f = folder.trim();
  if (!f) return fileName;
  const sep = isWindows(f) ? '\\' : '/';
  return f.replace(/[\\/]+$/, '') + sep + fileName;
}

function fileUrl(folder: string, fileName: string): string {
  const parts = filePath(folder, fileName).split(/[\\/]/).filter(Boolean);
  const enc = parts.map((p, i) => (i === 0 && /^[a-z]:$/i.test(p) ? p : encodeURIComponent(p)));
  return `file://localhost/${enc.join('/')}`;
}

function kind(fileName: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toUpperCase() ?? 'MP3';
  return `${ext === 'AIF' ? 'AIFF' : ext} File`;
}

function playable(plan: SetPlan): SetEntry[] {
  return plan.entries.filter((e) => e.profile.format !== 'SYNTH');
}

/** M3U8 playlist: imports into Serato, rekordbox, Traktor, VirtualDJ and media players. */
export function toM3U(plan: SetPlan, target: ExportTarget): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${target.name}`];
  for (const e of playable(plan)) {
    const p = e.profile;
    lines.push(`#EXTINF:${Math.round(p.duration)},${p.artist ? `${p.artist} - ` : ''}${p.title}`);
    lines.push(filePath(target.folder, p.fileName));
  }
  return lines.join('\n') + '\n';
}

/** rekordbox XML (File → Import → rekordbox xml): tracks with grids, memory cues and a playlist. */
export function toRekordboxXml(plan: SetPlan, target: ExportTarget): string {
  const entries = playable(plan);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '  <PRODUCT Name="Deckhouse SmartDJ" Version="1.0" Company="Deckhouse"/>',
    `  <COLLECTION Entries="${entries.length}">`,
  ];
  entries.forEach((e, i) => {
    const p = e.profile;
    const bpm = p.bpm.toFixed(2);
    out.push(
      `    <TRACK TrackID="${i + 1}" Name="${xml(p.title)}" Artist="${xml(p.artist)}" Album="${xml(p.album)}" Genre="${xml(p.genre)}" Label="${xml(p.label)}" Kind="${xml(kind(p.fileName))}" TotalTime="${Math.round(p.duration)}" AverageBpm="${bpm}" Tonality="${xml(p.key?.name ?? '')}" Comments="${xml(`SmartDJ energy ${energyTen(e.level)}`)}" Location="${xml(fileUrl(target.folder, p.fileName))}">`,
      `      <TEMPO Inizio="${p.firstBeat.toFixed(3)}" Bpm="${bpm}" Metro="4/4" Battito="1"/>`,
      `      <POSITION_MARK Name="SmartDJ mix in" Type="0" Start="${e.cueIn.toFixed(3)}" Num="-1"/>`,
    );
    if (i < entries.length - 1) out.push(`      <POSITION_MARK Name="SmartDJ mix out" Type="0" Start="${e.mixOut.toFixed(3)}" Num="-1"/>`);
    out.push('    </TRACK>');
  });
  out.push(
    '  </COLLECTION>',
    '  <PLAYLISTS>',
    '    <NODE Type="0" Name="ROOT" Count="1">',
    `      <NODE Name="${xml(target.name)}" Type="1" KeyType="0" Entries="${entries.length}">`,
    ...entries.map((_, i) => `        <TRACK Key="${i + 1}"/>`),
    '      </NODE>',
    '    </NODE>',
    '  </PLAYLISTS>',
    '</DJ_PLAYLISTS>',
  );
  return out.join('\n') + '\n';
}

function traktorLocation(folder: string, fileName: string): { volume: string; dir: string; file: string } {
  const parts = filePath(folder, fileName).split(/[\\/]/).filter(Boolean);
  const file = parts.pop() ?? fileName;
  let volume = '';
  if (parts[0] && /^[a-z]:$/i.test(parts[0])) volume = parts.shift()!;
  else if (parts[0] === 'Volumes' && parts.length > 1) {
    parts.shift();
    volume = parts.shift()!;
  } else if (parts.length) volume = 'Macintosh HD';
  return { volume, dir: `/:${parts.map((p) => `${p}/:`).join('')}`, file };
}

/** Traktor NML (drag onto the Playlists tree or File → Import Collection). */
export function toTraktorNml(plan: SetPlan, target: ExportTarget): string {
  const entries = playable(plan);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>',
    '<MUSICFOLDERS></MUSICFOLDERS>',
    `<COLLECTION ENTRIES="${entries.length}">`,
  ];
  const keys: string[] = [];
  for (const [i, e] of entries.entries()) {
    const p = e.profile;
    const loc = traktorLocation(target.folder, p.fileName);
    keys.push(`${loc.volume}${loc.dir}${loc.file}`);
    const ms = (s: number) => (s * 1000).toFixed(3);
    out.push(
      `<ENTRY TITLE="${xml(p.title)}" ARTIST="${xml(p.artist)}">`,
      `<LOCATION DIR="${xml(loc.dir)}" FILE="${xml(loc.file)}" VOLUME="${xml(loc.volume)}" VOLUMEID="${xml(loc.volume)}"></LOCATION>`,
      `<ALBUM TITLE="${xml(p.album)}"></ALBUM>`,
      `<INFO GENRE="${xml(p.genre)}" LABEL="${xml(p.label)}" COMMENT="${xml(`SmartDJ energy ${energyTen(e.level)}`)}" PLAYTIME="${Math.round(p.duration)}"></INFO>`,
      `<TEMPO BPM="${p.bpm.toFixed(6)}" BPM_QUALITY="100.000000"></TEMPO>`,
    );
    if (p.key) out.push(`<MUSICAL_KEY VALUE="${p.key.root + (p.key.minor ? 12 : 0)}"></MUSICAL_KEY>`);
    out.push(
      `<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="${ms(p.firstBeat)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>`,
      `<CUE_V2 NAME="SmartDJ mix in" DISPL_ORDER="0" TYPE="0" START="${ms(e.cueIn)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>`,
    );
    if (i < entries.length - 1) out.push(`<CUE_V2 NAME="SmartDJ mix out" DISPL_ORDER="0" TYPE="0" START="${ms(e.mixOut)}" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>`);
    out.push('</ENTRY>');
  }
  out.push(
    '</COLLECTION>',
    '<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">',
    `<NODE TYPE="PLAYLIST" NAME="${xml(target.name)}"><PLAYLIST ENTRIES="${entries.length}" TYPE="LIST" UUID="${Date.now().toString(16)}deckhouse">`,
    ...keys.map((k) => `<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${xml(k)}"></PRIMARYKEY></ENTRY>`),
    '</PLAYLIST></NODE>',
    '</SUBNODES></NODE></PLAYLISTS>',
    '</NML>',
  );
  return out.join('\n') + '\n';
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cue sheet with timings and transition notes, for a spreadsheet or printing. */
export function toCsv(plan: SetPlan): string {
  const head = ['#', 'Starts at', 'Artist', 'Title', 'BPM', 'Key', 'Energy', 'Role', 'Mix in', 'Mix out', 'Into next: bars', 'Pitch %', 'Key move', 'Score', 'Notes'];
  const rows = plan.entries.map((e, i) => {
    const t = plan.transitions[i];
    return [
      i + 1,
      time(e.startAt),
      e.profile.artist,
      e.profile.title,
      e.profile.bpm.toFixed(1),
      e.profile.key?.camelot ?? '',
      energyTen(e.level),
      e.role,
      time(e.cueIn),
      i < plan.entries.length - 1 ? time(e.mixOut) : '',
      t ? t.bars : '',
      t ? t.pitchPct.toFixed(1) : '',
      t ? t.key.label : '',
      t ? t.score : '',
      t ? t.tip : '',
    ];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/** "Artist - Title" per line: paste into playlist-transfer tools for Spotify or Apple Music. */
export function toTrackList(plan: SetPlan): string {
  return plan.entries.map((e) => `${e.profile.artist ? `${e.profile.artist} - ` : ''}${e.profile.title}`).join('\n') + '\n';
}

export function spotifySearchUrl(e: SetEntry): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${e.profile.artist} ${e.profile.title}`.trim())}`;
}

export function appleMusicSearchUrl(e: SetEntry): string {
  return `https://music.apple.com/search?term=${encodeURIComponent(`${e.profile.artist} ${e.profile.title}`.trim())}`;
}
