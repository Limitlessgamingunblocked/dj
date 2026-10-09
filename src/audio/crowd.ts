/*
 * The crowd you hear (Section 8.3): a murmur that swells with the vibe, and
 * the room's reactions: cheers and whistles, a groan on a trainwreck, boos
 * on dead air, a "whoa" on a long build, and the chant (your name at the
 * peak, "one more tune" for the encore). Synthesised (shaped noise and a few
 * oscillators), played into the room (audio/room.ts), not into the mix, so
 * recordings stay clean. The Bedroom has no room crowd: its crowd is the chat.
 */

export type CrowdSound = 'cheer' | 'groan' | 'boo' | 'whoa' | 'chant';

function noiseBuffer(ctx: BaseAudioContext, secs: number, seed = 7): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * secs));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = seed + c * 31;
    for (let i = 0; i < len; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
  }
  return b;
}

export class CrowdAudio {
  private out: GainNode;
  private murmur: GainNode;
  private noise: AudioBuffer;
  /** how big the crowd sounds (0: none) */
  size = 1;
  private level = 0;
  private lastSound = new Map<CrowdSound, number>();

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(dest);
    this.noise = noiseBuffer(ctx, 4);
    // the murmur: two bands of looped noise, slowly breathing
    this.murmur = ctx.createGain();
    this.murmur.gain.value = 0;
    this.murmur.connect(this.out);
    for (const [f, q, pan] of [
      [520, 0.7, -0.5],
      [1300, 0.9, 0.5],
    ]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.loopStart = f > 1000 ? 1.3 : 0;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + f / 20000;
      const depth = ctx.createGain();
      depth.gain.value = 0.25;
      const g = ctx.createGain();
      g.gain.value = 0.6;
      lfo.connect(depth).connect(g.gain);
      src.connect(bp).connect(g).connect(p).connect(this.murmur);
      src.start();
      lfo.start();
    }
  }

  /** every frame: the murmur follows the vibe (louder and busier as the room warms up) */
  update(dt: number, vibe: number, playing: boolean): void {
    const want = this.size * (playing ? 0.035 + 0.12 * vibe * vibe : 0.05);
    this.level += (want - this.level) * Math.min(1, dt * 0.8);
    this.murmur.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.1);
  }

  /** a reaction, scaled by how into it they are */
  play(what: CrowdSound, vibe: number, bpm = 124): void {
    if (this.size <= 0) return;
    const t0 = this.ctx.currentTime;
    // the same reaction twice in a breath sounds fake
    if (t0 - (this.lastSound.get(what) ?? -1e9) < (what === 'chant' ? 8 : 1.5)) return;
    this.lastSound.set(what, t0);
    const k = this.size * (0.4 + 0.6 * vibe);
    switch (what) {
      case 'cheer':
        this.roar(t0, 2.4, k * 0.5, [900, 1700, 2700], 'up');
        this.whistles(t0 + 0.25, Math.round(1 + vibe * 3), k);
        break;
      case 'whoa':
        this.roar(t0, 1.6, k * 0.35, [500, 900], 'rise');
        break;
      case 'groan':
        // "ohhh": a falling vowel
        this.roar(t0, 1.4, k * 0.4, [700, 380], 'fall');
        break;
      case 'boo':
        this.roar(t0, 1.8, k * 0.35, [320, 640], 'boo');
        break;
      case 'chant': {
        // shouts on the beat for two bars ("one more tune" / your name at the peak)
        const beat = 60 / bpm;
        for (let i = 0; i < 8; i++) if (i % 4 !== 3) this.shout(t0 + 0.05 + i * beat, beat * 0.5, k * 0.45, i % 2 ? 620 : 520);
        break;
      }
    }
  }

  private roar(t0: number, secs: number, gain: number, bands: number[], shape: 'up' | 'rise' | 'fall' | 'boo'): void {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + (shape === 'rise' ? secs * 0.7 : 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + secs);
    g.connect(this.out);
    bands.forEach((f, i) => {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 1 + i * 0.07;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = shape === 'boo' ? 4 : 1.2;
      bp.frequency.setValueAtTime(f, t0);
      if (shape === 'fall') bp.frequency.exponentialRampToValueAtTime(f * 0.55, t0 + secs);
      if (shape === 'rise') bp.frequency.exponentialRampToValueAtTime(f * 1.6, t0 + secs * 0.8);
      if (shape === 'boo') {
        // a wobbling low vowel
        const lfo = c.createOscillator();
        lfo.frequency.value = 5;
        const d = c.createGain();
        d.gain.value = f * 0.08;
        lfo.connect(d).connect(bp.frequency);
        lfo.start(t0);
        lfo.stop(t0 + secs);
      }
      const p = c.createStereoPanner();
      p.pan.value = (i / Math.max(1, bands.length - 1)) * 1.2 - 0.6;
      src.connect(bp).connect(p).connect(g);
      src.start(t0, Math.random() * 2);
      src.stop(t0 + secs + 0.1);
    });
  }

  private whistles(t0: number, n: number, gain: number): void {
    const c = this.ctx;
    for (let i = 0; i < n; i++) {
      const s = t0 + Math.random() * 1.2;
      const w = c.createOscillator();
      w.frequency.setValueAtTime(1500 + Math.random() * 500, s);
      w.frequency.linearRampToValueAtTime(2400 + Math.random() * 400, s + 0.18);
      w.frequency.linearRampToValueAtTime(1900, s + 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.05 * gain, s + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.55);
      w.connect(g).connect(this.out);
      w.start(s);
      w.stop(s + 0.6);
    }
  }

  private shout(t0: number, len: number, gain: number, f: number): void {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = 2.5;
    const bp2 = c.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = f * 2.4;
    bp2.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(bp).connect(g);
    src.connect(bp2).connect(g);
    g.connect(this.out);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + len + 0.05);
  }
}
