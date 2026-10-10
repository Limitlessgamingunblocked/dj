import { describe, expect, it } from 'vitest';
import { ControlRegistry } from '../src/core/controls';
import { blockControl, MidiManager, mirrorControl, padOf, relValue, type MidiMapping } from '../src/midi/MidiManager';
import { finalize, isRev5, looksRelative, readStep, SETUP_STEPS, takenBy, type Learned, type RawMsg, type SetupStep } from '../src/midi/controllerSetup';

/*
 * A pretend board laid out the way Pioneer boards usually are: deck n on MIDI
 * channel n (decks 3 and 4 two channels on), the pads on channels of their
 * own, 14-bit faders and knobs (CC n coarse, CC n+32 fine), a 64-centred jog
 * and a two's-complement browse knob. The setup has to work all of that out
 * from what each step hears.
 */
const DEV = 'DDJ-REV5';
const deckCh = { L: 0, R: 1 } as const;
const padCh = { L: 7, R: 9 } as const;
const FX = 6;

let t = 0;
const msg = (type: RawMsg['type'], channel: number, number: number, value: number, on = false): RawMsg => ({ device: DEV, type, channel, number, value, on, t: (t += 8) });
const press = (ch: number, n: number) => [msg('note', ch, n, 127, true), msg('note', ch, n, 0)];
/** a 14-bit sweep: coarse then fine for every step */
const sweep = (ch: number, cc: number, from: number, to: number, fine = true) => {
  const out: RawMsg[] = [];
  const dir = Math.sign(to - from) || 1;
  for (let v = from; v !== to + dir; v += dir) {
    out.push(msg('cc', ch, cc, v));
    if (fine) out.push(msg('cc', ch, cc + 32, (v * 37) % 128));
  }
  return out;
};
const spin = (ch: number, cc: number, n: number, speed = 3) => Array.from({ length: n }, () => msg('cc', ch, cc, 64 + speed));

/** what touching each control sends on the pretend board */
function board(step: SetupStep): RawMsg[] {
  const s = step.id.startsWith('R.') || step.id.startsWith('2.') ? 'R' : 'L';
  const d = deckCh[s];
  switch (step.id.replace(/^[LR12]\./, '')) {
    case 'play':
      return press(d, 0x0b);
    case 'cue':
      return step.id.includes('.') && /^[12]\./.test(step.id) ? press(d, 0x54) : press(d, 0x0c);
    case 'sync':
      return press(d, 0x58);
    case 'jogRing':
      return spin(d, 0x21, 20);
    case 'jogTop': {
      // 512 ticks a turn: 128 messages of 4
      return [msg('note', d, 0x36, 127, true), ...spin(d, 0x22, 128, 4), msg('note', d, 0x36, 0)];
    }
    case 'tempo':
      // + is at the bottom on Pioneer boards: up to −, then down to +
      return [...sweep(d, 0x00, 64, 127), ...sweep(d, 0x00, 127, 0)];
    case 'fader':
      return sweep(d, 0x13, 0, 127);
    case 'trim':
      return sweep(d, 0x04, 0, 127);
    case 'hi':
      return sweep(d, 0x07, 127, 0);
    case 'mid':
      return sweep(d, 0x0b, 0, 127);
    case 'low':
      return sweep(d, 0x0f, 0, 127);
    case 'filter':
      return sweep(FX, s === 'L' ? 0x17 : 0x18, 0, 127);
    case 'pad1':
      return press(padCh[s], 0x00);
    case 'pad8':
      return press(padCh[s], 0x07);
    case 'load':
      return press(FX, s === 'L' ? 0x46 : 0x47);
    case 'mode.hotcue':
      return press(d, 0x1b);
    case 'mode.roll':
      return press(d, 0x1e);
    case 'mode.sampler':
      return press(d, 0x22);
  }
  switch (step.id) {
    case 'xfader':
      return sweep(FX, 0x1f, 0, 127);
    case 'browse':
      return [msg('cc', FX, 0x40, 1), msg('cc', FX, 0x40, 1), msg('cc', FX, 0x40, 127), msg('cc', FX, 0x40, 1)];
    case 'browse.push':
      return press(FX, 0x41);
    case 'deck3':
      return press(2, 0x0b);
    case 'deck3pad':
      return press(8, 0x00);
  }
  return []; // a pad mode this board doesn't have: skipped
}

