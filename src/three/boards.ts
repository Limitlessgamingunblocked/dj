/*
 * Board presets. Dimensions are modelled on real hardware classes:
 *   starter2 – entry-level 2-channel all-in-one controller (~52 × 29 cm)
 *   pro4     – flagship 4-deck controller with jog displays and centre screen
 *   club4    – club standard: two media players + 4-channel mixer
 *   vinyl2   – twin direct-drive turntables + 2-channel battle mixer
 *   quad4    – festival booth: four media players around a 4-channel mixer
 *   hybrid4  – two turntables outside two media players + 4-channel mixer
 *   rotary2  – two turntables + a walnut-cheeked 2-channel rotary mixer
 *   aio2     – flagship 2-channel all-in-one: 728 × 470 mm, a 10.1-inch
 *              touch screen that browses the library, 16 cm jogs
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BoardBuild, channelStrip, crossfader, finish, fxSection, loopRow, masterSection, padGrid, padModes, transport, type Finish, type Unit } from './builder';
import { PlatterPart, TonearmPart, type DeckRef } from './parts';
import { drawDualScreen, drawPlayerScreen } from './screens';
import { TouchScreenPart } from './deviceScreen';
import type { FaceStyle } from './Faceplate';
import { applyStickers } from './stickers';
import { woodTexture } from './materials';

export interface BoardDef {
  id: string;
  name: string;
  category: string;
  description: string;
  decks: 2 | 4;
  /** true: every deck is a turntable; or the list of turntable decks */
  turntable: boolean | number[];
  /** each deck has its own unit (no layer switching on the hardware) */
  fixedDecks?: boolean;
  /** rotary mixers have no crossfader: channels go straight to the master */
  noCrossfader?: boolean;
  xcurve: number;
  finishes: Finish[];
  build(b: BoardBuild): void;
}

const face = (base: string, print: string, sub: string, accent: string, texture: FaceStyle['texture'] = 'matte'): FaceStyle => ({ base, print, sub, accent, texture });

/* ------------------------------------------------------------------ */
/* shared deck bits                                                     */
/* ------------------------------------------------------------------ */

function syncShift(u: Unit, side: 'L' | 'R', x: number, z: number, gap = 0.023): void {
  u.button(`deck.${side}.sync`, x, z, { label: 'Beat sync (shift: master)', w: 0.013, d: 0.0075, print: 'SYNC', printAt: 'above', alt: `deck.${side}.master`, led: '#2ec4f1' });
  u.button('shift', x, z + gap, { label: 'Shift', w: 0.013, d: 0.0075, print: 'SHIFT', printAt: 'below', led: '#ffffff' });
}

/* ------------------------------------------------------------------ */
/* 1. Starter 2-channel controller                                      */
/* ------------------------------------------------------------------ */

function starterDeck(u: Unit, side: 'L' | 'R', x0: number): void {
  const L = side === 'L';
  const jx = x0 + (L ? 0.092 : 0.078);
  const tempoX = x0 + (L ? 0.017 : 0.153);
  const cueX = x0 + (L ? 0.02 : 0.018);
  const padX = x0 + (L ? 0.105 : 0.085);
  loopRow(u, side, x0 + 0.085, -0.122, 0.135);
  u.jog(`deck.${side}.jog`, jx, -0.035, 0.064, 'controller', side);
  u.fader(`deck.${side}.tempo`, tempoX, -0.04, 'z', 0.09, { label: 'Tempo', maxAtFar: false, size: 'tempo', center: true, labels: ['−', '+'], ticks: 16 });
  syncShift(u, side, tempoX, 0.03);
  transport(u, side, cueX, 0.088, 0.0115, 0.006, true);
  padModes(u, side, padX, 0.062, 0.1, 4);
  padGrid(u, side, padX, 0.1, 0.021, 0.004);
  u.face.text(jx, -0.035 + 0.064 + 0.009, side === 'L' ? 'DECK 1' : 'DECK 2', { size: 0.0032, color: u.finish.face.accent });
}

const starter: BoardDef = {
  id: 'starter2',
  name: 'Starter Two',
  category: 'Two-deck controller',
  description: 'Compact and simple. Where most DJs start.',
  decks: 2,
  turntable: false,
  xcurve: 0.35,
  finishes: [
    finish({ id: 'midnight', name: 'Midnight', swatch: '#15171b', body: '#111215', face: face('#15171b', '#d9dde4', '#5f6672', '#2ec4f1'), accent: '#2ec4f1' }),
    finish({ id: 'arctic', name: 'Arctic white', swatch: '#e9ebef', body: '#e3e6ea', face: face('#eceef1', '#1b1e24', '#8a919c', '#e0344d'), knobCap: '#f2f3f5', accent: '#ff3b5c', bodyRough: 0.4 }),
    finish({ id: 'ruby', name: 'Ruby', swatch: '#6d1223', body: '#3a0d14', face: face('#1c0b10', '#ffd9df', '#8f5a66', '#ff4d6d'), accent: '#ff4d6d', cueColor: '#ffb020' }),
  ],
  build(b) {
    const u = b.unit(0, 0, 0.52, 0.29, 0.048, { radius: 0.012 });
    // mixer
    u.face.section(0, -0.004, 0.176, 0.28);
    u.knob('browse', 0, -0.126, { label: 'Browse library (turn) / load to left (click)', r: 0.0075, encoder: true, print: 'BROWSE', printAbove: false });
    u.button('deck.L.load', -0.03, -0.126, { label: 'Load selected track to left deck', w: 0.014, d: 0.0075, print: 'LOAD', printAt: 'below', led: '#ffffff' });
    u.button('deck.R.load', 0.03, -0.126, { label: 'Load selected track to right deck', w: 0.014, d: 0.0075, print: 'LOAD', printAt: 'below', led: '#ffffff' });
    channelStrip(u, 1, -0.058, -0.098, 0.02, { faderZ: 0.055, faderLen: 0.05, vuX: -0.04 });
    channelStrip(u, 2, 0.058, -0.098, 0.02, { faderZ: 0.055, faderLen: 0.05, vuX: 0.04 });
    u.knob('mixer.master', -0.019, -0.098, { label: 'Master level', print: 'MASTER', r: 0.0075, cap: '#5b6270' });
    u.knob('mixer.phones', 0.019, -0.098, { label: 'Headphone level', print: 'PHONES', r: 0.007 });
    u.knob('mixer.cuemix', -0.019, -0.074, { label: 'Headphone cue/master', print: 'MIX', r: 0.0065 });
    u.knob('mixer.xcurve', 0.019, -0.074, { label: 'Crossfader curve', print: 'X-CURVE', r: 0.0065 });
    u.face.section(0, -0.027, 0.074, 0.048, 'BEAT FX');
    u.knob('fx.type', -0.019, -0.038, { label: 'Beat FX select', r: 0.0062, encoder: true, print: 'FX', printAbove: false });
    u.knob('fx.depth', 0.019, -0.038, { label: 'Beat FX level/depth', r: 0.0072, print: 'LEVEL', cap: '#9c2a3f' });
    u.button('fx.beat.down', -0.024, -0.014, { label: 'Beat FX beat −', w: 0.01, d: 0.006, print: '◀', printAt: 'left', led: '#ffffff' });
    u.button('fx.beat.up', -0.008, -0.014, { label: 'Beat FX beat +', w: 0.01, d: 0.006, print: '▶', printAt: 'right', led: '#ffffff' });
    u.button('fx.on', 0.019, -0.013, { label: 'Beat FX on/off', shape: 'round', w: 0.012, led: '#ff3b5c' });
    u.knob('mixer.sampler', 0, 0.016, { label: 'Sampler level', print: 'SAMPLER', r: 0.0062 });
    crossfader(u, 0, 0.118, 0.055);
    starterDeck(u, 'L', -0.26);
    starterDeck(u, 'R', 0.09);
  },
};

