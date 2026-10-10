/* Sample bank: 8 slots with one-shot/loop mode, level and user audio. */
import type { AppContext } from '../app/context';
import { AUDIO_ACCEPT } from '../library/Library';
import { h, setClass, setText } from './dom';
import { toast } from './toast';

export class SamplerPanel {
  readonly el: HTMLElement;
  private trigs: HTMLButtonElement[] = [];
  private names: HTMLElement[] = [];
  private modes: HTMLButtonElement[] = [];

  constructor(
    private app: AppContext,
    private loadSample: (slot: number, file: File) => Promise<void>,
    private resetSample: (slot: number) => Promise<void>,
  ) {
    const sampler = app.engine.sampler;
    const grid = h('div', { class: 'sampler-grid' });
    sampler.slots.forEach((slot, i) => {
      const trig = h('button', { class: 'trig', 'data-control': `sampler.pad.${i + 1}` }) as HTMLButtonElement;
      trig.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        app.reg.press(`sampler.pad.${i + 1}`, 'ui');
      });
      const name = h('span', { class: 'label', style: { overflow: 'hidden', textOverflow: 'ellipsis' } });
      const mode = h('button', { class: 'btn small', title: 'One-shot or loop' }) as HTMLButtonElement;
      mode.addEventListener('click', () => {
        slot.mode = slot.mode === 'oneshot' ? 'loop' : 'oneshot';
        sampler.stop(i);
      });
      const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: slot.gain, 'aria-label': `Slot ${i + 1} volume`, id: `slot-vol-${i}` }) as HTMLInputElement;
      vol.addEventListener('input', () => sampler.setSlotGain(i, parseFloat(vol.value)));
      const file = h('input', { type: 'file', accept: AUDIO_ACCEPT, hidden: true }) as HTMLInputElement;
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        try {
          await this.loadSample(i, f);
          toast(`Loaded ${f.name} into slot ${i + 1}`);
        } catch (err) {
          toast(`Couldn't load ${f.name}: ${err instanceof Error ? err.message : err}`, 'error');
        }
      });
      const load = h('button', { class: 'btn small' }, 'Load');
      load.addEventListener('click', () => file.click());
      const reset = h('button', { class: 'btn small ghost', title: 'Restore the built-in sound' }, 'Reset');
      reset.addEventListener('click', () => void this.resetSample(i));
      const card = h('div', { class: 'slot' }, trig, h('div', { class: 'slot-row' }, name, mode), vol, h('div', { class: 'slot-row' }, load, reset, file));
      card.style.setProperty('--slot', slot.color);
      card.addEventListener('dragover', (e) => e.preventDefault());
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const f = e.dataTransfer?.files[0];
        if (f) void this.loadSample(i, f).then(() => toast(`Loaded ${f.name} into slot ${i + 1}`));
      });
      this.trigs.push(trig);
      this.names.push(name);
      this.modes.push(mode);
      grid.append(card);
    });
    this.el = h(
      'section',
      { class: 'sampler-section', 'aria-label': 'Sampler' },
      h('div', { class: 'pane', style: { paddingBottom: '0' } }, h('h3', {}, 'Sampler'), h('p', { class: 'note' }, 'Shift + a number key fires a slot. Drop an audio file on a slot to replace it.')),
      grid,
    );
  }

  update(): void {
    const s = this.app.engine.sampler;
    s.slots.forEach((slot, i) => {
      setText(this.trigs[i], `${i + 1} · ${slot.buffer ? 'Play' : 'Empty'}`);
      setText(this.names[i], slot.name);
      setText(this.modes[i], slot.mode === 'loop' ? 'Loop' : 'One-shot');
      setClass(this.trigs[i], 'playing', s.isPlaying(i));
    });
  }
}
