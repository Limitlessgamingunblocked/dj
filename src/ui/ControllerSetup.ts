/*
 * The controller setup wizard: one control at a time, it says what to touch,
 * listens, and moves on by itself once it has heard enough. Back and Skip
 * at every step; at the end it saves the mapping and offers the board's sound
 * card. While it listens, the hardware doesn't drive the game.
 */
import type { Mixer } from '../audio/Mixer';
import type { MidiManager } from '../midi/MidiManager';
import { describe, finalize, isRev5, readStep, SETUP_STEPS as ALL_STEPS, takenBy, type Learned, type RawMsg, type SetupStep } from '../midi/controllerSetup';
import { clear, h } from './dom';
import { openModal } from './modal';
import { soundCardControls } from './SoundCardControls';
import { toast } from './toast';

/** the board to set up: a REV5 if one is plugged in, else the first */
export function pickDevice(devices: string[]): string {
  return devices.find(isRev5) ?? devices[0] ?? '';
}

interface WizardOptions {
  device?: string;
  saved?: () => void;
  /** a shorter run (the jog calibration) */
  steps?: SetupStep[];
  title?: string;
  intro?: string;
  /** the end screen for a shorter run */
  finish?: (learned: Learned, device: string, close: () => void) => HTMLElement;
}

export function openControllerSetup(midi: MidiManager, mixer: Mixer, opts: WizardOptions = {}): void {
  const SETUP_STEPS = opts.steps ?? ALL_STEPS;
  const GROUPS = [...new Set(SETUP_STEPS.map((s) => s.group))];
  let device = opts.device ?? pickDevice(midi.devices());
  let i = -1; // -1: the start screen
  let learned: Learned = {};
  let heard: RawMsg[] = [];
  let advancing = 0;
  let done = false;

  const modal = openModal(opts.title ?? 'Set up your controller', h('div', { class: 'csetup' }));
  const root = modal.body.firstElementChild as HTMLElement;
  if (midi.learning) midi.stopLearn();

  const live = h('div', { class: 'csetup-live mono' });
  const offRaw = midi.on('raw', (r) => {
    if (i < 0 || done || r.device !== device) return;
    heard.push({ ...r, t: performance.now() });
    live.textContent = `heard: ${r.type === 'note' ? (r.on ? 'note on' : 'note off') : r.type === 'cc' ? 'CC' : 'pitch'} · ${describe(r)}${r.type === 'note' ? '' : ` = ${r.value}`}`;
    check();
  });
  const offDevices = midi.on('devices', (list) => {
    if (i < 0) {
      if (!list.includes(device)) device = pickDevice(list);
      render();
    }
  });
  // faders that have to come to rest (the tempo fader) and jogs that stop turning
  const tick = setInterval(() => check(), 150);

  const closeModal = modal.close;
  modal.close = () => {
    clearInterval(tick);
    clearTimeout(advancing);
    offRaw();
    offDevices();
    midi.capturing = false;
    closeModal();
  };

  function check(): void {
    if (i < 0 || done || advancing) return;
    const st = SETUP_STEPS[i];
    const got = readStep(st, heard, { taken: takenBy(learned, st.id), learned, now: performance.now() });
    if (!got) return;
    learned[st.id] = got;
    render(got.said);
    advancing = setTimeout(() => {
      advancing = 0;
      go(1);
    }, 700) as unknown as number;
  }

  /** the next (or previous) step whose prerequisite was learned */
  function go(dir: 1 | -1): void {
    clearTimeout(advancing);
    advancing = 0;
    heard = [];
    let j = i + dir;
    while (j >= 0 && j < SETUP_STEPS.length) {
      const st = SETUP_STEPS[j];
      const need = st.needs ? learned[st.needs] : 'ok';
      if (need && need !== 'skipped') break;
      learned[st.id] = 'skipped';
      j += dir;
    }
    if (j < 0) j = 0;
    if (j >= SETUP_STEPS.length) {
      finish();
      return;
    }
    i = j;
    if (dir < 0) delete learned[SETUP_STEPS[i].id];
    render();
  }

  function start(): void {
    if (!device) return;
    midi.capturing = true;
    learned = {};
    i = -1;
    go(1);
  }

  function finish(): void {
    done = true;
    midi.capturing = false;
    render();
  }

  function startScreen(): HTMLElement {
    const devices = midi.devices();
    const box = h('div', { class: 'csetup-start' });
    box.append(
      ...(opts.intro
        ? [h('p', {}, opts.intro)]
        : [
            h('p', {}, 'You’ll press, turn and slide each control once, about two minutes. It works out the rest: 14-bit faders, which way your tempo faders run, the jogs, the pads in every pad mode, and decks 3 and 4.'),
            h('p', { class: 'note' }, 'The steps use Pioneer’s button names; other boards work too. Your board won’t do anything in the game until you finish. Needs Chrome or Edge on a computer.'),
          ]),
    );
    if (!midi.supported) {
      box.append(h('p', { class: 'csetup-warn' }, 'This browser has no Web MIDI. Open the game in Chrome or Edge on a computer.'));
      return box;
    }
    if (!midi.access) {
      const connect = h('button', { class: 'btn primary', type: 'button' }, 'Connect MIDI');
      connect.addEventListener('click', async () => {
        const err = await midi.enable();
        if (err) toast(err, 'error');
        device = opts.device ?? pickDevice(midi.devices());
        render();
      });
      box.append(h('p', {}, 'Plug the board in by USB and switch it on, then:'), h('div', { class: 'toggle-row' }, connect));
      return box;
    }
    if (!devices.length) {
      box.append(h('p', { class: 'csetup-warn' }, 'No controller found. Plug it in by USB and switch it on; it shows up here by itself.'));
      return box;
    }
    const sel = h('select', { 'aria-label': 'Controller' }, ...devices.map((d) => h('option', { value: d }, d))) as HTMLSelectElement;
    sel.value = device;
    sel.addEventListener('change', () => (device = sel.value));
    const go = h('button', { class: 'btn primary', type: 'button' }, 'Start');
    go.addEventListener('click', start);
    box.append(
      h('div', { class: 'toggle-row' }, h('span', { class: 'label' }, 'Controller'), sel, go),
      midi.hasMappings(device) && !opts.finish ? h('p', { class: 'note' }, 'This board already has a mapping. Finishing the setup replaces it.') : '',
    );
    return box;
  }

  function stepScreen(said?: string): HTMLElement {
    const st = SETUP_STEPS[i];
    const doneCount = Object.keys(learned).length;
    const progress = h('div', { class: 'csetup-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(SETUP_STEPS.length), 'aria-valuenow': String(doneCount) }, h('i', { style: { width: `${(doneCount / SETUP_STEPS.length) * 100}%` } }));
    const groups = h(
      'div',
      { class: 'csetup-groups' },
      ...GROUPS.map((g) => {
        const all = SETUP_STEPS.filter((s) => s.group === g);
        const state = all.every((s) => learned[s.id]) ? 'done' : g === st.group ? 'now' : '';
        return h('span', { class: `csetup-group ${state}` }, g);
      }),
    );
    const back = h('button', { class: 'btn ghost', type: 'button', disabled: i === 0 }, '← Back');
    back.addEventListener('click', () => go(-1));
    const skip = h('button', { class: 'btn', type: 'button' }, st.optional ? 'Skip: my board doesn’t have this' : 'Skip');
    skip.addEventListener('click', () => {
      learned[st.id] = 'skipped';
      go(1);
    });
    const restart = h('button', { class: 'btn ghost small', type: 'button' }, 'Start again');
    restart.addEventListener('click', start);
    if (!said && !live.textContent) live.textContent = 'nothing heard yet';
    return h(
      'div',
      { class: 'csetup-step', 'data-step': st.id },
      progress,
      groups,
      h('div', { class: 'csetup-count label' }, `Step ${i + 1} of ${SETUP_STEPS.length} · ${st.group}`),
      h('h3', { class: 'csetup-title' }, st.title),
      h('p', { class: 'csetup-hint' }, st.hint),
      h('div', { class: `csetup-ear ${said ? 'got' : ''}`, 'aria-live': 'polite' }, h('span', { class: 'csetup-dot', 'aria-hidden': 'true' }), said ? `Got it: ${said}` : 'Listening…'),
      live,
      h('div', { class: 'toggle-row csetup-nav' }, back, skip, h('span', { style: { flex: '1' } }), restart),
    );
  }

  function doneScreen(): HTMLElement {
    const { mappings, guessed } = finalize(learned, device);
    const skipped = SETUP_STEPS.filter((s) => learned[s.id] === 'skipped' && !s.optional).map((s) => s.title);
    const box = h('div', { class: 'csetup-done' });
    const save = h('button', { class: 'btn primary', type: 'button' }, `Save the mapping (${mappings.length})`);
    const again = h('button', { class: 'btn ghost', type: 'button' }, 'Start again');
    again.addEventListener('click', () => {
      done = false;
      start();
    });
    const after = h('div', { class: 'csetup-after', hidden: true });
    save.addEventListener('click', () => {
      midi.setProfile(device, mappings);
      toast(`${device} is set up: ${mappings.length} controls`);
      opts.saved?.();
      save.disabled = true;
      save.textContent = 'Saved';
      after.hidden = false;
    });
    const fourDecks = mappings.some((m) => m.mirror);
    box.append(
      h('h3', { class: 'csetup-title' }, 'All done'),
      h('p', {}, `Heard ${mappings.length} controls on ${device}.${fourDecks ? ' Decks 3 and 4 follow your board’s deck switches.' : ''}`),
      guessed.length ? h('p', { class: 'note' }, `Worked out from the left side: ${guessed.length} control${guessed.length === 1 ? '' : 's'} on the right (pad modes and anything you skipped).`) : '',
      skipped.length ? h('p', { class: 'note' }, `Skipped: ${skipped.join(', ')}. Map them any time with MIDI learn.`) : '',
      h('div', { class: 'toggle-row' }, save, again),
      after,
    );
    after.append(
      h('h4', {}, 'Play through the board’s sound card'),
      h('p', { class: 'note' }, `Plug your speakers and headphones into the ${isRev5(device) ? 'REV5' : 'controller'}, click Find outputs, and the game plays through it. With four outputs, the headphone cue goes to its headphone jack.`),
      soundCardControls(mixer, isRev5(device) ? 'DDJ-REV5' : device),
      h('div', { class: 'toggle-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, 'Done')),
    );
    return box;
  }

  function render(said?: string): void {
    clear(root);
    if (done) root.append(opts.finish ? opts.finish(learned, device, () => modal.close()) : doneScreen());
    else if (i < 0) root.append(startScreen());
    else {
      if (!said) live.textContent = '';
      root.append(stepScreen(said));
    }
  }

  render();
}


/** spin each jog once: how many ticks a turn, so scratching moves the record exactly as far as your hand */
export function openJogCalibration(midi: MidiManager, mixer: Mixer, device: string, saved?: () => void): void {
  openControllerSetup(midi, mixer, {
    device,
    title: 'Calibrate jog wheels',
    intro: 'Rest a finger on top of each jog and turn it exactly once round, then let go. Scratching then moves the track as far as the platter turns.',
    steps: ALL_STEPS.filter((s) => s.id === 'L.jogTop' || s.id === 'R.jogTop').map((s) => ({ ...s, optional: false })),
    finish: (learned, dev, close) => {
      const lines: string[] = [];
      const maps = midi.mappings.map((m) => ({ ...m }));
      for (const s of ['L', 'R'] as const) {
        const r = learned[`${s}.jogTop`];
        const ticks = r && r !== 'skipped' ? r.ticks : undefined;
        if (!ticks) {
          lines.push(`${s === 'L' ? 'Left' : 'Right'} jog: not measured`);
          continue;
        }
        for (const m of maps) if (m.device === dev && m.control === `deck.${s}.jog` && m.type === 'cc') m.ticks = ticks;
        lines.push(`${s === 'L' ? 'Left' : 'Right'} jog: ${ticks} ticks a turn`);
      }
      midi.setProfile(
        dev,
        maps.filter((m) => m.device === dev),
      );
      saved?.();
      const ok = h('button', { class: 'btn primary', type: 'button' }, 'Done');
      ok.addEventListener('click', close);
      return h('div', { class: 'csetup-done' }, h('h3', { class: 'csetup-title' }, 'Jogs calibrated'), ...lines.map((l) => h('p', {}, l)), h('div', { class: 'toggle-row' }, ok));
    },
  });
}
