/*
 * Pass the aux on the laptop: the setup (the players, the clock, the rounds,
 * phones or not), and the night's HUD over the stage: a bar with whose turn
 * it is, the clock and the track to mix into; the handover card ("Pass it to
 * SAM" and Ready); the card after each mix; the vote, passed round the
 * laptop for anyone without a phone in; and the awards.
 */
import type { AuxNight } from '../app/passAux';
import { AUX_COLORS, awards, MAX_PLAYERS, MIN_PLAYERS, ROUND_CHOICES, shareText, standings, TURN_TIMES, cleanNames, type AuxConfig, type AuxPlayer } from '../game/passAux';
import { h, setClass, setText } from './dom';
import { openModal } from './modal';
import { toast } from './toast';
import './styles/passaux.css';

export interface AuxSetupHooks {
  /** open the room for phones (or close it): its code and link, or why it couldn't */
  phones(on: boolean): Promise<{ code: string; url: string } | string | null>;
  /** the phones in the room so far */
  joined(): { id: string; name: string }[];
  onJoined(fn: () => void): () => void;
  start(cfg: AuxConfig): void;
  cancel(): void;
}

const secs = (s: number) => (s < 120 ? `${s}s` : `${s / 60} min`);

export function openAuxSetup(o: AuxSetupHooks): void {
  let turnSecs = 90;
  let rounds = 1;
  let shuffle = true;
  let room: { code: string; url: string } | null = null;
  let started = false;
  const names: string[] = ['', '', ''];
  const list = h('div', { class: 'aux-names' });
  const phoneList = h('div', { class: 'gs-chips aux-phones' });
  const roomBox = h('div', { class: 'aux-room', hidden: true });
  const count = h('span', { class: 'gs-note' });
  const go = h('button', { type: 'button', class: 'btn primary aux-go' }, 'Start the night');

  const players = (): AuxPlayer[] => {
    const phones = o.joined();
    const typed = cleanNames(names).filter((n) => !phones.some((p) => p.name.toLowerCase() === n.toLowerCase()));
    const all = [...phones.map((p) => ({ id: p.id, name: p.name, device: true })), ...typed.map((n, i) => ({ id: `l${i}`, name: n, device: false }))].slice(0, MAX_PLAYERS);
    return all.map((p, i) => ({ ...p, color: AUX_COLORS[i % AUX_COLORS.length] }));
  };

  const refresh = () => {
    const n = players().length;
    setText(count, n < MIN_PLAYERS ? `${n} player${n === 1 ? '' : 's'}: you need ${MIN_PLAYERS} to ${MAX_PLAYERS}` : `${n} players, ${n * rounds} mixes`);
    (go as HTMLButtonElement).disabled = n < MIN_PLAYERS;
    const phones = o.joined();
    phoneList.replaceChildren(...(phones.length ? phones.map((p) => h('span', { class: 'gs-chip active' }, `📱 ${p.name}`)) : [h('span', { class: 'gs-note' }, 'Nobody has joined from a phone yet.')]));
  };

  const drawNames = () => {
    list.replaceChildren(
      ...names.map((n, i) => {
        const input = h('input', { type: 'text', class: 'aux-name', value: n, maxlength: 18, placeholder: `Player ${i + 1}`, 'aria-label': `Player ${i + 1}` }) as HTMLInputElement;
        input.addEventListener('input', () => {
          names[i] = input.value;
          refresh();
        });
        const rm = h('button', { type: 'button', class: 'btn ghost aux-rm', 'aria-label': `Remove player ${i + 1}`, title: 'Remove' }, '×');
        rm.addEventListener('click', () => {
          names.splice(i, 1);
          drawNames();
        });
        return h('div', { class: 'aux-name-row' }, h('i', { class: 'aux-dot', style: { background: AUX_COLORS[i % AUX_COLORS.length] } }), input, names.length > 1 ? rm : null);
      }),
    );
    if (names.length < MAX_PLAYERS) {
      const add = h('button', { type: 'button', class: 'btn ghost' }, '+ Add a player');
      add.addEventListener('click', () => {
        names.push('');
        drawNames();
        list.querySelectorAll('input')[names.length - 1]?.focus();
      });
      list.append(add);
    }
    refresh();
  };

  const chips = <T extends number>(label: string, values: readonly T[], get: () => T, set: (v: T) => void, text: (v: T) => string) => {
    const row = h('div', { class: 'gs-chips', role: 'radiogroup', 'aria-label': label });
    const draw = () =>
      row.replaceChildren(
        ...values.map((v) => {
          const b = h('button', { type: 'button', class: `gs-chip${get() === v ? ' active' : ''}`, role: 'radio', 'aria-checked': String(get() === v) }, text(v));
          b.addEventListener('click', () => {
            set(v);
            draw();
            refresh();
          });
          return b;
        }),
      );
    draw();
    return row;
  };

  const phonesBtn = h('button', { type: 'button', class: 'gs-chip', 'aria-pressed': 'false' }, '📱 Everyone’s phones too');
  let busy = false;
  phonesBtn.addEventListener('click', async () => {
    if (busy) return;
    const on = !room;
    busy = true;
    if (on) {
      roomBox.hidden = false;
      roomBox.replaceChildren(h('p', { class: 'gs-note' }, 'Opening a room…'));
    }
    const r = await o.phones(on);
    busy = false;
    room = r && typeof r === 'object' ? r : null;
    setClass(phonesBtn, 'active', !!room);
    phonesBtn.setAttribute('aria-pressed', String(!!room));
    roomBox.hidden = !room && typeof r !== 'string';
    if (typeof r === 'string') roomBox.replaceChildren(h('p', { class: 'gs-note aux-err' }, r));
    if (room) {
      const url = room.url;
      const link = h('input', { type: 'text', class: 'mono aux-link', readonly: true, value: url, 'aria-label': 'Join link' }) as HTMLInputElement;
      const copy = h('button', { type: 'button', class: 'btn ghost' }, 'Copy link');
      copy.addEventListener('click', () => void navigator.clipboard?.writeText(url).then(() => toast('Link copied.')));
      roomBox.replaceChildren(
        h('div', { class: 'aux-code' }, h('small', {}, 'Room code'), h('b', { class: 'mono' }, room.code)),
        h('div', { class: 'aux-link-row' }, link, copy),
        h('p', { class: 'gs-note' }, 'Friends open the link on their phones (or Deckhouse with #aux on the end, and the code) and put their name in. Their phone shows the clock, buzzes when it’s their turn, and takes a secret vote at the end. Anyone not in the room can listen to the mix on theirs.'),
        h('h4', {}, 'Joined'),
        phoneList,
      );
    }
    refresh();
  });

  const shuffleBox = h('input', { type: 'checkbox', checked: shuffle }) as HTMLInputElement;
  shuffleBox.addEventListener('change', () => (shuffle = shuffleBox.checked));

  const m = openModal('Pass the aux', () =>
    h(
      'div',
      { class: 'aux-setup' },
      h('p', { class: 'gs-brief' }, 'A party game for 3 to 8. One track each, in turns: you’ve got to mix into whatever the last person left you before the clock runs out. Every mix is scored on the beatmatch, the key, the tempo jump and how fast you got in. At the end the room votes for the mix of the night, and the awards go out.'),
      h('section', {}, h('h3', {}, 'Who’s playing'), list),
      h('section', {}, h('h3', {}, 'Time to get your track in'), chips('Time per turn', TURN_TIMES, () => turnSecs as (typeof TURN_TIMES)[number], (v) => (turnSecs = v), secs)),
      h('section', {}, h('h3', {}, 'Rounds'), chips('Rounds', ROUND_CHOICES, () => rounds as (typeof ROUND_CHOICES)[number], (v) => (rounds = v), (v) => `${v} track${v > 1 ? 's' : ''} each`)),
      h('section', {}, h('h3', {}, 'Play on'), h('div', { class: 'gs-chips' }, h('span', { class: 'gs-chip active' }, '💻 This laptop, passed round'), phonesBtn), roomBox),
      h('label', { class: 'aux-check' }, shuffleBox, ' Shuffle who goes first'),
      h('div', { class: 'aux-foot' }, count, go),
    ),
  );
  const off = o.onJoined(refresh);
  const close = m.close;
  m.close = () => {
    off();
    close();
    if (!started) o.cancel();
  };
  go.addEventListener('click', () => {
    let ps = players();
    if (ps.length < MIN_PLAYERS) return;
    if (shuffle) {
      for (let i = ps.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ps[i], ps[j]] = [ps[j], ps[i]];
      }
      ps = ps.map((p, i) => ({ ...p, color: AUX_COLORS[i % AUX_COLORS.length] }));
    }
    started = true;
    m.close();
    o.start({ players: ps, rounds, turnSecs });
  });
  drawNames();
}

