/*
 * The silent disco showdown in the app: the menu's way in (host online,
 * join with a code, practise), your pull on the room from a vibe meter of the
 * mode's own (the same judge as a gig: clean mixes, built drops, no dead
 * air), the HUD over the stage and the result at the end. The showdown
 * itself runs in discoSession.ts over a room (src/net).
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { Pull, type Channel } from '../game/silentDisco';
import { Snapshot } from '../game/snapshot';
import { SLOTS, VibeMeter, type DeckSnap } from '../game/vibe';
import { hostRoom, joinRoom, JoinError, JOIN_FAILURE_TEXT, playStream } from '../net';
import { SilentDiscoHud, showDiscoResult } from '../ui/SilentDiscoHud';
import type { Features } from '../visualizer/AudioFeatures';
import { DiscoSession, type DiscoHooks, type DiscoInfo } from './discoSession';

export interface DiscoAppHost {
  engine: AudioEngine;
  stageEl: HTMLElement;
  callout(c: { text: string; tone: 'good' | 'bad' | 'hype' }): void;
  djName(): string;
  crowd(what: 'cheer' | 'groan' | 'whoa'): void;
}

export class SilentDiscoMode {
  session: DiscoSession | null = null;
  private hud: SilentDiscoHud | null = null;
  private snap: Snapshot;
  private meter = new VibeMeter(SLOTS.peak);
  private pull = new Pull();
  private f: Features | null = null;
  private t = 0;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private resultShown = false;
  private hudT = 0;
  private decks: DeckSnap[] = [];

  constructor(private host: DiscoAppHost) {
    this.snap = new Snapshot(host.engine);
  }

  get on(): boolean {
    return !!this.session;
  }

  private hooks(): DiscoHooks {
    return {
      mine: () => this.mine(),
      note: (text, tone) => this.host.callout({ text, tone }),
      ended: (why) => {
        this.host.callout({ text: why, tone: 'bad' });
        this.stop();
      },
      audio: {
        mix: () => {
          const e = this.host.engine;
          if (typeof e.ctx.createMediaStreamDestination !== 'function') return null;
          if (!this.dest) {
            this.dest = e.ctx.createMediaStreamDestination();
            e.mixer.masterOut.connect(this.dest);
          }
          return this.dest.stream;
        },
        play: (stream) => {
          const el = playStream(stream, 0);
          return {
            volume: (v) => (el.volume = Math.max(0, Math.min(1, v))),
            stop: () => {
              el.pause();
              el.srcObject = null;
            },
          };
        },
      },
    };
  }

  /** open a room for friends to join (you play blue) */
  async hostOnline(minutes: number): Promise<string> {
    this.stop();
    const room = await hostRoom({ mode: 'disco', name: this.host.djName(), info: { role: 'dj' } satisfies DiscoInfo, maxPlayers: 12 });
    this.begin(DiscoSession.host(room, this.hooks(), this.host.djName(), minutes));
    return room.code;
  }

  /** join a friend's room; throws a sentence to show when it can't */
  async join(code: string, asDj: boolean): Promise<void> {
    this.stop();
    try {
      const room = await joinRoom(code, { mode: 'disco', name: this.host.djName(), info: { role: asDj ? 'dj' : 'watch' } satisfies DiscoInfo });
      this.begin(DiscoSession.guest(room, this.hooks(), asDj));
    } catch (e) {
      throw new Error(e instanceof JoinError ? JOIN_FAILURE_TEXT[e.reason] : 'Couldn’t join that room.');
    }
  }

  /** practise against a stand-in DJ on red */
  practice(minutes: number, rival: string, skill: number): void {
    this.stop();
    this.begin(DiscoSession.practice(this.hooks(), this.host.djName(), rival, minutes, skill));
    this.session!.start();
  }

  private begin(s: DiscoSession): void {
    this.session = s;
    this.meter = new VibeMeter(SLOTS.peak);
    this.pull = new Pull();
    this.t = 0;
    this.resultShown = false;
    this.hud = new SilentDiscoHud({
      start: () => this.session?.start(),
      flip: (ch: Channel) => this.session?.flip(ch),
      peek: (on) => this.session?.setPeek(on),
      leave: () => this.stop(),
    });
    this.host.stageEl.append(this.hud.el);
    this.hud.show(s.view());
  }

  stop(): void {
    this.session?.leave();
    this.session = null;
    this.hud?.el.remove();
    this.hud = null;
  }

  /** your pull on the room this frame, from the decks */
  private mine(): { pull: number; now: string; bpm: number; phase: number } {
    const f = this.f;
    const e = this.host.engine;
    // what the room hears most of
    let best = 0;
    let t = e.masterDeck?.playing ? e.masterDeck.track : null;
    this.decks.forEach((d, i) => {
      if (d.playing && d.audible > best && e.decks[i]?.track) {
        best = d.audible;
        t = e.decks[i].track;
      }
    });
    const now = t ? (t.meta.artist ? `${t.meta.artist} – ${t.meta.title || t.fileName}` : t.meta.title || t.fileName) : '';
    return { pull: this.pull.value, now, bpm: f?.bpm ?? 0, phase: f?.beatPhase ?? 0 };
  }

  update(dt: number, f: Features): void {
    const s = this.session;
    if (!s) return;
    this.f = f;
    // the judge: your own vibe meter, only while you're a DJ in it
    if (s.isDj) {
      this.t += dt;
      const decks = (this.decks = this.snap.decks(f));
      const events = this.meter.update({ t: this.t, dt, decks, level: this.snap.level(), redline: this.host.engine.redline, progress: 0.5, dropHit: f.dropHit });
      for (const ev of events) this.pull.event(ev);
      this.pull.update(dt, this.meter.vibe, decks.some((d) => d.playing && d.audible > 0.05));
    }
    s.update(dt);
    this.hudT += dt;
    if (this.hudT > 0.1) {
      this.hudT = 0;
      this.hud?.show(s.view());
    }
    const w = s.wire;
    if (w.phase !== 'over') this.resultShown = false;
    else if (!this.resultShown) {
      this.resultShown = true;
      const won = s.isDj && w.winner === s.channel;
      this.host.crowd(won || !s.isDj ? 'cheer' : 'groan');
      showDiscoResult(s.view(), { again: s.isHost ? () => this.again() : null, leave: () => this.stop() });
    }
  }

  /** the host runs it back with the same friends */
  private again(): void {
    const s = this.session;
    if (!s?.isHost) return;
    s.rematch();
    this.meter = new VibeMeter(SLOTS.peak);
    this.pull = new Pull();
  }
}
