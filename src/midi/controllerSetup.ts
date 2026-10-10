/*
 * The controller setup: a guided walk round the board ("press PLAY on the
 * left deck", "move the crossfader"…). Each step listens to what the hardware
 * sends while you touch that one control and works out the mapping itself:
 * which message, whether a fader is 14-bit, which way the tempo fader runs,
 * how many ticks a jog sends per turn, where the pads sit and which MIDI
 * channels decks 3 and 4 use.
 *
 * Written for the Pioneer DDJ-REV5 (its button names are in the hints), but
 * nothing here depends on a particular message layout, so it works on other
 * boards too. Pure: the wizard (ui/ControllerSetup.ts) feeds it messages.
 */
import { relValue, type MidiMapping } from './MidiManager';

export interface RawMsg {
  device: string;
  type: 'note' | 'cc' | 'pitch';
  channel: number;
  number: number;
  /** 0–127; pitch bend 0–16383 */
  value: number;
  on: boolean;
  /** ms */
  t: number;
}

export type StepKind = 'button' | 'fader' | 'tempo' | 'jogRing' | 'jogTop' | 'encoder' | 'deck3' | 'deck3pad';

export interface SetupStep {
  id: string;
  group: string;
  title: string;
  hint: string;
  kind: StepKind;
  control: string;
  optional?: boolean;
  /** a step that only makes sense once another one was learned */
  needs?: string;
}

export interface StepResult {
  maps: Omit<MidiMapping, 'device'>[];
  /** jog ticks per full turn */
  ticks?: number;
  /** how many MIDI channels on deck 3 sits from deck 1 */
  mirror?: number;
  /** what was heard, for the player */
  said: string;
}

export type Learned = Record<string, StepResult | 'skipped'>;

export interface StepContext {
  /** messages earlier steps already claimed ("type|channel|number") */
  taken: Set<string>;
  learned: Learned;
  now: number;
}

export const SETUP_PROFILE = 'DDJ-REV5';

export function isRev5(device: string): boolean {
  return /DDJ[\s-]*REV\s*5/i.test(device);
}

export function profileName(device: string): string {
  return isRev5(device) ? SETUP_PROFILE : device;
}

/* ------------------------------------------------------------------ */
/* the steps                                                            */
/* ------------------------------------------------------------------ */

const deckSteps = (s: 'L' | 'R'): SetupStep[] => {
  const side = s === 'L' ? 'left' : 'right';
  const g = s === 'L' ? 'Left deck' : 'Right deck';
  const d = `deck.${s}.`;
  return [
    { id: `${s}.play`, group: g, title: 'PLAY/PAUSE', hint: `Press PLAY/PAUSE on the ${side} deck.`, kind: 'button', control: d + 'play' },
    { id: `${s}.cue`, group: g, title: 'CUE', hint: `Press CUE on the ${side} deck.`, kind: 'button', control: d + 'cue' },
    { id: `${s}.sync`, group: g, title: 'BEAT SYNC', hint: `Press BEAT SYNC on the ${side} deck.`, kind: 'button', control: d + 'sync' },
    { id: `${s}.jogRing`, group: g, title: 'Jog wheel, outer edge', hint: `Turn the ${side} jog wheel by its outer edge, without touching the top.`, kind: 'jogRing', control: d + 'jog' },
    {
      id: `${s}.jogTop`,
      group: g,
      title: 'Jog wheel, top',
      hint: `Rest a finger on top of the ${side} jog, turn it once all the way round (use the marker), then let go.`,
      kind: 'jogTop',
      control: d + 'jog',
      optional: true,
    },
    { id: `${s}.tempo`, group: g, title: 'TEMPO fader', hint: `Slide the ${side} TEMPO fader all the way to its − end, then all the way to its + end, and let go.`, kind: 'tempo', control: d + 'tempo' },
  ];
};

const channelKnobs = (n: 1 | 2): SetupStep[] => {
  const which = n === 1 ? 'channel 1 (left)' : 'channel 2 (right)';
  const c = `ch.${n}.`;
  const knob = (k: string, name: string, extra = ''): SetupStep => ({ id: `${n}.${k}`, group: 'Mixer', title: `Channel ${n} ${name}`, hint: `Turn the ${which} ${name} knob all the way round${extra}.`, kind: 'fader', control: c + k });
  return [knob('trim', 'TRIM'), knob('hi', 'HI'), knob('mid', 'MID'), knob('low', 'LOW'), knob('filter', 'CFX / FILTER', ', under the EQs')];
};

