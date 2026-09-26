import './ui/styles.css';
import { Game } from './game/Game';

const root = document.getElementById('app')!;
try {
  const game = new Game(root);
  (window as unknown as { gtaGood: Game }).gtaGood = game;
  game.start();
} catch (err) {
  console.error(err);
  root.innerHTML = `<div class="fatal"><h1>GTA Good couldn't start</h1><p>${String(err instanceof Error ? err.message : err)}</p><p>It needs WebGL — use a current version of Chrome, Edge, Firefox or Safari.</p></div>`;
}