/* ------------------------------------------------------------------ */
/* the night over the stage                                             */
/* ------------------------------------------------------------------ */

export interface AuxHudHooks {
  ready(): void;
  skip(): void;
  vote(voter: string, turn: number): void;
  closeVote(): void;
  end(): void;
  again(): void;
  night(): AuxNight | null;
  /** the phones' room, if it's open */
  room(): { code: string; url: string } | null;
}

/** replace an element's children, leaving out the ones that aren't there */
const fill = (el: HTMLElement, ...kids: (Node | null)[]) => el.replaceChildren(...kids.filter((k): k is Node => !!k));

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;

export class AuxHud {
  readonly el: HTMLElement;
  private who = h('span', { class: 'aux-who' });
  private round = h('span', { class: 'aux-round' });
  private clockEl = h('span', { class: 'aux-clock', role: 'timer' });
  private into = h('span', { class: 'aux-into' });
  private roomEl = h('span', { class: 'aux-roomchip mono', title: 'Join from a phone: Deckhouse#aux and this code' });
  private card = h('div', { class: 'aux-card', role: 'dialog', 'aria-live': 'polite' });
  private auto = h('small', { class: 'aux-auto' });
  private skipBtn = h('button', { type: 'button', class: 'btn ghost' }, 'Skip');
  private shown = '';
  /** the voter whose ballot is up on the laptop */
  private voter: string | null = null;
  private voterOk = false;

