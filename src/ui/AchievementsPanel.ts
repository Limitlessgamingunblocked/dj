/*
 * The achievements wall, from Home: every achievement with its bronze,
 * silver and gold levels and how far to the next, then the milestones, then
 * your career totals. Opening it awards anything already reached (an old
 * career gets its levels the first time). The rules live in
 * game/achievements.ts.
 */
import type { Career } from '../game/Career';
import { achievementRows, achievementScore, earnedLabel, goalText, LEVELS, type Earned } from '../game/achievements';
import { MILESTONES } from '../game/progression';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';
import { toast } from './toast';

const n = (x: number) => Math.round(x).toLocaleString();

/** say what was earned: a toast each, or one for a batch (an old career's first visit) */
export function announceEarned(got: Earned[]): void {
  if (got.length > 2) toast(`${got.length} achievement levels earned (+$${got.reduce((s, g) => s + g.cash, 0).toLocaleString()})`);
  else for (const g of got) toast(`Achievement: ${earnedLabel(g)} (+$${g.cash})`);
}

export function openAchievements(career: Career): ModalHandle {
  announceEarned(career.checkAchievements());
  const p = career.progress;
  const score = achievementScore(p);
  const rows = achievementRows(p).sort((a, b) => b.level - a.level || b.k - a.k);
  const medals = (level: number) =>
    h(
      'span',
      { class: 'ach-medals', 'aria-label': level ? `${LEVELS[level - 1]} reached` : 'No level yet' },
      ...LEVELS.map((name, i) => h('i', { class: `m${i + 1}${i < level ? ' on' : ''}`, title: name })),
    );
  const card = (r: (typeof rows)[number]) =>
    h(
      'article',
      { class: `ach-card lv${r.level}` },
      h('div', { class: 'ach-top' }, h('b', {}, r.a.label), medals(r.level)),
      h('span', { class: 'ach-goal' }, r.next ?? `Gold: ${goalText(r.a, 2)}`),
      h('div', { class: 'bk-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(r.k * 100)) }, h('i', { style: `width:${(r.k * 100).toFixed(1)}%` })),
      h('span', { class: 'ach-num' }, r.next ? `${n(r.value)} / ${n(r.a.goals[r.level])} · +$${r.pay}` : `${n(r.value)} · complete`),
    );
  const milestones = MILESTONES.map((m) => {
    const done = p.milestones.includes(m.id);
    return h('li', { class: done ? 'done' : '' }, h('span', { class: 'ach-tick', 'aria-hidden': 'true' }, done ? '✓' : ''), h('b', {}, m.label), h('small', {}, m.reward));
  });
  const totals: [string, number][] = [
    ['sets', p.setsPlayed],
    ['minutes played', p.stats.minutes ?? 0],
    ['perfect transitions', p.stats.perfect ?? 0],
    ['bass swaps', p.stats.bass_swaps ?? 0],
    ['drops', p.stats.drops ?? 0],
    ['S grades', p.stats['grade:S'] ?? 0],
    ['cash earned', p.stats.cash_earned ?? 0],
    ['spent in the shop', p.stats.shop_spent ?? 0],
  ];
  const doneM = MILESTONES.filter((m) => p.milestones.includes(m.id)).length;
  return openModal(
    'Achievements',
    h(
      'div',
      { class: 'ach' },
      h('div', { class: 'ach-head' }, h('b', {}, `${score.got} / ${score.of}`), h('span', {}, 'levels earned'), h('div', { class: 'bk-bar' }, h('i', { style: `width:${((score.got / score.of) * 100).toFixed(1)}%` }))),
      h('div', { class: 'ach-grid' }, ...rows.map(card)),
      h('h3', { class: 'ach-h' }, `Milestones · ${doneM} of ${MILESTONES.length}`),
      h('ul', { class: 'ach-milestones' }, ...milestones),
      h('h3', { class: 'ach-h' }, 'Career totals'),
      h('div', { class: 'ach-totals' }, ...totals.map(([label, v]) => h('div', {}, h('b', {}, n(v)), h('span', {}, label)))),
    ),
    { wide: true },
  );
}
