/*
 * What a board you built can do to the game (Section 13.6), wired to the
 * real systems: add-on sounds into the mix (so they're recorded), the crowd
 * and hype boosts, the Big Red Drop, show cues, laser aim, camera switching,
 * tape stops and rewinds on the decks.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { BeatClock } from '../core/BeatClock';
import type { BoardHooks, ShowCue } from '../board/hooks';
import { AddonSounds } from '../board/sounds';
import type { ViewId } from '../three/CameraRig';
import type { Stage } from '../three/Stage';
import { laserAim } from '../three/venues/lasers';
import type { LaserPattern } from '../three/venues/laserlooks';
import type { PaletteId } from '../three/venues/show';
import { toast } from '../ui/toast';

export interface BoardHookHost {
  engine: AudioEngine;
  stage: Stage;
  clock: BeatClock;
  /** the kick envelope this frame, 0..1 */
  kick(): number;
  /** the vibe meter, 0..1 */
  vibe(): number;
  /** the whole game sees a drop now, as if the track dropped */
  fireDrop(): void;
  /** switch the camera angle */
  camera(v: ViewId): void;
  venue(): string;
}

const PATTERNS: LaserPattern[] = ['fan', 'tunnel', 'sheet', 'liquid', 'wave', 'cross', 'rotate', 'chase', 'stars'];
const COLOURS: PaletteId[] = ['venue', 'rainbow', 'red', 'amber', 'ice', 'uv', 'white'];
const VIEWS = new Set(['perf', 'wide', 'crowd', 'booth', 'fisheye', 'crane', 'drone', 'camcorder', 'top', 'rig', 'cctv', 'vertigo']);
const OUTDOOR = new Set(['dc10', 'beach', 'festival', 'sunrise', 'rooftop', 'boat']);

/** the board's boost to the crowd and the show, decaying back when nothing holds it up */
export class BoardBoost {
  crowd = 0;
  hype = 0;
  private dropAt = -1e9;

  /** call each frame; returns the extra hype the stage should show */
  update(dt: number, now: number): number {
    // a fader held up stays up (parts set it every frame they move); a released one eases back
    this.crowd = Math.max(0, this.crowd - dt * 0.05);
    this.hype = Math.max(0, this.hype - dt * 0.05);
    void now;
    return Math.max(this.crowd, this.hype);
  }

  dropped(now: number): void {
    this.dropAt = now;
  }

  dropPulse(now: number): number {
    return Math.max(0, 1 - (now - this.dropAt) / 1.5);
  }
}

export function makeBoardHooks(h: BoardHookHost, boost: BoardBoost): BoardHooks {
  let sounds: AddonSounds | null = null;
  let patternI = 0;
  let colorI = 0;
  const show = () => h.stage.show;
  const now = () => performance.now() / 1000;
  const hold = (key: 'strobeHold' | 'blinderHold' | 'blackoutHold' | 'laserHold', on: boolean | undefined, ms: number) => {
    const c = show().controls;
    if (on === undefined) {
      c[key] = true;
      setTimeout(() => (c[key] = false), ms);
    } else c[key] = on;
  };

  return {
    audio: () => h.engine.ctx,
    // into the master bus with the sampler: through the master, the limiter and every recording
    sounds: () => (sounds ??= new AddonSounds(h.engine.ctx, h.engine.mixer.masterBus)),
    crowdFeed: () => h.stage.venue?.feed?.target.texture ?? null,
    kick: () => h.kick(),
    vibe: () => h.vibe(),
    beat: () => {
      const c = h.clock;
      return { period: c.beatLength, phase: c.phase, bar: c.beatInBar + c.phase, next: (1 - c.phase) * c.beatLength };
    },
    clock: () => ({ bars: h.clock.bar, section: h.clock.section }),
    key: () => {
      const k = h.engine.masterDeck?.currentKey();
      return k ? { root: 60 + k.root, minor: k.minor } : null;
    },
    masterDeck: () => h.engine.masterDeck?.id ?? 1,
    crowd: (v) => (boost.crowd = Math.max(0, Math.min(1, v))),
    hype: (v) => {
      const was = boost.hype;
      boost.hype = Math.max(0, Math.min(1, v));
      // crossing the top of the dial lands a hit on the lights
      if (was < 0.9 && boost.hype >= 0.9) show().accent(1);
    },
    drop: () => {
      // the Big Red Drop: lights out and a beat of silence, then everything at once
      const ctx = h.engine.ctx;
      const g = h.engine.mixer.masterSum.gain;
      const gap = Math.min(1.2, h.clock.beatLength * 2);
      const t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(0.0001, t, 0.015);
      g.setTargetAtTime(1, t + gap, 0.004);
      show().controls.blackoutHold = true;
      setTimeout(() => {
        const s = show();
        s.controls.blackoutHold = false;
        h.fireDrop();
        boost.dropped(now());
        s.fireConfetti();
        s.fireCo2();
        if (s.controls.pyro) s.firePyro();
        hold('strobeHold', undefined, 900);
      }, gap * 1000);
    },
    show: (cue: ShowCue, on?: boolean) => {
      const s = show();
      switch (cue) {
        case 'strobe':
          return hold('strobeHold', on, 600);
        case 'blinder':
          return hold('blinderHold', on, 500);
        case 'blackout':
          return hold('blackoutHold', on, 800);
        case 'lasers':
          return hold('laserHold', on, 2000);
        case 'laserColor':
          colorI = (Math.max(0, COLOURS.indexOf(s.controls.palette)) + 1) % COLOURS.length;
          s.controls.palette = COLOURS[colorI];
          return;
        case 'laserPattern':
          patternI = (patternI + 1) % PATTERNS.length;
          s.controls.laserPattern = PATTERNS[patternI];
          return;
        case 'laserName':
        case 'flashName':
          // the name on the walls and screens comes up on the next drop-sized moment
          s.accent(1);
          return;
        case 'co2':
          return s.fireCo2();
        case 'pyro':
          if (!s.controls.pyro) return toast('Pyro is off in the lights settings.');
          return s.firePyro();
        case 'confetti':
        case 'streamers':
          return s.fireConfetti();
        case 'sparklers':
          return s.firePyro();
        case 'fog':
        case 'hazeUp':
          s.controls.smoke = Math.min(1, s.controls.smoke + 0.25);
          setTimeout(() => (s.controls.smoke = Math.max(0, s.controls.smoke - 0.25)), 12000);
          return;
        case 'nextVisual':
          return h.stage.visualizer.nextMode();
      }
    },
    laserAim: (x, y) => {
      laserAim.x = Math.max(-1, Math.min(1, x));
      laserAim.y = Math.max(-1, Math.min(1, y));
    },
    camera: (v) => {
      if (VIEWS.has(v)) h.camera(v as ViewId);
    },
    weather: () => OUTDOOR.has(h.venue()),
    tapeStop: (deck) => h.engine.deck(deck)?.tapeStop(),
    rewind: (deck) => h.engine.deck(deck)?.rewind(),
    dropPulse: () => boost.dropPulse(now()),
    toast: (text) => toast(text),
  };
}
