/// <reference lib="webworker" />
/* Analysis worker: track analysis, demo track rendering, PCM parsing. */
import { analyzePcm } from './analyze';
import { parsePcm } from './pcm';
import { renderDemoTrack, renderSample, type SampleName } from '../audio/synth';
import type { DemoSpec } from '../core/types';

type Req =
  | { id: number; type: 'analyze'; channels: Float32Array[]; sampleRate: number }
  | { id: number; type: 'demo'; spec: DemoSpec; sampleRate: number; analyze: boolean; returnPcm: boolean }
  | { id: number; type: 'sample'; name: SampleName; sampleRate: number }
  | { id: number; type: 'parsePcm'; bytes: ArrayBuffer };

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
      case 'demo': {
        const r = renderDemoTrack(m.spec, m.sampleRate);
        const analysis = m.analyze ? analyzePcm([r.left, r.right], r.sampleRate) : null;
        const transfer: Transferable[] = [];
        if (analysis) transfer.push(analysis.waveform.buffer);
        const pcm = m.returnPcm ? { sampleRate: r.sampleRate, channels: [r.left, r.right] } : null;
        if (pcm) transfer.push(r.left.buffer, r.right.buffer);
        ctx.postMessage({ id: m.id, ok: true, analysis, pcm }, transfer);
        break;
      }
      case 'sample': {
        const r = renderSample(m.name, m.sampleRate);
        ctx.postMessage({ id: m.id, ok: true, pcm: { sampleRate: r.sampleRate, channels: [r.left, r.right] } }, [r.left.buffer, r.right.buffer]);
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