/* ------------------------------------------------------------------ */
/* 2. Pro four-deck controller                                          */
/* ------------------------------------------------------------------ */

function proDeck(u: Unit, side: 'L' | 'R', cx: number): void {
  const L = side === 'L';
  const outer = cx + (L ? -0.098 : 0.098);
  const inner = cx + (L ? 0.1 : -0.1);
  const jx = cx + (L ? 0.004 : -0.004);
  loopRow(u, side, cx, -0.112, 0.16);
  u.jog(`deck.${side}.jog`, jx, -0.018, 0.084, 'pro', side);
  u.fader(`deck.${side}.tempo`, outer, -0.03, 'z', 0.1, { label: 'Tempo', maxAtFar: false, size: 'tempo', center: true, labels: ['−', '+'], ticks: 16 });
  u.button(`deck.${side}.range`, outer, -0.093, { label: 'Tempo range', w: 0.012, d: 0.006, print: 'RANGE', printAt: 'above', led: '#ffffff' });
  syncShift(u, side, outer, 0.04, 0.022);
  transport(u, side, outer, 0.105, 0.0125, 0.006, true);
  const util: [string, string, string | null][] = [
    [`layer.${side}`, 'DECK', null],
    [`deck.${side}.slip`, 'SLIP', null],
    [`deck.${side}.quantize`, 'QUANT', null],
    [`deck.${side}.keylock`, 'KEY LOCK', `deck.${side}.key.sync`],
    [`deck.${side}.vinyl`, 'VINYL', null],
    [`deck.${side}.jump.back`, 'JUMP ◀', null],
    [`deck.${side}.jump.fwd`, 'JUMP ▶', null],
  ];
  util.forEach(([id, print, alt], i) => u.button(id, inner, -0.078 + i * 0.019, { label: alt ? `${print} (shift: key sync)` : print, w: 0.013, d: 0.0065, print, printAt: 'above', alt, led: id.startsWith('layer') ? '#ffffff' : '#ffd23f' }));
  padModes(u, side, cx + (L ? 0.012 : -0.012), 0.093, 0.16, 6);
  padGrid(u, side, cx + (L ? 0.012 : -0.012), 0.142, 0.026, 0.006);
}

const pro: BoardDef = {
  id: 'pro4',
  name: 'Pro Four',
  category: 'Four-deck controller',
  description: 'Big jogs with screens, six pad modes and a sampler.',
  decks: 4,
  turntable: false,
  xcurve: 0.3,
  finishes: [
    finish({ id: 'graphite', name: 'Graphite', swatch: '#2b2f36', body: '#16181c', bodyMetal: 0.6, bodyRough: 0.4, face: face('#23262c', '#e3e7ee', '#6c7483', '#ff4d6d', 'brushed'), accent: '#ff4d6d', knobCap: '#2c3038' }),
    finish({ id: 'silver', name: 'Silver', swatch: '#b8bdc6', body: '#1a1c20', bodyMetal: 0.6, bodyRough: 0.4, face: face('#aab0ba', '#15181d', '#5c6370', '#1a64d6', 'brushed'), accent: '#2ec4f1', knobCap: '#d9dde3' }),
    finish({ id: 'neon', name: 'Neon edge', swatch: '#0b0d12', body: '#07080b', bodyMetal: 0.3, bodyRough: 0.3, face: face('#0b0d12', '#b9f5ff', '#2b6a78', '#39ffd2', 'gloss'), accent: '#39ffd2', cueColor: '#ff5fcf', playColor: '#39ffd2' }),
  ],
  build(b) {
    const u = b.unit(0, 0, 0.74, 0.4, 0.058, { radius: 0.014 });
    // centre screen + browse
    u.screen(0, -0.158, 0.2, 0.062, 720, 224, (g, W, H, c) => drawDualScreen(g, W, H, c), 0.18, 2);
    u.knob('browse', -0.118, -0.176, { label: 'Browse library', r: 0.0075, encoder: true, print: 'BROWSE', printAbove: false });
    u.button('deck.L.load', -0.118, -0.142, { label: 'Load to left deck', w: 0.014, d: 0.007, print: 'LOAD ◀', printAt: 'below', led: '#ffffff' });
    u.button('deck.R.load', 0.118, -0.142, { label: 'Load to right deck', w: 0.014, d: 0.007, print: 'LOAD ▶', printAt: 'below', led: '#ffffff' });
    u.knob('mixer.master', 0.118, -0.176, { label: 'Master level', print: 'MASTER', r: 0.0078, cap: '#5b6270', printAbove: false });
    // four channels
    const xs = [-0.09, -0.03, 0.03, 0.09];
    xs.forEach((x, i) => channelStrip(u, i + 1, x, -0.1, 0.021, { faderZ: 0.075, faderLen: 0.06, vuX: x + 0.019, ring: b.finish.accent, knobR: 0.0074 }));
    xs.forEach((x, i) =>
      u.switch3(`ch.${i + 1}.assign`, x, 0.123, `Ch ${i + 1} crossfader assign`, (c) => {
        const a = c.engine.channels[i].state.assign;
        return a === 'A' ? -1 : a === 'B' ? 1 : 0;
      }),
    );
    crossfader(u, 0, 0.168, 0.07);
    u.knob('mixer.xcurve', -0.105, 0.162, { label: 'Crossfader curve', print: 'X-CURVE', r: 0.0062 });
    u.knob('mixer.cuemix', 0.095, 0.155, { label: 'Headphone cue/master', print: 'MIX', r: 0.0062 });
    u.knob('mixer.phones', 0.118, 0.178, { label: 'Headphone level', print: 'PHONES', r: 0.0062, printAbove: false });
    u.knob('mixer.sampler', -0.118, 0.186, { label: 'Sampler level', print: 'SMP', r: 0.0055, printAbove: false });
    // deck top strips: beat FX left, sampler right
    fxSection(u, -0.245, -0.16, 0.2, true, 4);
    u.face.section(0.245, -0.16, 0.2, 0.062, 'SAMPLER');
    for (let i = 0; i < 8; i++) u.button(`sampler.pad.${i + 1}`, 0.245 - 0.075 + i * 0.0215, -0.152, { label: `Sampler slot ${i + 1}`, w: 0.016, d: 0.012, print: String(i + 1), printAt: 'below', led: '#ffd23f' });
    proDeck(u, 'L', -0.245);
    proDeck(u, 'R', 0.245);
  },
};

/* ------------------------------------------------------------------ */
/* 3. Club standard: two media players + 4-channel mixer               */
/* ------------------------------------------------------------------ */

