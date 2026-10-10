/*
 * What the drums, the melody and the vocals are doing, live, from the mix.
 *
 * The same split as the decks' stem knobs (wasm/dsp.c), done on the analyser's
 * spectrum instead of the audio:
 *   - harmonic or percussive: a sound that holds its pitch is steady over time
 *     in its frequency band (median over the last few frames); a hit is
 *     spread across neighbouring bands for a moment (median across bands)
 *   - percussive energy is the drums: low for kicks, mid for snares and
 *     claps, top for hats and rides
 *   - harmonic energy below ~180 Hz is the bass
 *   - harmonic energy in the voice range that sits in the centre of the
 *     stereo picture (little in the side channel) is the vocal
 *   - the rest of the harmonic energy is the melody: chords, leads, pads
 *   - a voice wavers: vibrato, slides, never quite still. A centred sound
 *     that holds its pitch dead steady is a synth lead, so it counts as
 *     melody, not vocal
 * From the melody's spectral peaks comes the note it's on (a chroma, the
 * 12 pitch classes) and how high it is; from the vocal's, how high the voice
 * is. Pure: AudioFeatures feeds it the analyser's spectra every frame.
 */

export interface Parts {
  /** all the percussion, 0..1 */
  drums: number;
  kick: number;
  snare: number;
  hat: number;
  kickHit: boolean;
  snareHit: boolean;
  hatHit: boolean;
  /** fast envelopes that jump to 1 on a hit */
  kickPulse: number;
  snarePulse: number;
  hatPulse: number;
  bass: number;
  /** chords, leads, pads: 0..1 */
  melody: number;
  /** the pitch class the melody is on, 0 (C) … 11 (B) */
  melodyNote: number;
  /** how high the melody is, 0 (110 Hz) … 1 (2 kHz) */
  melodyPitch: number;
  /** the melody moved to a new note */
  melodyHit: boolean;
  melodyPulse: number;
  /** the note as a smoothed position round the colour wheel, 0..1 */
  melodyHue: number;
  vocal: number;
  /** how high the voice is, 0..1 */
  vocalPitch: number;
  /** someone is singing (or rapping): held, with some hysteresis */
  vocalOn: boolean;
  /** 0..1, eases in and out with vocalOn */
  vocalPresence: number;
}

interface Env {
  max: number;
  val: number;
  prev: number;
  mean: number;
  varc: number;
  last: number;
}

const env = (): Env => ({ max: 1e-6, val: 0, prev: 0, mean: 0, varc: 0, last: -10 });

/** bands from 40 Hz to 12 kHz, ~12 to the octave */
const NB = 96;
const F_LO = 40;
const F_HI = 12000;
const HIST = 11;
const SPREAD = 3;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function median(v: Float32Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const x = v[i];
    let j = i - 1;
    while (j >= 0 && v[j] > x) {
      v[j + 1] = v[j];
      j--;
    }
    v[j + 1] = x;
  }
  return v[n >> 1];
}

export class PartTracker {
  readonly p: Parts = {
    drums: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    kickHit: false,
    snareHit: false,
    hatHit: false,
    kickPulse: 0,
    snarePulse: 0,
    hatPulse: 0,
    bass: 0,
    melody: 0,
    melodyNote: 0,
    melodyPitch: 0.5,
    melodyHit: false,
    melodyPulse: 0,
    melodyHue: 0,
    vocal: 0,
    vocalPitch: 0.5,
    vocalOn: false,
    vocalPresence: 0,
  };
  private lo: Int32Array;
  private hi: Int32Array;
  private fc: Float32Array;
  private bassW: Float32Array;
  private vocW: Float32Array;
  private mag = new Float32Array(NB);
  private side = new Float32Array(NB);
  private hist: Float32Array[] = Array.from({ length: HIST }, () => new Float32Array(NB));
  private histPos = 0;
  private histCount = 0;
  private tmp = new Float32Array(Math.max(HIST, SPREAD * 2 + 1));
  /** per band: share of harmonic, of vocal, of melody */
  private mh = new Float32Array(NB);
  private mv = new Float32Array(NB);
  private mm = new Float32Array(NB);
  private bandOf: Int16Array;
  private lin: Float32Array;
  private sideLin: Float32Array;
  private chroma = new Float32Array(12);
  private chromaNow = new Float32Array(12);
  private e = { kick: env(), snare: env(), hat: env(), drums: env(), bass: env(), melody: env(), vocal: env() };
  private vocalHeld = 0;
  private noteHeld = 0;
  /** how much the centred voice's pitch moves, cents a second (smoothed), and the last peak's pitch */
  private wobble = 0;
  private lastVoc = 0;
  /** 0..1: the centred sound wavers like a voice (1) or holds still like a synth (0) */
  private live = 0;

