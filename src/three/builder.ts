/*
 * Board building blocks: chassis units with printed faceplates, and section
 * helpers (performance pads, transport, loop rows, channel strips, beat FX,
 * master section) shared by the board presets.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Faceplate, type FaceStyle } from './Faceplate';
import { roundedRectPlane } from './materials';
import { layCables, rearLayout, unitHardware, type CableJob, type Jack, type RearKind } from './rear';
import { hashString } from './venues/tex';
import {
  ButtonPart,
  FaderPart,
  IndicatorPart,
  JogPart,
  KnobPart,
  PadPart,
  ScreenPart,
  SwitchPart,
  VuPart,
  type ButtonShape,
  type DeckRef,
  type JogStyle,
  type KnobStyle,
  type Part,
  type PartCtx,
} from './parts';

export interface Finish {
  id: string;
  name: string;
  swatch: string;
  body: string;
  bodyMetal: number;
  bodyRough: number;
  face: FaceStyle;
  knobCap: string | null;
  accent: string; // LED / jog ring colour
  cueColor: string;
  playColor: string;
}

export class BoardBuild {
  readonly root = new THREE.Group();
  readonly parts: Part[] = [];
  readonly units: Unit[] = [];
  /** the cables and plugs behind the units (left out of the board's framing) */
  cables: THREE.Group | null = null;
  /**
   * When something stands on the desk right behind the mixer (a laptop stand's
   * legs), cables between the units keep to a lane in front of it: this z.
   */
  cableLane: number | undefined;

  constructor(readonly finish: Finish) {}

  unit(x: number, z: number, w: number, d: number, h: number, opts: { radius?: number; finish?: Finish; name?: string } = {}): Unit {
    const u = new Unit(this, x, z, w, d, h, opts.finish ?? this.finish, opts.radius ?? 0.008);
    this.units.push(u);
    this.root.add(u.group);
    return u;
  }

  register(p: Part): void {
    this.parts.push(p);
  }

  finishAll(): void {
    for (const u of this.units) u.finalize();
    this.cables = this.patch();
    this.root.add(this.cables);
  }

  /**
   * Wire the rig as a booth is wired: each deck's line out into the mixer
   * input pair on its side (outer decks to the outer pairs), the turntables'
   * ground wires to the mixer's ground post, and the power, master and USB
   * cables off the desk through a grommet behind each unit.
   */
  private patch(): THREE.Group {
    const jobs: CableJob[] = [];
    const grommets: THREE.Vector2[] = [];
    const at = (u: Unit, j: Jack) => new THREE.Vector3(u.group.position.x + j.x, u.group.position.y + j.y, u.group.position.z - u.d / 2 - 0.0004);
    const mixer = this.units.find((u) => u.jacks.some((j) => j.input));
    if (mixer) {
      const pairs = [...new Set(mixer.jacks.filter((j) => j.input).map((j) => j.input!.pair))];
      const decks = this.units.filter((u) => u !== mixer && u.jacks.some((j) => j.out)).sort((p, q) => p.group.position.x - q.group.position.x);
      const mixGnd = mixer.jacks.find((j) => j.kind === 'gnd');
      decks.forEach((u, i) => {
        const pair = pairs[decks.length === 1 ? 0 : Math.round((i * (pairs.length - 1)) / (decks.length - 1))];
        for (const j of u.jacks) {
          if (!j.out) continue;
          const target = j.kind === 'gnd' ? mixGnd : mixer.jacks.find((m) => m.input && m.input.pair === pair && m.input.side === j.out);
          if (target) jobs.push({ from: { jack: j, at: at(u, j) }, to: { jack: target, at: at(mixer, target) }, lane: this.cableLane });
        }
      });
    }
    for (const u of this.units) {
      const floor = u.jacks.filter((j) => j.floor);
      if (!floor.length) continue;
      const x = u.group.position.x + floor.reduce((s, j) => s + j.x, 0) / floor.length;
      const g = new THREE.Vector2(x, Math.max(-0.37, u.group.position.z - u.d / 2 - 0.115));
      grommets.push(g);
      for (const j of floor) jobs.push({ from: { jack: j, at: at(u, j) }, to: new THREE.Vector3(g.x, 0, g.y) });
    }
    return layCables(jobs, grommets, hashString(this.finish.id) + this.units.length);
  }
}

