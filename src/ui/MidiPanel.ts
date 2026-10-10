/* MIDI devices, learn mode and mapping table. */
import type { ControlRegistry } from '../core/controls';
import type { MidiManager } from '../midi/MidiManager';
import { clear, h, setText } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export class MidiPanel {
  readonly el: HTMLElement;
  private devList: HTMLElement;
  private status: HTMLElement;
  private monitor: HTMLElement;
  private table: HTMLTableSectionElement;
  private learnBtn: HTMLButtonElement;
  private learnHint: HTMLElement;

  constructor(
    private midi: MidiManager,
    private reg: ControlRegistry,
  ) {
    const enable = h('button', { class: 'btn primary' }, 'Connect MIDI controllers');
    enable.addEventListener('click', async () => {
      const err = await midi.enable();
      if (err) toast(err, 'error');
      else toast(`MIDI ready · ${midi.devices().length} device(s)`);
      this.render();
    });
    this.learnBtn = h('button', { class: 'btn' }, 'MIDI learn') as HTMLButtonElement;
    this.learnBtn.addEventListener('click', () => {
      if (midi.learning) midi.stopLearn();
      else midi.startLearn();
      this.render();
    });
    const exp = h('button', { class: 'btn ghost' }, 'Export mapping');
    exp.addEventListener('click', () => {
      const ta = h('textarea', { class: 'json', readonly: true }) as HTMLTextAreaElement;
      ta.value = midi.exportJSON();
      openModal('MIDI mapping', h('div', {}, h('p', { class: 'note' }, 'Copy this JSON to back up or share your mapping.'), ta));
    });
    const imp = h('button', { class: 'btn ghost' }, 'Import mapping');
    imp.addEventListener('click', () => {
      const ta = h('textarea', { class: 'json', placeholder: 'Paste a Deckhouse MIDI mapping' }) as HTMLTextAreaElement;
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      const go = h('button', { class: 'btn primary' }, 'Import');
      const m = openModal('Import MIDI mapping', h('div', { style: { display: 'grid', gap: '8px' } }, ta, h('div', {}, go)));
      go.addEventListener('click', () => {
        try {
          toast(`Imported ${midi.importJSON(ta.value)} mappings`);
          m.close();
          this.render();
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error');
        }
      });
    });
    const clr = h('button', { class: 'btn ghost danger' }, 'Clear all');
    clr.addEventListener('click', () => {
      midi.clear();
      this.render();
    });
    this.status = h('span', { class: 'label' });
    this.devList = h('div', { class: 'toggle-row' });
    this.monitor = h('div', { class: 'fx-display', style: { minHeight: '34px' } });
    this.learnHint = h('p', { class: 'note' });
    this.table = h('tbody');
    this.el = h(
      'div',
      { class: 'pane', style: { display: 'grid', gap: '12px' } },
      h('div', {}, h('h3', {}, 'MIDI controllers'), h('p', { class: 'note' }, 'Plug in a controller. To map it, turn on MIDI learn, click a control on screen, then move one on your hardware.')),
      h('div', { class: 'toggle-row' }, enable, this.learnBtn, exp, imp, clr, this.status),
      this.devList,
      this.learnHint,
      this.monitor,
      h('div', { class: 'table-wrap' }, h('table', { class: 'tracks' }, h('thead', {}, h('tr', {}, h('th', {}, 'Control'), h('th', {}, 'Device'), h('th', {}, 'Message'), h('th', {}, 'Mode'), h('th', {}, ''))), this.table)),
    );
    midi.on('devices', () => this.render());
    midi.on('learn', () => this.render());
    midi.on('message', (m) => setText(this.monitor, m.text));
    midi.on('mapped', (m) => toast(`Mapped ${reg.get(m.control)?.label ?? m.control}`));
    this.render();
  }

  render(): void {
    const midi = this.midi;
    setText(this.status, !midi.supported ? 'Web MIDI not available in this browser' : midi.access ? `${midi.devices().length} device(s) connected` : 'Not connected');
    clear(this.devList);
    for (const d of midi.devices()) this.devList.append(h('span', { class: 'chip' }, '● ', d));
    this.learnBtn.classList.toggle('active', midi.learning);
    this.learnBtn.textContent = midi.learning ? 'Stop learning' : 'MIDI learn';
    this.learnHint.textContent = midi.learning ? (midi.learnTarget ? `Now move a hardware control for “${this.reg.get(midi.learnTarget)?.label ?? midi.learnTarget}”.` : 'Click any control on screen to choose what to map.') : '';
    if (!this.monitor.textContent) this.monitor.textContent = 'Incoming MIDI messages appear here';
    clear(this.table);
    if (!midi.mappings.length) {
      this.table.append(h('tr', {}, h('td', { colspan: 5 }, h('div', { class: 'empty' }, 'No mappings yet.'))));
      return;
    }
    for (const m of midi.mappings) {
      const del = h('button', { class: 'btn small ghost' }, 'Remove');
      del.addEventListener('click', () => {
        midi.removeMapping(m);
        this.render();
      });
      this.table.append(h('tr', {}, h('td', {}, this.reg.get(m.control)?.label ?? m.control), h('td', {}, m.device), h('td', { class: 'num' }, `${m.type.toUpperCase()} ch${m.channel + 1} #${m.number}`), h('td', {}, m.mode), h('td', {}, del)));
    }
  }

  update(): void {}
}
