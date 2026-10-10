/*
 * Beat FX unit with an assignment matrix (channels 1–4 and/or master).
 * Timing follows the BPM of the assigned deck (or the sync master). LFO based
 * effects are restarted on the beat so they stay in phase with the grid.
 *
 * Additive effects (echo, ping-pong, reverb) keep the dry signal at full level
 * and let tails ring out after the effect is switched off. Insert effects
 * (flanger, phaser, pitch shift, transformer) crossfade dry → processed.
 */
import { clamp } from '../../core/util';
import type { Channel } from '../Channel';
import type { Mixer } from '../Mixer';

export type FxType = 'echo' | 'pingpong' | 'reverb' | 'flanger' | 'phaser' | 'pitch' | 'gate';
export type FxTarget = 1 | 2 | 3 | 4 | 'M';

export const FX_TYPES: FxType[] = ['echo', 'pingpong', 'reverb', 'flanger', 'phaser', 'pitch', 'gate'];
export const FX_LABELS: Record<FxType, string> = {
  echo: 'ECHO',
  pingpong: 'PING PONG',
  reverb: 'REVERB',
  flanger: 'FLANGER',
  phaser: 'PHASER',
  pitch: 'PITCH',
  gate: 'TRANS',
};
export const FX_PARAM_LABELS: Record<FxType, string> = {
  echo: 'FEEDBACK',
  pingpong: 'FEEDBACK',
  reverb: 'SIZE',
  flanger: 'RESONANCE',
  phaser: 'RESONANCE',
  pitch: 'SEMITONES',
  gate: 'FLOOR',
};
export const FX_BEATS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16];
const INSERT: Record<FxType, boolean> = {
  echo: false,
  pingpong: false,
  reverb: false,
  flanger: true,
  phaser: true,
  pitch: true,
  gate: true,
};

interface FxChain {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
  lfos: OscillatorNode[];
  update(beatSec: number, param: number): void;
  restartLfo?(when: number, beatSec: number): void;
}

export interface BeatFxHost {
  /** seconds per beat for the current assignment (real time, includes tempo) */
  beatSeconds(targets: Set<FxTarget>): number;
  /** AudioContext time of the next beat for the assignment */
  nextBeatTime(targets: Set<FxTarget>): number;
}

export class BeatFX {
  readonly input: GainNode;
  readonly wet: GainNode;
  type: FxType = 'echo';
  on = false;
  depth = 0.5;
  beatIndex = 3; // 1/2
  params: Record<FxType, number> = { echo: 0.45, pingpong: 0.45, reverb: 0.5, flanger: 0.5, phaser: 0.5, pitch: 0.75, gate: 0 };
  targets = new Set<FxTarget>(['M']);

  private chain: FxChain | null = null;
  private lastBeatSec = 0;
  private reverbIr: AudioBuffer | null = null;
  private reverbIrSize = -1;

  constructor(
    private ctx: AudioContext,
    private channels: Channel[],
    private mixer: Mixer,
    private host: BeatFxHost,
    private wasm: ArrayBuffer | null,
  ) {
    this.input = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.wet.connect(mixer.masterSum);
    this.channels.forEach((ch) => ch.fxSend.connect(this.input));
    mixer.masterFxSend.connect(this.input);
    this.build();
  }

  get beats(): number {
    return FX_BEATS[this.beatIndex];
  }

  get param(): number {
    return this.params[this.type];
  }

