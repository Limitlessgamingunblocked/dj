import { api, type Goal } from '../api';
import { h, icon } from '../dom';
import { go } from '../router';
import { currentGoal, rememberGoal, state } from '../state';

export function logo(): HTMLElement {
  return h('a.logo', { href: state.user ? '#/models' : '#/welcome', 'aria-label': 'Replica home' }, icon('cube', 26), h('span', {}, 'Replica'));
}

/** Sell / For fun switch; saves to the account when signed in. */
export function goalSwitch(onChange?: (goal: Goal) => void): HTMLElement {
  const wrap = h('div.segmented', { role: 'group', 'aria-label': 'What you are making prints for' });
  const make = (goal: Goal, label: string) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(currentGoal() === goal) }, label);
    b.addEventListener('click', async () => {
      if (currentGoal() === goal) return;
      rememberGoal(goal);
      if (state.user) {
        state.user = { ...state.user, goal };
        api.setGoal(goal).catch(() => undefined);
      }
      for (const btn of wrap.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn === b));
      onChange?.(goal);
    });
    return b;
  };
  wrap.append(make('sell', 'Selling'), make('fun', 'For fun'));
  return wrap;
}

export function topbar(onGoalChange?: (goal: Goal) => void): HTMLElement {
  const user = state.user!;
  const logout = h('button.ghost.small', { type: 'button', title: 'Log out' }, icon('logout', 18), h('span.hide-sm', {}, 'Log out'));
  logout.addEventListener('click', async () => {
    await api.logout().catch(() => undefined);
    state.user = null;
    go('/welcome');
  });
  return h(
    'header.topbar',
    {},
    logo(),
    h('div.topbar-right', {}, goalSwitch(onGoalChange), h('span.user-name.hide-sm', { title: user.email }, user.name), logout),
  );
}
