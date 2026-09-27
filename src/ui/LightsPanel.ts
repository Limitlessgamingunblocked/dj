/*
 * Lighting desk: the venue, the automatic light show and big hit buttons
 * (strobe, blinders, lasers, CO2, blackout) that also work from the keyboard
 * and MIDI.
 */
import type { AppContext } from '../app/context';
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
  private palBtns = new Map<string, HTMLElement>();
  private laserBtns = new Map<string, HTMLElement>();
  private patBtns = new Map<string, HTMLElement>();
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
    this.pyroBtn = toggle('Pyro on drops', 'Flame jets (or cold-spark fountains indoors) go off on drops, then chase the next downbeats', () => c.pyro, (v) => (c.pyro = v));

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
    const pats = h('div', { class: 'seg', role: 'group', 'aria-label': 'Laser pattern' });
    for (const id of ['auto', ...LASER_PATTERNS] as (ShowControls['laserPattern'])[]) {
      const b = h('button', { class: 'btn', type: 'button' }, id === 'auto' ? 'Auto' : LASER_PATTERN_NAMES[id]);
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

    const pad = (id: string, label: string, key: string, cls: string) => {
      const w = hwButton(reg, id, label, { cls: `light-pad ${cls}` });
      this.widgets.push(w);
      w.el.append(h('kbd', {}, key));
      return w.el;
    };
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
        h('div', { class: 'light-pads' }, pad('light.strobe', 'Strobe', 'N', 'strobe'), pad('light.blinder', 'Blinders', 'B', 'blinder'), pad('light.lasers', 'Lasers', 'Y', 'laser'), pad('light.co2', 'CO2', 'T', 'co2'), pad('light.pyro', 'Pyro', '⇧T', 'pyro'), pad('light.blackout', 'Blackout', '`', 'blackout')),
        h('p', { class: 'note' }, 'Hold a pad (or its key) to fire it. Everything else runs itself: patterns change every 8 bars, lasers sheet over the crowd in breakdowns, the build-up gets a strobe roll and the drop fires CO2, blinders, strobes and the pyro.'),
        h('div', { class: 'toggle-row' }, this.autoBtn, this.dropBtn, this.pyroBtn),
        h('div', { class: 'field' }, 'Colours', pal),
        h('div', { class: 'field' }, 'Lasers', h('div', { class: 'toggle-row' }, lasers, pats)),
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
    for (const [id, b] of this.palBtns) setClass(b, 'active', id === c.palette);
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
