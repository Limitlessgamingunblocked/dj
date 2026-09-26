import { CERTS, hasCerts, nextUpgradeCost, rank, UPGRADES, type Profile } from '../core/progression';
import { TOOLS } from '../core/medical';
import { VEHICLES, type VehicleId } from '../core/vehicle';
import type { MissionEntry } from '../game/missions';
import type { MissionResult } from '../game/types';
import { h } from './dom';

export interface DispatchHooks {
  profile: Profile;
  missions: MissionEntry[];
  activeMission: string | null;
  canSwapVehicle: boolean;
  start(id: string): void;
  abandon(): void;
  buyVehicle(id: VehicleId): void;
  selectVehicle(id: VehicleId): void;
  buyUpgrade(id: (typeof UPGRADES)[number]['id']): void;
  setVolume(v: number): void;
  resetSave(): void;
  close(): void;
}

type Tab = 'missions' | 'garage' | 'upgrades' | 'certs' | 'help';

const bar = (v: number, max: number) => h('div', { class: 'statbar' }, h('i', { style: `width:${Math.round((v / max) * 100)}%` }));

export class Screens {
  readonly el = h('div', { class: 'screens hidden' });
  private tab: Tab = 'missions';
  private hooks: DispatchHooks | null = null;

  hide() {
    this.el.classList.add('hidden');
    this.el.replaceChildren();
    this.hooks = null;
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  showTitle(hasSave: boolean, onStart: () => void, onNew: () => void) {
    this.hooks = null;
    this.el.classList.remove('hidden');
    const start = h('button', { class: 'btn primary big', onclick: onStart }, hasSave ? 'Continue shift' : 'Start first shift');
    this.el.replaceChildren(
      h(
        'div',
        { class: 'title' },
        h('div', { class: 'logo' }, h('span', {}, 'Grand Theft Auto'), h('b', {}, 'GOOD')),
        h('p', { class: 'tagline' }, 'An open city. A siren. Every call is someone’s worst day — make it better.'),
        h(
          'div',
          { class: 'howto' },
          h('div', {}, h('h4', {}, 'Drive'), h('p', {}, 'W A S D or arrows · Space handbrake · Q siren (traffic yields and holds at intersections) · R wail/yelp · H horn · C camera')),
          h('div', {}, h('h4', {}, 'Help'), h('p', {}, 'F get out / in · walk to the red beacon · E assess and treat · check signs, pick gear from the wheel, place it precisely (Shift steadies your hands)')),
          h('div', {}, h('h4', {}, 'Transport'), h('p', {}, 'Load patients (E) and drive to the ER bay. Hard braking, sharp corners and crashes hurt them — watch the g-force ring.')),
          h('div', {}, h('h4', {}, 'Grow'), h('p', {}, 'M opens Dispatch: training courses earn certifications, scenarios and calls earn merit for vehicles and upgrades.')),
        ),
        h('div', { class: 'row' }, start, hasSave ? h('button', { class: 'btn ghost', onclick: onNew }, 'New career') : null),
        h('p', { class: 'fine' }, 'Keyboard and mouse recommended. Fan-made parody name — not affiliated with any game publisher. No real medical advice: in an emergency, call your local emergency number.'),
      ),
    );
  }

  showResult(title: string, res: MissionResult, success: boolean, onClose: () => void) {
    this.hooks = null;
    this.el.classList.remove('hidden');
    const btn = h('button', { class: 'btn primary', onclick: onClose }, 'Back on patrol  ⏎');
    this.el.replaceChildren(
      h(
        'div',
        { class: `result ${success ? 'win' : 'lose'}` },
        h('div', { class: 'rk' }, success ? 'Call complete' : 'Call not completed'),
        h('h2', {}, title),
        success ? h('ul', {}, ...res.lines.map((l) => h('li', {}, l))) : h('p', {}, res.failReason ?? ''),
        success ? h('div', { class: 'earned' }, `+${res.merit} merit`) : h('p', { class: 'muted' }, 'No merit this time. Try it again from Dispatch.'),
        res.cert && success ? h('div', { class: 'cert' }, `Certification earned: ${CERTS[res.cert].name}`) : null,
        btn,
      ),
    );
    setTimeout(() => btn.focus(), 50);
  }

  showDispatch(hooks: DispatchHooks, tab?: Tab) {
    this.hooks = hooks;
    if (tab) this.tab = tab;
    this.el.classList.remove('hidden');
    this.renderDispatch();
  }

  refresh() {
    if (this.hooks) this.renderDispatch();
  }

  private renderDispatch() {
    const hk = this.hooks!;
    const p = hk.profile;
    const tabs: [Tab, string][] = [
      ['missions', 'Missions'],
      ['garage', 'Garage'],
      ['upgrades', 'Upgrades'],
      ['certs', 'Certifications'],
      ['help', 'Controls'],
    ];
    const nav = h('div', { class: 'tabs' }, ...tabs.map(([id, label]) => h('button', { class: `tab${this.tab === id ? ' on' : ''}`, onclick: () => ((this.tab = id), this.renderDispatch()) }, label)));
    let body: HTMLElement;
    switch (this.tab) {
      case 'missions':
        body = this.missionsTab(hk);
        break;
      case 'garage':
        body = this.garageTab(hk);
        break;
      case 'upgrades':
        body = this.upgradesTab(hk);
        break;
      case 'certs':
        body = this.certsTab(hk);
        break;
      default:
        body = this.helpTab(hk);
    }
    this.el.replaceChildren(
      h(
        'div',
        { class: 'dispatch' },
        h(
          'div',
          { class: 'dh' },
          h('div', {}, h('div', { class: 'brand' }, 'GTA', h('b', {}, 'GOOD'), h('span', {}, ' · Dispatch')), h('div', { class: 'sub' }, `${rank(p.totalMerit)} · ${p.helped} people helped`)),
          h('div', { class: 'wallet' }, h('b', {}, p.merit.toLocaleString()), ' merit'),
          h('button', { class: 'btn ghost', onclick: () => hk.close() }, 'Back to the street  Esc'),
        ),
        nav,
        body,
      ),
    );
  }

  private missionsTab(hk: DispatchHooks) {
    const p = hk.profile;
    const card = (m: MissionEntry) => {
      const ok = hasCerts(p, m.requires);
      const best = p.missions[m.id];
      const active = hk.activeMission === m.id;
      const missing = m.requires.filter((c) => !p.certs.includes(c)).map((c) => CERTS[c].name);
      return h(
        'div',
        { class: `mcard ${m.kind}${ok ? '' : ' locked'}` },
        h('div', { class: 'mk' }, m.kind === 'training' ? `Training${m.grants ? ` → ${CERTS[m.grants].name}` : ''}` : 'Scenario'),
        h('h3', {}, m.title),
        h('p', {}, m.blurb),
        h(
          'div',
          { class: 'mf' },
          h('span', {}, best !== undefined ? `Best: ${best} merit` : `Reward ~${m.reward}`),
          active
            ? h('button', { class: 'btn danger', onclick: () => hk.abandon() }, 'Abandon')
            : ok
              ? h('button', { class: 'btn primary', onclick: () => hk.start(m.id) }, hk.activeMission ? 'Switch to this' : 'Start')
              : h('span', { class: 'req' }, `Requires ${missing.join(' + ')}`),
        ),
      );
    };
    const training = hk.missions.filter((m) => m.kind === 'training');
    const scen = hk.missions.filter((m) => m.kind === 'scenario');
    return h(
      'div',
      { class: 'tabbody' },
      h('p', { class: 'muted' }, 'Between missions, Dispatch sends street calls on its own — press Y to take one.'),
      h('h4', {}, 'Training center'),
      h('div', { class: 'grid' }, ...training.map(card)),
      h('h4', {}, 'Scenarios'),
      h('div', { class: 'grid' }, ...scen.map(card)),
    );
  }

  private garageTab(hk: DispatchHooks) {
    const p = hk.profile;
    return h(
      'div',
      { class: 'tabbody' },
      hk.canSwapVehicle ? null : h('p', { class: 'warn' }, 'Hand off your patients before switching vehicles.'),
      h(
        'div',
        { class: 'grid' },
        ...VEHICLES.map((v) => {
          const owned = p.vehicles.includes(v.id);
          const sel = p.vehicle === v.id;
          const swatch = `background:linear-gradient(90deg,#${v.body.toString(16).padStart(6, '0')} 70%,#${v.stripe.toString(16).padStart(6, '0')} 70%)`;
          return h(
            'div',
            { class: `vcard${sel ? ' sel' : ''}` },
            h('div', { class: 'swatch', style: swatch }),
            h('h3', {}, v.name),
            h('p', {}, v.blurb),
            h('div', { class: 'stats' }, h('span', {}, 'Top speed'), bar(v.maxSpeed, 50), h('span', {}, 'Acceleration'), bar(v.accel, 14), h('span', {}, 'Handling'), bar(v.grip, 10), h('span', {}, 'Patient comfort'), bar(1.6 - v.comfort, 1.1), h('span', {}, 'Capacity'), h('b', {}, `${v.capacity} ${v.capacity === 1 ? 'patient' : 'patients'}`)),
            h(
              'div',
              { class: 'mf' },
              sel
                ? h('span', { class: 'tag' }, 'In service')
                : owned
                  ? h('button', { class: 'btn', disabled: !hk.canSwapVehicle, onclick: () => hk.selectVehicle(v.id) }, 'Take this unit')
                  : h('button', { class: 'btn primary', disabled: p.merit < v.cost, onclick: () => hk.buyVehicle(v.id) }, `Unlock · ${v.cost} merit`),
            ),
          );
        }),
      ),
    );
  }

  private upgradesTab(hk: DispatchHooks) {
    const p = hk.profile;
    return h(
      'div',
      { class: 'tabbody' },
      h(
        'div',
        { class: 'grid' },
        ...UPGRADES.map((u) => {
          const lvl = p.upgrades[u.id];
          const cost = nextUpgradeCost(p, u.id);
          return h(
            'div',
            { class: 'ucard' },
            h('h3', {}, u.name),
            h('p', {}, u.blurb),
            h('div', { class: 'pips' }, ...u.costs.map((_, k) => h('i', { class: k < lvl ? 'on' : '' }))),
            h('div', { class: 'mf' }, cost === null ? h('span', { class: 'tag' }, 'Maxed') : h('button', { class: 'btn primary', disabled: p.merit < cost, onclick: () => hk.buyUpgrade(u.id) }, `Level ${lvl + 1} · ${cost} merit`)),
          );
        }),
      ),
    );
  }

  private certsTab(hk: DispatchHooks) {
    const p = hk.profile;
    return h(
      'div',
      { class: 'tabbody' },
      h(
        'div',
        { class: 'grid' },
        ...Object.entries(CERTS).map(([id, c]) => {
          const has = p.certs.includes(id as keyof typeof CERTS);
          const course = hk.missions.find((m) => m.grants === id);
          return h('div', { class: `ccard${has ? ' has' : ''}` }, h('div', { class: 'seal' }, has ? '✓' : '·'), h('h3', {}, c.name), h('p', {}, c.blurb), h('div', { class: 'mf' }, has ? h('span', { class: 'tag' }, 'Certified') : course ? h('span', {}, `Course: ${course.title}`) : null));
        }),
      ),
      h('h4', {}, 'Equipment'),
      h('div', { class: 'gear' }, ...TOOLS.map((t) => h('div', { class: 'gearrow' }, h('b', {}, `${t.key} · ${t.name}`), h('span', {}, t.hint), t.cert && !p.certs.includes('als') ? h('em', {}, 'Needs ALS') : null))),
    );
  }

  private helpTab(hk: DispatchHooks) {
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: hk.profile.volume }) as HTMLInputElement;
    vol.addEventListener('input', () => hk.setVolume(Number(vol.value)));
    const rows: [string, string][] = [
      ['W / ↑', 'Accelerate'],
      ['S / ↓', 'Brake / reverse'],
      ['A D / ← →', 'Steer'],
      ['Space', 'Handbrake'],
      ['Q', 'Lights & siren on/off — traffic pulls over and holds at intersections'],
      ['R', 'Siren tone: wail / yelp'],
      ['H', 'Horn'],
      ['F', 'Get out / get in (loads a treated patient nearby)'],
      ['E', 'Assess & treat · load a patient'],
      ['Tab (hold)', 'Equipment wheel · 1–6 pick gear'],
      ['Shift', 'Sprint on foot · steady your hands while aiming'],
      ['Mouse drag / wheel', 'Look around · zoom'],
      ['C', 'Camera: chase / high'],
      ['Y / N', 'Respond to / decline a call'],
      ['M / Esc', 'Dispatch menu'],
    ];
    const reset = h('button', { class: 'btn danger', onclick: () => confirm('Erase your career and start over?') && hk.resetSave() }, 'Reset career');
    return h('div', { class: 'tabbody' }, h('table', { class: 'keys' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))), h('div', { class: 'row' }, h('label', {}, 'Volume ', vol), reset));
  }
}
