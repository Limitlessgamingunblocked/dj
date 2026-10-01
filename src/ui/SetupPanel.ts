/* Setup: board, camera anchors, audio routing, performance, library storage, shortcuts. */
import type { AppContext } from '../app/context';
import { KEYMAP, SHIFT_KEYMAP, keyName } from '../app/keyboard';
import type { FaderCurve } from '../audio/Channel';
import type { Quality, Stage } from '../three/Stage';
import { VIEW_LABELS, type ViewId } from '../three/CameraRig';
import { clear, h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface SetupHooks {
  settings: { quality: Quality; autoQuality: boolean; autoGain: boolean; faderCurve: FaderCurve };
  save(): void;
  pickBoard(): void;
  stickers(): boolean;
  setStickers(v: boolean): void;
  clearLibrary(): Promise<void>;
}

export function shortcutsTable(): HTMLElement {
  const t = h('div', { class: 'keys-table' });
  const add = (map: typeof KEYMAP, prefix = '') => {
    let group: { keys: string[]; label: string } | null = null;
    const flush = () => {
      if (group) t.append(h('div', {}, ...group.keys.map((k) => h('kbd', {}, prefix + k)).flatMap((k, i) => (i ? [' ', k] : [k]))), h('div', {}, group.label));
    };
    for (const [code, b] of Object.entries(map)) {
      if (b.label) {
        flush();
        group = { keys: [keyName(code)], label: b.label };
      } else if (group) group.keys.push(keyName(code));
    }
    flush();
  };
  add(KEYMAP);
  add(SHIFT_KEYMAP, '⇧');
  t.append(h('div', {}, h('kbd', {}, 'Shift')), h('div', {}, 'Hold for SHIFT functions (e.g. Shift + pad deletes a hot cue)'));
  return t;
}

export class SetupPanel {
  readonly el: HTMLElement;
  private anchorsEl: HTMLElement;
  private audioInfo: HTMLElement;

  constructor(
    private app: AppContext,
    private stage: Stage,
    hooks: SetupHooks,
  ) {
    const s = hooks.settings;
    const engine = app.engine;
    const board = h('button', { class: 'btn primary' }, 'Choose board & finish');
    board.addEventListener('click', () => hooks.pickBoard());
    const stickers = h('input', { type: 'checkbox', id: 'stickers' }) as HTMLInputElement;
    stickers.checked = hooks.stickers();
    stickers.addEventListener('change', () => hooks.setStickers(stickers.checked));

    const camRow = h('div', { class: 'toggle-row' });
    (Object.keys(VIEW_LABELS) as ViewId[]).forEach((v) => {
      const b = h('button', { class: 'btn' }, stage.rig.label(v));
      b.addEventListener('click', () => stage.goTo(v));
      camRow.append(b);
    });
    const anchorName = h('input', { class: 'search', placeholder: 'Name this camera view', style: { maxWidth: '220px' }, id: 'anchor-name' }) as HTMLInputElement;
    anchorName.addEventListener('keydown', (e) => e.stopPropagation());
    const saveAnchor = h('button', { class: 'btn' }, 'Save current view');
    saveAnchor.addEventListener('click', () => {
      const name = anchorName.value.trim() || `View ${stage.rig.anchors().length + 1}`;
      stage.rig.saveAnchor(name);
      anchorName.value = '';
      toast(`Saved camera view “${name}”`);
      this.renderAnchors();
    });
    this.anchorsEl = h('div', { class: 'toggle-row' });

    const quality = h('select', { id: 'quality', 'aria-label': 'Graphics quality' }, ...(['low', 'medium', 'high'] as Quality[]).map((q) => h('option', { value: q, selected: s.quality === q }, q[0].toUpperCase() + q.slice(1)))) as HTMLSelectElement;
    quality.addEventListener('change', () => {
      s.quality = quality.value as Quality;
      stage.setQuality(s.quality);
      hooks.save();
    });
    const autoQ = h('input', { type: 'checkbox', id: 'auto-quality' }) as HTMLInputElement;
    autoQ.checked = s.autoQuality;
    autoQ.addEventListener('change', () => {
      s.autoQuality = autoQ.checked;
      stage.adaptive.enabled = autoQ.checked;
      stage.setQuality(s.quality);
      hooks.save();
    });
    const curve = h('select', { id: 'fader-curve', 'aria-label': 'Channel fader curve' }, h('option', { value: 'log', selected: s.faderCurve === 'log' }, 'Logarithmic (smooth)'), h('option', { value: 'linear', selected: s.faderCurve === 'linear' }, 'Linear'), h('option', { value: 'fast', selected: s.faderCurve === 'fast' }, 'Fast (scratch)')) as HTMLSelectElement;
    curve.addEventListener('change', () => {
      s.faderCurve = curve.value as FaderCurve;
      for (const ch of engine.channels) {
        ch.faderCurve = s.faderCurve;
        ch.setFader(ch.state.fader);
      }
      hooks.save();
    });
    const autoGain = h('input', { type: 'checkbox', id: 'auto-gain' }) as HTMLInputElement;
    autoGain.checked = s.autoGain;
    autoGain.addEventListener('change', () => {
      s.autoGain = autoGain.checked;
      engine.autoGain = s.autoGain;
      hooks.save();
    });
    const split = h('input', { type: 'checkbox', id: 'split-cue' }) as HTMLInputElement;
    split.checked = engine.mixer.split;
    split.addEventListener('change', () => engine.mixer.setSplit(split.checked));
    const phonesSel = h('select', { id: 'phones-device', 'aria-label': 'Headphone output device' }, h('option', { value: '' }, 'Same as main output')) as HTMLSelectElement;
    const findDevices = h('button', { class: 'btn small' }, 'Find outputs');
    findDevices.addEventListener('click', async () => {
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        clear(phonesSel);
        phonesSel.append(h('option', { value: '' }, 'Same as main output'));
        devs.forEach((d, i) => phonesSel.append(h('option', { value: d.deviceId }, d.label || `Output ${i + 1}`)));
        toast(devs.length ? `${devs.length} output device(s) found` : 'No extra outputs are exposed by this browser');
      } catch {
        toast('This browser does not list audio outputs here', 'error');
      }
    });
    phonesSel.addEventListener('change', async () => {
      const ok = await engine.mixer.setPhonesDevice(phonesSel.value || null);
      if (!ok) toast('Could not route headphones to that device. Use split cue with a splitter cable instead.', 'error');
    });
    this.audioInfo = h('p', { class: 'note' });
    const clearLib = h('button', { class: 'btn danger' }, 'Remove imported tracks…');
    clearLib.addEventListener('click', () => {
      const yes = h('button', { class: 'btn danger' }, 'Remove all imported tracks');
      const no = h('button', { class: 'btn' }, 'Cancel');
      const m = openModal('Remove imported tracks?', h('div', {}, h('p', { class: 'note' }, 'Imported audio, analysis and cue points stored in this browser will be deleted. Demo tracks stay.'), h('div', { style: { display: 'flex', gap: '8px' } }, yes, no)));
      yes.addEventListener('click', async () => {
        await hooks.clearLibrary();
        m.close();
        toast('Imported tracks removed');
      });
      no.addEventListener('click', () => m.close());
    });

    const field = (label: string, control: HTMLElement, forId?: string) => h('label', { class: 'field', for: forId }, label, control);
    this.el = h(
      'div',
      { class: 'cards pane', style: { alignItems: 'start' } },
      h('div', { class: 'card', style: { display: 'grid', gap: '10px' } }, h('h3', {}, 'Board & camera'), board, h('label', { class: 'toggle-row', for: 'stickers' }, stickers, 'Old stickers and gaffer tape on the hardware'), camRow, h('div', { class: 'toggle-row' }, anchorName, saveAnchor), this.anchorsEl, h('p', { class: 'note' }, 'Drag empty space to orbit, right-drag or two fingers to pan, scroll or pinch to zoom. The Performance view drifts gently with the music while you are hands-off.')),
      h(
        'div',
        { class: 'card', style: { display: 'grid', gap: '10px' } },
        h('h3', {}, 'Audio'),
        this.audioInfo,
        h('label', { class: 'toggle-row', for: 'auto-gain' }, autoGain, 'Auto gain: match track loudness on load'),
        field('Channel fader curve', curve, 'fader-curve'),
        h('label', { class: 'toggle-row', for: 'split-cue' }, split, 'Split cue: master left, headphone cue right'),
        field('Headphone output (Chrome/Edge)', h('div', { class: 'toggle-row' }, phonesSel, findDevices), 'phones-device'),
      ),
      h('div', { class: 'card', style: { display: 'grid', gap: '10px' } }, h('h3', {}, 'Performance & storage'), field('Graphics quality', quality, 'quality'), h('label', { class: 'toggle-row', for: 'auto-quality' }, autoQ, 'Adjust automatically to keep it smooth'), h('p', { class: 'note' }, 'The quality you pick is the ceiling. With automatic adjustment on, the resolution, crowd detail and effects step down when frames run long and come back when there is headroom. Low turns off shadows, bloom, multisampling and lens effects — use it on older laptops and phones.'), clearLib),
      h('div', { class: 'card', style: { display: 'grid', gap: '10px', gridColumn: '1 / -1' } }, h('h3', {}, 'Keyboard shortcuts'), shortcutsTable()),
    );
    this.renderAnchors();
  }

  private renderAnchors(): void {
    clear(this.anchorsEl);
    for (const a of this.stage.rig.anchors()) {
      const go = h('button', { class: 'btn small' }, `★ ${a.name}`);
      go.addEventListener('click', () => this.stage.rig.goToAnchor(a));
      const del = h('button', { class: 'btn small ghost', 'aria-label': `Delete ${a.name}` }, '×');
      del.addEventListener('click', () => {
        this.stage.rig.deleteAnchor(a.name);
        this.renderAnchors();
      });
      this.anchorsEl.append(h('span', { class: 'toggle-row' }, go, del));
    }
  }

  refresh(): void {
    this.renderAnchors();
  }

  update(): void {
    const e = this.app.engine;
    const ctx = e.ctx;
    const lat = ((ctx.baseLatency || 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0)) * 1000;
    const text = `${ctx.sampleRate} Hz · output latency ≈ ${lat.toFixed(0)} ms · DSP: ${e.wasmAvailable ? 'WebAssembly (key lock, stems, pitch FX)' : 'JavaScript only (key lock and stems off)'} · ${ctx.state}`;
    if (this.audioInfo.textContent !== text) this.audioInfo.textContent = text;
  }
}
