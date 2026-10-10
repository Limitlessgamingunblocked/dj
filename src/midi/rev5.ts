/*
 * The Pioneer DDJ-REV5, mapped from AlphaTheta's "DDJ-REV5 List of MIDI
 * Messages" (E1, downloads.support.alphatheta.com/software_info/dj-controllers/
 * DDJ-REV5/DDJ-REV5_MIDI_message_List_E1). It loads by itself when a REV5 is plugged in, so the board
 * just works; the touch-by-touch setup (controllerSetup.ts) stays for other
 * boards, and "Calibrate jog wheels" measures the jogs.
 *
 * The board's layout, in MIDI terms (channels counted from 0 here):
 *   decks 1–4                 channels 0–3: transport, loops, the jogs, the tempo
 *                             fader, and that deck's mixer channel (trim, EQ,
 *                             fader, headphone cue). The DECK 1/3 and 2/4
 *                             buttons move a side onto channels 2/3.
 *   FX 1 / FX 2               channels 4 / 5
 *   browser, global mixer     channel 6 (crossfader, filter knobs, master…)
 *   performance pads          channels 7 / 9 / 11 / 13 for decks 1–4 (SHIFT
 *                             sends them on the channel after: not mapped).
 *                             Each pad mode sends its own run of 8 notes: hot
 *                             cue 0–7, roll 16–23, saved loop 32–39, sampler
 *                             48–55, pitch play 64–71, piano play 80–87, stems
 *                             96–103, scratch bank 112–119, user modes 8–15…
 *                             The four pads in the deck section use 72–75 (hot
 *                             cue), 88–91, 104–107 and 120–123 (sampler).
 *   14-bit knobs and faders   CC n coarse, CC n+32 fine
 *   jogs                      64-centred: side 0x21, top 0x22 (0x23 with vinyl
 *                             mode off), touch note 0x0D, position ring 0x1E
 *
 * Where the game has no matching feature, the nearest one it has: SAVED LOOP
 * pads play Beat Jump and SCRATCH BANK plays Slicer.
 */
import { isRev5 } from './controllerSetup';
import type { MidiMapping } from './MidiManager';

export const REV5 = 'DDJ-REV5';

/** jog ticks per turn until "Calibrate jog wheels" measures them (the list doesn't say) */
export const REV5_JOG_TICKS = 720;

/** the board's pad modes (by first note of each run, from the pad) → the game's */
const PAD_MODES: Record<string, string> = {
  0: 'hotcue',
  16: 'roll',
  32: 'jump', // SAVED LOOP
  48: 'sampler',
  64: 'pitch', // PITCH PLAY
  88: 'jump', // deck pads, saved loop
  104: 'slicer', // deck pads, scratch bank
  112: 'slicer', // SCRATCH BANK
};

