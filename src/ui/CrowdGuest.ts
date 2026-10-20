/*
 * Join the crowd (a friend's page): Deckhouse with #crowd on the end, opened
 * from the link the DJ shares (it carries the room code) or with a code
 * typed in. It doesn't load the decks or the 3D stage, so it runs on a
 * phone. The DJ's mix plays here live; you dance on their floor as your own
 * character from the dressing room (the look saved in this browser, if
 * you've played).
 *
 *   – tap the big pad on the beat to dance: keep time and your hype builds
 *   – jump when the drop lands (the page warns you a drop's coming)
 *   – hold up an LED sign with your own words
 *   – ask for a track from the DJ's library, hit the air horn
 *   – put the DJ's camera at your spot for a few bars
 */
import { SaveSystem } from '../core/SaveSystem';
import { LOOKS, type Look } from '../core/models';
import { loadSetting, saveSetting } from '../core/settings';
import { cleanName, cleanSign, GUEST_MOVES, isHostMsg, MAX_NAME, MAX_SIGN, SPOTS, type FloorState, type FloorTrack, type GuestMsg, type HostMsg, type SpotId } from '../game/crowdGuests';
import { JOIN_FAILURE_TEXT, JoinError, joinRoom, normalizeRoomCode, playStream, roomFromUrl, type Room } from '../net';
import { h, setClass, setText } from './dom';
import './styles/jointhecrowd.css';

const CLOSE_TEXT: Record<string, string> = {
  'host-left': 'The DJ closed the floor.',
  kicked: 'The DJ sent you home.',
  lost: 'Lost the connection to the DJ.',
  left: 'You left the floor.',
};

/** your look, from this browser's save (if you've played here) */
function savedLook(): Look | null {
  try {
    const l = new SaveSystem().load(LOOKS).data;
    return l.items.find((x) => x.id === l.current) ?? l.items[0] ?? null;
  } catch {
    return null;
  }
}