  constructor(private o: AuxHudHooks) {
    const end = h('button', { type: 'button', class: 'btn ghost' }, 'End night');
    end.addEventListener('click', () => {
      const n = o.night();
      if (n && n.phase !== 'awards' && n.turns.length && !confirm('End Pass the aux? The scores so far are lost.')) return;
      o.end();
    });
    this.skipBtn.addEventListener('click', () => o.skip());
    this.el = h(
      'div',
      { class: 'aux' },
      h('div', { class: 'aux-bar' }, h('b', { class: 'aux-title' }, 'PASS THE AUX'), this.round, this.who, this.clockEl, this.into, this.roomEl, h('span', { class: 'aux-btns' }, this.skipBtn, end)),
      this.card,
    );
  }

  private name(id: string | null | undefined): HTMLElement {
    const p = this.o.night()?.player(id);
    return h('b', { class: 'aux-pname', style: { color: p?.color ?? '#fff' } }, p?.name ?? '?');
  }

  update(changed: boolean): void {
    const n = this.o.night();
    if (!n) return;
    const p = n.current;
    setText(this.round, n.phase === 'voting' || n.phase === 'awards' ? 'Final' : `Round ${n.round}/${n.cfg.rounds} · Mix ${Math.min(n.idx + 1, n.order.length)}/${n.order.length}`);
    this.who.replaceChildren(...(p ? [this.name(p.id)] : []));
    const left = n.timeLeft;
    setText(this.clockEl, n.isIn ? 'IN' : left === null ? '' : clock(left));
    setClass(this.clockEl, 'low', n.phase === 'mixing' && !n.isIn && left !== null && left <= 10);
    setClass(this.clockEl, 'in', n.isIn);
    this.clockEl.hidden = left === null && !n.isIn;
    setText(this.into, n.phase === 'mixing' ? (n.from ? (n.isIn ? `Now take ${n.from.title} out` : `Into: ${n.from.title}${n.from.artist ? ` · ${n.from.artist}` : ''}`) : 'Opening the night') : '');
    this.skipBtn.hidden = !(n.phase === 'handoff' || n.phase === 'mixing');
    const room = this.o.room();
    this.roomEl.hidden = !room;
    if (room) setText(this.roomEl, `📱 ${room.code}`);
    if (n.phase === 'handoff') setText(this.auto, `The clock starts by itself in ${Math.ceil(n.autoIn)}s`);
    const key = `${n.phase}:${n.idx}:${n.turns.length}:${Object.keys(n.votes).length}:${n.from?.id ?? ''}:${n.cfg.players.map((x) => +!!x.device).join('')}`;
    if (!changed && key === this.shown) return;
    this.shown = key;
    this.drawCard(n);
  }

  private standingsEl(n: AuxNight, big = false): HTMLElement {
    const st = standings(n.cfg.players, n.turns, n.votes);
    return h(
      'ol',
      { class: `aux-table${big ? ' big' : ''}` },
      ...st.map((s) => h('li', {}, this.name(s.player), h('span', {}, s.votes ? `${s.points} + ${s.votes} vote${s.votes > 1 ? 's' : ''}` : ''), h('b', {}, String(s.total)))),
    );
  }

