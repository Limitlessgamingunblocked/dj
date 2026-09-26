/* Full track analysis (pure function, runs in the analysis workers). */
import { ANALYSIS_VERSION, WAVE_RATE, type TrackAnalysis } from '../core/types';
import { detectKey } from './key';
import { detectTempo } from './tempo';
import { computeWaveform, loudness } from './waveform';

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const g = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * g;
  return out;
}

export function analyzePcm(channels: Float32Array[], sampleRate: number): TrackAnalysis {
  const mono = mixToMono(channels);
  const duration = mono.length / sampleRate;
  const tempo = detectTempo(mono, sampleRate);
  const key = detectKey(mono, sampleRate);
  const waveform = computeWaveform(mono, sampleRate, WAVE_RATE);
  const loud = loudness(mono, sampleRate);
  return {
    version: ANALYSIS_VERSION,
    duration,
    bpm: tempo.bpm,
    firstBeat: tempo.firstBeat,
    key,
    loudness: loud.loudness,
    peak: loud.peak,
    waveform,
    waveRate: WAVE_RATE,
  };
}
