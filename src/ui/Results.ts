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
import { toast } from './toast';
import { uiSound } from '../audio/uisound';
import type { DailyOut } from '../app/gigs';

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
  /** what's next on the career path ("Rooftop Bar at fame 80: 40 to go") */
  next?: string;
  /** the booking's bonus objective, and whether you hit it */
  objective?: { text: string; met: boolean } | null;
  /** a B2B: the chemistry you built with the rival */
  chemistry?: { name: string; value: number; unlocked: boolean } | null;
  /** a Room Battle: rounds won against the rival */
  battle?: { name: string; you: number; rival: number } | null;
  /** room moments that matched the drop */
  roomMoments?: number;
  /** the daily's ghost: your best run today (a faint line on the graph), and whether this run became it */
  ghost?: { pts: [number, number, number][]; score: number; beat: boolean; first: boolean } | null;
  /** make the highlight card */
  highlight?(): void;
  /** share the set as a code */
  shareCode?(): void;
  /** the regulars who moved closer (or drifted) */
  regulars?: { name: string; style: string; delta: number }[];
  /** today's daily challenge: the objectives, the streak, the result to share */
  daily?: DailyOut | null;
  /** the replay buffer's pictures around the crowd's peak, played behind the headline */
  peakStills?: Blob[];
}

/** when the grade lands (ms after the screen opens): the stamp's sound and the numbers start here */
const STAMP_AT = 420;
/** how long each picture of the peak holds before the next fades in (ms) */
const STILL_HOLD = 1300;

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
function graph(r: GigResults, ghost?: [number, number, number][] | null): HTMLCanvasElement {
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
  // the ghost: your best run today, faint
  if (ghost?.length) {
    g.beginPath();
    ghost.forEach((p, i) => (i ? g.lineTo(x(p[0]), y(p[1])) : g.moveTo(x(p[0]), y(p[1]))));
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.stroke();
    g.setLineDash([]);
  }
  // the peak
  if (r.peak.vibe > 0) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(x(r.peak.t), y(r.peak.vibe), 4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** the daily challenge's result: each objective ticked or not, the streak, and the result to copy and share */
function dailyBlock(d: DailyOut): HTMLElement {
  const copy = h('button', { class: 'btn primary small', type: 'button', title: 'Copy the result to paste anywhere' }, 'Copy result');
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(d.share).then(
      () => toast('Result copied'),
      () => toast('Couldn’t copy: select the text instead'),
    );
  });
  const met = d.goals.filter((g) => g.met).length;
  return h(
    'div',
    { class: 'res-daily' },
    h('div', { class: 'res-daily-head' }, h('b', {}, `Daily #${d.number}`), h('span', {}, d.official ? `${met}/3 objectives` : `Practice · ${met}/3`), d.streak > 1 ? h('span', { class: 'res-streak' }, `🔥 ${d.streak}-day streak`) : null),
    h('ul', {}, ...d.goals.map((g) => h('li', { class: g.met ? 'met' : 'missed' }, g.met ? '✓ ' : '✗ ', g.text))),
    h('pre', { class: 'res-share mono' }, d.share),
    h('div', { class: 'res-daily-acts' }, copy, h('small', {}, d.official ? 'Your result for today. Play again for practice.' : 'Today’s result is already in. This was practice.')),
  );
}

/** a number counting up to its value (ticking as it goes, if asked) */
function countUp(el: HTMLElement, to: number, prefix = '', tick = false): void {
  const t0 = performance.now();
  let shown = -1;
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 1200);
    const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (v !== shown) {
      shown = v;
      el.textContent = `${prefix}${v.toLocaleString()}`;
      if (tick && v > 0) uiSound('tick');
    }
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

/**
 * The crowd's peak again, behind the headline: the replay buffer's pictures
 * from around it, each slowly pushing in and fading into the next, on a loop.
 * Returns a function that stops it and frees the pictures.
 */
