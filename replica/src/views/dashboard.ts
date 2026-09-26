import { api, isPreview, type SavedModel } from '../api';
import { confirmClick, formatMm, h, icon, toast } from '../dom';
import { saveStl } from '../platform';
import { go } from '../router';
import { currentGoal, state } from '../state';
import { topbar } from './shell';

/** The signed-in home: your saved models and a button to start a new scan. */
export function renderDashboard(root: HTMLElement) {
  const grid = h('div.model-grid', { 'aria-busy': 'true' }, h('p.muted', {}, 'Loading your models…'));
  const subtitle = h('p.muted');
  const setSubtitle = () => {
    subtitle.textContent =
      currentGoal() === 'sell'
        ? 'Scan the items you make, then price every print before you list it.'
        : 'Scan anything around you and print your own copy.';
  };
  setSubtitle();

  const newScan = h('button.primary', { type: 'button', onclick: () => go('/scan') }, icon('plus', 18), 'New scan');

  root.append(
    h(
      'div.page',
      {},
      topbar(setSubtitle),
      h(
        'main.container',
        {},
        h('div.page-head', {}, h('div', {}, h('h1', {}, `Hi, ${state.user!.name.split(' ')[0]}`), subtitle), newScan),
        h('h2.section-title', {}, 'My models'),
        isPreview ? h('p.preview-note', {}, 'Preview: saved models are kept in this browser.') : null,
        grid,
      ),
    ),
  );

  const card = (m: SavedModel) => {
    const del = h('button.icon-btn', { type: 'button', title: 'Delete', 'aria-label': `Delete ${m.name}` }, icon('trash', 18));
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirmClick(del, 'Delete?')) return;
      try {
        await api.deleteModel(m.id);
        el.remove();
        if (!grid.querySelector('.model-card')) showEmpty();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Couldn’t delete that model.');
      }
    });
    const dl = h('button.icon-btn', { type: 'button', title: 'Download STL', 'aria-label': `Download ${m.name}` }, icon('download', 18));
    dl.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const msg = await saveStl(await api.modelStl(m.id), m.name);
        if (msg) toast(msg);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Couldn’t download that model.');
      }
    });
    const el = h(
      'a.model-card',
      { href: `#/model/${encodeURIComponent(m.id)}` },
      h('div.thumb', {}, m.thumbnail ? h('img', { src: m.thumbnail, alt: '' }) : icon('cube', 40)),
      h(
        'div.model-meta',
        {},
        h('b', {}, m.name),
        h('span', {}, `${formatMm(m.widthMm, 'mm')} × ${formatMm(m.depthMm, 'mm')} × ${formatMm(m.heightMm, 'mm')}`),
        h('span.date', {}, new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })),
      ),
      h(
        'div.model-actions',
        {},
        dl,
        del,
      ),
    );
    return el;
  };

  const showEmpty = () => {
    grid.replaceChildren(
      h(
        'div.empty',
        {},
        icon('turntable', 44),
        h('h3', {}, 'No models yet'),
        h('p.muted', {}, 'Film an item spinning on a turntable and it will show up here.'),
        h('button.primary', { type: 'button', onclick: () => go('/scan') }, 'Scan your first item'),
      ),
    );
  };

  api
    .listModels()
    .then((models) => {
      grid.removeAttribute('aria-busy');
      if (models.length === 0) showEmpty();
      else grid.replaceChildren(...models.map(card));
    })
    .catch((err) => {
      grid.replaceChildren(h('p.form-error', {}, err.message));
    });
}
