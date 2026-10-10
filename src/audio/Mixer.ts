/*
 * Mixer bus: crossfader (adjustable curve from smooth constant-power to
 * scratch cut, optional hamster reverse), master level + brickwall limiter,
 * master meters, and the headphone cue bus.
 *
 * Headphone monitoring works in two ways:
 *   - split mode: master (mono) on the left channel, cue mix (mono) on the right,
 *     for a single output with a splitter cable
 *   - a second output device (setSinkId) where the browser supports it
 *   - a DJ controller's own sound card: the whole mix goes to it (setSinkId on
 *     the context), master on outputs 1/2 and the cue mix on 3/4, which is
 *     where those cards put their headphone jack
 */
import { Room } from './room';
import { clamp, dbToGain } from '../core/util';
import type { Channel } from './Channel';

export function xfaderGains(x: number, curve: number, hamster: boolean): [number, number] {
  if (hamster) x = 1 - x;
  const w = 1 - clamp(curve, 0, 1) * 0.965; // width of the fade region
  const f = (u: number) => Math.sin((Math.min(1, Math.max(0, u) / w) * Math.PI) / 2);
  return [f(1 - x), f(x)];
}

export class Mixer {
  readonly masterBus: GainNode; // channel dry signals
  readonly masterDry: GainNode;
  readonly masterFxSend: GainNode;
  readonly masterSum: GainNode; // dry + beat FX return
  readonly masterGain: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly masterOut: GainNode;
  /** the venue's acoustics, on the speakers only (the recorder taps masterOut, before it) */
  readonly room: Room;
  readonly cueBus: GainNode;
  readonly analyserL: AnalyserNode;
  readonly analyserR: AnalyserNode;
  readonly phonesOut: GainNode;

  private normalOut: GainNode;
  private splitOut: GainNode;
  private cueInPhones: GainNode;
  private masterInPhones: GainNode;
  private phonesDevice: MediaStreamAudioDestinationNode | null = null;
  private phonesEl: HTMLAudioElement | null = null;
  private quad: { gain: GainNode } | null = null;
  private meterBuf = new Float32Array(1024);

  xfader = 0.5;
  xcurve = 0.35;
  hamster = false;
  master = 0.8;
  cueMix = 0.3;
  phones = 0.8;
  split = false;
  /** the cue mix on outputs 3/4 of a four-output sound card */
  quadPhones = false;

  constructor(
    private ctx: AudioContext,
    private channels: Channel[],
  ) {
    const c = ctx;
    this.masterBus = c.createGain();
    this.masterDry = c.createGain();
    this.masterFxSend = c.createGain();
    this.masterFxSend.gain.value = 0;
    this.masterSum = c.createGain();
    this.masterGain = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.masterOut = c.createGain();

    this.masterBus.connect(this.masterDry).connect(this.masterSum);
    this.masterBus.connect(this.masterFxSend);
    this.masterSum.connect(this.masterGain).connect(this.limiter).connect(this.masterOut);

    const split = c.createChannelSplitter(2);
    this.analyserL = c.createAnalyser();
    this.analyserR = c.createAnalyser();
    this.analyserL.fftSize = this.analyserR.fftSize = 1024;
    this.masterOut.connect(split);
    split.connect(this.analyserL, 0);
    split.connect(this.analyserR, 1);

    // --- normal stereo output ---
    this.normalOut = c.createGain();
    this.room = new Room(c, c.destination);
    this.masterOut.connect(this.normalOut).connect(this.room.input);

    // --- headphones ---
    this.cueBus = c.createGain();
    this.cueInPhones = c.createGain();
    this.masterInPhones = c.createGain();
    this.phonesOut = c.createGain();
    this.cueBus.connect(this.cueInPhones).connect(this.phonesOut);
    this.masterOut.connect(this.masterInPhones).connect(this.phonesOut);

    // --- split output: L = master mono, R = cue mono ---
    const monoMaster = c.createGain();
    monoMaster.channelCount = 1;
    monoMaster.channelCountMode = 'explicit';
    monoMaster.channelInterpretation = 'speakers';
    const monoPhones = c.createGain();
    monoPhones.channelCount = 1;
    monoPhones.channelCountMode = 'explicit';
    monoPhones.channelInterpretation = 'speakers';
    const merger = c.createChannelMerger(2);
    this.splitOut = c.createGain();
    this.splitOut.gain.value = 0;
    this.masterOut.connect(monoMaster).connect(merger, 0, 0);
    this.phonesOut.connect(monoPhones).connect(merger, 0, 1);
    merger.connect(this.splitOut).connect(c.destination);

    for (const ch of channels) {
      ch.dry.connect(this.masterBus);
      ch.cueSend.connect(this.cueBus);
    }
    this.apply();
  }

