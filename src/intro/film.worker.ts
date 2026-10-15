/*
 * Draws the cutscene's first act off the main thread, so the cab ride and the
 * door stay smooth while the game builds its 3D room. The page sends the
 * canvas once, then sizes and the moment the door opens; the clock is shared
 * through performance.timeOrigin.
 */
import { Film, type FilmState } from './film';

type Msg =
  | { type: 'init'; canvas: OffscreenCanvas; w: number; h: number; epoch: number; clock: { t0: number; start: number; rate: number }; state: FilmState }
  | { type: 'size'; w: number; h: number }
  | { type: 'state'; state: Partial<FilmState> }
  | { type: 'epoch'; epoch: number }
  | { type: 'stop' };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let film: Film | null = null;
let epoch = 0;
let state: FilmState | null = null;
let running = false;

let clock = { t0: 0, start: 0, rate: 1 };
const wall = () => (performance.timeOrigin + performance.now()) / 1000;
const now = () => clock.t0 + (wall() - clock.t0) * clock.rate + clock.start - epoch;
const next = (fn: () => void) => (typeof scope.requestAnimationFrame === 'function' ? scope.requestAnimationFrame(fn) : setTimeout(fn, 16));

function loop(): void {
  if (!running || !film || !state) return;
  film.draw(now(), state);
  next(loop);
}

scope.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    film = new Film(m.canvas);
    film.resize(m.w, m.h);
    epoch = m.epoch;
    clock = m.clock;
    state = m.state;
    running = true;
    loop();
  } else if (m.type === 'size') film?.resize(m.w, m.h);
  else if (m.type === 'state' && state) Object.assign(state, m.state);
  else if (m.type === 'epoch') epoch = m.epoch;
  else if (m.type === 'stop') {
    running = false;
    film = null;
    scope.close();
  }
};