/** run the wizard the way the UI does: after every message, then once more after a pause */
function runWizard(touch: (s: SetupStep) => RawMsg[] = board): Learned {
  const learned: Learned = {};
  for (const step of SETUP_STEPS) {
    if (step.needs && (!learned[step.needs] || learned[step.needs] === 'skipped')) {
      learned[step.id] = 'skipped';
      continue;
    }
    const all = touch(step);
    const heard: RawMsg[] = [];
    let got = null;
    for (const m of all) {
      heard.push(m);
      got = readStep(step, heard, { taken: takenBy(learned), learned, now: m.t });
      if (got) break;
    }
    if (!got && heard.length) got = readStep(step, heard, { taken: takenBy(learned), learned, now: t + 2000 });
    learned[step.id] = got ?? 'skipped';
  }
  return learned;
}

const find = (maps: MidiMapping[], control: string) => maps.filter((m) => m.control === control);

describe('the controller setup', () => {
  it('recognises the REV5 by its port name', () => {
    expect(isRev5('DDJ-REV5')).toBe(true);
    expect(isRev5('PIONEER DDJ-REV5 MIDI 1')).toBe(true);
    expect(isRev5('DDJ REV5')).toBe(true);
    expect(isRev5('DDJ-REV7')).toBe(false);
    expect(isRev5('DDJ-FLX4')).toBe(false);
  });

  it('tells jog and encoder streams from fader sweeps', () => {
    expect(looksRelative([65, 66, 67, 66, 65])).toBe(true);
    expect(looksRelative([62, 61, 60])).toBe(true);
    expect(looksRelative([1, 1, 2, 127, 126])).toBe(true);
    expect(looksRelative([0, 10, 30, 64, 90, 127])).toBe(false);
    expect(looksRelative([60, 62, 64, 66])).toBe(false);
  });

  it('learns every control from one touch each', () => {
    const learned = runWizard();
    const skipped = Object.entries(learned)
      .filter(([, r]) => r === 'skipped')
      .map(([id]) => id);
    // only the pad modes this board doesn't have
    expect(skipped.sort()).toEqual(['L.mode.jump', 'L.mode.pitch', 'L.mode.slicer']);
    const { mappings, guessed } = finalize(learned, DEV);
    expect(mappings.every((m) => m.device === DEV && m.profile === 'DDJ-REV5')).toBe(true);

    expect(find(mappings, 'deck.L.play')[0]).toMatchObject({ type: 'note', channel: 0, number: 0x0b, mode: 'button' });
    expect(find(mappings, 'deck.R.play')[0]).toMatchObject({ type: 'note', channel: 1, number: 0x0b });
    expect(find(mappings, 'ch.1.cue')[0]).toMatchObject({ number: 0x54, channel: 0 });

    // 14-bit faders, and the tempo fader runs + at the bottom
    expect(find(mappings, 'ch.1.fader')[0]).toMatchObject({ type: 'cc', number: 0x13, fine: true, mode: 'absolute' });
    expect(find(mappings, 'deck.L.tempo')[0]).toMatchObject({ number: 0x00, fine: true, invert: true });
    expect(find(mappings, 'mixer.xfader')[0]).toMatchObject({ channel: FX, number: 0x1f, fine: true });
    expect(find(mappings, 'ch.2.filter')[0]).toMatchObject({ channel: FX, number: 0x18 });

    // the jog: edge, top, touch, and 512 ticks a turn on both its CCs
    const jog = find(mappings, 'deck.L.jog');
    expect(jog.map((m) => `${m.type}${m.number}`).sort()).toEqual(['cc33', 'cc34', 'note54']);
    expect(jog.filter((m) => m.type === 'cc').every((m) => m.ticks === 512)).toBe(true);

    // pads: a block of eight that repeats every 16 notes (every pad mode), decks 3/4 one channel on
    const pads = find(mappings, 'deck.L.pad.1');
    expect(pads).toHaveLength(1);
    expect(pads[0]).toMatchObject({ channel: 7, number: 0, block: 8, stride: 16, mirror: 1 });
    expect(find(mappings, 'deck.L.pad.8')).toHaveLength(0);

    // deck controls (and the mixer channel on the same MIDI channel) follow decks 3/4
    expect(find(mappings, 'deck.L.play')[0].mirror).toBe(2);
    expect(find(mappings, 'ch.1.fader')[0].mirror).toBe(2);
    expect(find(mappings, 'mixer.xfader')[0].mirror).toBeUndefined();
    expect(find(mappings, 'deck.L.load')[0].mirror).toBeUndefined();

    // the right deck's pad modes come from the left one's
    expect(find(mappings, 'deck.R.padmode.hotcue')[0]).toMatchObject({ channel: 1, number: 0x1b });
    expect(guessed).toContain('deck.R.padmode.roll');
    expect(find(mappings, 'browse').map((m) => m.mode).sort()).toEqual(['button', 'relative']);
  });

  it('fills a skipped right-hand control from the left, on the deck channels only', () => {
    const learned = runWizard((s) => (s.id === 'R.sync' || s.id === '2.filter' ? [] : board(s)));
    const { mappings, guessed } = finalize(learned, DEV);
    expect(find(mappings, 'deck.R.sync')[0]).toMatchObject({ channel: 1, number: 0x58 });
    expect(guessed).toContain('deck.R.sync');
    // the filter knobs sit on a shared channel: no guess
    expect(find(mappings, 'ch.2.filter')).toHaveLength(0);
  });

  it('a tempo fader left in the middle is not finished yet', () => {
    const step = SETUP_STEPS.find((s) => s.id === 'L.tempo')!;
    const heard = [...sweep(0, 0, 64, 127), ...sweep(0, 0, 127, 60)];
    expect(readStep(step, heard, { taken: new Set(), learned: {}, now: t + 2000 })).toBeNull();
    // and + at the top: not inverted
    const up = [...sweep(0, 0, 64, 0), ...sweep(0, 0, 0, 127)];
    expect(readStep(step, up, { taken: new Set(), learned: {}, now: t + 2000 })?.maps[0].invert).toBeUndefined();
  });

  it('skips the messages earlier steps took', () => {
    const learned = runWizard();
    const step = SETUP_STEPS.find((s) => s.id === 'R.cue')!;
    // pressing the left PLAY again by mistake is ignored
    expect(readStep(step, press(0, 0x0b), { taken: takenBy(learned, 'R.cue'), learned, now: t })).toBeNull();
  });
});