const PAD_MODE_BUTTONS: [string, string][] = [
  ['hotcue', 'HOT CUE'],
  ['roll', 'ROLL'],
  ['slicer', 'SLICER'],
  ['jump', 'BEAT JUMP'],
  ['pitch', 'KEYBOARD / PITCH PLAY'],
  ['sampler', 'SAMPLER'],
];

export const SETUP_STEPS: SetupStep[] = [
  ...deckSteps('L'),
  ...deckSteps('R'),
  { id: '1.fader', group: 'Mixer', title: 'Channel 1 fader', hint: 'Move the channel 1 (left) fader all the way up and down.', kind: 'fader', control: 'ch.1.fader' },
  { id: '2.fader', group: 'Mixer', title: 'Channel 2 fader', hint: 'Move the channel 2 (right) fader all the way up and down.', kind: 'fader', control: 'ch.2.fader' },
  { id: 'xfader', group: 'Mixer', title: 'Crossfader', hint: 'Move the crossfader from one side to the other.', kind: 'fader', control: 'mixer.xfader' },
  ...channelKnobs(1),
  ...channelKnobs(2),
  { id: '1.cue', group: 'Mixer', title: 'Channel 1 headphone CUE', hint: 'Press the headphone CUE button on channel 1.', kind: 'button', control: 'ch.1.cue' },
  { id: '2.cue', group: 'Mixer', title: 'Channel 2 headphone CUE', hint: 'Press the headphone CUE button on channel 2.', kind: 'button', control: 'ch.2.cue' },
  { id: 'L.pad1', group: 'Pads', title: 'Left pad 1', hint: 'Press pad 1 on the left deck (top row, far left).', kind: 'button', control: 'deck.L.pad.1' },
  { id: 'L.pad8', group: 'Pads', title: 'Left pad 8', hint: 'Press pad 8 on the left deck (bottom row, far right).', kind: 'button', control: 'deck.L.pad.8', needs: 'L.pad1' },
  { id: 'R.pad1', group: 'Pads', title: 'Right pad 1', hint: 'Press pad 1 on the right deck (top row, far left).', kind: 'button', control: 'deck.R.pad.1' },
  { id: 'R.pad8', group: 'Pads', title: 'Right pad 8', hint: 'Press pad 8 on the right deck (bottom row, far right).', kind: 'button', control: 'deck.R.pad.8', needs: 'R.pad1' },
  ...PAD_MODE_BUTTONS.map(
    ([m, name]): SetupStep => ({
      id: `L.mode.${m}`,
      group: 'Pad modes',
      title: `${name} pad mode`,
      hint: `Press the ${name} pad-mode button on the left deck. Skip it if your board doesn't have one; the right deck is worked out from the left.`,
      kind: 'button',
      control: `deck.L.padmode.${m}`,
      optional: true,
    }),
  ),
  { id: 'browse', group: 'Browse', title: 'Browse knob', hint: 'Turn the big BROWSE (rotary selector) knob a few clicks.', kind: 'encoder', control: 'browse' },
  { id: 'browse.push', group: 'Browse', title: 'Browse knob push', hint: 'Push the BROWSE knob down.', kind: 'button', control: 'browse', optional: true },
  { id: 'L.load', group: 'Browse', title: 'LOAD left', hint: 'Press LOAD for the left deck.', kind: 'button', control: 'deck.L.load' },
  { id: 'R.load', group: 'Browse', title: 'LOAD right', hint: 'Press LOAD for the right deck.', kind: 'button', control: 'deck.R.load' },
  {
    id: 'deck3',
    group: 'Decks 3 and 4',
    title: 'Deck 3',
    hint: 'If your board can switch the left side to deck 3, switch it now and press PLAY/PAUSE. Only using two decks? Skip this.',
    kind: 'deck3',
    control: 'deck.L.play',
    optional: true,
    needs: 'L.play',
  },
  { id: 'deck3pad', group: 'Decks 3 and 4', title: 'Deck 3 pads', hint: 'Still on deck 3: press pad 1. Then switch back to deck 1.', kind: 'deck3pad', control: 'deck.L.pad.1', optional: true, needs: 'deck3' },
];

