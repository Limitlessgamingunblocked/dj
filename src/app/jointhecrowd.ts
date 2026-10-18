/*
 * Join the crowd (the host's side): friends join your set from a link or a
 * room code, on a phone or a laptop, and dance on your floor as their own
 * characters. They hear your mix live (the room streams it to them); they
 * tap along to dance, jump on the drops, hold up their own LED sign, ask for
 * tracks from your library, hit the air horn and put the camera at their
 * spot for a few bars. Their hype counts on the vibe meter.
 *
 * Runs on the shared room layer (src/net): the host is in charge, friends
 * only ever talk to the host, and everything they send is checked
 * (game/crowdGuests.ts). Their page is ui/CrowdGuest.ts; their characters
 * are three/guests.ts.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { DjMove } from '../character/Avatar';
import { loadSetting, saveSetting } from '../core/settings';
import type { LibraryTrack } from '../core/types';
import { Cooldowns, friendLift, GuestHype, parseGuestMsg, SPOTS, type FloorTrack, type HostMsg, type SpotId } from '../game/crowdGuests';
import { hostRoom, roomLink, type Player, type Room } from '../net';
import type { ActiveShot, CameraRig } from '../three/CameraRig';
import { GuestDancers, type GuestStage } from '../three/guests';
import type { Features } from '../visualizer/AudioFeatures';

export const CROWD_MODE = 'crowd';
/** you and eight friends: each one's a detailed character on the floor */
export const MAX_FRIENDS = 8;

export interface CrowdHostHooks {
  engine: AudioEngine;
  stage: GuestStage & { rig: CameraRig };
  dj(): string;
  venue(): string;
  track(): string;
  bpm(): number;
  /** the vibe meter: read, and lifted by the friends */
  vibe(): number;
  lift(dv: number): void;
  airhorn(): void;
  /** the room cheering (a friend's request played) */
  cheer(): void;
  tracks(): LibraryTrack[];
  callout(text: string, tone: 'good' | 'hype'): void;
  /** someone joined, left, or something on the panel changed */
  changed(): void;
}

export interface Friend {
  id: string;
  name: string;
  spot: SpotId;
  sign: string | null;
  hype: GuestHype;
  /** the track they asked for, still waiting to be played */
  request: { trackId: string; title: string } | null;
}

export interface CrowdSettings {
  /** friends can hit the air horn */
  horn: boolean;
  /** friends can put the camera at their spot */
  cam: boolean;
}

const COOLDOWN = { horn: 6, cam: 25, request: 20, sign: 2 };
/** seconds the camera stays at a friend's spot */
const CAM_SECONDS = 9;

export function trackLabel(t: LibraryTrack): { title: string; artist: string } {
  return { title: t.meta.title || t.fileName, artist: t.meta.artist || '' };
}

export class JoinTheCrowd {
  room: Room | null = null;
  readonly friends = new Map<string, Friend>();
  settings: CrowdSettings = { horn: true, cam: true, ...loadSetting<Partial<CrowdSettings>>('crowdHost', {}) };
  /** the last few things that happened, for the panel */
  readonly log: string[] = [];
  /** their characters on your floor (made when the floor first opens) */
  dancers: GuestDancers | null = null;
  private mix: MediaStreamAudioDestinationNode | null = null;
  private cool = new Cooldowns(COOLDOWN);
  private t = 0;
  private sendT = 0;
  private libT = 0;
  private libKey = '';
  private reqT = 0;
  private opening: Promise<string> | null = null;

  constructor(private hooks: CrowdHostHooks) {}

  get open(): boolean {
    return !!this.room?.open;
  }

  get code(): string | null {
    return this.room?.open ? this.room.code : null;
  }

  /**
   * The link friends open; null when the game isn't running from a web
   * address (the desktop app, the downloaded file): then they type the code
   * into their own Deckhouse.
   */
  link(): string | null {
    const c = this.code;
    if (!c || !/^https?:$/.test(location.protocol)) return null;
    return `${roomLink(c).split('#')[0]}#crowd`;
  }

  setSettings(s: Partial<CrowdSettings>): void {
    this.settings = { ...this.settings, ...s };
    saveSetting('crowdHost', this.settings);
  }

  /** open the floor to friends: the room code, once the room's up */
  start(transport: 'online' | 'memory' = 'online'): Promise<string> {
    if (this.room?.open) return Promise.resolve(this.room.code);
    this.opening ??= this.startRoom(transport).finally(() => (this.opening = null));
    return this.opening;
  }

