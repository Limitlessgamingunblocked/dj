/*
 * The results screen after every set (Section 6.9): the grade (D → S), the
 * vibe over the whole set against the slot's target curve, the best
 * transition, the crowd's peak moment, the fame, cash and followers earned,
 * milestones, and a word from the promoter. The replay buffer still holds
 * the set here (Section 12.6): save it, or replay the best transition in the
 * trim editor, before it's cleared when this screen closes.
 */
import { MILESTONE_LABEL, type GigResults } from '../game/Gig';
import { SLOTS, TRANSITION_LABEL } from '../game/vibe';
import { h } from './dom';
import { openModal } from './modal';

export interface ResultsHooks {
  /** the headline: your name, as the room knew it tonight */
  dj: string;
  again(): void;
  studio(): void;
  /** the replay buffer has the set: save it (Section 12.6) */
  saveHighlights?(): Promise<boolean>;
  /** save the buffer and open the trim editor on this moment */
  replay?(label: string): void;
  /** the screen closed (the buffer is cleared after this) */
  closed?(): void;
  /** what's next on the career path ("Rooftop Bar at fame 150: 40 to go") */
  next?: string;
  /** the booking's bonus objective, and whether you hit it */
  objective?: { text: string; met: boolean } | null;
  /** a B2B: the chemistry you built with the rival */
  chemistry?: { name: string; value: number; unlocked: boolean } | null;
}

const NEW_KIND: Record<string, string> = { venue: 'Venue', item: 'Wardrobe', set: 'Outfit', hair: 'Hair', title: 'Title', reputation: 'Reputation', story: 'Story' };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** what the promoter says about the set */
function promoterLine(r: GigResults): string {
  const slot = SLOTS[r.config.slot];
  switch (r.grade) {
    case 'S':
      return "That was special. People will talk about that one. You're back whenever you want.";
    case 'A':
      return `Proper ${slot.label.toLowerCase()} set. The room was yours.`;
    case 'B':
      return 'Solid. A couple of rough edges, but they were dancing.';
    case 'C':
      return `It got there in the end. Watch the energy for a ${slot.label.toLowerCase()}.`;
    default:
      return "Tough night. Tighten the mixes and read the room, and we'll go again.";
  }
}

/** the vibe across the set, with the band the slot wanted behind it */
function graph(r: GigResults): HTMLCanvasElement {
  // drawn near the size it's shown at in the wide dialog, so the axis text stays small
  const W = 1120;
  const H = 190;
  const c = h('canvas', { width: W * 2, height: H * 2, class: 'res-graph', 'aria-label': `Vibe over the set: average ${Math.round(r.average * 100)} percent` }) as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  const pts = r.timeline;
  const tMax = Math.max(60, pts.length ? pts[pts.length - 1].t : 60);
  const x = (t: number) => 34 + (t / tMax) * (W - 44);
  const y = (v: number) => 10 + (1 - v) * (H - 34);
  // grid
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.font = '11px "Barlow Condensed", sans-serif';
  g.lineWidth = 1;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    g.beginPath();
    g.moveTo(34, y(v));
    g.lineTo(W - 10, y(v));
    g.stroke();
    g.fillText(`${v * 100}`, 6, y(v) + 4);
  }
  for (let m = 0; m <= tMax / 60; m += Math.max(1, Math.round(tMax / 60 / 6))) g.fillText(`${m}m`, x(m * 60) - 6, H - 6);
  // the slot's target, as a band
  const slot = SLOTS[r.config.slot];
  const len = r.config.minutes * 60;
  g.beginPath();
  for (let t = 0; t <= tMax; t += tMax / 80) g.lineTo(x(t), y(Math.min(1, slot.target(Math.min(1, t / len)) + 0.1)));
  for (let t = tMax; t >= 0; t -= tMax / 80) g.lineTo(x(t), y(Math.max(0, slot.target(Math.min(1, t / len)) - 0.1)));
  g.closePath();
  g.fillStyle = 'rgba(255,181,71,0.13)';
  g.fill();
  // the room's energy, faint
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(x(p.t), y(p.energy)) : g.moveTo(x(p.t), y(p.energy))));
  g.strokeStyle = 'rgba(255,181,71,0.5)';
  g.setLineDash([3, 4]);
  g.stroke();
  g.setLineDash([]);
  // the vibe
  const grad = g.createLinearGradient(0, y(1), 0, y(0));
  grad.addColorStop(0, '#b6ff3b');
  grad.addColorStop(0.45, '#ff2e88');
  grad.addColorStop(1, '#7a3cff');
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(x(p.t), y(p.vibe)) : g.moveTo(x(p.t), y(p.vibe))));
  g.strokeStyle = grad;
  g.lineWidth = 2.5;
  g.stroke();
  // the peak
  if (r.peak.vibe > 0) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x(r.peak.t), y(r.peak.vibe), 4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** a number counting up to its value */
function countUp(el: HTMLElement, to: number, prefix = ''): void {
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 1200);
    el.textContent = `${prefix}${Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString()}`;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

