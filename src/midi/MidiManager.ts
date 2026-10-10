/*
 * Web MIDI: device hot-plug, MIDI learn, mapping persistence, relative
 * encoders / jogs, and LED feedback to the controller.
 *
 * A mapping binds (device, status type, channel, number) → control id.
 * Notes drive buttons (press/release). CCs drive continuous controls
 * (absolute 0–127, or relative two's-complement / 64-centred for encoders and
 * jog wheels, detected automatically during learn).
 *
 * What the controller setup (controllerSetup.ts) adds to a mapping:
 *   fine     a 14-bit fader: the CC is the coarse half, CC+32 the fine half
 *   invert   the hardware runs the other way (a tempo fader with + at the top)
 *   ticks    a jog's ticks per full turn, measured by spinning it once
 *   block    a pad block: the mapped note is pad 1, the next notes pads 2…;
 *            `stride` repeats it every so many notes, so the pads work in
 *            every pad mode the hardware switches between
 *   mirror   decks 3 and 4 arrive this many MIDI channels further on (the
 *            hardware's deck select); the app's layer follows them
 *   modes    for a pad block: which pad mode each run of notes is (the
 *            hardware sends each of its pad modes on its own notes), so the
 *            deck's pad mode follows the board
 *   zone     a jog message that always scratches ('top') or always nudges ('ring')
 *   ring     the CC that lights a jog's position ring (72 steps)
 *
 * Modes beyond button / absolute / relative / jog:
 *   switch   a latching switch: on sets the control on, off sets it off
 *   layer    the hardware saying which deck a side is on (note on = this one)
 *
 * The built-in board presets (rev5.ts) use the same fields.
 */
import type { ControlRegistry } from '../core/controls';
import { ledColor } from '../core/controls';
import { Emitter } from '../core/emitter';
import { loadSetting, saveSetting } from '../core/settings';

export interface MidiMapping {
  device: string; // input name ('*' = any)
  type: 'note' | 'cc' | 'pitch';
  channel: number; // 0–15
  number: number;
  control: string;
  mode: 'button' | 'absolute' | 'relative' | 'jog' | 'switch' | 'layer';
  fine?: boolean;
  invert?: boolean;
  ticks?: number;
  block?: number;
  stride?: number;
  mirror?: number;
  modes?: Record<string, string>;
  zone?: 'top' | 'ring';
  ring?: number;
  /** the controller setup or preset that made it (e.g. 'DDJ-REV5') */
  profile?: string;
}

/** which side of the app a control belongs to (for decks 3/4 and LEDs) */
export function sideOf(control: string): 'L' | 'R' | null {
  if (control.startsWith('deck.L.') || /^(ch\.[13]\.|layer\.L)/.test(control)) return 'L';
  if (control.startsWith('deck.R.') || /^(ch\.[24]\.|layer\.R)/.test(control)) return 'R';
  return null;
}

/** a relative value: 64-centred (65 = +1, 63 = −1) or two's complement (1 = +1, 127 = −1) */
export function relValue(v: number): number {
  if (v >= 32 && v < 96) return v - 64;
  return v < 32 ? v : v - 128;
}

/** for a pad block, which pad a note is (0-based), or -1 */
export function padOf(m: Pick<MidiMapping, 'number' | 'block' | 'stride'>, n: number): number {
  const block = m.block ?? 1;
  const stride = m.stride ?? 0;
  let d = n - m.number;
  if (stride > 0) d = ((d % stride) + stride) % stride;
  return d >= 0 && d < block ? d : -1;
}

/** the control a pad block's note drives: 'deck.L.pad.1' → 'deck.L.pad.4' */
export function blockControl(control: string, pad: number): string {
  return control.replace(/\.(\d+)$/, `.${pad + 1}`);
}

/** a mixer channel's id on the mirrored deck: ch.1 → ch.3 */
export function mirrorControl(control: string, by: number): string {
  return control.replace(/^ch\.(\d)\./, (_, n) => `ch.${Number(n) + by}.`);
}

interface MidiEvents extends Record<string, unknown> {
  devices: string[];
  message: { device: string; text: string };
  /** every message, for the controller setup */
  raw: { device: string; type: 'note' | 'cc' | 'pitch'; channel: number; number: number; value: number; on: boolean };
  learn: { control: string | null; waiting: boolean };
  mapped: MidiMapping;
}

