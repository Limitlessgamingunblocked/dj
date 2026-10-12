/*
 * Interface sounds: small synthesised clicks and tones for the menus,
 * dialogs, toasts, unlocks and the results screen. They play straight to the
 * output, never into the mix, so they can't land in a recording, and they
 * stay off the performance controls (decks, mixer, effects, sampler, light
 * pads, the 3D board): a DJ hears the music, not the buttons. The volume is
 * the uiSounds preference (0 turns them off).
 *
 *   tap     a button or tab: a short soft click
 *   open    a dialog or menu opening: a quick airy rise
 *   close   …closing: the same, falling
 *   toast   a notice: a soft two-note pop (lower for an error)
 *   unlock  something new: a bright three-note chime
 *   tick    the results counting up
 *   stamp   the grade landing: a thump with a paper slap
 */
import { prefs } from '../core/prefs';

export type UiSoundKind = 'tap' | 'open' | 'close' | 'toast' | 'error' | 'unlock' | 'tick' | 'stamp';

/** the controls a DJ plays: no interface sounds there */
export const QUIET_SELECTOR = '.deck-panel, .soft-mixer, .fx-grid, .sampler-section, .wavestrip, .light-pads, canvas, [data-quiet]';

/** how soon the same sound may play again (ms), so a fast run of clicks doesn't stack */
const GAP: Record<UiSoundKind, number> = { tap: 45, open: 90, close: 90, toast: 150, error: 150, unlock: 400, tick: 28, stamp: 300 };

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
const last = new Map<UiSoundKind, number>();

/** hand over the audio context (the sounds go straight to its output) */
export function setUiAudio(c: AudioContext): void {
  ctx = c;
  bus = null;
}

/** whether a sound may play now: on, the context running, and not too soon after the last of its kind */
export function uiSoundAllowed(kind: UiSoundKind, now: number, volume = prefs.uiSounds, lastAt = last.get(kind)): boolean {
  if (volume <= 0) return false;
  return lastAt === undefined || now - lastAt >= GAP[kind];
}

function out(): GainNode | null {
  if (!ctx || ctx.state !== 'running') return null;
  if (!bus) {
    bus = ctx.createGain();
    bus.connect(ctx.destination);
  }
  // a gentle curve: the slider's middle is quiet, its top still polite
  bus.gain.value = 0.5 * prefs.uiSounds * prefs.uiSounds;
  return bus;
}

/** one enveloped oscillator note */
function note(c: AudioContext, o: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number): void {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.006, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(o);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** a burst of filtered noise */
function hiss(c: AudioContext, o: AudioNode, t: number, dur: number, f0: number, f1: number, peak: number): void {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(o);
  src.start(t);
}

/** play an interface sound (does nothing when they're off, the audio isn't running, or it just played) */
export function uiSound(kind: UiSoundKind): void {
  const now = performance.now();
  if (!uiSoundAllowed(kind, now)) return;
  const o = out();
  const c = ctx;
  if (!o || !c) return;
  last.set(kind, now);
  const t = c.currentTime + 0.002;
  switch (kind) {
    case 'tap':
      note(c, o, 'triangle', 1900, 1300, t, 0.035, 0.22);
      hiss(c, o, t, 0.02, 5000, 4000, 0.05);
      break;
    case 'open':
      hiss(c, o, t, 0.16, 900, 3200, 0.16);
      note(c, o, 'sine', 520, 780, t, 0.12, 0.08);
      break;
    case 'close':
      hiss(c, o, t, 0.13, 2800, 800, 0.12);
      note(c, o, 'sine', 700, 460, t, 0.1, 0.06);
      break;
    case 'toast':
      note(c, o, 'sine', 880, 880, t, 0.09, 0.14);
      note(c, o, 'sine', 1320, 1320, t + 0.07, 0.14, 0.12);
      break;
    case 'error':
      note(c, o, 'triangle', 330, 300, t, 0.12, 0.16);
      note(c, o, 'triangle', 262, 240, t + 0.1, 0.18, 0.14);
      break;
    case 'unlock':
      // a major arpeggio with a shimmer on top
      [784, 988, 1175].forEach((f, i) => note(c, o, 'triangle', f, f, t + i * 0.075, 0.5, 0.16));
      note(c, o, 'sine', 2350, 2350, t + 0.22, 0.6, 0.05);
      break;
    case 'tick':
      note(c, o, 'square', 2600, 2600, t, 0.012, 0.035);
      break;
    case 'stamp':
      note(c, o, 'sine', 140, 55, t, 0.28, 0.5);
      hiss(c, o, t, 0.07, 1800, 900, 0.3);
      break;
  }
}

/** clicks on the interface's buttons, tabs and switches (not on the performance controls) */
export function wireUiSounds(root: Document = document): void {
  root.addEventListener(
    'click',
    (e) => {
      const el = e.target as Element | null;
      if (!el?.closest) return;
      const hit = el.closest('button, [role="tab"], [role="menuitem"], input[type="checkbox"], select, summary, .chip');
      if (!hit || hit.closest(QUIET_SELECTOR) || (hit as HTMLButtonElement).disabled) return;
      uiSound('tap');
    },
    { capture: true, passive: true },
  );
}
