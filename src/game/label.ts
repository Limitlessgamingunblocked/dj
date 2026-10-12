/*
 * Your own label (saved in settings as "label"): the edits and mashups you
 * make can be released on it. Releases get picked up: the fictional rivals
 * play them in their own sets (the feed says so, and a rival in a B2B with
 * you will sometimes drop one), and every play counts.
 */
import { loadSetting, saveSetting } from '../core/settings';
import { RIVAL_IDS, RIVALS, type RivalId } from './rivals';

export interface Release {
  /** the library track it is */
  trackId: string;
  title: string;
  kind: 'mashup' | 'edit';
  /** the career night it came out */
  night: number;
  /** plays by rivals (in their sets and in B2Bs with you) */
  plays: number;
  /** who's played it */
  by: RivalId[];
}

export interface LabelSave {
  name: string;
  releases: Release[];
  /** the last night rival plays were worked out for */
  night: number;
}

export const MAX_RELEASES = 40;

export function cleanLabel(raw: unknown): LabelSave {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const releases: Release[] = [];
  if (Array.isArray(r.releases))
    for (const x of r.releases) {
      if (typeof x !== 'object' || x === null) continue;
      const o = x as Record<string, unknown>;
      if (typeof o.trackId !== 'string' || typeof o.title !== 'string') continue;
      releases.push({
        trackId: o.trackId.slice(0, 80),
        title: o.title.slice(0, 120),
        kind: o.kind === 'edit' ? 'edit' : 'mashup',
        night: typeof o.night === 'number' && Number.isFinite(o.night) ? Math.max(0, Math.round(o.night)) : 0,
        plays: typeof o.plays === 'number' && Number.isFinite(o.plays) ? Math.max(0, Math.round(o.plays)) : 0,
        by: Array.isArray(o.by) ? o.by.filter((b): b is RivalId => RIVAL_IDS.includes(b as RivalId)).slice(0, 8) : [],
      });
    }
  return { name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : '', releases: releases.slice(0, MAX_RELEASES), night: typeof r.night === 'number' && Number.isFinite(r.night) ? Math.round(r.night) : 0 };
}

export function loadLabel(): LabelSave {
  return cleanLabel(loadSetting<unknown>('label', null));
}

export function saveLabel(l: LabelSave): void {
  saveSetting('label', l);
}

/** the label's name: yours, or one made from your DJ name */
export function labelName(l: LabelSave, dj: string): string {
  return l.name || `${(dj || 'Your').trim()} Records`;
}

/** release a track (once) */
export function release(l: LabelSave, r: Pick<Release, 'trackId' | 'title' | 'kind' | 'night'>): LabelSave {
  if (l.releases.some((x) => x.trackId === r.trackId)) return l;
  return { ...l, releases: [{ ...r, plays: 0, by: [] }, ...l.releases].slice(0, MAX_RELEASES) };
}

/** a rival played one of your releases */
export function playedBy(l: LabelSave, trackId: string, rival: RivalId): LabelSave {
  return { ...l, releases: l.releases.map((x) => (x.trackId === trackId ? { ...x, plays: x.plays + 1, by: x.by.includes(rival) ? x.by : [...x.by, rival] } : x)) };
}

/**
 * The nights since last time: each brings a chance a rival plays one of your
 * releases out (newer ones more likely, each rival once a night at most).
 */
export function rivalNights(l: LabelSave, night: number, r: () => number): { label: LabelSave; plays: { rival: RivalId; title: string; trackId: string }[] } {
  const plays: { rival: RivalId; title: string; trackId: string }[] = [];
  let next = l;
  const from = Math.max(l.night + 1, night - 3);
  for (let n = from; n <= night && next.releases.length; n++) {
    for (const rival of RIVAL_IDS) {
      if (r() > 0.22) continue;
      // newer releases get more plays
      const list = next.releases;
      const i = Math.min(list.length - 1, Math.floor(Math.pow(r(), 2) * list.length));
      const rel = list[i];
      next = playedBy(next, rel.trackId, rival);
      plays.push({ rival, title: rel.title, trackId: rel.trackId });
    }
  }
  return { label: { ...next, night: Math.max(l.night, night) }, plays: plays.slice(0, 4) };
}

/** what a rival posts when they play your release */
export function playPost(rival: RivalId, title: string, dj: string, label: string): { author: string; handle: string; text: string } {
  const rv = RIVALS[rival];
  const lines = [`Dropped “${title}” last night. ${dj}, this one’s a weapon.`, `“${title}” from ${label} went off in my set. More of these please.`, `Can’t stop playing “${title}”. Big up ${dj}.`, `Closed with “${title}” (${label}). Room lost it.`];
  return { author: rv.name, handle: `@${rival.replace(/_/g, '')}`, text: lines[Math.abs(hash(title + rival)) % lines.length] };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
