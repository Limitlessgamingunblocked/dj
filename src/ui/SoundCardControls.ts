/* Pick the output the mix plays through (a controller's sound card), and its headphone outputs. */
import type { Mixer } from '../audio/Mixer';
import { listOutputs, loadSoundCard, pickOutput, revealNames, saveSoundCard, type OutputInfo } from '../app/soundCard';
import { clear, h } from './dom';
import { toast } from './toast';

const canPick = () => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

/** `model`: the board whose sound card "Find outputs" picks by itself when it's there (e.g. 'DDJ-REV5') */
export function soundCardControls(mixer: Mixer, model = ''): HTMLElement {
  const sel = h('select', { 'aria-label': 'Main output device' }) as HTMLSelectElement;
  const find = h('button', { class: 'btn small', type: 'button' }, 'Find outputs');
  const names = h('button', { class: 'btn small ghost', type: 'button', hidden: true, title: 'Browsers hide device names until a page may use a microphone. Nothing is recorded.' }, 'Show names');
  const quad = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const quadRow = h('label', { class: 'check-row soundcard-quad' }, quad, h('span', {}, 'Headphones on the controller’s headphone jack (outputs 3 and 4)'));
  const status = h('p', { class: 'note soundcard-status' });
  let devs: OutputInfo[] = [];
  let outputs = 0;

  const fill = () => {
    const s = loadSoundCard();
    clear(sel);
    sel.append(h('option', { value: '' }, 'System default'));
    const list = [...devs];
    if (s.device && !list.some((d) => d.deviceId === s.device)) list.unshift({ deviceId: s.device, label: s.label || 'Picked earlier' });
    list.forEach((d, i) => sel.append(h('option', { value: d.deviceId }, d.label || `Output ${i + 1}`)));
    sel.value = s.device;
    names.hidden = !devs.length || devs.some((d) => d.label);
  };
  const render = () => {
    const s = loadSoundCard();
    quad.checked = mixer.quadPhones;
    quad.disabled = outputs < 4 && !mixer.quadPhones;
    quadRow.classList.toggle('off', quad.disabled);
    status.textContent = !canPick()
      ? 'This browser can’t choose an output. Use Chrome or Edge, or make the controller your computer’s sound output.'
      : outputs
        ? `Playing through ${s.device ? s.label || 'the picked output' : 'the system default'} · ${outputs} output${outputs === 1 ? '' : 's'}${outputs < 4 ? ' (headphones on 3/4 need four)' : ''}`
        : s.device
          ? `Picked: ${s.label || 'an output'}`
          : 'Playing through the system default.';
  };
  const apply = async (id: string) => {
    const label = devs.find((d) => d.deviceId === id)?.label ?? '';
    const n = await mixer.setOutputDevice(id);
    if (n === null) {
      toast('Could not play through that output. Check it’s plugged in, or pick it as your computer’s sound output instead.', 'error');
      fill();
      return;
    }
    outputs = n;
    saveSoundCard({ device: id, label, quad: mixer.quadPhones && n >= 4 });
    fill();
    render();
  };
  const scan = async (auto: boolean) => {
    try {
      devs = await listOutputs();
    } catch {
      devs = [];
    }
    fill();
    if (!devs.length) toast('This browser doesn’t list its outputs here', 'error');
    const mine = model ? pickOutput(devs, model) : null;
    if (auto && mine && sel.value !== mine.deviceId) {
      sel.value = mine.deviceId;
      await apply(mine.deviceId);
      toast(`Playing through ${mine.label}`);
    } else if (auto && model && devs.length && !mine && devs.every((d) => !d.label)) toast('Click “Show names” to find your controller in the list');
  };

  find.addEventListener('click', () => void scan(true));
  names.addEventListener('click', async () => {
    if (!(await revealNames())) {
      toast('No names without microphone permission. You can still pick from the list.', 'error');
      return;
    }
    await scan(true);
  });
  sel.addEventListener('change', () => void apply(sel.value));
  quad.addEventListener('change', () => {
    if (!mixer.setQuadPhones(quad.checked)) {
      toast('This output has only two channels, so the headphones stay on the main mix (or use split cue).', 'error');
      quad.checked = false;
    }
    saveSoundCard({ ...loadSoundCard(), quad: mixer.quadPhones });
    render();
  });

  fill();
  render();
  if (canPick()) {
    outputs = mixer.outputChannels;
    render();
  }
  return h('div', { class: 'soundcard' }, h('div', { class: 'toggle-row' }, sel, find, names), quadRow, status);
}