function player(b: BoardBuild, side: DeckRef, x: number): void {
  const u = b.unit(x, 0, 0.32, 0.43, 0.1, { radius: 0.012 });
  const D = `deck.${side}`;
  const fixed = typeof side === 'number';
  u.screen(0, -0.14, 0.215, 0.125, 800, 464, (g, W, H, c) => drawPlayerScreen(g, W, H, c.deck(side), c), 0.28, 2);
  u.knob('browse', 0.135, -0.19, { label: 'Browse library', r: 0.0075, encoder: true, print: 'BROWSE', printAbove: false });
  u.button(`${D}.load`, 0.135, -0.15, { label: 'Load selected track', w: 0.016, d: 0.008, print: 'LOAD', printAt: 'below', led: '#ffffff' });
  if (fixed) u.face.text(-0.135, -0.19, `DECK ${side}`, { size: 0.0052, color: u.finish.face.accent });
  else u.button(`layer.${side}`, -0.135, -0.19, { label: side === 'L' ? 'Deck 1 / 3' : 'Deck 2 / 4', w: 0.016, d: 0.008, print: side === 'L' ? 'DECK 1/3' : 'DECK 2/4', printAt: 'below', led: '#ffffff' });
  u.button(`${D}.keylock`, -0.135, -0.15, { label: 'Master tempo (key lock)', w: 0.016, d: 0.008, print: 'MASTER TEMPO', printAt: 'below', led: '#ff5fcf', alt: `${D}.key.sync` });
  // hot cues A-H
  for (let i = 0; i < 8; i++) u.button(`${D}.hotcue.${i + 1}`, -0.1085 + i * 0.031, -0.058, { label: `Hot cue ${String.fromCharCode(65 + i)}`, w: 0.024, d: 0.011, print: String.fromCharCode(65 + i), printAt: 'above', led: '#ffffff' });
  // loop / utility column
  const lx0 = -0.137;
  const lx1 = -0.112;
  u.button(`${D}.loop.in`, lx0, -0.02, { label: 'Loop in (hold: 4-beat loop; shift: ½)', w: 0.02, d: 0.009, print: 'IN', printAt: 'above', led: '#3ddc97', alt: `${D}.loop.half` });
  u.button(`${D}.loop.out`, lx1, -0.02, { label: 'Loop out (shift: ×2)', w: 0.02, d: 0.009, print: 'OUT', printAt: 'above', led: '#3ddc97', alt: `${D}.loop.double` });
  u.button(`${D}.loop.exit`, lx0, 0.008, { label: 'Reloop / exit', w: 0.02, d: 0.009, print: 'RELOOP', printAt: 'above', led: '#3ddc97' });
  u.button(`${D}.loop.4beat`, lx1, 0.008, { label: '4-beat loop', w: 0.02, d: 0.009, print: '4 BEAT', printAt: 'above', led: '#3ddc97' });
  u.button(`${D}.jump.back`, lx0, 0.036, { label: 'Beat jump back', w: 0.02, d: 0.009, print: '◀ JUMP', printAt: 'above', led: '#ffffff' });
  u.button(`${D}.jump.fwd`, lx1, 0.036, { label: 'Beat jump forward', w: 0.02, d: 0.009, print: 'JUMP ▶', printAt: 'above', led: '#ffffff' });
  u.button(`${D}.slip`, lx0, 0.064, { label: 'Slip', w: 0.02, d: 0.009, print: 'SLIP', printAt: 'above', led: '#b36bff' });
  u.button(`${D}.quantize`, lx1, 0.064, { label: 'Quantize', w: 0.02, d: 0.009, print: 'QUANTIZE', printAt: 'above', led: '#ff3b5c' });
  u.button(`${D}.reverse`, lx0, 0.092, { label: 'Reverse', w: 0.02, d: 0.009, print: 'REV', printAt: 'above', led: '#ff3b5c' });
  u.button('shift', lx1, 0.092, { label: 'Shift', w: 0.02, d: 0.009, print: 'SHIFT', printAt: 'above', led: '#ffffff' });
  transport(u, side, -0.126, 0.142, 0.0155, 0.008, true);
  u.jog(`${D}.jog`, 0.014, 0.08, 0.1, 'cdj', side);
  // tempo column
  const tx = 0.138;
  u.button(`${D}.vinyl`, tx, -0.02, { label: 'Vinyl / CDJ jog mode', w: 0.018, d: 0.009, print: 'VINYL', printAt: 'above', led: '#ffffff' });
  u.button(`${D}.sync`, tx, 0.006, { label: 'Beat sync', w: 0.018, d: 0.009, print: 'BEAT SYNC', printAt: 'above', led: '#2ec4f1' });
  u.button(`${D}.master`, tx, 0.032, { label: 'Tempo master', w: 0.018, d: 0.009, print: 'MASTER', printAt: 'above', led: '#ff9f1c' });
  u.button(`${D}.range`, tx, 0.058, { label: 'Tempo range', w: 0.018, d: 0.009, print: 'TEMPO ±', printAt: 'above', led: '#ffffff' });
  u.fader(`${D}.tempo`, tx, 0.138, 'z', 0.12, { label: 'Tempo', maxAtFar: false, size: 'tempo', center: true, labels: ['−', '+'], ticks: 16 });
  u.button(`${D}.tempo.reset`, tx - 0.02, 0.2, { label: 'Tempo reset', w: 0.012, d: 0.006, print: 'RESET', printAt: 'left', led: '#3ddc97' });
  u.face.text(-0.03, 0.2, fixed ? `MEDIA PLAYER · DECK ${side}` : side === 'L' ? 'MEDIA PLAYER · DECK 1 / 3' : 'MEDIA PLAYER · DECK 2 / 4', { size: 0.0036, color: u.finish.face.accent, spacing: 0.2 });
}

function clubMixer(b: BoardBuild): void {
  const u = b.unit(0, 0, 0.33, 0.43, 0.1, { radius: 0.01 });
  const xs = [-0.125, -0.075, -0.025, 0.025];
  xs.forEach((x, i) => channelStrip(u, i + 1, x, -0.18, 0.029, { faderZ: 0.083, faderLen: 0.085, vuX: x + 0.021, knobR: 0.0088 }));
  xs.forEach((x, i) =>
    u.switch3(`ch.${i + 1}.assign`, x, 0.142, `Ch ${i + 1} crossfader assign`, (c) => {
      const a = c.engine.channels[i].state.assign;
      return a === 'A' ? -1 : a === 'B' ? 1 : 0;
    }),
  );
  crossfader(u, -0.05, 0.182, 0.09);
  // right column
  const rx = 0.107;
  masterSection(u, rx - 0.02, -0.18, 0.028, 0.0, false);
  u.vu('master', rx + 0.03, -0.13, 0.1, 15, true);
  u.face.text(rx + 0.03, -0.188, 'MASTER', { size: 0.0026 });
  fxSection(u, rx, 0.02, 0.105, true, 4);
  u.knob('mixer.xcurve', rx - 0.03, 0.105, { label: 'Crossfader curve', print: 'X-F CURVE', r: 0.0068 });
  u.knob('mixer.sampler', rx + 0.03, 0.105, { label: 'Sampler level', print: 'SAMPLER', r: 0.0068 });
  u.button('mixer.split', rx, 0.15, { label: 'Split cue (master left / cue right)', w: 0.02, d: 0.008, print: 'SPLIT CUE', printAt: 'below', led: '#ff9f1c' });
  u.face.text(-0.05, 0.205, '4-CHANNEL CLUB MIXER', { size: 0.0036, color: u.finish.face.accent, spacing: 0.25 });
}

const club: BoardDef = {
  id: 'club4',
  name: 'Club Standard',
  category: 'Club booth',
  description: 'Two media players and a four-channel mixer. The booth standard.',
  decks: 4,
  turntable: false,
  xcurve: 0.3,
  finishes: [
    finish({ id: 'booth', name: 'Booth black', swatch: '#1b1d22', body: '#16181c', bodyMetal: 0.5, bodyRough: 0.45, face: face('#1d2025', '#e8ebf0', '#6b7382', '#f0f3f7', 'brushed'), accent: '#2ec4f1', knobCap: '#2a2d33', cueColor: '#ff9f1c', playColor: '#3ddc97' }),
    finish({ id: 'platinum', name: 'Platinum', swatch: '#c9ccd2', body: '#2b2e33', bodyMetal: 0.7, bodyRough: 0.35, face: face('#b9bdc4', '#15171b', '#5d6470', '#15171b', 'brushed'), accent: '#ffffff', knobCap: '#e3e5e9' }),
  ],
  build(b) {
    player(b, 'L', -0.4);
    clubMixer(b);
    player(b, 'R', 0.4);
  },
};

