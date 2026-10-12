/*
 * VJ mode on the deck: open the VJ's controls in another window (for a
 * second screen), or pair a phone or tablet on the same network by swapping
 * two codes.
 */
import { hostPairing, type VjLink } from '../app/vjlink';
import { h } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

export interface VjPanelHooks {
  connected(): number;
  attach(link: VjLink): void;
}

export function openVjPanel(hooks: VjPanelHooks): void {
  const count = h('p', { class: 'note' }, hooks.connected() ? `${hooks.connected()} VJ connected.` : 'No VJ connected yet.');
  const openBtn = h('button', { type: 'button', class: 'btn primary' }, 'Open the VJ window');
  openBtn.addEventListener('click', () => {
    const url = location.href.split('#')[0] + '#vj';
    const w = window.open(url, 'deckhouse-vj', 'width=900,height=800');
    if (!w) toast('The browser blocked the window: allow pop-ups, or open Deckhouse again with #vj on the end');
  });
  const code = h('textarea', { rows: 3, readonly: true, class: 'mono setcode-box', hidden: true }) as HTMLTextAreaElement;
  const answer = h('textarea', { rows: 3, placeholder: 'Paste the VJ device’s answer here', class: 'mono setcode-box', hidden: true }) as HTMLTextAreaElement;
  const connect = h('button', { type: 'button', class: 'btn', hidden: true }, 'Connect');
  const pairBtn = h('button', { type: 'button', class: 'btn' }, 'Pair a device');
  let pairing: Awaited<ReturnType<typeof hostPairing>> | null = null;
  pairBtn.addEventListener('click', async () => {
    pairBtn.disabled = true;
    pairing = await hostPairing((link) => {
      hooks.attach(link);
      toast('VJ device connected');
      count.textContent = `${hooks.connected()} VJ connected.`;
    });
    code.hidden = false;
    code.value = pairing.code;
    code.select();
    answer.hidden = false;
    connect.hidden = false;
    navigator.clipboard?.writeText(pairing.code).catch(() => undefined);
  });
  connect.addEventListener('click', async () => {
    if (!pairing || !(await pairing.answer(answer.value))) toast('That isn’t an answer code from the VJ device');
  });
  openModal(
    'VJ mode',
    h(
      'div',
      { class: 'setcode' },
      h('p', {}, 'Someone else runs the visuals and the lights while you mix: the visual modes, the light and sky pads, the colours and crowd moments.'),
      count,
      h('h3', {}, 'On a second screen'),
      h('div', { class: 'gs-actions' }, openBtn),
      h('h3', {}, 'On a phone or tablet'),
      h('p', { class: 'note' }, 'Open Deckhouse on the other device with #vj on the end of the address, open “Connect from another device”, and paste this code there. Then paste its answer back here. Both need to be on the same network.'),
      h('div', { class: 'gs-actions' }, pairBtn),
      code,
      answer,
      h('div', { class: 'gs-actions' }, connect),
    ),
  );
}
