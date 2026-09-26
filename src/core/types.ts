export type DeckId = 1 | 2 | 3 | 4;
export type Side = 'L' | 'R';

export interface HotCue {
  pos: number; // seconds
  color: string;
  name: string;
}

export interface KeyInfo {
  /** pitch class 0 = C */
  root: number;
  minor: boolean;
  camelot: string; // e.g. "8A"
  name: string; // e.g. "A min"
  confidence: number;
}

/** Result of track analysis (computed in a worker, cached in IndexedDB). */
export interface TrackAnalysis {
  version: number;
  duration: number;
  bpm: number;
  firstBeat: number; // seconds of the first downbeat
  key: KeyInfo | null;
  /** loudness estimate in dBFS (RMS of loud sections) used for auto gain */
  loudness: number;
  peak: number;
  /** waveform: WAVE_RATE points per second, 4 bytes per point: low, mid, high, full */
  waveform: Uint8Array;
  waveRate: number;
}

export interface TrackMeta {
  title: string;
  artist: string;
  album: string;
  genre: string;
  /** record label (ID3 TPUB, Vorbis LABEL/ORGANIZATION) */
  label?: string;
  year: string;
  bpmTag?: number;
  keyTag?: string;
  /** data URL of embedded cover art (downscaled) */
  art?: string;
  bitrate?: number; // kbps
  sampleRate?: number;
  format: string;
}

export interface LibraryTrack {
  id: string;
  fileName: string;
  size: number;
  addedAt: number;
  meta: TrackMeta;
  analysis?: TrackAnalysis;
  cues: { cue: number | null; hot: (HotCue | null)[] };
  /** "file": audio blob stored in IndexedDB. "demo": generated in the browser */
  source: 'file' | 'demo';
  demo?: DemoSpec;
  plays: number;
  status: 'new' | 'analyzing' | 'ready' | 'error';
  error?: string;
}

export interface DemoSpec {
  seed: number;
  bpm: number;
  root: number; // pitch class
  minor: boolean;
  style: 'house' | 'techno' | 'breaks' | 'garage';
  bars: number;
}

/** Decoded PCM independent of AudioBuffer so it can move between threads. */
export interface PcmData {
  sampleRate: number;
  channels: Float32Array[];
}

export const HOTCUE_COLORS = ['#ff3b5c', '#ff9f1c', '#ffd23f', '#3ddc97', '#2ec4f1', '#4f6bff', '#b36bff', '#ff5fcf'];
export const DECK_COLORS: Record<DeckId, string> = { 1: '#4cc9f0', 2: '#ff9f1c', 3: '#3ddc97', 4: '#c77dff' };
export const ANALYSIS_VERSION = 4;
export const WAVE_RATE = 150;
