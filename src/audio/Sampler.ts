/* Sample bank: 8 slots with one-shot or loop mode, per-slot volume and
 * user-loadable audio. Loop slots start on the next beat of the sync master. */
import type { PcmData } from '../core/types';
import { clamp } from '../core/util';

export interface SampleSlot {
  name: string;
  color: string;
  buffer: AudioBuffer | null;
  mode: 'oneshot' | 'loop';
  gain: number;
  custom: boolean;
}

const SLOT_COLORS = ['#ff3b5c', '#ff9f1c', '#ffd23f', '#3ddc97', '#2ec4f1', '#4f6bff', '#b36bff', '#ff5fcf'];

export class Sampler {
  readonly out: GainNode;
  readonly slots: SampleSlot[];
  private voices: (AudioBufferSourceNode | null)[] = new Array(8).fill(null);
  private voiceGains: (GainNode | null)[] = new Array(8).fill(null);
  volume = 0.8;

  constructor(
    private ctx: AudioContext,
    private nextBeat: () => number,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.slots = SLOT_COLORS.map((color, i) => ({ name: `Slot ${i + 1}`, color, buffer: null, mode: 'oneshot', gain: 0.8, custom: false }));
  }

  setBuffer(i: number, pcm: PcmData, name: string, custom: boolean): void {
    const ch = pcm.channels;
    const buf = this.ctx.createBuffer(ch.length, ch[0].length, pcm.sampleRate);
    ch.forEach((d, k) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, k));
    const s = this.slots[i];
    s.buffer = buf;
    s.name = name;
    s.custom = custom;
  }

  private extras = new Map<string, AudioBuffer>();

  /** a one-shot outside the 8 slots (the air horn pad), played into the mix like the slots */
  setExtra(name: string, pcm: PcmData): void {
    const ch = pcm.channels;
    const buf = this.ctx.createBuffer(ch.length, ch[0].length, pcm.sampleRate);
    ch.forEach((d, k) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, k));
    this.extras.set(name, buf);
  }

  playExtra(name: string, gain = 0.8): boolean {
    const buf = this.extras.get(name);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.out);
    src.start();
    return true;
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    this.out.gain.setTargetAtTime(this.volume * this.volume * 1.2, this.ctx.currentTime, 0.01);
  }

  isPlaying(i: number): boolean {
    return !!this.voices[i];
  }

  trigger(i: number): void {
    const s = this.slots[i];
    if (!s.buffer) return;
    if (s.mode === 'loop' && this.voices[i]) {
      this.stop(i);
      return;
    }
    this.stop(i, 0.004);
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    const g = this.ctx.createGain();
    g.gain.value = s.gain;
    src.connect(g).connect(this.out);
    src.loop = s.mode === 'loop';
    const when = s.mode === 'loop' ? Math.max(this.ctx.currentTime, this.nextBeat()) : this.ctx.currentTime;
    src.start(when);
    src.onended = () => {
      if (this.voices[i] === src) {
        this.voices[i] = null;
        this.voiceGains[i] = null;
      }
    };
    this.voices[i] = src;
    this.voiceGains[i] = g;
  }

  stop(i: number, fade = 0.03): void {
    const v = this.voices[i];
    const g = this.voiceGains[i];
    if (!v || !g) return;
    const now = this.ctx.currentTime;
    g.gain.setTargetAtTime(0, now, fade / 3);
    try {
      v.stop(now + fade);
    } catch {
      /* already stopped */
    }
    this.voices[i] = null;
    this.voiceGains[i] = null;
  }

  setSlotGain(i: number, v: number): void {
    this.slots[i].gain = clamp(v, 0, 1);
    const g = this.voiceGains[i];
    if (g) g.gain.setTargetAtTime(this.slots[i].gain, this.ctx.currentTime, 0.01);
  }
}