export function rev5Preset(device: string): MidiMapping[] {
  const out: MidiMapping[] = [];
  const add = (m: Omit<MidiMapping, 'device' | 'profile'>) => out.push({ ...m, device, profile: REV5 });
  const note = (channel: number, number: number, control: string, extra: Partial<MidiMapping> = {}) => add({ type: 'note', channel, number, control, mode: 'button', ...extra });
  const knob = (channel: number, number: number, control: string, extra: Partial<MidiMapping> = {}) => add({ type: 'cc', channel, number, control, mode: 'absolute', fine: true, ...extra });
  const GLOBAL = 6;

  for (const s of ['L', 'R'] as const) {
    const ch = s === 'L' ? 0 : 1;
    const d = `deck.${s}.`;
    const c = `ch.${ch + 1}.`;
    const deck = { mirror: 2 };
    // transport and deck buttons
    note(ch, 0x0b, d + 'play', deck);
    note(ch, 0x0c, d + 'cue', deck);
    note(ch, 0x0a, d + 'sync', deck);
    note(ch, 0x09, d + 'keylock', deck);
    note(ch, 0x08, d + 'range', deck);
    note(ch, 0x04, d + 'loop.auto', deck);
    note(ch, 0x05, d + 'loop.auto', deck); // AUTO LOOP when the loop-length option is on
    note(ch, 0x01, d + 'loop.half', deck);
    note(ch, 0x03, d + 'loop.double', deck);
    note(ch, 0x28, d + 'slip', deck);
    note(ch, 0x29, d + 'censor', deck);
    note(ch, 0x2a, d + 'key.down', deck);
    note(ch, 0x2b, d + 'key.up', deck);
    // the jog: side nudges, top scratches while touched (vinyl mode off: it nudges)
    const jog = { mirror: 2, ticks: REV5_JOG_TICKS };
    add({ type: 'cc', channel: ch, number: 0x21, control: d + 'jog', mode: 'jog', ...jog, ring: 0x1e });
    add({ type: 'cc', channel: ch, number: 0x22, control: d + 'jog', mode: 'jog', ...jog });
    add({ type: 'cc', channel: ch, number: 0x23, control: d + 'jog', mode: 'jog', ...jog, zone: 'ring' });
    add({ type: 'note', channel: ch, number: 0x0d, control: d + 'jog', mode: 'jog', mirror: 2 });
    // tempo: "+" is the top of the range (0x7F), as the game expects
    knob(ch, 0x00, d + 'tempo', deck);
    // pad mode buttons
    note(ch, 0x40, d + 'padmode.hotcue', deck);
    note(ch, 0x41, d + 'padmode.roll', deck);
    note(ch, 0x42, d + 'padmode.jump', deck); // SAVED LOOP
    note(ch, 0x43, d + 'padmode.sampler', deck);
    note(ch, 0x50, d + 'padmode.pitch', deck); // SHIFT + HOT CUE: PITCH PLAY
    note(ch, 0x53, d + 'padmode.slicer', deck); // SHIFT + SAMPLER: SCRATCH BANK
    // PARAMETER ◀ / ▶: one note per pad mode
    add({ type: 'note', channel: ch, number: 96, control: d + 'param.down', mode: 'button', block: 12, mirror: 2 });
    add({ type: 'note', channel: ch, number: 112, control: d + 'param.up', mode: 'button', block: 12, mirror: 2 });
    // the performance pads, every pad mode; the four deck pads too
    add({ type: 'note', channel: s === 'L' ? 7 : 9, number: 0, control: d + 'pad.1', mode: 'button', block: 8, stride: 8, mirror: 4, modes: PAD_MODES });
    for (let i = 0; i < 4; i++) {
      // deck pads in hot cue mode: always hot cues; in sampler mode: the sampler
      note(s === 'L' ? 7 : 9, 72 + i, `${d}hotcue.${i + 1}`, { mirror: 4 });
      note(s === 'L' ? 7 : 9, 120 + i, `sampler.pad.${i + 1}`, { mirror: 4 });
    }
    // stems mode: pads 1–4 (and the four deck pads) mute vocal / melody / bass / drums
    (['vocal', 'melody', 'bass', 'drums'] as const).forEach((stem, i) => {
      note(s === 'L' ? 7 : 9, 96 + i, `${d}stem.${stem}.mute`, { mirror: 4 });
      note(ch, 0x2c + i, `${d}stem.${stem}.mute`, deck);
    });
    // DECK 1/3 and 2/4: the board says which deck each side is on
    add({ type: 'note', channel: ch, number: 0x3e, control: s === 'L' ? 'layer.L' : 'layer.R', mode: 'layer', mirror: 2 });
    // this side's mixer channel (channel 3/4 when the side is on deck 3/4)
    knob(ch, 0x04, c + 'trim', deck);
    knob(ch, 0x07, c + 'hi', deck);
    knob(ch, 0x0b, c + 'mid', deck);
    knob(ch, 0x0f, c + 'low', deck);
    knob(ch, 0x13, c + 'fader', deck);
    note(ch, 0x07, c + 'cue', deck);
  }

  // filter knobs: one CC per mixer channel
  for (let i = 0; i < 4; i++) knob(GLOBAL, 0x17 + i, `ch.${i + 1}.filter`);
  // global mixer
  knob(GLOBAL, 0x1f, 'mixer.xfader');
  knob(GLOBAL, 0x0b, 'mixer.xcurve');
  knob(GLOBAL, 0x08, 'mixer.master');
  knob(GLOBAL, 0x09, 'mixer.booth');
  knob(GLOBAL, 0x03, 'mixer.sampler');
  knob(GLOBAL, 0x0d, 'mixer.phones');
  knob(GLOBAL, 0x0c, 'mixer.cuemix');
  knob(GLOBAL, 0x05, 'mic.1.level');
  knob(GLOBAL, 0x06, 'mic.2.level');
  knob(GLOBAL, 0x0e, 'mic.hi');
  knob(GLOBAL, 0x0f, 'mic.low');
  knob(GLOBAL, 0x07, 'aux.trim');
  note(GLOBAL, 0x54, 'mixer.hamster', { mode: 'switch' }); // CROSSFADER REVERSE switch
  // browser
  add({ type: 'cc', channel: GLOBAL, number: 0x40, control: 'browse', mode: 'relative' });
  add({ type: 'cc', channel: GLOBAL, number: 0x64, control: 'browse', mode: 'relative' }); // SHIFT + turn
  note(GLOBAL, 0x41, 'browse');
  note(GLOBAL, 0x65, 'screen.back');
  note(GLOBAL, 0x3f, 'shift');
  // LOAD sends one note per deck
  [0x46, 0x47, 0x48, 0x49].forEach((n, i) => note(GLOBAL, n, `deck.${i + 1}.load`));

  // FX: FX1 on channel 4 and FX2 on 5, three effect buttons each → the game's effects
  ([4, 5] as const).forEach((ch, unit) => {
    [0x70, 0x71, 0x72].forEach((n, k) => note(ch, n, `fx.type.${FX_FOR[unit * 3 + k]}`));
    note(ch, 0x06, 'fx.beat.down');
    note(ch, 0x07, 'fx.beat.up');
    // LEVEL/DEPTH: one CC per selected effect
    [0x02, 0x04, 0x06].forEach((n) => knob(ch, n, 'fx.depth'));
    // the FX paddles: CH1 / CH3 on FX1, CH2 / CH4 on FX2
    note(ch, 0x50, `fx.paddle.${unit + 1}`);
    note(ch, 0x51, `fx.paddle.${unit + 3}`);
  });
  return out;
}

/** a board's built-in mapping, if it has one */
export function presetFor(device: string): MidiMapping[] | null {
  return isRev5(device) ? rev5Preset(device) : null;
}

/** the game's effects behind FX1-1…3 and FX2-1…3 */
const FX_FOR = ['echo', 'reverb', 'flanger', 'pingpong', 'phaser', 'gate'];
