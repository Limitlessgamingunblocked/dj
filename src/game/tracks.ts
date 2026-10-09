/*
 * What the game knows about a track (Section 7.1): energy 1–10, tags, the
 * lane it sits in, and section markers (intro, groove, breakdown, build,
 * drop, outro) so the game knows where the drops are.
 *
 * The original tracks are synthesised (audio/synth.ts), so their sections
 * come straight from the arrangement plan they're rendered with. Imported
 * music has no markers: its energy is estimated from tempo and loudness, and
 * the vibe meter falls back to the live audio features for drops.
 * TODO: let players mark sections on imported tracks (or detect them).
 */
import { DEMO_TRACKS, type DemoTrack } from '../audio/synth';
import type { DemoSpec, LibraryTrack } from '../core/types';

/** the crate tags (Section 6.8) */
export const TAGS = ['deep', 'groovy', 'rolling', 'vocal', 'rave', 'piano', 'garage', 'peak', 'afterhours', 'closer'] as const;
export type Tag = (typeof TAGS)[number];

export type SectionKind = 'intro' | 'groove' | 'breakdown' | 'build' | 'drop' | 'outro';

export interface Section {
  kind: SectionKind;
  /** first bar (0-based) */
  bar: number;
  /** start in track seconds */
  t: number;
}

export interface TrackInfo {
  /** 1 (barely there) .. 10 (peak time) */
  energy: number;
  tags: Tag[];
  /** null for imported music (no markers) */
  sections: Section[] | null;
  /** part of the game's own library (not imported, not one of the studio demos) */
  original: boolean;
  /** the player's own file: marked in the crate, kept on their device (Section 7.3) */
  imported: boolean;
}

/** the first downbeat of a synthesised track (synth.ts renders from here) */
export const DEMO_OFFSET = 0.05;

/**
 * The arrangement every synthesised track is rendered with, as fractions of
 * its length: a drums-first intro, the groove, a breakdown whose second half
 * builds, the drop, and a drums-out outro. 128 bars gives 16-bar intros and
 * outros; the older 64-bar demos get 8.
 */
const PLAN: [SectionKind, number][] = [
  ['intro', 0],
  ['groove', 0.125],
  ['breakdown', 0.5],
  ['build', 0.5625],
  ['drop', 0.625],
  ['outro', 0.875],
];

export function sectionsFor(spec: DemoSpec): Section[] {
  const bar = (60 / spec.bpm) * 4;
  return PLAN.map(([kind, f]) => {
    const b = Math.round(spec.bars * f);
    return { kind, bar: b, t: DEMO_OFFSET + b * bar };
  });
}

/** the section playing at track time `t` */
export function sectionAt(sections: Section[] | null, t: number): Section | null {
  if (!sections?.length) return null;
  // before the first downbeat is still the intro
  let cur = sections[0];
  for (const s of sections) if (s.t <= t + 1e-6) cur = s;
  return cur;
}

/** the next marker of a kind after `t` (where's the drop?) */
export function nextSection(sections: Section[] | null, kind: SectionKind, t: number): Section | null {
  return sections?.find((s) => s.kind === kind && s.t > t + 1e-6) ?? null;
}

/** how much each section lifts or drops the track's energy */
const SECTION_ENERGY: Record<SectionKind, number> = { intro: 0.7, groove: 1, breakdown: 0.55, build: 0.85, drop: 1.18, outro: 0.72 };

/** the energy the room feels at track time `t`, 0..1 */
export function energyAt(info: TrackInfo, t: number): number {
  const s = sectionAt(info.sections, t);
  return Math.max(0, Math.min(1, (info.energy / 10) * (s ? SECTION_ENERGY[s.kind] : 1)));
}

/** tags and energy for the older studio demos, by style */
const STYLE_INFO: Record<DemoSpec['style'], { energy: number; tags: Tag[] }> = {
  house: { energy: 5, tags: ['groovy'] },
  techno: { energy: 8, tags: ['peak'] },
  breaks: { energy: 6, tags: ['rave'] },
  garage: { energy: 6, tags: ['garage', 'groovy'] },
  minimal: { energy: 4, tags: ['deep', 'groovy'] },
  rolling: { energy: 6, tags: ['rolling'] },
  techhouse: { energy: 7, tags: ['groovy', 'vocal', 'peak'] },
  rave: { energy: 8, tags: ['rave', 'piano', 'peak'] },
};

const BY_SEED = new Map<number, DemoTrack>(DEMO_TRACKS.map((d) => [d.spec.seed, d]));

const clampEnergy = (e: number) => Math.max(1, Math.min(10, Math.round(e)));

/** an imported track's energy from its tempo and loudness (5 for a 124 BPM track at -10 dBFS) */
export function estimateEnergy(bpm: number, loudnessDb: number): number {
  if (!bpm) return 5;
  let b = bpm;
  // half / double-time readings land in the house range
  while (b < 100) b *= 2;
  while (b > 160) b /= 2;
  return clampEnergy(5 + (b - 124) / 3 + (loudnessDb + 10) / 3);
}

export function trackInfo(t: LibraryTrack): TrackInfo {
  if (t.source === 'demo' && t.demo) {
    const d = BY_SEED.get(t.demo.seed);
    const base = STYLE_INFO[t.demo.style];
    const energy = d?.energy ?? clampEnergy(base.energy + (t.demo.bpm - 126) / 4);
    return { energy, tags: (d?.tags as Tag[] | undefined) ?? base.tags, sections: sectionsFor(t.demo), original: !!d?.energy, imported: false };
  }
  const a = t.analysis;
  return { energy: a ? estimateEnergy(a.bpm, a.loudness) : 5, tags: [], sections: null, original: false, imported: true };
}

/** the game's own tracks, in library order */
export const ORIGINAL_IDS = DEMO_TRACKS.filter((d) => d.energy !== undefined).map((d) => `demo-${d.spec.seed}`);
