import { api } from '../api';
import { h } from '../dom';
import { go } from '../router';
import { state } from '../state';
import { logo } from './shell';

/** Create an account or log in. */
export function renderAuth(root: HTMLElement, initial: 'signup' | 'login') {
  let mode = initial;
  const goal = state.pendingGoal;

  const title = h('h1');
  const sub = h('p.muted');
  const nameField = h('label.field', {}, h('span', {}, 'Your name'), h('input', { name: 'name', autocomplete: 'name', maxlength: 80 }));
  const email = h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true, maxlength: 254 });
  const password = h('input', { name: 'password', type: 'password', required: true, minlength: 8, maxlength: 200 });
  const pwHint = h('small.hint', {}, 'At least 8 characters.');
  const error = h('p.form-error', { role: 'alert' });
  const submit = h('button.primary.wide', { type: 'submit' });
  const tabSignup = h('button', { type: 'button', role: 'tab' }, 'Create account');
  const tabLogin = h('button', { type: 'button', role: 'tab' }, 'Log in');

  const form = h(
    'form.auth-form',
    { novalidate: true },
    nameField,
    h('label.field', {}, h('span', {}, 'Email'), email),
    h('label.field', {}, h('span', {}, 'Password'), password, pwHint),
    error,
    submit,
  );

  const sync = () => {
    const signup = mode === 'signup';
    title.textContent = signup ? 'Create your account' : 'Welcome back';
    sub.textContent = signup ? 'Save your scans and come back to them any time.' : 'Log in to see your models.';
    nameField.hidden = !signup;
    pwHint.hidden = !signup;
    password.autocomplete = signup ? 'new-password' : 'current-password';
    submit.textContent = signup ? 'Create account' : 'Log in';
    tabSignup.setAttribute('aria-selected', String(signup));
    tabLogin.setAttribute('aria-selected', String(!signup));
    error.textContent = '';
    history.replaceState(null, '', signup ? '#/account' : '#/login');
  };
  tabSignup.addEventListener('click', () => ((mode = 'signup'), sync()));
  tabLogin.addEventListener('click', () => ((mode = 'login'), sync()));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const name = (nameField.querySelector('input') as HTMLInputElement).value.trim();
    if (mode === 'signup' && !name) return void (error.textContent = 'Please enter your name.');
    if (!email.value.trim()) return void (error.textContent = 'Please enter your email.');
    if (mode === 'signup' && password.value.length < 8) return void (error.textContent = 'Your password needs at least 8 characters.');
    if (!password.value) return void (error.textContent = 'Please enter your password.');
    submit.disabled = true;
    submit.textContent = mode === 'signup' ? 'Creating account…' : 'Logging in…';
    try {
      state.user =
        mode === 'signup' ? await api.signup(name, email.value.trim(), password.value, goal) : await api.login(email.value.trim(), password.value, goal);
      go('/models');
    } catch (err) {
      submit.disabled = false;
      submit.textContent = mode === 'signup' ? 'Create account' : 'Log in';
      error.textContent = err instanceof Error ? err.message : 'Something went wrong.';
    }
  });

  const goalNote = goal
    ? h('p.goal-note', {}, 'You’re here ', h('b', {}, goal === 'sell' ? 'to sell' : 'just for fun'), '. ', h('a.link', { href: '#/welcome' }, 'Change'))
    : null;

  root.append(
    h(
      'div.auth',
      {},
      h('header.welcome-top', {}, logo()),
      h(
        'main.auth-card',
        {},
        h('div.tabs', { role: 'tablist' }, tabSignup, tabLogin),
        title,
        sub,
        goalNote,
        form,
      ),
    ),
  );
  sync();
  (mode === 'signup' ? (nameField.querySelector('input') as HTMLInputElement) : email).focus();
}
