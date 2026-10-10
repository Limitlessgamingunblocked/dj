/*
 * The air horn (the pad in Show → Party, or Shift+J): played into the mix
 * like a sampler pad, so it's in your recordings, and as often as you like.
 * The room says "whoa" now and then.
 */
import type { AudioEngine } from '../audio/AudioEngine';

export interface PartyHost {
  engine: AudioEngine;
  vibe(): number;
  bpm(): number;
}

export class Party {
  constructor(private host: PartyHost) {}

  airhorn(): void {
    if (!this.host.engine.sampler.playExtra('horn', 0.7)) return;
    if (Math.random() < 0.35) this.host.engine.crowd.play('whoa', this.host.vibe(), this.host.bpm() || 124);
  }
}
