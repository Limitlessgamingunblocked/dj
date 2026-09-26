import { api, type Goal } from '../api';
import { h, icon } from '../dom';
import { go } from '../router';
import { rememberGoal, state } from '../state';
import { logo } from './shell';

/** Opening page: the first thing anyone sees is "sell or just for fun?". */
export function renderWelcome(root: HTMLElement) {
  const choose = async (goal: Goal) => {
    rememberGoal(goal);
    if (state.user) {
      state.user = { ...state.user, goal };
      await api.setGoal(goal).catch(() => undefined);
      go('/models');
    } else {
      go('/account');
    }
  };

  const card = (goal: Goal, iconName: string, title: string, body: string, points: string[]) =>
    h(
      'button.choice',
      { type: 'button', 'data-goal': goal, onclick: () => choose(goal) },
      h('span.choice-icon', {}, icon(iconName, 28)),
      h('span.choice-title', {}, title),
      h('span.choice-body', {}, body),
      h('ul.choice-points', {}, ...points.map((p) => h('li', {}, icon('check', 16), p))),
      h('span.choice-cta', {}, 'Choose', icon('back', 16)),
    );

  root.append(
    h(
      'div.welcome',
      {},
      h('header.welcome-top', {}, logo(), state.user ? h('a.link', { href: '#/models' }, 'My models') : h('a.link', { href: '#/login' }, 'Log in')),
      h(
        'main.welcome-main',
        {},
        h('p.eyebrow', {}, 'Film it spinning. Print an exact copy.'),
        h('h1', {}, 'Are you looking to sell, or just for fun?'),
        h('p.lede', {}, 'Upload a video of any item and get a print-ready STL at its true size. Tell us what it’s for and we’ll set things up to match.'),
        h(
          'div.choices',
          {},
          card('sell', 'tag', 'I want to sell', 'Make copies to sell.', [
            'Filament, time and cost per print',
            'Suggested price after marketplace fees',
            'Batch totals for bigger runs',
          ]),
          card('fun', 'spark', 'Just for fun', 'Copy things for yourself.', [
            'Straight to a print-ready file',
            'Filament and time estimates',
            'Print tips for your model',
          ]),
        ),
        h(
          'ol.how',
          {},
          h('li', {}, h('b', {}, '1'), h('span', {}, 'Film the item on a turntable')),
          h('li', {}, h('b', {}, '2'), h('span', {}, 'We rebuild it in 3D')),
          h('li', {}, h('b', {}, '3'), h('span', {}, 'Enter one measurement, download the STL')),
        ),
      ),
    ),
  );
}
