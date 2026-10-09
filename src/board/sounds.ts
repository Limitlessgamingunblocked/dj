/*
 * The add-ons' own sounds (Section 13.6), synthesised and played into the
 * mix (so they're on recordings): drum voices for the step sequencer and the
 * ball pit, chopped vocal "ahs" for the vocal keyboard (in the track's key),
 * an air horn and a siren, the drop button's heartbeat and the tape lever's
 * clunk. Nothing to license, nothing to load.
 */

export type Drum = 'kick' | 'clap' | 'hat' | 'perc';

/** semitones of the major and minor scales */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** the note for key `i` of a keyboard laid out in the track's key (root = MIDI note) */
export function scaleNote(root: number, minor: boolean, i: number): number {
  const s = minor ? MINOR : MAJOR;
  const oct = Math.floor(i / s.length);
  return root + oct * 12 + s[((i % s.length) + s.length) % s.length];
}

export const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class AddonSounds {
  private noise: AudioBuffer;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {
    const len = Math.floor(ctx.sampleRate * 1.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
  }

  private env(at: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.out);
    return g;
  }

  private noiseSrc(at: number, len: number): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.start(at, Math.random() * 0.5);
    n.stop(at + len);
    return n;
  }

  drum(kind: Drum, at = this.ctx.currentTime, vel = 1): void {
    const c = this.ctx;
    if (kind === 'kick') {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(150, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      o.connect(this.env(at, 0.9 * vel, 0.003, 0.32));
      o.start(at);
      o.stop(at + 0.4);
    } else if (kind === 'clap') {
      for (let i = 0; i < 3; i++) {
        const n = this.noiseSrc(at + i * 0.012, 0.25);
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 1.2;
        n.connect(f).connect(this.env(at + i * 0.012, 0.45 * vel, 0.002, i === 2 ? 0.18 : 0.02));
      }
    } else if (kind === 'hat') {
      const n = this.noiseSrc(at, 0.1);
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7500;
      n.connect(f).connect(this.env(at, 0.28 * vel, 0.001, 0.05));
    } else {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(520 + Math.random() * 180, at);
      o.frequency.exponentialRampToValueAtTime(300, at + 0.08);
      o.connect(this.env(at, 0.35 * vel, 0.002, 0.12));
      o.start(at);
      o.stop(at + 0.2);
    }
  }

  /** a chopped vocal "ah" at a MIDI note: a buzz through two vowel formants */
  vocal(note: number, at = this.ctx.currentTime, len = 0.32): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(midiHz(note), at);
    const vib = c.createOscillator();
    vib.frequency.value = 5.5;
    const vd = c.createGain();
    vd.gain.value = midiHz(note) * 0.01;
    vib.connect(vd).connect(o.frequency);
    const g = this.env(at, 0.32, 0.02, len);
    for (const [f, q, lvl] of [
      [800, 6, 1],
      [1150, 8, 0.6],
      [2900, 10, 0.25],
    ]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const lg = c.createGain();
      lg.gain.value = lvl;
      o.connect(bp).connect(lg).connect(g);
    }
    o.start(at);
    vib.start(at);
    o.stop(at + len + 0.1);
    vib.stop(at + len + 0.1);
  }

  horn(at = this.ctx.currentTime): void {
    const c = this.ctx;
    for (const [start, len] of [
      [0, 0.18],
      [0.22, 0.18],
      [0.44, 0.6],
    ]) {
      for (const f of [466, 470, 233]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 0.96, at + start);
        o.frequency.linearRampToValueAtTime(f, at + start + 0.05);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        o.connect(lp).connect(this.env(at + start, 0.12, 0.02, len));
        o.start(at + start);
        o.stop(at + start + len + 0.1);
      }
    }
  }

  siren(at = this.ctx.currentTime): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(600, at);
    for (let i = 0; i < 4; i++) {
      o.frequency.linearRampToValueAtTime(1300, at + i * 0.5 + 0.25);
      o.frequency.linearRampToValueAtTime(600, at + i * 0.5 + 0.5);
    }
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    o.connect(lp).connect(this.env(at, 0.09, 0.05, 2));
    o.start(at);
    o.stop(at + 2.1);
  }

  heartbeat(at = this.ctx.currentTime): void {
    for (const dt of [0, 0.22]) {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(70, at + dt);
      o.frequency.exponentialRampToValueAtTime(40, at + dt + 0.12);
      o.connect(this.env(at + dt, dt ? 0.35 : 0.5, 0.005, 0.15));
      o.start(at + dt);
      o.stop(at + dt + 0.2);
    }
  }

  clunk(at = this.ctx.currentTime): void {
    const n = this.noiseSrc(at, 0.15);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    n.connect(f).connect(this.env(at, 0.6, 0.002, 0.12));
    this.drum('perc', at, 0.4);
  }

  /** a shimmer for the theremin and ribbon trails */
  shimmer(at = this.ctx.currentTime, pitch = 1): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1800 * pitch, at);
    o.frequency.exponentialRampToValueAtTime(2600 * pitch, at + 0.2);
    o.connect(this.env(at, 0.025, 0.01, 0.2));
    o.start(at);
    o.stop(at + 0.25);
  }
}
