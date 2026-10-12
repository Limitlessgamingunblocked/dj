/*
 * The circuit inside a set (the logic is game/circuit.ts):
 *   - a residency night: the room's as full as the residency has grown, and
 *     it remembers last week (a track you played then gets a bored groan)
 *   - a tour leg: the city's crowd has its taste (their genres lift the room)
 *   - a festival clash: a rival on the other stage; the field drifts to
 *     whoever's playing better, and you can see them go
 *   - a night event: a power cut (half the lights on the generator), rain at
 *     the open-air venues, a mixer channel dying, a fire alarm (the speakers
 *     go quiet; bring the room back after)
 * Everything it changes (lights, speakers, channels, crowd) is put back in
 * dispose(), whatever happens to the set.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import { buzz } from '../audio/sfx';
import type { Booking } from '../core/models';
import { cityTaste, clashRival, clashStep, NIGHT_EVENTS, pickNightEvent, tourCity, type City, type CircuitSave, type NightEventId, type Residency } from '../game/circuit';
import type { Gig } from '../game/Gig';
import { RIVALS, type RivalId } from '../game/rivals';
import { crowdShow } from '../three/venues/crowdShow';
import { showPower } from '../three/venues/show';
import type { DeckSnap } from '../game/vibe';

/** the venues under the open sky (rain can fall there) */
export const OUTDOOR = ['rooftop', 'beach', 'boat', 'festival', 'sunrise', 'burningman'];

export interface CircuitGigHost {
  engine: AudioEngine;
  say(who: string, text: string): void;
  callout(c: { text: string; tone: 'good' | 'bad' | 'hype' }): void;
  crowd(what: 'cheer' | 'groan' | 'boo' | 'whoa' | 'chant'): void;
  /** the HUD's rival panel (the clash) */
  panel(o: { name: string; color: string; chemistry: number; turn: 'you' | 'rival'; label?: string; meter?: string; note?: string } | null): void;
  /** the HUD's event banner */
  alert(o: { text: string; left: number; tone?: 'bad' | 'warn' } | null): void;
  /** a track's genre */
  genreOf(id: string): string | null;
  /** the channels the room can't hear */
  dead: Set<number>;
}

export interface CircuitNote {
  text: string;
  good: boolean;
}

export interface CircuitGigOut {
  notes: CircuitNote[];
  /** the clash: your share of the field over the set */
  clash: { rival: string; share: number } | null;
  /** night events and whether you rode them out */
  events: { id: NightEventId; ok: boolean }[];
}

/** set this before a set to force its night event (the debug menu and the screenshots) */
export const forceNight: { id: NightEventId | null } = { id: null };

export class CircuitGig {
  private res: Residency | null;
  private city: City | null;
  private rival: RivalId | null;
  private share = 0.5;
  private shareSum = 0;
  private shareT = 0;
  private drifted = -1e9;
  private gained = false;
  private seen = 0;
  private repeats = 0;
  private lovedSaid = false;
  private offTaste = 0;
  private tasteSaid = false;
  private plan: { id: NightEventId; at: number } | null;
  private ev: { id: NightEventId; t: number; len: number; v0: number; ch: number; done: boolean } | null = null;
  private comeback = -1;
  private events: { id: NightEventId; ok: boolean }[] = [];
  private notes: CircuitNote[] = [];
  private stopSound: (() => void) | null = null;
  private timers: number[] = [];

  constructor(
    private host: CircuitGigHost,
    private gig: Gig,
    booking: Booking | null,
    circuit: CircuitSave,
    opts: { events: boolean },
  ) {
    this.res = booking?.special === 'residency' ? circuit.residency : null;
    this.city = tourCity(booking?.special);
    this.rival = clashRival(booking?.special);
    const outdoor = OUTDOOR.includes(gig.config.venue);
    this.plan = forceNight.id ? { id: forceNight.id, at: 0.2 } : opts.events ? pickNightEvent(outdoor, Math.random) : null;
    if (this.plan && NIGHT_EVENTS[this.plan.id].outdoorOnly && !outdoor) this.plan = null;
    forceNight.id = null;
    // the residency's room: as full as it has grown
    if (this.res) crowdShow.share = Math.max(0.5, Math.min(1, 0.35 + 0.6 * this.res.crowd));
    if (this.rival) crowdShow.share = 0.85;
  }

