/*
 * Set generation: picks tracks around the anchor artists / labels / genres,
 * injects similar-sounding "discovery" tracks from the rest of the library,
 * and orders everything with a beam search that balances harmonic mixing,
 * tempo steps, the chosen energy arc and variety. `describeSet` turns any
 * track order (generated or hand-edited) into timings, transition guidance
 * and scores.
 */
import type { KeyInfo } from '../core/types';
import { clamp, rng } from '../core/util';
import { arcById, arcEnergy, type ArcDef, type ArcId } from './arcs';
import { keyRelation, keyShiftFix, tempoMatch, tempoScore, type KeyRelation } from './harmony';
import { barSeconds, snapToBars, type TrackProfile } from './profile';
import { fieldMatches, journeyOrder, normalize, styleFit, styleForAnchor, type StyleProfile } from './styles';

export { fieldMatches, normalize };

export type TransitionStyle = 'cut' | 'blend' | 'long';

export const TRANSITION_STYLES: Record<TransitionStyle, { name: string; blurb: string; bars: number; tolerance: number; keyWeight: number }> = {
  cut: { name: 'Quick cuts', blurb: '4-bar swaps on the phrase — tempo and key can move more.', bars: 4, tolerance: 10, keyWeight: 0.2 },
  blend: { name: 'Smooth blends', blurb: '16-bar EQ blends with the tempos locked.', bars: 16, tolerance: 5, keyWeight: 0.3 },
  long: { name: 'Long atmospheric', blurb: '32-bar layered blends — keys and tempos must sit tight.', bars: 32, tolerance: 3.5, keyWeight: 0.38 },
};

export type SetTarget = { kind: 'minutes'; minutes: number } | { kind: 'tracks'; count: number };

export interface SetOptions {
  /** artists, labels, albums or genres that define the sound of the set */
  anchors: string[];
  target: SetTarget;
  arc: ArcId;
  style: TransitionStyle;
  /** share of the set given to discovery tracks, 0–0.5 */
  discovery: number;
  /** changes the pick between equally good sets */
  seed: number;
  /** tracks that must be in the set */
  pinned?: string[];
  /** tracks that must not be in the set */
  exclude?: string[];
  /** order of a Style Journey: deep → peak, or the order the anchors were typed */
  journeyOrder?: 'energy' | 'typed';
}

/** library: no anchors were given (or none matched); sound: carries an anchor artist's sound profile; filler: outside the anchors' sound, used only to reach the target */
export type Role = 'anchor' | 'style' | 'sound' | 'discovery' | 'library' | 'filler';

export interface Candidate {
  profile: TrackProfile;
  role: Role;
  /** 0–1: how well the track fits the anchors */
  affinity: number;
  why: string;
  /** energy mapped onto the pool's spread, 0–1 */
  level: number;
  /** fit to each style anchor's sound (style id → 0–1) */
  fits?: Record<string, number>;
  /** the style anchor this track sounds most like */
  sound?: string;
}

export interface SetEntry extends Candidate {
  /** where the track starts in the set, seconds */
  startAt: number;
  /** where playback starts in the track (the mix-in cue), seconds */
  cueIn: number;
  /** where the next transition starts in this track, seconds (end of track for the last) */
  mixOut: number;
  /** the arc's energy target at this point of the set, 0–1 */
  target: number;
  pinned: boolean;
}

export interface Transition {
  bpmFrom: number;
  bpmTo: number;
  /** pitch change on the incoming deck to beat-match, percent */
  pitchPct: number;
  tempoMode: 'direct' | 'double' | 'half';
  key: KeyRelation;
  keyFrom: KeyInfo | null;
  keyTo: KeyInfo | null;
  /** suggested key shift on the incoming deck when the keys clash */
  keyFix: { semis: number; camelot: string } | null;
  energyDelta: number;
  bars: number;
  seconds: number;
  /** outgoing track time where the transition starts */
  outAt: number;
  /** incoming track time where it is started */
  inAt: number;
  /** 0–100 */
  score: number;
  tip: string;
}