describe('the MIDI engine', () => {
  const helpers = () => {
    expect(relValue(65)).toBe(1);
    expect(relValue(63)).toBe(-1);
    expect(relValue(1)).toBe(1);
    expect(relValue(127)).toBe(-1);
    expect(padOf({ number: 0, block: 8, stride: 16 }, 0x13)).toBe(3);
    expect(padOf({ number: 0, block: 8, stride: 16 }, 0x0a)).toBe(-1);
    expect(padOf({ number: 4, block: 8 }, 3)).toBe(-1);
    expect(blockControl('deck.L.pad.1', 5)).toBe('deck.L.pad.6');
    expect(mirrorControl('ch.2.fader', 2)).toBe('ch.4.fader');
    expect(mirrorControl('deck.L.play', 2)).toBe('deck.L.play');
  };
  it('helpers', helpers);

  function rig() {
    const reg = new ControlRegistry();
    const log: string[] = [];
    const vals: Record<string, number> = {};
    for (const n of [1, 2, 3, 4]) {
      reg.register({ id: `deck.${n}.play`, label: '', kind: 'button', press: () => log.push(`play${n}`) });
      for (let p = 1; p <= 8; p++) reg.register({ id: `deck.${n}.pad.${p}`, label: '', kind: 'button', press: () => log.push(`d${n}pad${p}`) });
      reg.register({ id: `deck.${n}.tempo`, label: '', kind: 'continuous', get: () => vals[`t${n}`] ?? 0.5, set: (v) => (vals[`t${n}`] = v), def: 0.5 });
      reg.register({ id: `ch.${n}.fader`, label: '', kind: 'continuous', get: () => vals[`f${n}`] ?? 0, set: (v) => (vals[`f${n}`] = v), def: 0 });
      reg.register({ id: `deck.${n}.jog`, label: '', kind: 'jog', touch: (z) => log.push(`touch${n}:${z}`), turn: (r, z) => log.push(`turn${n}:${r.toFixed(4)}:${z}`), angle: () => 0, touched: () => false });
    }
    const midi = new MidiManager(reg);
    const map = (m: Partial<MidiMapping>): MidiMapping => ({ device: DEV, type: 'note', channel: 0, number: 0, control: '', mode: 'button', ...m }) as MidiMapping;
    midi.setProfile(DEV, [
      map({ number: 0x0b, control: 'deck.L.play', mirror: 2 }),
      map({ channel: 1, number: 0x0b, control: 'deck.R.play', mirror: 2 }),
      map({ channel: 7, number: 0, control: 'deck.L.pad.1', block: 8, stride: 16, mirror: 1 }),
      map({ type: 'cc', number: 0x13, control: 'ch.1.fader', mode: 'absolute', fine: true, mirror: 2 }),
      map({ type: 'cc', number: 0x00, control: 'deck.L.tempo', mode: 'absolute', fine: true, invert: true, mirror: 2 }),
      map({ type: 'cc', number: 0x21, control: 'deck.L.jog', mode: 'jog', ticks: 512, mirror: 2 }),
      map({ number: 0x36, control: 'deck.L.jog', mode: 'jog', mirror: 2 }),
    ]);
    const send = (...bytes: number[]) => (midi as unknown as { onMessage(d: string, b: Uint8Array): void }).onMessage(DEV, new Uint8Array(bytes));
    return { reg, midi, log, vals, send };
  }

  it('plays pads in every pad mode, but not shifted ones', () => {
    const { log, send } = rig();
    send(0x97, 0x00, 127); // hot cue pad 1
    send(0x97, 0x13, 127); // the next mode's pad 4
    send(0x97, 0x0a, 127); // shift + pad 3: not ours
    expect(log).toEqual(['d1pad1', 'd1pad4']);
  });

  it('reads 14-bit faders and inverted tempo faders', () => {
    const { vals, send } = rig();
    send(0xb0, 0x13, 64);
    expect(vals.f1).toBeCloseTo((64 * 128) / 16383, 4);
    send(0xb0, 0x13 + 32, 127);
    expect(vals.f1).toBeCloseTo((64 * 128 + 127) / 16383, 4);
    send(0xb0, 0x00, 0);
    send(0xb0, 0x20, 0);
    expect(vals.t1).toBeCloseTo(1, 4); // pushed to the top… which is + on this mapping's flip
  });

  it('follows the hardware onto decks 3 and 4 and back', () => {
    const { reg, log, vals, send } = rig();
    send(0x92, 0x0b, 127); // deck 3's PLAY
    expect(reg.layers.L).toBe(3);
    send(0x98, 0x02, 127); // deck 3's pad 3
    send(0xb2, 0x13, 127); // channel 3's fader
    expect(vals.f3).toBeGreaterThan(0.99);
    send(0x90, 0x0b, 127); // back on deck 1
    expect(reg.layers.L).toBe(1);
    send(0x93, 0x0b, 127); // deck 4
    expect(reg.layers.R).toBe(4);
    expect(log).toEqual(['play3', 'd3pad3', 'play1', 'play4']);
  });

  it('turns the jog by the measured ticks, scratching while touched', () => {
    const { log, send } = rig();
    send(0xb0, 0x21, 64 + 128 / 8); // 16 ticks of 512
    send(0x90, 0x36, 127);
    send(0xb0, 0x21, 64 - 16);
    expect(log).toEqual(['turn1:0.0313:ring', 'touch1:top', 'turn1:-0.0313:top']);
  });

  it('stays quiet while the setup is listening, but still reports what it hears', () => {
    const { midi, log, send } = rig();
    const heard: number[] = [];
    midi.on('raw', (m) => heard.push(m.number));
    midi.capturing = true;
    send(0x90, 0x0b, 127);
    expect(log).toEqual([]);
    expect(heard).toEqual([0x0b]);
  });
});
