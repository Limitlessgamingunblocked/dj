import './ui/styles.css';
import { App } from './app/App';
import { mountVjSurface } from './ui/VjSurface';
import { mountCrowdGuest } from './ui/CrowdGuest';
import { mountAuxGuest } from './ui/AuxGuest';
import { setupInstall } from './pwa/install';

setupInstall();

const root = document.getElementById('app')!;
// VJ mode's controls: their own light page, without the decks or the stage
if (location.hash === '#vj') mountVjSurface(root);
// Join the crowd: a friend on your dancefloor, from the link you sent them
else if (location.hash === '#crowd') mountCrowdGuest(root);
// Pass the aux on a player's phone: the night's clock, your turn, your vote
else if (location.hash === '#aux') mountAuxGuest(root);
else {
  const app = new App(root);
  (window as unknown as { deckhouse: App }).deckhouse = app;
  app.start().catch((err) => {
    console.error(err);
    document.querySelector('.intro')?.remove();
    root.innerHTML = `<div class="fatal"><h1>Deckhouse couldn't start</h1><p>${String(err instanceof Error ? err.message : err)}</p><p>Use a current version of Chrome, Edge, Firefox or Safari.</p></div>`;
  });
}