export interface SetPlan {
  options: SetOptions;
  entries: SetEntry[];
  transitions: Transition[];
  duration: number;
  harmonicScore: number;
  flowScore: number;
  bpmMin: number;
  bpmMax: number;
  warnings: string[];
  /** informational notes (e.g. which sound profiles were used) */
  notes: string[];
  /** style anchors in the order a Style Journey visits them */
  journey: string[];
  /** a Style Journey's energy targets, fitted to the tracks that carry each style */
  arcPoints?: [number, number][];
}

/* ------------------------------------------------------------------ */
/* anchors & candidates                                                 */
/* ------------------------------------------------------------------ */

export function parseAnchors(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const a = raw.trim();
    if (a && !seen.has(normalize(a))) {
      seen.add(normalize(a));
      out.push(a);
    }
  }
  return out;
}

function mainArtist(p: TrackProfile): string {
  return normalize(p.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bvs\.?|\band\b|\bx\b)\s*/i)[0] ?? '');
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function tempoDistance(a: number, b: number): number {
  return Math.abs(tempoMatch(a, b).pct);
}

interface AnchorProfile {
  bpm: number;
  bpmSpread: number;
  energy: number;
  genres: Set<string>;
  keys: KeyInfo[];
}

function anchorProfile(matched: TrackProfile[]): AnchorProfile {
  const bpms = matched.map((p) => p.bpm).sort((a, b) => a - b);
  const q = (f: number) => bpms[Math.min(bpms.length - 1, Math.floor(bpms.length * f))];
  const bpm = median(bpms);
  const genres = new Set<string>();
  for (const p of matched) for (const g of normalize(p.genre).split(' ')) if (g.length > 2) genres.add(g);
  return {
    bpm,
    bpmSpread: Math.max(3, ((q(0.8) - q(0.2)) / bpm) * 100),
    energy: matched.reduce((s, p) => s + p.energy, 0) / matched.length,
    genres,
    keys: matched.map((p) => p.key).filter((k): k is KeyInfo => !!k),
  };
}

/** How close a track sits to the anchors' sound (tempo, energy, genre words, keys), 0–1. */
function similarity(p: TrackProfile, ap: AnchorProfile): { score: number; why: string } {
  const td = tempoDistance(ap.bpm, p.bpm);
  const tempo = Math.exp(-((td / ap.bpmSpread) ** 2));
  const energy = clamp(1 - Math.abs(p.energy - ap.energy) * 2.5, 0, 1);
  const words = normalize(p.genre).split(' ').filter((g) => g.length > 2);
  const genre = !words.length ? 0.4 : words.some((g) => ap.genres.has(g)) ? 1 : 0;
  let key = 0.5;
  if (p.key && ap.keys.length) key = Math.max(...ap.keys.map((k) => keyRelation(k, p.key).score));
  const score = 0.4 * tempo + 0.25 * energy + 0.2 * genre + 0.15 * key;
  const bits: string[] = [];
  if (tempo > 0.7) bits.push(`${Math.round(p.bpm)} BPM like your anchors`);
  if (genre === 1 && p.genre) bits.push(`${p.genre} feel`);
  if (energy > 0.75) bits.push('matching energy');
  if (key > 0.85) bits.push('keys that sit with theirs');
  return { score, why: bits.length ? `Sounds like the anchors: ${bits.join(', ')}` : 'Close to the anchors’ tempo and energy' };
}

export interface CandidatePool {
  candidates: Candidate[];
  matchedAnchors: string[];
  unmatchedAnchors: string[];
  warnings: string[];
  notes: string[];
  /** style anchors, in journey order */
  journey: StyleProfile[];
}

/** Tracks at or above this fit carry an artist's sound. */
const SOUND_FIT = 0.62;

