import './ui/styles.css';
import { App } from './app/App';
import { mountVjSurface } from './ui/VjSurface';

const root = document.getElementById('app')!;
// VJ mode's controls: their own light page, without the decks or the stage
if (location.hash === '#vj') mountVjSurface(root);
else {
  const app = new App(root);
  (window as unknown as { deckhouse: App }).deckhouse = app;
  app.start().catch((err) => {
    console.error(err);
    root.innerHTML = `<div class="fatal"><h1>Deckhouse couldn't start</h1><p>${String(err instanceof Error ? err.message : err)}</p><p>Use a current version of Chrome, Edge, Firefox or Safari.</p></div>`;
  });
}
