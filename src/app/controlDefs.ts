/*
 * Registers every operable control and binds it to the audio engine.
 * Ids:  deck.N.*  (N = 1..4, or L/R for the active layer)
 *       ch.N.*    mixer channel strips
 *       mixer.*   crossfader, master, headphones
 *       fx.*      beat FX unit
 *       sampler.* sample bank
 *       browse, shift, layer.L/R
 */
import type { ControlRegistry, LedState } from '../core/controls';
import type { AudioEngine } from '../audio/AudioEngine';
import { PAD_MODES, SECONDS_PER_REV, type Deck, type PadMode } from '../audio/Deck';
import { FX_TYPES, type FxTarget } from '../audio/fx/BeatFX';
import { clamp, gainToDb } from '../core/util';
import { eqKnobToGain, trimKnobToGain } from '../audio/Channel';
import { keySyncShift } from '../analysis/keys';

export interface ControlHooks {
  loadSelected(deck: number): void;
  browse(delta: number): void;
  layerChanged(): void;
  /** sync can be refused (Pro assist in a gig): returns why, or null when allowed */
  syncBlocked?(): string | null;
  denied?(why: string): void;
  /** load the track before / after this deck's in the library list (track search ◀◀ ▶▶) */
  adjacent?(deck: number, delta: number): void;
  /** the all-in-one's screen buttons: BACK, the browse encoder's push, TAG */
  screenBack?(): void;
  browsePress?(): void;
  tagSelected?(): void;
}

/* the all-in-one's memory / call buttons, on the hot cues (pure, tested) */

/** where CALL ◀ / ▶ goes: the hot cue before (a little behind the playhead) or after it; null when there's none */
export function callCue(cues: ({ pos: number } | null)[], pos: number, dir: -1 | 1): number | null {
  const at = cues.filter((c): c is { pos: number } => !!c).map((c) => c.pos);
  if (dir > 0) {
    const next = at.filter((p) => p > pos + 0.05).sort((a, b) => a - b);
    return next.length ? next[0] : null;
  }
  const prev = at.filter((p) => p < pos - 0.5).sort((a, b) => b - a);
  return prev.length ? prev[0] : null;
}

/** DELETE: the hot cue at or just behind the playhead (the one you'd have just called) */
export function cueToDelete(cues: ({ pos: number } | null)[], pos: number): number {
  let best = -1;
  let bestPos = -Infinity;
  cues.forEach((c, i) => {
    if (c && c.pos <= pos + 0.05 && c.pos > bestPos) {
      best = i;
      bestPos = c.pos;
    }
  });
  return best;
}

interface ColorChannel {
  state: { filter: number; crush: number; res: number };
  setFilter(v: number): void;
  setCrush(v: number): void;
  setRes(v: number): void;
}

/**
 * The sound colour FX: the all-in-one's COLOR knobs play the filter or the
 * bitcrusher, picked with the FILTER / CRUSH buttons. Switching keeps each
 * knob where it is: the old effect goes back to neutral, the new one picks up
 * from the knob. CRUSH grows either way from the centre.
 */
export class ColorFx {
  mode: 'filter' | 'crush' = 'filter';
  private side: number[];

  constructor(private channels: ColorChannel[]) {
    this.side = channels.map(() => 1);
  }

  get(i: number): number {
    const c = this.channels[i];
    return this.mode === 'filter' ? c.state.filter : 0.5 + (this.side[i] * c.state.crush) / 2;
  }

  set(i: number, v: number): void {
    const c = this.channels[i];
    if (this.mode === 'filter') c.setFilter(v);
    else {
      const off = v - 0.5;
      this.side[i] = off < 0 ? -1 : 1;
      c.setCrush(clamp(Math.abs(off) * 2, 0, 1));
    }
  }

  setMode(m: 'filter' | 'crush'): void {
    if (m === this.mode) return;
    const at = this.channels.map((_, i) => this.get(i));
    for (const c of this.channels) {
      if (this.mode === 'filter') c.setFilter(0.5);
      else c.setCrush(0);
    }
    this.mode = m;
    at.forEach((v, i) => this.set(i, v));
  }
}

