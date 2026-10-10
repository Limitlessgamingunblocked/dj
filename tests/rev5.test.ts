import { describe, expect, it } from 'vitest';
import { ControlRegistry } from '../src/core/controls';
import { MidiManager } from '../src/midi/MidiManager';
import { presetFor, REV5_JOG_TICKS, rev5Preset } from '../src/midi/rev5';

/*
 * The DDJ-REV5's built-in mapping, fed the messages AlphaTheta's "DDJ-REV5
 * List of MIDI Messages" says the board sends.
 */
const DEV = 'DDJ-REV5';
const MODES = ['hotcue', 'roll', 'slicer', 'jump', 'pitch', 'sampler'];

function rig() {
  const reg = new ControlRegistry();
  const log: string[] = [];
  const vals: Record<string, number> = {};
  const state: Record<string, boolean> = {};
  const mode: Record<number, string> = { 1: 'hotcue', 2: 'hotcue', 3: 'hotcue', 4: 'hotcue' };
  const btn = (id: string) => reg.register({ id, label: id, kind: 'button', press: () => log.push(id), release: () => log.push(`${id} up`), lit: () => !!state[id] });
  const knob = (id: string) => reg.register({ id, label: id, kind: 'continuous', get: () => vals[id] ?? 0, set: (v) => (vals[id] = v), def: 0 });
  for (const n of [1, 2, 3, 4]) {
    const d = `deck.${n}.`;
    for (const b of ['play', 'cue', 'sync', 'keylock', 'range', 'loop.auto', 'loop.half', 'loop.double', 'slip', 'censor', 'key.down', 'key.up', 'param.down', 'param.up', 'load']) btn(d + b);
    for (let p = 1; p <= 8; p++) btn(`${d}pad.${p}`), btn(`${d}hotcue.${p}`);
    for (const s of ['vocal', 'melody', 'bass', 'drums']) btn(`${d}stem.${s}.mute`);
    for (const m of MODES) reg.register({ id: `${d}padmode.${m}`, label: '', kind: 'button', press: () => (log.push(`${d}padmode.${m}`), (mode[n] = m)), lit: () => mode[n] === m });
    knob(d + 'tempo');
    let angle = 0;
    reg.register({ id: d + 'jog', label: '', kind: 'jog', touch: (z) => log.push(`${d}jog touch ${z}`), turn: (r, z) => (log.push(`${d}jog ${r.toFixed(5)} ${z}`), (angle += r * Math.PI * 2)), angle: () => angle, touched: () => false });
    for (const k of ['trim', 'hi', 'mid', 'low', 'fader', 'filter']) knob(`ch.${n}.${k}`);
    btn(`ch.${n}.cue`);
    btn(`fx.paddle.${n}`);
  }
  for (const k of ['xfader', 'xcurve', 'master', 'booth', 'sampler', 'phones', 'cuemix']) knob(`mixer.${k}`);
  for (const k of ['mic.1.level', 'mic.2.level', 'mic.hi', 'mic.low', 'aux.trim', 'fx.depth']) knob(k);
  reg.register({ id: 'mixer.hamster', label: '', kind: 'button', press: () => (state['mixer.hamster'] = !state['mixer.hamster']), lit: () => !!state['mixer.hamster'] });
  reg.register({ id: 'browse', label: '', kind: 'encoder', step: (dl) => log.push(`browse ${dl}`), press: () => log.push('browse press') });
  for (const b of ['screen.back', 'shift', 'fx.beat.up', 'fx.beat.down', 'fx.type.echo', 'fx.type.reverb', 'fx.type.flanger', 'fx.type.pingpong', 'fx.type.phaser', 'fx.type.gate']) btn(b);
  for (let p = 1; p <= 8; p++) btn(`sampler.pad.${p}`);
  const midi = new MidiManager(reg);
  midi.setProfile(DEV, rev5Preset(DEV));
  const send = (...bytes: number[]) => (midi as unknown as { onMessage(d: string, b: Uint8Array): void }).onMessage(DEV, new Uint8Array(bytes));
  const take = () => log.splice(0);
  return { reg, midi, log, vals, state, mode, send, take };
}

