/*
 * Lighting desk: the venue, the automatic light show and big hit buttons
 * (strobe, blinders, lasers, CO2, blackout) that also work from the keyboard
 * and MIDI.
 */
import type { AppContext } from '../app/context';
import { keyForControl } from '../app/keyboard';
import { onPrefs } from '../core/prefs';
import type { Stage } from '../three/Stage';
import { LASER_PATTERN_NAMES, LASER_PATTERNS, PALETTES, type ShowControls } from '../three/venues/show';
import { h, setClass, setText } from './dom';
import { venueCards } from './VenuePicker';
import { hwButton, type Widget } from './widgets';

export class LightsPanel {
  readonly el: HTMLElement;
  private widgets: Widget[] = [];
  private cards: { el: HTMLElement; refresh(): void };
  private autoBtn: HTMLElement;
  private dropBtn: HTMLElement;
  private pyroBtn: HTMLElement;
  private confettiBtn: HTMLElement;
  private calmBtn: HTMLElement;
  private dancersBtn: HTMLElement;
  private yeahBtn: HTMLElement;
  private palBtns = new Map<string, HTMLElement>();
  private laserBtns = new Map<string, HTMLElement>();
  private patBtns = new Map<string, HTMLElement>();
  private customInputs: HTMLInputElement[] = [];
  private status: HTMLElement;
  private meter: HTMLElement;

  constructor(
    app: AppContext,
    private stage: Stage,
    private save: () => void,
  ) {
    const c = stage.show.controls;
    const reg = app.reg;
    this.cards = venueCards(
      () => app.venueId(),
      (id) => app.setVenue(id),
    );
    app.events.on('venue', () => this.cards.refresh());

    const toggle = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = h('button', { class: 'btn', type: 'button', title }, label);
      b.addEventListener('click', () => {
        set(!get());
        this.save();
      });
      return b;
    };
    this.autoBtn = toggle('Follow the music', 'Lights run a show locked to the beat grid, energy, breakdowns and drops', () => c.auto, (v) => (c.auto = v));
    this.dropBtn = toggle('Drop FX', 'Strobes, blinders and CO2 fire automatically on drops', () => c.dropFx, (v) => (c.dropFx = v));
    this.calmBtn = toggle('Reduce flashing', 'Strobes and blinders stay under 3 flashes a second, with no blackout before the drop. On by default if your system asks for reduced motion', () => c.reduceFlash, (v) => (c.reduceFlash = v));
    this.pyroBtn = toggle('Pyro on drops', 'Flame jets (or cold-spark fountains indoors) go off on drops, then chase the next downbeats', () => c.pyro, (v) => (c.pyro = v));
    this.confettiBtn = toggle('Confetti on drops', 'The confetti cannons go off on a big drop, at most every 90 seconds so it stays special', () => c.confetti, (v) => (c.confetti = v));
    this.dancersBtn = toggle('Hype dancers', 'Two dancers on podiums either side of the booth (not in the Bedroom)', () => c.dancers, (v) => (c.dancers = v));
    this.yeahBtn = toggle('HELL YEAH on big moments', 'Fires by itself on a built drop, every fourth clean mix in a row, the encore or a raid, at most once every 45 seconds', () => c.hellyeah, (v) => (c.hellyeah = v));