export class Unit {
  readonly group = new THREE.Group();
  readonly face: Faceplate;
  /** the connectors on the rear panel */
  jacks: Jack[] = [];
  private topScrews = false;
  private model = 'DJ EQUIPMENT';

  constructor(
    private board: BoardBuild,
    x: number,
    z: number,
    readonly w: number,
    readonly d: number,
    readonly h: number,
    readonly finish: Finish,
    private radius: number,
  ) {
    this.group.position.set(x, 0, z);
    this.face = new Faceplate(w, d, finish.face);
  }

  /** fit the rear panel's connectors for this kind of unit (cables are plugged into them when the board is finished) */
  rearPanel(kind: RearKind, o: { channels?: number; model?: string } = {}): void {
    this.jacks = rearLayout(kind, this.w, this.h, o.channels ?? 2);
    this.topScrews = kind !== 'turntable';
    this.model = o.model ?? { turntable: 'DIRECT DRIVE TURNTABLE', player: 'MULTI PLAYER', mixer: 'DJ MIXER', controller: 'DJ CONTROLLER', starter: 'DJ CONTROLLER' }[kind];
  }

  add<T extends Part>(p: T, x: number, z: number, y = 0): T {
    p.object.position.set(x, this.h + y, z);
    this.group.add(p.object);
    this.board.register(p);
    return p;
  }

  knob(id: string, x: number, z: number, o: { label: string; print?: string; r?: number; h?: number; style?: KnobStyle; cap?: string | null; center?: boolean; encoder?: boolean; ring?: string | null; printAbove?: boolean } = { label: '' }): KnobPart {
    const r = o.r ?? 0.0085;
    const k = this.add(new KnobPart(id, o.label, r, o.h ?? 0.014, o.style ?? 'rubber', o.cap === undefined ? this.finish.knobCap : o.cap, o.encoder ?? false, o.ring ?? null), x, z);
    if (!o.encoder && !o.ring) this.face.knobScale(x, z, r * 1.1, { center: o.center });
    if (o.print) this.face.text(x, o.printAbove === false ? z + r + 0.0052 : z - r - 0.0052, o.print, { size: 0.0027 });
    return k;
  }

  fader(id: string, x: number, z: number, axis: 'x' | 'z', len: number, o: { label: string; maxAtFar?: boolean; size?: 'channel' | 'cross' | 'tempo' | 'mini'; cap?: string | null; labels?: [string, string]; center?: boolean; ticks?: number }): FaderPart {
    this.face.slot(x, z, len, axis, { ticks: o.ticks ?? 10, center: o.center, labels: o.labels });
    return this.add(new FaderPart(id, o.label, axis, len, o.maxAtFar ?? true, o.cap ?? null, o.size ?? 'channel'), x, z);
  }

  button(id: string, x: number, z: number, o: { label: string; shape?: ButtonShape; w?: number; d?: number; led?: string; print?: string; printAt?: 'above' | 'below' | 'left' | 'right' | 'on'; symbol?: string; alt?: string | null; base?: string; h?: number }): ButtonPart {
    const shape = o.shape ?? 'rect';
    const w = o.w ?? (shape === 'big' ? 0.026 : 0.011);
    const d = o.d ?? (shape === 'round' || shape === 'big' ? w : 0.0065);
    const b = this.add(new ButtonPart(id, o.label, shape, w, d, o.led ?? this.finish.accent, { symbol: o.symbol, alt: o.alt, base: o.base, h: o.h }), x, z);
    if (o.print) {
      const at = o.printAt ?? 'below';
      const off = (at === 'above' || at === 'below' ? d : w) / 2 + 0.0038;
      const px = at === 'left' ? x - off : at === 'right' ? x + off : x;
      const pz = at === 'above' ? z - off : at === 'below' ? z + off : z;
      this.face.text(px, pz, o.print, { size: 0.0025, align: at === 'left' ? 'right' : at === 'right' ? 'left' : 'center' });
    }
    return b;
  }

  pad(id: string, x: number, z: number, size: number, label: string): PadPart {
    return this.add(new PadPart(id, label, size), x, z);
  }

  jog(id: string, x: number, z: number, r: number, style: JogStyle, deck: DeckRef): JogPart {
    this.face.circle(x, z, r + 0.004, { stroke: this.finish.face.sub, line: 0.0004 });
    return this.add(new JogPart(id, 'Jog wheel', r, style, deck, this.finish.accent), x, z);
  }