describe('the DDJ-REV5 built-in mapping', () => {
  it('is only for the REV5', () => {
    expect(presetFor('DDJ-REV5')).not.toBeNull();
    expect(presetFor('DDJ-FLX4')).toBeNull();
    const all = rev5Preset(DEV);
    expect(all.every((m) => m.device === DEV && m.profile === 'DDJ-REV5')).toBe(true);
    // one mapping per message (an exact one may sit inside a pad block)
    const keys = all.filter((m) => !m.block).map((m) => `${m.type}|${m.channel}|${m.number}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('plays the transport on decks 1 and 2', () => {
    const { send, take } = rig();
    send(0x90, 0x0b, 0x7f);
    send(0x90, 0x0b, 0x00);
    send(0x90, 0x0a, 0x7f); // BEAT SYNC is note 10
    send(0x91, 0x0c, 0x7f);
    send(0x91, 0x0c, 0x00);
    send(0x90, 0x29, 0x7f); // CENSOR
    expect(take()).toEqual(['deck.1.play', 'deck.1.play up', 'deck.1.sync', 'deck.2.cue', 'deck.2.cue up', 'deck.1.censor']);
  });

  it('follows DECK 1/3 and 2/4, whichever order the board reports them in', () => {
    const { reg, send, take } = rig();
    // DECK 1/3 pressed on deck 1: "deck 1 off", then "deck 3 on"
    send(0x92, 0x06, 0x7f);
    send(0x90, 0x3e, 0x00);
    send(0x92, 0x3e, 0x7f);
    expect(reg.layers.L).toBe(3);
    send(0x92, 0x0b, 0x7f); // deck 3's PLAY
    send(0x92, 0x07, 0x7f); // channel 3's headphone cue
    send(0xb2, 0x13, 0x7f); // channel 3's fader
    // and back: "deck 1 on", then "deck 3 off"
    send(0x92, 0x06, 0x7f);
    send(0x90, 0x3e, 0x7f);
    send(0x92, 0x3e, 0x00);
    expect(reg.layers.L).toBe(1);
    send(0x93, 0x3e, 0x7f); // the right side onto deck 4
    expect(reg.layers.R).toBe(4);
    expect(take()).toEqual(['deck.3.play', 'ch.3.cue']);
  });

  it('plays the pads in every pad mode, and the deck follows the board’s mode', () => {
    const { send, take, mode } = rig();
    send(0x97, 0x00, 0x7f); // hot cue mode, pad 1
    send(0x97, 0x13, 0x7f); // roll mode, pad 4
    expect(mode[1]).toBe('roll');
    send(0x97, 0x21, 0x7f); // saved loop mode, pad 2: beat jump
    send(0x97, 0x76, 0x7f); // scratch bank mode, pad 7: slicer
    send(0x97, 0x09, 0x7f); // a user mode, pad 2: the mode the deck is in
    send(0x98, 0x00, 0x7f); // SHIFT + pad 1: not mapped
    expect(take()).toEqual(['deck.1.pad.1', 'deck.1.padmode.roll', 'deck.1.pad.4', 'deck.1.padmode.jump', 'deck.1.pad.2', 'deck.1.padmode.slicer', 'deck.1.pad.7', 'deck.1.pad.2']);
  });

  it('gives the deck pads their own jobs: hot cues, the sampler, stems', () => {
    const { send, take, mode } = rig();
    send(0x97, 0x10, 0x7f); // roll mode first
    take();
    send(0x97, 0x49, 0x7f); // deck pad 2, hot cue mode: a hot cue whatever the deck's pad mode
    send(0x99, 0x7a, 0x7f); // right deck pad 3, sampler mode
    send(0x97, 0x60, 0x7f); // performance pad 1 in stems mode
    send(0x90, 0x2f, 0x7f); // deck pad 4 in stems mode
    expect(take()).toEqual(['deck.1.hotcue.2', 'sampler.pad.3', 'deck.1.stem.vocal.mute', 'deck.1.stem.drums.mute']);
    expect(mode[1]).toBe('roll');
  });

  it('pads from decks 3 and 4 arrive four channels on', () => {
    const { reg, send, take } = rig();
    send(0x9b, 0x01, 0x7f);
    expect(reg.layers.L).toBe(3);
    send(0x9d, 0x00, 0x7f);
    expect(reg.layers.R).toBe(4);
    expect(take()).toEqual(['deck.3.pad.2', 'deck.4.pad.1']);
  });

  it('scratches with the top, nudges with the side (and with the top in vinyl-off mode)', () => {
    const { send, take } = rig();
    const t = (1 / REV5_JOG_TICKS).toFixed(5);
    send(0x90, 0x0d, 0x7f);
    send(0xb0, 0x22, 0x41);
    send(0xb0, 0x23, 0x41);
    send(0x90, 0x0d, 0x00);
    send(0xb0, 0x21, 0x3f);
    expect(take()).toEqual(['deck.1.jog touch top', `deck.1.jog ${t} top`, `deck.1.jog ${t} ring`, 'deck.1.jog touch null', `deck.1.jog -${t} ring`]);
  });

  it('reads the 14-bit tempo fader with + at the top of the range, and the mixer', () => {
    const { send, vals } = rig();
    send(0xb0, 0x00, 0x7f);
    send(0xb0, 0x20, 0x7f);
    expect(vals['deck.1.tempo']).toBe(1);
    send(0xb6, 0x18, 0x40);
    send(0xb6, 0x38, 0x00);
    expect(vals['ch.2.filter']).toBeCloseTo(0.5, 2);
    send(0xb6, 0x1f, 0x00);
    expect(vals['mixer.xfader']).toBe(0);
    send(0xb6, 0x0c, 0x7f);
    expect(vals['mixer.cuemix']).toBeCloseTo(127 / 128, 2);
    send(0xb5, 0x04, 0x7f); // FX2 LEVEL/DEPTH
    expect(vals['fx.depth']).toBeGreaterThan(0.99);
  });

  it('keeps the crossfader reverse switch where the switch is', () => {
    const { send, state } = rig();
    send(0x96, 0x54, 0x7f);
    send(0x96, 0x54, 0x7f);
    expect(state['mixer.hamster']).toBe(true);
    send(0x96, 0x54, 0x00);
    expect(state['mixer.hamster']).toBe(false);
  });

  it('browses, loads per deck, and works the FX paddles and PARAMETER buttons', () => {
    const { send, take } = rig();
    send(0xb6, 0x40, 0x01);
    send(0xb6, 0x40, 0x7f);
    send(0x96, 0x41, 0x7f);
    send(0x96, 0x48, 0x7f); // LOAD with the left side on deck 3
    send(0x94, 0x50, 0x7f);
    send(0x94, 0x50, 0x00);
    send(0x95, 0x51, 0x7f); // FX2's paddle on channel 4
    send(0x91, 0x61, 0x7f); // PARAMETER ◀ in roll mode
    send(0x91, 0x70, 0x7f); // PARAMETER ▶ in hot cue mode
    expect(take()).toEqual(['browse 1', 'browse -1', 'browse press', 'deck.3.load', 'fx.paddle.1', 'fx.paddle.1 up', 'fx.paddle.4', 'deck.2.param.down', 'deck.2.param.up']);
  });

  it('lights the buttons on the deck each side is on, and the jog ring', () => {
    const { reg, midi, state, send } = rig();
    const sent: number[][] = [];
    midi.access = { outputs: new Map([['o', { name: DEV, send: (b: number[]) => sent.push([...b]) }]]) } as unknown as MIDIAccess;
    state['deck.1.play'] = true;
    midi.updateLeds();
    expect(sent).toContainEqual([0x90, 0x0b, 0x7f]);
    expect(sent.some((b) => b[0] === 0xb0 && b[1] === 0x1e && b[2] >= 1 && b[2] <= 72)).toBe(true);
    // on deck 3 the left side's lights go to channel 3
    sent.length = 0;
    reg.setLayer('L', 3);
    state['deck.3.play'] = true;
    midi.updateLeds();
    expect(sent).toContainEqual([0x92, 0x0b, 0x7f]);
    // the ring moves with the record
    sent.length = 0;
    for (let i = 0; i < 20; i++) send(0xb2, 0x21, 0x50);
    midi.updateLeds();
    expect(sent.some((b) => b[0] === 0xb2 && b[1] === 0x1e)).toBe(true);
  });
});
