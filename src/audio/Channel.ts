/*
 * Mixer channel strip:
 *   trim → 3-band isolator (Linkwitz-Riley 24 dB/oct crossovers, +6 dB to full kill)
 *   → colour FX (resonant LPF/HPF sweep + bitcrusher) → [pre-fader: cue send, meters]
 *   → channel fader (selectable curve) → crossfader gain → dry out / beat FX send
 */
import { clamp, dbToGain } from '../core/util';

export type XfAssign = 'A' | 'THRU' | 'B';
export type FaderCurve = 'log' | 'linear' | 'fast';

const LOW_X = 250;
const HIGH_X = 2600;
const Q_BUTTER = Math.SQRT1_2;

export function eqKnobToGain(v: number): number {
  if (v >= 0.5) return dbToGain((v - 0.5) * 2 * 6);
  if (v <= 0.01) return 0; // total kill
  const t = v / 0.5;
  return dbToGain(-42 * Math.pow(1 - t, 1.4));
}

export function trimKnobToGain(v: number): number {
  if (v <= 0.005) return 0;
  const db = v < 0.5 ? -26 * (1 - v / 0.5) : 12 * ((v - 0.5) / 0.5);
  return dbToGain(db);
}

export function gainToTrimKnob(gain: number): number {
  const db = 20 * Math.log10(Math.max(1e-4, gain));
  if (db >= 0) return clamp(0.5 + (db / 12) * 0.5, 0.5, 1);
  return clamp(0.5 * (1 + db / 26), 0.01, 0.5);
}

export function faderToGain(v: number, curve: FaderCurve): number {
  if (v <= 0.002) return 0;
  switch (curve) {
    case 'linear':
      return v;
    case 'fast':
      return Math.min(1, Math.sqrt(v * 1.6));
    default:
      return dbToGain(-50 * Math.pow(1 - v, 1.55)); // logarithmic taper
  }
}

export interface ChannelState {
  trim: number;
  hi: number;
  mid: number;
  low: number;
  filter: number;
  res: number;
  crush: number;
  fader: number;
  cue: boolean;
  assign: XfAssign;
}

export class Channel {
  readonly input: GainNode;
  readonly pre: GainNode;
  readonly out: GainNode; // post fader + crossfader
  readonly dry: GainNode; // → master bus (dry level controlled by beat FX)
  readonly fxSend: GainNode; // → beat FX input
  readonly cueSend: GainNode; // → headphone cue bus
  readonly analyserL: AnalyserNode;
  readonly analyserR: AnalyserNode;

  private lowGain: GainNode;
  private midGain: GainNode;
  private highGain: GainNode;
  private lpf: BiquadFilterNode;
  private hpf: BiquadFilterNode;
  private crusher: AudioWorkletNode | null = null;
  private fader: GainNode;
  private xf: GainNode;
  private meterBuf: Float32Array<ArrayBuffer>;
  private peaks = [0, 0];
  xfGain = 1;
  faderCurve: FaderCurve = 'log';

  readonly state: ChannelState = {
    trim: 0.5,
    hi: 0.5,
    mid: 0.5,
    low: 0.5,
    filter: 0.5,
    res: 0.25,
    crush: 0,
    fader: 0.8,
    cue: false,
    assign: 'THRU',
  };

  constructor(
    private ctx: AudioContext,
    readonly index: number,
  ) {
    const c = ctx;
    this.input = c.createGain();

    // --- isolator: split into three bands with LR4 crossovers and sum ---
    const lr4 = (type: BiquadFilterType, f: number): [BiquadFilterNode, BiquadFilterNode] => {
      const a = c.createBiquadFilter();
      const b = c.createBiquadFilter();
      a.type = b.type = type;
      a.frequency.value = b.frequency.value = f;
      a.Q.value = b.Q.value = Q_BUTTER;
      a.connect(b);
      return [a, b];
    };
    const sum = c.createGain();
    const [l1, l2] = lr4('lowpass', LOW_X);
    const lowAp = c.createBiquadFilter(); // match phase of the upper crossover
    lowAp.type = 'allpass';
    lowAp.frequency.value = HIGH_X;
    lowAp.Q.value = Q_BUTTER;
    const [m1, m2] = lr4('highpass', LOW_X);
    const [m3, m4] = lr4('lowpass', HIGH_X);
    const [h1, h2] = lr4('highpass', HIGH_X);
    const [h3, h4] = lr4('highpass', LOW_X);
    this.lowGain = c.createGain();
    this.midGain = c.createGain();
    this.highGain = c.createGain();
    this.input.connect(l1);
    l2.connect(lowAp).connect(this.lowGain).connect(sum);
    this.input.connect(m1);
    m2.connect(m3);
    m4.connect(this.midGain).connect(sum);
    this.input.connect(h3);
    h4.connect(h1);
    h2.connect(this.highGain).connect(sum);

    // --- colour FX ---
    this.lpf = c.createBiquadFilter();
    this.lpf.type = 'lowpass';
    this.lpf.frequency.value = 22000;
    this.hpf = c.createBiquadFilter();
    this.hpf.type = 'highpass';
    this.hpf.frequency.value = 10;
    sum.connect(this.hpf).connect(this.lpf);

    this.pre = c.createGain();
    try {
      this.crusher = new AudioWorkletNode(c, 'bitcrusher', { outputChannelCount: [2] });
      this.lpf.connect(this.crusher).connect(this.pre);
    } catch {
      this.lpf.connect(this.pre);
    }

    // --- meters (pre-fader) ---
    const split = c.createChannelSplitter(2);
    this.analyserL = c.createAnalyser();
    this.analyserR = c.createAnalyser();
    this.analyserL.fftSize = this.analyserR.fftSize = 1024;
    this.pre.connect(split);
    split.connect(this.analyserL, 0);
    split.connect(this.analyserR, 1);
    this.meterBuf = new Float32Array(1024);

    this.cueSend = c.createGain();
    this.cueSend.gain.value = 0;
    this.pre.connect(this.cueSend);

    this.fader = c.createGain();
    this.xf = c.createGain();
    this.out = c.createGain();
    this.pre.connect(this.fader).connect(this.xf).connect(this.out);
    this.dry = c.createGain();
    this.fxSend = c.createGain();
    this.fxSend.gain.value = 0;
    this.out.connect(this.dry);
    this.out.connect(this.fxSend);

    this.applyAll();
  }