    const pal = h('div', { class: 'seg', role: 'group', 'aria-label': 'Colours' });
    for (const p of PALETTES) {
      const b = h('button', { class: 'btn', type: 'button' }, p.name);
      b.addEventListener('click', () => {
        c.palette = p.id;
        this.save();
      });
      this.palBtns.set(p.id, b);
      pal.append(b);
    }
    // the Custom palette's three colours; picking one switches to Custom
    const customRow = h('div', { class: 'toggle-row custom-pal' }, h('span', { class: 'label' }, 'Custom'));
    c.custom.forEach((col, i) => {
      const inp = h('input', { type: 'color', value: col, 'aria-label': `Custom light colour ${i + 1}`, title: `Custom colour ${i + 1}` }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        const next = [...c.custom] as ShowControls['custom'];
        next[i] = inp.value;
        c.custom = next;
        c.palette = 'custom';
      });
      inp.addEventListener('change', () => this.save());
      this.customInputs.push(inp);
      customRow.append(inp);
    });
    const lasers = h('div', { class: 'seg', role: 'group', 'aria-label': 'Lasers' });
    for (const [id, label] of [
      ['auto', 'Auto'],
      ['on', 'On'],
      ['off', 'Off'],
    ] as [ShowControls['lasers'], string][]) {
      const b = h('button', { class: 'btn', type: 'button' }, label);
      b.addEventListener('click', () => {
        c.lasers = id;
        this.save();
      });
      this.laserBtns.set(id, b);
      lasers.append(b);
    }
    const pats = h('div', { class: 'chip-grid', role: 'group', 'aria-label': 'Laser look' });
    for (const id of ['auto', ...LASER_PATTERNS] as (ShowControls['laserPattern'])[]) {
      const b = h('button', { class: 'btn chip', type: 'button' }, id === 'auto' ? 'Auto' : LASER_PATTERN_NAMES[id]);
      b.addEventListener('click', () => {
        c.laserPattern = id;
        this.save();
      });
      this.patBtns.set(id, b);
      pats.append(b);
    }
    const slider = (id: string, label: string, min: number, max: number, get: () => number, set: (v: number) => void) => {
      const inp = h('input', { type: 'range', id, min, max, step: 0.05, value: get(), 'aria-label': label }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        set(parseFloat(inp.value));
        this.save();
      });
      return h('label', { class: 'field', for: id }, label, inp);
    };

    // each pad shows the key it is on (keys can be moved in Settings)
    const kbds: [HTMLElement, string][] = [];
    const pad = (id: string, label: string, cls: string) => {
      const w = hwButton(reg, id, label, { cls: `light-pad ${cls}` });
      this.widgets.push(w);
      const k = h('kbd', {}, keyForControl(id));
      kbds.push([k, id]);
      w.el.append(k);
      return w.el;
    };
    onPrefs((_, changed) => {
      if (changed.has('keys'))
        for (const [k, id] of kbds) {
          setText(k, keyForControl(id));
          k.hidden = !k.textContent;
        }
    });
    this.status = h('div', { class: 'show-status mono' });
    this.meter = h('div', { class: 'show-meter' }, ...Array.from({ length: 16 }, () => h('i')));

    this.el = h(
      'div',
      { class: 'pane lights-pane' },
      h('div', { class: 'lights-col' }, h('h3', {}, 'Venue'), this.cards.el),
      h(
        'div',
        { class: 'lights-col desk' },
        h('h3', {}, 'Light show'),
        h('div', { class: 'light-pads' }, pad('light.strobe', 'Strobe', 'strobe'), pad('light.blinder', 'Blinders', 'blinder'), pad('light.lasers', 'Lasers', 'laser'), pad('light.co2', 'CO2', 'co2'), pad('light.pyro', 'Pyro', 'pyro'), pad('light.confetti', 'Confetti', 'confetti'), pad('light.blackout', 'Blackout', 'blackout')),
        h('p', { class: 'note' }, 'Hold a pad or its key to fire it. The rest follows the music by itself.'),
        h('div', { class: 'toggle-row' }, this.autoBtn, this.dropBtn, this.pyroBtn, this.confettiBtn, this.calmBtn),
        h('h3', {}, 'Party'),
        h('div', { class: 'light-pads party-pads' }, pad('fun.hellyeah', 'HELL YEAH!', 'yeah-pad'), pad('fun.airhorn', 'Air horn', 'airhorn')),
        h('p', { class: 'note' }, 'HELL YEAH! sets the whole room off: air horn, sparklers, confetti, beach balls and a crowd surfer.'),
        h('div', { class: 'toggle-row' }, this.dancersBtn, this.yeahBtn),
        h('div', { class: 'field' }, 'Colours', pal, customRow),
        h('div', { class: 'field' }, 'Lasers', lasers),
        h('div', { class: 'field' }, 'Laser look', pats),
        h('div', { class: 'toggle-row sliders' }, slider('light-int', 'Intensity', 0.2, 1.5, () => c.intensity, (v) => (c.intensity = v)), slider('light-smoke', 'Haze', 0, 1, () => c.smoke, (v) => (c.smoke = v))),
        h('div', { class: 'show-live' }, this.meter, this.status),
      ),
    );
  }

  update(): void {
    const c = this.stage.show.controls;
    const s = this.stage.show.state;
    setClass(this.autoBtn, 'active', c.auto);
    setClass(this.dropBtn, 'active', c.dropFx);
    setClass(this.pyroBtn, 'active', c.pyro);
    setClass(this.confettiBtn, 'active', c.confetti);
    setClass(this.calmBtn, 'active', c.reduceFlash);
    setClass(this.dancersBtn, 'active', c.dancers);
    setClass(this.yeahBtn, 'active', c.hellyeah);
    for (const [id, b] of this.palBtns) setClass(b, 'active', id === c.palette);
    this.customInputs.forEach((inp, i) => {
      if (document.activeElement !== inp && inp.value !== c.custom[i]) inp.value = c.custom[i];
    });
    for (const [id, b] of this.laserBtns) setClass(b, 'active', id === c.lasers);
    for (const [id, b] of this.patBtns) setClass(b, 'active', id === c.laserPattern);
    for (const w of this.widgets) w.update();
    const phase = !s.playing ? 'Idle' : s.peak > 0.5 ? 'Peak' : s.build > 0.35 ? 'Build-up' : 'Groove';
    setText(this.status, `${phase} · bar ${s.bar + 1} · movers ${['sweep', 'fan', 'alternate', 'circles', 'ballyhoo', 'focus'][s.moverPattern] ?? ''} · lasers ${s.lasers > 0.05 ? LASER_PATTERN_NAMES[s.laserPattern] : 'off'}`);
    const cells = this.meter.children;
    const lit = Math.round((s.playing ? s.energy * 0.6 + s.peak * 0.4 + s.kick * 0.2 : 0) * cells.length);
    for (let i = 0; i < cells.length; i++) setClass(cells[i] as HTMLElement, 'on', i < lit);
  }
}