  private async startRoom(transport: 'online' | 'memory'): Promise<string> {
    const room = await hostRoom({ mode: CROWD_MODE, name: this.hooks.dj(), maxPlayers: MAX_FRIENDS + 1, transport });
    this.room = room;
    this.dancers ??= new GuestDancers(this.hooks.stage);
    room.on('message', ({ m, from }) => this.hear(from, m));
    room.on('leave', (p) => this.gone(p.id, `${this.friends.get(p.id)?.name ?? p.name} left the floor`));
    room.on('close', () => this.stopped());
    // your mix, as the speakers play it, to every friend (and anyone who joins later)
    const ctx = this.hooks.engine.ctx;
    this.mix = ctx.createMediaStreamDestination();
    this.hooks.engine.mixer.masterOut.connect(this.mix);
    await room.shareAudio(this.mix.stream);
    this.hooks.changed();
    return room.code;
  }

  /** close the floor: everyone's sent home */
  stop(): void {
    const room = this.room;
    if (!room) return;
    room.send({ t: 'bye', why: 'The DJ closed the floor.' } satisfies HostMsg);
    room.leave();
    this.stopped();
  }

  private stopped(): void {
    for (const id of [...this.friends.keys()]) this.gone(id, null);
    if (this.mix) {
      try {
        this.hooks.engine.mixer.masterOut.disconnect(this.mix);
      } catch {
        /* already gone */
      }
      this.mix = null;
    }
    this.room = null;
    this.hooks.changed();
  }

  kick(id: string): void {
    const f = this.friends.get(id);
    this.room?.send({ t: 'bye', why: 'The DJ sent you home.' } satisfies HostMsg, id);
    this.room?.kick(id);
    this.gone(id, f ? `${f.name} was sent home` : null);
  }

  private gone(id: string, line: string | null): void {
    if (!this.friends.delete(id)) return;
    this.dancers?.remove(id);
    if (line) this.note(line);
    this.hooks.changed();
  }

  private note(line: string): void {
    this.log.unshift(line);
    if (this.log.length > 8) this.log.pop();
  }

  private tell(id: string, text: string, tone: 'good' | 'hype' | 'info' = 'info'): void {
    this.room?.send({ t: 'note', text, tone } satisfies HostMsg, id);
  }

  private hear(from: Player, raw: unknown): void {
    const m = parseGuestMsg(raw);
    if (!m || from.host) return;
    const h = this.hooks;
    const f = this.friends.get(from.id);
    if (m.t === 'hello') {
      if (f) {
        // a second hello: their look or name changed
        f.name = m.name;
        if (m.look) this.dancers?.setLook(f.id, m.look);
        return;
      }
      const friend: Friend = { id: from.id, name: m.name, spot: m.spot, sign: null, hype: new GuestHype(), request: null };
      this.friends.set(from.id, friend);
      this.dancers?.add(from.id, m.name, m.look, m.spot);
      this.room?.send({ t: 'welcome', id: from.id, dj: h.dj() } satisfies HostMsg, from.id);
      this.sendLibrary(from.id);
      h.callout(`${m.name} joined the crowd`, 'good');
      this.note(`${m.name} joined`);
      h.changed();
      return;
    }
    // nothing counts until they've said who they are
    if (!f) return;
    switch (m.t) {
      case 'tap':
        if (f.hype.tap(m.at)) this.dancers?.setMood(f.id, true, f.hype.hype);
        break;
      case 'move':
        if (f.hype.move(m.id)) {
          this.tell(f.id, 'You caught the drop!', 'hype');
          h.lift(0.015);
        }
        this.dancers?.perform(f.id, m.id as DjMove);
        break;
      case 'sign':
        if (!this.cool.take('sign', f.id, this.t)) return;
        f.sign = m.text;
        this.dancers?.setSign(f.id, m.text);
        if (m.text) {
          h.callout(`${f.name}: “${m.text}”`, 'hype');
          this.note(`${f.name} held up “${m.text}”`);
        }
        break;
      case 'request': {
        const tr = h.tracks().find((x) => x.id === m.trackId && x.status === 'ready');
        if (!tr) return this.tell(f.id, 'That track isn’t in the DJ’s library any more.');
        if (!this.cool.take('request', f.id, this.t)) return this.tell(f.id, `One request at a time: try again in ${Math.ceil(this.cool.left('request', f.id, this.t))} s.`);
        const { title, artist } = trackLabel(tr);
        f.request = { trackId: tr.id, title };
        h.callout(`${f.name} asks for ${artist ? `${artist} – ` : ''}${title}`, 'good');
        this.note(`${f.name} asked for ${title}`);
        this.tell(f.id, `You asked for ${title}.`, 'good');
        h.changed();
        break;
      }
      case 'horn':
        if (!this.settings.horn) return this.tell(f.id, 'The DJ has the air horn switched off.');
        if (!this.cool.take('horn', f.id, this.t)) return;
        h.airhorn();
        f.hype.move('fist_pump');
        break;
      case 'spot':
        f.spot = m.id;
        this.dancers?.setSpot(f.id, m.id);
        break;
      case 'cam':
        if (!this.settings.cam) return this.tell(f.id, 'The DJ has friend cams switched off.');
        if (!this.cool.take('cam', f.id, this.t)) return this.tell(f.id, `The camera’s yours again in ${Math.ceil(this.cool.left('cam', f.id, this.t))} s.`);
        this.camAt(f);
        break;
      case 'bye':
        this.gone(f.id, `${f.name} left the floor`);
        break;
    }
  }