/* ------------------------------------------------------------------ */
/* 4. Vinyl turntable rig                                               */
/* ------------------------------------------------------------------ */

function turntable(b: BoardBuild, side: DeckRef, x: number): void {
  const f = b.finish;
  const D = `deck.${side}`;
  const u = b.unit(x, 0, 0.453, 0.353, 0.075, { radius: 0.01 });
  const pc = new THREE.Vector2(-0.045, 0.005);
  u.add(new PlatterPart(`${D}.jog`, 'Record / platter', side, f.accent), pc.x, pc.y);
  u.face.circle(pc.x, pc.y, 0.171, { stroke: 'rgba(0,0,0,0.35)', line: 0.002 });
  u.add(new TonearmPart(`${D}.needle`, 'Tonearm (drag to drop the needle)', new THREE.Vector2(0.165, -0.105), pc, side), 0.165, -0.105);
  u.button(`${D}.start`, -0.196, 0.158, { label: 'Start / stop', w: 0.032, d: 0.016, print: 'START·STOP', printAt: 'above', led: '#ff3b5c', base: '#2a2d33' });
  u.button(`${D}.rpm33`, -0.214, 0.125, { label: '33 RPM', w: 0.013, d: 0.01, print: '33', printAt: 'above', led: '#ffd23f' });
  u.button(`${D}.rpm45`, -0.197, 0.125, { label: '45 RPM', w: 0.013, d: 0.01, print: '45', printAt: 'above', led: '#ffd23f' });
  u.fader(`${D}.tempo`, 0.19, 0.07, 'z', 0.11, { label: 'Pitch', maxAtFar: false, size: 'tempo', center: true, labels: ['−', '+'], ticks: 16, cap: '#2a2d33' });
  u.button(`${D}.range`, 0.19, -0.002, { label: 'Pitch range', w: 0.014, d: 0.007, print: 'RANGE', printAt: 'above', led: '#ffffff' });
  u.button(`${D}.tempo.reset`, 0.19, 0.145, { label: 'Pitch reset', w: 0.014, d: 0.007, print: 'RESET', printAt: 'below', led: '#3ddc97' });
  u.knob(`${D}.motor.start`, -0.214, 0.06, { label: 'Start time', r: 0.0052, h: 0.009, print: 'START', style: 'chrome' });
  u.knob(`${D}.motor.brake`, -0.214, 0.087, { label: 'Brake time', r: 0.0052, h: 0.009, print: 'BRAKE', printAbove: false, style: 'chrome' });
  u.knob(`${D}.wear`, 0.207, -0.16, { label: 'Record wear (crackle, hiss, wow)', r: 0.0055, h: 0.009, print: 'WEAR', printAbove: false, style: 'chrome' });
  u.indicator(-0.205, -0.155, 0.004, (c) => (c.deck(side).playing ? { color: '#ffffff', level: 0.9 } : { color: '#ffffff', level: 0.05 }));
  u.face.text(-0.18, -0.16, typeof side === 'number' ? `DIRECT DRIVE · DECK ${side}` : 'DIRECT DRIVE', { size: 0.0042, color: f.face.print, spacing: 0.25, align: 'left' });
}

function battleMixer(b: BoardBuild): void {
  const u = b.unit(0, 0, 0.27, 0.353, 0.075, { radius: 0.008 });
  u.knob('browse', 0, -0.16, { label: 'Browse library', r: 0.0055, encoder: true });
  channelStrip(u, 1, -0.037, -0.14, 0.025, { faderZ: 0.035, faderLen: 0.045, vuX: -0.019, knobR: 0.0072 });
  channelStrip(u, 2, 0.037, -0.14, 0.025, { faderZ: 0.035, faderLen: 0.045, vuX: 0.019, knobR: 0.0072 });
  u.knob('mixer.master', 0, -0.135, { label: 'Master level', print: 'MST', r: 0.0068, cap: '#5b6270' });
  u.knob('mixer.cuemix', 0, -0.11, { label: 'Headphone cue/master', print: 'MIX', r: 0.006 });
  u.knob('mixer.phones', 0, -0.085, { label: 'Headphone level', print: 'PHONES', r: 0.006 });
  u.knob('mixer.xcurve', 0, -0.06, { label: 'Crossfader curve', print: 'CURVE', r: 0.006 });
  u.knob('mixer.sampler', 0, -0.035, { label: 'Sampler level', print: 'SMP', r: 0.006 });
  crossfader(u, 0, 0.15, 0.06);
  u.button('mixer.hamster', 0, 0.118, { label: 'Crossfader reverse (hamster)', w: 0.012, d: 0.006, print: 'REV', printAt: 'above', led: '#ff9f1c' });
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? -1 : 1;
    const ox = s * 0.1;
    u.button(`deck.${side}.load`, ox, -0.155, { label: 'Load selected track', w: 0.02, d: 0.008, print: 'LOAD', printAt: 'above', led: '#ffffff' });
    u.button(`deck.${side}.sync`, ox - 0.012, -0.127, { label: 'Sync (shift: master)', w: 0.018, d: 0.008, print: 'SYNC', printAt: 'above', alt: `deck.${side}.master`, led: '#2ec4f1' });
    u.button(`deck.${side}.keylock`, ox + 0.012, -0.127, { label: 'Key lock', w: 0.018, d: 0.008, print: 'KEY', printAt: 'above', led: '#ff5fcf' });
    u.button(`deck.${side}.slip`, ox - 0.012, -0.102, { label: 'Slip', w: 0.018, d: 0.008, print: 'SLIP', printAt: 'above', led: '#b36bff' });
    u.button(`deck.${side}.quantize`, ox + 0.012, -0.102, { label: 'Quantize', w: 0.018, d: 0.008, print: 'QUANT', printAt: 'above', led: '#ff3b5c' });
    u.button(`deck.${side}.loop.in`, ox - 0.012, -0.077, { label: 'Loop in (hold: 4-beat loop; shift: ½)', w: 0.018, d: 0.008, print: 'IN', printAt: 'above', led: '#3ddc97', alt: `deck.${side}.loop.half` });
    u.button(`deck.${side}.loop.out`, ox + 0.012, -0.077, { label: 'Loop out (shift: ×2)', w: 0.018, d: 0.008, print: 'OUT', printAt: 'above', led: '#3ddc97', alt: `deck.${side}.loop.double` });
    u.button(`deck.${side}.loop.auto`, ox - 0.012, -0.052, { label: 'Auto loop', w: 0.018, d: 0.008, print: 'LOOP', printAt: 'above', led: '#3ddc97' });
    u.button('shift', ox + 0.012, -0.052, { label: 'Shift', w: 0.018, d: 0.008, print: 'SHIFT', printAt: 'above', led: '#ffffff' });
    u.button(`deck.${side}.cue`, ox, -0.024, { label: 'Cue', shape: 'round', w: 0.016, print: 'CUE', printAt: 'left', led: b.finish.cueColor });
    padModes(u, side, ox, 0.03, 0.058, 4);
    padGrid(u, side, ox, 0.068, 0.0135, 0.0025);
    // paddle FX per side
    if (side === 'L') {
      u.knob('fx.type', ox - 0.012, 0.118, { label: 'Beat FX select', r: 0.0055, encoder: true, print: 'FX', printAbove: false });
      u.knob('fx.depth', ox + 0.013, 0.118, { label: 'Beat FX level', r: 0.0062, print: 'LEVEL', cap: '#9c2a3f', printAbove: false });
    } else {
      u.button('fx.beat.down', ox - 0.013, 0.113, { label: 'FX beat −', w: 0.014, d: 0.007, print: '◀ BEAT', printAt: 'below', led: '#ffffff' });
      u.button('fx.beat.up', ox + 0.013, 0.113, { label: 'FX beat +', w: 0.014, d: 0.007, print: 'BEAT ▶', printAt: 'below', led: '#ffffff' });
    }
    u.button('fx.on', ox, 0.155, { label: 'Beat FX on/off (paddle)', w: 0.03, d: 0.012, print: side === 'L' ? 'FX ON' : 'FX ON', printAt: 'above', led: '#ff3b5c' });
  }
}