  private ramp(p: AudioParam, v: number, t = 0.012): void {
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, t);
  }

  applyAll(): void {
    this.setTrim(this.state.trim);
    this.setEq('hi', this.state.hi);
    this.setEq('mid', this.state.mid);
    this.setEq('low', this.state.low);
    this.setFilter(this.state.filter);
    this.setCrush(this.state.crush);
    this.setFader(this.state.fader);
    this.setCue(this.state.cue);
  }

  setTrim(v: number): void {
    this.state.trim = clamp(v, 0, 1);
    this.ramp(this.input.gain, trimKnobToGain(this.state.trim));
  }

  setEq(band: 'hi' | 'mid' | 'low', v: number): void {
    v = clamp(v, 0, 1);
    if (Math.abs(v - 0.5) < 0.012) v = 0.5;
    this.state[band] = v;
    const node = band === 'hi' ? this.highGain : band === 'mid' ? this.midGain : this.lowGain;
    this.ramp(node.gain, eqKnobToGain(v), 0.008);
  }

  setFilter(v: number): void {
    v = clamp(v, 0, 1);
    if (Math.abs(v - 0.5) < 0.025) v = 0.5;
    this.state.filter = v;
    const q = 0.7 + Math.pow(this.state.res, 1.6) * 14;
    if (v < 0.5) {
      const t = (0.5 - v) / 0.5;
      this.ramp(this.lpf.frequency, 20000 * Math.pow(45 / 20000, Math.pow(t, 0.8)), 0.02);
      this.ramp(this.lpf.Q, q);
      this.ramp(this.hpf.frequency, 10);
      this.ramp(this.hpf.Q, Q_BUTTER);
    } else if (v > 0.5) {
      const t = (v - 0.5) / 0.5;
      this.ramp(this.hpf.frequency, 20 * Math.pow(9000 / 20, Math.pow(t, 0.9)), 0.02);
      this.ramp(this.hpf.Q, q);
      this.ramp(this.lpf.frequency, 22000);
      this.ramp(this.lpf.Q, Q_BUTTER);
    } else {
      this.ramp(this.lpf.frequency, 22000);
      this.ramp(this.hpf.frequency, 10);
      this.ramp(this.lpf.Q, Q_BUTTER);
      this.ramp(this.hpf.Q, Q_BUTTER);
    }
  }

  setRes(v: number): void {
    this.state.res = clamp(v, 0, 1);
    this.setFilter(this.state.filter);
  }

  setCrush(v: number): void {
    this.state.crush = clamp(v, 0, 1);
    const p = this.crusher?.parameters.get('amount');
    if (p) this.ramp(p, this.state.crush, 0.01);
  }

  setFader(v: number): void {
    this.state.fader = clamp(v, 0, 1);
    this.ramp(this.fader.gain, faderToGain(this.state.fader, this.faderCurve), 0.006);
  }

  setCue(on: boolean): void {
    this.state.cue = on;
    this.ramp(this.cueSend.gain, on ? 1 : 0);
  }

  setXfGain(g: number): void {
    if (Math.abs(g - this.xfGain) < 1e-4) return;
    this.xfGain = g;
    this.ramp(this.xf.gain, g, 0.005);
  }

  /** Peak levels (linear) for the L/R meters. Call once per frame. */
  levels(): [number, number] {
    const buf = this.meterBuf;
    const an = [this.analyserL, this.analyserR];
    for (let ch = 0; ch < 2; ch++) {
      an[ch].getFloatTimeDomainData(buf);
      let m = 0;
      for (let i = 0; i < buf.length; i += 2) {
        const a = Math.abs(buf[i]);
        if (a > m) m = a;
      }
      this.peaks[ch] = m;
    }
    return [this.peaks[0], this.peaks[1]];
  }
}
