/*
 * Hype man on the mic, the booth's side: a mic (yours, or a friend online)
 * goes into the mix and the music ducks under it; the MC's calls get the
 * crowd shouting back on the beat; mic moments score on the vibe meter
 * (game/hypeman.ts says how). The MC sees the card (ui/McCard.ts): the words
 * being sung, a nudge for what the set's doing, their pads and effects.
 *
 * The call pads are controls too (mc.call.*), so they go on keys, pads and MIDI.
 */
import type { AudioEngine } from '../../audio/AudioEngine';
import type { ControlRegistry } from '../../core/controls';
import { CALLS, MicJudge, micText, type CallId, type MicEvent } from '../../game/hypeman';
import type { LyricFrame } from '../../lyrics/LyricsEngine';
import { McCard } from '../../ui/McCard';
import { CrowdAnswers } from './answers';
import { hostMicRoom, localMicLink, mcLink, type McAction, type McState, type MicLink } from './link';
import { MicVoice } from './voice';

export interface HypeHost {
  engine: AudioEngine;
  reg: ControlRegistry;
  stage: HTMLElement;
  /** the meter the room follows (free play or the gig's) */
  meter(): { vibe: number; points: number };
  /** the beat clock */
  clock(): { playing: boolean; bpm: number; position: number; beatInBar: number; section: string };
  lyric(): LyricFrame | null;
  djName(): string;
  callout(c: { text: string; tone: 'good' | 'bad' | 'hype' }): void;
  /** the crowd copies a move for a while ('hands_up', 'clap', 'fist_pump', 'jump') */
  crowdMove(move: string, seconds: number): void;
  /** a moment worth keeping, for the replay buffer */
  mark?(label: string): void;
}

/** what each answer makes the crowd do, and for how long (seconds) */
const MOVES: Record<CallId, [string, number] | null> = { ho: ['fist_pump', 2], hands: ['hands_up', 5], noise: ['jump', 3], clap: ['clap', 6], name: ['hands_up', 4] };

/** the nudge on the MC's card */
export function hintFor(section: string, playing: boolean, vocal: boolean, nextIn: number | null): string {
  if (!playing) return 'Waiting for the music.';
  if (vocal) return 'Vocal’s in: let it breathe, or sing the hook with them.';
  if (nextIn !== null && nextIn < 4) return 'Vocal coming back in.';
  switch (section) {
    case 'build':
      return 'Build coming: hype them up!';
    case 'breakdown':
      return 'Breakdown: call and response time.';
    case 'drop':
      return 'Drop! Let it hit, then one big shout.';
    default:
      return 'Groove: keep it short, ride the beat.';
  }
}

export class HypeMan {
  readonly judge = new MicJudge();
  private voice: MicVoice;
  private answers: CrowdAnswers;
  private card: McCard | null = null;
  private link: (MicLink & { open?(): Promise<string | null> }) | null = null;
  private t = 0;
  private sendT = 0;
  private last = '';
  private mixOut: MediaStreamAudioDestinationNode | null = null;

  constructor(private host: HypeHost) {
    const e = host.engine;
    this.voice = new MicVoice(e.ctx, e.mixer);
    this.answers = new CrowdAnswers(e.ctx, e.mixer.room.input, e.crowd);
    for (const c of CALLS) {
      host.reg.register({
        id: `mc.call.${c.id}`,
        label: `Hype man: ${c.label}`,
        kind: 'button',
        press: () => this.on && this.arm(c.id),
        lit: () => (this.judge.armed?.call === c.id ? '#ff3b5c' : false),
      });
    }
  }

  get on(): boolean {
    return !!this.link;
  }

  /** the mic on this computer, on or off */
  async set(on: boolean): Promise<void> {
    if (!on) return this.stop();
    if (this.link) return;
    const card = this.makeCard('Your mic');
    const link = localMicLink(card);
    this.use(link);
    await this.host.engine.resume();
    const err = await link.open();
    if (err) {
      card.error(err);
      this.host.callout({ text: err, tone: 'bad' });
    }
  }

  /** a friend online on the mic: host a room and wait for them; resolves to the room code */
  async invite(transport?: 'online' | 'memory'): Promise<string | null> {
    this.stop();
    const card = this.makeCard('A friend online');
    card.error('Opening a room…');
    let link: Awaited<ReturnType<typeof hostMicRoom>>;
    try {
      link = await hostMicRoom(this.host.djName(), transport);
    } catch {
      card.error('Couldn’t open a room. Check your internet connection.');
      return null;
    }
    if (this.card !== card) {
      // closed while the room was opening
      link.close();
      return null;
    }
    this.use(link);
    card.error(null);
    card.invite(link.code, mcLink(link.code));
    await this.host.engine.resume();
    // their headphones hear the music (without their own voice coming back late)
    this.mixOut = this.host.engine.ctx.createMediaStreamDestination();
    this.voice.tapMusic(this.mixOut);
    link.sendMix?.(this.mixOut.stream);
    return link.code;
  }