/** Scores the library against the anchors and decides each track's role in the set. */
export function buildPool(profiles: TrackProfile[], opts: Pick<SetOptions, 'anchors' | 'discovery' | 'exclude' | 'pinned' | 'journeyOrder'>): CandidatePool {
  const exclude = new Set(opts.exclude ?? []);
  const pinned = new Set(opts.pinned ?? []);
  // one entry per song: the same artist + title imported twice would repeat in a set
  const seen = new Set<string>();
  const list: TrackProfile[] = [];
  for (const p of profiles) {
    if (exclude.has(p.id)) continue;
    const k = `${normalize(p.artist)}|${normalize(p.title)}`;
    if (seen.has(k) && !pinned.has(p.id)) continue;
    seen.add(k);
    list.push(p);
  }
  const warnings: string[] = [];
  const matched = new Map<string, { role: Role; why: string }>();
  const hit = new Set<string>();
  for (const p of list) {
    for (const a of opts.anchors) {
      if (fieldMatches(p.artist, a)) {
        matched.set(p.id, { role: 'anchor', why: `Anchor artist: ${a}` });
        hit.add(a);
        break;
      }
      if (p.label && fieldMatches(p.label, a)) {
        matched.set(p.id, { role: 'anchor', why: `Anchor label: ${a}` });
        hit.add(a);
        break;
      }
      if (fieldMatches(p.album, a) && !matched.has(p.id)) {
        matched.set(p.id, { role: 'anchor', why: `From ${p.album}` });
        hit.add(a);
      } else if (fieldMatches(p.genre, a) && !matched.has(p.id)) {
        matched.set(p.id, { role: 'style', why: `Genre: ${p.genre}` });
        hit.add(a);
      }
    }
  }
  // artist sound profiles: tracks that carry the sound of a style anchor
  const notes: string[] = [];
  const journey = journeyOrder(opts.anchors, opts.journeyOrder);
  const fits = new Map<string, Record<string, number>>();
  const sounds = new Map<string, { style: StyleProfile; fit: number; why: string }>();
  if (journey.length) {
    for (const p of list) {
      const f: Record<string, number> = {};
      let best: { style: StyleProfile; fit: number; why: string } | null = null;
      for (const st of journey) {
        const r = styleFit(p, st);
        f[st.id] = r.score;
        if (!best || r.score > best.fit) best = { style: st, fit: r.score, why: r.why };
      }
      fits.set(p.id, f);
      if (best && best.fit >= SOUND_FIT) sounds.set(p.id, best);
    }
    for (const st of journey) {
      const a = opts.anchors.find((x) => styleForAnchor(x) === st)!;
      const n = [...sounds.values()].filter((x) => x.style === st).length;
      const own = hit.has(a);
      if (n) hit.add(a);
      notes.push(
        own
          ? `${st.name}: your ${st.name} tracks plus ${n} track${n === 1 ? '' : 's'} with their sound (${st.sound}).`
          : n
            ? `No ${st.name} tracks in your library — matched their sound instead: ${st.sound}, ${st.bpm[0]}–${st.bpm[1]} BPM (${n} track${n === 1 ? '' : 's'}).`
            : `No ${st.name} tracks in your library, and nothing close to their sound (${st.sound}) yet — import some.`,
      );
    }
    for (const [id, snd] of sounds) if (!matched.has(id) || matched.get(id)!.role === 'style') matched.set(id, { role: 'sound', why: snd.why });
  }
  const matchedAnchors = opts.anchors.filter((a) => hit.has(a));
  const unmatchedAnchors = opts.anchors.filter((a) => !hit.has(a) && !styleForAnchor(a));
  const out: { profile: TrackProfile; role: Role; affinity: number; why: string; fits?: Record<string, number>; sound?: string }[] = [];
  if (!matched.size) {
    if (opts.anchors.length) warnings.push('None of your anchors match an artist, label, album or genre in the library, so the set draws on the whole library.');
    for (const p of list) out.push({ profile: p, role: 'library', affinity: 0.8, why: 'From your library', fits: fits.get(p.id) });
  } else {
    if (unmatchedAnchors.length) warnings.push(`Not in your library: ${unmatchedAnchors.join(', ')}.`);
    const ap = anchorProfile(list.filter((p) => matched.has(p.id)));
    for (const p of list) {
      const m = matched.get(p.id);
      const snd = sounds.get(p.id);
      const extra = { fits: fits.get(p.id), sound: snd?.style.name };
      if (m) {
        const affinity = m.role === 'anchor' ? 1 : m.role === 'sound' ? clamp(0.6 + 0.36 * (snd?.fit ?? 0.6), 0, 0.96) : 0.82;
        out.push({ profile: p, role: m.role, affinity, why: m.why, ...extra });
        continue;
      }
      const s = similarity(p, ap);
      // lesser-played tracks get a small push: that's where the forgotten gems are
      const gem = 0.08 / (1 + p.plays);
      if (s.score >= 0.55 && opts.discovery > 0) out.push({ profile: p, role: 'discovery', affinity: clamp(0.5 + 0.4 * s.score + gem, 0, 0.95), why: p.plays === 0 ? `${s.why} · never played` : s.why, ...extra });
      else out.push({ profile: p, role: 'filler', affinity: 0.25 * s.score, why: 'Filler from your library', ...extra });
    }
  }
  // energy relative to what's available, so every arc can use the whole pool
  const byEnergy = [...out].sort((a, b) => a.profile.energy - b.profile.energy);
  const rank = new Map(byEnergy.map((c, i) => [c.profile.id, byEnergy.length > 1 ? i / (byEnergy.length - 1) : 0.5]));
  const candidates = out.map((c) => ({ ...c, level: clamp(0.6 * rank.get(c.profile.id)! + 0.4 * c.profile.energy, 0, 1) }));
  return { candidates, matchedAnchors, unmatchedAnchors, warnings, notes, journey };
}

