/*
 * Real-time audio features for the visual player, from the master output
 * AnalyserNode FFT:
 *   bands  sub (20–60 Hz), kick (60–150), snare (180–450 + 2–5 kHz),
 *          vocal (300 Hz–3 kHz), highs (6–16 kHz)
 *   onsets adaptive-threshold kick / snare hits
 *   beat   phase locked to the sync master's beat grid (falls back to kicks)
 *   drop   low end returning hard after a breakdown
 */
import type { AudioEngine } from '../audio/AudioEngine';

export interface Features {
  spectrum: Float32Array; // 256 log-spaced bins, 0..1
  waveform: Float32Array; // 512 samples, -1..1
  sub: number;
  kick: number;
  snare: number;
  vocal: number;
  high: number;
  level: number;
  kickHit: boolean;
  snareHit: boolean;
  kickPulse: number;
  snarePulse: number;
  beatPulse: number;
  beatPhase: number;
  beatInBar: number;
  bpm: number;
  drop: number;
  dropHit: boolean;
  energy: number;
  hue: number;
  time: number;
  playing: boolean;
  /** user intensity 0..1.5: how hard visuals react */
  intensity: number;
  /** 1 when camera shake is enabled */
  shake: number;
}

interface Band {
  lo: number;
  hi: number;
  val: number;
  max: number;
  prev: number;
  mean: number;
  varc: number;
  lastHit: number;
}

export class AudioFeatures {
  readonly f: Features;
  private freq: Float32Array<ArrayBuffer>;
  private time: Float32Array<ArrayBuffer>;
  private bands: Record<'sub' | 'kick' | 'snareLo' | 'snareHi' | 'vocal' | 'high', Band>;
  private binHz: number;
  private logMap: Int32Array;
  private levelMax = 0.05;
  private longLow = 0;
  private breakdownTime = 0;
  private lastDrop = -100;
  private lastBeatIdx = -1;
  private fallbackPhase = 0;
  private kickTimes: number[] = [];
  intensity = 1;

