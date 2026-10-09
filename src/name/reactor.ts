/*
 * How the DJ name moves with the music (Section 3.4), as numbers every name
 * surface's shader reads (one shared set, so a hundred surfaces cost nothing):
 *   kick       the name pulses brighter on every kick
 *   build      letters chase on one by one, faster as the build tightens
 *   drop       a burst of strobe, then a glitch-shatter that reassembles
 *   breakdown  a slow breathing fade
 *   screen     how much of the name LED walls show (on drops, builds, and
 *              every 32 bars for a phrase)
 * With reduce flashing the drop's strobe slows under 3 a second and softens.
 */
import type { Section } from '../core/BeatClock';

export interface ReactorInput {
  playing: boolean;
  section: Section;
  /** continuous beat position */
  beat: number;
  bar: number;
  /** 0..1 kick envelope */
  kick: number;
  /** 0..1 how deep the breakdown / build is */
  depth: number;
  /** the drop lands this frame */
  dropHit: boolean;
  reduceFlash: boolean;
}

export interface NameFx {
  kick: number;
  /** 1 = every letter lit; below 1, letters past chase × count are dark */
  chase: number;
  glitch: number;
  flash: number;
  breath: number;
  screen: number;
}

export class NameReactor {
  readonly fx: NameFx = { kick: 0, chase: 1, glitch: 0, flash: 0, breath: 0, screen: 0 };
  private sinceDrop = 1e9;
  private t = 0;

  update(i: ReactorInput, dt: number): NameFx {
    const fx = this.fx;
    this.t += dt;
    if (i.dropHit) this.sinceDrop = 0;
    else this.sinceDrop += dt;
    const k = 1 - Math.exp(-dt * 3);
    fx.kick = i.playing ? Math.max(0, Math.min(1, i.kick)) : 0;

    // build: one letter at a time, a bar per pass at first, half a beat at the very top
    if (i.playing && i.section === 'build') {
      const tight = Math.max(0, Math.min(1, (i.depth - 0.85) / 0.15));
      const period = 4 - 3.5 * tight;
      fx.chase = ((i.beat / period) % 1 + 1) % 1;
    } else fx.chase = 1;

    // drop: strobe for half a second, glitch from 0.15 s, back together by 1.6 s
    const d = this.sinceDrop;
    if (d < 0.6) {
      const rate = i.reduceFlash ? 2.5 : 10;
      const on = (d * rate) % 1 < (i.reduceFlash ? 0.3 : 0.5);
      fx.flash = on ? (i.reduceFlash ? 0.35 : 1) : 0;
    } else fx.flash = 0;
    fx.glitch = d > 0.15 && d < 1.6 ? Math.sin(((d - 0.15) / 1.45) * Math.PI) ** 0.7 : 0;

    // breakdown: breathe
    fx.breath += ((i.playing && i.section === 'breakdown' ? 1 : 0) - fx.breath) * k;

    // LED walls: the name for the drop's first 8 bars, through builds, and a phrase every 32 bars
    const phrase = ((i.bar % 32) + 32) % 32 < 4;
    const want = !i.playing ? 0 : d < (60 / 124) * 32 || i.section === 'build' ? 1 : phrase ? 0.8 : 0;
    fx.screen += (want - fx.screen) * (1 - Math.exp(-dt * (want > fx.screen ? 8 : 1.5)));
    return fx;
  }
}
