/*
 * The crowd beyond the vibe meter (three/venues/crowdShow.ts): the genre of
 * what's playing sets the dance style, crowd moments start when the room is
 * right for them, fans copy your DJ moves and your signature move on a big
 * drop, and the cardboard signs carry the current request, the regulars'
 * messages and a few of the crowd's own.
 *
 * The DJ moves are controls (dj.move.1–6), so they go on pads, keys and MIDI.
 */
import type { DjMove } from '../character/Avatar';
import { DJ_MOVES } from '../character/Avatar';
import type { ControlRegistry } from '../core/controls';
import type { LibraryTrack } from '../core/types';
import { attending, loadLoyalty, signFor } from '../game/regulars';
import { genreOf } from '../library/genres';
import { autoMoment, crowdShow } from '../three/venues/crowdShow';

export interface CrowdHost {
  reg: ControlRegistry;
  /** play a move on your character */
  perform(move: DjMove): void;
  /** your signature drop move (the look's) */
  dropMove(): string;
  hype(): number;
  playing(): boolean;
  /** the beat clock's section: 'build', 'drop', 'breakdown'… */
  section(): string;
  /** through the set or the night, 0..1, and whether it's a closing slot */
  progress(): number;
  closing(): boolean;
  leadTrack(): LibraryTrack | null;
  /** the crowd's request right now, if a gig's asking */
  request(): string | null;
  djName(): string;
  /** a move went out (the gig scores a well-timed one) */
  moved(move: DjMove): void;
}

/** the crowd's own cardboard messages, a few picked each night */
const CARD_MESSAGES = ['BEST NIGHT EVER', 'FIRST RAVE!', 'WE ♥ YOU', 'MUM SAYS HI', 'NO SLEEP TILL SUNRISE', 'BASS IN MY BONES', 'DANCE OR DIE', 'BUCKET LIST ✓', 'GIRLS TRIP!', 'STAG DO', 'MY FIRST TIME', 'I TOOK A NIGHT BUS FOR THIS'];

const REQUEST_SIGN: Record<string, string> = {
  'More energy!': 'MORE ENERGY!!',
  'Take it down a notch': 'TAKE IT DOWN',
  'Drop it!': 'DROP IT!',
  'Give us a long blend': 'LONG BLEND PLZ',
  'Filter the next one in': 'FILTER IT IN',
  'Something new!': 'PLAY SOMETHING NEW',
};

export class CrowdDirector {
  private checkT = 0;
  private cardsT = 0;
  private messages: string[];

  constructor(private host: CrowdHost) {
    const pool = CARD_MESSAGES.slice();
    this.messages = Array.from({ length: 5 }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    this.refreshRegulars();
    DJ_MOVES.forEach((m, i) => {
      let flash = 0;
      host.reg.register({
        id: `dj.move.${i + 1}`,
        label: `DJ move: ${m.label}`,
        kind: 'button',
        press: () => {
          flash = performance.now();
          this.move(m.id);
        },
        lit: () => (performance.now() - flash < m.beats * 480 ? '#ffd23f' : false),
      });
    });
  }

  /** the regulars at the front tonight (their shirts and signs); call after loyalty changes */
  refreshRegulars(): void {
    const front = attending(loadLoyalty()).filter((a) => a.front);
    crowdShow.front = front.slice(0, 3).map((a) => a.fan.color);
    this.frontSigns = front.slice(0, 3).map((a) => signFor(a.fan, this.host.djName()));
  }
  private frontSigns: string[] = [];

  /** a DJ move: your character does it, the front rows copy it, the gig hears about it */
  move(id: DjMove): void {
    this.host.perform(id);
    const m = DJ_MOVES.find((x) => x.id === id)!;
    crowdShow.copyMove(id, m.beats * (60 / 124), id === 'climb');
    this.host.moved(id);
  }

  update(dt: number, dropHit: boolean): void {
    const h = this.host;
    const track = h.leadTrack();
    crowdShow.genre = track ? genreOf(track).genre : '';
    crowdShow.update(dt, dropHit);
    // your signature move on a big drop: the whole room copies it
    if (dropHit && h.hype() > 0.55) crowdShow.copyMove(h.dropMove(), 8 * (60 / 124), true);
    // crowd moments, when the room's ready for one
    this.checkT += dt;
    if (this.checkT > 3) {
      this.checkT = 0;
      if (crowdShow.auto && !crowdShow.moment) {
        const sec = h.section();
        const id = autoMoment({ playing: h.playing(), hype: h.hype(), build: sec === 'build' ? 1 : 0, peak: sec === 'drop' ? 1 : 0, progress: h.progress(), closing: h.closing(), since: crowdShow.since, roll: Math.random() });
        if (id) crowdShow.start(id);
      }
    }
    // the cardboard signs: the regulars' up front, the request, the crowd's own
    this.cardsT += dt;
    if (this.cardsT > 1) {
      this.cardsT = 0;
      const req = h.request();
      const rows = [...this.frontSigns];
      while (rows.length < 3) rows.push(this.messages[rows.length + 2] ?? 'WOOO!');
      rows.push(req ? (REQUEST_SIGN[req] ?? req.toUpperCase()) : 'ONE MORE TUNE!');
      rows.push(...this.messages.slice(0, 4));
      crowdShow.setCards(rows);
    }
  }
}
