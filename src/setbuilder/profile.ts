/*
 * Track profiling for the set builder: tempo, key, a 0–1 energy estimate and
 * phrase-aligned intro/outro boundaries. Everything comes from the cached
 * analysis (3-band waveform, loudness, beat grid); built-in demo tracks that
 * haven't been analysed yet are profiled from the spec they're generated from.
 */
import { makeKey } from '../analysis/keys';
import type { KeyInfo, LibraryTrack, TrackAnalysis } from '../core/types';
import { clamp } from '../core/util';

export interface TrackProfile {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  label: string;
  fileName: string;
  format: string;
  bpm: number;
  key: KeyInfo | null;
  duration: number;
  /** first downbeat, seconds */
  firstBeat: number;
  /** 0–1 estimate from loudness, tempo, rhythmic density and brightness */
  energy: number;
  /** where the main groove (kick + bass) starts, seconds, on a 4-bar boundary */
  introEnd: number;
  /** where the main groove ends, seconds, on a 4-bar boundary */
  outroStart: number;
  plays: number;
  basis: 'analysis' | 'demo';
  /** groove style a built-in demo track was synthesised in */
  demoStyle?: string;
}

const STYLE_ENERGY: Record<string, number> = { techno: 0.64, breaks: 0.56, garage: 0.58, house: 0.58, minimal: 0.46, rolling: 0.55, techhouse: 0.66, rave: 0.78 };

/** Small nudges from genre words that the audio features can't see. */
function genreNudge(genre: string): number {
  const g = genre.toLowerCase();
  let n = 0;
  if (/ambient|downtempo|chill|lounge|balearic|dub\b|lo-?fi/.test(g)) n -= 0.12;
  if (/deep|organic|minimal|melodic/.test(g)) n -= 0.04;
  if (/hard|peak|industrial|trance|drum ?(and|&|n) ?bass|dnb|psy|rave|acid/.test(g)) n += 0.06;
  return n;
}

export function barSeconds(bpm: number): number {
  return 240 / bpm;
}

/** Snap a time onto the track's grid in steps of `bars` bars. */
export function snapToBars(t: number, p: { bpm: number; firstBeat: number }, bars = 4, dir: 'down' | 'up' | 'near' = 'near'): number {
  const step = barSeconds(p.bpm) * bars;
  const k = (t - p.firstBeat) / step;
  const r = dir === 'down' ? Math.floor(k + 1e-6) : dir === 'up' ? Math.ceil(k - 1e-6) : Math.round(k);
  return p.firstBeat + r * step;
}

interface WaveStats {
  energy: number;
  introEnd: number;
  outroStart: number;
}

const statsCache = new WeakMap<TrackAnalysis, WaveStats>();

function waveStats(a: TrackAnalysis, genre: string): WaveStats {
  const hit = statsCache.get(a);
  if (hit) return hit;
  const w = a.waveform;
  const rate = a.waveRate;
  const n = Math.floor(w.length / 4);
  const bpm = a.bpm > 0 ? a.bpm : 120;
  const bar = barSeconds(bpm);
  const first = Math.max(0, a.firstBeat);
  const bars = Math.max(1, Math.floor((a.duration - first) / bar));
  // per-bar mean of each band; the groove is where all three are near their usual level
  // (intros and outros usually drop the bass or the hats, breakdowns drop the kick)
  const bands = [new Float32Array(bars), new Float32Array(bars), new Float32Array(bars)];
  for (let b = 0; b < bars; b++) {
    const i0 = Math.floor((first + b * bar) * rate);
    const i1 = Math.min(n, Math.floor((first + (b + 1) * bar) * rate));
    for (let k = 0; k < 3; k++) {
      let s = 0;
      for (let i = i0; i < i1; i++) s += w[i * 4 + k];
      bands[k][b] = i1 > i0 ? s / (i1 - i0) : 0;
    }
  }
  const refs = bands.map((band) => [...band].sort((x, y) => x - y)[Math.floor(bars * 0.8)] || 1);
  const full = new Float32Array(bars);
  for (let b = 0; b < bars; b++) for (let k = 0; k < 3; k++) full[b] += Math.min(1.2, bands[k][b] / refs[k]);
  const on = (b: number) => b >= 0 && b < bars && full[b] >= 2.7;
  let inBar = 0;
  while (inBar < bars - 1 && !(on(inBar) && on(inBar + 1))) inBar++;
  let outBar = bars - 1;
  while (outBar > 0 && !(on(outBar) && on(outBar - 1))) outBar--;
  outBar += 1;
  // phrase-align, and keep the boundaries sensible for odd material
  inBar = Math.min(Math.round(inBar / 4) * 4, Math.floor((bars * 0.4) / 4) * 4);
  outBar = Math.max(Math.round(outBar / 4) * 4, Math.ceil((bars * 0.6) / 4) * 4);
  if (outBar <= inBar) outBar = Math.min(bars, inBar + 4);

  // energy from the body of the track
  const b0 = Math.floor((first + inBar * bar) * rate);
  const b1 = Math.max(b0 + 1, Math.min(n, Math.floor((first + outBar * bar) * rate)));
  let body = 0;
  let high = 0;
  let flux = 0;
  let prev = w[b0 * 4 + 3] ?? 0;
  for (let i = b0; i < b1; i++) {
    const f = w[i * 4 + 3];
    body += f;
    high += w[i * 4 + 2];
    if (f > prev) flux += f - prev;
    prev = f;
  }
  const len = b1 - b0;
  body /= len * 255;
  high /= len * 255;
  flux /= len * 255;
  const loudN = clamp((a.loudness + 20) / 14, 0, 1);
  const tempoN = clamp((bpm - 90) / 50, 0, 1);
  const fluxN = clamp(flux / 0.12, 0, 1);
  const brightN = clamp(high / Math.max(0.05, body), 0, 1);
  const energy = clamp(0.3 * loudN + 0.25 * tempoN + 0.2 * fluxN + 0.1 * brightN + 0.15 * body + genreNudge(genre), 0, 1);
  const out = { energy, introEnd: first + inBar * bar, outroStart: Math.min(a.duration, first + outBar * bar) };
  statsCache.set(a, out);
  return out;
}

/** Profile a library track, or null when there isn't enough to place it in a set. */
export function profileTrack(t: LibraryTrack): TrackProfile | null {
  if (t.status === 'error') return null;
  const m = t.meta;
  const base = {
    id: t.id,
    title: m.title,
    artist: m.artist,
    album: m.album,
    genre: m.genre,
    label: m.label ?? '',
    fileName: t.fileName,
    format: m.format,
    plays: t.plays,
    demoStyle: t.source === 'demo' ? t.demo?.style : undefined,
  };
  const a = t.analysis;
  if (a && a.bpm > 0 && a.duration > 20) {
    const s = waveStats(a, m.genre);
    return { ...base, bpm: a.bpm, key: a.key, duration: a.duration, firstBeat: Math.max(0, a.firstBeat), ...s, basis: 'analysis' };
  }
  if (t.source === 'demo' && t.demo) {
    const d = t.demo;
    const bar = barSeconds(d.bpm);
    const first = 0.05;
    const energy = clamp((STYLE_ENERGY[d.style] ?? 0.55) + (d.bpm - 126) * 0.006, 0, 1);
    return {
      ...base,
      bpm: d.bpm,
      key: makeKey(d.root, d.minor),
      duration: d.bars * bar + first + 2.5,
      firstBeat: first,
      energy,
      introEnd: first + Math.round(d.bars * 0.1875) * bar,
      outroStart: first + Math.round(d.bars * 0.875) * bar,
      basis: 'demo',
    };
  }
  return null;
}