/* ------------------------------------------------------------------ */
/* reading what one step heard                                          */
/* ------------------------------------------------------------------ */

export const msgKey = (m: { type: string; channel: number; number: number }): string => `${m.type}|${m.channel}|${m.number}`;

export function describe(m: Pick<MidiMapping, 'type' | 'channel' | 'number'> & { fine?: boolean }): string {
  if (m.type === 'pitch') return `pitch bend, channel ${m.channel + 1}`;
  return `${m.type === 'note' ? 'note' : 'CC'} ${m.number}, channel ${m.channel + 1}${m.fine ? ' (14-bit)' : ''}`;
}

/** the 7-bit value of a message (pitch bend scaled down) */
const v7 = (m: RawMsg) => (m.type === 'pitch' ? m.value / 128 : m.value);

/** the fine half of a 14-bit fader we already know (CC n+32 next to a taken CC n) */
function isFineHalf(m: RawMsg, taken: Set<string>): boolean {
  return m.type === 'cc' && m.number >= 32 && taken.has(msgKey({ ...m, number: m.number - 32 }));
}

function groupBy(msgs: RawMsg[]): Map<string, RawMsg[]> {
  const g = new Map<string, RawMsg[]>();
  for (const m of msgs) {
    const k = msgKey(m);
    const list = g.get(k);
    if (list) list.push(m);
    else g.set(k, [m]);
  }
  return g;
}

/**
 * a run of values from a jog or an endless encoder rather than a fader's
 * sweep: they stay in a band round 64 (never 64 itself, which would be "no
 * movement") or near the two ends (two's complement)
 */
export function looksRelative(values: number[]): boolean {
  if (!values.length) return false;
  const centred = values.every((v) => v >= 24 && v <= 104 && v !== 64);
  const twos = values.every((v) => (v >= 1 && v <= 40) || (v >= 88 && v <= 127));
  return centred || twos;
}

interface Sweep {
  first: RawMsg;
  last: RawMsg;
  range: number;
  fine: boolean;
}

/** the absolute control that moved furthest: a fader or a knob */
function bestSweep(msgs: RawMsg[]): Sweep | null {
  let best: Sweep | null = null;
  const groups = groupBy(msgs.filter((m) => m.type === 'cc' || m.type === 'pitch'));
  for (const list of groups.values()) {
    const m0 = list[0];
    // the fine half of the one being moved: CC n+32 when CC n is moving too
    if (m0.type === 'cc' && m0.number >= 32 && groups.has(msgKey({ ...m0, number: m0.number - 32 }))) continue;
    if (m0.type === 'cc' && looksRelative(list.map((m) => m.value))) continue;
    const vals = list.map(v7);
    // a sweep passes through the middle (an encoder's 1 / 127 doesn't)
    if (!vals.some((v) => v >= 24 && v <= 103)) continue;
    const range = Math.max(...vals) - Math.min(...vals);
    if (!best || range > best.range) best = { first: m0, last: list[list.length - 1], range, fine: m0.type === 'cc' && groups.has(msgKey({ ...m0, number: m0.number + 32 })) };
  }
  return best;
}