  constructor(
    private binHz: number,
    bins: number,
  ) {
    this.lo = new Int32Array(NB);
    this.hi = new Int32Array(NB);
    this.fc = new Float32Array(NB);
    this.bassW = new Float32Array(NB);
    this.vocW = new Float32Array(NB);
    this.bandOf = new Int16Array(bins).fill(-1);
    this.lin = new Float32Array(bins);
    this.sideLin = new Float32Array(bins);
    for (let b = 0; b < NB; b++) {
      const f0 = F_LO * Math.pow(F_HI / F_LO, b / NB);
      const f1 = F_LO * Math.pow(F_HI / F_LO, (b + 1) / NB);
      this.lo[b] = Math.max(1, Math.floor(f0 / binHz));
      this.hi[b] = Math.min(bins - 1, Math.max(this.lo[b], Math.ceil(f1 / binHz) - 1));
      this.fc[b] = Math.sqrt(f0 * f1);
      for (let i = this.lo[b]; i <= this.hi[b]; i++) if (this.bandOf[i] < 0) this.bandOf[i] = b;
      // the same crossovers as the stem separator
      this.bassW[b] = 1 - smoothstep(110, 190, this.fc[b]);
      this.vocW[b] = smoothstep(170, 300, this.fc[b]) * (1 - smoothstep(4200, 7500, this.fc[b]));
    }
  }

  /** adaptive 0..1 level (the loudest it's been lately is 1) */
  private level(e: Env, x: number, dt: number, release: number): number {
    e.max = Math.max(x, e.max * Math.exp(-dt * 0.12), 1e-6);
    const v = Math.min(1, x / e.max);
    const flux = Math.max(0, v - e.prev);
    e.prev = v;
    e.val = v > e.val ? v : e.val + (v - e.val) * Math.min(1, dt * release);
    return flux;
  }

  private onset(e: Env, flux: number, now: number, minGap: number, k: number): boolean {
    const a = 0.08;
    e.mean += (flux - e.mean) * a;
    e.varc += ((flux - e.mean) ** 2 - e.varc) * a;
    if (flux > e.mean + k * Math.sqrt(e.varc) + 0.05 && now - e.last > minGap && e.val > 0.2) {
      e.last = now;
      return true;
    }
    return false;
  }