  private drawCard(n: AuxNight): void {
    const c = this.card;
    c.className = `aux-card ${n.phase}`;
    c.hidden = n.phase === 'mixing';
    const p = n.current;
    if (n.phase === 'handoff' && p) {
      const ready = h('button', { type: 'button', class: 'btn primary aux-ready' }, 'I’m ready');
      ready.addEventListener('click', () => this.o.ready());
      const f = n.from;
      fill(c, 
        h('small', {}, n.idx === 0 ? 'First up' : 'Pass the laptop'),
        h('h2', {}, 'Pass it to ', this.name(p.id)),
        f
          ? h('p', { class: 'aux-from' }, 'You’re mixing into ', h('b', {}, f.title), f.artist ? ` by ${f.artist}` : '', h('span', { class: 'aux-tags' }, f.bpm ? `${Math.round(f.bpm)} BPM` : '', f.key ? ` · ${f.key.camelot}` : ''))
          : h('p', { class: 'aux-from' }, 'You open the night. Get any track playing and up in the mix.'),
        h('p', { class: 'gs-note' }, `${clock(n.cfg.turnSecs)} to get your track playing and up in the mix, then take the last one out.${p.device ? ' You can press Ready on your phone too.' : ''}`),
        ready,
        this.auto,
        n.turns.length ? this.standingsEl(n) : null,
        n.upNext ? h('small', { class: 'aux-next' }, 'Up next: ', this.name(n.upNext.id)) : null,
      );
      ready.focus({ preventScroll: true });
      return;
    }
    if (n.phase === 'scored' && n.last) {
      const t = n.last;
      fill(c, h('small', {}, t.from ? 'The mix' : 'The opener'), h('h2', {}, this.name(t.player)), h('div', { class: 'aux-score' }, String(t.score)), h('div', { class: 'aux-notes' }, ...t.notes.map((x) => h('span', {}, x))), t.to ? h('p', { class: 'gs-note' }, t.from ? `${t.from.title} → ${t.to.title}` : t.to.title) : null);
      return;
    }
    if (n.phase === 'voting') {
      const local = n.localVoters();
      if (!local.some((x) => x.id === this.voter)) {
        this.voter = local[0]?.id ?? null;
        this.voterOk = false;
      }
      const phones = n.cfg.players.filter((x) => x.device && !(x.id in n.votes) && n.ballot(x.id).length);
      const close = h('button', { type: 'button', class: 'btn ghost' }, 'Close the vote');
      close.addEventListener('click', () => this.o.closeVote());
      const waiting = phones.length ? h('p', { class: 'gs-note' }, 'Voting on their phones: ', ...phones.map((x, i) => [i ? ', ' : '', this.name(x.id)])) : null;
      if (!this.voter) {
        fill(c, h('small', {}, 'The vote'), h('h2', {}, 'Waiting for the phones'), waiting, close);
        return;
      }
      const v = this.voter;
      if (!this.voterOk) {
        // the next voter takes the laptop before their ballot shows (it's a secret vote)
        const ok = h('button', { type: 'button', class: 'btn primary aux-ready' }, 'It’s me');
        ok.addEventListener('click', () => {
          this.voterOk = true;
          this.drawCard(n);
        });
        fill(c, h('small', {}, 'Secret vote for the mix of the night'), h('h2', {}, 'Pass it to ', this.name(v)), ok, waiting);
        return;
      }
      fill(c, 
        h('small', {}, 'Your secret vote'),
        h('h2', {}, this.name(v), ': the mix of the night?'),
        h(
          'div',
          { class: 'aux-ballot' },
          ...n.ballot(v).map((i) => {
            const t = n.turns[i];
            const b = h('button', { type: 'button', class: 'aux-pick' }, this.name(t.player), h('span', {}, `${t.from?.title ?? ''} → ${t.to?.title ?? ''}`));
            b.addEventListener('click', () => {
              this.voterOk = false;
              this.o.vote(v, i);
            });
            return b;
          }),
        ),
        waiting,
        phones.length ? close : null,
      );
      return;
    }
    if (n.phase === 'awards') {
      const aw = awards(n.cfg.players, n.turns, n.votes);
      const copy = h('button', { type: 'button', class: 'btn ghost' }, 'Copy the results');
      copy.addEventListener('click', () => void navigator.clipboard?.writeText(shareText(n.cfg.players, n.turns, n.votes)).then(() => toast('Results copied. Paste them in the group chat.')));
      const again = h('button', { type: 'button', class: 'btn' }, 'Play again');
      again.addEventListener('click', () => this.o.again());
      const done = h('button', { type: 'button', class: 'btn primary' }, 'Done');
      done.addEventListener('click', () => this.o.end());
      fill(c, 
        h('small', {}, 'Pass the aux'),
        h('h2', {}, 'The awards'),
        h('div', { class: 'aux-awards' }, ...aw.map((a) => h('div', { class: `aux-award ${a.id}` }, h('small', {}, a.title), this.name(a.player), h('span', {}, a.why)))),
        this.standingsEl(n, true),
        h('div', { class: 'aux-foot' }, copy, again, done),
      );
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
