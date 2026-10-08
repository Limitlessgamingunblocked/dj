/* The keyboard cheat sheet (Help) and the key editor (Settings → Keyboard). */
import { assignable, assignKey, chordFor, chordOf, KEY_DEFS, keyName, type KeyDef } from '../app/keyboard';
import { onPrefs, prefs, setPrefs } from '../core/prefs';
import { clear, h, setClass } from './dom';
import { toast } from './toast';

/** Compact cheat sheet of the keys as they are set now (grouped rows). */
export function shortcutsTable(): HTMLElement {
  const t = h('div', { class: 'keys-table' });
  const rows = new Map<string, { label: string; keys: string[] }>();
  for (const d of KEY_DEFS) {
    const c = chordFor(d, prefs.keys);
    if (!c) continue;
    const label = d.group ?? d.label.replace(/ \(second key\)$/, '');
    const row = rows.get(label) ?? { label, keys: [] };
    row.keys.push(keyName(c));
    rows.set(label, row);
  }
  for (const r of rows.values()) t.append(h('div', {}, ...r.keys.map((k) => h('kbd', {}, k)).flatMap((k, i) => (i ? [' ', k] : [k]))), h('div', {}, r.label));
  t.append(h('div', {}, h('kbd', {}, 'Shift')), h('div', {}, 'Hold for SHIFT functions (e.g. Shift + pad deletes a hot cue)'));
  return t;
}

/** Every binding with its key; click a key, then press the new one. */
export class KeysEditor {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private capturing: { def: KeyDef; btn: HTMLElement; stop: () => void } | null = null;

  constructor() {
    this.list = h('div', { class: 'keys-edit' });
    const resetAll = h('button', { class: 'btn small', type: 'button' }, 'Reset all keys');
    resetAll.addEventListener('click', () => {
      setPrefs({ keys: {} });
      toast('Keyboard shortcuts are back to the defaults');
    });
    this.el = h('div', { class: 'keys-editor' }, h('p', { class: 'note set-row' }, 'Click a key, then press the one you want (hold Shift for the Shift layer). Backspace leaves it without a key, Esc cancels. A key can only do one thing: taking one that is in use clears it from the other action.'), this.list, h('div', { class: 'toggle-row set-row' }, resetAll));
    onPrefs((_, changed) => changed.has('keys') && this.render());
    this.render();
  }

  private render(): void {
    this.cancel();
    clear(this.list);
    for (const d of KEY_DEFS) {
      const c = chordFor(d, prefs.keys);
      const moved = d.key in prefs.keys;
      const btn = h('button', { class: `btn small key-btn${c ? '' : ' none'}`, type: 'button', title: 'Click, then press a key', 'aria-label': `${d.label}: ${c ? keyName(c) : 'no key'}. Click to change` }, keyName(c));
      btn.addEventListener('click', () => this.capture(d, btn));
      const reset = h('button', { class: 'btn small ghost', type: 'button', title: `Back to ${keyName(d.key)}`, 'aria-label': `Reset ${d.label} to ${keyName(d.key)}` }, '↺');
      reset.hidden = !moved;
      reset.addEventListener('click', () => this.assign(d, d.key));
      this.list.append(h('div', { class: `key-row set-row${moved ? ' moved' : ''}` }, h('span', { class: 'key-label' }, d.label), btn, reset));
    }
  }

  private capture(def: KeyDef, btn: HTMLElement): void {
    const was = this.capturing?.def;
    this.cancel();
    if (was === def) return;
    btn.textContent = 'Press a key…';
    setClass(btn, 'listening', true);
    const onKey = (e: KeyboardEvent) => {
      // ahead of every other key handler (the decks, the library, board full screen)
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(e.code)) return;
      if (e.code === 'Escape') return this.cancel();
      if (e.code === 'Backspace' || e.code === 'Delete') return this.assign(def, '');
      if (e.ctrlKey || e.metaKey || e.altKey || !assignable(e.code)) {
        toast(`${keyName(e.code)} can’t be used here. Pick a letter, number, symbol or arrow key.`);
        return;
      }
      this.assign(def, chordOf(e));
    };
    const onDown = (e: PointerEvent) => {
      if (e.target !== btn) this.cancel();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('pointerdown', onDown, { capture: true });
    this.capturing = {
      def,
      btn,
      stop: () => {
        window.removeEventListener('keydown', onKey, { capture: true });
        window.removeEventListener('pointerdown', onDown, { capture: true });
      },
    };
  }

  private cancel(): void {
    const c = this.capturing;
    if (!c) return;
    this.capturing = null;
    c.stop();
    setClass(c.btn, 'listening', false);
    c.btn.textContent = keyName(chordFor(c.def, prefs.keys));
  }

  private assign(def: KeyDef, chord: string): void {
    this.cancel();
    const { keys, displaced } = assignKey(prefs.keys, def.key, chord);
    setPrefs({ keys });
    if (displaced.length) toast(`${keyName(chord)} now does “${def.label}”. ${displaced.map((d) => `“${d.label}”`).join(', ')} has no key now.`);
    else if (chord) toast(`${def.label}: ${keyName(chord)}`);
    else toast(`${def.label}: no key`);
  }
}
