/*
 * Pass the aux on a player's phone (Deckhouse with #aux on the end, or the
 * room's link): a light page of its own, without the decks or the stage.
 * Put in the room code and your name; then it follows the night: whose turn
 * it is and the clock, "Your turn!" (with a buzz) and an I'm ready button
 * when it's yours, the score after each mix, the scoreboard, a secret vote
 * at the end, and the awards. A friend who isn't in the room can listen to
 * the mix here.
 */
import { joinAux, type AuxGuestLink, type AuxPublic, type AuxTransportKind } from '../app/auxLink';
import { normalizeRoomCode, playStream, roomFromUrl } from '../net';
import { h, setText } from './dom';
import './styles/passaux.css';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;

export function mountAuxGuest(root: HTMLElement, o: { transport?: AuxTransportKind } = {}): void {
  document.body.classList.add('aux-page');
  const page = h('div', { class: 'auxg' });
  root.replaceChildren(page);
  let saved = '';
  try {
    saved = localStorage.getItem('deckhouse-aux-name') ?? '';
  } catch {
    /* private mode */
  }

  const joinForm = (err = '') => {
    const code = h('input', { type: 'text', class: 'mono auxg-code', value: roomFromUrl() ?? '', maxlength: 7, placeholder: 'ABC12', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Room code' }) as HTMLInputElement;
    const name = h('input', { type: 'text', class: 'auxg-name', value: saved, maxlength: 18, placeholder: 'Your name', autocomplete: 'nickname', 'aria-label': 'Your name' }) as HTMLInputElement;
    const go = h('button', { type: 'submit', class: 'btn primary auxg-big' }, 'Join');
    const note = h('p', { class: 'auxg-err', role: 'alert' }, err);
    const form = h('form', { class: 'auxg-join' }, h('label', {}, 'Room code', code), h('label', {}, 'Your name', name), go, note, h('p', { class: 'auxg-note' }, 'Use the same name the host typed in for you, so your phone plays as you.'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = normalizeRoomCode(code.value);
      const n = name.value.trim();
      if (!c) return setText(note, 'Room codes are five letters and numbers.');
      if (!n) return setText(note, 'Put your name in.');
      try {
        localStorage.setItem('deckhouse-aux-name', n);
      } catch {
        /* private mode */
      }
      saved = n;
      (go as HTMLButtonElement).disabled = true;
      setText(go, 'Joining…');
      try {
        play(await joinAux(c, n, o));
      } catch (err) {
        joinForm(err instanceof Error ? err.message : 'Couldn’t join.');
      }
    });
    page.replaceChildren(h('header', { class: 'auxg-head' }, h('b', {}, 'PASS THE AUX'), h('span', {}, 'Deckhouse DJ')), form);
    (code.value ? name : code).focus();
  };

  const play = (link: AuxGuestLink) => {
    const status = h('span', { class: 'auxg-status' }, `Room ${link.code}`);
    const main = h('main', { class: 'auxg-main', 'aria-live': 'polite' }, h('p', {}, 'In the room. Waiting for the host…'));
    const board = h('ol', { class: 'aux-table' });
    const listen = h('button', { type: 'button', class: 'btn ghost' }, '🔈 Listen to the mix here');
    const leave = h('button', { type: 'button', class: 'btn ghost' }, 'Leave');
    let audio: HTMLAudioElement | null = null;
    let listening = false;
    let buzzed = '';
    let shown = '';
    listen.addEventListener('click', () => {
      listening = !listening;
      link.send({ t: 'listen', on: listening });
      setText(listen, listening ? '🔇 Stop listening' : '🔈 Listen to the mix here');
      if (!listening && audio) {
        audio.pause();
        audio.srcObject = null;
        audio = null;
      }
    });
    leave.addEventListener('click', () => {
      link.leave();
      joinForm();
    });
    page.replaceChildren(
      h('header', { class: 'auxg-head' }, h('b', {}, 'PASS THE AUX'), status),
      main,
      h('section', {}, h('h3', {}, 'Scores'), board),
      h('footer', { class: 'auxg-foot' }, listen, leave, h('p', { class: 'auxg-note' }, 'Listen only if you’re not in the room with the speakers.')),
    );
    link.onAudio((stream) => {
      audio?.pause();
      audio = stream && listening ? playStream(stream) : null;
    });
    link.onClose((why) => {
      audio?.pause();
      joinForm(why);
    });

    const name = (s: AuxPublic, id: string | null | undefined) => {
      const p = s.players.find((x) => x.id === id);
      return h('b', { class: 'aux-pname', style: { color: p?.color ?? '#fff' } }, p?.name ?? '?');
    };

    link.onState((s) => {
      const me = s.devices[link.me] ?? null;
      board.replaceChildren(...[...s.players].sort((a, b) => b.total - a.total).map((p) => h('li', { class: p.id === me ? 'me' : '' }, name(s, p.id), h('span', {}, p.device ? '📱' : ''), h('b', {}, String(p.total)))));
      // the clock ticks every second; the rest only when something changed
      const clockText = s.timeLeft === null ? '' : clock(s.timeLeft);
      const key = JSON.stringify([s.phase, s.current, s.from?.title, s.turns.length, s.voted, me, s.status, s.ballot[me ?? '']?.length ?? 0, s.phase === 'handoff' ? '' : clockText]);
      if (key === shown) return;
      shown = key;
      const mine = !!me && s.current === me;
      if (mine && s.phase === 'handoff' && buzzed !== `${s.turns.length}`) {
        buzzed = `${s.turns.length}`;
        navigator.vibrate?.([200, 100, 200]);
      }
      const into = s.from ? h('p', { class: 'auxg-into' }, 'Mixing into ', h('b', {}, s.from.title), s.from.artist ? ` by ${s.from.artist}` : '', h('small', {}, [s.from.bpm ? `${s.from.bpm} BPM` : '', s.from.key ?? ''].filter(Boolean).join(' · '))) : null;
      const kids: (Node | null)[] = [];
      switch (s.phase) {
        case 'lobby':
          kids.push(h('h2', {}, 'You’re in'), h('p', {}, 'Waiting for the host to start the night.'), h('p', { class: 'auxg-note' }, `In the room: ${s.players.map((p) => p.name).join(', ') || 'just you'}`));
          break;
        case 'handoff': {
          if (mine) {
            const ready = h('button', { type: 'button', class: 'btn primary auxg-big' }, 'I’m ready');
            ready.addEventListener('click', () => {
              link.send({ t: 'ready' });
              (ready as HTMLButtonElement).disabled = true;
            });
            kids.push(h('h2', { class: 'auxg-yours' }, 'Your turn!'), h('p', {}, `Grab the laptop. You’ve got ${clock(s.turnSecs)} to get your track in.`), into, ready);
          } else kids.push(h('small', {}, 'Up now'), h('h2', {}, name(s, s.current)), into, s.next === me && me ? h('p', { class: 'auxg-yours' }, 'You’re up next. Pick your track!') : null);
          break;
        }
        case 'mixing':
          kids.push(h('small', {}, mine ? 'Go go go' : 'On the decks'), h('h2', {}, mine ? 'You’re on' : name(s, s.current)), h('div', { class: `auxg-clock${s.timeLeft !== null && s.timeLeft <= 10 && s.timeLeft > 0 ? ' low' : ''}` }, s.timeLeft === 0 ? 'IN' : clockText), into ?? h('p', {}, 'Opening the night'), s.next === me && me ? h('p', { class: 'auxg-yours' }, 'You’re up next.') : null);
          break;
        case 'scored':
          if (s.last) kids.push(h('small', {}, 'The mix'), h('h2', {}, name(s, s.last.player)), h('div', { class: 'aux-score' }, String(s.last.score)), h('div', { class: 'aux-notes' }, ...s.last.notes.map((x) => h('span', {}, x))));
          break;
        case 'voting': {
          const ballot = me ? (s.ballot[me] ?? []) : [];
          if (me && ballot.length && !s.voted.includes(me)) {
            kids.push(
              h('h2', {}, 'Your secret vote'),
              h('p', {}, 'The mix of the night? (Not your own.)'),
              h(
                'div',
                { class: 'aux-ballot' },
                ...ballot.map((i) => {
                  const t = s.turns[i];
                  if (!t) return null;
                  const b = h('button', { type: 'button', class: 'aux-pick' }, name(s, t.player), h('span', {}, `${t.from ?? ''} → ${t.to ?? ''}`));
                  b.addEventListener('click', () => link.send({ t: 'vote', turn: i }));
                  return b;
                }),
              ),
            );
          } else kids.push(h('h2', {}, me && s.voted.includes(me) ? 'Vote in' : 'The vote'), h('p', {}, 'Waiting for everyone to vote.'));
          break;
        }
        case 'awards':
          kids.push(h('h2', {}, 'The awards'), h('div', { class: 'aux-awards' }, ...s.awards.map((a) => h('div', { class: 'aux-award' }, h('small', {}, a.title), name(s, a.player), h('span', {}, a.why)))));
          break;
      }
      if (!me && s.phase !== 'lobby') kids.push(h('p', { class: 'auxg-note' }, 'You’re watching. Your name didn’t match a player, so you can’t vote this time.'));
      main.replaceChildren(...kids.filter((x): x is Node => !!x));
    });
    link.send({ t: 'hello' });
  };

  joinForm();
}