export class MidiManager extends Emitter<MidiEvents> {
  access: MIDIAccess | null = null;
  supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  mappings: MidiMapping[] = loadSetting<MidiMapping[]>('midiMappings', []);
  learning = false;
  learnTarget: string | null = null;
  lastMessage = '';
  private ledState = new Map<string, number>();
  private jogTouched = new Map<string, number>();
  /** the coarse half of 14-bit faders, waiting for the fine half */
  private msb = new Map<string, number>();
  /** while the controller setup is listening, messages don't drive the app */
  capturing = false;

  constructor(private reg: ControlRegistry) {
    super();
  }

  async enable(): Promise<string | null> {
    if (!this.supported) return 'This browser has no Web MIDI support. Use Chrome, Edge or Opera on desktop.';
    let access: MIDIAccess;
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      return `MIDI access was refused (${err instanceof Error ? err.message : String(err)}).`;
    }
    this.access = access;
    access.onstatechange = () => this.attach();
    this.attach();
    return null;
  }

  devices(): string[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].filter((i) => i.state !== 'disconnected').map((i) => i.name ?? i.id);
  }

  private attach(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      const name = input.name ?? input.id;
      input.onmidimessage = (e) => {
        if (e.data) this.onMessage(name, e.data);
      };
    }
    this.emit('devices', this.devices());
  }

  startLearn(): void {
    this.learning = true;
    this.learnTarget = null;
    this.emit('learn', { control: null, waiting: false });
  }

  stopLearn(): void {
    this.learning = false;
    this.learnTarget = null;
    this.emit('learn', { control: null, waiting: false });
  }

  /** Called when the user clicks a control while learning. */
  pick(controlId: string | null): boolean {
    if (!this.learning || !controlId) return false;
    this.learnTarget = controlId;
    this.emit('learn', { control: controlId, waiting: true });
    return true;
  }

  removeMapping(m: MidiMapping): void {
    this.mappings = this.mappings.filter((x) => x !== m);
    this.save();
  }

  clear(): void {
    this.mappings = [];
    this.save();
  }

  /** a controller setup's mappings, replacing what that device had */
  setProfile(device: string, list: MidiMapping[]): void {
    this.mappings = [...this.mappings.filter((m) => m.device !== device), ...list];
    this.ledState.clear();
    this.save();
  }

  /** the output port that goes with an input (same name), for LEDs */
  hasMappings(device: string): boolean {
    return this.mappings.some((m) => m.device === device);
  }

  private save(): void {
    saveSetting('midiMappings', this.mappings);
    this.emit('devices', this.devices());
  }

  exportJSON(): string {
    return JSON.stringify({ app: 'deckhouse-midi', version: 1, mappings: this.mappings }, null, 2);
  }

  importJSON(text: string): number {
    const d = JSON.parse(text) as { app?: string; mappings?: MidiMapping[] };
    if (d.app !== 'deckhouse-midi' || !Array.isArray(d.mappings)) throw new Error('Not a Deckhouse MIDI mapping file.');
    this.mappings = d.mappings;
    this.save();
    return this.mappings.length;
  }

  private onMessage(device: string, data: Uint8Array): void {
    if (data.length < 2) return;
    const status = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const d1 = data[1];
    const d2 = data[2] ?? 0;
    let type: MidiMapping['type'] | null = null;
    if (status === 0x90 || status === 0x80) type = 'note';
    else if (status === 0xb0) type = 'cc';
    else if (status === 0xe0) type = 'pitch';
    if (!type) return;
    const isOn = status === 0x90 && d2 > 0;
    this.lastMessage = `${device} · ${type.toUpperCase()} ch${channel + 1} #${d1} = ${d2}`;
    this.emit('message', { device, text: this.lastMessage });
    this.emit('raw', { device, type, channel, number: type === 'pitch' ? 0 : d1, value: type === 'pitch' ? d2 * 128 + d1 : d2, on: isOn });
    if (this.capturing) return;

    if (this.learning && this.learnTarget) {
      if (type === 'note' && !isOn) return; // learn on note-on only
      const ctl = this.reg.get(this.learnTarget);
      if (!ctl) return;
      let mode: MidiMapping['mode'] = 'absolute';
      if (ctl.kind === 'button') mode = 'button';
      else if (ctl.kind === 'jog') mode = 'jog';
      else if (ctl.kind === 'encoder') mode = 'relative';
      else if (type === 'note') mode = 'button';
      const m: MidiMapping = { device, type, channel, number: type === 'pitch' ? 0 : d1, control: this.learnTarget, mode };
      this.mappings = this.mappings.filter((x) => !(x.device === device && x.type === type && x.channel === channel && x.number === m.number));
      this.mappings.push(m);
      this.save();
      this.emit('mapped', m);
      this.learnTarget = null;
      this.emit('learn', { control: null, waiting: false });
      return;
    }

    // an exact mapping beats a pad block that covers the same note
    const mine = (m: MidiMapping, ch: number) => (m.device === device || m.device === '*') && m.type === type && m.channel === ch;
    const pass = (list: MidiMapping[], mirrored: boolean): boolean => {
      let hit = false;
      for (const m of list) {
        if (!mine(m, mirrored ? channel - (m.mirror ?? 0) : channel) || (mirrored && !m.mirror)) continue;
        if (this.matchAndApply(m, mirrored ? mirrorControl(m.control, 2) : m.control, type, d1, d2, isOn, status, mirrored)) hit = true;
      }
      return hit;
    };
    const exact = this.mappings.filter((m) => !m.block);
    const blocks = this.mappings.filter((m) => m.block);
    if (pass(exact, false) || pass(blocks, false)) return;
    // decks 3 and 4: the same controls a few channels on (the hardware's deck select)
    if (!pass(exact, true)) pass(blocks, true);
  }

  private matchAndApply(m: MidiMapping, control: string, type: MidiMapping['type'], d1: number, d2: number, isOn: boolean, status: number, mirrored = false): boolean {
    if (m.mode === 'layer') {
      if (m.number !== d1) return false;
      const side = sideOf(control);
      if (side && isOn) this.reg.setLayer(side, (side === 'L' ? 1 : 2) + (mirrored ? 2 : 0));
      return true;
    }
    if (type === 'pitch') {
      this.follow(control, mirrored);
      this.apply({ ...m, control }, type, d1, d2, isOn, status);
      return true;
    }
    if (m.block) {
      const pad = padOf(m, d1);
      if (pad < 0) return false;
      this.follow(control, mirrored);
      // the board's pad mode, from which run of notes the pad came in on
      const want = m.modes?.[String(d1 - m.number - pad)];
      const deck = control.replace(/\.pad\.\d+$/, '');
      if (want && isOn && control !== deck && !ledColor(this.reg.lit(`${deck}.padmode.${want}`), '#fff').on) this.reg.press(`${deck}.padmode.${want}`, 'midi');
      this.apply({ ...m, control: blockControl(control, pad) }, type, d1, d2, isOn, status);
      return true;
    }
    // the fine half of a 14-bit fader
    if (m.fine && type === 'cc' && d1 === m.number + 32) {
      const key = `${m.device}|${m.channel}|${m.number}`;
      const hi = this.msb.get(key) ?? 0;
      this.apply({ ...m, control }, 'pitch', d2, hi, isOn, status);
      return true;
    }
    if (m.number !== d1) return false;
    if (m.fine && type === 'cc') this.msb.set(`${m.device}|${m.channel}|${m.number}`, d2);
    this.follow(control, mirrored);
    this.apply({ ...m, control }, type, d1, d2, isOn, status);
    return true;
  }

  /** a deck control from the hardware's deck 3/4 (or back on 1/2): the app's layer follows */
  private follow(control: string, mirrored: boolean): void {
    if (!control.startsWith('deck.')) return;
    const side = sideOf(control);
    if (!side) return;
    const want = (side === 'L' ? 1 : 2) + (mirrored ? 2 : 0);
    if (this.reg.layers[side] !== want && (mirrored || this.reg.layers[side] > 2)) this.reg.setLayer(side, want);
  }

  private apply(m: MidiMapping, type: MidiMapping['type'], d1: number, d2: number, isOn: boolean, status: number): void {
    const reg = this.reg;
    const ctl = reg.get(m.control);
    if (!ctl) return;
    const flip = m.invert ? -1 : 1;
    const rel = (v: number) => relValue(v) * flip;
    switch (m.mode) {
      case 'button':
        if (type === 'note') {
          if (isOn) reg.press(m.control, 'midi');
          else if (status === 0x80 || d2 === 0) reg.release(m.control, 'midi');
        } else if (type === 'cc') {
          if (d2 > 0) reg.press(m.control, 'midi');
          else reg.release(m.control, 'midi');
        }
        break;
      case 'switch': {
        // a latching switch: match the control to it
        const on = type === 'note' ? isOn : d2 > 0;
        if (on !== ledColor(reg.lit(m.control), '#fff').on) {
          reg.press(m.control, 'midi');
          reg.release(m.control, 'midi');
        }
        break;
      }
      case 'absolute': {
        let v = type === 'pitch' ? (d2 * 128 + d1) / 16383 : m.fine ? (d2 * 128) / 16383 : d2 / 127;
        if (m.invert) v = 1 - v;
        if (ctl.kind === 'continuous') reg.setValue(m.control, v, 'midi');
        break;
      }
      case 'relative': {
        const steps = rel(d2);
        if (!steps) break;
        if (ctl.kind === 'encoder') {
          ctl.step(Math.sign(steps));
          reg.mark(m.control, 'midi');
        } else if (ctl.kind === 'continuous') reg.nudgeValue(m.control, steps / 128, 'midi');
        break;
      }
      case 'jog': {
        if (ctl.kind !== 'jog') break;
        if (type === 'note') {
          ctl.touch(isOn ? 'top' : null);
          if (isOn) this.jogTouched.set(m.control, performance.now());
          else this.jogTouched.delete(m.control);
        } else {
          const steps = rel(d2);
          // typical controllers send ~ 128–2048 ticks per revolution; 512 unless the setup measured it
          ctl.turn(steps / (m.ticks || 512), m.zone ?? (this.jogTouched.has(m.control) ? 'top' : 'ring'));
          reg.mark(m.control, 'midi');
        }
        break;
      }
    }
  }

  /** Mirror LED state to controller outputs with the same name as their input. */
  updateLeds(): void {
    if (!this.access || !this.mappings.length) return;
    const outs = [...this.access.outputs.values()];
    const send = (m: MidiMapping, bytes: number[]) => {
      const key = `${m.device}|${bytes[0]}|${bytes[1]}`;
      if (this.ledState.get(key) === bytes[2]) return;
      const out = outs.find((o) => (o.name ?? o.id) === m.device);
      if (!out) return;
      this.ledState.set(key, bytes[2]);
      try {
        out.send(bytes);
      } catch {
        /* output went away */
      }
    };
    for (const m of this.mappings) {
      // on decks 3/4 the board shows that deck's lights, on its channels
      const side = sideOf(m.control);
      const onMirror = !!m.mirror && !!side && this.reg.layers[side] > 2;
      const channel = onMirror ? m.channel + (m.mirror ?? 0) : m.channel;
      const control = onMirror ? mirrorControl(m.control, 2) : m.control;
      if (m.mode === 'jog' && m.ring !== undefined && m.type === 'cc') {
        // the jog's position ring: 72 steps round, 0 is off
        const ctl = this.reg.get(control);
        if (ctl?.kind !== 'jog') continue;
        const turn = (((ctl.angle() / (Math.PI * 2)) % 1) + 1) % 1;
        send(m, [0xb0 | channel, m.ring, 1 + (Math.floor(turn * 72) % 72)]);
        continue;
      }
      if ((m.mode !== 'button' && m.mode !== 'switch') || m.block || m.type === 'pitch') continue;
      const st = ledColor(this.reg.lit(control), '#fff');
      // a preset's board takes plain on (127) / off (0); learned mappings get the level
      const v = st.on ? (m.profile ? 127 : Math.max(1, Math.round(127 * st.level))) : 0;
      send(m, [(m.type === 'note' ? 0x90 : 0xb0) | channel, m.number, v]);
    }
  }
}
