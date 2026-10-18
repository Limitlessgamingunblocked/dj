/*
 * The silent disco showdown over the stage: the room split blue and red, who's
 * on each channel and what they're playing, the clock; the lobby (the room
 * code to share, Start); the channel buttons for friends watching, Listen in
 * for the DJs. And the result at the end.
 */
import type { DiscoView } from '../app/discoSession';
import { CHANNEL_COLOR, CHANNEL_NAME, other, type Channel } from '../game/silentDisco';
import { h, setClass, setText } from './dom';
import { openModal } from './modal';
import { toast } from './toast';
import './styles/disco.css';

export interface DiscoHudActions {
  start(): void;
  flip(ch: Channel): void;
  peek(on: boolean): void;
  leave(): void;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export class SilentDiscoHud {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private bar: HTMLElement;
  private side: Record<Channel, { name: HTMLElement; share: HTMLElement; now: HTMLElement; box: HTMLElement }>;
  private lobby: HTMLElement;
  private lobbyText: HTMLElement;
  private code: HTMLElement;
  private startBtn: HTMLButtonElement;
  private you: HTMLElement;
  private flips: Record<Channel, HTMLButtonElement>;
  private peekBtn: HTMLButtonElement;
  private watchRow: HTMLElement;
  private djRow: HTMLElement;

  constructor(act: DiscoHudActions) {
    const sideEl = (ch: Channel) => {
      const name = h('span', { class: 'sd-name' });
      const share = h('span', { class: 'sd-share' });
      const now = h('span', { class: 'sd-now' });
      const box = h('div', { class: `sd-side sd-${ch}` }, h('div', { class: 'sd-who' }, name, share), now);
      return { name, share, now, box };
    };
    this.side = { blue: sideEl('blue'), red: sideEl('red') };
    this.title = h('span', { class: 'sd-title' }, 'Silent disco');
    const leave = h('button', { type: 'button', class: 'btn small ghost', onclick: () => act.leave() }, 'Leave');
    this.bar = h('div', { class: 'sd-fill' });
    this.code = h('b', { class: 'sd-code mono' });
    const copy = h('button', {
      type: 'button',
      class: 'btn small',
      onclick: () => {
        const c = this.code.textContent ?? '';
        if (c) navigator.clipboard?.writeText(c).then(() => toast('Room code copied'), () => undefined);
      },
    }, 'Copy');
    this.startBtn = h('button', { type: 'button', class: 'btn small primary', onclick: () => act.start() }, 'Start');
    this.lobbyText = h('span', {});
    this.lobby = h('div', { class: 'sd-lobby' }, this.lobbyText, h('span', { class: 'sd-codebox' }, 'Room ', this.code, copy), this.startBtn);
    this.you = h('span', { class: 'sd-you' });
    this.peekBtn = h('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false' }, 'Listen in');
    this.peekBtn.addEventListener('click', () => {
      const on = this.peekBtn.getAttribute('aria-pressed') !== 'true';
      this.peekBtn.setAttribute('aria-pressed', String(on));
      act.peek(on);
    });
    this.djRow = h('div', { class: 'sd-row' }, this.you, this.peekBtn);
    this.flips = {
      blue: h('button', { type: 'button', class: 'btn small sd-flip sd-flip-blue', onclick: () => act.flip('blue') }, 'Blue channel'),
      red: h('button', { type: 'button', class: 'btn small sd-flip sd-flip-red', onclick: () => act.flip('red') }, 'Red channel'),
    };
    this.watchRow = h('div', { class: 'sd-row' }, h('span', { class: 'sd-you' }, 'Your headphones:'), this.flips.blue, this.flips.red);
    this.el = h(
      'div',
      { class: 'sd-hud', role: 'status' },
      h('div', { class: 'sd-head' }, this.title, leave),
      h('div', { class: 'sd-sides' }, this.side.blue.box, this.side.red.box),
      h('div', { class: 'sd-bar' }, this.bar),
      this.lobby,
      this.djRow,
      this.watchRow,
    );
  }

