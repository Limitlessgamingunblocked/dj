/** Synthesised sound: siren, engine, horn, monitor beeps and UI cues. No samples needed. */
export class AudioFx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sirenGain!: GainNode;
  private sirenLfo!: OscillatorNode;
  private sirenDepth!: GainNode;
  private sirenOsc!: OscillatorNode;
  private engineOsc!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private volume = 0.7;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 950;
    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.frequency.value = 0.28;
    this.sirenDepth = ctx.createGain();
    this.sirenDepth.gain.value = 420;
    this.sirenLfo.connect(this.sirenDepth).connect(this.sirenOsc.frequency);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    const sirenTone = ctx.createBiquadFilter();
    sirenTone.type = 'bandpass';
    sirenTone.frequency.value = 1100;
    sirenTone.Q.value = 0.6;
    this.sirenOsc.connect(sirenTone).connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
    this.sirenLfo.start();

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 45;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 380;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  siren(on: boolean, mode: 'wail' | 'yelp') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on ? 0.1 : 0, t, 0.08);
    this.sirenLfo.frequency.setTargetAtTime(mode === 'yelp' ? 3.2 : 0.28, t, 0.05);
    this.sirenDepth.gain.setTargetAtTime(mode === 'yelp' ? 380 : 440, t, 0.05);
  }

  engine(active: boolean, speed: number, throttle: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 40 + Math.abs(speed) * 2.2 + throttle * 18;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(260 + throttle * 500 + Math.abs(speed) * 8, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.05 + throttle * 0.04 : 0, t, 0.1);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, delay = 0, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  beep() {
    this.tone(1046, 0.09, 'sine', 0.06);
  }

  horn() {
    this.tone(392, 0.35, 'square', 0.05);
    this.tone(494, 0.35, 'square', 0.04);
  }

  distantHonk() {
    this.tone(330, 0.25, 'square', 0.025);
  }

  crash(strength: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.5, 0.08 + strength * 0.03), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.4);
  }

  click() {
    this.tone(1400, 0.04, 'square', 0.03);
  }

  success() {
    [523, 659, 784, 1046].forEach((f, k) => this.tone(f, 0.25, 'triangle', 0.12, k * 0.09));
  }

  good() {
    this.tone(880, 0.12, 'triangle', 0.1);
    this.tone(1320, 0.18, 'triangle', 0.08, 0.08);
  }

  bad() {
    this.tone(220, 0.3, 'sawtooth', 0.06, 0, 0.7);
  }

  fail() {
    [523, 440, 349, 262].forEach((f, k) => this.tone(f, 0.3, 'triangle', 0.1, k * 0.13));
  }

  shock() {
    if (!this.ctx) return;
    this.tone(120, 0.3, 'sawtooth', 0.12, 0, 3);
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.25);
  }

  charge(dur: number) {
    this.tone(400, dur, 'sine', 0.05, 0, 5);
  }
}
