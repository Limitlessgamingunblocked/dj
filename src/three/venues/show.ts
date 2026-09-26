/*
 * Light show director. Turns the music (beat grid, energy, breakdowns and
 * drops) plus the lighting desk (manual hits and settings) into one ShowState
 * per frame that every venue's fixtures read:
 *   – moving-head patterns change every 8 bars and on drops
 *   – lasers come in with energy, sheet over the crowd in breakdowns and go
 *     wide at the peak
 *   – build-ups get a strobe roll on the last bar; drops fire CO2, blinders
 *     and a bar of strobes
 */
import * as THREE from 'three';
import type { Features } from '../../visualizer/AudioFeatures';

export type PaletteId = 'venue' | 'rainbow' | 'red' | 'amber' | 'ice' | 'uv' | 'white';
export const PALETTES: { id: PaletteId; name: string; colors: [string, string, string] | null }[] = [
  { id: 'venue', name: 'Venue', colors: null },
  { id: 'rainbow', name: 'Rainbow', colors: null },
  { id: 'red', name: 'Red', colors: ['#ff1a1a', '#ff5a1f', '#ff2a6a'] },
  { id: 'amber', name: 'Amber', colors: ['#ffb000', '#ff7a1a', '#fff1d6'] },
  { id: 'ice', name: 'Ice', colors: ['#27e1ff', '#ffffff', '#3a6bff'] },
  { id: 'uv', name: 'UV', colors: ['#7b2bff', '#ff2bd6', '#3a4bff'] },
  { id: 'white', name: 'White', colors: ['#ffffff', '#dfe8ff', '#fff0da'] },
];

export const LASER_PATTERNS = ['fan', 'tunnel', 'sheet', 'chase', 'cross'] as const;
export type LaserPattern = (typeof LASER_PATTERNS)[number];
export const LASER_PATTERN_NAMES: Record<LaserPattern, string> = { fan: 'Fan', tunnel: 'Tunnel', sheet: 'Sheet', chase: 'Chase', cross: 'Crossfire' };

export interface ShowControls {
  /** lights follow the music (otherwise a calm static look plus manual hits) */
  auto: boolean;
  /** overall brightness / how hard the show hits, 0..1.5 */
  intensity: number;
  palette: PaletteId;
  lasers: 'auto' | 'on' | 'off';
  laserPattern: LaserPattern | 'auto';
  /** strobes, blinders and CO2 fire automatically on drops */
  dropFx: boolean;
  /** base haze level 0..1 */
  smoke: number;
  strobeHold: boolean;
  blinderHold: boolean;
  blackoutHold: boolean;
  laserHold: boolean;
}

