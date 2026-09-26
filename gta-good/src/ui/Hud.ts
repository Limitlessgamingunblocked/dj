import { fmtTime } from '../core/math';
import { G_LIMIT, stabilityLabel, toolById, type ToolId, type Vitals } from '../core/medical';
import { h } from './dom';
import type { Minimap } from './Minimap';
import { createWheel, type Wheel } from './Wheel';

export interface HudPatient {
  name: string;
  label: string;
  stability: number;
  vitals: Vitals;
  aboard: boolean;
}

export interface HudState {
  merit: number;
  rank: string;
  district: string;
  missionTitle: string | null;
  objective: string;
  timer: { label: string; left: number } | null;
  inVehicle: boolean;
  speedKmh: number;
  siren: boolean;
  sirenMode: string;
  vehicleName: string;
  capacity: number;
  aboard: number;
  tool: ToolId;
  patients: HudPatient[];
  gLat: number;
  gLong: number;
  prompt: string | null;
  arrow: { x: number; y: number; angle: number; dist: number; onScreen: boolean } | null;
}

type ToastKind = 'info' | 'good' | 'warn' | 'bad' | 'dispatch';

export class Hud {
  readonly el: HTMLElement;
  private merit = h('div', { class: 'merit' });
  private rank = h('div', { class: 'rank' });
  private district = h('div', { class: 'district' });
  private mission = h('div', { class: 'mission' });
  private objective = h('div', { class: 'objective' });
  private timer = h('div', { class: 'timer hidden' });
  private patients = h('div', { class: 'patients' });
  private ecg = h('canvas', { class: 'ecg', width: 440, height: 110 });
  private gmeter = h('canvas', { class: 'gmeter', width: 180, height: 180 });
  private speed = h('div', { class: 'speed' });
  private siren = h('div', { class: 'siren' });
  private vehicle = h('div', { class: 'vehicle' });
  private seats = h('div', { class: 'seats' });
  private tool = h('div', { class: 'toolchip' });
  private prompt = h('div', { class: 'prompt hidden' });
  private toasts = h('div', { class: 'toasts' });
  private offer = h('div', { class: 'offer hidden' });
  private arrow = h('div', { class: 'objarrow hidden' }, h('i'), h('span'));
  private wheelWrap = h('div', { class: 'fieldwheel hidden' });
  readonly wheel: Wheel;
  private ecgX = 0;
  private ecgPhase = 0;
  private ecgLast = 0;
  private lastText = '';
  onBeat: (() => void) | null = null;

  constructor(minimap: Minimap, onPickTool: (t: ToolId) => void) {
    this.wheel = createWheel(onPickTool);
    this.wheelWrap.append(this.wheel.el, h('div', { class: 'hint' }, 'Click a tool or press 1–6 · release Tab to close'));
    const patientBox = h('div', { class: 'patientbox hidden' }, h('div', { class: 'ph' }, 'Patient monitor'), this.ecg, this.patients, h('div', { class: 'gwrap' }, this.gmeter, h('div', { class: 'glabel' }, 'Ride g-force', h('small', {}, `Keep the dot inside the ring (${G_LIMIT} g)`))));
    this.el = h(
      'div',
      { class: 'hud' },
      h('div', { class: 'tl' }, h('div', { class: 'brand' }, 'GTA', h('b', {}, 'GOOD')), this.rank, this.merit, this.district),
      h('div', { class: 'tc' }, this.mission, this.objective),
      h('div', { class: 'tr' }, this.timer),
      h('div', { class: 'rightcol' }, patientBox),
      h('div', { class: 'bl' }, minimap.el),
      h('div', { class: 'br' }, this.speed, this.siren, this.vehicle, this.seats, this.tool),
      h('div', { class: 'bc' }, this.toasts, this.prompt),
      h('div', { class: 'keyhints' }, 'M Dispatch · Q Siren · R Tone · H Horn · F Exit/Enter · E Interact · Tab Gear · C Camera · Esc Menu'),
      this.offer,
      this.arrow,
      this.wheelWrap,
    );
  }