function peakReel(host: HTMLElement, stills: Blob[], label: string): () => void {
  const urls = stills.map((b) => URL.createObjectURL(b));
  const reel = h('div', { class: 'res-reel', 'aria-hidden': 'true' });
  const imgs = urls.map((u) => h('img', { src: u, alt: '' }) as HTMLImageElement);
  reel.append(...imgs, h('span', { class: 'res-reel-label' }, label));
  host.prepend(reel);
  host.classList.add('has-reel');
  let i = 0;
  const show = () => {
    imgs.forEach((im, j) => im.classList.toggle('on', j === i));
    i = (i + 1) % imgs.length;
  };
  show();
  const timer = imgs.length > 1 ? window.setInterval(show, STILL_HOLD) : 0;
  return () => {
    clearInterval(timer);
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
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
  const top = h(
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
  );
  const card = h('button', { class: 'btn', type: 'button', title: 'A picture of the best moment, with your grade and score, to post' }, 'Highlight card');
  card.addEventListener('click', () => hooks.highlight?.());
  card.hidden = !hooks.highlight;
  const share = h('button', { class: 'btn', type: 'button', title: 'A code with your tracklist and venue, for a friend to play' }, 'Share set code');
  share.addEventListener('click', () => hooks.shareCode?.());
  share.hidden = !hooks.shareCode;
  const again = h('button', { class: 'btn', type: 'button' }, 'Play again');
  const studio = h('button', { class: 'btn primary', type: 'button' }, 'Back to the decks');
  const content = h(
    'div',
    { class: 'results' },
    top,
    graph(r, hooks.ghost?.first ? null : hooks.ghost?.pts),
    h('div', { class: 'res-legend' }, h('i', { class: 'l-vibe' }), 'Vibe', h('i', { class: 'l-energy' }), 'Your energy', h('i', { class: 'l-target' }), `What a ${SLOTS[r.config.slot].label.toLowerCase()} wants`, hooks.ghost && !hooks.ghost.first ? h('i', { class: 'l-ghost' }) : null, hooks.ghost && !hooks.ghost.first ? 'Your best run today' : null),
    hooks.ghost ? h('div', { class: `res-objective ${hooks.ghost.beat ? 'met' : ''}` }, h('b', {}, hooks.ghost.first ? 'Ghost saved: ' : hooks.ghost.beat ? 'New best run! ' : 'Your ghost won: '), hooks.ghost.first ? 'play today’s daily again to race this run.' : hooks.ghost.beat ? 'this run is your ghost now.' : `best today is ${hooks.ghost.score.toLocaleString()} points.`) : null,
    h(
      'div',
      { class: 'res-cards' },
      h('div', { class: 'res-card' }, h('span', {}, 'Best transition'), h('b', {}, best ? `${TRANSITION_LABEL[best.name]} +${best.points}` : 'No named transitions yet'), best ? h('small', {}, `at ${mmss(best.t)}`) : h('small', {}, 'Try a bass swap or a long blend'), replay),
      h('div', { class: 'res-card' }, h('span', {}, 'Crowd peak'), h('b', {}, `${Math.round(r.peak.vibe * 100)}% at ${mmss(r.peak.t)}`), h('small', {}, r.peak.why || 'They were with you')),
      h('div', { class: 'res-card res-earned' }, h('span', {}, 'You earned'), h('div', { class: 'res-earn' }, h('div', {}, fame, h('small', {}, 'fame')), h('div', {}, cash, h('small', {}, 'cash')), h('div', {}, fol, h('small', {}, 'followers'))), r.tierUp ? h('small', { class: 'res-tier' }, `Fame tier ${r.tierUp} reached. New gear in the wardrobe.`) : null),
    ),
    hooks.objective ? h('div', { class: `res-objective ${hooks.objective.met ? 'met' : 'missed'}` }, h('b', {}, hooks.objective.met ? 'Bonus hit: ' : 'Bonus missed: '), hooks.objective.text, hooks.objective.met ? ' (+25%)' : '') : null,
    hooks.daily ? dailyBlock(hooks.daily) : null,
    hooks.battle ? h('div', { class: `res-objective ${hooks.battle.you > hooks.battle.rival ? 'met' : ''}` }, h('b', {}, `Room Battle vs ${hooks.battle.name}: ${hooks.battle.you > hooks.battle.rival ? 'you won' : hooks.battle.you === hooks.battle.rival ? 'a draw' : 'they won'} ${hooks.battle.you}–${hooks.battle.rival}`), ' · the crowd voted each round') : null,
    hooks.regulars?.length ? h('div', { class: 'res-objective met' }, h('b', {}, 'Regulars: '), hooks.regulars.map((f) => `${f.name} ${f.delta > 0 ? '♥ +' : '−'}${Math.round(Math.abs(f.delta) * 100)}%`).join(' · '), hooks.regulars.some((f) => f.delta > 0) ? ' · play their music and they move up front' : '') : null,
    hooks.roomMoments ? h('div', { class: 'res-objective met' }, h('b', {}, `Room moments on the drop: ${hooks.roomMoments}`), ` · +${hooks.roomMoments * 250} points`) : null,
    hooks.chemistry ? h('div', { class: `res-objective ${hooks.chemistry.value >= 0.75 ? 'met' : ''}` }, h('b', {}, `Chemistry with ${hooks.chemistry.name}: ${Math.round(hooks.chemistry.value * 100)}%`), hooks.chemistry.unlocked ? ' · their pieces are in your wardrobe' : hooks.chemistry.value >= 0.75 ? '' : ' · 75% unlocks their pieces') : null,
    r.milestones.length ? h('div', { class: 'res-miles' }, ...r.milestones.map((m) => h('span', { class: 'res-mile' }, '★ ', MILESTONE_LABEL[m] ?? m))) : null,
    news.length ? h('div', { class: 'res-news' }, h('span', { class: 'res-news-h' }, 'New'), ...news.map((n) => h('span', { class: `res-new k-${n.kind}` }, NEW_KIND[n.kind] ? h('small', {}, NEW_KIND[n.kind]) : null, n.label.replace(/\{name\}/g, hooks.dj)))) : null,
    hooks.next ? h('p', { class: 'res-next' }, 'Next: ', hooks.next) : null,
    h('div', { class: 'res-actions' }, save, card, share, again, studio),
  );
  const modal = openModal('Set complete', content, { wide: true });
  const stopReel = hooks.peakStills?.length ? peakReel(top, hooks.peakStills, `Crowd peak · ${mmss(r.peak.t)}`) : null;
  const timers: number[] = [];
  const close = modal.close;
  modal.close = () => {
    timers.forEach((t) => clearTimeout(t));
    stopReel?.();
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
  // the grade stamps down, then the earnings count up, then anything new chimes in
  timers.push(window.setTimeout(() => uiSound('stamp'), STAMP_AT));
  timers.push(
    window.setTimeout(() => {
      countUp(fame, r.rewards.fame, '+', true);
      countUp(cash, r.rewards.cash, '+$');
      countUp(fol, r.rewards.followers, '+');
    }, STAMP_AT + 200),
  );
  if (news.length || r.tierUp) timers.push(window.setTimeout(() => uiSound('unlock'), STAMP_AT + 1600));
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