/** The energy arc for a set; a Style Journey follows its styles' energy bands (or `points` fitted to the pool). */
export function resolveArc(options: Pick<SetOptions, 'arc' | 'anchors' | 'journeyOrder'>, fitted?: [number, number][]): ArcDef {
  const arc = arcById(options.arc);
  if (arc.id !== 'journey') return arc;
  if (fitted?.length) return { ...arc, points: fitted };
  const js = journeyOrder(options.anchors, options.journeyOrder);
  if (!js.length) return arc;
  const mid = (s: StyleProfile) => (s.energy[0] + s.energy[1]) / 2;
  const k = js.length;
  const points: [number, number][] = [[0, k > 1 ? (js[0].energy[0] + mid(js[0])) / 2 : mid(js[0])]];
  js.forEach((s, i) => points.push([(i + 0.5) / k, mid(s)]));
  points.push([1, k > 1 ? (mid(js[k - 1]) + js[k - 1].energy[1]) / 2 : mid(js[0])]);
  return { ...arc, points };
}

/** Journey targets from the pool: each style's stretch aims at the energy of the tracks that carry it. */
function journeyPoints(journey: StyleProfile[], candidates: Candidate[]): [number, number][] | undefined {
  if (journey.length < 2) return undefined;
  const levels = journey.map((st) => {
    // the handful of tracks that carry the style best set its energy
    const best = candidates
      .filter((c) => (c.fits?.[st.id] ?? 0) >= SOUND_FIT)
      .sort((a, b) => (b.fits![st.id] ?? 0) - (a.fits![st.id] ?? 0))
      .slice(0, 4)
      .map((c) => c.level);
    return best.length ? median(best) : (st.energy[0] + st.energy[1]) / 2;
  });
  // keep the climb monotonic for an energy-ordered journey even if two styles overlap
  const k = journey.length;
  const pts: [number, number][] = [[0, levels[0] - 0.03]];
  levels.forEach((l, i) => pts.push([(i + 0.5) / k, clamp(l, 0.05, 1)]));
  pts.push([1, clamp(levels[k - 1] + 0.03, 0, 1)]);
  return pts;
}

/** Which style a Style Journey is in at position t (0–1) of the set. */
function journeyStyle(journey: StyleProfile[], t: number): StyleProfile | null {
  if (journey.length < 2) return null;
  return journey[Math.min(journey.length - 1, Math.floor(clamp(t, 0, 0.9999) * journey.length))];
}

/* ------------------------------------------------------------------ */
/* timing                                                               */
/* ------------------------------------------------------------------ */

