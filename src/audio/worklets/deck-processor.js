// @ts-nocheck
/*
 * Deck playback processor (AudioWorklet, audio thread).
 *
 * Transport, varispeed with Hermite interpolation, position-locked scratching,
 * turntable motor inertia (start/brake), loops, slip mode, reverse and vinyl
 * wear run here in JS. Key lock / pitch shifting (WSOLA) and the stem
 * separator run in the WebAssembly DSP core.
 *
 * Positions are in source samples (sample rate of the loaded track).
 */

const REPORT_EVERY = 4; // blocks between position reports (~11 ms at 48 kHz)
const XFADE = 96; // micro crossfade length for jumps (samples)

function hermite(xm1, x0, x1, x2, t) {
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const b = w + a;
  return ((a * t - b) * t + c) * t + x0;
}

class DeckProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.L = null;
    this.R = null;
    this.len = 0;
    this.srRatio = 1;
    this.pos = 0;
    this.slipPos = 0;
    this.motorOn = false;
    this.platter = 0; // current platter speed (1 = normal) excluding sample-rate ratio
    this.target = 1; // platter speed when the motor is on (tempo, bend, sync)
    this.accel = 1; // per-sample speed change while starting
    this.decel = 1; // per-sample speed change while braking
    this.reverse = false;
    this.scratch = false;
    this.scratchTarget = 0;
    this.scratchVel = 0;
    this.loopOn = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.forcedSlip = false; // loop rolls, slicer, held hot cues
    this.slipMode = false;
    this.wasSlipping = false;
    this.keylock = false;
    this.semis = 0;
    this.stretchOn = false;
    this.wear = 0;
    this.wearLp = [0, 0];
    this.wowPhase = 0;
    this.noiseSeed = 22222;
    this.crackle = 0;
    this.blocks = 0;
    this.ended = false;
    this.xfadeLeft = 0;
    this.xfadePos = 0;
    this.xfadeVel = 0;

    this.wasm = null;
    this.stemGains = [1, 1, 1, 1];
    this.port.onmessage = (e) => this.onMessage(e.data);
    const bytes = options && options.processorOptions && options.processorOptions.wasm;
    if (bytes) this.initWasm(bytes);
    else this.port.postMessage({ type: 'ready', wasm: false, latency: 0 });
  }

  initWasm(bytes) {
    WebAssembly.instantiate(bytes, { env: { sin: Math.sin, cos: Math.cos } })
      .then(({ instance }) => {
        const ex = instance.exports;
        const w = {
          ex,
          stretch: ex.st_create(),
          stems: ex.stems_create(sampleRate),
          outL: ex.dh_alloc(128 * 4),
          outR: ex.dh_alloc(128 * 4),
          srcL: 0,
          srcR: 0,
          heap: null,
        };
        ex.dh_mark();
        this.wasm = w;
        ex.stems_set_gains(w.stems, ...this.stemGains);
        this.refreshViews();
        // a track may have arrived before wasm was ready
        if (this.L && !this.inWasm) this.moveTrackToWasm();
        this.port.postMessage({ type: 'ready', wasm: true, latency: ex.stems_latency() });
      })
      .catch((err) => {
        this.port.postMessage({ type: 'ready', wasm: false, latency: 0, error: String(err) });
      });
  }

  refreshViews() {
    const w = this.wasm;
    w.heap = new Float32Array(w.ex.memory.buffer);
    if (this.inWasm && this.len) {
      this.L = new Float32Array(w.ex.memory.buffer, w.srcL, this.len);
      this.R = new Float32Array(w.ex.memory.buffer, w.srcR, this.len);
    }
  }

  moveTrackToWasm() {
    const w = this.wasm;
    const L = this.L;
    const R = this.R;
    w.ex.dh_reset_to_mark();
    const pl = w.ex.dh_alloc(this.len * 4);
    const pr = w.ex.dh_alloc(this.len * 4);
    if (!pl || !pr) {
      this.inWasm = false; // out of wasm memory: keep JS arrays, no key lock
      return;
    }
    w.srcL = pl;
    w.srcR = pr;
    this.inWasm = true;
    this.refreshViews();
    this.L.set(L);
    this.R.set(R);
    w.ex.st_set_source(w.stretch, pl, pr, this.len);
    this.syncLoopToWasm();
  }

  syncLoopToWasm() {
    if (!this.wasm || !this.inWasm) return;
    this.wasm.ex.st_set_loop(this.wasm.stretch, this.loopOn ? 1 : 0, this.loopStart, this.loopEnd);
  }

  onMessage(m) {
    switch (m.type) {
      case 'load': {
        this.L = m.left;
        this.R = m.right || m.left;
        this.len = this.L.length;
        this.srRatio = m.sampleRate / sampleRate;
        this.inWasm = false;
        if (this.wasm) this.moveTrackToWasm();
        this.pos = m.pos || 0;
        this.slipPos = this.pos;
        this.motorOn = false;
        this.platter = 0;
        this.loopOn = false;
        this.forcedSlip = false;
        this.scratch = false;
        this.stretchOn = false;
        this.ended = false;
        this.syncLoopToWasm();
        this.report(true);
        break;
      }
      case 'unload':
        this.L = this.R = null;
        this.len = 0;
        this.motorOn = false;
        this.platter = 0;
        this.inWasm = false;
        break;
      case 'play':
        if (!this.len) break;
        if (this.pos >= this.len - 1) this.pos = 0;
        this.motorOn = true;
        this.ended = false;
        break;
      case 'pause':
        this.motorOn = false;
        if (m.instant) this.platter = 0;
        break;
      case 'motor':
        // start/brake times in seconds; 0 = instant
        this.accel = m.start > 0 ? 1 / (m.start * sampleRate) : 1;
        this.decel = m.brake > 0 ? 1 / (m.brake * sampleRate) : 1;
        break;
      case 'rate':
        this.target = m.value;
        break;
      case 'seek':
        this.jump(m.pos, m.slip === true);
        break;
      case 'loop':
        this.loopOn = !!m.on;
        this.loopStart = m.start;
        this.loopEnd = m.end;
        this.forcedSlip = !!m.forcedSlip;
        if (this.loopOn && m.jumpToStart) this.jump(m.start, false);
        else if (this.loopOn && this.pos >= this.loopEnd) {
          const len = this.loopEnd - this.loopStart;
          this.jump(this.loopStart + ((this.pos - this.loopStart) % len), false);
        }
        this.syncLoopToWasm();
        break;
      case 'forcedSlip':
        this.forcedSlip = !!m.on;
        break;
      case 'slip':
        this.slipMode = !!m.on;
        break;
      case 'reverse':
        this.reverse = !!m.on;
        break;
      case 'scratch':
        if (m.on && !this.scratch) {
          this.scratchTarget = this.pos;
          this.scratchVel = this.reverse ? -this.platter * this.srRatio : this.platter * this.srRatio;
        }
        this.scratch = !!m.on;
        if (this.scratch) this.leaveStretch();
        break;
      case 'scratchTarget':
        this.scratchTarget = m.value;
        break;
      case 'scratchDelta':
        this.scratchTarget += m.value;
        break;
      case 'keylock':
        this.keylock = !!m.on;
        break;
      case 'semis':
        this.semis = m.value;
        break;
      case 'wear':
        this.wear = m.value;
        break;
      case 'stems':
        this.stemGains = [m.vocal, m.drums, m.bass, m.melody];
        if (this.wasm) this.wasm.ex.stems_set_gains(this.wasm.stems, m.vocal, m.drums, m.bass, m.melody);
        break;
      default:
        break;
    }
  }

  jump(pos, keepSlip) {
    if (!this.len) return;
    pos = Math.max(0, Math.min(this.len - 2, pos));
    if (this.stretchOn) {
      // the grain in flight fades out naturally; next grain starts at pos
      this.pos = pos;
    } else {
      this.xfadeLeft = XFADE;
      this.xfadePos = this.pos;
      this.xfadeVel = this.reverse ? -this.platter * this.srRatio : this.platter * this.srRatio;
      this.pos = pos;
    }
    if (!keepSlip) this.slipPos = pos;
    if (this.scratch) this.scratchTarget = pos;
    this.ended = false;
  }

  leaveStretch() {
    if (!this.stretchOn) return;
    this.stretchOn = false;
    if (this.wasm) this.pos = this.wasm.ex.st_read_pos(this.wasm.stretch);
  }

  read(pos, ch) {
    const d = ch === 0 ? this.L : this.R;
    const i = Math.floor(pos);
    const t = pos - i;
    const len = this.len;
    const a = i - 1 >= 0 && i - 1 < len ? d[i - 1] : 0;
    const b = i >= 0 && i < len ? d[i] : 0;
    const c = i + 1 >= 0 && i + 1 < len ? d[i + 1] : 0;
    const e = i + 2 >= 0 && i + 2 < len ? d[i + 2] : 0;
    return hermite(a, b, c, e, t);
  }

  noise() {
    // xorshift, returns -1..1
    let x = this.noiseSeed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.noiseSeed = x;
    return (x | 0) / 2147483648;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;

    if (!this.len) {
      oL.fill(0);
      if (oR !== oL) oR.fill(0);
      this.processStems(oL, oR, n);
      if (++this.blocks % (REPORT_EVERY * 8) === 0) this.report(false);
      return true;
    }

    // motor / platter speed (block-rate is enough for ramps of >= 10 ms)
    const goal = this.motorOn ? this.target : 0;
    if (this.platter < goal) this.platter = Math.min(goal, this.platter + this.accel * n);
    else if (this.platter > goal) this.platter = Math.max(goal, this.platter - this.decel * n);

    const slipping = this.forcedSlip || (this.slipMode && (this.scratch || this.reverse || this.loopOn));
    if (this.wasSlipping && !slipping) this.jump(this.slipPos, true);
    this.wasSlipping = slipping;

    const semiRatio = Math.pow(2, this.semis / 12);
    const wantStretch =
      !!this.wasm && this.inWasm && !this.scratch && !this.reverse && this.platter > 0.2 &&
      Math.abs(this.platter - goal) < 0.01 && (this.keylock || this.semis !== 0);
    if (wantStretch && !this.stretchOn) {
      const pitch = (this.keylock ? 1 : this.platter) * semiRatio * this.srRatio;
      this.wasm.ex.st_reset(this.wasm.stretch, this.pos, pitch);
      this.xfadeLeft = 0;
      this.stretchOn = true;
    } else if (this.stretchOn && (this.scratch || this.reverse || this.platter < 0.2 || Math.abs(this.platter - goal) > 0.02)) {
      this.leaveStretch();
    }

    // wow & flutter for vinyl wear
    let wow = 1;
    if (this.wear > 0) {
      this.wowPhase += (n / sampleRate) * 0.55 * 2 * Math.PI;
      if (this.wowPhase > 6.283185307) this.wowPhase -= 6.283185307;
      wow = 1 + this.wear * (0.0022 * Math.sin(this.wowPhase) + 0.0006 * Math.sin(this.wowPhase * 11.3));
    }

    if (this.stretchOn) {
      const w = this.wasm;
      const rate = this.platter * this.srRatio * wow;
      const pitch = (this.keylock ? 1 : this.platter) * semiRatio * this.srRatio * wow;
      this.pos = w.ex.st_process(w.stretch, w.outL, w.outR, n, this.pos, rate, pitch);
      if (w.heap.buffer !== w.ex.memory.buffer) this.refreshViews();
      oL.set(w.heap.subarray(w.outL >> 2, (w.outL >> 2) + n));
      oR.set(w.heap.subarray(w.outR >> 2, (w.outR >> 2) + n));
      if (this.pos >= this.len - 1) this.endReached();
    } else {
      const alpha = 1 - Math.exp(-1 / (0.004 * sampleRate));
      const loopLen = this.loopEnd - this.loopStart;
      for (let i = 0; i < n; i++) {
        let v;
        if (this.scratch) {
          const err = this.scratchTarget - this.pos;
          let desired = err / (0.012 * sampleRate);
          const lim = 12 * this.srRatio;
          if (desired > lim) desired = lim;
          else if (desired < -lim) desired = -lim;
          this.scratchVel += (desired - this.scratchVel) * alpha;
          v = this.scratchVel;
        } else {
          v = (this.reverse ? -this.platter : this.platter) * this.srRatio * wow;
        }
        let l = this.read(this.pos, 0);
        let r = this.read(this.pos, 1);
        if (this.xfadeLeft > 0) {
          const g = this.xfadeLeft / XFADE;
          l = l * (1 - g) + this.read(this.xfadePos, 0) * g;
          r = r * (1 - g) + this.read(this.xfadePos, 1) * g;
          this.xfadePos += this.xfadeVel;
          this.xfadeLeft--;
        }
        oL[i] = l;
        oR[i] = r;
        this.pos += v;
        if (this.loopOn && loopLen > 8) {
          if (v > 0 && this.pos >= this.loopEnd) {
            this.xfadeLeft = XFADE;
            this.xfadePos = this.pos;
            this.xfadeVel = v;
            this.pos -= loopLen;
          } else if (v < 0 && this.pos < this.loopStart) {
            this.pos += loopLen;
          }
        }
        if (this.pos < 0) {
          this.pos = 0;
          if (this.scratch) this.scratchTarget = Math.max(this.scratchTarget, 0);
        }
        if (this.pos >= this.len - 1) {
          this.pos = this.len - 1;
          if (!this.scratch) {
            this.endReached();
            for (let j = i + 1; j < n; j++) {
              oL[j] = 0;
              oR[j] = 0;
            }
            break;
          }
        }
      }
    }

    // slip shadow playhead: where the track would be under normal playback
    if (slipping) this.slipPos += this.platter * this.srRatio * n;
    else this.slipPos = this.pos;
    if (this.slipPos > this.len - 1) this.slipPos = this.len - 1;

    if (this.wear > 0.001) this.applyWear(oL, oR, n);
    this.processStems(oL, oR, n);

    if (++this.blocks % REPORT_EVERY === 0) this.report(false);
    return true;
  }

  applyWear(oL, oR, n) {
    const wear = this.wear;
    const speed = this.scratch ? Math.min(2, Math.abs(this.scratchVel)) : this.platter;
    // gentle high-cut as the groove wears down
    const cutoff = 16000 - wear * 11000;
    const a = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    let lp0 = this.wearLp[0];
    let lp1 = this.wearLp[1];
    for (let i = 0; i < n; i++) {
      lp0 = oL[i] * (1 - a) + lp0 * a;
      lp1 = oR[i] * (1 - a) + lp1 * a;
      let noise = this.noise() * 0.004 * wear * speed; // surface hiss
      if (this.crackle > 0.0005) {
        noise += this.crackle * (this.noise() > 0 ? 1 : -1);
        this.crackle *= 0.62;
      } else if (Math.random() < wear * wear * 0.0009 * speed) {
        this.crackle = (0.05 + Math.random() * 0.25) * wear; // pop
      }
      oL[i] = lp0 + noise;
      oR[i] = lp1 + noise * 0.9;
    }
    this.wearLp[0] = lp0;
    this.wearLp[1] = lp1;
  }

  processStems(oL, oR, n) {
    const w = this.wasm;
    if (!w) return;
    const hl = w.outL >> 2;
    const hr = w.outR >> 2;
    w.heap.set(oL, hl);
    w.heap.set(oR, hr);
    w.ex.stems_process(w.stems, w.outL, w.outR, n);
    if (w.heap.buffer !== w.ex.memory.buffer) this.refreshViews();
    oL.set(w.heap.subarray(hl, hl + n));
    if (oR !== oL) oR.set(w.heap.subarray(hr, hr + n));
  }

  endReached() {
    this.motorOn = false;
    this.platter = 0;
    this.stretchOn = false;
    if (!this.ended) {
      this.ended = true;
      this.port.postMessage({ type: 'ended' });
    }
  }

  report(force) {
    const v = this.scratch ? this.scratchVel : (this.reverse ? -this.platter : this.platter) * this.srRatio;
    this.port.postMessage({
      type: 'pos',
      pos: this.pos,
      slip: this.slipPos,
      v,
      platter: this.platter,
      playing: this.motorOn,
      stretch: this.stretchOn,
      t: currentTime,
      force,
    });
  }
}

registerProcessor('deck-processor', DeckProcessor);
