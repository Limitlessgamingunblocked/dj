/*
 * Venue acoustics (Section 15): a reverb and EQ profile per room, on what
 * you hear through the speakers only. The recording taps the master before
 * this, so a set records clean (Stage 4 adds "record room sound").
 *   bedroom   small and boxy: desk monitors, a touch of low end
 *   basement  tight, dry, punchy (Section 5.2)
 *   rooftop   open, light reverb
 *   warehouse big, echoing, heavy low end
 *   beach     open air, soft and warm
 *   boat      open air over the water
 *   festival  huge open air, the delay towers' slap
 *   sunrise   open, warm
 * Every other room gets a moderate club profile.
 */

export interface RoomProfile {
  /** reverb level, 0..1 */
  wet: number;
  /** reverb tail, seconds */
  decay: number;
  /** shelf EQ in dB: low (120 Hz), high (6 kHz) */
  low: number;
  high: number;
  /** a distinct echo this many seconds late (delay towers out in the field) */
  slap?: number;
}

export const ROOMS: Record<string, RoomProfile> = {
  bedroom: { wet: 0.05, decay: 0.3, low: 1.5, high: -1.5 },
  basement: { wet: 0.06, decay: 0.38, low: 2.5, high: -0.5 },
  rooftop: { wet: 0.07, decay: 0.8, low: 0.5, high: 0 },
  warehouse: { wet: 0.22, decay: 2.4, low: 3, high: -1.5 },
  deckhouse: { wet: 0.18, decay: 1.9, low: 2.5, high: -1 },
  beach: { wet: 0.05, decay: 0.7, low: 1, high: 0.5 },
  boat: { wet: 0.06, decay: 0.8, low: 1.5, high: 0 },
  festival: { wet: 0.14, decay: 1.6, low: 1.5, high: -1.5, slap: 0.16 },
  sunrise: { wet: 0.08, decay: 1.1, low: 1, high: 0.5 },
  printworks: { wet: 0.2, decay: 2.2, low: 2.5, high: -1 },
  berghain: { wet: 0.18, decay: 2, low: 3, high: -1 },
  allypally: { wet: 0.24, decay: 2.8, low: 2, high: -2 },
  'allypally-round': { wet: 0.24, decay: 2.8, low: 2, high: -2 },
  boilerroom: { wet: 0.04, decay: 0.6, low: 1, high: 0 },
  dc10: { wet: 0.1, decay: 1, low: 2, high: -0.5 },
};
const CLUB: RoomProfile = { wet: 0.1, decay: 1.2, low: 1.5, high: -0.5 };
/** the dressing room and the naming room: no room colour */
const NONE: RoomProfile = { wet: 0, decay: 0.3, low: 0, high: 0 };

export function roomFor(venue: string): RoomProfile {
  if (venue === 'dressing' || venue === 'naming') return NONE;
  return ROOMS[venue] ?? CLUB;
}

/** a decaying noise burst: a cheap, smooth room tail */
function impulse(ctx: BaseAudioContext, decay: number, slap = 0): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * Math.min(4, decay * 1.4)));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 1234 + c * 999;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      const t = i / ctx.sampleRate;
      // a few early reflections, then a smooth tail
      const early = t < 0.03 ? 1.6 : 1;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.exp(-t * (6.9 / decay)) * early;
    }
    // the slap: a short burst of reflection, late
    if (slap > 0) {
      const at = Math.floor(slap * ctx.sampleRate);
      for (let i = 0; i < Math.floor(ctx.sampleRate * 0.012) && at + i < len; i++) {
        seed = (seed * 16807) % 2147483647;
        d[at + i] += ((seed / 2147483647) * 2 - 1) * 1.4 * Math.exp(-i / (ctx.sampleRate * 0.004));
      }
    }
  }
  return buf;
}

export class Room {
  readonly input: GainNode;
  private lowShelf: BiquadFilterNode;
  private highShelf: BiquadFilterNode;
  private dry: GainNode;
  private wet: GainNode;
  private verb: ConvolverNode;
  private decay = -1;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
  ) {
    const c = ctx;
    this.input = c.createGain();
    this.lowShelf = c.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 120;
    this.highShelf = c.createBiquadFilter();
    this.highShelf.type = 'highshelf';
    this.highShelf.frequency.value = 6000;
    this.dry = c.createGain();
    this.wet = c.createGain();
    this.wet.gain.value = 0;
    this.verb = c.createConvolver();
    this.input.connect(this.lowShelf).connect(this.highShelf);
    this.highShelf.connect(this.dry).connect(out);
    this.highShelf.connect(this.verb).connect(this.wet).connect(out);
  }

  private profile: RoomProfile = NONE;
  private echoUntil = 0;

  /**
   * A big echo for a few seconds (the boat passing under a bridge), then the
   * room comes back as it was.
   */
  echo(secs: number): void {
    const p = this.profile;
    const now = this.ctx.currentTime;
    this.apply({ wet: Math.max(p.wet, 0.34), decay: Math.max(p.decay, 2.2), low: p.low + 1, high: p.high - 1 });
    this.echoUntil = now + secs;
    setTimeout(() => {
      if (this.ctx.currentTime >= this.echoUntil - 0.05) this.apply(this.profile);
    }, secs * 1000);
  }

  set(p: RoomProfile): void {
    this.profile = p;
    this.apply(p);
  }

  private apply(p: RoomProfile): void {
    const now = this.ctx.currentTime;
    const key = p.decay + (p.slap ?? 0) * 1000;
    if (Math.abs(key - this.decay) > 0.05) {
      this.verb.buffer = impulse(this.ctx, p.decay, p.slap ?? 0);
      this.decay = key;
    }
    this.wet.gain.setTargetAtTime(p.wet, now, 0.3);
    // the dry signal dips a touch as the room gets wetter, so the level stays put
    this.dry.gain.setTargetAtTime(1 - p.wet * 0.35, now, 0.3);
    this.lowShelf.gain.setTargetAtTime(p.low, now, 0.3);
    this.highShelf.gain.setTargetAtTime(p.high, now, 0.3);
  }
}