  screen(x: number, z: number, w: number, d: number, pxW: number, pxH: number, draw: (g: CanvasRenderingContext2D, W: number, H: number, c: PartCtx) => void, tilt = 0, every = 2): ScreenPart {
    return this.add(new ScreenPart(w, d, pxW, pxH, draw, tilt, every), x, z);
  }

  vu(source: number | 'master', x: number, z: number, length: number, n = 12, stereo = true): VuPart {
    return this.add(new VuPart(source, n, length, stereo), x, z);
  }

  indicator(x: number, z: number, r: number, fn: (c: PartCtx) => { color: string; level: number } | null): IndicatorPart {
    return this.add(new IndicatorPart(r, fn), x, z);
  }

  switch3(id: string, x: number, z: number, label: string, state: (c: PartCtx) => -1 | 0 | 1): SwitchPart {
    this.face.text(x - 0.0095, z, 'A', { size: 0.0024, color: this.finish.face.sub });
    this.face.text(x + 0.0095, z, 'B', { size: 0.0024, color: this.finish.face.sub });
    return this.add(new SwitchPart(id, label, state), x, z);
  }

  finalize(): void {
    const f = this.finish;
    const bodyMat = new THREE.MeshStandardMaterial({ color: f.body, metalness: f.bodyMetal, roughness: f.bodyRough });
    const body = new THREE.Mesh(new RoundedBoxGeometry(this.w, this.h, this.d, 3, Math.min(this.radius, this.h / 2 - 0.0005)), bodyMat);
    body.position.y = this.h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    const tex = this.face.render();
    const faceMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: f.face.texture === 'gloss' ? 0.26 : f.face.texture === 'brushed' ? 0.44 : 0.62,
      // where hands work the panel it is rubbed smoother: along the fader slots, round the jogs, the front edge
      roughnessMap: this.face.wearMap(),
      metalness: f.face.texture === 'brushed' ? 0.35 : 0.08,
    });
    const top = new THREE.Mesh(roundedRectPlane(this.w - 0.0006, this.d - 0.0006, this.radius), faceMat);
    top.position.y = this.h + 0.0002;
    top.receiveShadow = true;
    this.group.add(top);
    // rubber feet, screws, the rear panel's print and connectors: two meshes in all
    const hw = unitHardware({ w: this.w, d: this.d, h: this.h, radius: this.radius, body: f.body, jacks: this.jacks, topScrews: this.topScrews, model: this.model, seed: hashString(`${f.id}:${this.w}:${this.d}`) });
    this.group.add(hw.dark, hw.metal);
    this.group.position.y += 0.006;
  }
}

/* ------------------------------------------------------------------ */
/* section helpers                                                      */
/* ------------------------------------------------------------------ */

const PAD_MODE_PRINT: [string, string][] = [
  ['hotcue', 'HOT CUE'],
  ['roll', 'ROLL'],
  ['slicer', 'SLICER'],
  ['sampler', 'SAMPLER'],
  ['jump', 'JUMP'],
  ['pitch', 'PITCH'],
];

/** 4×2 performance pads centred at (cx, cz). */
export function padGrid(u: Unit, side: DeckRef, cx: number, cz: number, size: number, gap: number): void {
  const step = size + gap;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      u.pad(`deck.${side}.pad.${i + 1}`, cx + (col - 1.5) * step, cz + (row - 0.5) * step, size, `Pad ${i + 1}`);
    }
  }
}

/** Pad mode buttons. With four buttons, HOT CUE and ROLL carry BEAT JUMP and
 * PITCH PLAY on their SHIFT layer. */
export function padModes(u: Unit, side: DeckRef, cx: number, cz: number, width: number, count: 4 | 6): void {
  const list = PAD_MODE_PRINT.slice(0, count);
  const step = width / list.length;
  const size = Math.min(0.0025, step * 0.13);
  list.forEach(([m, label], i) => {
    const altMode = count === 4 && i < 2 ? PAD_MODE_PRINT[4 + i] : null;
    const alt = altMode ? `deck.${side}.padmode.${altMode[0]}` : null;
    const x = cx - width / 2 + step * (i + 0.5);
    u.button(`deck.${side}.padmode.${m}`, x, cz, { label: altMode ? `Pad mode ${label} (shift: ${altMode[1]})` : `Pad mode ${label}`, w: step * 0.78, d: 0.0055, led: '#ffffff', alt });
    u.face.text(x, cz - 0.0065, altMode ? `${label}·${altMode[1]}` : label, { size });
  });
}