/** Transition length in bars for this style, shortened for tracks too short to carry it. */
export function mixBars(p: TrackProfile, style: TransitionStyle): number {
  const max = Math.floor((p.duration * 0.35) / barSeconds(p.bpm) / 4) * 4;
  return Math.max(4, Math.min(TRANSITION_STYLES[style].bars, max));
}

/** Where playback starts in a track: its first downbeat, or late in the intro for quick cuts so the groove lands on the cut. */
export function cueInFor(p: TrackProfile, style: TransitionStyle): number {
  if (style !== 'cut') return p.firstBeat;
  return Math.max(p.firstBeat, p.introEnd - barSeconds(p.bpm) * TRANSITION_STYLES.cut.bars);
}

/** Where the transition out of a track starts, on a 4-bar boundary. */
export function mixOutFor(p: TrackProfile, style: TransitionStyle, bars = mixBars(p, style)): number {
  const bar = barSeconds(p.bpm);
  const len = bars * bar;
  const lastBar = snapToBars(p.duration - 0.25, p, 1, 'down');
  const end = style === 'cut' ? p.outroStart : Math.min(lastBar, p.outroStart + (style === 'long' ? len * 0.5 : len * 0.25));
  // play at least 64 bars (or 35 % of a short track) before mixing out
  const floor = cueInFor(p, style) + Math.min(p.duration * 0.35, 64 * bar);
  return Math.max(snapToBars(floor, p, 4, 'up'), snapToBars(end - len, p, 4, 'down'));
}

/** How much set time a track takes before the next one starts (or its full length when last). */
function playTime(p: TrackProfile, style: TransitionStyle, last: boolean): number {
  const cue = cueInFor(p, style);
  return (last ? p.duration : mixOutFor(p, style)) - cue;
}

/* ------------------------------------------------------------------ */
/* transition scoring                                                   */
/* ------------------------------------------------------------------ */

function stepScore(prev: Candidate | null, c: Candidate, target: number, style: TransitionStyle, recent: string[]): number {
  const st = TRANSITION_STYLES[style];
  const energy = clamp(1 - Math.abs(c.level - target) * 2.2, 0, 1);
  let s = 0.3 * energy + 0.22 * c.affinity;
  if (prev) {
    s += st.keyWeight * keyRelation(prev.profile.key, c.profile.key).score;
    s += 0.25 * tempoScore(prev.profile.bpm, c.profile.bpm, st.tolerance);
    const a = mainArtist(c.profile);
    if (a && a === recent[recent.length - 1]) s -= 0.25;
    else if (a && recent.includes(a)) s -= 0.08;
  } else s += (st.keyWeight + 0.25) * 0.8;
  return s;
}

/* ------------------------------------------------------------------ */
/* generation                                                           */
/* ------------------------------------------------------------------ */

interface Beam {
  seq: number[];
  used: Uint8Array;
  score: number;
  elapsed: number;
  disc: number;
  pins: number;
  artists: string[];
  done: boolean;
  total: number;
}

const BEAM_WIDTH = 40;
const MAX_POOL = 260;

