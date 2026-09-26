import './styles.css';
import { api } from './api';
import { clear } from './dom';
import { go, onRoute } from './router';
import { state } from './state';
import { renderAuth } from './views/auth';
import { renderDashboard } from './views/dashboard';
import { renderModel } from './views/model';
import { renderScan } from './views/scan';
import { renderWelcome } from './views/welcome';

const root = document.getElementById('app')!;
/** Views return a cleanup function (to stop 3D viewers, workers, etc.). */
let cleanup: (() => void) | void;

function route() {
  cleanup?.();
  cleanup = undefined;
  clear(root);
  window.scrollTo(0, 0);
  const path = location.hash.replace(/^#/, '') || '/';
  const signedIn = !!state.user;

  if (path === '/' || path === '/welcome') {
    // Returning members skip straight to their models; everyone else gets the opening question.
    if (signedIn && path === '/') return go('/models');
    cleanup = renderWelcome(root);
    return;
  }
  if (path === '/account' || path === '/login') {
    if (signedIn) return go('/models');
    cleanup = renderAuth(root, path === '/login' ? 'login' : 'signup');
    return;
  }
  if (!signedIn) return go('/login');
  if (path === '/models') cleanup = renderDashboard(root);
  else if (path === '/scan') cleanup = renderScan(root);
  else if (path.startsWith('/model/')) cleanup = renderModel(root, decodeURIComponent(path.slice('/model/'.length)));
  else go('/models');
}

async function start() {
  try {
    state.user = await api.me();
  } catch {
    state.user = null;
  }
  onRoute(route);
  window.addEventListener('hashchange', route);
  route();
}

start();
