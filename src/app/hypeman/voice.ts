/*
 * The MC's voice in the mix: a microphone (yours, or a friend's arriving
 * online) through a vocal chain, into the master after the music, so it's on
 * the speakers and in your recordings; and the music ducking under it while
 * they talk.
 *
 *   mic → high-pass → compressor → presence → [radio] → [echo] → level → masterGain
 *   decks + FX → masterSum → duck → masterGain → limiter → out
 *
 * The duck is put in between masterSum and masterGain while the mic is on and
 * taken out again after, so the mixer itself is unchanged. A remote MC hears
 * the music off the duck (tapMusic), without their own voice.
 */
import type { Mixer } from '../../audio/Mixer';

/** the voice is on above this level (dBFS), off again below OFF_DB, held for HOLD seconds */
const ON_DB = -42;
const OFF_DB = -50;
const HOLD = 0.28;

export interface VoiceFx {
  /** beat-synced echo on the voice */
  echo: boolean;
  /** a telephone / megaphone band */
  radio: boolean;
}

export class MicVoice {
  /** 0..1 the voice's level for the meter */
  level = 0;
  /** the voice is on */
  talking = false;
  /** how far the music ducks while they talk, in dB (0 = off) */
  duckDb = 9;
  /** the voice's level, 0..1.5 */
  gain = 1;
  /** sensitivity: shifts the on threshold, −10..+10 dB */
  sensitivity = 0;
  readonly fx: VoiceFx = { echo: false, radio: false };

  private src: MediaStreamAudioSourceNode | null = null;
  /** a remote stream has to play somewhere for Chrome to feed it to Web Audio */
  private sink: HTMLAudioElement | null = null;
  private hp: BiquadFilterNode;
  private comp: DynamicsCompressorNode;
  private presence: BiquadFilterNode;
  private radioHp: BiquadFilterNode;
  private radioLp: BiquadFilterNode;
  private radioWet: GainNode;
  private dry: GainNode;
  private echoDelay: DelayNode;
  private echoFb: GainNode;
  private echoWet: GainNode;
  private out: GainNode;
  private analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;
  private duck: GainNode;
  private inserted = false;
  private quietFor = 0;

  constructor(
    private ctx: AudioContext,
    private mixer: Mixer,
  ) {
    const c = ctx;
    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.frequency.value = 110;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -24;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.15;
    this.presence = c.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = 3200;
    this.presence.Q.value = 0.9;
    this.presence.gain.value = 4;
    // radio: a narrow band, swapped in for the full voice
    this.radioHp = c.createBiquadFilter();
    this.radioHp.type = 'highpass';
    this.radioHp.frequency.value = 600;
    this.radioLp = c.createBiquadFilter();
    this.radioLp.type = 'lowpass';
    this.radioLp.frequency.value = 3000;
    this.radioWet = c.createGain();
    this.radioWet.gain.value = 0;
    this.dry = c.createGain();
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.echoDelay = c.createDelay(2);
    this.echoFb = c.createGain();
    this.echoFb.gain.value = 0.42;
    this.echoWet = c.createGain();
    this.echoWet.gain.value = 0;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.duck = c.createGain();

    this.hp.connect(this.analyser);
    this.hp.connect(this.comp).connect(this.presence);
    this.presence.connect(this.dry).connect(this.out);
    this.presence.connect(this.radioHp).connect(this.radioLp).connect(this.radioWet).connect(this.out);
    this.out.connect(this.echoDelay);
    this.echoDelay.connect(this.echoFb).connect(this.echoDelay);
    this.echoDelay.connect(this.echoWet);
    this.out.connect(mixer.masterGain);
    this.echoWet.connect(mixer.masterGain);
  }

  get live(): boolean {
    return !!this.src;
  }

  /** plug a voice in (replaces the last one); `remote` streams play through a muted element too */
  attach(stream: MediaStream, remote = false): void {
    this.detachSource();
    if (remote) {
      const a = new Audio();
      a.muted = true;
      a.srcObject = stream;
      void a.play().catch(() => undefined);
      this.sink = a;
    }
    this.src = this.ctx.createMediaStreamSource(stream);
    this.src.connect(this.hp);
    this.insertDuck();
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(this.gain, now, 0.05);
  }

  private detachSource(): void {
    this.src?.disconnect();
    this.src = null;
    if (this.sink) {
      this.sink.srcObject = null;
      this.sink = null;
    }
  }

  /** unplug the voice (the duck stays in until release) */
  detach(): void {
    this.detachSource();
    const now = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, now, 0.05);
    this.talking = false;
    this.level = 0;
  }

  /** unplug the voice and put the music back as it was */
  release(): void {
    this.detach();
    this.removeDuck();
  }

  /**
   * The music without the voice (ducked under it), for a remote MC's
   * headphones: their own voice coming back late off the network would throw them.
   */
  tapMusic(dest: AudioNode): void {
    this.insertDuck();
    this.duck.connect(dest);
  }

  private insertDuck(): void {
    if (this.inserted) return;
    const m = this.mixer;
    m.masterSum.disconnect(m.masterGain);
    m.masterSum.connect(this.duck).connect(m.masterGain);
    this.inserted = true;
  }

  private removeDuck(): void {
    if (!this.inserted) return;
    const m = this.mixer;
    m.masterSum.disconnect(this.duck);
    // off the master and any remote MC's tap
    this.duck.disconnect();
    m.masterSum.connect(m.masterGain);
    this.duck.gain.value = 1;
    this.inserted = false;
  }

  /** every frame: the level, whether they're talking, the duck, the effects */
  update(dt: number, bpm: number): void {
    if (!this.src) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const db = 10 * Math.log10(sum / this.buf.length + 1e-12);
    this.level += (Math.max(0, Math.min(1, (db + 60) / 50)) - this.level) * Math.min(1, dt * 18);
    const on = ON_DB - this.sensitivity;
    const off = OFF_DB - this.sensitivity;
    if (db > on) {
      this.talking = true;
      this.quietFor = 0;
    } else if (this.talking && db < off) {
      this.quietFor += dt;
      if (this.quietFor > HOLD) this.talking = false;
    }
    const now = this.ctx.currentTime;
    const duckTo = this.talking && this.duckDb > 0 ? Math.pow(10, -this.duckDb / 20) : 1;
    // in fast (40 ms), out slow (400 ms), like a broadcast ducker
    this.duck.gain.setTargetAtTime(duckTo, now, duckTo < this.duck.gain.value ? 0.04 : 0.4);
    this.out.gain.setTargetAtTime(this.gain, now, 0.05);
    this.radioWet.gain.setTargetAtTime(this.fx.radio ? 1.6 : 0, now, 0.03);
    this.dry.gain.setTargetAtTime(this.fx.radio ? 0 : 1, now, 0.03);
    // a dotted eighth, the classic MC throw
    const beat = 60 / (bpm > 0 ? bpm : 124);
    this.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, beat * 0.75), now, 0.05);
    this.echoWet.gain.setTargetAtTime(this.fx.echo ? 0.55 : 0, now, 0.05);
  }
}