const vinyl: BoardDef = {
  id: 'vinyl2',
  name: 'Vinyl Battle',
  category: 'Turntables',
  description: 'Two turntables and a battle mixer. Real platters, real scratching.',
  decks: 2,
  turntable: true,
  xcurve: 0.92,
  finishes: [
    finish({ id: 'silver', name: 'Silver classic', swatch: '#b9bdc4', body: '#8f949c', bodyMetal: 0.85, bodyRough: 0.35, face: face('#a9aeb6', '#16181c', '#595f69', '#16181c', 'brushed'), accent: '#ff3b3b', knobCap: '#dfe2e6' }),
    finish({ id: 'black', name: 'Black edition', swatch: '#1a1b1e', body: '#121315', bodyMetal: 0.6, bodyRough: 0.4, face: face('#17181b', '#e4e7ec', '#636a76', '#ffb020', 'matte'), accent: '#ffb020', knobCap: '#2a2d33' }),
    finish({ id: 'gold', name: 'Champagne', swatch: '#c7a86a', body: '#6e5b37', bodyMetal: 0.9, bodyRough: 0.3, face: face('#b99b62', '#1a150c', '#5e4d2c', '#1a150c', 'brushed'), accent: '#ff5a36', knobCap: '#e8d6ae' }),
  ],
  build(b) {
    turntable(b, 'L', -0.39);
    battleMixer(b);
    turntable(b, 'R', 0.39);
  },
};

/* ------------------------------------------------------------------ */
/* 5. Festival quad: four media players                                 */
/* ------------------------------------------------------------------ */

const quad: BoardDef = {
  id: 'quad4',
  name: 'Festival Quad',
  category: 'Festival booth',
  description: 'Four media players around a four-channel mixer.',
  decks: 4,
  turntable: false,
  fixedDecks: true,
  xcurve: 0.3,
  finishes: [
    finish({ id: 'booth', name: 'Booth black', swatch: '#1b1d22', body: '#16181c', bodyMetal: 0.5, bodyRough: 0.45, face: face('#1d2025', '#e8ebf0', '#6b7382', '#f0f3f7', 'brushed'), accent: '#2ec4f1', knobCap: '#2a2d33', cueColor: '#ff9f1c', playColor: '#3ddc97' }),
    finish({ id: 'white', name: 'Limited white', swatch: '#e9eaec', body: '#d9dbde', bodyMetal: 0.2, bodyRough: 0.45, face: face('#eceef0', '#16181c', '#7c838e', '#e0344d', 'matte'), accent: '#ff3b5c', knobCap: '#f1f2f4', cueColor: '#ff9f1c', playColor: '#3ddc97' }),
  ],
  build(b) {
    player(b, 3, -0.665);
    player(b, 1, -0.335);
    clubMixer(b);
    player(b, 2, 0.335);
    player(b, 4, 0.665);
  },
};

/* ------------------------------------------------------------------ */
/* 6. Hybrid booth: turntables outside, media players inside            */
/* ------------------------------------------------------------------ */

const hybrid: BoardDef = {
  id: 'hybrid4',
  name: 'Hybrid Booth',
  category: 'Hybrid booth',
  description: 'Turntables outside, media players inside. Records and files together.',
  decks: 4,
  turntable: [3, 4],
  fixedDecks: true,
  xcurve: 0.3,
  finishes: [
    finish({ id: 'booth', name: 'Booth black', swatch: '#1b1d22', body: '#16181c', bodyMetal: 0.5, bodyRough: 0.45, face: face('#1d2025', '#e8ebf0', '#6b7382', '#f0f3f7', 'brushed'), accent: '#ffb020', knobCap: '#2a2d33', cueColor: '#ff9f1c', playColor: '#3ddc97' }),
    finish({ id: 'silver', name: 'Silver', swatch: '#b9bdc4', body: '#8f949c', bodyMetal: 0.85, bodyRough: 0.35, face: face('#a9aeb6', '#16181c', '#595f69', '#16181c', 'brushed'), accent: '#ff3b3b', knobCap: '#dfe2e6' }),
  ],
  build(b) {
    turntable(b, 3, -0.735);
    player(b, 1, -0.335);
    clubMixer(b);
    player(b, 2, 0.335);
    turntable(b, 4, 0.735);
  },
};

/* ------------------------------------------------------------------ */
/* 7. Rotary house: two turntables + rotary mixer                       */
/* ------------------------------------------------------------------ */

function rotaryMixer(b: BoardBuild): void {
  const u = b.unit(0, 0, 0.3, 0.353, 0.09, { radius: 0.006 });
  const chX = [-0.085, 0.085];
  chX.forEach((x, i) => {
    const ch = i + 1;
    u.knob(`ch.${ch}.trim`, x, -0.145, { label: `Ch ${ch} gain`, print: 'GAIN', r: 0.0085, style: 'chrome' });
    u.knob(`ch.${ch}.hi`, x, -0.108, { label: `Ch ${ch} high`, print: 'HIGH', r: 0.0095, style: 'chrome', center: true });
    u.knob(`ch.${ch}.mid`, x, -0.074, { label: `Ch ${ch} mid`, print: 'MID', r: 0.0095, style: 'chrome', center: true });
    u.knob(`ch.${ch}.low`, x, -0.04, { label: `Ch ${ch} low`, print: 'LOW', r: 0.0095, style: 'chrome', center: true });
    u.knob(`ch.${ch}.filter`, x, -0.005, { label: `Ch ${ch} filter`, print: 'FILTER', r: 0.0088, cap: '#8a2a1a', center: true });
    u.button(`ch.${ch}.cue`, x, 0.026, { label: `Ch ${ch} headphone cue`, w: 0.013, d: 0.008, print: 'CUE', printAt: 'below', led: '#ff9f1c' });
    u.knob(`ch.${ch}.fader`, x, 0.088, { label: `Ch ${ch} level (rotary)`, print: String(ch), r: 0.018, h: 0.022, style: 'chrome', printAbove: false });
    u.vu(ch, x + (i ? -0.032 : 0.032), -0.09, 0.09, 12, true);
    u.button(`deck.${i ? 'R' : 'L'}.load`, x, 0.145, { label: 'Load selected track', w: 0.014, d: 0.007, print: 'LOAD', printAt: 'above', led: '#ffffff' });
  });
  u.knob('fx.type', 0, -0.152, { label: 'Send FX type', r: 0.006, encoder: true, print: 'FX', printAbove: false });
  u.knob('fx.depth', 0, -0.118, { label: 'Send FX level', print: 'SEND', r: 0.0072, cap: '#8a2a1a' });
  u.button('fx.on', 0, -0.088, { label: 'Send FX on/off', shape: 'round', w: 0.011, led: '#ff3b5c' });
  u.vu('master', 0, -0.03, 0.07, 12, true);
  u.knob('mixer.cuemix', 0, 0.024, { label: 'Cue / master', print: 'CUE MIX', r: 0.0068, style: 'chrome' });
  u.knob('mixer.phones', 0, 0.052, { label: 'Headphones', print: 'PHONES', r: 0.0068, style: 'chrome', printAbove: false });
  u.knob('mixer.master', 0, 0.098, { label: 'Master level', print: 'MASTER', r: 0.013, h: 0.018, style: 'chrome', printAbove: false });
  u.knob('browse', 0, 0.148, { label: 'Browse library', r: 0.0055, encoder: true });
  u.face.text(0, 0.17, 'ROTARY · 2 CH ISOLATOR MIXER', { size: 0.0032, color: u.finish.face.accent, spacing: 0.2 });
  // walnut cheeks
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0 });
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.353), wood);
    cheek.position.set(s * (0.15 + 0.009), 0.05, 0);
    cheek.castShadow = true;
    u.group.add(cheek);
  }
}

