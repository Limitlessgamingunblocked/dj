/*
 * The crowd shouting back at the MC: a "HO!", a roar, two bars of claps on
 * the beat, the DJ's name. Synthesised like the rest of the crowd
 * (audio/crowd.ts: shaped noise), played into the room, not the mix, so
 * recordings keep the MC but not a fake crowd.
 */
import type { CrowdAudio } from '../../audio/crowd';
import type { CallId } from '../../game/hypeman';

function noise(ctx: BaseAudioContext, secs: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * secs));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = 11 + c * 37;
    for (let i = 0; i < len; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
  }
  return b;
}

export class CrowdAnswers {
  private out: GainNode;
  private buf: AudioBuffer;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private crowd: CrowdAudio,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(dest);
    this.buf = noise(ctx, 3);
  }

  /** the crowd's answer to a call, `delay` seconds from now, `k` 0..1 how loud */
  answer(call: CallId, delay: number, k: number, bpm: number, vibe: number): void {
    const size = this.crowd.size;
    if (size <= 0) return;
    const t0 = this.ctx.currentTime + Math.max(0, delay);
    const g = size * k;
    const beat = 60 / (bpm > 0 ? bpm : 124);
    switch (call) {
      case 'ho':
        this.vowel(t0, 0.32, g * 0.55, [520, 880, 2400]);
        break;
      case 'hands':
      case 'noise':
        // the room's own cheer, later and bigger with a strong answer
        window.setTimeout(() => this.crowd.play('cheer', Math.min(1, vibe * 0.5 + k * 0.6), bpm), delay * 1000);
        if (call === 'noise') this.vowel(t0, 1.6, g * 0.35, [700, 1300, 2600], true);
        break;
      case 'clap':
        for (let i = 0; i < 8; i++) this.clap(t0 + i * beat, g * (0.5 + 0.1 * (i % 2)));
        break;
      case 'name':
        window.setTimeout(() => this.crowd.play('chant', Math.min(1, vibe * 0.5 + k * 0.6), bpm), delay * 1000);
        break;
    }
  }

  /** a shouted vowel from a lot of people: noise through formants, a quick swell */
  private vowel(t0: number, len: number, gain: number, formants: number[], long = false): void {
    const c = this.ctx;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + (long ? 0.3 : 0.04));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    env.connect(this.out);
    formants.forEach((f, i) => {
      const src = c.createBufferSource();
      src.buffer = this.buf;
      src.playbackRate.value = 1 + i * 0.05;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 3 - i * 0.6;
      const lvl = c.createGain();
      lvl.gain.value = [1, 0.6, 0.25][i] ?? 0.2;
      const p = c.createStereoPanner();
      p.pan.value = (i - 1) * 0.5;
      src.connect(bp).connect(lvl).connect(p).connect(env);
      src.start(t0, Math.random() * 2, len + 0.1);
    });
  }

  /** a room clapping on the beat: a short bright crack, spread a little in time */
  private clap(t0: number, gain: number): void {
    const c = this.ctx;
    for (let j = 0; j < 3; j++) {
      const s = t0 + j * 0.008 + Math.random() * 0.01;
      const src = c.createBufferSource();
      src.buffer = this.buf;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100 + j * 300;
      bp.Q.value = 1.4;
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, s);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * 0.5), s + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
      src.connect(bp).connect(env).connect(this.out);
      src.start(s, Math.random() * 2, 0.15);
    }
  }
}