export function readStep(step: SetupStep, msgs: RawMsg[], ctx: StepContext): StepResult | null {
  const fresh = msgs.filter((m) => !ctx.taken.has(msgKey(m)) && !isFineHalf(m, ctx.taken));
  switch (step.kind) {
    case 'button': {
      const n = fresh.find((m) => m.type === 'note' && m.on);
      if (n) return { maps: [{ type: 'note', channel: n.channel, number: n.number, control: step.control, mode: 'button' }], said: describe(n) };
      // some boards send buttons as CCs: 127 down, 0 up
      const c = fresh.find((m) => m.type === 'cc' && m.value === 127 && fresh.some((o) => o.type === 'cc' && o.number === m.number && o.channel === m.channel && o.value === 0 && o.t >= m.t));
      if (c) return { maps: [{ type: 'cc', channel: c.channel, number: c.number, control: step.control, mode: 'button' }], said: describe(c) };
      return null;
    }
    case 'fader': {
      const s = bestSweep(fresh);
      if (!s || s.range < 36) return null;
      const m = s.first;
      return { maps: [{ type: m.type, channel: m.channel, number: m.type === 'pitch' ? 0 : m.number, control: step.control, mode: 'absolute', ...(s.fine ? { fine: true } : {}) }], said: describe({ ...m, fine: s.fine }) };
    }
    case 'tempo': {
      const s = bestSweep(fresh);
      if (!s || s.range < 60) return null;
      // wait until it's let go at one end: that end is +
      if (ctx.now - s.last.t < 450) return null;
      const end = v7(s.last);
      if (end > 16 && end < 111) return null;
      const invert = end < 64;
      const m = s.first;
      return {
        maps: [{ type: m.type, channel: m.channel, number: m.type === 'pitch' ? 0 : m.number, control: step.control, mode: 'absolute', ...(s.fine ? { fine: true } : {}), ...(invert ? { invert: true } : {}) }],
        said: `${describe({ ...m, fine: s.fine })}, + at the ${invert ? 'low' : 'high'} end`,
      };
    }
    case 'jogRing': {
      for (const [, list] of groupBy(fresh.filter((m) => m.type === 'cc'))) {
        if (list.length < 8 || !looksRelative(list.map((m) => m.value))) continue;
        const m = list[0];
        return { maps: [{ type: 'cc', channel: m.channel, number: m.number, control: step.control, mode: 'jog' }], said: describe(m) };
      }
      return null;
    }
    case 'jogTop':
      return readJogTop(step, msgs, ctx);
    case 'encoder': {
      for (const [, list] of groupBy(fresh.filter((m) => m.type === 'cc'))) {
        if (list.length < 3 || !list.every((m) => Math.abs(relValue(m.value)) <= 20 && relValue(m.value) !== 0)) continue;
        const m = list[0];
        return { maps: [{ type: 'cc', channel: m.channel, number: m.number, control: step.control, mode: 'relative' }], said: describe(m) };
      }
      return null;
    }
    case 'deck3':
    case 'deck3pad': {
      const ref = ctx.learned[step.kind === 'deck3' ? 'L.play' : 'L.pad1'];
      if (!ref || ref === 'skipped') return null;
      const base = ref.maps[0];
      const n = msgs.find((m) => m.type === base.type && m.on && m.number === base.number && m.channel !== base.channel);
      if (!n) return null;
      const mirror = (n.channel - base.channel + 16) % 16;
      return { maps: [], mirror, said: `deck 3 is ${mirror} channel${mirror === 1 ? '' : 's'} on (channel ${n.channel + 1})` };
    }
  }
}

/** touch the top, turn once, let go: the touch note, the turn and the ticks per turn */
function readJogTop(step: SetupStep, msgs: RawMsg[], ctx: StepContext): StepResult | null {
  const touch = msgs.find((m) => m.type === 'note' && m.on && !ctx.taken.has(msgKey(m)));
  const sum = (list: RawMsg[]) => list.reduce((a, m) => a + Math.abs(relValue(m.value)), 0);
  const turning = (list: RawMsg[]) => {
    let best: RawMsg[] = [];
    for (const [, g] of groupBy(list.filter((m) => m.type === 'cc'))) if (g.length > best.length && looksRelative(g.map((m) => m.value))) best = g;
    return best;
  };
  const ticksOf = (n: number) => (n >= 64 && n <= 20000 ? Math.round(n) : undefined);
  if (touch) {
    const off = msgs.find((m) => m.type === 'note' && m.number === touch.number && m.channel === touch.channel && !m.on && m.t >= touch.t);
    if (!off) return null;
    const turn = turning(msgs.filter((m) => m.t >= touch.t && m.t <= off.t));
    if (turn.length < 6) return null;
    const ticks = ticksOf(sum(turn));
    const t0 = turn[0];
    const maps: StepResult['maps'] = [{ type: 'note', channel: touch.channel, number: touch.number, control: step.control, mode: 'jog' }];
    if (!ctx.taken.has(msgKey(t0))) maps.push({ type: 'cc', channel: t0.channel, number: t0.number, control: step.control, mode: 'jog' });
    return { maps, ticks, said: `touch ${describe(touch)}${ticks ? `, ${ticks} ticks a turn` : ''}` };
  }
  // no touch sensor heard: take the turn once it has stopped
  const turn = turning(msgs);
  if (turn.length < 16 || ctx.now - turn[turn.length - 1].t < 900) return null;
  const t0 = turn[0];
  const ticks = ticksOf(sum(turn));
  return {
    maps: ctx.taken.has(msgKey(t0)) ? [] : [{ type: 'cc', channel: t0.channel, number: t0.number, control: step.control, mode: 'jog' }],
    ticks,
    said: `no touch sensor heard${ticks ? `; ${ticks} ticks a turn` : ''}`,
  };
}

