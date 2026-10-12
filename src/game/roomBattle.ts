/*
 * Room Battle (a gig mode in the crazy rooms): you and a rival take turns
 * playing the room, 16 bars each. The room's actions are split in half: you
 * play the first half on your pads, the rival the second half on its turn.
 * A press scores by timing (on the beat best, on the downbeat better, just
 * after a drop best of all; mashing scores nothing), and at the end of each
 * pair of turns the crowd votes: the better turn (plus how the room was
 * feeling) takes the round. Pure logic: the app feeds it the beat and the
 * presses, and plays the rival's moves in the room.
 */

export type Turn = 'you' | 'rival';

export const TURN_BARS = 16;
/** presses closer together than this score nothing (no mashing) */
const MASH = 0.25;

export interface BattleUpdate {
  /** the rival presses this action index (of its half) now */
  rivalPress: number | null;
  /** a turn just ended: whose turn it is now */
  turnChanged: Turn | null;
  /** a round (both turns) just ended: who the crowd went with */
  round: { winner: Turn; you: number; rival: number } | null;
}

/** what a press is worth: timing against the beat, the downbeat, a drop just gone */
export function pressScore(beatPhase: number, beatInBar: number, sinceDrop: number): number {
  const d = Math.min(beatPhase, 1 - beatPhase);
  let pts = 10 * Math.max(0.2, 1 - d * 1.6);
  if (beatInBar === 0 && d < 0.15) pts *= 1.5;
  if (sinceDrop < 2) pts *= 2;
  return Math.round(pts);
}

export class RoomBattle {
  turn: Turn = 'you';
  /** rounds won */
  you = 0;
  rival = 0;
  private turnScore = { you: 0, rival: 0 };
  private turnVibe = { you: 0, rival: 0 };
  /** bars played this turn, counted one by one (a seek or a new track's grid doesn't skip a turn) */
  private barsIn = 0;
  private lastBar: number | null = null;
  private lastPress = -1e9;
  private lastRivalBeat = -1;
  private sinceDrop = 99;

  constructor(
    readonly rivalName: string,
    /** how good the rival is, 0..1 */
    readonly skill: number,
    private rand: () => number = Math.random,
  ) {}

  /** a pad pressed by you (only scores on your turn); returns the points */
  press(now: number, beatPhase: number, beatInBar: number): number {
    if (this.turn !== 'you') return 0;
    const ok = now - this.lastPress > MASH;
    this.lastPress = now;
    if (!ok) return 0;
    const pts = pressScore(beatPhase, beatInBar, this.sinceDrop);
    this.turnScore.you += pts;
    return pts;
  }

  /** each frame: the bar and beat, the room's vibe, whether a drop just hit */
  update(o: { dt: number; bar: number; beat: number; beatInBar: number; playing: boolean; dropHit: boolean; vibe: number; rivalActions: number }): BattleUpdate {
    const out: BattleUpdate = { rivalPress: null, turnChanged: null, round: null };
    if (o.dropHit) this.sinceDrop = 0;
    else this.sinceDrop += o.dt;
    if (!o.playing) {
      this.lastBar = null;
      return out;
    }
    const step = this.lastBar === null ? 0 : o.bar - this.lastBar;
    this.lastBar = o.bar;
    if (step > 0 && step <= 2) this.barsIn += step;
    this.turnVibe[this.turn] += o.vibe * o.dt;
    // the rival plays on its own turn: on the beat, more often the better it is
    const beat = Math.floor(o.beat);
    if (this.turn === 'rival' && beat !== this.lastRivalBeat) {
      this.lastRivalBeat = beat;
      if (o.rivalActions > 0 && this.rand() < 0.25 + this.skill * 0.35) {
        out.rivalPress = Math.floor(this.rand() * o.rivalActions);
        const sloppy = (1 - this.skill) * 0.35 * this.rand();
        this.turnScore.rival += pressScore(sloppy, o.beatInBar, this.sinceDrop);
      }
    }
    // turns change every 16 bars
    if (this.barsIn >= TURN_BARS) {
      this.barsIn = 0;
      if (this.turn === 'rival') {
        // a round's done: the crowd votes
        const you = this.turnScore.you + this.turnVibe.you * 2;
        const rival = this.turnScore.rival + this.turnVibe.rival * 2;
        const winner: Turn = you >= rival ? 'you' : 'rival';
        if (winner === 'you') this.you++;
        else this.rival++;
        out.round = { winner, you: this.you, rival: this.rival };
        this.turnScore = { you: 0, rival: 0 };
        this.turnVibe = { you: 0, rival: 0 };
      }
      this.turn = this.turn === 'you' ? 'rival' : 'you';
      out.turnChanged = this.turn;
    }
    return out;
  }

  /** your share of the battle so far, 0..1 (rounds, then this round's points) */
  share(): number {
    const r = this.you + this.rival;
    if (r) return this.you / r;
    const t = this.turnScore.you + this.turnScore.rival;
    return t ? this.turnScore.you / t : 0.5;
  }
}
