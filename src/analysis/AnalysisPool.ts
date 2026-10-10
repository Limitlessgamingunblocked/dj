/* Pool of analysis workers: several tracks analyse in parallel off the main thread. */
import AnalysisWorker from './analysis.worker?worker&inline';
import type { PcmData, TrackAnalysis } from '../core/types';
import type { SampleName } from '../audio/synth';

interface Job {
  msg: Record<string, unknown>;
  transfer: Transferable[];
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
}

export class AnalysisPool {
  private workers: Worker[] = [];
  private busy = new Set<Worker>();
  private dead = new Set<Worker>();
  private queue: Job[] = [];
  private pending = new Map<number, Job & { worker: Worker }>();
  private nextId = 1;
  readonly size: number;

  constructor(size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1))) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const w = new AnalysisWorker();
      w.onmessage = (e) => this.onDone(w, e.data);
      w.onerror = (e) => {
        e.preventDefault();
        // a worker that fails to start (or crashes) is retired; its job goes back in the queue
        this.dead.add(w);
        this.busy.delete(w);
        for (const [id, job] of this.pending) {
          if (job.worker === w) {
            this.pending.delete(id);
            this.queue.unshift({ msg: job.msg, transfer: [], resolve: job.resolve, reject: job.reject });
          }
        }
        this.pump();
      };
      this.workers.push(w);
    }
  }

  get queued(): number {
    return this.queue.length + this.pending.size;
  }

  private onDone(w: Worker, data: { id: number; ok: boolean; error?: string }): void {
    const job = this.pending.get(data.id);
    this.pending.delete(data.id);
    this.busy.delete(w);
    if (job) {
      if (data.ok) job.resolve(data as unknown as Record<string, unknown>);
      else job.reject(new Error(data.error || 'analysis failed'));
    }
    this.pump();
  }

  private pump(): void {
    if (this.dead.size === this.workers.length) {
      for (const job of this.queue.splice(0)) job.reject(new Error('Background workers are unavailable in this browser.'));
      return;
    }
    while (this.queue.length) {
      const w = this.workers.find((x) => !this.busy.has(x) && !this.dead.has(x));
      if (!w) return;
      const job = this.queue.shift()!;
      const id = this.nextId++;
      this.busy.add(w);
      this.pending.set(id, { ...job, worker: w });
      w.postMessage({ ...job.msg, id }, job.transfer);
    }
  }

  private run(msg: Record<string, unknown>, transfer: Transferable[] = [], priority = false): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const job = { msg, transfer, resolve, reject };
      if (priority) this.queue.unshift(job);
      else this.queue.push(job);
      this.pump();
    });
  }

  async analyze(pcm: PcmData, priority = false): Promise<TrackAnalysis> {
    const channels = pcm.channels.map((c) => c.slice());
    const r = await this.run({ type: 'analyze', channels, sampleRate: pcm.sampleRate }, channels.map((c) => c.buffer), priority);
    return r.analysis as TrackAnalysis;
  }

  async sample(name: SampleName, sampleRate: number): Promise<PcmData> {
    const r = await this.run({ type: 'sample', name, sampleRate });
    return r.pcm as PcmData;
  }

  async parsePcm(bytes: ArrayBuffer, priority = false): Promise<PcmData> {
    const r = await this.run({ type: 'parsePcm', bytes }, [bytes], priority);
    return r.pcm as PcmData;
  }
}