  private ramp(p: AudioParam, v: number, t = 0.015): void {
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, t);
  }

  setType(t: FxType): void {
    if (t === this.type) return;
    this.type = t;
    this.build();
    this.applyRouting();
  }

  setOn(on: boolean): void {
    this.on = on;
    if (on) this.resync();
    this.applyRouting();
  }

  setDepth(v: number): void {
    this.depth = clamp(v, 0, 1);
    this.applyRouting();
  }

  setParam(v: number): void {
    this.params[this.type] = clamp(v, 0, 1);
    this.chain?.update(this.lastBeatSec || 0.5, this.param);
  }

  stepBeats(dir: 1 | -1): void {
    this.beatIndex = clamp(this.beatIndex + dir, 0, FX_BEATS.length - 1);
    this.resync();
  }

  toggleTarget(t: FxTarget): void {
    if (this.targets.has(t)) this.targets.delete(t);
    else this.targets.add(t);
    this.applyRouting();
    this.resync();
  }

  setSingleTarget(t: FxTarget): void {
    this.targets = new Set([t]);
    this.applyRouting();
    this.resync();
  }

  private applyRouting(): void {
    const insert = INSERT[this.type];
    const master = this.targets.has('M');
    const active = this.on;
    const dryLevel = active && insert ? 1 - this.depth : 1;
    this.channels.forEach((ch, i) => {
      const assigned = !master && this.targets.has((i + 1) as FxTarget);
      this.ramp(ch.fxSend.gain, active && assigned ? 1 : 0, 0.005);
      this.ramp(ch.dry.gain, assigned ? dryLevel : 1, 0.01);
    });
    this.ramp(this.mixer.masterFxSend.gain, active && master ? 1 : 0, 0.005);
    this.ramp(this.mixer.masterDry.gain, master ? dryLevel : 1, 0.01);
    // additive effects keep their return open so echoes decay naturally
    const wetLevel = insert ? (active ? this.depth : 0) : this.depth * 1.1;
    this.ramp(this.wet.gain, wetLevel, 0.01);
  }

  private resync(): void {
    const beatSec = this.host.beatSeconds(this.targets) * this.beats;
    this.lastBeatSec = beatSec;
    this.chain?.update(beatSec, this.param);
    if (this.chain?.restartLfo) this.chain.restartLfo(this.host.nextBeatTime(this.targets), beatSec);
  }

  /** Called every frame: follows tempo changes of the assigned deck. */
  update(): void {
    const beatSec = this.host.beatSeconds(this.targets) * this.beats;
    if (Math.abs(beatSec - this.lastBeatSec) / Math.max(1e-3, beatSec) > 0.004) {
      const lfoRestart = Math.abs(beatSec - this.lastBeatSec) / Math.max(1e-3, beatSec) > 0.02;
      this.lastBeatSec = beatSec;
      this.chain?.update(beatSec, this.param);
      if (lfoRestart && this.chain?.restartLfo) this.chain.restartLfo(this.host.nextBeatTime(this.targets), beatSec);
    }
  }

  private build(): void {
    if (this.chain) {
      const old = this.chain;
      // let an additive tail ring briefly before tearing down
      setTimeout(() => {
        old.lfos.forEach((o) => {
          try {
            o.stop();
          } catch {
            /* already stopped */
          }
        });
        old.nodes.forEach((n) => n.disconnect());
      }, 60);
      this.input.disconnect();
    }
    const c = this.ctx;
    this.chain = this.makeChain(this.type, c);
    this.input.connect(this.chain.input);
    this.chain.output.connect(this.wet);
    this.resync();
  }

  private makeChain(type: FxType, c: AudioContext): FxChain {
    switch (type) {
      case 'echo': {
        const inp = c.createGain();
        const delay = c.createDelay(8);
        const fb = c.createGain();
        const tone = c.createBiquadFilter();
        tone.type = 'highpass';
        tone.frequency.value = 120;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 9000;
        const out = c.createGain();
        inp.connect(delay);
        delay.connect(tone).connect(lp).connect(fb).connect(delay);
        lp.connect(out);
        return {
          input: inp,
          output: out,
          nodes: [inp, delay, fb, tone, lp, out],
          lfos: [],
          update: (beatSec, p) => {
            this.ramp(delay.delayTime, clamp(beatSec, 0.01, 7.9), 0.05);
            fb.gain.value = 0.25 + p * 0.65;
          },
        };
      }
      case 'pingpong': {
        const inp = c.createGain();
        const mono = c.createGain();
        mono.channelCount = 1;
        mono.channelCountMode = 'explicit';
        const dl = c.createDelay(8);
        const dr = c.createDelay(8);
        const fb = c.createGain();
        const merger = c.createChannelMerger(2);
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 150;
        const out = c.createGain();
        inp.connect(mono).connect(hp).connect(dl);
        dl.connect(merger, 0, 0);
        dl.connect(dr);
        dr.connect(merger, 0, 1);
        dr.connect(fb).connect(dl);
        merger.connect(out);
        return {
          input: inp,
          output: out,
          nodes: [inp, mono, dl, dr, fb, merger, hp, out],
          lfos: [],
          update: (beatSec, p) => {
            const t = clamp(beatSec, 0.01, 7.9);
            this.ramp(dl.delayTime, t, 0.05);
            this.ramp(dr.delayTime, t, 0.05);
            fb.gain.value = 0.2 + p * 0.65;
          },
        };
      }
      case 'reverb': {
        const inp = c.createGain();
        const pre = c.createDelay(1);
        const conv = c.createConvolver();
        const out = c.createGain();
        inp.connect(pre).connect(conv).connect(out);
        return {
          input: inp,
          output: out,
          nodes: [inp, pre, conv, out],
          lfos: [],
          update: (beatSec, p) => {
            this.ramp(pre.delayTime, clamp(beatSec / 16, 0.005, 0.2), 0.05);
            const size = Math.round(p * 10) / 10;
            if (!this.reverbIr || this.reverbIrSize !== size) {
              this.reverbIr = makeHallIr(c, 1.2 + size * 5);
              this.reverbIrSize = size;
            }
            if (conv.buffer !== this.reverbIr) conv.buffer = this.reverbIr;
          },
        };
      }
      case 'flanger': {
        const inp = c.createGain();
        const dry = c.createGain();
        dry.gain.value = 0.7;
        const delay = c.createDelay(0.05);
        delay.delayTime.value = 0.004;
        const fb = c.createGain();
        const wet = c.createGain();
        wet.gain.value = 0.7;
        const out = c.createGain();
        const lfoGain = c.createGain();
        lfoGain.gain.value = 0.0032;
        inp.connect(dry).connect(out);
        inp.connect(delay).connect(wet).connect(out);
        delay.connect(fb).connect(delay);
        const chain: FxChain = {
          input: inp,
          output: out,
          nodes: [inp, dry, delay, fb, wet, out, lfoGain],
          lfos: [],
          update: (_b, p) => {
            fb.gain.value = p * 0.88;
          },
          restartLfo: (when, beatSec) => {
            chain.lfos.forEach((o) => stopAt(o, when));
            const lfo = c.createOscillator();
            lfo.type = 'triangle';
            lfo.frequency.value = 1 / clamp(beatSec * 4, 0.05, 60);
            lfo.connect(lfoGain).connect(delay.delayTime);
            lfo.start(when);
            chain.lfos = [lfo];
          },
        };
        return chain;
      }
      case 'phaser': {
        const inp = c.createGain();
        const dry = c.createGain();
        dry.gain.value = 0.7;
        const out = c.createGain();
        const fb = c.createGain();
        const lfoGain = c.createGain();
        lfoGain.gain.value = 900;
        const stages: BiquadFilterNode[] = [];
        let prev: AudioNode = inp;
        const mixIn = c.createGain();
        inp.connect(mixIn);
        prev = mixIn;
        for (let i = 0; i < 6; i++) {
          const ap = c.createBiquadFilter();
          ap.type = 'allpass';
          ap.frequency.value = 1000;
          ap.Q.value = 0.6;
          prev.connect(ap);
          lfoGain.connect(ap.frequency);
          stages.push(ap);
          prev = ap;
        }
        const wet = c.createGain();
        wet.gain.value = 0.7;
        prev.connect(wet).connect(out);
        prev.connect(fb).connect(mixIn);
        inp.connect(dry).connect(out);
        const chain: FxChain = {
          input: inp,
          output: out,
          nodes: [inp, dry, out, fb, lfoGain, mixIn, wet, ...stages],
          lfos: [],
          update: (_b, p) => {
            fb.gain.value = p * 0.7;
          },
          restartLfo: (when, beatSec) => {
            chain.lfos.forEach((o) => stopAt(o, when));
            const lfo = c.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = 1 / clamp(beatSec * 4, 0.05, 60);
            lfo.connect(lfoGain);
            lfo.start(when);
            chain.lfos = [lfo];
          },
        };
        return chain;
      }
      case 'pitch': {
        const inp = c.createGain();
        const out = c.createGain();
        let node: AudioWorkletNode | null = null;
        try {
          node = new AudioWorkletNode(c, 'pitch-shift', {
            outputChannelCount: [2],
            processorOptions: { wasm: this.wasm ? this.wasm.slice(0) : null },
          });
          inp.connect(node).connect(out);
        } catch {
          inp.connect(out);
        }
        return {
          input: inp,
          output: out,
          nodes: node ? [inp, node, out] : [inp, out],
          lfos: [],
          update: (_b, p) => {
            const semis = Math.round((p - 0.5) * 24);
            const r = node?.parameters.get('ratio');
            if (r) r.value = Math.pow(2, semis / 12);
          },
        };
      }
      case 'gate': {
        const inp = c.createGain();
        const vca = c.createGain();
        vca.gain.value = 0;
        const lfoGain = c.createGain();
        const floor = c.createConstantSource();
        floor.start();
        const out = c.createGain();
        inp.connect(vca).connect(out);
        floor.connect(vca.gain);
        lfoGain.connect(vca.gain);
        let floorLevel = 0;
        const chain: FxChain = {
          input: inp,
          output: out,
          nodes: [inp, vca, lfoGain, floor, out],
          lfos: [],
          update: (_b, p) => {
            floorLevel = p * 0.6;
            floor.offset.value = 0.5 + floorLevel / 2;
            lfoGain.gain.value = 0.5 - floorLevel / 2;
          },
          restartLfo: (when, beatSec) => {
            chain.lfos.forEach((o) => stopAt(o, when));
            const lfo = c.createOscillator();
            // band-limited square with a softened edge
            const real = new Float32Array(16);
            const imag = new Float32Array(16);
            for (let k = 1; k < 16; k += 2) imag[k] = (4 / (Math.PI * k)) * Math.exp(-k / 12);
            lfo.setPeriodicWave(c.createPeriodicWave(real, imag));
            lfo.frequency.value = 1 / clamp(beatSec, 0.02, 30);
            lfo.connect(lfoGain);
            lfo.start(when);
            chain.lfos = [lfo];
          },
        };
        return chain;
      }
    }
  }
}

function stopAt(o: OscillatorNode, when: number): void {
  try {
    o.stop(when);
  } catch {
    /* ignore */
  }
}

/** Synthetic hall impulse response: early reflections + damped stereo tail. */
export function makeHallIr(c: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = c.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    let seed = 1234 + ch * 777;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2147483648 - 1;
    };
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const decay = Math.pow(0.001, t / seconds);
      const damp = 0.15 + 0.8 * Math.min(1, t / seconds); // darker as it decays
      lp = lp + (rnd() - lp) * (1 - damp);
      d[i] = lp * decay * (t < 0.012 ? t / 0.012 : 1);
    }
    for (let e = 0; e < 14; e++) {
      const at = Math.floor(sr * (0.008 + e * 0.011 + (ch ? 0.003 : 0)));
      if (at < len) d[at] += (0.5 / (1 + e)) * (e % 2 ? -1 : 1);
    }
  }
  return buf;
}
