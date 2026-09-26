import { describe, expect, it } from 'vitest';
import { DSP_WASM_BASE64 } from '../src/audio/wasm/dspWasm';
import { base64ToBytes } from '../src/core/util';

function load() {
  const bytes = base64ToBytes(DSP_WASM_BASE64);
  const mod = new WebAssembly.Module(bytes);
  const inst = new WebAssembly.Instance(mod, { env: { sin: Math.sin, cos: Math.cos } });
  const ex = inst.exports as Record<string, any>;
  const mem = ex.memory as WebAssembly.Memory;
  const f32 = (ptr: number, len: number) => new Float32Array(mem.buffer, ptr, len);
  return { ex, f32 };
}

function tone(n: number, sr: number, f: number, pan = 0) {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * f * i) / sr) * 0.5;
    L[i] = v * (1 - pan);
    R[i] = v * (1 + pan);
  }
  return { L, R };
}

describe('wasm dsp', () => {
  it('stems reconstruct the input (delayed by the latency) at unity gain', () => {
    const { ex, f32 } = load();
    const sr = 48000;
    const s = ex.stems_create(sr);
    const block = 128;
    const bufL = ex.dh_alloc(block * 4);
    const bufR = ex.dh_alloc(block * 4);
    const n = 48000;
    const src = tone(n, sr, 440, 0.2);
    const outL = new Float32Array(n);
    // enable processing briefly then return to unity so the STFT path is exercised
    ex.stems_set_gains(s, 1, 1, 1, 0.999);
    for (let o = 0; o < n; o += block) {
      if (o === 24000) ex.stems_set_gains(s, 1, 1, 1, 1);
      f32(bufL, block).set(src.L.subarray(o, o + block));
      f32(bufR, block).set(src.R.subarray(o, o + block));
      ex.stems_process(s, bufL, bufR, block);
      outL.set(f32(bufL, block), o);
    }
    const lat = ex.stems_latency();
    expect(lat).toBe(1024);
    let err = 0;
    for (let i = 12000; i < 23000; i++) err = Math.max(err, Math.abs(outL[i] - src.L[i - lat]));
    expect(err).toBeLessThan(0.02);
    let err2 = 0;
    for (let i = 40000; i < 47000; i++) err2 = Math.max(err2, Math.abs(outL[i] - src.L[i - lat]));
    expect(err2).toBeLessThan(1e-5);
  });

  it('stems can remove the bass band', () => {
    const { ex, f32 } = load();
    const sr = 48000;
    const s = ex.stems_create(sr);
    const block = 128;
    const bufL = ex.dh_alloc(block * 4);
    const bufR = ex.dh_alloc(block * 4);
    const n = 48000;
    const src = tone(n, sr, 60);
    ex.stems_set_gains(s, 1, 1, 0, 1);
    let energy = 0;
    for (let o = 0; o < n; o += block) {
      f32(bufL, block).set(src.L.subarray(o, o + block));
      f32(bufR, block).set(src.R.subarray(o, o + block));
      ex.stems_process(s, bufL, bufR, block);
      if (o > 24000) for (const v of f32(bufL, block)) energy += v * v;
    }
    const rms = Math.sqrt(energy / 24000);
    expect(rms).toBeLessThan(0.05); // input rms is ~0.35
  });

  it('stretcher is transparent at rate 1 / pitch 1 and keeps pitch when slowed', () => {
    const { ex, f32 } = load();
    const sr = 44100;
    const n = sr * 2;
    const src = tone(n, sr, 441);
    const pL = ex.dh_alloc(n * 4);
    const pR = ex.dh_alloc(n * 4);
    f32(pL, n).set(src.L);
    f32(pR, n).set(src.R);
    const st = ex.st_create();
    ex.st_set_source(st, pL, pR, n);
    const block = 128;
    const oL = ex.dh_alloc(block * 4);
    const oR = ex.dh_alloc(block * 4);
    let pos = 1000;
    ex.st_reset(st, pos, 1);
    const out: number[] = [];
    for (let b = 0; b < 200; b++) {
      pos = ex.st_process(st, oL, oR, block, pos, 1, 1);
      out.push(...f32(oL, block));
    }
    let err = 0;
    for (let i = 0; i < out.length; i++) err = Math.max(err, Math.abs(out[i] - src.L[1000 + i]));
    expect(err).toBeLessThan(1e-3);

    // 0.8x tempo with pitch 1: output frequency should stay ~441 Hz
    pos = 1000;
    ex.st_reset(st, pos, 1);
    const slow: number[] = [];
    for (let b = 0; b < 300; b++) {
      pos = ex.st_process(st, oL, oR, block, pos, 0.8, 1);
      slow.push(...f32(oL, block));
    }
    expect(pos).toBeCloseTo(1000 + 300 * block * 0.8, 0);
    let crossings = 0;
    for (let i = 4000; i < 4000 + sr / 2; i++) if (slow[i - 1] < 0 && slow[i] >= 0) crossings++;
    expect(Math.abs(crossings * 2 - 441)).toBeLessThan(8);
  });

  it('pitch shifter raises frequency by the ratio', () => {
    const { ex, f32 } = load();
    const sr = 48000;
    const p = ex.ps_create(sr);
    ex.ps_set_ratio(p, 1.5);
    const block = 128;
    const bL = ex.dh_alloc(block * 4);
    const bR = ex.dh_alloc(block * 4);
    const n = sr;
    const src = tone(n, sr, 400);
    const out: number[] = [];
    for (let o = 0; o < n; o += block) {
      f32(bL, block).set(src.L.subarray(o, o + block));
      f32(bR, block).set(src.R.subarray(o, o + block));
      ex.ps_process(p, bL, bR, block);
      out.push(...f32(bL, block));
    }
    // estimate dominant frequency with a coarse DFT scan
    let bestF = 0;
    let best = 0;
    for (let f = 300; f <= 800; f += 5) {
      let re = 0;
      let im = 0;
      for (let i = 10000; i < 40000; i++) {
        re += out[i] * Math.cos((2 * Math.PI * f * i) / sr);
        im += out[i] * Math.sin((2 * Math.PI * f * i) / sr);
      }
      const m = re * re + im * im;
      if (m > best) {
        best = m;
        bestF = f;
      }
    }
    expect(Math.abs(bestF - 600)).toBeLessThanOrEqual(10);
  });
});