  /** what the promoter says as the set starts */
  start(): void {
    const later = (ms: number, fn: () => void) => this.timers.push(window.setTimeout(fn, ms));
    if (this.res) {
      const r = this.res;
      later(5600, () => this.host.say('Residency:', r.weeks ? `Week ${r.weeks + 1}. The room’s ${Math.round(r.crowd * 100)}% full and they remember last week: keep it fresh.` : 'Week one. Win this room and it grows every week.'));
    }
    if (this.city) {
      const c = this.city;
      later(5600, () => this.host.say(`${c.name}:`, `${c.taste}. Give them that and they’ll love you.`));
    }
    if (this.rival) {
      const rv = RIVALS[this.rival];
      later(5600, () => this.host.say('Stage manager:', `${rv.name} is on the other stage right now. Play better and the field comes to you.`));
    }
  }

  update(dt: number, decks: DeckSnap[], dropHit: boolean, played: string[]): void {
    const gig = this.gig;
    if (gig.phase === 'waiting' || gig.phase === 'over') return;
    const m = gig.meter;
    // the residency remembers last week
    if (this.res && played.length > this.seen) {
      for (const id of played.slice(this.seen)) {
        if (!this.res.lastTracks.includes(id)) continue;
        this.repeats++;
        m.vibe = Math.max(0, m.vibe - 0.04);
        this.host.callout({ text: 'They heard this one last week', tone: 'bad' });
        if (this.repeats === 1) this.host.crowd('groan');
      }
      this.seen = played.length;
    }
    // the city's taste
    const loud = decks.filter((d) => d.trackId && d.playing && d.audible > 0.12).sort((a, b) => b.audible - a.audible)[0];
    if (this.city && loud?.trackId) {
      const genre = this.host.genreOf(loud.trackId) ?? '';
      const k = cityTaste(this.city.id, genre);
      if (k > 0) {
        m.vibe = Math.min(1, m.vibe + dt * 0.003 * k);
        if (!this.lovedSaid && k >= 1) {
          this.lovedSaid = true;
          this.host.callout({ text: `${this.city.name} loves this`, tone: 'hype' });
          this.host.crowd('cheer');
        }
      } else if (genre) {
        this.offTaste += dt;
        if (this.offTaste > 45 && !this.tasteSaid) {
          this.tasteSaid = true;
          this.host.say(`${this.city.name}:`, `The crowd’s polite, but they came for ${this.city.genres.slice(0, 2).join(' and ').toLowerCase()}.`);
        }
      }
    }
    // the clash: the field drifts
    if (this.rival) this.clash(dt, gig);
    // the night event
    this.nightEvent(dt, dropHit);
  }

  private clash(dt: number, gig: Gig): void {
    const rv = RIVALS[this.rival!];
    const t = gig.t;
    const seed = this.rival!.length;
    const rival = 0.56 + 0.14 * Math.sin(t / 41 + seed) + 0.07 * Math.sin(t / 13 + seed * 2);
    const before = this.share;
    this.share = clashStep(this.share, gig.meter.vibe, rival, dt);
    this.shareSum += this.share * dt;
    this.shareT += dt;
    crowdShow.share = Math.max(0.3, Math.min(1, 0.3 + this.share * 0.85));
    if (this.share < 0.4 && before >= 0.4 && t - this.drifted > 30) {
      this.drifted = t;
      this.host.callout({ text: `They’re drifting to ${rv.name}’s stage`, tone: 'bad' });
    }
    if (this.share > 0.65 && before <= 0.65 && !this.gained) {
      this.gained = true;
      this.host.callout({ text: `${rv.name}’s crowd is coming over to you`, tone: 'hype' });
      this.host.crowd('cheer');
    }
    this.host.panel({ name: rv.name, color: rv.color, chemistry: this.share, turn: this.share >= 0.5 ? 'you' : 'rival', label: 'Clash', meter: 'Your share of the field', note: `${Math.round(this.share * 100)}% with you` });
  }

