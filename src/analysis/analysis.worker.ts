/// <reference lib="webworker" />
/* Analysis worker: track analysis, sampler sounds, PCM parsing. */
import { analyzePcm, mixToMono } from './analyze';
import { detectGenre } from './genre';
import { parsePcm } from './pcm';
import { renderSample, type SampleName } from '../audio/synth';

type Req =
  | { id: number; type: 'analyze'; channels: Float32Array[]; sampleRate: number }
  | { id: number; type: 'sample'; name: SampleName; sampleRate: number }
  | { id: number; type: 'parsePcm'; bytes: ArrayBuffer }
  | { id: number; type: 'genre'; channels: Float32Array[]; sampleRate: number; bpm: number; firstBeat: number; minor: boolean };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'analyze': {
        const analysis = analyzePcm(m.channels, m.sampleRate);
        ctx.postMessage({ id: m.id, ok: true, analysis }, [analysis.waveform.buffer]);
        break;
      }
      case 'sample': {
        const r = renderSample(m.name, m.sampleRate);
        ctx.postMessage({ id: m.id, ok: true, pcm: { sampleRate: r.sampleRate, channels: [r.left, r.right] } }, [r.left.buffer, r.right.buffer]);
        break;
      }
      case 'genre': {
        const g = detectGenre(mixToMono(m.channels), m.sampleRate, m.bpm, m.firstBeat, m.minor);
        ctx.postMessage({ id: m.id, ok: true, genre: { genre: g.genre, confidence: g.confidence, runnerUp: g.runnerUp } });
        break;
      }
      case 'parsePcm': {
        const pcm = parsePcm(m.bytes);
        ctx.postMessage({ id: m.id, ok: true, pcm }, pcm.channels.map((c) => c.buffer));
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