  /**
   * One frame. `midDb`: the mix's spectrum in dB (an AnalyserNode's
   * getFloatFrequencyData). `sideDb`: the same for left minus right, or null
   * for a mono source (then nothing counts as centred, so vocals rely on
   * range alone).
   */
  update(midDb: Float32Array, sideDb: Float32Array | null, dt: number, now: number): Parts {
    const p = this.p;
    const n = Math.min(midDb.length, this.lin.length);
    // below -100 dB is the analyser's floor: nothing there
    const amp = (db: number) => (db > -100 ? Math.pow(10, db / 20) : 0);
    for (let i = 0; i < n; i++) {
      this.lin[i] = amp(midDb[i]);
      this.sideLin[i] = sideDb ? amp(sideDb[i]) : this.lin[i] * 0.35;
    }
    // band magnitudes
    const cur = this.hist[this.histPos];
    for (let b = 0; b < NB; b++) {
      let s = 0;
      let sd = 0;
      for (let i = this.lo[b]; i <= this.hi[b]; i++) {
        s += this.lin[i];
        sd += this.sideLin[i];
      }
      const w = this.hi[b] - this.lo[b] + 1;
      this.mag[b] = s / w;
      this.side[b] = sd / w;
      cur[b] = this.mag[b];
    }
    this.histPos = (this.histPos + 1) % HIST;
    this.histCount = Math.min(HIST, this.histCount + 1);

    // harmonic vs percussive, then bass / vocal / melody
    let kickE = 0;
    let snareE = 0;
    let hatE = 0;
    let bassE = 0;
    let vocalE = 0;
    let melodyE = 0;
    let harmE = 0;
    let total = 0;
    // the same, tilted towards the top (music falls off about 3 dB an octave), for the shares:
    // otherwise the bass, loudest by far, would make every melody and vocal look small
    let melW = 0;
    let vocW = 0;
    let hiW = 0;
    for (let b = 0; b < NB; b++) {
      for (let t = 0; t < this.histCount; t++) this.tmp[t] = this.hist[t][b];
      const h = median(this.tmp, this.histCount);
      let m = 0;
      for (let j = Math.max(0, b - SPREAD); j <= Math.min(NB - 1, b + SPREAD); j++) this.tmp[m++] = this.mag[j];
      const pc = median(this.tmp, m);
      const h2 = h * h;
      const mh = h2 / (h2 + pc * pc + 1e-20);
      const mp = 1 - mh;
      const mag = this.mag[b];
      // centred: little in the side channel
      const c = 1 - this.side[b] / (mag + this.side[b] + 1e-12);
      const cc = Math.min(1, Math.max(0, (c - 0.55) * 2.2)) ** 2;
      const mb = mh * this.bassW[b];
      const rest = mh - mb;
      const mv = rest * this.vocW[b] * cc;
      this.mh[b] = mh;
      this.mv[b] = mv;
      this.mm[b] = rest - mv;
      const f = this.fc[b];
      const pe = mp * mag;
      if (f < 130) kickE += pe;
      else if (f < 5000) snareE += pe * (f > 1500 ? 1.4 : 1);
      if (f > 6000) hatE += pe;
      bassE += mb * mag;
      vocalE += mv * mag;
      melodyE += (rest - mv) * mag * (f > 180 && f < 8000 ? 1 : 0.3);
      harmE += mh * mag;
      total += mag;
      if (f > 180) {
        const w = Math.min(3, Math.sqrt(f / 1000)) * mag;
        hiW += w;
        vocW += mv * w;
        melW += (rest - mv) * w;
      }
    }
    const E = this.e;
    const kf = this.level(E.kick, kickE, dt, 9);
    const sf = this.level(E.snare, snareE, dt, 10);
    const hf = this.level(E.hat, hatE, dt, 14);
    this.level(E.drums, kickE + snareE * 0.7 + hatE * 0.5, dt, 8);
    this.level(E.bass, bassE, dt, 5);
    this.level(E.melody, melodyE, dt, 3);
    this.level(E.vocal, vocalE, dt, 3);
    // quieter than about -90 dB across the board: nothing playing
    const silent = total < NB * 3e-5;
    p.kickHit = !silent && this.onset(E.kick, kf, now, 0.2, 1.4);
    p.snareHit = !silent && this.onset(E.snare, sf, now, 0.14, 1.6);
    p.hatHit = !silent && this.onset(E.hat, hf, now, 0.06, 1.3);
    p.kickPulse = p.kickHit ? 1 : p.kickPulse * Math.exp(-dt * 7);
    p.snarePulse = p.snareHit ? 1 : p.snarePulse * Math.exp(-dt * 9);
    p.hatPulse = p.hatHit ? 1 : p.hatPulse * Math.exp(-dt * 16);
    p.kick = E.kick.val;
    p.snare = E.snare.val;
    p.hat = E.hat.val;
    p.drums = E.drums.val;
    p.bass = E.bass.val;
    // how voice-like the centred sound is (its pitch wavers), from the last frame's peaks
    this.voiceCheck(dt);
    const live = this.live;
    // the melody and the vocal: their level, held back when they're a small share of everything above the bass;
    // a steady centred sound goes to the melody
    const mShare = (melW + vocW * (1 - live)) / (hiW + 1e-12);
    const vShare = (vocW * live) / (hiW + 1e-12);
    p.melody = silent ? p.melody * Math.exp(-dt * 3) : Math.max(E.melody.val, E.vocal.val * (1 - live)) * smoothstep(0.06, 0.2, mShare);
    p.vocal = silent ? p.vocal * Math.exp(-dt * 3) : E.vocal.val * smoothstep(0.06, 0.18, vShare);
    // singing: a vocal share above 0.12 held for a quarter second turns it on; it lets go slowly
    const want = !silent && vShare > 0.12 && E.vocal.val > 0.25;
    this.vocalHeld = want ? Math.min(0.6, this.vocalHeld + dt) : Math.max(0, this.vocalHeld - dt * 0.6);
    if (!p.vocalOn && this.vocalHeld > 0.25) p.vocalOn = true;
    else if (p.vocalOn && this.vocalHeld <= 0) p.vocalOn = false;
    p.vocalPresence += ((p.vocalOn ? 1 : 0) - p.vocalPresence) * Math.min(1, dt * (p.vocalOn ? 4 : 1.2));

    this.pitch(dt, silent);
    return p;
  }