const rotary: BoardDef = {
  id: 'rotary2',
  name: 'Rotary House',
  category: 'Rotary',
  description: 'Turntables and a rotary mixer. No sync, no crossfader: mix by ear.',
  decks: 2,
  turntable: true,
  noCrossfader: true,
  xcurve: 0.3,
  finishes: [
    finish({ id: 'walnut', name: 'Walnut & black', swatch: '#5a3a22', body: '#1a1a1c', bodyMetal: 0.5, bodyRough: 0.4, face: face('#1b1b1e', '#e9e3d6', '#6e6a62', '#e0a458', 'brushed'), accent: '#e0a458', knobCap: null }),
    finish({ id: 'silver', name: 'Silver', swatch: '#b9bdc4', body: '#8f949c', bodyMetal: 0.85, bodyRough: 0.35, face: face('#b0b4bb', '#16181c', '#595f69', '#8a2a1a', 'brushed'), accent: '#ff5a36', knobCap: null }),
  ],
  build(b) {
    turntable(b, 'L', -0.39);
    rotaryMixer(b);
    turntable(b, 'R', 0.39);
  },
};

/* ------------------------------------------------------------------ */
/* 8. All-in-one with a touch screen                                    */
/* ------------------------------------------------------------------ */

/*
 * Laid out from the flagship two-channel all-in-ones (728 × 470 mm, 9.3 kg):
 * two identical decks (not mirrored) either side of a two-channel mixer, a
 * 10.1-inch touch screen standing up behind the mixer with the browse
 * encoder, BACK, TAG and LOAD 1 / 2 beside it, a mic section top left and the
 * USB slots top right. Positions are measured off the top view.
 */

/** one deck; `dx` shifts the left deck's layout across to the right one */
function aioDeck(u: Unit, deck: 1 | 2, dx: number): void {
  const D = `deck.${deck}`;
  const f = u.finish;
  const X = (x: number) => x + dx;
  const small = { w: 0.017, d: 0.009 };
  // the top row: loop, cue/loop call, delete, memory
  u.button(`${D}.loop.in`, X(-0.33), -0.141, { label: 'Loop in (hold: 4-beat loop; shift: ½)', w: 0.022, d: 0.012, print: 'IN', printAt: 'above', led: '#ff9f1c', alt: `${D}.loop.half` });
  u.button(`${D}.loop.out`, X(-0.302), -0.141, { label: 'Loop out (shift: ×2)', w: 0.022, d: 0.012, print: 'OUT', printAt: 'above', led: '#ff9f1c', alt: `${D}.loop.double` });
  u.button(`${D}.loop.exit`, X(-0.272), -0.141, { label: 'Reloop / exit', ...small, print: 'RELOOP/EXIT', printAt: 'above', led: '#ff9f1c' });
  u.button(`${D}.call.prev`, X(-0.225), -0.141, { label: 'Cue/loop call ◀ (previous hot cue)', w: 0.012, d: 0.009, print: '◀', printAt: 'below', led: '#ffffff' });
  u.button(`${D}.call.next`, X(-0.209), -0.141, { label: 'Cue/loop call ▶ (next hot cue)', w: 0.012, d: 0.009, print: '▶', printAt: 'below', led: '#ffffff' });
  u.face.text(X(-0.217), -0.154, 'CUE/LOOP CALL', { size: 0.0025 });
  u.button(`${D}.delete`, X(-0.18), -0.141, { label: 'Delete (the hot cue just called)', w: 0.014, d: 0.009, print: 'DELETE', printAt: 'above', led: '#ffffff' });
  u.button(`${D}.memory`, X(-0.155), -0.141, { label: 'Memory (store a hot cue here)', w: 0.014, d: 0.009, print: 'MEMORY', printAt: 'above', led: '#ffffff' });
  // left column
  u.button(`${D}.slip`, X(-0.343), -0.094, { label: 'Slip', ...small, print: 'SLIP', printAt: 'above', led: '#b36bff' });
  u.button(`${D}.quantize`, X(-0.318), -0.094, { label: 'Quantize', ...small, print: 'QUANTIZE', printAt: 'above', led: '#ff3b5c' });
  u.button(`${D}.reverse`, X(-0.343), -0.06, { label: 'Direction: reverse', ...small, print: 'DIRECTION', printAt: 'above', led: '#ff3b5c', symbol: 'REV' });
  u.button(`${D}.track.prev`, X(-0.343), -0.018, { label: 'Track search ◀◀ (previous track in the list)', ...small, print: '◀◀', printAt: 'below', led: '#ffffff' });
  u.button(`${D}.track.next`, X(-0.318), -0.018, { label: 'Track search ▶▶ (next track in the list)', ...small, print: '▶▶', printAt: 'below', led: '#ffffff' });
  u.face.text(X(-0.33), -0.031, 'TRACK SEARCH', { size: 0.0025 });
  u.button(`${D}.search.back`, X(-0.343), 0.022, { label: 'Search back (hold)', ...small, print: '◀◀', printAt: 'below', led: '#ffffff' });
  u.button(`${D}.search.fwd`, X(-0.318), 0.022, { label: 'Search forward (hold)', ...small, print: '▶▶', printAt: 'below', led: '#ffffff' });
  u.face.text(X(-0.33), 0.009, 'SEARCH', { size: 0.0025 });
  u.button('shift', X(-0.336), 0.062, { label: 'Shift', ...small, print: 'SHIFT', printAt: 'below', led: '#ffffff' });
  // transport: the big rubber CUE and PLAY/PAUSE with their light rings
  u.button(`${D}.cue`, X(-0.336), 0.118, { label: 'Cue', shape: 'big', w: 0.031, led: f.cueColor, symbol: 'CUE' });
  u.button(`${D}.play`, X(-0.336), 0.18, { label: 'Play / Pause', shape: 'big', w: 0.031, led: f.playColor, symbol: 'PLAY' });
  // a 16 cm jog with its on-jog display
  u.jog(`${D}.jog`, X(-0.233), 0.022, 0.078, 'pro', deck);
  // right column: jog feel, jog mode, sync, tempo
  u.knob(`${D}.jogscale`, X(-0.168), -0.094, { label: 'Jog adjust (how far a turn moves)', print: 'JOG ADJUST', r: 0.0052, printAbove: true });
  u.knob(`${D}.motor.brake`, X(-0.131), -0.094, { label: 'Vinyl speed adjust (how fast it stops)', print: 'VINYL SPEED', r: 0.0052 });
  u.button(`${D}.vinyl`, X(-0.131), -0.06, { label: 'Jog mode: vinyl', ...small, print: 'JOG MODE', printAt: 'above', led: '#2ec4f1', symbol: 'VINYL' });
  u.button(`${D}.sync`, X(-0.131), -0.024, { label: 'Beat sync (shift: tempo master)', ...small, print: 'BEAT SYNC', printAt: 'above', alt: `${D}.master`, led: '#2ec4f1' });
  u.button(`${D}.range`, X(-0.131), 0.012, { label: 'Tempo range ±6 / 10 / 16 / wide', ...small, print: 'TEMPO ±', printAt: 'above', led: '#ffffff' });
  u.button(`${D}.keylock`, X(-0.131), 0.046, { label: 'Master tempo (key lock; shift: key sync)', ...small, print: 'MASTER TEMPO', printAt: 'above', led: '#ff5fcf', alt: `${D}.key.sync` });
  u.fader(`${D}.tempo`, X(-0.131), 0.133, 'z', 0.1, { label: 'Tempo', maxAtFar: false, size: 'tempo', center: true, labels: ['−', '+'], ticks: 16 });
  // pad modes and the eight pads
  const modes: [string, string, string | null, string][] = [
    ['hotcue', 'HOT CUE', null, '#ffffff'],
    ['roll', 'ROLL', 'pitch', '#ffffff'],
    ['slicer', 'SLICER', 'sampler', '#ffffff'],
    ['jump', 'BEAT JUMP', null, '#ffffff'],
  ];
  u.face.text(X(-0.23), 0.107, 'PAD MODE', { size: 0.0026, color: f.face.sub });
  modes.forEach(([m, label, alt, led], i) => {
    const x = X(-0.28 + i * 0.0333);
    u.button(`${D}.padmode.${m}`, x, 0.123, { label: alt ? `Pad mode: ${label.toLowerCase()} (shift: ${alt})` : `Pad mode: ${label.toLowerCase()}`, w: 0.026, d: 0.0075, led, alt: alt ? `${D}.padmode.${alt}` : null });
    u.face.text(x, 0.131, alt ? `${label}·${alt.toUpperCase()}` : label, { size: 0.0021 });
  });
  padGrid(u, deck, X(-0.23), 0.174, 0.028, 0.005);
}

