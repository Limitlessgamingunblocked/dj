/*
 * The World Tour map: pick a run of cities (two to five), one a night, in
 * the order you click them. The map is drawn here (dotted land from rough
 * hand-made outlines, no map data); each city shows its crowd's taste, the
 * room it's in and the promoter booking you. How you travel follows your
 * tier: the van's dashed road, the train's line, the jet's arc.
 */
import { CITIES, MAX_TOUR_CITIES, travelFor, tourReward, type City } from '../game/circuit';
import type { Career } from '../game/Career';
import { LABEL, LAND } from '../three/globe';
import { h } from './dom';
import { tourGlobe } from './TourGlobe';
import { openModal, type ModalHandle } from './modal';

export interface TourHooks {
  career: Career;
  venueName(id: string): string;
  /** the tour's booked: back to the calendar */
  booked(): void;
}

const xy = (lat: number, lon: number): [number, number] => [(lon + 180) / 360, (80 - lat) / 140];

export const TRAVEL_COLOR = { van: '#ffc43d', train: '#3dc8ff', jet: '#ff4fd8' };

export function openTourMap(o: TourHooks): ModalHandle {
  const c = o.career;
  const p = c.progress;
  const travel = travelFor(p.tier);
  const route: string[] = [];
  const W = 960;
  const H = 520;
  const canvas = h('canvas', { width: W, height: H, class: 'tm-map', role: 'img', 'aria-label': 'World map: click cities to add them to the tour' }) as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  // the flat map's land dots, made the first time it draws (the globe doesn't need them)
  let land: number[] | null = null;
  let hover: string | null = null;
  let t0 = performance.now();

  const list = h('div', { class: 'tm-list' });
  const summary = h('div', { class: 'tm-sum' });
  const book = h('button', { type: 'button', class: 'btn primary' }, 'Book the tour');
  const clear = h('button', { type: 'button', class: 'btn ghost' }, 'Clear');

  const pos = (cty: City): [number, number] => [cty.x * W, cty.y * H];

  const toggle = (id: string) => {
    const i = route.indexOf(id);
    if (i >= 0) route.splice(i, 1);
    else if (route.length < MAX_TOUR_CITIES) route.push(id);
    t0 = performance.now();
    renderSide();
    globe?.update();
  };

  const draw = (now: number) => {
    // the modal closed: stop drawing
    if (!canvas.isConnected) return;
    const k = Math.min(1, (now - t0) / 700);
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1020');
    bg.addColorStop(1, '#070a14');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // the graticule
    g.strokeStyle = 'rgb(120 150 255 / 7%)';
    g.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = ((lon + 180) / 360) * W;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let lat = 60; lat >= -60; lat -= 20) {
      const y = ((80 - lat) / 140) * H;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    // the land, as dots
    g.fillStyle = 'rgb(150 175 230 / 26%)';
    land ??= landDots(W, H);
    for (let i = 0; i < land.length; i += 2) g.fillRect(land[i] - 1.1, land[i + 1] - 1.1, 2.2, 2.2);
    // the route
    const col = TRAVEL_COLOR[travel.mode];
    for (let i = 1; i < route.length; i++) {
      const a = pos(CITIES.find((x) => x.id === route[i - 1])!);
      const b = pos(CITIES.find((x) => x.id === route[i])!);
      const lift = travel.mode === 'jet' ? 0.28 : travel.mode === 'train' ? 0.12 : 0.05;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2 - d * lift;
      g.save();
      g.strokeStyle = col;
      g.lineWidth = travel.mode === 'jet' ? 2.2 : 2;
      g.shadowColor = col;
      g.shadowBlur = travel.mode === 'jet' ? 12 : 6;
      g.setLineDash(travel.mode === 'van' ? [6, 6] : travel.mode === 'train' ? [14, 4] : []);
      g.lineDashOffset = -now / 60;
      const seg = i === route.length - 1 ? k : 1;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      // the last leg draws itself in
      const steps = 40;
      for (let s = 1; s <= Math.ceil(steps * seg); s++) {
        const u = Math.min(seg, s / steps);
        const x = (1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * mx + u * u * b[0];
        const y = (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * my + u * u * b[1];
        g.lineTo(x, y);
      }
      g.stroke();
      g.restore();
    }
    // the cities
    for (const cty of CITIES) {
      const [x, y] = pos(cty);
      const n = route.indexOf(cty.id);
      const on = n >= 0;
      const played = c.circuit.toured.includes(cty.id);
      const pulse = 0.5 + 0.5 * Math.sin(now / 400 + cty.x * 20);
      g.beginPath();
      g.arc(x, y, on ? 11 : 6 + pulse * 1.5, 0, Math.PI * 2);
      g.fillStyle = on ? col : hover === cty.id ? '#ffffff' : played ? '#b6ff3b' : 'rgb(255 255 255 / 70%)';
      g.shadowColor = on ? col : '#ffffff';
      g.shadowBlur = on ? 16 : 6 * pulse;
      g.fill();
      g.shadowBlur = 0;
      if (on) {
        g.fillStyle = '#0b1020';
        g.font = '700 12px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(n + 1), x, y + 0.5);
      }
      const [dx, dy, align] = LABEL[cty.id] ?? [0, 20, 'center'];
      g.font = `${on || hover === cty.id ? 700 : 500} 13px system-ui, sans-serif`;
      g.textAlign = align;
      g.textBaseline = 'middle';
      g.fillStyle = on ? '#ffffff' : 'rgb(230 236 255 / 80%)';
      g.fillText(cty.name, x + (align === 'right' ? dx - 6 : align === 'left' ? dx + 6 : dx), y + (dy === 0 ? 0 : dy + (on ? Math.sign(dy) * 4 : 0)));
    }
    requestAnimationFrame(draw);
  };

  const cityAt = (ev: MouseEvent): City | null => {
    const r = canvas.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const y = ((ev.clientY - r.top) / r.height) * H;
    let best: City | null = null;
    let bd = 22;
    for (const cty of CITIES) {
      const d = Math.hypot(cty.x * W - x, cty.y * H - y);
      if (d < bd) {
        bd = d;
        best = cty;
      }
    }
    return best;
  };
  canvas.addEventListener('click', (ev) => {
    const cty = cityAt(ev);
    if (cty) toggle(cty.id);
  });
  canvas.addEventListener('mousemove', (ev) => {
    hover = cityAt(ev)?.id ?? null;
    canvas.style.cursor = hover ? 'pointer' : 'default';
  });

  const renderSide = () => {
    list.replaceChildren(
      ...CITIES.map((cty) => {
        const n = route.indexOf(cty.id);
        const btn = h(
          'button',
          { type: 'button', class: `tm-city${n >= 0 ? ' on' : ''}`, 'aria-pressed': n >= 0 ? 'true' : 'false' },
          h('span', { class: 'tm-n' }, n >= 0 ? String(n + 1) : '+'),
          h('span', { class: 'tm-c' }, h('b', {}, cty.name, c.circuit.toured.includes(cty.id) ? h('small', { class: 'tm-played' }, ' played') : null), h('small', {}, `${o.venueName(cty.venue)} · ${cty.promoter}`), h('em', {}, cty.taste)),
        );
        btn.addEventListener('click', () => toggle(cty.id));
        return btn;
      }),
    );
    const reward = tourReward(route.map(() => ({ grade: 'A' })));
    summary.replaceChildren(
      h('b', {}, route.length ? route.map((id) => CITIES.find((x) => x.id === id)!.name).join(' → ') : globe ? 'Click cities on the globe' : 'Click cities on the map'),
      h('span', { class: 'gs-note' }, route.length < 2 ? `Two to ${MAX_TOUR_CITIES} cities, one a night, in the order you pick them.` : `${route.length} nights by ${travel.label.toLowerCase()} (${travel.note.toLowerCase()}). Good nights all round: about +${reward.followers.toLocaleString()} followers.`),
    );
    book.toggleAttribute('disabled', route.length < 2);
  };

  book.addEventListener('click', () => {
    if (route.length < 2) return;
    if (!c.startTour(route.slice())) return;
    modal.close();
    o.booked();
  });
  clear.addEventListener('click', () => {
    route.length = 0;
    renderSide();
    globe?.update();
  });

  // the globe, or the flat map without WebGL
  const globe = tourGlobe({ route, travel: travel.mode, color: TRAVEL_COLOR[travel.mode], toured: c.circuit.toured, toggle });
  renderSide();
  const body = h(
    'div',
    { class: 'tour-map' },
    h('div', { class: 'tm-left' }, globe ? globe.el : canvas, h('div', { class: 'tm-legend' }, h('i', { style: `--tc:${TRAVEL_COLOR[travel.mode]}` }), `You travel by ${travel.label.toLowerCase()}. `, travel.mode === 'jet' ? null : h('span', { class: 'gs-note' }, travel.mode === 'van' ? 'Tier 5 brings trains and planes, tier 6 a private jet.' : 'Tier 6 brings a private jet.')), summary, h('div', { class: 'gs-actions' }, clear, book)),
    list,
  );
  const modal = openModal('World Tour', body, { wide: true });
  if (!globe) requestAnimationFrame(draw);
  return modal;
}

/** the land as a grid of dots: the outlines filled on a small canvas, sampled */
function landDots(W: number, H: number): number[] {
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const g = m.getContext('2d');
  if (!g) return [];
  g.fillStyle = '#fff';
  for (const poly of LAND) {
    g.beginPath();
    poly.forEach(([lat, lon], i) => {
      const [x, y] = xy(lat, lon);
      if (i) g.lineTo(x * W, y * H);
      else g.moveTo(x * W, y * H);
    });
    g.closePath();
    g.fill();
  }
  const data = g.getImageData(0, 0, W, H).data;
  const out: number[] = [];
  const step = 6;
  for (let y = step / 2; y < H; y += step)
    for (let x = step / 2; x < W; x += step) {
      const a = data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3];
      if (a > 100) out.push(x, y);
    }
  return out;
}