  /** the camera at a friend's spot for a few bars */
  camAt(f: Friend): boolean {
    const v = this.dancers?.view(f.id);
    if (!v) return false;
    const shot: ActiveShot = {
      label: `${f.name}’s view`,
      close: false,
      hand: 0.7,
      seconds: CAM_SECONDS,
      pose: (u) => {
        // bobbing a little, like someone dancing with their phone up
        const pos = v.pos.clone();
        pos.y += 0.04 * Math.sin(u * 9);
        return { pos, target: v.target, fov: 58 };
      },
    };
    this.hooks.stage.rig.playShot(shot);
    this.hooks.callout(`${f.name}’s view`, 'good');
    this.tell(f.id, 'The camera’s at your spot!', 'good');
    return true;
  }

  private sendLibrary(to?: string): void {
    const tracks: FloorTrack[] = this.hooks
      .tracks()
      .filter((t) => t.status === 'ready')
      .map((t) => ({ id: t.id, ...trackLabel(t) }))
      .sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title))
      .slice(0, 250);
    this.libKey = tracks.map((t) => t.id).join();
    this.room?.send({ t: 'library', tracks } satisfies HostMsg, to);
  }

  /** every frame */
  update(dt: number, f: Features): void {
    const room = this.room;
    if (!room?.open) return;
    this.t += dt;
    const bpm = this.hooks.bpm() || f.bpm || 124;
    if (f.dropHit) {
      for (const fr of this.friends.values()) fr.hype.drop();
      room.send({ t: 'drop' } satisfies HostMsg);
    }
    const hypes: number[] = [];
    for (const fr of this.friends.values()) {
      fr.hype.update(dt, bpm);
      hypes.push(fr.hype.hype);
      this.dancers?.setMood(fr.id, fr.hype.active, fr.hype.hype);
    }
    // the friends dancing lift the room (only while there's music)
    if (f.playing && hypes.length) this.hooks.lift(friendLift(hypes) * dt);
    // requests: playing one is a moment for whoever asked
    this.reqT += dt;
    if (this.reqT > 1) {
      this.reqT = 0;
      const audible = this.hooks.engine.decks.filter((d) => d.playing && d.track).map((d) => d.track!.id);
      for (const fr of this.friends.values()) {
        if (!fr.request || !audible.includes(fr.request.trackId)) continue;
        this.tell(fr.id, `The DJ is playing your request: ${fr.request.title}!`, 'hype');
        this.hooks.callout(`For ${fr.name}: ${fr.request.title}`, 'hype');
        this.hooks.cheer();
        fr.hype.hype = Math.min(1, fr.hype.hype + 0.25);
        this.note(`Played ${fr.name}’s request`);
        fr.request = null;
        this.hooks.changed();
      }
    }
    // the library, again when it changes
    this.libT += dt;
    if (this.libT > 5) {
      this.libT = 0;
      const key = this.hooks
        .tracks()
        .filter((t) => t.status === 'ready')
        .map((t) => t.id)
        .slice(0, 250)
        .join();
      if (key.length !== this.libKey.length || key !== this.libKey) this.sendLibrary();
    }
    // the floor, to each friend, four times a second
    this.sendT += dt;
    if (this.sendT < 0.25 || !this.friends.size) return;
    this.sendT = 0;
    const friends = [...this.friends.values()].map((x) => ({ name: x.name, hype: Math.round(x.hype.hype * 100) / 100 }));
    const base = { dj: this.hooks.dj(), venue: this.hooks.venue(), track: this.hooks.track(), bpm: Math.round(bpm), playing: f.playing, vibe: this.hooks.vibe(), build: f.breakdown, friends, horn: this.settings.horn, cam: this.settings.cam };
    for (const fr of this.friends.values()) {
      room.send({ t: 'state', s: { ...base, you: { hype: fr.hype.hype, groove: fr.hype.groove, spot: fr.spot, sign: fr.sign } } } satisfies HostMsg, fr.id);
    }
  }

  /** a friend by name for the panel's buttons */
  spotLabel(id: SpotId): string {
    return SPOTS.find((s) => s.id === id)?.label ?? id;
  }

  /** the camera on a friend, from the panel */
  camOn(id: string): void {
    const f = this.friends.get(id);
    if (f) this.camAt(f);
  }
}