/** Builds a set from track profiles. */
export function generateSet(profiles: TrackProfile[], options: SetOptions): SetPlan {
  const pool = buildPool(profiles, options);
  const warnings = [...pool.warnings];
  const pinned = new Set(options.pinned ?? []);
  const journey = pool.journey;
  const arcPoints = options.arc === 'journey' ? journeyPoints(journey, pool.candidates) : undefined;
  const arc = resolveArc(options, arcPoints);
  const style = options.style;
  const target = options.target;
  const byTime = target.kind === 'minutes';
  const targetSec = target.kind === 'minutes' ? target.minutes * 60 : 0;

  // choose which tracks may appear: anchors and discoveries first, fillers only when needed
  const core = pool.candidates.filter((c) => c.role !== 'filler' || pinned.has(c.profile.id));
  const fillers = pool.candidates.filter((c) => c.role === 'filler' && !pinned.has(c.profile.id)).sort((a, b) => b.affinity - a.affinity);
  const avail = (cs: Candidate[]) => cs.reduce((s, c) => s + playTime(c.profile, style, false), 0);
  let cands = core;
  const needCount = target.kind === 'tracks' ? target.count : 0;
  const quotaOf = (n: number) => Math.round(n * clamp(options.discovery, 0, 0.5));
  if (fillers.length && (byTime ? avail(core) < targetSec : core.length < needCount)) {
    const extra: Candidate[] = [];
    for (const f of fillers) {
      if (byTime ? avail([...core, ...extra]) >= targetSec * 1.15 : core.length + extra.length >= needCount + 2) break;
      extra.push(f);
    }
    cands = [...core, ...extra];
    if (pool.matchedAnchors.length && extra.length) warnings.push(`Not enough tracks around your anchors — added ${extra.length} filler track${extra.length > 1 ? 's' : ''} from the rest of the library.`);
  }
  if (cands.length > MAX_POOL) {
    cands = [...cands].sort((a, b) => Number(pinned.has(b.profile.id)) - Number(pinned.has(a.profile.id)) || b.affinity - a.affinity).slice(0, MAX_POOL);
  }
  const n = cands.length;
  if (!n) {
    return { ...describeSet([], options, warnings.length ? warnings : ['Your library has no analysed tracks yet. Import music, or wait for the analysis to finish.'], pool.notes, arcPoints) };
  }
  const plays = cands.map((c) => playTime(c.profile, style, false));
  const fulls = cands.map((c) => playTime(c.profile, style, true));
  const estCount = byTime ? Math.max(1, Math.round(targetSec / Math.max(30, median(plays)))) : needCount;
  const quota = quotaOf(estCount);
  if (!byTime && n < needCount) warnings.push(`Only ${n} suitable tracks are available, so the set is shorter than ${needCount}.`);
  const count = byTime ? Infinity : Math.min(needCount, n);
  const pinCount = cands.filter((c) => pinned.has(c.profile.id)).length;
  const rand = rng(options.seed * 7919 + 17);
  const jitter = cands.map(() => (rand() - 0.5) * 0.08);
  const tol = Math.min(240, targetSec * 0.06);

  let beams: Beam[] = [{ seq: [], used: new Uint8Array(n), score: 0, elapsed: 0, disc: 0, pins: 0, artists: [], done: false, total: 0 }];
  let finished: Beam[] = [];
  let lastBeams: Beam[] = [];
  // finished sets of different lengths compete on their average score per track
  const rankBeam = (b: Beam) => {
    let s = b.score / Math.max(1, b.seq.length);
    if (byTime) s -= (Math.abs(b.total - targetSec) / targetSec) * 1.5;
    return s - (pinCount - b.pins) * 0.5;
  };
  for (let step = 0; step < Math.min(n, byTime ? n : count); step++) {
    const next: { b: Beam; c: number; score: number; done: boolean }[] = [];
    for (const b of beams) {
      const prev = b.seq.length ? cands[b.seq[b.seq.length - 1]] : null;
      const pinsLeft = pinCount - b.pins;
      const slotsLeft = byTime ? Infinity : count - b.seq.length;
      for (let c = 0; c < n; c++) {
        if (b.used[c]) continue;
        const cand = cands[c];
        const isPin = pinned.has(cand.profile.id);
        if (!isPin && pinsLeft >= slotsLeft) continue;
        if (cand.role === 'discovery' && b.disc >= quota) continue;
        let done = false;
        let total = 0;
        let t: number;
        if (byTime) {
          total = b.elapsed + fulls[c];
          done = total >= targetSec - tol;
          if (done && pinsLeft - (isPin ? 1 : 0) > 0) continue;
          t = clamp((b.elapsed + plays[c] * 0.5) / targetSec, 0, 1);
        } else {
          done = b.seq.length + 1 >= count;
          t = count > 1 ? b.seq.length / (count - 1) : 0;
        }
        let s = stepScore(prev, cand, arcEnergy(arc, t), style, b.artists) + jitter[c];
        // Style Journey: reward the style whose stretch of the set this is
        const js = journeyStyle(journey, t);
        if (js && cand.fits) {
          const here = cand.fits[js.id] ?? 0;
          const elsewhere = Math.max(...journey.filter((x) => x !== js).map((x) => cand.fits![x.id] ?? 0));
          s += 0.5 * here - 0.2 * Math.max(0, elsewhere - here);
          // discoveries have to suit the stretch they land in
          if (cand.role === 'discovery' && here < 0.55) s -= 0.3;
        }
        if (isPin) s += 0.5;
        if (cand.role === 'discovery') s += 0.12;
        if (byTime && total > targetSec + tol) s -= ((total - targetSec - tol) / targetSec) * 4;
        next.push({ b, c, score: b.score + s, done });
      }
    }
    if (!next.length) break;
    lastBeams = beams;
    // every live beam has the same length here, so raw scores compare fairly
    next.sort((x, y) => y.score - x.score);
    const kept: Beam[] = [];
    const done: Beam[] = [];
    for (const e of next) {
      const used = e.b.used.slice();
      used[e.c] = 1;
      const cand = cands[e.c];
      const elapsed = e.b.elapsed + plays[e.c];
      const nb: Beam = {
        seq: [...e.b.seq, e.c],
        used,
        score: e.score,
        elapsed,
        disc: e.b.disc + (cand.role === 'discovery' ? 1 : 0),
        pins: e.b.pins + (pinned.has(cand.profile.id) ? 1 : 0),
        artists: [...e.b.artists.slice(-2), mainArtist(cand.profile)],
        done: e.done,
        total: e.b.elapsed + fulls[e.c],
      };
      if (nb.done) {
        if (done.length < BEAM_WIDTH) done.push(nb);
      } else if (kept.length < BEAM_WIDTH) kept.push(nb);
      if (kept.length >= BEAM_WIDTH && done.length >= BEAM_WIDTH) break;
    }
    finished = [...finished, ...done].sort((a, b) => rankBeam(b) - rankBeam(a)).slice(0, BEAM_WIDTH);
    beams = kept;
    if (!beams.length) break;
  }
  // the pool ran out before the target: settle for the best unfinished beam
  const pickFrom = finished.length ? finished : beams.length ? beams : lastBeams;
  const best = [...pickFrom].sort((a, b) => rankBeam(b) - rankBeam(a))[0];
  const seq = best ? best.seq.map((i) => cands[i]) : [];
  if (byTime && !finished.length && seq.length) warnings.push('Your library ran out of suitable tracks before the target length.');
  if (options.discovery > 0 && pool.matchedAnchors.length && !seq.some((c) => c.role === 'discovery') && quota > 0) warnings.push('No discovery tracks fit this set — import more music in the anchors’ style to get some.');
  return describeSet(seq, options, warnings, pool.notes, arcPoints);
}

