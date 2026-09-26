import { api } from '../api';
import { formatMm, h, icon } from '../dom';
import { overhangArea, surfaceArea } from '../recon/mesh';
import { fromBinaryStl } from '../recon/stl';
import { go } from '../router';
import { Viewer } from '../viewer';
import { insightsPanel } from './insights';
import { topbar } from './shell';

/** A saved model: 3D preview, size, download, estimates. */
export function renderModel(root: HTMLElement, id: string) {
  const stage = h('div.viewer', {}, h('p.viewer-loading', {}, 'Loading model…'));
  const side = h('aside.side');
  const insights = insightsPanel();
  let viewer: Viewer | null = null;

  root.append(
    h(
      'div.page',
      {},
      topbar(() => insights.refresh()),
      h(
        'main.container',
        {},
        h('a.back', { href: '#/models' }, icon('back', 16), 'My models'),
        h('div.workspace', {}, stage, side),
      ),
    ),
  );

  (async () => {
    try {
      const models = await api.listModels();
      const m = models.find((x) => x.id === id);
      if (!m) throw new Error('That model doesn’t exist, or it belongs to another account.');
      const stl = await api.modelStl(id);
      const mesh = fromBinaryStl(stl);
      stage.replaceChildren();
      viewer = new Viewer(stage);
      viewer.setMesh(mesh);
      const del = h('button.ghost', { type: 'button' }, icon('trash', 18), 'Delete');
      del.addEventListener('click', async () => {
        if (!confirm(`Delete “${m.name}”? This can’t be undone.`)) return;
        await api.deleteModel(id);
        go('/models');
      });
      side.append(
        h('h1.model-title', {}, m.name),
        h(
          'section.card',
          {},
          h('h3', {}, icon('ruler', 18), 'Print size'),
          h(
            'div.dims',
            {},
            h('div', {}, h('span', {}, 'Width'), h('b', {}, formatMm(m.widthMm, 'mm'))),
            h('div', {}, h('span', {}, 'Depth'), h('b', {}, formatMm(m.depthMm, 'mm'))),
            h('div', {}, h('span', {}, 'Height'), h('b', {}, formatMm(m.heightMm, 'mm'))),
          ),
        ),
        h('div.actions', {}, h('a.primary.button', { href: api.stlUrl(id) }, icon('download', 18), 'Download STL'), del),
        insights.el,
      );
      insights.update({ volumeMm3: m.volumeMm3, areaMm2: surfaceArea(mesh), heightMm: m.heightMm, overhangMm2: overhangArea(mesh) });
    } catch (err) {
      stage.replaceChildren(h('p.form-error', {}, err instanceof Error ? err.message : 'Couldn’t load that model.'));
    }
  })();

  return () => viewer?.dispose();
}
