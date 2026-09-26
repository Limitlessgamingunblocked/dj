import { procedureFor, scoreShot, scoreTiming, sway, swayAmp, timingMarker, type AimZone, type Procedure, type Shot } from '../core/aim';
import { CONDITIONS, missedApplication, stabilityLabel, toolById, vitalsOf, type CheckId, type ToolId, type TreatResult } from '../core/medical';
import type { Victim } from '../world/Victims';
import { h } from './dom';
import { createWheel, type Wheel } from './Wheel';

const NS = 'http://www.w3.org/2000/svg';

export interface TreatmentHooks {
  checkSeconds: number;
  steadyLevel: number;
  locked: ReadonlySet<ToolId>;
  getTool(): ToolId;
  setTool(t: ToolId): void;
  /** Applies the tool to the patient; returns the medical outcome. */
  apply(tool: ToolId, quality: number): TreatResult;
  close(treated: boolean): void;
  sound(kind: 'click' | 'good' | 'bad' | 'beep' | 'shock' | 'charge'): void;
}

const CHECKS: { id: CheckId; label: string }[] = [
  { id: 'look', label: 'Look: skin & injuries' },
  { id: 'breathing', label: 'Airway & breathing' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'ask', label: 'Ask patient / bystanders' },
];

type Stage = 'triage' | 'aim' | 'timing' | 'result';

export class TreatmentUI {
  readonly el: HTMLElement;
  private victim: Victim | null = null;
  private hooks!: TreatmentHooks;
  private stage: Stage = 'triage';
  private wheel: Wheel;
  private checking: { id: CheckId; t: number } | null = null;
  private proc: Procedure | null = null;
  private zoneIdx = 0;
  private shots: Shot[] = [];
  private t = 0;
  private mouse = { x: 100, y: 200 };
  private breath = 1;
  private holding = false;
  private tool: ToolId = 'epi';
  private timingT = 0;
  // Elements
  private header = h('div', { class: 'tr-head' });
  private vitals = h('div', { class: 'tr-vitals' });
  private checksEl = h('div', { class: 'tr-checks' });
  private findings = h('ul', { class: 'tr-findings' });
  private stageEl = h('div', { class: 'tr-stage' });
  private toolInfo = h('div', { class: 'tr-toolinfo' });
  private useBtn = h('button', { class: 'btn primary' }, 'Use') as HTMLButtonElement;
  private svg!: SVGSVGElement;
  private reticle!: SVGGElement;
  private zoneEls: SVGGElement[] = [];
  private msg = h('div', { class: 'tr-msg' });
  private bar = h('div', { class: 'tr-bar' });
  private breathEl = h('div', { class: 'tr-breath' });
  private resultEl = h('div', { class: 'tr-result' });
  private treated = false;

  constructor() {
    this.wheel = createWheel((t) => {
      this.hooks.setTool(t);
      this.hooks.sound('click');
      this.refreshTool();
    });
    const back = h('button', { class: 'btn ghost', onclick: () => this.leave() }, 'Step back  Esc');
    this.useBtn.addEventListener('click', () => this.beginApply());
    this.el = h(
      'div',
      { class: 'treatment hidden' },
      h('div', { class: 'tr-panel' }, this.header, this.vitals, h('h4', {}, 'Assessment'), this.checksEl, this.findings, back),
      h('div', { class: 'tr-center' }, this.stageEl, this.msg),
      h('div', { class: 'tr-panel tr-gear' }, h('h4', {}, 'Equipment'), this.wheel.el, this.toolInfo, this.useBtn),
    );
    this.buildBody();
    this.el.addEventListener('mousemove', (e) => this.trackMouse(e));
  }

  get isOpen() {
    return !!this.victim;
  }

  open(v: Victim, hooks: TreatmentHooks) {
    this.victim = v;
    this.hooks = hooks;
    this.treated = false;
    this.stage = 'triage';
    this.checking = null;
    this.el.classList.remove('hidden');
    const p = v.patient;
    this.header.replaceChildren(
      h('div', { class: 'tr-name' }, `${p.name}, ${p.age}`),
      h('div', { class: 'tr-scene' }, v.scene),
      p.training ? h('div', { class: 'tag' }, 'Training — no deterioration') : h('span'),
    );
    this.renderChecks();
    this.renderFindings();
    this.refreshTool();
    this.showTriage();
  }

  forceClose() {
    this.leave();
  }