/* ------------------------------------------------------------------ */
/* describing a set                                                     */
/* ------------------------------------------------------------------ */

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function describeTransition(a: SetEntry, b: SetEntry, style: TransitionStyle): Transition {
  const tm = tempoMatch(a.profile.bpm, b.profile.bpm);
  const key = keyRelation(a.profile.key, b.profile.key);
  const fix = keyShiftFix(a.profile.key, b.profile.key);
  const bars = Math.min(mixBars(a.profile, style), mixBars(b.profile, style));
  const seconds = bars * barSeconds(a.profile.bpm);
  const tScore = tempoScore(a.profile.bpm, b.profile.bpm, TRANSITION_STYLES[style].tolerance);
  const eDelta = b.level - a.level;
  const energyFit = clamp(1 - Math.abs(b.level - b.target) * 2.2, 0, 1);
  const score = Math.round(100 * (0.45 * key.score + 0.35 * tScore + 0.2 * energyFit));
  const tips: string[] = [];
  const pitch = Math.abs(tm.pct) < 0.05 ? 'Tempos already match' : `Pitch the incoming deck ${tm.pct > 0 ? '+' : '−'}${Math.abs(tm.pct).toFixed(1)}% (or hit Sync)`;
  tips.push(tm.mode === 'direct' ? pitch : `${pitch} — it mixes in ${tm.mode} time`);
  if (style === 'cut') tips.push(`Cut across on the 1 at ${fmt(a.mixOut + seconds)} once the incoming groove lands`);
  else tips.push(`Start it at ${fmt(a.mixOut)} and blend ${bars} bars; swap the lows at bar ${bars / 2 + 1}`);
  if (fix) tips.push(`Key clash: shift the incoming key ${fix.semis > 0 ? '+' : '−'}${Math.abs(fix.semis)} (plays as ${fix.key.camelot})`);
  else if (key.kind === 'clash') tips.push('Keys clash: keep the overlap short and ride the filter');
  if (Math.abs(tm.pct) > TRANSITION_STYLES[style].tolerance) tips.push('Big tempo jump: consider an echo-out instead of a blend');
  return {
    bpmFrom: a.profile.bpm,
    bpmTo: b.profile.bpm,
    pitchPct: tm.pct,
    tempoMode: tm.mode,
    key,
    keyFrom: a.profile.key,
    keyTo: b.profile.key,
    keyFix: fix ? { semis: fix.semis, camelot: fix.key.camelot } : null,
    energyDelta: eDelta,
    bars,
    seconds,
    outAt: a.mixOut,
    inAt: b.cueIn,
    score,
    tip: tips.join('. ') + '.',
  };
}

