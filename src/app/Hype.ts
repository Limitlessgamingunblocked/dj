/*
 * Crowd hype: how the room is feeling, 0..1. It follows the music's energy,
 * rewards clean blends (beat-locked, in key) and drops, and punishes
 * trainwrecks and key clashes — with short call-outs on the stage. The light
 * show and the dancers read it (hands up, jumping).
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { Deck } from '../audio/Deck';
import { compatibility } from '../analysis/keys';
import type { Features } from '../visualizer/AudioFeatures';

export interface Callout {
  text: string;
  tone: 'good' | 'bad' | 'hype';
}

export class Hype {
  value = 0.35;
  private blend = 0;
  private blendRewarded = false;
  private wreck = 0;
  private clash = 0;
  private last = new Map<string, number>();
  private t = 0;
  private wasHigh = false;
  private listeners: ((c: Callout) => void)[] = [];

  constructor(private engine: AudioEngine) {}

  onCallout(fn: (c: Callout) => void): void {
    this.listeners.push(fn);
  }

  private say(key: string, c: Callout, gap: number): void {
    const prev = this.last.get(key) ?? -1e9;
    if (this.t - prev < gap) return;
    this.last.set(key, this.t);
    for (const l of this.listeners) l(c);
  }

  /** decks the room can hear right now */
  private audible(): Deck[] {
    return this.engine.decks.filter((d) => {
      if (!d.playing || !d.loaded) return false;
      const ch = this.engine.channels[d.id - 1];
      return !!ch && ch.state.fader > 0.08 && ch.xfGain > 0.08;
    });
  }

  update(dt: number, f: Features): number {
    this.t += dt;
    const live = this.audible();
    let v = this.value;
    if (!live.length) {
      v += (0.12 - v) * Math.min(1, dt * 0.06);
      this.blend = 0;
      this.blendRewarded = false;
    } else {
      const target = 0.3 + f.energy * 0.45;
      v += (target - v) * Math.min(1, dt * 0.035);
    }
    if (live.length >= 2) {
      const [a, b] = live
        .map((d) => ({ d, g: this.engine.channels[d.id - 1].state.fader * this.engine.channels[d.id - 1].xfGain }))
        .sort((x, y) => y.g - x.g)
        .map((x) => x.d);
      if (a.analysis && b.analysis) {
        let ratio = a.bpm / Math.max(1, b.bpm);
        if (ratio > 1.5) ratio /= 2;
        else if (ratio < 0.75) ratio *= 2;
        const bpmErr = Math.abs(ratio - 1);
        const pa = a.beatPosition(a.displayPosition());
        const pb = b.beatPosition(b.displayPosition());
        const e = Math.abs(((((pa - pb) % 1) + 1.5) % 1) - 0.5);
        if (bpmErr < 0.004 && e < 0.07) {
          this.blend += dt;
          this.wreck = Math.max(0, this.wreck - dt * 2);
          v += dt * 0.012;
          if (this.blend > 8 && !this.blendRewarded) {
            this.blendRewarded = true;
            v += 0.08;
            this.say('blend', { text: 'Smooth blend — beats locked', tone: 'good' }, 20);
          }
        } else if (e > 0.14 || bpmErr > 0.012) {
          this.wreck += dt;
          this.blend = 0;
          if (this.wreck > 1.2) {
            v -= dt * 0.05;
            this.say('wreck', { text: bpmErr > 0.012 ? 'Tempos don’t match — hit SYNC or ride the pitch' : 'Trainwreck — the beats are drifting', tone: 'bad' }, 12);
          }
        }
        const ka = a.currentKey();
        const kb = b.currentKey();
        if (ka && kb && compatibility(ka, kb) === null) {
          this.clash += dt;
          if (this.clash > 4) {
            v -= dt * 0.03;
            this.say('clash', { text: `Key clash: ${ka.camelot} over ${kb.camelot}`, tone: 'bad' }, 25);
          }
        } else this.clash = 0;
      }
    } else {
      this.wreck = 0;
      this.clash = 0;
    }
    if (f.dropHit && live.length) {
      v += 0.22;
      this.say('drop', { text: '🔥 The drop lands', tone: 'hype' }, 8);
    }
    v = Math.min(1, Math.max(0.05, v));
    if (v > 0.85 && !this.wasHigh) this.say('high', { text: 'The crowd is going off', tone: 'hype' }, 40);
    this.wasHigh = v > 0.8;
    this.value = v;
    return v;
  }
}