export function showResults(r: GigResults, venueName: string, hooks: ResultsHooks): void {
  const best = r.best;
  const stat = (label: string, value: string | HTMLElement, note?: string) => h('div', { class: 'res-stat' }, h('span', {}, label), typeof value === 'string' ? h('b', {}, value) : value, note ? h('small', {}, note) : null);
  const fame = h('b', {}, '0');
  const cash = h('b', {}, '0');
  const fol = h('b', {}, '0');
  const replay = h('button', { class: 'btn', type: 'button', disabled: !hooks.replay || !best, title: hooks.replay ? 'Watch it again in the trim editor (saves the replay buffer to My Sets)' : 'The replay buffer is off' }, 'Replay') as HTMLButtonElement;
  const save = h('button', { class: 'btn', type: 'button', disabled: !hooks.saveHighlights, title: hooks.saveHighlights ? 'Save the replay buffer (the last few minutes of the set) to My Sets' : 'The replay buffer is off: turn it on in the recording settings' }, 'Save highlights') as HTMLButtonElement;
  const news = r.outcome.unlocked.filter((n) => n.kind !== 'tier');
  const again = h('button', { class: 'btn', type: 'button' }, 'Play again');
  const studio = h('button', { class: 'btn primary', type: 'button' }, 'Back to the decks');
  const content = h(
    'div',
    { class: 'results' },
    h(
      'div',
      { class: 'res-top' },
      h('div', { class: `res-grade g-${r.grade}`, 'aria-label': `Grade ${r.grade}` }, r.grade),
      h(
        'div',
        { class: 'res-head' },
        h('span', { class: 'res-kicker' }, `${venueName} · ${SLOTS[r.config.slot].label} · ${r.config.minutes} min${r.encore ? ' · encore' : ''}`),
        h('h2', { class: 'res-dj' }, hooks.dj),
        h('p', { class: 'res-promoter' }, h('b', {}, 'Promoter: '), promoterLine(r)),
        h('div', { class: 'res-nums' }, stat('Average vibe', `${Math.round(r.average * 100)}%`), stat('Score', r.score.toLocaleString(), r.score !== r.points ? `${r.points.toLocaleString()} × assist` : undefined), stat('Transitions', String(r.transitions)), stat('Best streak', r.bestStreak >= 2 ? `${r.bestStreak}` : '—', r.streakBonus ? `+${r.streakBonus.toLocaleString()}` : undefined), stat('Requests', r.requests.asked ? `${r.requests.met}/${r.requests.asked}` : '—'), stat('Mistakes', String(r.mistakes))),
      ),
    ),
    graph(r),
    h('div', { class: 'res-legend' }, h('i', { class: 'l-vibe' }), 'Vibe', h('i', { class: 'l-energy' }), 'Your energy', h('i', { class: 'l-target' }), `What a ${SLOTS[r.config.slot].label.toLowerCase()} wants`),
    h(
      'div',
      { class: 'res-cards' },
      h('div', { class: 'res-card' }, h('span', {}, 'Best transition'), h('b', {}, best ? `${TRANSITION_LABEL[best.name]} +${best.points}` : 'No named transitions yet'), best ? h('small', {}, `at ${mmss(best.t)}`) : h('small', {}, 'Try a bass swap or a long blend'), replay),
      h('div', { class: 'res-card' }, h('span', {}, 'Crowd peak'), h('b', {}, `${Math.round(r.peak.vibe * 100)}% at ${mmss(r.peak.t)}`), h('small', {}, r.peak.why || 'They were with you')),
      h('div', { class: 'res-card res-earned' }, h('span', {}, 'You earned'), h('div', { class: 'res-earn' }, h('div', {}, fame, h('small', {}, 'fame')), h('div', {}, cash, h('small', {}, 'cash')), h('div', {}, fol, h('small', {}, 'followers'))), r.tierUp ? h('small', { class: 'res-tier' }, `Fame tier ${r.tierUp} reached. New gear in the wardrobe.`) : null),
    ),
    hooks.objective ? h('div', { class: `res-objective ${hooks.objective.met ? 'met' : 'missed'}` }, h('b', {}, hooks.objective.met ? 'Bonus hit: ' : 'Bonus missed: '), hooks.objective.text, hooks.objective.met ? ' (+25%)' : '') : null,
    hooks.chemistry ? h('div', { class: `res-objective ${hooks.chemistry.value >= 0.75 ? 'met' : ''}` }, h('b', {}, `Chemistry with ${hooks.chemistry.name}: ${Math.round(hooks.chemistry.value * 100)}%`), hooks.chemistry.unlocked ? ' · their pieces are in your wardrobe' : hooks.chemistry.value >= 0.75 ? '' : ' · 75% unlocks their pieces') : null,
    r.milestones.length ? h('div', { class: 'res-miles' }, ...r.milestones.map((m) => h('span', { class: 'res-mile' }, '★ ', MILESTONE_LABEL[m] ?? m))) : null,
    news.length ? h('div', { class: 'res-news' }, h('span', { class: 'res-news-h' }, 'New'), ...news.map((n) => h('span', { class: `res-new k-${n.kind}` }, NEW_KIND[n.kind] ? h('small', {}, NEW_KIND[n.kind]) : null, n.label.replace(/\{name\}/g, hooks.dj)))) : null,
    hooks.next ? h('p', { class: 'res-next' }, 'Next: ', hooks.next) : null,
    h('div', { class: 'res-actions' }, save, again, studio),
  );
  const modal = openModal('Set complete', content, { wide: true });
  const close = modal.close;
  modal.close = () => {
    close();
    hooks.closed?.();
  };
  save.addEventListener('click', async () => {
    save.disabled = true;
    const ok = await hooks.saveHighlights?.();
    save.textContent = ok ? 'Saved' : 'Save highlights';
    if (!ok) save.disabled = false;
  });
  replay.addEventListener('click', () => {
    if (!best) return;
    // takes its copy of the buffer before the screen closes (and the buffer is cleared)
    hooks.replay?.(TRANSITION_LABEL[best.name]);
    modal.close();
  });
  countUp(fame, r.rewards.fame, '+');
  countUp(cash, r.rewards.cash, '+$');
  countUp(fol, r.rewards.followers, '+');
  again.addEventListener('click', () => {
    modal.close();
    hooks.again();
  });
  studio.addEventListener('click', () => {
    modal.close();
    hooks.studio();
  });
  setTimeout(() => studio.focus({ preventScroll: true }), 50);
}