  private nightEvent(dt: number, dropHit: boolean): void {
    const gig = this.gig;
    const m = gig.meter;
    // after the fire alarm: a drop brings them back with a bang
    if (this.comeback >= 0) {
      this.comeback += dt;
      if (dropHit) {
        this.comeback = -1;
        m.vibe = Math.min(1, m.vibe + 0.06);
        m.points += 400;
        this.host.callout({ text: 'Back with a bang! +400', tone: 'hype' });
        this.host.crowd('cheer');
        const last = this.events[this.events.length - 1];
        if (last) last.ok = true;
      } else if (this.comeback > 30) this.comeback = -1;
    }
    if (!this.ev && this.plan && !this.events.some((x) => x.id === this.plan!.id) && gig.phase === 'live' && gig.progress >= this.plan.at && gig.t > 25) this.begin(this.plan.id);
    const ev = this.ev;
    if (!ev) return;
    ev.t += dt;
    const left = 1 - ev.t / ev.len;
    const def = NIGHT_EVENTS[ev.id];
    switch (ev.id) {
      case 'powercut':
        // the lights die, then the generator brings half of them back
        showPower.target = ev.t < 1.4 ? 0.04 : 0.5;
        break;
      case 'rain':
        crowdShow.rain = Math.min(1, ev.t / 6) * Math.min(1, (ev.len - ev.t) / 6 + 0.1);
        m.vibe = Math.max(0, m.vibe - dt * 0.0015);
        break;
      case 'channel':
        break;
      case 'alarm':
        // the room waits: no music, the vibe can only sag
        m.vibe = Math.min(m.vibe, Math.max(0, ev.v0 - 0.006 * ev.t));
        break;
    }
    this.host.alert({ text: ev.id === 'channel' ? `${def.label}: channel ${ev.ch + 1} is dead, ${def.tip}` : `${def.label}: ${def.tip}`, left, tone: ev.id === 'rain' ? 'warn' : 'bad' });
    if (ev.t >= ev.len) this.finish();
  }

  private begin(id: NightEventId): void {
    const gig = this.gig;
    const e = this.host.engine;
    const def = NIGHT_EVENTS[id];
    let ch = -1;
    this.ev = { id, t: 0, len: def.len, v0: gig.meter.vibe, ch, done: false };
    this.host.say('Night event:', def.say);
    this.host.callout({ text: def.label, tone: 'bad' });
    switch (id) {
      case 'powercut':
        gig.meter.vibe = Math.max(0, gig.meter.vibe - 0.05);
        this.host.crowd('whoa');
        try {
          buzz(e.ctx, 0.12);
        } catch {
          // no audio
        }
        break;
      case 'rain':
        this.stopSound = rainSound(e.ctx);
        break;
      case 'channel': {
        // the deck that isn't carrying the room dies (the one you'd mix in next)
        const loud = e.channels.map((c, i) => ({ i, a: c.state.fader * c.xfGain * (e.decks[i]?.playing ? 1 : 0) }));
        loud.sort((a, b) => a.a - b.a);
        ch = loud[0]?.i ?? 1;
        this.ev.ch = ch;
        this.host.dead.add(ch);
        const g = e.channels[ch]?.out.gain;
        g?.setTargetAtTime(0, e.ctx.currentTime, 0.02);
        break;
      }
      case 'alarm':
        e.mixer.speakers(false);
        this.stopSound = alarmSound(e.ctx, def.len);
        this.host.crowd('whoa');
        break;
    }
  }