  private leave() {
    if (!this.victim) return;
    this.victim = null;
    this.el.classList.add('hidden');
    this.hooks.close(this.treated);
  }

  private renderChecks() {
    const p = this.victim!.patient;
    this.checksEl.replaceChildren(
      ...CHECKS.map((c) => {
        const done = p.revealed.includes(c.id);
        const b = h('button', { class: `btn check${done ? ' done' : ''}`, onclick: () => this.startCheck(c.id) }, h('span', {}, c.label), h('i', { class: 'prog' }));
        b.dataset.id = c.id;
        return b;
      }),
    );
  }

  private renderFindings() {
    const p = this.victim!.patient;
    const c = CONDITIONS[p.condition];
    this.findings.replaceChildren(
      ...(p.revealed.length ? p.revealed.map((id) => h('li', {}, h('b', {}, `${CHECKS.find((x) => x.id === id)!.label.split(':')[0]}: `), id === 'ask' && p.story ? p.story : c.signs[id])) : [h('li', { class: 'muted' }, 'Run checks to find out what is wrong. Each check takes a moment.')]),
    );
  }

  private startCheck(id: CheckId) {
    if (this.stage !== 'triage' || this.checking || this.victim!.patient.revealed.includes(id)) return;
    this.checking = { id, t: 0 };
    this.hooks.sound('click');
  }

  private refreshTool() {
    this.tool = this.hooks.getTool();
    const locked = this.hooks.locked;
    this.wheel.set(this.tool, locked);
    const t = toolById(this.tool);
    this.toolInfo.replaceChildren(h('b', {}, t.name), h('p', {}, t.hint));
    this.useBtn.textContent = `Use ${t.short}  ⏎`;
    this.useBtn.disabled = locked.has(this.tool) || this.stage !== 'triage';
  }

  private showTriage() {
    this.stage = 'triage';
    this.stageEl.replaceChildren(this.svg);
    this.svg.classList.remove('aiming');
    for (const z of this.zoneEls) z.remove();
    this.zoneEls = [];
    this.reticle.style.display = 'none';
    this.msg.textContent = 'Assess the patient, pick equipment from the wheel (1–6), then Use.';
    this.refreshTool();
  }