const fmtDb = (g: number) => {
  const db = gainToDb(g);
  return db === -Infinity || db < -60 ? '−∞ dB' : `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
};

export function registerControls(reg: ControlRegistry, engine: AudioEngine, hooks: ControlHooks): void {
  const btn = (id: string, label: string, press: () => void, lit?: () => LedState, release?: () => void) =>
    reg.register({ id, label, kind: 'button', press, release, lit });
  const knob = (id: string, label: string, get: () => number, set: (v: number) => void, def: number, center = false, format?: (v: number) => string) =>
    reg.register({ id, label, kind: 'continuous', get, set, def, center, format });

  for (const deck of engine.decks) {
    const d = deck;
    const p = `deck.${d.id}.`;
    const L = (s: string) => `Deck ${d.id} ${s}`;
    btn(p + 'play', L('Play/Pause'), () => d.togglePlay(), () => (d.playing ? true : d.loaded ? { color: '#3ddc97', blink: true, level: 0.8 } : false));
    btn(p + 'cue', L('Cue'), () => d.cueDown(), () => (d.cueLit ? '#ff9f1c' : false), () => d.cueUp());
    btn(p + 'start', L('Start/Stop'), () => (d.playing ? d.pause() : d.play()), () => (d.playing ? '#ff3b5c' : false));
    btn(p + 'sync', L('Sync'), () => {
      const why = !d.sync ? (hooks.syncBlocked?.() ?? null) : null;
      if (why) hooks.denied?.(why);
      else d.setSync(!d.sync);
    }, () => (d.sync ? '#2ec4f1' : false));
    btn(p + 'master', L('Master'), () => engine.setMaster(d), () => (d.isMaster ? '#ff9f1c' : false));
    btn(p + 'keylock', L('Key Lock'), () => d.setKeylock(!d.keylock), () => (d.keylock ? '#ff5fcf' : false));
    btn(p + 'slip', L('Slip'), () => d.setSlip(!d.slip), () => (d.slip ? '#b36bff' : false));
    btn(p + 'quantize', L('Quantize'), () => {
      d.quantize = !d.quantize;
      d.emit('change', d);
    }, () => (d.quantize ? '#ff3b5c' : false));
    btn(p + 'vinyl', L('Vinyl mode'), () => {
      d.vinyl = !d.vinyl;
      d.emit('change', d);
    }, () => (d.vinyl ? '#ffffff' : false));
    btn(p + 'reverse', L('Reverse'), () => d.setReverse(!d.reverse), () => (d.reverse ? '#ff3b5c' : false));
    btn(p + 'censor', L('Censor (reverse + slip)'), () => {
      d.setSlip(true);
      d.setReverse(true);
    }, () => (d.reverse ? '#ff3b5c' : false), () => {
      d.setReverse(false);
    });
    knob(p + 'tempo', L('Tempo'), () => (d.tempoFader + 1) / 2, (v) => d.setTempo(v * 2 - 1), 0.5, true, () => `${d.tempoPercent >= 0 ? '+' : ''}${d.tempoPercent.toFixed(2)}%`);
    btn(p + 'tempo.reset', L('Tempo reset'), () => d.setTempo(0), () => (d.tempo === 0 ? '#3ddc97' : false));
    btn(p + 'range', L('Tempo range'), () => d.cycleRange(), () => false);
    btn(p + 'bend.up', L('Pitch bend +'), () => (d.bendDir = 1), () => (d.bendDir > 0 ? true : false), () => (d.bendDir = 0));
    btn(p + 'bend.down', L('Pitch bend −'), () => (d.bendDir = -1), () => (d.bendDir < 0 ? true : false), () => (d.bendDir = 0));
    reg.register({
      id: p + 'jog',
      label: L('Jog wheel'),
      kind: 'jog',
      touch: (zone) => d.jogTouch(zone),
      turn: (revs) => d.jogTurn(revs),
      angle: () => d.recordAngle,
      touched: () => d.jogTouched,
    });
    for (let i = 0; i < 8; i++) {
      btn(p + `pad.${i + 1}`, L(`Pad ${i + 1}`), () => d.padDown(i), () => d.padLit(i), () => d.padUp(i));
      btn(p + `hotcue.${i + 1}`, L(`Hot cue ${String.fromCharCode(65 + i)}`), () => {
        const mode = d.padMode;
        d.padMode = 'hotcue';
        d.padDown(i);
        d.padMode = mode;
      }, () => (d.hotCues[i] ? d.hotCues[i]!.color : false), () => {
        const mode = d.padMode;
        d.padMode = 'hotcue';
        d.padUp(i);
        d.padMode = mode;
      });
    }
    for (const m of PAD_MODES) btn(p + `padmode.${m}`, L(`Pad mode ${m}`), () => d.setPadMode(m as PadMode), () => (d.padMode === m ? '#ffffff' : false));
    btn(p + 'loop.in', L('Loop in'), () => d.loopInPress(), () => (d.loop.active ? '#3ddc97' : d.loopPending ? { color: '#3ddc97', blink: true, level: 1 } : false));
    btn(p + 'loop.out', L('Loop out'), () => d.loopOutPress(), () => (d.loop.active ? '#3ddc97' : false));
    btn(p + 'loop.exit', L('Reloop/Exit'), () => d.reloop(), () => (d.loop.active ? '#3ddc97' : false));
    btn(p + 'loop.auto', L('Auto loop (the loop size)'), () => d.autoLoop(), () => (d.loop.active && !d.loop.roll ? '#3ddc97' : false));
    btn(p + 'loop.4beat', L('4-beat loop'), () => d.fourBeatLoop(), () => (d.loop.active && !d.loop.roll ? '#3ddc97' : false));
    btn(p + 'loop.half', L('Loop ½'), () => d.resizeLoop(-1), () => false);
    btn(p + 'loop.double', L('Loop ×2'), () => d.resizeLoop(1), () => false);
    reg.register({ id: p + 'loop.size', label: L('Loop size'), kind: 'encoder', step: (dl) => d.resizeLoop(dl > 0 ? 1 : -1), press: () => d.autoLoop() });
    btn(p + 'jump.back', L('Beat jump back'), () => d.beatJump(-d.jumpBeats), () => false);
    btn(p + 'jump.fwd', L('Beat jump forward'), () => d.beatJump(d.jumpBeats), () => false);
    reg.register({ id: p + 'jump.size', label: L('Beat jump size'), kind: 'encoder', step: (dl) => d.resizeJump(dl > 0 ? 1 : -1) });
    btn(p + 'load', L('Load selected track'), () => hooks.loadSelected(d.id), () => false);
    btn(p + 'track.prev', L('Track search: previous track'), () => hooks.adjacent?.(d.id, -1), () => false);
    btn(p + 'track.next', L('Track search: next track'), () => hooks.adjacent?.(d.id, 1), () => false);
    // search: hold to scan through the track, about 8× speed
    for (const [name, dir] of [['search.back', -1], ['search.fwd', 1]] as const) {
      let timer: ReturnType<typeof setInterval> | null = null;
      btn(p + name, L(dir < 0 ? 'Search back (hold)' : 'Search forward (hold)'), () => {
        if (timer || !d.loaded) return;
        timer = setInterval(() => d.seek(clamp(d.position() + dir * 0.45, 0, d.duration), d.slip), 60);
      }, () => timer !== null, () => {
        if (timer) clearInterval(timer);
        timer = null;
      });
    }
    btn(p + 'call.prev', L('Cue/loop call ◀ (previous hot cue)'), () => {
      const to = callCue(d.hotCues, d.position(), -1);
      if (to !== null) d.jumpTo(to);
    }, () => false);
    btn(p + 'call.next', L('Cue/loop call ▶ (next hot cue)'), () => {
      const to = callCue(d.hotCues, d.position(), 1);
      if (to !== null) d.jumpTo(to);
    }, () => false);
    btn(p + 'memory', L('Memory: store a hot cue here'), () => {
      const free = d.hotCues.findIndex((c) => !c);
      if (d.loaded && free >= 0) d.setHotCue(free);
    }, () => false);
    btn(p + 'delete', L('Delete the hot cue just called'), () => {
      const i = cueToDelete(d.hotCues, d.position());
      if (i >= 0) d.deleteHotCue(i);
    }, () => false);
    btn(p + 'key.up', L('Key +1'), () => d.setKeyShift(d.keyShift + 1), () => (d.keyShift > 0 ? '#ff5fcf' : false));
    btn(p + 'key.down', L('Key −1'), () => d.setKeyShift(d.keyShift - 1), () => (d.keyShift < 0 ? '#ff5fcf' : false));
    btn(p + 'key.reset', L('Key reset'), () => d.setKeyShift(0), () => false);
    btn(p + 'key.sync', L('Key sync'), () => keySync(engine, d), () => false);
    knob(p + 'needle', L('Needle position'), () => (d.duration ? d.position() / d.duration : 0), (v) => d.seek(v * d.duration), 0);
    btn(p + 'rpm33', L('33 RPM'), () => {
      d.rpm45 = false;
      d.emit('change', d);
    }, () => (!d.rpm45 ? '#ffd23f' : false));
    btn(p + 'rpm45', L('45 RPM'), () => {
      d.rpm45 = true;
      d.emit('change', d);
    }, () => (d.rpm45 ? '#ffd23f' : false));
    knob(p + 'motor.start', L('Start time'), () => d.motorStart / 2, (v) => {
      d.motorStart = clamp(v * 2, 0, 2);
      d.applyMotor();
    }, 0.175, false, (v) => `${(v * 2).toFixed(2)} s`);
    knob(p + 'motor.brake', L('Brake time'), () => d.motorBrake / 3, (v) => {
      d.motorBrake = clamp(v * 3, 0, 3);
      d.applyMotor();
    }, 0.2, false, (v) => `${(v * 3).toFixed(2)} s`);
    knob(p + 'wear', L('Vinyl wear'), () => d.wear, (v) => d.setWear(v), 0);
    knob(p + 'jogscale', L('Jog sensitivity'), () => d.jogScale / 2, (v) => (d.jogScale = clamp(v * 2, 0.1, 2)), 0.5, false, () => `${(SECONDS_PER_REV * d.jogScale).toFixed(2)} s/rev`);
    for (const stem of ['vocal', 'drums', 'bass', 'melody'] as const) {
      knob(p + `stem.${stem}`, L(`${stem} stem`), () => d.stems[stem], (v) => d.setStems({ [stem]: clamp(v, 0, 1) }), 1);
      btn(p + `stem.${stem}.mute`, L(`Mute ${stem}`), () => d.setStems({ [stem]: d.stems[stem] > 0.01 ? 0 : 1 }), () => (d.stems[stem] <= 0.01 ? '#ff3b5c' : false));
    }
  }

  // the all-in-one's sound colour FX
  const color = new ColorFx(engine.channels);
  engine.channels.forEach((_, i) => {
    knob(`ch.${i + 1}.color`, `Channel ${i + 1} colour FX`, () => color.get(i), (v) => color.set(i, v), 0.5, true, (v) => (color.mode === 'crush' ? `CRUSH ${Math.round(Math.abs(v - 0.5) * 200)}%` : v < 0.48 ? 'LPF' : v > 0.52 ? 'HPF' : 'OFF'));
  });
  btn('colorfx.filter', 'Sound colour FX: filter', () => color.setMode('filter'), () => (color.mode === 'filter' ? '#3ddc97' : false));
  btn('colorfx.crush', 'Sound colour FX: crush', () => color.setMode('crush'), () => (color.mode === 'crush' ? '#3ddc97' : false));
  knob('colorfx.param', 'Sound colour FX parameter (filter resonance)', () => engine.channels[0].state.res, (v) => engine.channels.forEach((ch) => ch.setRes(v)), 0.25);
  // knobs on the hardware with nothing behind them in the game: they turn and remember, honestly labelled
  const panel = (id: string, label: string, def: number, center = false) => {
    let v = def;
    knob(id, label, () => v, (x) => (v = x), def, center);
  };
  panel('mic.1.level', 'Mic 1 level (the game has no mic input)', 0);
  panel('mic.2.level', 'Mic 2 level (the game has no mic input)', 0);
  panel('mic.hi', 'Mic EQ high (the game has no mic input)', 0.5, true);
  panel('mic.low', 'Mic EQ low (the game has no mic input)', 0.5, true);
  panel('aux.trim', 'Aux input trim (nothing is plugged in)', 0.5, true);
  panel('mixer.booth', 'Booth monitor level (the game has one output)', 0.6);

  engine.channels.forEach((ch, i) => {
    const p = `ch.${i + 1}.`;
    const L = (s: string) => `Channel ${i + 1} ${s}`;
    knob(p + 'trim', L('Trim'), () => ch.state.trim, (v) => ch.setTrim(v), 0.5, true, (v) => fmtDb(trimKnobToGain(v)));
    knob(p + 'hi', L('EQ high'), () => ch.state.hi, (v) => ch.setEq('hi', v), 0.5, true, (v) => fmtDb(eqKnobToGain(v)));
    knob(p + 'mid', L('EQ mid'), () => ch.state.mid, (v) => ch.setEq('mid', v), 0.5, true, (v) => fmtDb(eqKnobToGain(v)));
    knob(p + 'low', L('EQ low'), () => ch.state.low, (v) => ch.setEq('low', v), 0.5, true, (v) => fmtDb(eqKnobToGain(v)));
    knob(p + 'filter', L('Filter'), () => ch.state.filter, (v) => ch.setFilter(v), 0.5, true, (v) => (v < 0.48 ? 'LPF' : v > 0.52 ? 'HPF' : 'OFF'));
    knob(p + 'res', L('Filter resonance'), () => ch.state.res, (v) => ch.setRes(v), 0.25);
    knob(p + 'crush', L('Bitcrusher'), () => ch.state.crush, (v) => ch.setCrush(v), 0);
    knob(p + 'fader', L('Fader'), () => ch.state.fader, (v) => ch.setFader(v), 0.8);
    btn(p + 'cue', L('Headphone cue'), () => ch.setCue(!ch.state.cue), () => (ch.state.cue ? '#ff9f1c' : false));
    btn(p + 'assign', L('Crossfader assign'), () => {
      const order = ['A', 'THRU', 'B'] as const;
      ch.state.assign = order[(order.indexOf(ch.state.assign) + 1) % 3];
      engine.mixer.updateCrossfader();
    }, () => (ch.state.assign === 'THRU' ? false : ch.state.assign === 'A' ? '#4cc9f0' : '#ff9f1c'));
    for (const a of ['A', 'THRU', 'B'] as const) {
      btn(p + `assign.${a.toLowerCase()}`, L(`Assign ${a}`), () => {
        ch.state.assign = a;
        engine.mixer.updateCrossfader();
      }, () => ch.state.assign === a);
    }
  });

  const mx = engine.mixer;
  knob('mixer.xfader', 'Crossfader', () => mx.xfader, (v) => mx.setCrossfader(v), 0.5, true);
  knob('mixer.xcurve', 'Crossfader curve', () => mx.xcurve, (v) => mx.setCurve(v), 0.35, false, (v) => (v < 0.2 ? 'SMOOTH' : v > 0.85 ? 'CUT' : 'MID'));
  knob('mixer.master', 'Master level', () => mx.master, (v) => mx.setMaster(v), 0.8);
  knob('mixer.cuemix', 'Headphone cue/master mix', () => mx.cueMix, (v) => mx.setCueMix(v), 0.3, true);
  knob('mixer.phones', 'Headphone level', () => mx.phones, (v) => mx.setPhones(v), 0.8);
  knob('mixer.sampler', 'Sampler level', () => engine.sampler.volume, (v) => engine.sampler.setVolume(v), 0.8);
  btn('mixer.hamster', 'Crossfader reverse', () => {
    mx.hamster = !mx.hamster;
    mx.updateCrossfader();
  }, () => mx.hamster);
  btn('mixer.split', 'Split cue', () => mx.setSplit(!mx.split), () => (mx.split ? '#ff9f1c' : false));

  const fx = engine.fx;
  btn('fx.on', 'Beat FX on/off', () => fx.setOn(!fx.on), () => (fx.on ? { color: '#ff3b5c', blink: false } : false));
  knob('fx.depth', 'Beat FX level/depth', () => fx.depth, (v) => fx.setDepth(v), 0.5);
  knob('fx.param', 'Beat FX parameter', () => fx.param, (v) => fx.setParam(v), 0.5);
  btn('fx.beat.up', 'Beat FX beat +', () => fx.stepBeats(1), () => false);
  btn('fx.beat.down', 'Beat FX beat −', () => fx.stepBeats(-1), () => false);
  reg.register({
    id: 'fx.type',
    label: 'Beat FX select',
    kind: 'encoder',
    step: (dl) => fx.setType(FX_TYPES[(FX_TYPES.indexOf(fx.type) + (dl > 0 ? 1 : FX_TYPES.length - 1)) % FX_TYPES.length]),
  });
  for (const t of FX_TYPES) btn(`fx.type.${t}`, `Beat FX ${t}`, () => fx.setType(t), () => (fx.type === t ? '#ffffff' : false));
  const targets: FxTarget[] = [1, 2, 3, 4, 'M'];
  for (const t of targets) btn(`fx.target.${t}`, `Beat FX assign ${t === 'M' ? 'master' : `ch ${t}`}`, () => fx.toggleTarget(t), () => (fx.targets.has(t) ? '#ff9f1c' : false));
  reg.register({
    id: 'fx.select',
    label: 'Beat FX channel select',
    kind: 'encoder',
    step: (dl) => {
      const cur = [...fx.targets][0] ?? 'M';
      const i = targets.indexOf(cur);
      fx.setSingleTarget(targets[(i + (dl > 0 ? 1 : targets.length - 1)) % targets.length]);
    },
  });

  for (let i = 0; i < 8; i++) {
    btn(`sampler.pad.${i + 1}`, `Sampler slot ${i + 1}`, () => engine.sampler.trigger(i), () => (engine.sampler.isPlaying(i) ? '#ffffff' : engine.sampler.slots[i].buffer ? engine.sampler.slots[i].color : false));
  }

  reg.register({ id: 'browse', label: 'Browse library', kind: 'encoder', step: (dl) => hooks.browse(dl), press: () => hooks.browsePress?.() });
  btn('screen.back', 'Screen: back', () => hooks.screenBack?.(), () => false);
  btn('browse.tag', 'Tag the selected track (favourite)', () => hooks.tagSelected?.(), () => false);
  btn('shift', 'Shift', () => (reg.shift = true), () => reg.shift, () => (reg.shift = false));
  btn('layer.L', 'Left deck layer 1/3', () => {
    reg.setLayer('L', reg.layers.L === 1 ? 3 : 1);
    hooks.layerChanged();
  }, () => (reg.layers.L === 3 ? '#3ddc97' : '#4cc9f0'));
  btn('layer.R', 'Right deck layer 2/4', () => {
    reg.setLayer('R', reg.layers.R === 2 ? 4 : 2);
    hooks.layerChanged();
  }, () => (reg.layers.R === 4 ? '#c77dff' : '#ff9f1c'));
}

function keySync(engine: AudioEngine, d: Deck): void {
  const m = engine.masterDeck;
  const mine = d.analysis?.key;
  const theirs = m && m !== d ? m.currentKey() : null;
  if (!mine || !theirs) return;
  let from = mine;
  // include tempo-induced shift when key lock is off
  if (!d.keylock) {
    const semis = Math.round(12 * Math.log2(Math.max(0.01, d.baseRate)));
    from = { ...mine, root: (((mine.root + semis) % 12) + 12) % 12 };
  }
  d.setKeyShift(keySyncShift(from, theirs));
}