  private finish(): void {
    const ev = this.ev;
    if (!ev || ev.done) return;
    ev.done = true;
    const gig = this.gig;
    const m = gig.meter;
    const e = this.host.engine;
    let ok = false;
    switch (ev.id) {
      case 'powercut':
        showPower.target = 1;
        ok = m.vibe >= ev.v0 - 0.08;
        this.host.say('Tech:', 'Mains are back. Full rig!');
        if (ok) {
          m.points += 300;
          this.host.callout({ text: 'Kept them dancing in the dark +300', tone: 'hype' });
        }
        break;
      case 'rain':
        crowdShow.rain = 0;
        ok = m.vibe >= 0.6;
        this.host.say('Promoter:', ok ? 'They danced through the whole downpour. Legendary.' : 'Rain’s easing off. Win them back.');
        if (ok) {
          m.points += 300;
          this.host.callout({ text: 'They danced through the rain +300', tone: 'hype' });
        }
        break;
      case 'channel':
        this.restoreChannel(ev.ch);
        ok = m.vibe >= ev.v0 - 0.05;
        this.host.say('Tech:', `Channel ${ev.ch + 1}’s fixed. All yours again.`);
        if (ok) {
          m.points += 250;
          this.host.callout({ text: 'Mixed round a dead channel +250', tone: 'good' });
        }
        break;
      case 'alarm':
        e.mixer.speakers(true);
        this.host.say('Security:', 'False alarm, we’re back! Bring them back in.');
        this.comeback = 0;
        break;
    }
    this.stopSound?.();
    this.stopSound = null;
    this.events.push({ id: ev.id, ok });
    this.host.alert(null);
    this.ev = null;
  }

  private restoreChannel(ch: number): void {
    const e = this.host.engine;
    this.host.dead.delete(ch);
    e.channels[ch]?.out.gain.setTargetAtTime(1, e.ctx.currentTime, 0.05);
  }

  /** how the circuit went tonight, for the results */
  summary(): CircuitGigOut {
    const notes = this.notes.slice();
    for (const ev of this.events) notes.push({ text: `${NIGHT_EVENTS[ev.id].label}: ${ev.ok ? 'you rode it out' : 'it cost you'}`, good: ev.ok });
    if (this.ev) notes.push({ text: `${NIGHT_EVENTS[this.ev.id].label}: still going when the set ended`, good: this.gig.meter.vibe >= this.ev.v0 - 0.05 });
    if (this.res) notes.push({ text: this.repeats ? `${this.repeats} track${this.repeats > 1 ? 's' : ''} from last week: the regulars noticed` : 'Nothing from last week: the room loved it fresh', good: !this.repeats });
    const clash = this.rival ? { rival: RIVALS[this.rival].name, share: this.shareT > 0 ? this.shareSum / this.shareT : this.share } : null;
    return { notes, clash, events: this.events.slice() };
  }

  /** put everything back: lights, speakers, channels, the crowd */
  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.ev?.id === 'channel') this.restoreChannel(this.ev.ch);
    for (const ch of [...this.host.dead]) this.restoreChannel(ch);
    this.host.engine.mixer.speakers(true);
    showPower.target = 1;
    crowdShow.rain = 0;
    crowdShow.share = 1;
    this.stopSound?.();
    this.stopSound = null;
    this.host.alert(null);
    if (this.rival) this.host.panel(null);
    this.ev = null;
  }
}

/** a fire alarm: a two-tone bell pattern, softened */
function alarmSound(ctx: AudioContext, secs: number): () => void {
  const o = ctx.createOscillator();
  o.type = 'square';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.value = 0;
  o.connect(lp).connect(g).connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  for (let t = 0; t < secs; t += 0.6) {
    o.frequency.setValueAtTime(t % 1.2 < 0.6 ? 960 : 760, t0 + t);
    g.gain.setValueAtTime(0.05, t0 + t);
    g.gain.setValueAtTime(0, t0 + t + 0.42);
  }
  o.start(t0);
  o.stop(t0 + secs + 0.1);
  return () => {
    try {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      o.stop(ctx.currentTime + 0.1);
    } catch {
      // already stopped
    }
  };
}

/** rain: filtered noise, fading in */
function rainSound(ctx: AudioContext): () => void {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2800;
  bp.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(0.06, ctx.currentTime, 2.5);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start();
  return () => {
    g.gain.setTargetAtTime(0, ctx.currentTime, 1.5);
    src.stop(ctx.currentTime + 6);
  };
}
