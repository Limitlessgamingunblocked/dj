/*
 * Web MIDI: device hot-plug, MIDI learn, mapping persistence, relative
 * encoders / jogs, and LED feedback to the controller.
 *
 * A mapping binds (device, status type, channel, number) → control id.
 * Notes drive buttons (press/release). CCs drive continuous controls
 * (absolute 0–127, or relative two's-complement / 64-centred for encoders and
 * jog wheels, detected automatically during learn).
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
  mode: 'button' | 'absolute' | 'relative' | 'jog';
}

interface MidiEvents extends Record<string, unknown> {
  devices: string[];
  message: { device: string; text: string };
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

    for (const m of this.mappings) {
      if ((m.device !== device && m.device !== '*') || m.type !== type || m.channel !== channel) continue;
      if (type !== 'pitch' && m.number !== d1) continue;
      this.apply(m, type, d1, d2, isOn, status);
    }
  }

  private apply(m: MidiMapping, type: MidiMapping['type'], d1: number, d2: number, isOn: boolean, status: number): void {
    const reg = this.reg;
    const ctl = reg.get(m.control);
    if (!ctl) return;
    const rel = (v: number) => (v === 64 ? 0 : v > 64 ? (v >= 96 ? v - 128 : v - 64) : v);
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
      case 'absolute': {
        const v = type === 'pitch' ? (d2 * 128 + d1) / 16383 : d2 / 127;
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
          // typical controllers send ~ 128–2048 ticks per revolution; 512 is a sensible default
          ctl.turn(steps / 512, this.jogTouched.has(m.control) ? 'top' : 'ring');
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
    for (const m of this.mappings) {
      if (m.mode !== 'button') continue;
      const out = outs.find((o) => (o.name ?? o.id) === m.device);
      if (!out) continue;
      const st = ledColor(this.reg.lit(m.control), '#fff');
      const v = st.on ? Math.max(1, Math.round(127 * st.level)) : 0;
      const key = `${m.device}|${m.type}|${m.channel}|${m.number}`;
      if (this.ledState.get(key) === v) continue;
      this.ledState.set(key, v);
      try {
        out.send([(m.type === 'note' ? 0x90 : 0xb0) | m.channel, m.number, v]);
      } catch {
        /* output went away */
      }
    }
  }
}