  private makeCard(source: string): McCard {
    const v = this.voice;
    const card = new McCard({
      duckDb: { get: () => v.duckDb, set: (x) => (v.duckDb = x) },
      sensitivity: { get: () => v.sensitivity, set: (x) => (v.sensitivity = x) },
      gain: { get: () => v.gain, set: (x) => (v.gain = x) },
      source: () => source,
      close: () => this.stop(),
    });
    this.card = card;
    this.host.stage.append(card.el);
    return card;
  }

  private use(link: MicLink & { open?(): Promise<string | null> }): void {
    this.link = link;
    link.onVoice((stream, remote) => {
      this.voice.attach(stream, remote);
      this.card?.error(null);
      if (remote) this.card?.setWho(`${link.name}, online`);
    });
    link.onAction((a) => this.act(a));
  }

  private act(a: McAction): void {
    if (a.t === 'call') this.arm(a.call);
    else if (a.t === 'fx') Object.assign(this.voice.fx, a.fx);
    else if (a.t === 'hello') {
      this.card?.setWho(`${a.name}, online`);
      this.card?.invite(null, null);
      this.host.callout({ text: `${a.name} is on the mic`, tone: 'hype' });
    } else if (a.t === 'bye') {
      // the room stays open for them to come back (or someone else)
      this.host.callout({ text: 'Your MC left the mic', tone: 'good' });
      this.voice.detach();
      this.judge.armed = null;
      this.card?.setWho('A friend online');
      if (this.link && 'code' in this.link) this.card?.invite(String(this.link.code), mcLink(String(this.link.code)));
    }
  }

  arm(call: CallId): void {
    // pressing the armed call again takes it off
    if (this.judge.armed?.call === call) this.judge.armed = null;
    else this.judge.arm(call, this.t);
  }

  stop(): void {
    this.link?.close();
    this.link = null;
    this.voice.release();
    this.card?.el.remove();
    this.card = null;
    this.judge.armed = null;
    this.mixOut = null;
  }

  update(dt: number): void {
    if (!this.link) return;
    this.t += dt;
    const clk = this.host.clock();
    this.voice.update(dt, clk.bpm);
    const fr = this.host.lyric();
    const vocal = !!fr?.line && fr.weight > 0.3;
    const meter = this.host.meter();
    const evs = this.judge.update({
      t: this.t,
      dt,
      talking: this.voice.talking,
      playing: clk.playing,
      bpm: clk.bpm,
      beat: clk.position,
      section: clk.section,
      vocal,
      vibe: meter.vibe,
    });
    for (const e of evs) this.apply(e);
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 0.1;
      const nextIn = fr?.next ? fr.next.t - fr.pos : null;
      const s: McState = {
        t: 'state',
        line: fr?.line?.text ?? null,
        next: fr?.next?.text ?? null,
        hint: hintFor(clk.section, clk.playing, vocal, nextIn),
        section: clk.section,
        bpm: clk.playing ? clk.bpm : 0,
        beatInBar: clk.beatInBar,
        vibe: meter.vibe,
        armed: this.judge.armed?.call ?? null,
        armedLeft: this.judge.armedLeft(),
        level: this.voice.level,
        talking: this.voice.talking,
        points: this.judge.points,
        calls: this.judge.calls,
        fx: { ...this.voice.fx },
        djName: this.host.djName(),
        last: this.last,
      };
      this.link.send(s);
    }
  }

  private apply(e: MicEvent): void {
    const meter = this.host.meter();
    const say = micText(e, this.host.djName());
    if (say) {
      this.host.callout(say);
      this.last = say.text;
    }
    if (e.kind === 'missed') {
      this.last = '';
      return;
    }
    meter.vibe = Math.max(0.02, Math.min(1, meter.vibe + e.dv));
    if (e.kind === 'call') {
      const clk = this.host.clock();
      this.answers.answer(e.call, e.answerIn, e.strength, clk.bpm, meter.vibe);
      if (e.points) {
        meter.points += e.points;
        const mv = MOVES[e.call];
        if (mv && e.strength > 0.3) window.setTimeout(() => this.host.crowdMove(mv[0], mv[1]), e.answerIn * 1000);
        if (e.strength > 0.75) this.host.mark?.('MC call and response');
      }
    } else if (e.kind === 'hype') meter.points += e.points;
  }
}
