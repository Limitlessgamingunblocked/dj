import './ui/styles.css';
import { App } from './app/App';

const root = document.getElementById('app')!;
const app = new App(root);
(window as unknown as { deckhouse: App }).deckhouse = app;
app.start().catch((err) => {
  console.error(err);
  root.innerHTML = `<div class="fatal"><h1>Deckhouse couldn't start</h1><p>${String(err instanceof Error ? err.message : err)}</p><p>Use a current version of Chrome, Edge, Firefox or Safari.</p></div>`;
});
