/*
 * The World Tour map: pick a run of cities (two to five), one a night, in
 * the order you click them. The map is drawn here (dotted land from rough
 * hand-made outlines, no map data); each city shows its crowd's taste, the
 * room it's in and the promoter booking you. How you travel follows your
 * tier: the van's dashed road, the train's line, the jet's arc.
 */
import { CITIES, MAX_TOUR_CITIES, travelFor, tourReward, type City } from '../game/circuit';
import type { Career } from '../game/Career';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';

export interface TourHooks {
  career: Career;
  venueName(id: string): string;
  /** the tour's booked: back to the calendar */
  booked(): void;
}

/** rough outlines, [lat, lon] (no map data: hand-placed points, enough to read as the world) */
const LAND: [number, number][][] = [
  // North America
  [[70, -165], [72, -140], [70, -100], [75, -80], [62, -62], [47, -53], [44, -66], [35, -76], [25, -80], [30, -90], [26, -97], [20, -97], [15, -92], [8, -78], [10, -84], [15, -95], [20, -105], [30, -115], [40, -124], [50, -127], [58, -137], [60, -147], [55, -163], [65, -168]],
  // Greenland
  [[83, -35], [80, -15], [70, -20], [60, -43], [66, -55], [77, -70], [82, -60]],
  // South America
  [[12, -72], [10, -62], [5, -52], [-5, -35], [-23, -41], [-34, -53], [-40, -62], [-55, -68], [-52, -75], [-40, -73], [-18, -70], [-5, -81], [2, -80], [8, -77]],
  // Europe and Asia
  [[36, -9], [43, -9], [48, -5], [51, 2], [54, 8], [57, 8], [58, 11], [63, 5], [71, 25], [69, 40], [73, 55], [77, 105], [72, 130], [70, 160], [66, 180], [60, 165], [52, 157], [59, 143], [53, 141], [43, 132], [38, 122], [30, 122], [22, 114], [10, 106], [1, 104], [8, 98], [17, 95], [22, 90], [16, 82], [8, 77], [20, 72], [25, 62], [25, 57], [30, 48], [30, 35], [35, 36], [37, 27], [40, 26], [36, 22], [40, 19], [45, 13], [40, 15], [38, 16], [44, 8], [43, 3], [37, -1]],
  // Arabia
  [[30, 35], [28, 48], [24, 57], [17, 55], [12, 45], [20, 40]],
  // Britain and Ireland
  [[50, -5], [51, 1.5], [53, 0.3], [56, -2], [58.5, -3], [58, -6], [55, -5], [53, -4.5], [51.5, -5]],
  [[51.5, -10], [54.5, -10], [55, -7], [52, -6]],
  // Africa
  [[35, -6], [37, 10], [32, 32], [30, 33], [12, 44], [11, 51], [-2, 41], [-12, 40], [-26, 33], [-34, 26], [-35, 19], [-29, 16], [-17, 12], [-6, 12], [4, 9], [4, -8], [6, -10], [15, -17], [21, -17], [28, -13]],
  [[-12, 49], [-16, 50], [-25, 47], [-22, 43], [-16, 44]],
  // Australia and New Zealand
  [[-11, 131], [-12, 137], [-17, 141], [-11, 142], [-25, 153], [-37, 150], [-39, 146], [-32, 134], [-35, 117], [-22, 114], [-14, 127]],
  [[-35, 173], [-41, 176], [-46, 170], [-41, 172]],
  // Japan, the islands of South East Asia
  [[31, 130], [34, 135], [35, 140], [41, 141], [45, 142], [43, 145], [40, 140], [36, 136], [34, 131]],
  [[5, 95], [-1, 101], [-6, 106], [-4, 103], [2, 98]],
  [[7, 117], [1, 109], [-3, 111], [-3, 116], [1, 119]],
  [[-2, 131], [-6, 139], [-9, 141], [-10, 148], [-6, 147], [-3, 141]],
];

const xy = (lat: number, lon: number): [number, number] => [(lon + 180) / 360, (80 - lat) / 140];

/** where each city's name sits, so the close ones in Europe don't overlap */
const LABEL: Record<string, [number, number, CanvasTextAlign]> = {
  london: [-10, 4, 'right'],
  amsterdam: [0, -12, 'center'],
  berlin: [10, 4, 'left'],
  ibiza: [0, 18, 'center'],
  detroit: [-10, -6, 'right'],
  newyork: [10, 10, 'left'],
};

const TRAVEL_COLOR = { van: '#ffc43d', train: '#3dc8ff', jet: '#ff4fd8' };

export function openTourMap(o: TourHooks): ModalHandle {
  const c = o.career;
  const p = c.progress;
  const travel = travelFor(p.tier);
  const route: string[] = [];
  const W = 960;
  const H = 520;
  const canvas = h('canvas', { width: W, height: H, class: 'tm-map', role: 'img', 'aria-label': 'World map: click cities to add them to the tour' }) as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  const land = landDots(W, H);
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
      h('b', {}, route.length ? route.map((id) => CITIES.find((x) => x.id === id)!.name).join(' → ') : 'Click cities on the map'),
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
  });

  renderSide();
  const body = h(
    'div',
    { class: 'tour-map' },
    h('div', { class: 'tm-left' }, canvas, h('div', { class: 'tm-legend' }, h('i', { style: `--tc:${TRAVEL_COLOR[travel.mode]}` }), `You travel by ${travel.label.toLowerCase()}. `, travel.mode === 'jet' ? null : h('span', { class: 'gs-note' }, travel.mode === 'van' ? 'Tier 5 brings trains and planes, tier 6 a private jet.' : 'Tier 6 brings a private jet.')), summary, h('div', { class: 'gs-actions' }, clear, book)),
    list,
  );
  const modal = openModal('World Tour', body, { wide: true });
  requestAnimationFrame(draw);
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