  private ramp(p: AudioParam, v: number, t = 0.01): void {
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, t);
  }

  apply(): void {
    this.setMaster(this.master);
    this.setCueMix(this.cueMix);
    this.setPhones(this.phones);
    this.setSplit(this.split);
    this.updateCrossfader();
  }

  setMaster(v: number): void {
    this.master = clamp(v, 0, 1);
    // 0.8 on the knob = unity, top = +4 dB
    const g = this.master <= 0.002 ? 0 : this.master < 0.8 ? dbToGain(-48 * Math.pow(1 - this.master / 0.8, 1.5)) : dbToGain(((this.master - 0.8) / 0.2) * 4);
    this.ramp(this.masterGain.gain, g);
  }

  setCueMix(v: number): void {
    this.cueMix = clamp(v, 0, 1);
    this.ramp(this.cueInPhones.gain, Math.cos((this.cueMix * Math.PI) / 2));
    this.ramp(this.masterInPhones.gain, Math.sin((this.cueMix * Math.PI) / 2));
  }

  setPhones(v: number): void {
    this.phones = clamp(v, 0, 1);
    this.ramp(this.phonesOut.gain, this.phones * this.phones * 1.4);
  }

  setSplit(on: boolean): void {
    this.split = on;
    this.ramp(this.normalOut.gain, on ? 0 : 1);
    this.ramp(this.splitOut.gain, on ? 1 : 0);
  }

  setCrossfader(v: number): void {
    this.xfader = clamp(v, 0, 1);
    this.updateCrossfader();
  }

  setCurve(v: number): void {
    this.xcurve = clamp(v, 0, 1);
    this.updateCrossfader();
  }

  updateCrossfader(): void {
    const [a, b] = xfaderGains(this.xfader, this.xcurve, this.hamster);
    for (const ch of this.channels) {
      const g = ch.state.assign === 'A' ? a : ch.state.assign === 'B' ? b : 1;
      ch.setXfGain(g);
    }
  }

  /** how hard the limiter is pulling the master down right now, in dB (0 = not at all) */
  limiterReduction(): number {
    const r = this.limiter.reduction;
    return Number.isFinite(r) ? Math.max(0, -r) : 0;
  }

  masterLevels(): [number, number] {
    const out: [number, number] = [0, 0];
    [this.analyserL, this.analyserR].forEach((an, i) => {
      an.getFloatTimeDomainData(this.meterBuf);
      let m = 0;
      for (let j = 0; j < this.meterBuf.length; j += 2) m = Math.max(m, Math.abs(this.meterBuf[j]));
      out[i] = m;
    });
    return out;
  }

  /**
   * Send everything to this output device ('' = the system default; Chrome and
   * Edge 110+). Resolves how many outputs it has, or null when it can't be used.
   */
  async setOutputDevice(deviceId: string): Promise<number | null> {
    const ctx = this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof ctx.setSinkId !== 'function') return null;
    try {
      await ctx.setSinkId(deviceId);
    } catch {
      return null;
    }
    const n = this.ctx.destination.maxChannelCount;
    if (this.quadPhones && n < 4) this.setQuadPhones(false);
    return n;
  }

  /** how many outputs the current output device has */
  get outputChannels(): number {
    return this.ctx.destination.maxChannelCount;
  }

  /** master on outputs 1/2, the headphone cue mix on 3/4 (a controller's headphone jack); false if the output has fewer than four */
  setQuadPhones(on: boolean): boolean {
    const dest = this.ctx.destination;
    if (on && dest.maxChannelCount < 4) return false;
    if (on && !this.quad) {
      const split = this.ctx.createChannelSplitter(2);
      const merge = this.ctx.createChannelMerger(4);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      this.phonesOut.connect(split);
      split.connect(merge, 0, 2);
      split.connect(merge, 1, 3);
      merge.connect(gain).connect(dest);
      this.quad = { gain };
    }
    try {
      // 'discrete': the stereo mix fills outputs 1/2 and leaves 3/4 to the cue
      dest.channelCount = on ? 4 : 2;
      dest.channelInterpretation = on ? 'discrete' : 'speakers';
    } catch {
      return false;
    }
    if (this.quad) this.ramp(this.quad.gain.gain, on ? 1 : 0);
    this.quadPhones = on;
    return true;
  }

  /** Route the headphone mix to a separate output device (Chrome/Edge). */
  async setPhonesDevice(deviceId: string | null): Promise<boolean> {
    if (!deviceId) {
      this.phonesEl?.pause();
      return true;
    }
    if (!this.phonesDevice) {
      this.phonesDevice = this.ctx.createMediaStreamDestination();
      this.phonesOut.connect(this.phonesDevice);
      this.phonesEl = new Audio();
      this.phonesEl.srcObject = this.phonesDevice.stream;
    }
    const el = this.phonesEl as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (!el.setSinkId) return false;
    try {
      await el.setSinkId(deviceId);
      await el.play();
      return true;
    } catch {
      return false;
    }
  }
}
