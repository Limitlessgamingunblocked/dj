/*
 * The capture tap on the clean master (before the room's acoustics): it
 * feeds the replay buffer (Section 12) and every recording (Section 11).
 *
 * The clock everything else uses for recordings, markers and thumbnails is
 * the AudioContext's own (seconds): each block arrives stamped with the
 * frame it ends on, so the buffer, the tracklist and the video line up.
 */
import { PcmRing, PcmTape } from './pcm';

export type ChunkListener = (l: Float32Array, r: Float32Array, endTime: number) => void;

export class Capture {
  readonly rate: number;
  private node: AudioWorkletNode | null = null;
  /** the replay buffer (null when it's off) */
  ring: PcmRing | null = null;
  private tapes = new Set<PcmTape>();
  private listeners = new Set<ChunkListener>();
  /** the capture clock: where the newest block ends (seconds) */
  now = 0;

  constructor(ctx: AudioContext, source: AudioNode) {
    this.rate = ctx.sampleRate;
    try {
      this.node = new AudioWorkletNode(ctx, 'deckhouse-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
    } catch (err) {
      console.warn('Capture tap unavailable; recording and the replay buffer are off:', err);
      return;
    }
    source.connect(this.node);
    // a silent path to the speakers keeps the node running in every browser
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(ctx.destination);
    this.node.port.onmessage = (e: MessageEvent<{ l: Float32Array; r: Float32Array; end: number }>) => this.chunk(e.data.l, e.data.r, e.data.end / this.rate);
  }

  get supported(): boolean {
    return !!this.node;
  }

  /** Set the replay buffer's length (0 turns it off). A new length starts it afresh. */
  setBuffer(seconds: number): void {
    if (seconds <= 0) {
      this.ring = null;
      return;
    }
    if (this.ring && Math.abs(this.ring.capacity / this.rate - seconds) < 1) return;
    try {
      this.ring = new PcmRing(seconds, this.rate);
    } catch {
      this.ring = null;
    }
  }

  /** start a recording: it gets every block from now until `stopTape` */
  startTape(): PcmTape {
    const t = new PcmTape(this.rate);
    this.tapes.add(t);
    return t;
  }

  stopTape(t: PcmTape): void {
    this.tapes.delete(t);
  }

  onChunk(fn: ChunkListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private chunk(l: Float32Array, r: Float32Array, endTime: number): void {
    this.now = endTime;
    try {
      this.ring?.push(l, r, endTime);
    } catch {
      // out of memory growing the buffer: turn it off rather than lose the set
      this.ring = null;
    }
    for (const t of this.tapes) t.push(l, r, endTime);
    for (const fn of this.listeners) fn(l, r, endTime);
  }
}