  toast(text: string, kind: ToastKind = 'info', seconds = 4) {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild?.remove();
    setTimeout(() => t.classList.add('out'), seconds * 1000);
    setTimeout(() => t.remove(), seconds * 1000 + 400);
  }

  setOffer(label: string | null, secondsLeft = 0) {
    if (!label) {
      this.offer.classList.add('hidden');
      return;
    }
    this.offer.classList.remove('hidden');
    this.offer.innerHTML = '';
    this.offer.append(
      h('div', { class: 'oh' }, h('span', { class: 'dot' }), 'Dispatch — incoming call'),
      h('div', { class: 'ol' }, label),
      h('div', { class: 'ok' }, h('kbd', {}, 'Y'), ' respond   ', h('kbd', {}, 'N'), ` decline  ·  ${Math.ceil(secondsLeft)}s`),
    );
  }

  showWheel(on: boolean) {
    this.wheelWrap.classList.toggle('hidden', !on);
  }

  setVisible(on: boolean) {
    this.el.classList.toggle('hidden', !on);
  }

  update(s: HudState, dt: number) {
    const text = [s.merit, s.rank, s.district, s.missionTitle, s.objective, s.inVehicle, s.vehicleName, s.capacity, s.aboard, s.tool, s.siren, s.sirenMode, s.prompt].join('|');
    if (text !== this.lastText) {
      this.lastText = text;
      this.merit.innerHTML = `<b>${s.merit.toLocaleString()}</b> merit`;
      this.rank.textContent = s.rank;
      this.district.textContent = s.district;
      this.mission.textContent = s.missionTitle ?? 'On patrol';
      this.objective.textContent = s.objective;
      this.siren.className = `siren${s.siren ? ' on' : ''}`;
      this.siren.innerHTML = s.inVehicle ? `<i></i>${s.siren ? `SIREN ${s.sirenMode.toUpperCase()}` : 'Siren off'} <kbd>Q</kbd>` : '';
      this.vehicle.textContent = s.inVehicle ? s.vehicleName : 'On foot';
      this.seats.innerHTML = Array.from({ length: s.capacity }, (_, k) => `<i class="${k < s.aboard ? 'full' : ''}"></i>`).join('');
      const t = toolById(s.tool);
      this.tool.innerHTML = `<span>Gear</span> ${t.short} <kbd>Tab</kbd>`;
      this.prompt.classList.toggle('hidden', !s.prompt);
      if (s.prompt) this.prompt.innerHTML = s.prompt;
    }
    this.speed.innerHTML = s.inVehicle ? `<b>${Math.round(s.speedKmh)}</b><span>km/h</span>` : '';
    if (s.timer) {
      this.timer.classList.remove('hidden');
      const urgent = s.timer.left < 30;
      this.timer.className = `timer${urgent ? ' urgent' : ''}`;
      this.timer.innerHTML = `<span>${s.timer.label}</span><b>${fmtTime(s.timer.left)}</b>`;
    } else this.timer.classList.add('hidden');

    const box = this.patients.parentElement!;
    box.classList.toggle('hidden', s.patients.length === 0);
    if (s.patients.length) {
      this.patients.innerHTML = s.patients
        .map((p) => {
          const cls = p.stability >= 75 ? 'ok' : p.stability >= 45 ? 'warn' : 'crit';
          const hr = p.vitals.rhythm === 'vf' ? 'VF' : p.vitals.rhythm === 'flat' ? '—' : p.vitals.hr;
          return `<div class="pt ${cls}"><div class="pn">${p.name}<small>${p.label}${p.aboard ? ' · aboard' : ''}</small></div>
            <div class="stab"><span>${stabilityLabel(p.stability)} ${Math.round(p.stability)}%</span><i style="width:${p.stability.toFixed(1)}%"></i></div>
            <div class="nums"><span>HR <b>${hr}</b></span><span>SpO₂ <b>${p.vitals.spo2 || '--'}</b></span><span>RR <b>${p.vitals.rr}</b></span></div></div>`;
        })
        .join('');
      this.drawEcg(s.patients[0].vitals, dt, s.patients[0].aboard);
      this.drawG(s.gLat, s.gLong, s.inVehicle && s.patients.some((p) => p.aboard));
    }

    if (s.arrow && !s.arrow.onScreen) {
      this.arrow.classList.remove('hidden');
      this.arrow.style.transform = `translate(${s.arrow.x}px, ${s.arrow.y}px)`;
      (this.arrow.firstChild as HTMLElement).style.transform = `rotate(${s.arrow.angle}rad)`;
      (this.arrow.lastChild as HTMLElement).textContent = `${Math.round(s.arrow.dist)} m`;
    } else if (s.arrow) {
      this.arrow.classList.remove('hidden');
      this.arrow.style.transform = `translate(${s.arrow.x}px, ${s.arrow.y}px)`;
      (this.arrow.firstChild as HTMLElement).style.transform = 'rotate(1.5708rad)';
      (this.arrow.lastChild as HTMLElement).textContent = `${Math.round(s.arrow.dist)} m`;
    } else this.arrow.classList.add('hidden');
  }

