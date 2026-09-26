// @ts-nocheck
/*
 * Effect processors (AudioWorklet, audio thread).
 *   bitcrusher  – bit depth + sample-rate reduction with dry/wet (channel FX)
 *   pitch-shift – WebAssembly dual-tap pitch shifter (beat FX)
 */

class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.hold = [0, 0];
    this.phase = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    const amount = params.amount[0];
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      if (!inp) {
        out.fill(0);
        continue;
      }
      if (amount <= 0.001) {
        out.set(inp);
        continue;
      }
      const bits = 16 - amount * 13; // 16 → 3 bits
      const steps = Math.pow(2, bits) / 2;
      const down = 1 + Math.floor(amount * amount * 24); // sample-and-hold factor
      let phase = this.phase;
      let hold = this.hold[ch];
      const wet = Math.min(1, amount * 2.5);
      for (let i = 0; i < out.length; i++) {
        if (phase % down === 0) hold = Math.round(inp[i] * steps) / steps;
        phase++;
        out[i] = inp[i] * (1 - wet) + hold * wet;
      }
      this.hold[ch] = hold;
      if (ch === output.length - 1) this.phase = phase % 100000;
    }
    return true;
  }
}

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor(options) {
    super();
    this.w = null;
    const bytes = options && options.processorOptions && options.processorOptions.wasm;
    if (bytes) {
      WebAssembly.instantiate(bytes, { env: { sin: Math.sin, cos: Math.cos } })
        .then(({ instance }) => {
          const ex = instance.exports;
          this.w = {
            ex,
            p: ex.ps_create(sampleRate),
            l: ex.dh_alloc(128 * 4),
            r: ex.dh_alloc(128 * 4),
          };
          this.w.heap = new Float32Array(ex.memory.buffer);
        })
        .catch(() => {});
    }
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    const inL = input[0];
    const inR = input[1] || input[0];
    const oL = output[0];
    const oR = output[1] || output[0];
    if (!inL) {
      oL.fill(0);
      if (oR !== oL) oR.fill(0);
      return true;
    }
    const w = this.w;
    if (!w) {
      oL.set(inL);
      if (oR !== oL) oR.set(inR);
      return true;
    }
    const n = inL.length;
    w.ex.ps_set_ratio(w.p, params.ratio[0]);
    const hl = w.l >> 2;
    const hr = w.r >> 2;
    w.heap.set(inL, hl);
    w.heap.set(inR, hr);
    w.ex.ps_process(w.p, w.l, w.r, n);
    oL.set(w.heap.subarray(hl, hl + n));
    if (oR !== oL) oR.set(w.heap.subarray(hr, hr + n));
    return true;
  }
}

registerProcessor('bitcrusher', BitcrusherProcessor);
registerProcessor('pitch-shift', PitchShiftProcessor);
