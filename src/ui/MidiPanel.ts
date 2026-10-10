/* MIDI devices, the controller setup, learn mode and mapping table. */
import type { Mixer } from '../audio/Mixer';
import type { ControlRegistry } from '../core/controls';
import { loadSetting, saveSetting } from '../core/settings';
import { isRev5 } from '../midi/controllerSetup';
import type { MidiManager } from '../midi/MidiManager';
import { REV5, rev5Preset } from '../midi/rev5';
import { openControllerSetup, openJogCalibration } from './ControllerSetup';
import { soundCardControls } from './SoundCardControls';
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
  private banner: HTMLElement;
  /** boards we've already offered to set up */
  private offered = new Set<string>(loadSetting<string[]>('setupOffered', []));

  constructor(
    private midi: MidiManager,
    private reg: ControlRegistry,
    private mixer: Mixer,
  ) {
    const setup = h('button', { class: 'btn', type: 'button', title: 'For boards without a built-in mapping: press, turn and slide each control once' }, 'Set up a controller by touch');
    setup.addEventListener('click', () => this.setup());
    const enable = h('button', { class: 'btn' }, 'Connect MIDI controllers');
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
    this.banner = h('div', { class: 'midi-rev5', hidden: true });
    this.table = h('tbody');
    this.el = h(
      'div',
      { class: 'pane', style: { display: 'grid', gap: '12px' } },
      h(
        'div',
        {},
        h('h3', {}, 'MIDI controllers'),
        h('p', { class: 'note' }, 'A Pioneer DDJ-REV5 works as soon as it’s plugged in: its mapping is built in. For other boards, Set up a controller by touch walks you round the board one control at a time. To change one control, turn on MIDI learn, click it on screen, then move it on your hardware. Needs Chrome or Edge on a computer.'),
      ),
      h('div', { class: 'toggle-row' }, setup, enable, this.learnBtn, exp, imp, clr, this.status),
      this.banner,
      this.devList,
      this.learnHint,
      this.monitor,
      h('div', { class: 'table-wrap' }, h('table', { class: 'tracks' }, h('thead', {}, h('tr', {}, h('th', {}, 'Control'), h('th', {}, 'Device'), h('th', {}, 'Message'), h('th', {}, 'Mode'), h('th', {}, ''))), this.table)),
    );
    midi.on('devices', (list) => {
      this.render();
      this.offer(list);
    });
    midi.on('learn', () => this.render());
    midi.on('message', (m) => setText(this.monitor, m.text));
    midi.on('mapped', (m) => toast(`Mapped ${reg.get(m.control)?.label ?? m.control}`));
    this.render();
    // MIDI reconnected at start before this panel was listening
    if (midi.access) setTimeout(() => this.offer(midi.devices()));
  }

  private setup(device?: string): void {
    openControllerSetup(this.midi, this.mixer, { device, saved: () => this.render() });
  }

  /** a board with no mapping and no built-in one: offer the touch setup, once */
  private offer(list: string[]): void {
    const fresh = list.find((d) => !this.midi.hasMappings(d) && !this.offered.has(d));
    if (!fresh || document.querySelector('.modal-back')) return;
    this.offered.add(fresh);
    saveSetting('setupOffered', [...this.offered]);
    const yes = h('button', { class: 'btn primary', type: 'button' }, 'Set it up (about 2 minutes)');
    const no = h('button', { class: 'btn ghost', type: 'button' }, 'Later');
    const m = openModal(
      'Controller found',
      h(
        'div',
        { class: 'csetup' },
        h('p', {}, `${fresh} is plugged in. Set it up to play the game from it: you press, turn and slide each control once and it maps the board.`),
        h('p', { class: 'note' }, 'You can do it later from Settings → MIDI controllers.'),
        h('div', { class: 'toggle-row' }, yes, no),
      ),
    );
    yes.addEventListener('click', () => {
      m.close();
      this.setup(fresh);
    });
    no.addEventListener('click', () => m.close());
  }

  /** a REV5: what's loaded, the jog calibration, its sound card */
  private rev5Banner(d: string): void {
    clear(this.banner);
    const builtIn = this.midi.mappings.some((m) => m.device === d && m.profile === REV5);
    const reload = h('button', { class: 'btn small ghost', type: 'button' }, builtIn ? 'Reload built-in mapping' : 'Use the built-in mapping');
    reload.addEventListener('click', () => {
      this.midi.setProfile(d, rev5Preset(d));
      toast(`${d}: built-in mapping loaded`);
      this.render();
    });
    const cal = h('button', { class: 'btn small', type: 'button', title: 'Spin each jog once so scratching moves the track exactly as far as the platter' }, 'Calibrate jog wheels');
    cal.addEventListener('click', () => openJogCalibration(this.midi, this.mixer, d, () => this.render()));
    const sound = h('button', { class: 'btn small', type: 'button' }, 'Play through its sound card');
    sound.addEventListener('click', () =>
      openModal(
        'DDJ-REV5 sound card',
        h(
          'div',
          { class: 'csetup' },
          h('p', { class: 'note' }, 'Plug your speakers and headphones into the REV5, click Find outputs, and the game plays through it. With four outputs, the headphone cue goes to its headphone jack.'),
          soundCardControls(this.mixer, REV5),
        ),
      ),
    );
    this.banner.append(h('span', { class: 'midi-rev5-text' }, h('strong', {}, d), builtIn ? ' · built-in mapping, from Pioneer’s MIDI message list' : ' · using your own mapping'), cal, sound, reload);
  }

  render(): void {
    const midi = this.midi;
    const rev5 = midi.devices().find(isRev5);
    this.banner.hidden = !rev5;
    if (rev5) this.rev5Banner(rev5);
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
      this.table.append(h('tr', {}, h('td', {}, this.reg.get(m.control)?.label ?? m.control), h('td', {}, m.device), h('td', { class: 'num' }, `${m.type.toUpperCase()} ch${m.channel + 1} #${m.number}`), h('td', {}, m.profile ? `${m.mode} · ${m.profile}` : m.mode), h('td', {}, del)));
    }
  }

  update(): void {}
}