function aioMixer(u: Unit): void {
  const f = u.finish;
  [-0.036, 0.036].forEach((x, i) => {
    const ch = i + 1;
    u.knob(`ch.${ch}.trim`, x, -0.102, { label: `Ch ${ch} trim`, print: 'TRIM', r: 0.0075 });
    u.knob(`ch.${ch}.hi`, x, -0.068, { label: `Ch ${ch} EQ high`, print: 'HI', r: 0.0082, center: true });
    u.knob(`ch.${ch}.mid`, x, -0.034, { label: `Ch ${ch} EQ mid`, print: 'MID', r: 0.0082, center: true });
    u.knob(`ch.${ch}.low`, x, 0.0, { label: `Ch ${ch} EQ low`, print: 'LOW', r: 0.0082, center: true });
    u.knob(`ch.${ch}.color`, x, 0.036, { label: `Ch ${ch} colour FX (filter or crush)`, print: 'COLOR', r: 0.0088, center: true, cap: '#3a6ea5' });
    u.button(`ch.${ch}.cue`, x, 0.066, { label: `Ch ${ch} headphone cue`, w: 0.016, d: 0.0095, print: 'CUE', printAt: 'below', led: '#ff9f1c' });
    u.fader(`ch.${ch}.fader`, x, 0.132, 'z', 0.05, { label: `Ch ${ch} fader` });
    u.face.text(x, 0.172, String(ch), { size: 0.0065, color: f.face.print });
  });
  // master level over the two 15-segment channel meters
  u.knob('mixer.master', 0, -0.102, { label: 'Master level', print: 'MASTER', r: 0.0078, cap: '#5b6270' });
  u.vu(1, -0.008, -0.032, 0.088, 15, false);
  u.vu(2, 0.008, -0.032, 0.088, 15, false);
  u.face.text(-0.008, -0.082, '1', { size: 0.0024, color: f.face.sub });
  u.face.text(0.008, -0.082, '2', { size: 0.0024, color: f.face.sub });
  u.knob('mixer.xcurve', 0, 0.132, { label: 'Crossfader curve', print: 'CURVE', r: 0.0052 });
  crossfader(u, 0, 0.205, 0.045);
  // left column: aux, sound colour FX, headphones
  const lx = -0.083;
  u.knob('aux.trim', lx, -0.07, { label: 'Aux trim (nothing plugged in)', print: 'AUX TRIM', r: 0.0058 });
  u.face.section(lx, 0.03, 0.054, 0.062, 'COLOR FX');
  u.button('colorfx.crush', lx - 0.012, 0.022, { label: 'Sound colour FX: crush', w: 0.017, d: 0.009, print: 'CRUSH', printAt: 'below', led: '#3ddc97' });
  u.button('colorfx.filter', lx + 0.012, 0.022, { label: 'Sound colour FX: filter', w: 0.017, d: 0.009, print: 'FILTER', printAt: 'below', led: '#3ddc97' });
  u.knob('colorfx.param', lx, 0.05, { label: 'Colour FX parameter (resonance)', print: 'PARAMETER', r: 0.0058, printAbove: false });
  u.face.section(lx, 0.14, 0.054, 0.084, 'HEADPHONES');
  u.knob('mixer.cuemix', lx, 0.128, { label: 'Headphone mixing (cue ⇄ master)', print: 'MIXING', r: 0.0062 });
  u.knob('mixer.phones', lx, 0.166, { label: 'Headphone level', print: 'LEVEL', r: 0.0062 });
  // right column: booth monitor and beat FX
  const rx = 0.082;
  u.knob('mixer.booth', rx, -0.088, { label: 'Booth monitor (the game has one output)', print: 'BOOTH MONITOR', r: 0.0062 });
  u.face.section(rx, 0.05, 0.058, 0.222, 'BEAT FX');
  u.button('fx.beat.down', rx - 0.012, -0.044, { label: 'Beat FX beat −', w: 0.013, d: 0.0085, print: '◀', printAt: 'below', led: '#ffffff' });
  u.button('fx.beat.up', rx + 0.012, -0.044, { label: 'Beat FX beat +', w: 0.013, d: 0.0085, print: '▶', printAt: 'below', led: '#ffffff' });
  u.face.text(rx, -0.055, 'BEAT', { size: 0.0024 });
  u.knob('fx.type', rx, -0.01, { label: 'Beat FX select (turn)', print: 'FX SELECT', r: 0.0088, encoder: true, printAbove: false });
  u.knob('fx.select', rx, 0.03, { label: 'Beat FX channel (1 / 2 / master)', print: 'CH SELECT', r: 0.006, encoder: true, printAbove: false });
  u.knob('fx.param', rx, 0.066, { label: 'Beat FX time / parameter', print: 'TIME', r: 0.0062, printAbove: false });
  u.knob('fx.depth', rx, 0.112, { label: 'Beat FX level / depth', print: 'LEVEL/DEPTH', r: 0.0088, cap: '#9c2a3f' });
  u.button('fx.on', rx, 0.152, { label: 'Beat FX on / off', shape: 'round', w: 0.019, print: 'ON/OFF', printAt: 'below', led: '#2ec4f1' });
  // the mic section, top left
  u.face.section(-0.258, -0.207, 0.19, 0.036, 'MIC');
  u.face.rect(-0.326, -0.205, 0.022, 0.008, { fill: '#050608', radius: 0.002 });
  u.face.text(-0.326, -0.195, 'OFF·ON·TALK OVER', { size: 0.0019 });
  u.knob('mic.low', -0.285, -0.205, { label: 'Mic EQ low (the game has no mic input)', print: 'LOW', r: 0.005, center: true, printAbove: false });
  u.knob('mic.hi', -0.26, -0.205, { label: 'Mic EQ high (the game has no mic input)', print: 'HI', r: 0.005, center: true, printAbove: false });
  u.knob('mic.1.level', -0.225, -0.205, { label: 'Mic 1 level (the game has no mic input)', print: 'MIC 1', r: 0.0055, printAbove: false });
  u.knob('mic.2.level', -0.195, -0.205, { label: 'Mic 2 level (the game has no mic input)', print: 'MIC 2', r: 0.0055, printAbove: false });
  // the USB slots and master record, top right
  for (const [x, n] of [[0.262, 1], [0.3, 2]] as const) {
    u.face.rect(x, -0.212, 0.022, 0.009, { fill: '#030405', radius: 0.0015, stroke: f.face.sub, line: 0.0003 });
    u.face.text(x, -0.224, `USB ${n}`, { size: 0.0024 });
  }
  u.button('rec.toggle', 0.34, -0.212, { label: 'Master record', w: 0.016, d: 0.009, print: 'MASTER/REC', printAt: 'below', led: '#ff2e2e' });
  // tonight's set, plugged in
  const stick = new THREE.Mesh(new RoundedBoxGeometry(0.0125, 0.032, 0.0052, 2, 0.0015), new THREE.MeshStandardMaterial({ color: '#ff2e88', roughness: 0.35, metalness: 0.2 }));
  stick.position.set(0.262, u.h + 0.016, -0.212);
  stick.castShadow = true;
  u.group.add(stick);
}

