// @ts-nocheck
/*
 * The capture tap (AudioWorklet, audio thread): copies the clean master
 * output in blocks of 4096 frames and hands them to the main thread, which
 * keeps the replay buffer and any recording (audio/capture/Capture.ts).
 * It does no other work, so the audio thread never waits on it.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 4096;
    this.fresh();
    this.on = true;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'on') this.on = !!e.data.on;
    };
  }

  fresh() {
    this.l = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.i = 0;
  }

  process(inputs) {
    if (!this.on) return true;
    const inp = inputs[0] || [];
    const L = inp[0];
    const R = inp[1] || inp[0];
    const frames = L ? L.length : 128;
    for (let k = 0; k < frames; k++) {
      this.l[this.i] = L ? L[k] : 0;
      this.r[this.i] = R ? R[k] : 0;
      this.i++;
      if (this.i === this.n) {
        // `end`: the frame just after this block, on the context's clock
        this.port.postMessage({ l: this.l, r: this.r, end: currentFrame + k + 1 }, [this.l.buffer, this.r.buffer]);
        this.fresh();
      }
    }
    return true;
  }
}

registerProcessor('deckhouse-capture', CaptureProcessor);
