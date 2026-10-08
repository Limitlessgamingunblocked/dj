/* Computer-keyboard control. Keys use physical positions (KeyboardEvent.code). */
import type { ControlRegistry } from '../core/controls';

type Binding = { id: string; label: string } | { action: string; label: string };

export const KEYMAP: Record<string, Binding> = {
  Space: { id: 'deck.L.play', label: 'Left deck play / pause' },
  KeyZ: { id: 'deck.L.cue', label: 'Left deck cue (hold to preview)' },
  KeyX: { id: 'deck.L.play', label: 'Left deck play / pause' },
  KeyC: { id: 'deck.L.sync', label: 'Left deck sync' },
  KeyA: { id: 'deck.L.bend.down', label: 'Left deck pitch bend − (hold)' },
  KeyS: { id: 'deck.L.bend.up', label: 'Left deck pitch bend + (hold)' },
  KeyD: { id: 'deck.L.loop.auto', label: 'Left deck auto loop' },
  KeyF: { id: 'deck.L.slip', label: 'Left deck slip' },
  Digit1: { id: 'deck.L.pad.1', label: 'Left pads 1–4' },
  Digit2: { id: 'deck.L.pad.2', label: '' },
  Digit3: { id: 'deck.L.pad.3', label: '' },
  Digit4: { id: 'deck.L.pad.4', label: '' },
  KeyQ: { id: 'deck.L.pad.5', label: 'Left pads 5–8 (Q W E R)' },
  KeyW: { id: 'deck.L.pad.6', label: '' },
  KeyE: { id: 'deck.L.pad.7', label: '' },
  KeyR: { id: 'deck.L.pad.8', label: '' },
  KeyM: { id: 'deck.R.cue', label: 'Right deck cue (hold to preview)' },
  Comma: { id: 'deck.R.play', label: 'Right deck play / pause' },
  Period: { id: 'deck.R.sync', label: 'Right deck sync' },
  KeyK: { id: 'deck.R.bend.down', label: 'Right deck pitch bend − (hold)' },
  KeyL: { id: 'deck.R.bend.up', label: 'Right deck pitch bend + (hold)' },
  KeyJ: { id: 'deck.R.loop.auto', label: 'Right deck auto loop' },
  KeyH: { id: 'deck.R.slip', label: 'Right deck slip' },
  Digit7: { id: 'deck.R.pad.1', label: 'Right pads 1–4 (7 8 9 0)' },
  Digit8: { id: 'deck.R.pad.2', label: '' },
  Digit9: { id: 'deck.R.pad.3', label: '' },
  Digit0: { id: 'deck.R.pad.4', label: '' },
  KeyU: { id: 'deck.R.pad.5', label: 'Right pads 5–8 (U I O P)' },
  KeyI: { id: 'deck.R.pad.6', label: '' },
  KeyO: { id: 'deck.R.pad.7', label: '' },
  KeyP: { id: 'deck.R.pad.8', label: '' },
  KeyG: { id: 'fx.on', label: 'Beat FX on / off' },
  BracketLeft: { action: 'xfader-left', label: 'Crossfader left' },
  BracketRight: { action: 'xfader-right', label: 'Crossfader right' },
  Backslash: { action: 'xfader-center', label: 'Crossfader centre' },
  ArrowUp: { action: 'browse-up', label: 'Library: previous track' },
  ArrowDown: { action: 'browse-down', label: 'Library: next track' },
  ArrowLeft: { id: 'deck.L.load', label: 'Load selected track to left deck' },
  ArrowRight: { id: 'deck.R.load', label: 'Load selected track to right deck' },
  KeyV: { action: 'cycle-view', label: 'Cycle booth / split / visuals' },
  KeyN: { id: 'light.strobe', label: 'Lights: strobe (hold)' },
  KeyB: { id: 'light.blinder', label: 'Lights: blinders (hold)' },
  KeyY: { id: 'light.lasers', label: 'Lights: lasers (hold)' },
  KeyT: { id: 'light.co2', label: 'Lights: fire the CO2 cannons' },
  Backquote: { id: 'light.blackout', label: 'Lights: blackout (hold)' },
  Slash: { action: 'search', label: 'Search the library' },
};

export const SHIFT_KEYMAP: Record<string, Binding> = {
  Digit1: { id: 'sampler.pad.1', label: 'Sampler slots 1–8 (Shift + 1…8)' },
  Digit2: { id: 'sampler.pad.2', label: '' },
  Digit3: { id: 'sampler.pad.3', label: '' },
  Digit4: { id: 'sampler.pad.4', label: '' },
  Digit5: { id: 'sampler.pad.5', label: '' },
  Digit6: { id: 'sampler.pad.6', label: '' },
  Digit7: { id: 'sampler.pad.7', label: '' },
  Digit8: { id: 'sampler.pad.8', label: '' },
  KeyT: { id: 'light.pyro', label: 'Lights: fire the pyro (Shift + T)' },
  KeyB: { action: 'board-full', label: 'Board full screen on / off (Shift + B; Esc leaves)' },
};

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  Comma: ',',
  Period: '.',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Backquote: '`',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

export function keyName(code: string): string {
  return KEY_NAMES[code] ?? code.replace(/^Key|^Digit/, '');
}

export function bindKeyboard(reg: ControlRegistry, actions: Record<string, () => void>): void {
  const held = new Map<string, string>();
  const isTyping = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') reg.shift = true;
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.modal-back')) return;
    const b = (e.shiftKey ? SHIFT_KEYMAP[e.code] : undefined) ?? KEYMAP[e.code];
    if (!b) return;
    e.preventDefault();
    if (e.repeat) {
      if ('action' in b && b.action.startsWith('xfader')) actions[b.action]?.();
      return;
    }
    if ('id' in b) {
      reg.press(b.id, 'key');
      held.set(e.code, b.id);
    } else actions[b.action]?.();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') reg.shift = false;
    const id = held.get(e.code);
    if (id) {
      held.delete(e.code);
      reg.release(id, 'key');
    }
  });
  window.addEventListener('blur', () => {
    reg.shift = false;
    for (const [code, id] of held) {
      reg.release(id, 'key');
      held.delete(code);
    }
  });
}
