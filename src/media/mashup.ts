/*
 * Renders a mashup or edit plan (game/mashup.ts) offline, faster than real
 * time, into a 16-bit stereo WAV. Each part is its source played from a bar
 * at the plan's rate; "beat" keeps the lows and highs (drums and bass), "top"
 * the mids that are left (vocals and melody), split so the two add back to
 * the whole. Parts fade in and out over a few milliseconds so the joins
 * don't click.
 */
import type { PcmData } from '../core/types';
import { planSeconds, type MashPlan } from '../game/mashup';
import { wavHeader } from '../audio/capture/pcm';

const RATE = 44100;
const EDGE = 0.012;

export async function renderPlan(plan: MashPlan, pcm: { A: PcmData; B?: PcmData }, onProgress?: (k: number) => void): Promise<Blob> {
  const secs = planSeconds(plan) + 0.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(secs * RATE), RATE);
  const buf = (p: PcmData) => {
    const b = ctx.createBuffer(2, p.channels[0].length, p.sampleRate);
    b.copyToChannel(p.channels[0] as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel((p.channels[1] ?? p.channels[0]) as Float32Array<ArrayBuffer>, 1);
    return b;
  };
  const bufs = { A: buf(pcm.A), B: pcm.B ? buf(pcm.B) : null };
  const bar = (60 / plan.bpm) * 4;
  const master = ctx.createGain();
  master.gain.value = 0.92;
  master.connect(ctx.destination);
  for (const part of plan.parts) {
    const b = bufs[part.src];
    if (!b) continue;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const rate = plan.rate[part.src];
    src.playbackRate.value = rate;
    const when = part.at * bar;
    const dur = part.bars * bar;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + EDGE);
    g.gain.setValueAtTime(1, when + dur - EDGE);
    g.gain.linearRampToValueAtTime(0, when + dur);
    connectLayer(ctx, src, g, part.layer);
    g.connect(master);
    // the source runs `dur` seconds of output: that's dur × rate of its own audio
    src.start(when, Math.max(0, part.from), dur * rate + EDGE);
  }
  onProgress?.(0.1);
  const out = await ctx.startRendering();
  onProgress?.(0.9);
  return toWav16(out);
}

/** the part's layer: the whole thing, its beat, or its top */
function connectLayer(ctx: BaseAudioContext, src: AudioNode, to: AudioNode, layer: 'full' | 'beat' | 'top'): void {
  if (layer === 'full') {
    src.connect(to);
    return;
  }
  const lr4 = (type: BiquadFilterType, f: number): [BiquadFilterNode, BiquadFilterNode] => {
    const a = ctx.createBiquadFilter();
    const b = ctx.createBiquadFilter();
    a.type = b.type = type;
    a.frequency.value = b.frequency.value = f;
    a.Q.value = b.Q.value = Math.SQRT1_2;
    a.connect(b);
    return [a, b];
  };
  const [l1, l2] = lr4('lowpass', 150);
  const [h1, h2] = lr4('highpass', 5500);
  const beat = ctx.createGain();
  src.connect(l1);
  l2.connect(beat);
  src.connect(h1);
  h2.connect(beat);
  if (layer === 'beat') {
    beat.connect(to);
    return;
  }
  // the top: everything minus the beat
  const neg = ctx.createGain();
  neg.gain.value = -1;
  beat.connect(neg).connect(to);
  src.connect(to);
}

/** 16-bit stereo WAV, lightly dithered */
function toWav16(b: AudioBuffer): Blob {
  const n = b.length;
  const L = b.getChannelData(0);
  const R = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
  const data = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const v = (c ? R : L)[i] * 32767 + (Math.random() - Math.random()) * 0.5;
      data[i * 2 + c] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v);
    }
  }
  return new Blob([wavHeader(n, b.sampleRate, 2, 16) as BlobPart, data.buffer as ArrayBuffer], { type: 'audio/wav' });
}