export function mountCrowdGuest(root: HTMLElement, o: { transport?: 'online' | 'memory' } = {}): void {
  document.body.classList.add('jtc-page');
  const saved = loadSetting<{ name?: string; spot?: SpotId }>('crowdGuest', {});

  /* ---------------- joining ---------------- */
  const codeIn = h('input', { class: 'jtc-code mono', maxlength: 8, placeholder: 'ROOM CODE', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Room code' }) as HTMLInputElement;
  codeIn.value = roomFromUrl() ?? '';
  const nameIn = h('input', { class: 'jtc-name', maxlength: MAX_NAME, placeholder: 'Your name', autocomplete: 'nickname', 'aria-label': 'Your name' }) as HTMLInputElement;
  nameIn.value = saved.name ?? '';
  let spot: SpotId = saved.spot && SPOTS.some((s) => s.id === saved.spot) ? saved.spot : 'front';
  const joinBtn = h('button', { type: 'button', class: 'btn primary jtc-join' }, 'Join the crowd');
  const joinNote = h('p', { class: 'note' }, savedLook() ? 'You’ll dance as the look you saved in the dressing room.' : 'You’ll dance as the starter look (play Deckhouse in this browser to make your own).');
  const joinView = h(
    'section',
    { class: 'jtc-joinview' },
    h('h1', {}, 'JOIN THE CROWD'),
    h('p', {}, 'Your friend’s DJ set, live: you’re on their dancefloor.'),
    h('label', { class: 'jtc-field' }, h('span', {}, 'Room code'), codeIn),
    h('label', { class: 'jtc-field' }, h('span', {}, 'Your name'), nameIn),
    joinBtn,
    joinNote,
  );

  /* ---------------- on the floor ---------------- */
  const status = h('span', { class: 'jtc-status' }, '');
  const leaveBtn = h('button', { type: 'button', class: 'btn' }, 'Leave');
  const track = h('div', { class: 'jtc-track' }, 'Waiting for the music…');
  const vibe = h('i');
  const yourHype = h('i');
  const grooveText = h('span', { class: 'jtc-groove' }, 'Tap on the beat to dance');
  const alert = h('div', { class: 'jtc-alert', hidden: true }, '');
  const pad = h('button', { type: 'button', class: 'jtc-pad', 'aria-label': 'Tap on the beat' }, h('b', {}, 'TAP'), h('small', {}, 'on the beat'));
  const moves = h(
    'div',
    { class: 'jtc-moves' },
    GUEST_MOVES.map((m) => {
      const b = h('button', { type: 'button', class: `btn jtc-move${m.id === 'jump' ? ' jump' : ''}`, 'data-id': m.id }, m.label);
      b.addEventListener('click', () => send({ t: 'move', id: m.id }));
      return b;
    }),
  );
  const signIn = h('input', { class: 'jtc-signin', maxlength: MAX_SIGN, placeholder: 'YOUR SIGN', 'aria-label': 'Your LED sign' }) as HTMLInputElement;
  const signBtn = h('button', { type: 'button', class: 'btn' }, 'Hold it up');
  const signDown = h('button', { type: 'button', class: 'btn', hidden: true }, 'Put it down');
  const horn = h('button', { type: 'button', class: 'btn jtc-horn' }, '📯 Air horn');
  const cam = h('button', { type: 'button', class: 'btn' }, '🎥 Camera to my spot');
  const spots = h('div', { class: 'gs-chips' });
  const search = h('input', { type: 'search', class: 'jtc-search', placeholder: 'Search the DJ’s tracks', 'aria-label': 'Search the DJ’s tracks' }) as HTMLInputElement;
  const reqList = h('div', { class: 'jtc-reqs' });
  const friends = h('div', { class: 'jtc-friends' });
  const notes = h('div', { class: 'jtc-notes', 'aria-live': 'polite' });
  const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: String(loadSetting('crowdGuestVolume', 0.9)), 'aria-label': 'Volume' }) as HTMLInputElement;
  const floorView = h(
    'section',
    { class: 'jtc-floor', hidden: true },
    h('header', { class: 'jtc-head' }, h('b', {}, 'JOIN THE CROWD'), status, leaveBtn),
    track,
    h('div', { class: 'jtc-meters' }, h('label', {}, 'Vibe', h('div', { class: 'vj-vibe' }, vibe)), h('label', {}, 'Your hype', h('div', { class: 'vj-vibe jtc-you' }, yourHype))),
    alert,
    pad,
    grooveText,
    moves,
    h('section', {}, h('h3', {}, 'Your LED sign'), h('div', { class: 'jtc-row' }, signIn, signBtn, signDown)),
    h('section', {}, h('div', { class: 'jtc-row' }, horn, cam)),
    h('section', {}, h('h3', {}, 'Where you’re dancing'), spots),
    h('section', {}, h('h3', {}, 'Ask for a track'), search, reqList),
    h('section', {}, h('h3', {}, 'On the floor'), friends),
    h('label', { class: 'jtc-volume' }, 'Volume', volume),
  );
  root.replaceChildren(h('div', { class: 'jtc' }, joinView, floorView, notes));

  let room: Room | null = null;
  let audio: HTMLAudioElement | null = null;
  let last: FloorState | null = null;
  let library: FloorTrack[] = [];
  let dropAt = -1e9;
  let busy = false;
  /** why the DJ sent everyone home, when they said */
  let byeWhy: string | null = null;
  const send = (m: GuestMsg) => room?.send(m);

  const note = (text: string, tone = 'info') => {
    const el = h('div', { class: `jtc-note ${tone}` }, text);
    notes.append(el);
    while (notes.children.length > 3) notes.firstElementChild?.remove();
    setTimeout(() => el.remove(), 4200);
  };

  const drawSpots = () => {
    spots.replaceChildren(
      ...SPOTS.map((s) => {
        const b = h('button', { type: 'button', class: `gs-chip${s.id === spot ? ' active' : ''}` }, s.label);
        b.addEventListener('click', () => {
          spot = s.id;
          saveSetting('crowdGuest', { name: nameIn.value, spot });
          send({ t: 'spot', id: s.id });
          drawSpots();
        });
        return b;
      }),
    );
  };
  drawSpots();

  const drawRequests = () => {
    const q = search.value.trim().toLowerCase();
    const hits = (q ? library.filter((t) => `${t.artist} ${t.title}`.toLowerCase().includes(q)) : library).slice(0, 30);
    reqList.replaceChildren(
      ...(hits.length
        ? hits.map((t) => {
            const b = h('button', { type: 'button', class: 'jtc-req' }, h('b', {}, t.title), t.artist ? h('span', {}, t.artist) : null);
            b.addEventListener('click', () => send({ t: 'request', trackId: t.id }));
            return b;
          })
        : [h('p', { class: 'note' }, library.length ? 'Nothing matches.' : 'The DJ’s library is on its way…')]),
    );
  };
  search.addEventListener('input', drawRequests);

  const show = (floor: boolean) => {
    joinView.hidden = floor;
    floorView.hidden = !floor;
  };

  const hear = (m: HostMsg) => {
    switch (m.t) {
      case 'welcome':
        note(`You’re on ${m.dj}’s floor`, 'good');
        break;
      case 'state':
        last = m.s;
        render(m.s);
        break;
      case 'drop':
        dropAt = performance.now();
        break;
      case 'library':
        library = Array.isArray(m.tracks) ? m.tracks.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string').map((t) => ({ id: t.id, title: String(t.title), artist: String(t.artist ?? '') })) : [];
        drawRequests();
        break;
      case 'note':
        if (typeof m.text === 'string') note(m.text.slice(0, 200), m.tone ?? 'info');
        break;
      case 'bye':
        if (typeof m.why === 'string') byeWhy = m.why.slice(0, 200);
        break;
    }
  };

  const render = (s: FloorState) => {
    setText(status, `${s.dj} · ${s.venue}`);
    setText(track, s.track ? `${s.track} · ${s.bpm} BPM` : 'Nothing playing yet');
    vibe.style.width = `${Math.round(s.vibe * 100)}%`;
    yourHype.style.width = `${Math.round(s.you.hype * 100)}%`;
    setText(grooveText, s.you.groove > 0.75 ? 'In the groove!' : s.you.groove > 0.4 ? 'Keeping time: nice' : 'Tap on the beat to dance');
    setClass(pad, 'groove', s.you.groove > 0.6);
    horn.disabled = !s.horn;
    cam.disabled = !s.cam;
    signDown.hidden = !s.you.sign;
    friends.replaceChildren(...s.friends.map((f) => h('div', { class: 'jtc-friend' }, h('span', {}, f.name), h('div', { class: 'vj-vibe' }, h('i', { style: { width: `${Math.round(f.hype * 100)}%` } })))));
  };

  // the drop alert: a warning in the build, JUMP when it lands
  setInterval(() => {
    const since = (performance.now() - dropAt) / 1000;
    const text = since < 2.5 ? 'JUMP!' : last?.playing && last.build > 0.55 ? 'Drop incoming… get ready to jump' : '';
    alert.hidden = !text;
    setText(alert, text);
    setClass(alert, 'now', since < 2.5);
  }, 120);

  const tap = (e?: Event) => {
    e?.preventDefault();
    send({ t: 'tap', at: performance.now() });
    pad.classList.remove('hit');
    void pad.offsetWidth;
    pad.classList.add('hit');
  };
  pad.addEventListener('pointerdown', tap);
  window.addEventListener('keydown', (e) => {
    if (!room || floorView.hidden || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.code === 'Space') tap(e);
    if (e.code === 'KeyJ') send({ t: 'move', id: 'jump' });
  });
  signBtn.addEventListener('click', () => {
    const text = cleanSign(signIn.value);
    if (text) send({ t: 'sign', text });
  });
  signIn.addEventListener('keydown', (e) => e.key === 'Enter' && signBtn.click());
  signDown.addEventListener('click', () => send({ t: 'sign', text: null }));
  horn.addEventListener('click', () => send({ t: 'horn' }));
  cam.addEventListener('click', () => send({ t: 'cam' }));
  volume.addEventListener('input', () => {
    if (audio) audio.volume = Number(volume.value);
    saveSetting('crowdGuestVolume', Number(volume.value));
  });
  leaveBtn.addEventListener('click', () => {
    send({ t: 'bye' });
    room?.leave();
  });

  joinBtn.addEventListener('click', async () => {
    if (busy) return;
    const code = normalizeRoomCode(codeIn.value);
    if (!code) {
      joinNote.textContent = JOIN_FAILURE_TEXT['bad-code'];
      return;
    }
    const name = cleanName(nameIn.value);
    saveSetting('crowdGuest', { name: nameIn.value, spot });
    busy = true;
    joinBtn.disabled = true;
    joinNote.textContent = 'Finding the room…';
    // the tap that joins also lets the page play the DJ's mix
    const silent = new Audio();
    void silent.play().catch(() => undefined);
    try {
      const r = await joinRoom(code, { mode: 'crowd', name, transport: o.transport });
      room = r;
      r.on('message', ({ m }) => isHostMsg(m) && hear(m));
      r.on('audio', ({ stream }) => {
        audio?.pause();
        audio = stream ? playStream(stream, Number(volume.value)) : null;
      });
      r.on('close', (why) => {
        room = null;
        audio?.pause();
        audio = null;
        last = null;
        joinNote.textContent = byeWhy ?? CLOSE_TEXT[why] ?? 'The floor closed.';
        byeWhy = null;
        show(false);
      });
      r.send({ t: 'hello', name, look: savedLook(), spot });
      setText(status, 'Connected');
      show(true);
    } catch (e) {
      joinNote.textContent = e instanceof JoinError ? JOIN_FAILURE_TEXT[e.reason] : 'Couldn’t join the room.';
    } finally {
      busy = false;
      joinBtn.disabled = false;
    }
  });
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && joinBtn.click());
  nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && joinBtn.click());
  (codeIn.value ? nameIn : codeIn).focus();
}