export interface ShowState {
  t: number;
  /** continuous beat position */
  beat: number;
  beatPhase: number;
  beatInBar: number;
  bar: number;
  bpm: number;
  kick: number;
  snare: number;
  high: number;
  level: number;
  energy: number;
  playing: boolean;
  drop: number;
  dropHit: boolean;
  /** 0..1 envelope of the peak section after a drop */
  peak: number;
  /** 0..1 breakdown / build-up depth */
  build: number;
  colors: [THREE.Color, THREE.Color, THREE.Color];
  /** 0 during blackout */
  master: number;
  movers: number;
  moverPattern: number;
  wash: number;
  lasers: number;
  laserPattern: LaserPattern;
  strobe: number;
  blinder: number;
  /** CO2 cannons fire this frame */
  co2: boolean;
  smoke: number;
  /** crowd energy 0..1 */
  hype: number;
  /** the venue's own palette is active (fixtures may use their house colours) */
  venueLook: boolean;
  /** overall white flash for the room this frame */
  flash: number;
  intensity: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export class LightShow {
  readonly controls: ShowControls = {
    auto: true,
    intensity: 1,
    palette: 'venue',
    lasers: 'auto',
    laserPattern: 'auto',
    dropFx: true,
    smoke: 0.5,
    strobeHold: false,
    blinderHold: false,
    blackoutHold: false,
    laserHold: false,
  };
  readonly state: ShowState;
  private venuePalette: THREE.Color[] = [new THREE.Color('#2ec4f1'), new THREE.Color('#ff5fcf'), new THREE.Color('#7b5cff')];
  private co2Queued = false;
  private peakBars = 0;
  private lastBar = -1;
  private laserLevel = 0;
  private blinderLevel = 0;
  private masterLevel = 1;
  private lastCo2 = -10;
  private tmp = new THREE.Color();

  constructor() {
    this.state = {
      t: 0,
      beat: 0,
      beatPhase: 0,
      beatInBar: 0,
      bar: 0,
      bpm: 120,
      kick: 0,
      snare: 0,
      high: 0,
      level: 0,
      energy: 0,
      playing: false,
      drop: 0,
      dropHit: false,
      peak: 0,
      build: 0,
      colors: [new THREE.Color(), new THREE.Color(), new THREE.Color()],
      master: 1,
      movers: 0.5,
      moverPattern: 0,
      wash: 0.5,
      lasers: 0,
      laserPattern: 'fan',
      strobe: 0,
      blinder: 0,
      co2: false,
      smoke: 0.5,
      hype: 0.3,
      venueLook: true,
      flash: 0,
      intensity: 1,
    };
  }

  setVenuePalette(colors: string[]): void {
    this.venuePalette = colors.map((c) => new THREE.Color(c));
  }

  /** manual CO2 hit from the lighting desk */
  fireCo2(): void {
    this.co2Queued = true;
  }

  update(f: Features, dt: number, hype: number): ShowState {
    const s = this.state;
    const c = this.controls;
    s.t += dt;
    s.intensity = c.intensity;
    s.bpm = f.bpm;
    s.beatPhase = f.beatPhase;
    s.beatInBar = f.beatInBar;
    s.beat = f.beatCount + f.beatPhase;
    s.bar = Math.floor(f.beatCount / 4);
    s.playing = f.playing;
    const react = c.auto && f.playing;
    s.kick = react ? f.kickPulse : 0;
    s.snare = react ? f.snarePulse : 0;
    s.high = react ? f.high : 0.2;
    s.level = f.level;
    s.energy = f.energy;
    s.drop = react ? f.drop : 0;
    s.dropHit = react && f.dropHit;
    s.build = react ? f.breakdown : 0;
    s.hype = hype;

    // peak section: 16 bars after a drop
    if (s.dropHit) this.peakBars = 16;
    if (s.bar !== this.lastBar) {
      if (this.lastBar >= 0 && this.peakBars > 0) this.peakBars--;
      this.lastBar = s.bar;
    }
    const peakTarget = this.peakBars > 0 ? Math.min(1, this.peakBars / 4) : 0;
    s.peak += (peakTarget - s.peak) * Math.min(1, dt * (peakTarget > s.peak ? 12 : 0.6));

    // colours
    this.palette(f, s);
    s.venueLook = c.palette === 'venue';

    // moving heads
    if (!react) s.moverPattern = 0;
    else if (s.peak > 0.5) s.moverPattern = 4 + (Math.floor(s.bar / 2) % 2);
    else if (s.build > 0.4) s.moverPattern = 5;
    else s.moverPattern = Math.floor(hash(Math.floor(s.bar / 8)) * 4);
    const moverTarget = react ? (0.4 + s.energy * 0.45 + s.peak * 0.3) * (1 - s.build * 0.45) : 0.45;
    s.movers += (moverTarget - s.movers) * Math.min(1, dt * 3);
    s.wash = react ? 0.35 + s.energy * 0.4 + s.kick * 0.35 * (0.5 + s.peak) : 0.4;

    // lasers
    let laserTarget = 0;
    if (c.lasers === 'on') laserTarget = 1;
    else if (c.lasers === 'auto' && react) laserTarget = Math.max(s.peak, s.build > 0.35 ? 0.7 : 0, s.energy > 0.62 ? 0.85 : 0);
    if (c.laserHold) laserTarget = 1;
    this.laserLevel += (laserTarget - this.laserLevel) * Math.min(1, dt * (laserTarget > this.laserLevel ? 10 : 2.5));
    s.lasers = this.laserLevel;
    if (c.laserPattern !== 'auto') s.laserPattern = c.laserPattern;
    else if (s.build > 0.35) s.laserPattern = 'sheet';
    else if (s.peak > 0.5) s.laserPattern = (['fan', 'cross', 'tunnel', 'fan'] as const)[Math.floor(s.bar / 2) % 4];
    else s.laserPattern = (['fan', 'sheet', 'tunnel', 'chase', 'cross'] as const)[Math.floor(hash(Math.floor(s.bar / 8) + 17) * 5)];

    // strobes: manual hold (1/16), drop bar (1/8), build-up roll on the last bar
    const sixteenth = (s.beat * 4) % 1;
    const eighth = (s.beat * 2) % 1;
    let strobe = 0;
    if (c.strobeHold) strobe = sixteenth < 0.35 ? 1 : 0;
    else if (react && c.dropFx) {
      if (this.peakBars >= 15 && s.peak > 0.2) strobe = eighth < 0.3 ? 1 : 0;
      else if (s.build > 0.9 && s.beatInBar >= 2) strobe = sixteenth < 0.3 ? 0.7 : 0;
    }
    s.strobe = strobe * Math.min(1.2, c.intensity);

    // blinders: hold, drop hit, downbeats at the peak
    if (c.blinderHold) this.blinderLevel = 1;
    else {
      if (s.dropHit && c.dropFx) this.blinderLevel = 1;
      if (react && s.peak > 0.6 && f.beatPulse > 0.95 && s.beatInBar === 0) this.blinderLevel = Math.max(this.blinderLevel, 0.6);
      this.blinderLevel *= Math.exp(-dt * 3.2);
    }
    s.blinder = this.blinderLevel * Math.min(1.2, c.intensity);

    // CO2: manual or on the drop (not more than every 4 s)
    s.co2 = false;
    if ((this.co2Queued || (s.dropHit && c.dropFx)) && s.t - this.lastCo2 > 1.2) {
      s.co2 = true;
      this.lastCo2 = s.t;
    }
    this.co2Queued = false;

    s.smoke = Math.min(1, c.smoke + s.build * 0.25 + s.peak * 0.1);

    // blackout
    const mTarget = c.blackoutHold ? 0 : 1;
    this.masterLevel += (mTarget - this.masterLevel) * Math.min(1, dt * 25);
    s.master = this.masterLevel;
    s.flash = Math.max(s.strobe, s.blinder * 0.6) * s.master;
    return s;
  }

  private palette(f: Features, s: ShowState): void {
    const c = this.controls;
    const shift = s.peak > 0.5 ? Math.floor(s.beat / 2) : Math.floor(s.bar / 8);
    if (c.palette === 'rainbow') {
      for (let i = 0; i < 3; i++) s.colors[i].setHSL((f.hue + i * 0.33 + (s.peak > 0.5 ? (Math.floor(s.beat) % 4) * 0.25 : 0)) % 1, 1, 0.5);
      return;
    }
    const src = c.palette === 'venue' ? this.venuePalette : PALETTES.find((p) => p.id === c.palette)!.colors!.map((x) => this.tmp.clone().set(x));
    for (let i = 0; i < 3; i++) s.colors[i].copy(src[(i + shift) % src.length]);
  }
}