  show(v: DiscoView): void {
    const w = v.wire;
    const live = w.phase !== 'lobby';
    setText(this.title, w.phase === 'lobby' ? 'Silent disco showdown' : w.phase === 'over' ? 'Silent disco · the result' : `Silent disco · ${clock(w.left)}`);
    setClass(this.el, 'sd-final', w.phase === 'live' && w.left <= 60);
    this.bar.style.width = pct(w.share);
    for (const ch of ['blue', 'red'] as Channel[]) {
      const s = this.side[ch];
      setText(s.name, w.names[ch] || (ch === 'red' ? 'Waiting for a DJ…' : CHANNEL_NAME[ch]));
      setText(s.share, live ? pct(ch === 'blue' ? w.share : 1 - w.share) : '');
      const listeners = w.watching[ch] ? ` · ${w.watching[ch]} listening` : '';
      setText(s.now, (w.now[ch] || (w.names[ch] ? 'Nothing playing yet' : '')) + listeners);
      setClass(s.box, 'sd-mine', v.ch === ch);
    }
    // the lobby: the host shares the code and starts; everyone else waits
    this.lobby.hidden = w.phase !== 'lobby';
    if (w.phase === 'lobby') {
      const isHost = v.role === 'host';
      this.startBtn.hidden = !isHost;
      this.startBtn.disabled = !w.red;
      this.code.textContent = v.code ?? '';
      (this.code.parentElement as HTMLElement).hidden = !v.code;
      setText(this.lobbyText, isHost ? (w.red ? `${w.names.red} is on red. Ready when you are.` : 'Waiting for a friend to join as a DJ.') : v.role === 'red' && w.red && !v.dj ? 'The DJ seat’s taken, so you’re watching.' : `Waiting for ${w.names.blue} to start.`);
    }
    const dj = v.dj;
    this.djRow.hidden = !dj || w.phase === 'lobby';
    if (dj) {
      setText(this.you, `You’re on ${CHANNEL_NAME[v.ch].toLowerCase()}. Mix well and the room comes to you.`);
      this.you.style.color = CHANNEL_COLOR[v.ch];
      this.peekBtn.hidden = v.role === 'practice';
      this.peekBtn.title = `Hear the ${CHANNEL_NAME[other(v.ch)].toLowerCase()} channel over yours`;
    }
    this.watchRow.hidden = dj;
    for (const ch of ['blue', 'red'] as Channel[]) {
      setClass(this.flips[ch], 'active', v.ch === ch);
      this.flips[ch].setAttribute('aria-pressed', String(v.ch === ch));
    }
  }
}

/** the end: who held the room, how it went over the night */
export function showDiscoResult(v: DiscoView, act: { again: (() => void) | null; leave: () => void }): void {
  const w = v.wire;
  const win = w.winner;
  const headline = win === 'tie' || !win ? 'Dead even. The room couldn’t pick.' : `${w.names[win] || CHANNEL_NAME[win]} wins the room`;
  const mine = v.dj ? v.ch : null;
  const sub = !mine || !win || win === 'tie' ? '' : win === mine ? 'You held the room. Big night.' : 'They pulled the room. Run it back?';
  const hist = w.history?.length ? w.history : [0.5, w.share];
  // the night as a line: up is blue, down is red
  const W = 360;
  const H = 90;
  const pts = hist.map((s, i) => `${((i / Math.max(1, hist.length - 1)) * W).toFixed(1)},${((1 - s) * H).toFixed(1)}`).join(' ');
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="sd-chart" role="img" aria-label="Blue's share of the room over the showdown">
    <rect x="0" y="0" width="${W}" height="${H / 2}" fill="${CHANNEL_COLOR.blue}" opacity="0.12"/>
    <rect x="0" y="${H / 2}" width="${W}" height="${H / 2}" fill="${CHANNEL_COLOR.red}" opacity="0.12"/>
    <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#ffffff" stroke-opacity="0.25" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
    <polyline points="${pts}" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
  const chart = h('div', { class: 'sd-chartbox' });
  chart.innerHTML = svg;
  const m = openModal(
    'Silent disco showdown',
    h(
      'div',
      { class: 'sd-result' },
      h('h3', { style: { color: win && win !== 'tie' ? CHANNEL_COLOR[win] : '' } }, headline),
      sub ? h('p', {}, sub) : null,
      h(
        'div',
        { class: 'sd-split' },
        h('span', { style: { color: CHANNEL_COLOR.blue } }, `${w.names.blue || 'Blue'} ${pct(w.share)}`),
        h('span', { style: { color: CHANNEL_COLOR.red } }, `${pct(1 - w.share)} ${w.names.red || 'Red'}`),
      ),
      chart,
      h('p', { class: 'note' }, 'Above the line, the room was on blue; below it, red.'),
      h(
        'div',
        { class: 'gs-actions' },
        act.again
          ? h('button', {
              type: 'button',
              class: 'btn primary',
              onclick: () => {
                m.close();
                act.again?.();
              },
            }, 'Rematch')
          : null,
        h('button', {
          type: 'button',
          class: 'btn',
          onclick: () => {
            m.close();
            act.leave();
          },
        }, 'Leave the showdown'),
      ),
    ),
  );
}