/** Timings, transitions and scores for a track order. */
export function describeSet(seq: Candidate[], options: SetOptions, warnings: string[] = [], notes: string[] = [], arcPoints?: [number, number][]): SetPlan {
  const arc = resolveArc(options, arcPoints);
  const style = options.style;
  const pinned = new Set(options.pinned ?? []);
  const entries: SetEntry[] = [];
  let at = 0;
  const lengths = seq.map((c, i) => playTime(c.profile, style, i === seq.length - 1));
  const total = lengths.reduce((s, x) => s + x, 0);
  seq.forEach((c, i) => {
    const t = total > 0 ? (at + lengths[i] * 0.5) / total : 0;
    entries.push({
      ...c,
      startAt: at,
      cueIn: cueInFor(c.profile, style),
      mixOut: i === seq.length - 1 ? c.profile.duration : mixOutFor(c.profile, style),
      target: arcEnergy(arc, clamp(t, 0, 1)),
      pinned: pinned.has(c.profile.id),
    });
    at += lengths[i];
  });
  const transitions: Transition[] = [];
  for (let i = 1; i < entries.length; i++) transitions.push(describeTransition(entries[i - 1], entries[i], style));
  const bpms = entries.map((e) => e.profile.bpm);
  const harmonic = transitions.length ? transitions.reduce((s, t) => s + t.key.score, 0) / transitions.length : 1;
  const flow = transitions.length ? transitions.reduce((s, t) => s + t.score, 0) / transitions.length : 100;
  return {
    options,
    entries,
    transitions,
    duration: total,
    harmonicScore: Math.round(harmonic * 100),
    flowScore: Math.round(flow),
    bpmMin: bpms.length ? Math.min(...bpms) : 0,
    bpmMax: bpms.length ? Math.max(...bpms) : 0,
    warnings,
    notes,
    journey: journeyOrder(options.anchors, options.journeyOrder).map((s) => s.name),
    arcPoints,
  };
}

/**
 * Best replacements for the track at `index`, scored against its neighbours
 * and the arc target at that point.
 */
export function alternativesFor(plan: SetPlan, pool: Candidate[], index: number, limit = 8): { candidate: Candidate; score: number }[] {
  const style = plan.options.style;
  const e = plan.entries[index];
  const prev = plan.entries[index - 1] ?? null;
  const next = plan.entries[index + 1] ?? null;
  const inSet = new Set(plan.entries.map((x) => x.profile.id));
  const out: { candidate: Candidate; score: number }[] = [];
  for (const c of pool) {
    if (inSet.has(c.profile.id)) continue;
    let s = stepScore(prev, c, e.target, style, prev ? [mainArtist(prev.profile)] : []);
    if (next) {
      const st = TRANSITION_STYLES[style];
      s += st.keyWeight * keyRelation(c.profile.key, next.profile.key).score + 0.25 * tempoScore(c.profile.bpm, next.profile.bpm, st.tolerance);
    }
    out.push({ candidate: c, score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
