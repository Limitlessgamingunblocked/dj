/*
 * Computer-keyboard control. Keys use physical positions (KeyboardEvent.code),
 * written as "chords": a code, or "Shift+" and a code for the Shift layer.
 * Every binding can be moved to another key in Settings → Keyboard; only the
 * changes are stored (prefs.keys: default chord → new chord, '' for none).
 */
import type { ControlRegistry } from '../core/controls';
import { onPrefs, prefs } from '../core/prefs';

export interface KeyDef {
  /** the default chord, which also identifies the binding */
  key: string;
  /** a control in the registry (pressed and released with the key) … */
  id?: string;
  /** … or an app action (fired on press) */
  action?: string;
  label: string;
  /** bindings shown together on one row of the cheat sheet */
  group?: string;
}

const pads = (side: 'L' | 'R', keys: string[], from: number, group: string): KeyDef[] =>
  keys.map((key, i) => ({ key, id: `deck.${side}.pad.${from + i}`, label: `${side === 'L' ? 'Left' : 'Right'} deck pad ${from + i}`, group }));

export const KEY_DEFS: KeyDef[] = [
  { key: 'Space', id: 'deck.L.play', label: 'Left deck play / pause' },
  { key: 'KeyZ', id: 'deck.L.cue', label: 'Left deck cue (hold to preview)' },
  { key: 'KeyX', id: 'deck.L.play', label: 'Left deck play / pause (second key)' },
  { key: 'KeyC', id: 'deck.L.sync', label: 'Left deck sync' },
  { key: 'KeyA', id: 'deck.L.bend.down', label: 'Left deck pitch bend − (hold)' },
  { key: 'KeyS', id: 'deck.L.bend.up', label: 'Left deck pitch bend + (hold)' },
  { key: 'KeyD', id: 'deck.L.loop.auto', label: 'Left deck auto loop' },
  { key: 'KeyF', id: 'deck.L.slip', label: 'Left deck slip' },
  ...pads('L', ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyW', 'KeyE', 'KeyR'], 1, 'Left deck pads 1–8'),
  { key: 'KeyM', id: 'deck.R.cue', label: 'Right deck cue (hold to preview)' },
  { key: 'Comma', id: 'deck.R.play', label: 'Right deck play / pause' },
  { key: 'Period', id: 'deck.R.sync', label: 'Right deck sync' },
  { key: 'KeyK', id: 'deck.R.bend.down', label: 'Right deck pitch bend − (hold)' },
  { key: 'KeyL', id: 'deck.R.bend.up', label: 'Right deck pitch bend + (hold)' },
  { key: 'KeyJ', id: 'deck.R.loop.auto', label: 'Right deck auto loop' },
  { key: 'KeyH', id: 'deck.R.slip', label: 'Right deck slip' },
  ...pads('R', ['Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyU', 'KeyI', 'KeyO', 'KeyP'], 1, 'Right deck pads 1–8'),
  { key: 'KeyG', id: 'fx.on', label: 'Beat FX on / off' },
  { key: 'BracketLeft', action: 'xfader-left', label: 'Crossfader left (hold to keep moving)' },
  { key: 'BracketRight', action: 'xfader-right', label: 'Crossfader right (hold to keep moving)' },
  { key: 'Backslash', action: 'xfader-center', label: 'Crossfader centre' },
  { key: 'ArrowUp', action: 'browse-up', label: 'Library: previous track' },
  { key: 'ArrowDown', action: 'browse-down', label: 'Library: next track' },
  { key: 'ArrowLeft', id: 'deck.L.load', label: 'Load selected track to left deck' },
  { key: 'ArrowRight', id: 'deck.R.load', label: 'Load selected track to right deck' },
  { key: 'Slash', action: 'search', label: 'Search the library' },
  { key: 'KeyV', action: 'cycle-view', label: 'Cycle booth / split / visuals' },
  { key: 'Shift+KeyB', action: 'board-full', label: 'Board full screen on / off (Esc leaves)' },
  { key: 'Shift+KeyA', action: 'autodj', label: 'Auto DJ on / off (mixes by itself)' },
  { key: 'Shift+Slash', action: 'help', label: 'Help and every shortcut' },
  { key: 'Shift+ArrowLeft', id: 'cam.left', label: 'Camera: orbit left (hold)', group: 'Camera: orbit and tilt (hold)' },
  { key: 'Shift+ArrowRight', id: 'cam.right', label: 'Camera: orbit right (hold)', group: 'Camera: orbit and tilt (hold)' },
  { key: 'Shift+ArrowUp', id: 'cam.raise', label: 'Camera: look more from above (hold)', group: 'Camera: orbit and tilt (hold)' },
  { key: 'Shift+ArrowDown', id: 'cam.lower', label: 'Camera: look from lower down (hold)', group: 'Camera: orbit and tilt (hold)' },
  { key: 'Equal', id: 'cam.in', label: 'Camera: zoom in (hold)', group: 'Camera: zoom in / out (hold)' },
  { key: 'Minus', id: 'cam.out', label: 'Camera: zoom out (hold)', group: 'Camera: zoom in / out (hold)' },
  { key: 'Shift+KeyV', id: 'cam.next', label: 'Camera: next angle' },
  { key: 'Quote', id: 'cam.auto', label: 'Camera: auto director on / off' },
  { key: 'Shift+Quote', id: 'cam.photo', label: 'Camera: take a photo' },
  { key: 'KeyN', id: 'light.strobe', label: 'Lights: strobe (hold)' },
  { key: 'KeyB', id: 'light.blinder', label: 'Lights: blinders (hold)' },
  { key: 'KeyY', id: 'light.lasers', label: 'Lights: lasers (hold)' },
  { key: 'KeyT', id: 'light.co2', label: 'Lights: fire the CO2 cannons' },
  { key: 'Shift+KeyT', id: 'light.pyro', label: 'Lights: fire the pyro' },
  { key: 'Backquote', id: 'light.blackout', label: 'Lights: blackout (hold)' },
  ...Array.from({ length: 8 }, (_, i): KeyDef => ({ key: `Shift+Digit${i + 1}`, id: `sampler.pad.${i + 1}`, label: `Sampler slot ${i + 1}`, group: 'Sampler slots 1–8' })),
];

/** keys that can't be assigned: they leave things, move focus or are modifiers */
const RESERVED = new Set(['Escape', 'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'ContextMenu', 'Enter', 'NumpadEnter', 'Backspace', 'Delete']);

export function chordOf(e: Pick<KeyboardEvent, 'code' | 'shiftKey'>): string {
  return e.shiftKey ? `Shift+${e.code}` : e.code;
}

/** Can this key be assigned? (modifiers, Esc, Tab, Enter and Backspace stay as they are) */
export function assignable(code: string): boolean {
  return !!code && !RESERVED.has(code) && !/^F\d+$/.test(code);
}

/** The chord a binding is on now ('' when it has none). */
export function chordFor(def: KeyDef, overrides: Record<string, string>): string {
  return overrides[def.key] ?? def.key;
}

/**
 * The live map, chord → binding. A binding someone moved wins over a default
 * left on the same key (only possible with a hand-edited or old settings file).
 */
export function effectiveKeys(overrides: Record<string, string>, defs: KeyDef[] = KEY_DEFS): Map<string, KeyDef> {
  const map = new Map<string, KeyDef>();
  for (const pass of [false, true])
    for (const d of defs) {
      if ((d.key in overrides) !== pass) continue;
      const c = chordFor(d, overrides);
      if (c) map.set(c, d);
    }
  return map;
}

/**
 * Put a binding on a chord. Whatever was on that chord loses its key (it is
 * listed in `displaced` so the UI can say so). Returns new overrides; only
 * differences from the defaults are kept.
 */
export function assignKey(overrides: Record<string, string>, defKey: string, chord: string, defs: KeyDef[] = KEY_DEFS): { keys: Record<string, string>; displaced: KeyDef[] } {
  const keys = { ...overrides };
  const displaced: KeyDef[] = [];
  if (chord)
    for (const d of defs) {
      if (d.key === defKey || chordFor(d, keys) !== chord) continue;
      keys[d.key] = '';
      displaced.push(d);
    }
  keys[defKey] = chord;
  for (const k of Object.keys(keys)) if (keys[k] === k) delete keys[k];
  return { keys, displaced };
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  Comma: ',',
  Period: '.',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  IntlBackslash: '§',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'Pg Up',
  PageDown: 'Pg Dn',
};

/** A chord as it's printed on the keyboard: "Shift+KeyQ" → "⇧Q". */
export function keyName(chord: string): string {
  if (!chord) return '—';
  const shift = chord.startsWith('Shift+');
  const code = shift ? chord.slice(6) : chord;
  const name = KEY_NAMES[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  return shift ? `⇧${name}` : name;
}

/** The key a control is on now, for labels on screen ('' if none). */
export function keyForControl(id: string, overrides: Record<string, string> = prefs.keys): string {
  for (const d of KEY_DEFS) if (d.id === id || d.action === id) {
    const c = chordFor(d, overrides);
    if (c) return keyName(c);
  }
  return '';
}

export function bindKeyboard(reg: ControlRegistry, actions: Record<string, () => void>): void {
  let map = effectiveKeys(prefs.keys);
  onPrefs((p, changed) => {
    if (changed.has('keys')) map = effectiveKeys(p.keys);
  });
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
    // Shift + a key with no Shift binding does the plain key (Shift + pad deletes a hot cue)
    const b = map.get(chordOf(e)) ?? (e.shiftKey ? map.get(e.code) : undefined);
    if (!b) return;
    e.preventDefault();
    if (e.repeat) {
      if (b.action?.startsWith('xfader')) actions[b.action]?.();
      return;
    }
    if (b.id) {
      reg.press(b.id, 'key');
      held.set(e.code, b.id);
    } else if (b.action) actions[b.action]?.();
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