  private vocF = 0;

  /**
   * How much the strongest centred peak's pitch moves. A voice drifts and
   * shakes by tens of cents all the time; a synth sits still to a cent. Jumps
   * of more than a semitone and a half are new notes, not wobble.
   */
  private voiceCheck(dt: number): void {
    const f = this.vocF;
    if (f > 0 && this.lastVoc > 0) {
      const cents = Math.abs(1200 * Math.log2(f / this.lastVoc));
      if (cents < 150) this.wobble += (cents / Math.max(dt, 1e-3) - this.wobble) * Math.min(1, dt * 3);
    } else this.wobble *= Math.exp(-dt * 2);
    this.lastVoc = f;
    this.live += (smoothstep(120, 450, this.wobble) - this.live) * Math.min(1, dt * 2);
  }

  /** the melody's note and height, the voice's height, from spectral peaks */
  private pitch(dt: number, silent: boolean): void {
    const p = this.p;
    const lin = this.lin;
    // above the bass crossover, so the bass's own harmonics don't pull the note
    const i0 = Math.max(2, Math.floor(190 / this.binHz));
    const i1 = Math.min(lin.length - 2, Math.ceil(2000 / this.binHz));
    const chroma = this.chromaNow.fill(0);
    let mSum = 0;
    let mPos = 0;
    let vSum = 0;
    let vPos = 0;
    let vPeak = 0;
    let vF = 0;
    for (let i = i0; i <= i1; i++) {
      const a = lin[i];
      if (a <= lin[i - 1] || a < lin[i + 1]) continue; // peaks only
      const b = this.bandOf[i];
      if (b < 0) continue;
      // the peak's frequency, refined between bins
      const l = lin[i - 1];
      const r = lin[i + 1];
      const d = (r - l) / (2 * (2 * a - l - r) + 1e-12);
      const f = (i + Math.max(-0.5, Math.min(0.5, d))) * this.binHz;
      const lp = Math.log2(f / 110) / Math.log2(2000 / 110);
      const wv = a * this.mv[b];
      // a steady centred sound is part of the melody
      const wm = a * this.mm[b] + wv * (1 - this.live);
      if (f < 1100 && wv > vPeak) {
        vPeak = wv;
        vF = f;
      }
      const pcf = 12 * Math.log2(f / 440) + 69;
      const pc = ((Math.round(pcf) % 12) + 12) % 12;
      chroma[pc] += wm * wm;
      mSum += wm;
      mPos += wm * lp;
      vSum += wv;
      vPos += wv * lp;
    }
    const k = Math.min(1, dt * 7);
    for (let c = 0; c < 12; c++) this.chroma[c] += (chroma[c] - this.chroma[c]) * k;
    let best = p.melodyNote;
    for (let c = 0; c < 12; c++) if (this.chroma[c] > this.chroma[best]) best = c;
    p.melodyHit = false;
    // a new note needs to be clearly on top for a moment (no flicker between two)
    if (best !== p.melodyNote && this.chroma[best] > this.chroma[p.melodyNote] * 1.25 && !silent) {
      this.noteHeld += dt;
      if (this.noteHeld > 0.06) {
        p.melodyNote = best;
        this.noteHeld = 0;
        if (p.melody > 0.15) p.melodyHit = true;
      }
    } else this.noteHeld = 0;
    p.melodyPulse = p.melodyHit ? 1 : p.melodyPulse * Math.exp(-dt * 4);
    if (mSum > 1e-9) p.melodyPitch += (mPos / mSum - p.melodyPitch) * Math.min(1, dt * 5);
    if (vSum > 1e-9) p.vocalPitch += (vPos / vSum - p.vocalPitch) * Math.min(1, dt * 6);
    this.vocF = vF;
    // the note round the colour wheel, the short way, smoothed
    const target = p.melodyNote / 12;
    let dh = target - p.melodyHue;
    dh -= Math.round(dh);
    p.melodyHue = (((p.melodyHue + dh * Math.min(1, dt * 3)) % 1) + 1) % 1;
  }
}
