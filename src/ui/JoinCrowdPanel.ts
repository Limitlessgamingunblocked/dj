/*
 * Join the crowd on the deck: open your floor to friends (a room code and a
 * link to send them), see who's dancing, their requests, and what they're
 * allowed to do; and the little list over the stage of who's on the floor
 * and how hyped they are.
 */
import type { JoinTheCrowd } from '../app/jointhecrowd';
import { JOIN_FAILURE_TEXT, JoinError } from '../net';
import { h, setText } from './dom';
import { openModal } from './modal';
import { toast } from './toast';
import './styles/jointhecrowd.css';

export function openJoinCrowdPanel(host: JoinTheCrowd): void {
  const code = h('div', { class: 'jtc-codebig', 'aria-label': 'Room code' }, '');
  const link = h('input', { readonly: true, class: 'mono setcode-box', 'aria-label': 'Link for friends' }) as HTMLInputElement;
  const copy = h('button', { type: 'button', class: 'btn' }, 'Copy the link');
  const share = h('button', { type: 'button', class: 'btn', hidden: typeof navigator.share !== 'function' }, 'Share…');
  const openBtn = h('button', { type: 'button', class: 'btn primary' }, 'Open the floor to friends');
  const closeBtn = h('button', { type: 'button', class: 'btn danger' }, 'Close the floor');
  const status = h('p', { class: 'note' }, '');
  const noLink = h('p', { class: 'note', hidden: true }, 'Friends open Deckhouse, choose ⋯ → Join a friend’s floor, and type this code.');
  const list = h('div', { class: 'jtc-list' });
  const log = h('div', { class: 'jtc-list note' });
  const toggle = (label: string, on: () => boolean, set: (v: boolean) => void) => {
    const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
    box.checked = on();
    box.addEventListener('change', () => set(box.checked));
    return h('label', { class: 'toggle-row' }, box, label);
  };
  const live = h(
    'div',
    { hidden: true },
    h('p', {}, 'Friends open the link (or Deckhouse with #crowd on the end, and type the code) on a phone or a laptop, anywhere.'),
    code,
    noLink,
    link,
    h('div', { class: 'gs-actions' }, copy, share),
    h('h3', {}, 'On the floor'),
    list,
    h('h3', {}, 'What friends can do'),
    toggle('Hit the air horn', () => host.settings.horn, (v) => host.setSettings({ horn: v })),
    toggle('Put the camera at their spot for a few bars', () => host.settings.cam, (v) => host.setSettings({ cam: v })),
    h('h3', {}, 'Just now'),
    log,
    h('div', { class: 'gs-actions' }, closeBtn),
  );
  const idle = h(
    'div',
    {},
    h('p', {}, 'Your friends join your set as their own characters on the dancefloor. They hear your mix live, tap along to dance, jump on the drops, hold up their own LED signs, ask for tracks and hit the air horn, and their hype counts on the vibe meter.'),
    h('div', { class: 'gs-actions' }, openBtn),
  );

  const draw = () => {
    live.hidden = !host.open;
    idle.hidden = host.open;
    if (!host.open) return;
    setText(code, host.code ?? '');
    const url = host.link();
    link.value = url ?? '';
    link.hidden = copy.hidden = !url;
    share.hidden = !url || typeof navigator.share !== 'function';
    noLink.hidden = !!url;
    const fs = [...host.friends.values()];
    setText(status, fs.length ? '' : 'Nobody yet: send them the link.');
    list.replaceChildren(
      ...(fs.length
        ? fs.map((f) => {
            const camBtn = h('button', { type: 'button', class: 'btn' }, 'Their view');
            camBtn.addEventListener('click', () => host.camOn(f.id));
            const kick = h('button', { type: 'button', class: 'btn ghost' }, 'Send home');
            kick.addEventListener('click', () => host.kick(f.id));
            const bits = [host.spotLabel(f.spot), `hype ${Math.round(f.hype.hype * 100)}%`, f.sign ? `sign: “${f.sign}”` : '', f.request ? `wants ${f.request.title}` : ''].filter(Boolean);
            return h('div', { class: 'jtc-guest' }, h('div', {}, h('b', {}, f.name), h('small', {}, bits.join(' · '))), camBtn, kick);
          })
        : [status]),
    );
    log.replaceChildren(...host.log.map((l) => h('div', {}, l)));
  };

  openBtn.addEventListener('click', async () => {
    openBtn.disabled = true;
    setText(openBtn, 'Opening…');
    try {
      await host.start();
      const url = host.link();
      if (url) navigator.clipboard?.writeText(url).catch(() => undefined);
      toast(url ? 'Your floor is open: the link’s copied, send it to your friends' : `Your floor is open: the room code is ${host.code}`);
    } catch (e) {
      toast(e instanceof JoinError ? JOIN_FAILURE_TEXT[e.reason] : 'Couldn’t open the floor: check your internet connection', 'error');
    } finally {
      openBtn.disabled = false;
      setText(openBtn, 'Open the floor to friends');
      draw();
    }
  });
  closeBtn.addEventListener('click', () => {
    host.stop();
    draw();
  });
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(link.value).then(
      () => toast('Link copied'),
      () => link.select(),
    );
  });
  share.addEventListener('click', () => void navigator.share?.({ title: 'Join my DJ set', text: 'Come and dance on my floor in Deckhouse DJ', url: link.value }).catch(() => undefined));

  const m = openModal('Join the crowd', h('div', { class: 'setcode jtc-host' }, idle, live));
  draw();
  const timer = setInterval(() => (m.body.isConnected ? draw() : clearInterval(timer)), 700);
}

/** who's on the floor, over the stage (hidden when nobody is) */
export function crowdHud(stageEl: HTMLElement): (host: JoinTheCrowd) => void {
  const el = h('div', { class: 'jtc-hud', hidden: true });
  stageEl.append(el);
  let key = '';
  return (host) => {
    const fs = [...host.friends.values()];
    const k = fs.map((f) => `${f.name}${Math.round(f.hype.hype * 20)}`).join();
    if (k === key) return;
    key = k;
    el.hidden = !fs.length;
    el.replaceChildren(h('b', {}, 'FRIENDS ON THE FLOOR'), ...fs.map((f) => h('div', {}, h('span', {}, f.name), h('i', { style: { width: `${Math.max(4, Math.round(f.hype.hype * 60))}px` } }))));
  };
}
