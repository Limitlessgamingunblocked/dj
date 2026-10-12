/*
 * The VJ's controls (VJ mode): a page of its own, opened in another window
 * (Deckhouse with #vj on the end) or on another device paired with the deck.
 * The visual modes, the light and sky pads (held while you hold them), the
 * palette, crowd moments, and what's playing. It doesn't load the decks or
 * the 3D stage, so it runs on a phone or tablet.
 */
import { joinPairing, windowLink, type VjLink, type VjMsg, type VjState } from '../app/vjlink';
import { h, setClass, setText } from './dom';

export function mountVjSurface(root: HTMLElement): void {
  document.body.classList.add('vj-page');
  const status = h('span', { class: 'vj-status' }, 'Looking for the deck…');
  const track = h('div', { class: 'vj-track' }, '—');
  const vibe = h('i');
  const meter = h('div', { class: 'vj-vibe', role: 'meter', 'aria-label': 'Vibe' }, vibe);
  const hold = h('button', { type: 'button', class: 'btn' }, 'Hold my picks');
  const modes = h('div', { class: 'vj-modes' });
  const pads = h('div', { class: 'vj-pads' });
  const palettes = h('div', { class: 'gs-chips' });
  const moments = h('div', { class: 'gs-chips' });
  const pairBox = h('textarea', { rows: 3, placeholder: 'Paste the code from the deck (⋯ → VJ mode → Pair a device)', class: 'mono setcode-box' }) as HTMLTextAreaElement;
  const pairOut = h('textarea', { rows: 3, readonly: true, class: 'mono setcode-box', hidden: true }) as HTMLTextAreaElement;
  const pairBtn = h('button', { type: 'button', class: 'btn' }, 'Pair');
  const pairNote = h('p', { class: 'note' }, 'On the same network as the deck. Nothing goes through a server.');
  root.replaceChildren(
    h(
      'div',
      { class: 'vj' },
      h('header', { class: 'vj-head' }, h('b', {}, 'DECKHOUSE VJ'), status),
      track,
      meter,
      h('section', {}, h('h3', {}, 'Pads (hold)'), pads),
      h('section', {}, h('h3', {}, 'Visuals'), h('div', { class: 'toggle-row' }, hold), modes),
      h('section', {}, h('h3', {}, 'Colours'), palettes),
      h('section', {}, h('h3', {}, 'Crowd moments'), moments),
      h('details', { class: 'vj-pair' }, h('summary', {}, 'Connect from another device'), pairBox, pairBtn, pairOut, pairNote),
    ),
  );
  let link: VjLink | null = null;
  let last: VjState | null = null;
  let drawn = '';
  let seen = 0;
  const send = (m: VjMsg) => link?.send(m);
  const use = (l: VjLink) => {
    link?.close();
    link = l;
    l.onMessage((m) => {
      if (m.t !== 'state') return;
      seen = performance.now();
      last = m.s;
      render(m.s);
    });
    l.send({ t: 'hello' });
  };
  const w = windowLink();
  if (w) use(w);
  setInterval(() => {
    const ok = performance.now() - seen < 2000;
    setText(status, ok ? `Connected · ${last?.venue ?? ''}` : link?.kind === 'device' ? 'Paired: waiting for the deck…' : 'Looking for the deck… (open Deckhouse in another window of this browser, or pair below)');
    setClass(status, 'ok', ok);
    if (!ok) link?.send({ t: 'hello' });
  }, 1000);
  hold.addEventListener('click', () => send({ t: 'hold', on: !(last?.hold ?? false) }));
  pairBtn.addEventListener('click', async () => {
    const answer = await joinPairing(pairBox.value, (l) => use(l));
    if (!answer) {
      setText(pairNote, 'That isn’t a pairing code from the deck.');
      return;
    }
    pairOut.hidden = false;
    pairOut.value = answer;
    pairOut.select();
    setText(pairNote, 'Now paste this answer into the deck’s pairing box.');
  });

  const render = (s: VjState) => {
    // the lists only redraw when what's in them changes; the lit states every time
    const key = `${s.modes.map((m) => m.id + m.name).join()}|${s.pads.map((p) => p.id + p.label).join()}|${s.palettes.length}`;
    if (key !== drawn) {
      drawn = key;
      modes.replaceChildren(
        ...s.modes.map((m) => {
          const b = h('button', { type: 'button', class: 'vj-mode', 'data-id': m.id, 'data-energy': m.energy }, m.name);
          b.addEventListener('click', () => send({ t: 'mode', id: m.id }));
          return b;
        }),
      );
      pads.replaceChildren(
        ...s.pads.map((p) => {
          const b = h('button', { type: 'button', class: 'vj-pad', 'data-id': p.id }, p.label);
          const down = (e: Event) => {
            e.preventDefault();
            send({ t: 'press', id: p.id });
          };
          const up = () => send({ t: 'release', id: p.id });
          b.addEventListener('pointerdown', down);
          b.addEventListener('pointerup', up);
          b.addEventListener('pointerleave', up);
          return b;
        }),
      );
      palettes.replaceChildren(
        ...s.palettes.map((p) => {
          const b = h('button', { type: 'button', class: 'gs-chip', 'data-id': p.id }, p.name);
          b.addEventListener('click', () => send({ t: 'palette', id: p.id }));
          return b;
        }),
      );
      moments.replaceChildren(
        ...s.moments.map((m) => {
          const b = h('button', { type: 'button', class: 'gs-chip', 'data-id': m.id }, m.label);
          b.addEventListener('click', () => send({ t: 'moment', id: m.id }));
          return b;
        }),
      );
    }
    for (const b of modes.children) setClass(b as HTMLElement, 'active', (b as HTMLElement).dataset.id === s.mode);
    for (const b of pads.children) {
      const p = s.pads.find((x) => x.id === (b as HTMLElement).dataset.id);
      (b as HTMLElement).style.setProperty('--lit', p?.lit || 'transparent');
      setClass(b as HTMLElement, 'lit', !!p?.lit);
    }
    for (const b of palettes.children) setClass(b as HTMLElement, 'active', (b as HTMLElement).dataset.id === s.palette);
    for (const b of moments.children) setClass(b as HTMLElement, 'active', !!s.moments.find((m) => m.id === (b as HTMLElement).dataset.id)?.on);
    setClass(hold, 'active', s.hold);
    setText(track, s.track ? `${s.track} · ${s.bpm} BPM` : 'Nothing playing');
    vibe.style.width = `${Math.round(s.vibe * 100)}%`;
  };
}
