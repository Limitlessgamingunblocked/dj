/*
 * Control registry: every operable control in the app (knobs, faders,
 * buttons, jog wheels, encoders) is registered here once, bound to the audio
 * engine. The 3D boards, the software UI widgets, keyboard shortcuts and MIDI
 * mappings all operate controls by id, so they always stay in sync.
 *
 * Deck controls use side tokens: "deck.L.play" resolves to deck 1 or 3 and
 * "deck.R.play" to deck 2 or 4 depending on the active deck layer.
 */
import { Emitter } from './emitter';

export type LedState = boolean | string | { color: string; level?: number; blink?: boolean };
export type JogZone = 'top' | 'ring';

interface Base {
  id: string;
  label: string;
}

export interface ContinuousControl extends Base {
  kind: 'continuous';
  get(): number; // 0..1
  set(v: number): void;
  def: number;
  /** centre detent (EQ, filter, tempo) */
  center?: boolean;
  format?(v: number): string;
}

export interface ButtonControl extends Base {
  kind: 'button';
  press(): void;
  release?(): void;
  lit?(): LedState;
}

export interface JogControl extends Base {
  kind: 'jog';
  touch(zone: JogZone | null): void;
  turn(revs: number, zone: JogZone): void;
  /** platter/jog rotation in radians for rendering */
  angle(): number;
  touched(): boolean;
}

export interface EncoderControl extends Base {
  kind: 'encoder';
  step(delta: number): void;
  press?(): void;
  display?(): string;
}

export type Control = ContinuousControl | ButtonControl | JogControl | EncoderControl;

export type ControlSource = 'ui' | '3d' | 'midi' | 'key';

interface RegistryEvents extends Record<string, unknown> {
  activity: { id: string; source: ControlSource };
  layer: { side: 'L' | 'R'; deck: number };
}

export class ControlRegistry extends Emitter<RegistryEvents> {
  private map = new Map<string, Control>();
  readonly layers: { L: number; R: number } = { L: 1, R: 2 };
  shift = false;
  /** performance.now() of the last activity per resolved id */
  readonly lastActivity = new Map<string, number>();
  /** last activity that came from hardware (MIDI) or the keyboard, for flash feedback */
  readonly lastExternal = new Map<string, number>();

  register(c: Control): void {
    this.map.set(c.id, c);
  }

  resolveId(id: string): string {
    if (id.startsWith('deck.L.')) return `deck.${this.layers.L}.${id.slice(7)}`;
    if (id.startsWith('deck.R.')) return `deck.${this.layers.R}.${id.slice(7)}`;
    return id;
  }

  get(id: string): Control | undefined {
    return this.map.get(this.resolveId(id));
  }

  has(id: string): boolean {
    return this.map.has(this.resolveId(id));
  }

  all(): Control[] {
    return [...this.map.values()];
  }

  setLayer(side: 'L' | 'R', deck: number): void {
    this.layers[side] = deck;
    this.emit('layer', { side, deck });
  }

  mark(id: string, source: ControlSource): void {
    const rid = this.resolveId(id);
    const now = performance.now();
    this.lastActivity.set(rid, now);
    if (source === 'midi' || source === 'key') this.lastExternal.set(rid, now);
    this.emit('activity', { id: rid, source });
  }

  /* convenience operations used by keyboard/MIDI/UI */
  setValue(id: string, v: number, source: ControlSource): void {
    const c = this.get(id);
    if (c && c.kind === 'continuous') {
      c.set(Math.min(1, Math.max(0, v)));
      this.mark(id, source);
    }
  }

  nudgeValue(id: string, delta: number, source: ControlSource): void {
    const c = this.get(id);
    if (c && c.kind === 'continuous') this.setValue(id, c.get() + delta, source);
  }

  press(id: string, source: ControlSource): void {
    const c = this.get(id);
    if (!c) return;
    if (c.kind === 'button' || (c.kind === 'encoder' && c.press)) {
      c.press!();
      this.mark(id, source);
    }
  }

  release(id: string, source: ControlSource): void {
    const c = this.get(id);
    if (c && c.kind === 'button' && c.release) {
      c.release();
      this.mark(id, source);
    }
  }

  value(id: string): number {
    const c = this.get(id);
    return c && c.kind === 'continuous' ? c.get() : 0;
  }

  /** true while a control was recently moved from MIDI/keyboard (on-screen feedback) */
  flashing(id: string, ms = 220): boolean {
    const t = this.lastExternal.get(this.resolveId(id));
    return t !== undefined && performance.now() - t < ms;
  }

  lit(id: string): LedState {
    const c = this.get(id);
    return c && c.kind === 'button' && c.lit ? c.lit() : false;
  }
}

export function ledColor(state: LedState, fallback: string): { on: boolean; color: string; level: number } {
  if (!state) return { on: false, color: fallback, level: 0 };
  if (state === true) return { on: true, color: fallback, level: 1 };
  if (typeof state === 'string') return { on: true, color: state, level: 1 };
  const blinkOff = state.blink && Math.floor(performance.now() / 250) % 2 === 1;
  return { on: !blinkOff, color: state.color, level: blinkOff ? 0.15 : state.level ?? 1 };
}