  constructor(
    private analyser: AnalyserNode,
    private engine: AudioEngine,
  ) {
    this.freq = new Float32Array(analyser.frequencyBinCount);
    this.time = new Float32Array(analyser.fftSize);
    this.binHz = analyser.context.sampleRate / analyser.fftSize;
    const band = (lo: number, hi: number): Band => ({ lo, hi, val: 0, max: 1e-4, prev: 0, mean: 0, varc: 0, lastHit: -10 });
    this.bands = {
      sub: band(20, 60),
      kick: band(60, 150),
      snareLo: band(180, 450),
      snareHi: band(2000, 5000),
      vocal: band(300, 3000),
      high: band(6000, 16000),
    };
    this.logMap = new Int32Array(257);
    const fMin = 30;
    const fMax = 16000;
    for (let i = 0; i <= 256; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / 256);
      this.logMap[i] = Math.min(this.freq.length - 1, Math.max(1, Math.round(f / this.binHz)));
    }
    this.f = {
      spectrum: new Float32Array(256),
      waveform: new Float32Array(512),
      sub: 0,
      kick: 0,
      snare: 0,
      vocal: 0,
      high: 0,
      level: 0,
      kickHit: false,
      snareHit: false,
      kickPulse: 0,
      snarePulse: 0,
      beatPulse: 0,
      beatPhase: 0,
      beatInBar: 0,
      bpm: 120,
      drop: 0,
      dropHit: false,
      energy: 0,
      hue: 0,
      time: 0,
      playing: false,
      intensity: 1,
      shake: 1,
    };
  }

  private bandEnergy(b: Band): number {
    const i0 = Math.max(1, Math.floor(b.lo / this.binHz));
    const i1 = Math.min(this.freq.length - 1, Math.ceil(b.hi / this.binHz));
    let s = 0;
    for (let i = i0; i <= i1; i++) s += Math.pow(10, this.freq[i] / 20);
    return s / Math.max(1, i1 - i0 + 1);
  }

  /** normalised band value with adaptive gain; returns flux for onset detection */
  private track(b: Band, dt: number): number {
    const e = this.bandEnergy(b);
    b.max = Math.max(e, b.max * Math.exp(-dt * 0.15), 1e-5);
    const v = Math.min(1, e / b.max);
    const flux = Math.max(0, v - b.prev);
    b.prev = v;
    b.val = v > b.val ? v : b.val + (v - b.val) * Math.min(1, dt * 10);
    return flux;
  }

  private onset(b: Band, flux: number, now: number, minGap: number, k: number): boolean {
    const a = 0.08;
    b.mean += (flux - b.mean) * a;
    b.varc += ((flux - b.mean) ** 2 - b.varc) * a;
    const thr = b.mean + k * Math.sqrt(b.varc) + 0.04;
    if (flux > thr && now - b.lastHit > minGap && b.val > 0.25) {
      b.lastHit = now;
      return true;
    }
    return false;
  }

  update(dt: number): Features {
    const f = this.f;
    const now = (f.time += dt);
    f.dropHit = false;
    f.intensity = this.intensity;
    this.analyser.getFloatFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.time);

    // log spectrum (0..1)
    for (let i = 0; i < 256; i++) {
      const a = this.logMap[i];
      const b = Math.max(a, this.logMap[i + 1]);
      let m = -140;
      for (let j = a; j <= b; j++) m = Math.max(m, this.freq[j]);
      const v = Math.max(0, Math.min(1, (m + 88) / 70));
      f.spectrum[i] = v > f.spectrum[i] ? v : f.spectrum[i] + (v - f.spectrum[i]) * Math.min(1, dt * 9);
    }
    // waveform: most recent 1024 samples, decimated by 2
    const off = this.time.length - 1024;
    let rms = 0;
    for (let i = 0; i < 512; i++) {
      const v = this.time[off + i * 2];
      f.waveform[i] = v;
      rms += v * v;
    }
    rms = Math.sqrt(rms / 512);
    this.levelMax = Math.max(rms, this.levelMax * Math.exp(-dt * 0.1), 0.02);
    const level = Math.min(1, rms / this.levelMax);
    f.level += (level - f.level) * Math.min(1, dt * 12);

    const B = this.bands;
    this.track(B.sub, dt);
    const kf = this.track(B.kick, dt);
    const s1 = this.track(B.snareLo, dt);
    const s2 = this.track(B.snareHi, dt);
    this.track(B.vocal, dt);
    this.track(B.high, dt);
    f.sub = B.sub.val;
    f.kick = B.kick.val;
    f.snare = (B.snareLo.val + B.snareHi.val) / 2;
    f.vocal = B.vocal.val;
    f.high = B.high.val;
    const silent = rms < 0.003;
    f.kickHit = !silent && this.onset(B.kick, kf, now, 0.22, 1.4);
    f.snareHit = !silent && this.onset(B.snareHi, (s1 + s2) / 2, now, 0.15, 1.6);
    f.kickPulse = f.kickHit ? 1 : f.kickPulse * Math.exp(-dt * 7);
    f.snarePulse = f.snareHit ? 1 : f.snarePulse * Math.exp(-dt * 9);
    if (f.kickHit) {
      this.kickTimes.push(now);
      this.kickTimes = this.kickTimes.filter((t) => now - t < 6);
    }

    // beat phase: from the sync master's grid when something is playing
    const m = this.engine.masterDeck;
    f.playing = this.engine.decks.some((d) => d.playing);
    if (m && m.playing && m.analysis) {
      f.bpm = m.bpm;
      const bp = m.beatPosition(m.displayPosition());
      f.beatPhase = ((bp % 1) + 1) % 1;
      const idx = Math.floor(bp);
      f.beatInBar = ((idx % 4) + 4) % 4;
      if (idx !== this.lastBeatIdx) {
        this.lastBeatIdx = idx;
        f.beatPulse = 1;
      } else f.beatPulse *= Math.exp(-dt * 6);
    } else {
      if (this.kickTimes.length >= 4) {
        const iv = [];
        for (let i = 1; i < this.kickTimes.length; i++) iv.push(this.kickTimes[i] - this.kickTimes[i - 1]);
        iv.sort((a, b) => a - b);
        const med = iv[Math.floor(iv.length / 2)];
        if (med > 0.25 && med < 1) f.bpm = 60 / med;
      }
      this.fallbackPhase += dt * (f.bpm / 60);
      if (f.kickHit) this.fallbackPhase = Math.round(this.fallbackPhase);
      f.beatPhase = this.fallbackPhase % 1;
      const idx = Math.floor(this.fallbackPhase);
      f.beatInBar = idx % 4;
      if (idx !== this.lastBeatIdx) {
        this.lastBeatIdx = idx;
        f.beatPulse = f.playing ? 1 : 0.2;
      } else f.beatPulse *= Math.exp(-dt * 6);
    }

    // drop detection: low end back hard after >= 4 s of breakdown
    const low = (f.sub + f.kick) / 2;
    this.longLow += (low - this.longLow) * Math.min(1, dt * 0.15);
    if (low < this.longLow * 0.45 && f.playing) this.breakdownTime += dt;
    else if (low > this.longLow * 0.8) {
      if (this.breakdownTime > 4 && f.kickHit && now - this.lastDrop > 16) {
        this.lastDrop = now;
        f.dropHit = true;
        f.drop = 1;
        f.hue = (f.hue + 0.27) % 1;
      }
      this.breakdownTime = Math.max(0, this.breakdownTime - dt * 2);
    }
    if (!f.dropHit) f.drop *= Math.exp(-dt * 0.9);
    f.energy += (f.level - f.energy) * Math.min(1, dt * 0.5);
    f.hue = (f.hue + dt * 0.012 * (0.5 + f.energy)) % 1;
    return f;
  }
}