export function transport(u: Unit, side: DeckRef, x: number, z: number, r: number, gap: number, vertical = false): void {
  const f = u.finish;
  const cuePos: [number, number] = vertical ? [x, z] : [x, z];
  const playPos: [number, number] = vertical ? [x, z + r * 2 + gap] : [x + r * 2 + gap, z];
  u.button(`deck.${side}.cue`, cuePos[0], cuePos[1], { label: 'Cue', shape: 'big', w: r * 2, led: f.cueColor, symbol: 'CUE' });
  u.button(`deck.${side}.play`, playPos[0], playPos[1], { label: 'Play / Pause', shape: 'big', w: r * 2, led: f.playColor, symbol: 'PLAY' });
}

export function loopRow(u: Unit, side: DeckRef, cx: number, z: number, width: number, withSize = true): void {
  const items: [string, string, string | null][] = [
    ['loop.in', 'IN', 'loop.half'],
    ['loop.out', 'OUT', 'loop.double'],
    ['loop.exit', 'RELOOP', null],
    ['loop.4beat', '4 BEAT', null],
  ];
  const n = items.length + (withSize ? 1 : 0);
  const step = width / n;
  items.forEach(([id, label, alt], i) => {
    u.button(`deck.${side}.${id}`, cx - width / 2 + step * (i + 0.5), z, {
      label: id === 'loop.in' ? 'Loop in (hold: 4-beat loop)' : `Loop ${label}`,
      w: step * 0.72,
      d: 0.0055,
      print: alt ? `${label} · ${alt === 'loop.half' ? '½X' : '2X'}` : label,
      printAt: 'above',
      alt: alt ? `deck.${side}.${alt}` : null,
      led: '#3ddc97',
    });
  });
  if (withSize) {
    u.knob(`deck.${side}.loop.size`, cx - width / 2 + step * (n - 0.5), z, { label: 'Loop size (turn) / auto loop (click)', r: 0.0055, h: 0.01, encoder: true, print: 'LOOP', style: 'rubber' });
  }
}

export function channelStrip(u: Unit, ch: number, x: number, z0: number, gap: number, o: { vuX?: number; faderZ: number; faderLen: number; knobR?: number; crush?: boolean; ring?: string | null; filterCap?: string }): void {
  const r = o.knobR ?? 0.0078;
  const knobs: [string, string, string][] = [
    ['trim', 'TRIM', 'Trim'],
    ['hi', 'HI', 'EQ high'],
    ['mid', 'MID', 'EQ mid'],
    ['low', 'LOW', 'EQ low'],
    ['filter', 'FILTER', 'Colour filter'],
  ];
  knobs.forEach(([id, print, label], i) =>
    u.knob(`ch.${ch}.${id}`, x, z0 + i * gap, {
      label: `Ch ${ch} ${label}`,
      print,
      r: id === 'filter' ? r * 1.08 : r,
      center: id !== 'trim' ? true : true,
      cap: id === 'filter' ? o.filterCap ?? '#3a6ea5' : undefined,
      ring: id === 'filter' ? o.ring ?? null : null,
    }),
  );
  const cueZ = z0 + knobs.length * gap + 0.002;
  u.button(`ch.${ch}.cue`, x, cueZ, { label: `Ch ${ch} headphone cue`, w: 0.012, d: 0.0075, print: 'CUE', printAt: 'below', led: '#ff9f1c' });
  u.fader(`ch.${ch}.fader`, x, o.faderZ, 'z', o.faderLen, { label: `Ch ${ch} fader`, maxAtFar: true });
  u.face.text(x, o.faderZ + o.faderLen / 2 + 0.0085, String(ch), { size: 0.0045, color: u.finish.face.accent });
  if (o.vuX !== undefined) u.vu(ch, o.vuX, o.faderZ - o.faderLen * 0.05, o.faderLen * 0.8, 12, true);
}

