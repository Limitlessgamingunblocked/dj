/*
 * The harmonic coach on screen: the Camelot wheel with what's playing lit
 * up, the keys that mix with it glowing (brighter for smoother), your tracks
 * as dots round the wheel, and the best of them listed. Click a dot or a
 * row to load it on the free deck. It follows the music while it's open.
 */
import { camelotColor, formatKey } from '../analysis/keys';
import type { KeyInfo, LibraryTrack } from '../core/types';
import { harmonicPicks, keyAt, wheelGlow, wheelSpot, type HarmonicPick } from '../game/harmonic';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';

export interface HarmonicHooks {
  /** the tracks to suggest from (the crate on show, or the library) */
  tracks(): LibraryTrack[];
  /** what's playing: its key and tempo, and the tracks on the decks */
  now(): { key: KeyInfo | null; bpm: number; title: string | null; onDecks: string[] };
  /** load a track on the free deck */
  load(id: string): boolean;
}

const SVG = 'http://www.w3.org/2000/svg';
const s = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const R_OUT = 200;
const R_MID = 140;
const R_IN = 84;

/** an annular slice of the wheel */
function slice(n: number, r0: number, r1: number): string {
  // 12 o'clock is 12 on the Camelot wheel; each number a twelfth round
  const a0 = ((n - 12 - 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
  const a1 = ((n - 12 + 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
  const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
}

function angle(n: number): number {
  return ((n - 12) / 12) * Math.PI * 2 - Math.PI / 2;
}

export function openHarmonicWheel(o: HarmonicHooks): ModalHandle {
  const svg = s('svg', { viewBox: '-215 -215 430 430', class: 'hw-wheel', role: 'img', 'aria-label': 'The Camelot wheel' });
  const list = h('ol', { class: 'hw-list' });
  const head = h('div', { class: 'hw-now' });
  let sig = '';

  const render = () => {
    const now = o.now();
    const tracks = o.tracks();
    const picks = harmonicPicks(now.key, now.bpm, tracks, now.onDecks, 40);
    const key = `${now.key?.camelot}|${Math.round(now.bpm)}|${tracks.length}|${now.onDecks.join(',')}`;
    if (key === sig) return;
    sig = key;
    const glow = wheelGlow(now.key);
    const here = now.key ? wheelSpot(now.key) : null;
    svg.replaceChildren();
    // the slices
    for (let n = 1; n <= 12; n++)
      for (const minor of [false, true]) {
        const k = keyAt(n, minor);
        const code = `${n}${minor ? 'A' : 'B'}`;
        const g = glow.get(code) ?? 0;
        const on = here && here.n === n && here.minor === minor;
        const path = s('path', { d: slice(n, minor ? R_IN : R_MID, minor ? R_MID : R_OUT), fill: camelotColor(k), class: `hw-slice${on ? ' on' : ''}`, 'fill-opacity': on ? 1 : here ? 0.12 + g * 0.6 : 0.45 });
        const title = s('title');
        title.textContent = `${code} · ${k.name}${on ? ' · playing' : g ? ` · mixes (${Math.round(g * 100)}%)` : ''}`;
        path.append(title);
        svg.append(path);
        const a = angle(n);
        const r = minor ? (R_IN + R_MID) / 2 + 18 : (R_MID + R_OUT) / 2 + 18;
        const t = s('text', { x: (r * Math.cos(a)).toFixed(1), y: (r * Math.sin(a)).toFixed(1), class: `hw-label${on ? ' on' : ''}`, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
        t.textContent = code;
        svg.append(t);
      }
    // your tracks as dots in their slice
    const bySpot = new Map<string, LibraryTrack[]>();
    for (const t of tracks) {
      const k = t.analysis?.key;
      if (!k) continue;
      const list = bySpot.get(k.camelot) ?? [];
      list.push(t);
      bySpot.set(k.camelot, list);
    }
    const pickIds = new Set(picks.map((p) => p.id));
    for (const [code, ts] of bySpot) {
      const n = parseInt(code, 10);
      const minor = code.endsWith('A');
      ts.slice(0, 14).forEach((t, i) => {
        const a = angle(n) + ((i % 7) - 3) * 0.055;
        const r = (minor ? R_IN + 12 : R_MID + 12) + Math.floor(i / 7) * 13;
        const good = pickIds.has(t.id);
        const dot = s('circle', { cx: (r * Math.cos(a)).toFixed(1), cy: (r * Math.sin(a)).toFixed(1), r: good ? 5.5 : 3.5, class: `hw-dot${good ? ' good' : ''}`, tabindex: good ? 0 : -1 });
        const title = s('title');
        title.textContent = `${t.meta.title} · ${t.meta.artist}${good ? ' · click to load' : ''}`;
        dot.append(title);
        if (good) {
          dot.addEventListener('click', () => o.load(t.id) && (sig = ''));
          dot.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && o.load(t.id) && (sig = ''));
        }
        svg.append(dot);
      });
    }
    // the middle: what's playing
    const c = s('circle', { r: R_IN - 8, class: 'hw-hub', fill: now.key ? camelotColor(now.key) : '#20263a' });
    svg.append(c);
    const t1 = s('text', { y: -6, class: 'hw-hub-k', 'text-anchor': 'middle' });
    t1.textContent = now.key ? formatKey(now.key) : '—';
    const t2 = s('text', { y: 18, class: 'hw-hub-b', 'text-anchor': 'middle' });
    t2.textContent = now.bpm ? `${now.bpm.toFixed(1)} BPM` : 'Play a track';
    svg.append(t1, t2);

    head.replaceChildren(h('b', {}, now.title ? `Playing: ${now.title}` : 'Nothing playing'), h('span', { class: 'gs-note' }, now.key ? `${picks.length} of your tracks mix in key with ${formatKey(now.key)}.` : 'Play a track with a known key and the wheel shows what mixes with it.'));
    list.replaceChildren(...(picks.length ? picks.slice(0, 16).map((p) => row(p)) : [h('li', { class: 'gs-note' }, now.key ? 'Nothing in key here. Try the whole library, or a key shift.' : '')]));
  };

  const row = (p: HarmonicPick) => {
    const li = h(
      'li',
      {},
      h('span', { class: 'chip key', style: { background: camelotColor(p.key) } }, formatKey(p.key)),
      h('span', { class: 'hw-t' }, h('b', {}, p.title), h('small', {}, `${p.artist} · ${p.label}${p.bpm ? ` · ${Math.round(p.bpm)} BPM${Math.abs(p.pct) > 0.5 ? ` (${p.pct > 0 ? '+' : ''}${p.pct.toFixed(1)}%)` : ''}` : ''}`)),
      h('i', { class: 'hw-score', style: `--s:${p.score.toFixed(2)}`, title: `${Math.round(p.score * 100)}% match` }),
    );
    const go = h('button', { type: 'button', class: 'btn', title: 'Load on the free deck' }, 'Load');
    go.addEventListener('click', () => {
      if (o.load(p.id)) {
        go.textContent = 'Loaded';
        go.setAttribute('disabled', '');
        sig = '';
      }
    });
    li.append(go);
    return li;
  };

  const body = h('div', { class: 'harmonic' }, h('div', { class: 'hw-left' }, svg, h('p', { class: 'gs-note hw-legend' }, 'Bright slices mix smoothly with what’s playing: the same number, one step round, or across to the relative key. Big dots are your tracks that fit.')), h('div', { class: 'hw-right' }, head, list));
  render();
  const modal = openModal('Harmonic wheel', body, { wide: true });
  // follow the music while it's open
  const tick = window.setInterval(() => {
    if (!body.isConnected) {
      clearInterval(tick);
      return;
    }
    render();
  }, 700);
  return modal;
}