  private buildBody() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 400');
    svg.classList.add('body');
    svg.innerHTML = `
      <defs><radialGradient id="skin" cx="50%" cy="35%"><stop offset="0" stop-color="#e8c6a4"/><stop offset="1" stop-color="#b98c68"/></radialGradient></defs>
      <g class="figure">
        <circle cx="100" cy="44" r="22" fill="url(#skin)"/>
        <rect x="92" y="62" width="16" height="16" fill="#c99b76"/>
        <path d="M66 80 Q100 70 134 80 L130 204 H70 Z" fill="#4f6d8f"/>
        <path d="M66 84 L40 236" stroke="#4f6d8f" stroke-width="22" stroke-linecap="round"/>
        <path d="M134 84 L160 236" stroke="#4f6d8f" stroke-width="22" stroke-linecap="round"/>
        <circle cx="38" cy="248" r="10" fill="url(#skin)"/><circle cx="162" cy="248" r="10" fill="url(#skin)"/>
        <path d="M72 200 H128 L124 232 H76 Z" fill="#2d3a4a"/>
        <path d="M86 226 L84 380" stroke="#2d3a4a" stroke-width="27" stroke-linecap="round"/>
        <path d="M114 226 L116 380" stroke="#2d3a4a" stroke-width="27" stroke-linecap="round"/>
        <path d="M92 56 Q100 61 108 56" stroke="#7a3b2e" stroke-width="2.5" fill="none"/>
      </g>
      <g class="wound"></g>
      <g class="zones"></g>
      <g class="reticle" style="display:none">
        <circle r="9" fill="none" stroke-width="1.6"/>
        <path d="M-15 0 H-5 M5 0 H15 M0 -15 V-5 M0 5 V15" stroke-width="1.6"/>
        <circle r="1.4"/>
      </g>`;
    this.svg = svg;
    this.reticle = svg.querySelector('.reticle')!;
    svg.addEventListener('click', () => this.place());
  }

  private trackMouse(e: MouseEvent) {
    const m = this.svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    this.mouse = { x: p.x, y: p.y };
  }

  private beginApply() {
    if (this.stage !== 'triage' || this.checking) return;
    if (this.hooks.locked.has(this.tool)) return;
    this.proc = procedureFor(this.tool, this.victim!.mirror);
    this.zoneIdx = 0;
    this.shots = [];
    this.breath = 1;
    this.stage = 'aim';
    this.svg.classList.add('aiming');
    this.reticle.style.display = '';
    const zones = this.svg.querySelector('.zones')!;
    const wound = this.svg.querySelector('.wound')!;
    wound.innerHTML = this.victim!.patient.condition === 'trauma' ? woundSvg(procedureFor('trauma', this.victim!.mirror).wound!) : '';
    this.zoneEls = this.proc.zones.map((z, k) => {
      const g = document.createElementNS(NS, 'g');
      g.classList.add('zone');
      if (k > 0) g.classList.add('later');
      g.innerHTML = `<circle cx="${z.x}" cy="${z.y}" r="${z.r}"/><circle class="pulse" cx="${z.x}" cy="${z.y}" r="${z.r}"/>`;
      zones.appendChild(g);
      return g;
    });
    this.refreshTool();
    this.aimMessage();
    this.hooks.sound('beep');
  }

  private aimMessage() {
    const z = this.proc!.zones[this.zoneIdx];
    this.msg.innerHTML = `<b>${z.label}</b> — click to place. Hold <kbd>Shift</kbd> to steady your hands.`;
  }

  private reticlePos(): { x: number; y: number } {
    const amp = swayAmp(this.hooks.steadyLevel, this.victim!.patient.stability, this.holding && this.breath > 0);
    const s = sway(this.t, amp);
    return { x: this.mouse.x + s.x, y: this.mouse.y + s.y };
  }

  private place() {
    if (this.stage === 'timing') return this.fireTiming();
    if (this.stage !== 'aim' || !this.proc) return;
    const z: AimZone = this.proc.zones[this.zoneIdx];
    const r = this.reticlePos();
    const shot = scoreShot(r.x, r.y, z);
    this.flash(r, shot.hit);
    if (!shot.hit) {
      missedApplication(this.victim!.patient);
      this.hooks.sound('bad');
      this.msg.innerHTML = `<b class="bad">Missed the target zone.</b> ${z.label} — try again.`;
      return;
    }
    this.hooks.sound('good');
    this.shots.push(shot);
    this.zoneEls[this.zoneIdx].classList.add('done');
    this.zoneIdx++;
    if (this.zoneIdx < this.proc.zones.length) {
      this.zoneEls[this.zoneIdx].classList.remove('later');
      this.aimMessage();
      return;
    }
    if (this.proc.timing) {
      this.stage = 'timing';
      this.timingT = 0;
      this.reticle.style.display = 'none';
      const step = this.proc.timing;
      this.bar.innerHTML = `<div class="win" style="left:${step.from * 100}%;width:${(step.to - step.from) * 100}%"></div><div class="mark"></div>`;
      this.stageEl.replaceChildren(this.svg, this.bar);
      this.msg.innerHTML = `<b>${step.label}</b> — press <kbd>Space</kbd> or click when the marker is in the window.`;
      if (this.tool === 'aed') this.hooks.sound('charge');
      return;
    }
    this.finish();
  }

  private fireTiming() {
    const step = this.proc!.timing!;
    const pos = timingMarker(this.timingT, step.speed);
    const shot = scoreTiming(pos, step);
    if (!shot.hit) {
      missedApplication(this.victim!.patient);
      this.hooks.sound('bad');
      this.msg.innerHTML = `<b class="bad">Bad timing.</b> ${step.label} — wait for the window.`;
      return;
    }
    if (this.tool === 'aed') this.hooks.sound('shock');
    else this.hooks.sound('good');
    this.shots.push(shot);
    this.finish();
  }

  private finish() {
    const q = this.shots.reduce((a, s) => a + s.quality, 0) / Math.max(1, this.shots.length);
    const res = this.hooks.apply(this.tool, q);
    this.stage = 'result';
    this.reticle.style.display = 'none';
    const grade = q > 0.8 ? 'Perfect' : q > 0.5 ? 'Good' : 'OK';
    const p = this.victim!.patient;
    const next = res.ok ? (CONDITIONS[p.condition].transport && this.victim!.dest !== 'none' ? 'They still need a hospital — load them into the ambulance.' : 'They can manage from here. Nice work.') : '';
    const done = h('button', { class: 'btn primary', onclick: () => (res.ok ? this.leave() : this.showTriage()) }, res.ok ? 'Done  ⏎' : 'Back to assessment  ⏎');
    this.resultEl.replaceChildren(
      h('div', { class: `big ${res.ok ? 'good' : 'bad'}` }, res.ok ? `${grade} — ${res.message}` : 'Wrong treatment'),
      h('p', {}, res.ok ? next : res.message),
      done,
    );
    this.stageEl.replaceChildren(this.resultEl);
    this.msg.textContent = '';
    if (res.ok) {
      this.treated = true;
      this.hooks.sound('good');
    } else this.hooks.sound('bad');
  }

  private flash(p: { x: number; y: number }, hit: boolean) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(p.x));
    c.setAttribute('cy', String(p.y));
    c.setAttribute('r', '4');
    c.classList.add('hitmark', hit ? 'hit' : 'miss');
    this.svg.appendChild(c);
    setTimeout(() => c.remove(), 700);
  }

  /** Keyboard handling while open. Returns true if the key was used. */
  key(k: string): boolean {
    if (!this.victim) return false;
    if (k === 'escape') {
      if (this.stage === 'aim' || this.stage === 'timing') this.showTriage();
      else this.leave();
      return true;
    }
    if (k === 'enter') {
      if (this.stage === 'triage') this.beginApply();
      else if (this.stage === 'result') (this.resultEl.querySelector('button') as HTMLButtonElement | null)?.click();
      return true;
    }
    if (k === ' ' && this.stage === 'timing') {
      this.fireTiming();
      return true;
    }
    const tool = ['1', '2', '3', '4', '5', '6'].indexOf(k);
    if (tool >= 0 && this.stage === 'triage') {
      const id = (['epi', 'inhaler', 'aed', 'trauma', 'glucose', 'oxygen'] as ToolId[])[tool];
      if (!this.hooks.locked.has(id)) {
        this.hooks.setTool(id);
        this.hooks.sound('click');
        this.refreshTool();
      }
      return true;
    }
    return false;
  }

  update(dt: number, shiftHeld: boolean) {
    if (!this.victim) return;
    this.t += dt;
    const p = this.victim.patient;
    const v = vitalsOf(p);
    const cls = p.stability >= 75 ? 'ok' : p.stability >= 45 ? 'warn' : 'crit';
    this.vitals.innerHTML = `<div class="stab ${cls}"><span>${stabilityLabel(p.stability)}</span><i style="width:${p.stability.toFixed(0)}%"></i></div>
      <div class="nums"><span>HR <b>${v.rhythm === 'vf' ? 'VF' : v.hr}</b></span><span>SpO₂ <b>${v.spo2 || '--'}%</b></span><span>RR <b>${v.rr}</b></span></div>`;
    if (this.checking) {
      this.checking.t += dt;
      const frac = Math.min(1, this.checking.t / this.hooks.checkSeconds);
      const btn = this.checksEl.querySelector(`[data-id="${this.checking.id}"] .prog`) as HTMLElement | null;
      if (btn) btn.style.width = `${frac * 100}%`;
      if (frac >= 1) {
        p.revealed.push(this.checking.id);
        this.checking = null;
        this.hooks.sound('beep');
        this.renderChecks();
        this.renderFindings();
      }
    }
    if (this.stage === 'aim') {
      this.holding = shiftHeld;
      this.breath = shiftHeld ? Math.max(0, this.breath - dt / 2.5) : Math.min(1, this.breath + dt / 3);
      const r = this.reticlePos();
      this.reticle.setAttribute('transform', `translate(${r.x.toFixed(1)} ${r.y.toFixed(1)})`);
      this.reticle.classList.toggle('steady', this.holding && this.breath > 0);
      this.breathEl.style.width = `${this.breath * 100}%`;
      if (!this.breathEl.parentElement) this.stageEl.appendChild(h('div', { class: 'tr-breathwrap' }, h('span', {}, 'Breath'), this.breathEl));
    }
    if (this.stage === 'timing' && this.proc?.timing) {
      this.timingT += dt;
      const mark = this.bar.querySelector('.mark') as HTMLElement | null;
      if (mark) mark.style.left = `${timingMarker(this.timingT, this.proc.timing.speed) * 100}%`;
    }
  }
}

function woundSvg(w: { x: number; y: number }) {
  return `<ellipse cx="${w.x}" cy="${w.y}" rx="6" ry="10" fill="#9b111e"/><ellipse cx="${w.x + 1}" cy="${w.y + 14}" rx="3" ry="6" fill="#b3202e" opacity="0.8"/>`;
}