export function fxSection(u: Unit, cx: number, cz: number, w: number, withScreen = true, channels = 2): void {
  u.face.section(cx, cz, w, 0.062, 'BEAT FX');
  const top = cz - 0.02;
  if (withScreen) {
    u.screen(cx, top - 0.001, w * 0.62, 0.016, 512, 128, (g, W, H, c) => {
      const fx = c.engine.fx;
      g.fillStyle = '#02070a';
      g.fillRect(0, 0, W, H);
      // lit along the bottom while the effect is on
      g.fillStyle = fx.on ? '#ff5f7a' : '#1a2430';
      g.fillRect(0, H * 0.86, W * (fx.on ? 0.35 + 0.65 * fx.depth : 1), H * 0.14);
      g.fillStyle = fx.on ? '#ff8aa0' : '#8fe3ff';
      g.font = `700 ${H * 0.52}px "JetBrains Mono", monospace`;
      g.textBaseline = 'middle';
      g.fillText(fxShort[fx.type], W * 0.03, H * 0.43);
      g.textAlign = 'right';
      g.fillStyle = '#ffffff';
      g.font = `700 ${H * 0.46}px "JetBrains Mono", monospace`;
      const b = fx.beats;
      g.fillText(b >= 1 ? `${b}` : `1/${Math.round(1 / b)}`, W * 0.97, H * 0.43);
      g.textAlign = 'left';
    }, 0, 3);
  }
  u.button('fx.beat.down', cx - w * 0.36, top + 0.017, { label: 'Beat FX beat −', w: 0.009, d: 0.006, print: '◀ BEAT', printAt: 'below', led: '#ffffff' });
  u.button('fx.beat.up', cx - w * 0.2, top + 0.017, { label: 'Beat FX beat +', w: 0.009, d: 0.006, print: 'BEAT ▶', printAt: 'below', led: '#ffffff' });
  u.knob('fx.type', cx - w * 0.36, top + 0.034, { label: 'Beat FX select (turn)', r: 0.0062, encoder: true, print: 'FX', printAbove: false });
  u.knob('fx.select', cx - w * 0.2, top + 0.034, { label: `Beat FX channel select (CH1–${channels} / MST)`, r: 0.0062, encoder: true, print: 'CH', printAbove: false });
  u.knob('fx.depth', cx + w * 0.02, top + 0.024, { label: 'Beat FX level/depth', r: 0.0085, print: 'LEVEL/DEPTH', cap: '#9c2a3f' });
  u.knob('fx.param', cx + w * 0.2, top + 0.024, { label: 'Beat FX parameter', r: 0.0068, print: 'PARAM', cap: '#7a3a9a' });
  u.button('fx.on', cx + w * 0.37, top + 0.025, { label: 'Beat FX on/off', shape: 'round', w: 0.014, print: 'ON/OFF', printAt: 'below', led: '#ff3b5c' });
}

const fxShort: Record<string, string> = {
  echo: 'ECHO',
  pingpong: 'PING',
  reverb: 'REVRB',
  flanger: 'FLNGR',
  phaser: 'PHASR',
  pitch: 'PITCH',
  gate: 'TRANS',
};

export function masterSection(u: Unit, x: number, z: number, gap: number, vuLen: number, vertical = true): void {
  u.knob('mixer.master', x, z, { label: 'Master level', print: 'MASTER', r: 0.0088, cap: '#5b6270' });
  u.knob('mixer.cuemix', x, z + gap, { label: 'Headphone cue/master', print: 'CUE ⇄ MST', r: 0.007 });
  u.knob('mixer.phones', x, z + gap * 2, { label: 'Headphone level', print: 'PHONES', r: 0.007 });
  if (vertical) u.vu('master', x, z + gap * 3 + vuLen / 2, vuLen, 15, true);
}

export function crossfader(u: Unit, x: number, z: number, len: number): void {
  u.fader('mixer.xfader', x, z, 'x', len, { label: 'Crossfader', size: 'cross', center: true, ticks: 8 });
}

/** Helper to create a solid-coloured finish palette. */
export function finish(p: Partial<Finish> & Pick<Finish, 'id' | 'name' | 'swatch' | 'body' | 'face'>): Finish {
  return {
    bodyMetal: 0.2,
    bodyRough: 0.55,
    knobCap: null,
    accent: '#2ec4f1',
    cueColor: '#ff9f1c',
    playColor: '#3ddc97',
    ...p,
  };
}