/** everything the learned steps claim, so a later step doesn't take it again */
export function takenBy(learned: Learned, except?: string): Set<string> {
  const s = new Set<string>();
  for (const [id, r] of Object.entries(learned)) {
    if (id === except || r === 'skipped') continue;
    for (const m of r.maps) s.add(msgKey(m));
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* the finished mapping                                                 */
/* ------------------------------------------------------------------ */

const result = (learned: Learned, id: string): StepResult | null => {
  const r = learned[id];
  return r && r !== 'skipped' ? r : null;
};

/** the same control on the other side: deck.L ↔ deck.R, ch.1 ↔ ch.2 */
function otherSide(control: string): string | null {
  if (control.startsWith('deck.L.')) return 'deck.R.' + control.slice(7);
  if (control.startsWith('ch.1.')) return 'ch.2.' + control.slice(5);
  return null;
}

export interface Finished {
  mappings: MidiMapping[];
  /** controls worked out from the other side rather than touched */
  guessed: string[];
}

export function finalize(learned: Learned, device: string, steps: SetupStep[] = SETUP_STEPS): Finished {
  const profile = profileName(device);
  const out: MidiMapping[] = [];
  const guessed: string[] = [];
  const add = (m: Omit<MidiMapping, 'device'>) => out.push({ ...m, device, profile });
  for (const st of steps) {
    const r = result(learned, st.id);
    if (r) for (const m of r.maps) add(m);
  }

  // jog ticks per turn, on both of that side's jog messages
  for (const s of ['L', 'R'] as const) {
    const ticks = result(learned, `${s}.jogTop`)?.ticks;
    if (ticks) for (const m of out) if (m.control === `deck.${s}.jog` && m.type === 'cc') m.ticks = ticks;
  }

  // the channels each side's deck buttons use
  const playL = result(learned, 'L.play')?.maps[0];
  const playR = result(learned, 'R.play')?.maps[0];
  const sideShift = playL && playR && playL.type === playR.type && playL.number === playR.number ? playR.channel - playL.channel : null;

  // the right side's pad modes (and anything skipped on the right) from the left, on the deck's own channel
  if (sideShift && playL) {
    const have = new Set(out.map((m) => m.control));
    for (const m of [...out]) {
      const to = otherSide(m.control);
      if (!to || have.has(to) || m.channel !== playL.channel || /\.pad\.\d$/.test(m.control)) continue;
      add({ ...m, channel: m.channel + sideShift, control: to });
      guessed.push(to);
    }
  }

  // pads: pad 1 and pad 8 → a block of eight (and every pad mode, when the pads have a channel of their own)
  for (const s of ['L', 'R'] as const) {
    const p1 = out.find((m) => m.control === `deck.${s}.pad.1`);
    const p8 = out.find((m) => m.control === `deck.${s}.pad.8`);
    if (!p1 || p1.type !== 'note') continue;
    const inLine = !p8 || (p8.type === 'note' && p8.channel === p1.channel && p8.number === p1.number + 7);
    if (!inLine) continue; // an unusual layout: keep pads 1 and 8 as they are
    if (p8) out.splice(out.indexOf(p8), 1);
    p1.block = 8;
    const shared = out.some((m) => m !== p1 && m.channel === p1.channel && !/\.pad\.\d$/.test(m.control));
    if (!shared) p1.stride = 16;
  }

  // decks 3 and 4: the deck's channel (and the pads') a few channels on
  const mirror = result(learned, 'deck3')?.mirror;
  if (mirror) {
    const deckCh = new Set([playL?.channel, playR?.channel].filter((c): c is number => c !== undefined));
    for (const m of out) if (deckCh.has(m.channel) && !m.block && (m.control.startsWith('deck.') || m.control.startsWith('ch.'))) m.mirror = mirror;
    const padMirror = result(learned, 'deck3pad')?.mirror;
    if (padMirror) for (const m of out) if (m.block) m.mirror = padMirror;
  }

  // one mapping per message and control
  const seen = new Set<string>();
  const mappings = out.filter((m) => {
    const k = `${msgKey(m)}|${m.control}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { mappings, guessed };
}