  private drawEcg(v: Vitals, dt: number, beep: boolean) {
    const c = this.ecg;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const speed = 150; // px per second
    const steps = Math.max(1, Math.round(dt * speed));
    ctx.lineWidth = 3;
    ctx.strokeStyle = v.rhythm === 'vf' || v.rhythm === 'flat' ? '#ff4d4d' : '#39f08a';
    for (let k = 0; k < steps; k++) {
      const x = this.ecgX;
      ctx.fillStyle = '#071410';
      ctx.fillRect(x, 0, 14, H);
      const period = v.hr > 0 ? 60 / v.hr : 1;
      const prev = this.ecgPhase;
      this.ecgPhase += 1 / speed / period;
      let y = 0;
      if (v.rhythm === 'vf') y = Math.sin(this.ecgPhase * 23) * 0.3 + Math.sin(this.ecgPhase * 37 + 1) * 0.2;
      else if (v.rhythm !== 'flat') {
        const u = this.ecgPhase % 1;
        if (Math.floor(this.ecgPhase) !== Math.floor(prev) && beep) this.onBeat?.();
        y = pqrst(u);
      }
      const py = H * 0.6 - y * H * 0.45;
      ctx.beginPath();
      ctx.moveTo(x - 1, this.ecgLast);
      ctx.lineTo(x, py);
      ctx.stroke();
      this.ecgLast = py;
      this.ecgX = (x + 1) % W;
    }
  }

  private drawG(lat: number, long: number, active: boolean) {
    const c = this.gmeter;
    const ctx = c.getContext('2d')!;
    const S = c.width;
    const m = S / 2;
    const scale = (S / 2 - 12) / 1.0;
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m, m, scale, 0, Math.PI * 2);
    ctx.moveTo(m - scale, m);
    ctx.lineTo(m + scale, m);
    ctx.moveTo(m, m - scale);
    ctx.lineTo(m, m + scale);
    ctx.stroke();
    ctx.strokeStyle = active ? '#39f08a' : 'rgba(57,240,138,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m, m, G_LIMIT * scale, 0, Math.PI * 2);
    ctx.stroke();
    const g = Math.hypot(lat, long);
    ctx.fillStyle = g > G_LIMIT ? '#ff4d4d' : '#ffffff';
    ctx.beginPath();
    // The dot shows the force the patient feels: pushed back when accelerating, forward when braking.
    ctx.arc(m + Math.max(-1, Math.min(1, -lat)) * scale, m + Math.max(-1, Math.min(1, long)) * scale, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function pqrst(u: number): number {
  const g = (c: number, w: number, a: number) => a * Math.exp(-(((u - c) / w) ** 2));
  return g(0.18, 0.03, 0.12) + g(0.3, 0.008, -0.12) + g(0.32, 0.012, 1) + g(0.345, 0.01, -0.25) + g(0.55, 0.05, 0.25);
}