/** a tilted panel standing on the faceplate: its face is local y = 0, running back from its bottom edge (z = 0) to z = −len */
function tiltedPanel(u: Unit, x: number, z0: number, w: number, len: number, tilt: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, u.h + 0.004, z0);
  g.rotation.x = tilt;
  u.group.add(g);
  const thick = 0.016;
  const slab = new THREE.Mesh(new RoundedBoxGeometry(w, thick, len, 3, 0.004), mat);
  slab.position.set(0, -thick / 2, -len / 2);
  slab.castShadow = true;
  g.add(slab);
  // the stand under it: from the faceplate up to the slab's back
  const c = Math.cos(tilt);
  const t = Math.tan(tilt);
  const under = (back: number) => 0.004 + back * t - thick / c;
  const zb = len * c - 0.018;
  const shape = new THREE.Shape([new THREE.Vector2(0.012, 0), new THREE.Vector2(zb, 0), new THREE.Vector2(zb, under(zb)), new THREE.Vector2(0.012, Math.max(0.001, under(0.012)))]);
  const stand = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w * 0.7, bevelEnabled: false }), mat);
  stand.rotation.y = Math.PI / 2;
  stand.position.set(x - w * 0.35, u.h, z0);
  u.group.add(stand);
  return g;
}

function aioScreen(b: BoardBuild, u: Unit): void {
  const tilt = 1.13; // about 65° up from the faceplate, facing you
  const z0 = -0.128;
  const housing = new THREE.MeshStandardMaterial({ color: '#0e0f12', roughness: 0.42, metalness: 0.35 });
  // the 10.1-inch panel: 217 × 136 mm of 16:10 picture in a black glass front
  const W = 0.217;
  const H = 0.136;
  const bez = 0.011;
  const len = H + bez * 2 + 0.008;
  const panel = tiltedPanel(u, 0, z0, W + bez * 2, len, tilt, housing);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W + bez * 2 - 0.003, len - 0.003), new THREE.MeshStandardMaterial({ color: '#040405', roughness: 0.06, metalness: 0.3 }));
  front.rotation.x = -Math.PI / 2;
  front.position.set(0, 0.0004, -len / 2);
  panel.add(front);
  const screen = new TouchScreenPart(W, H);
  screen.object.position.set(0, 0.0009, -(bez + 0.008) - H / 2);
  panel.add(screen.object);
  b.register(screen);
  // beside it: BACK, TAG, the browse encoder and LOAD 1 / 2
  const sw = 0.066;
  const slen = 0.12;
  const side = tiltedPanel(u, (W + bez * 2) / 2 + 0.005 + sw / 2, z0, sw, slen, tilt, housing);
  const put = (p: { object: THREE.Object3D }, x: number, z: number) => {
    side.add(p.object);
    p.object.position.set(x, 0, z);
  };
  put(u.button('screen.back', 0, 0, { label: 'Back (screen)', w: 0.018, d: 0.0095, led: '#ffffff' }), -0.016, -0.104);
  put(u.button('browse.tag', 0, 0, { label: 'Tag track / remove (favourite)', w: 0.018, d: 0.0095, led: '#ffd23f' }), 0.016, -0.104);
  put(u.knob('browse', 0, 0, { label: 'Browse: turn to move through the list, push to open it / load', r: 0.0135, h: 0.013, encoder: true }), 0, -0.07);
  put(u.button('deck.1.load', 0, 0, { label: 'Load the selected track to deck 1', w: 0.022, d: 0.011, led: '#ffffff' }), -0.016, -0.026);
  put(u.button('deck.2.load', 0, 0, { label: 'Load the selected track to deck 2', w: 0.022, d: 0.011, led: '#ffffff' }), 0.016, -0.026);
  // the side panel's print
  const c = document.createElement('canvas');
  c.width = 264;
  c.height = 480;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0e0f12';
  g.fillRect(0, 0, c.width, c.height);
  const px = (x: number) => (x / sw + 0.5) * c.width;
  const py = (z: number) => (1 + z / slen) * c.height;
  g.fillStyle = '#d9dde4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = (s: string, x: number, z: number, size = 17) => {
    g.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.fillText(s, px(x), py(z));
  };
  label('BACK', -0.016, -0.115);
  label('TAG TRACK', 0.016, -0.115);
  label('BROWSE · PUSH', 0, -0.05, 16);
  label('LOAD', 0, -0.04, 18);
  label('1', -0.016, -0.015, 20);
  label('2', 0.016, -0.015, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const print = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.003, slen - 0.003), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.2 }));
  print.rotation.x = -Math.PI / 2;
  print.position.set(0, 0.0003, -slen / 2);
  side.add(print);
}

const aio: BoardDef = {
  id: 'aio2',
  name: 'All-in-One Two',
  category: 'All-in-one',
  description: 'Two decks and a touch screen that browses your library.',
  decks: 2,
  turntable: false,
  fixedDecks: true,
  xcurve: 0.35,
  finishes: [
    finish({ id: 'black', name: 'Booth black', swatch: '#141518', body: '#101113', bodyMetal: 0.55, bodyRough: 0.42, face: face('#17181b', '#e6e9ee', '#5f6672', '#ffffff', 'brushed'), accent: '#ff5a36', knobCap: '#2a2d33', cueColor: '#ff9f1c', playColor: '#3ddc97' }),
    finish({ id: 'white', name: 'Limited white', swatch: '#e9eaec', body: '#d6d8db', bodyMetal: 0.2, bodyRough: 0.45, face: face('#eceef0', '#16181c', '#7c838e', '#16181c', 'matte'), accent: '#2ec4f1', knobCap: '#f1f2f4', cueColor: '#ff9f1c', playColor: '#3ddc97' }),
  ],
  build(b) {
    const u = b.unit(0, 0, 0.728, 0.47, 0.07, { radius: 0.014 });
    aioMixer(u);
    aioDeck(u, 1, 0);
    aioDeck(u, 2, 0.468);
    aioScreen(b, u);
  },
};

export const BOARDS: BoardDef[] = [starter, aio, pro, club, vinyl, quad, hybrid, rotary];

export function boardById(id: string): BoardDef {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0];
}

export function buildBoard(def: BoardDef, finishId: string, o: { stickers?: boolean } = {}): BoardBuild {
  const f = def.finishes.find((x) => x.id === finishId) ?? def.finishes[0];
  const b = new BoardBuild(f);
  def.build(b);
  if (o.stickers !== false) applyStickers(b, `${def.id}:${f.id}`);
  b.finishAll();
  return b;
}

/** is deck `id` a turntable on this board? */
export function isTurntable(def: BoardDef, id: number): boolean {
  return def.turntable === true || (Array.isArray(def.turntable) && def.turntable.includes(id));
}
