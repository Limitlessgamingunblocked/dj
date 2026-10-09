/*
 * Starter templates (Section 13.12): 2-deck Club, 4-deck Pro,
 * Battle/Scratch, Minimalist, Festival Rig and "Absolute Chaos", plus the
 * Randomize button that builds something completely wild.
 * Positions are metres on the table top (x across, z towards you, y up).
 */
import { defOf } from './catalog';
import { commonDefaults, emptyBoard, type BoardComponent, type BoardFile, type CommonProps, type Vec3 } from './format';
import { MATERIAL_IDS } from './materials';
import { STICKER_DESIGNS } from './decor';

let seq = 0;
/** a fresh component id */
export function newId(prefix = 'c'): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36).slice(-5)}${seq.toString(36)}`;
}

/** a component of `type`, with its defaults and any settings given */
export function make(type: string, pos: Vec3, props: Partial<CommonProps> & Record<string, unknown> = {}, rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): BoardComponent {
  const def = defOf(type);
  return { id: newId(), type, pos, rot, scale, props: { ...commonDefaults(), ...(def?.defaults() ?? {}), ...props } as CommonProps, children: [] };
}

/* ------------------------------ the templates ------------------------------ */

function deckSide(deck: number, x: number, color: string, turntable = false): BoardComponent[] {
  const out: BoardComponent[] = [];
  if (turntable) out.push(make('turntable', [x, 0.03, -0.02], { deck, colors: ['#9aa0a8', '#1a1b1e', color] }));
  else {
    out.push(make('panel', [x, 0, 0], { w: 0.34, d: 0.36, h: 0.03, colors: ['#17191d', '#e8ebf0', color] }));
    out.push(make('jog', [x, 0.03, -0.02], { deck, size: 0.075, platter: 'vinyl', display: 'art', colors: ['#202227', '#3a3d45', color] }));
    out.push(make('transport', [x - 0.12, 0.03, 0.08], { deck }));
    out.push(make('pads', [x + 0.03, 0.03, 0.13], { rows: 1, cols: 4, size: 0.02, base: `deck.${deck}.hotcue.{n}`, colors: ['#15171b', '#2a2d34', color] }));
    out.push(make('screen', [x, 0.03, -0.16], { kind: 'track', deck, w: 0.14, d: 0.05 }));
  }
  return out;
}

function club2(): BoardComponent[] {
  return [
    ...deckSide(1, -0.42, '#2ec4f1'),
    make('mixer', [0, 0, 0], { channels: 2, bands: 3, kills: false }),
    ...deckSide(2, 0.42, '#ff2e88'),
    make('meter', [0, 0.03, -0.16], { kind: 'led', length: 0.05 }),
  ];
}

function pro4(): BoardComponent[] {
  return [
    ...deckSide(1, -0.78, '#2ec4f1'),
    ...deckSide(3, -0.42, '#b6ff3b'),
    make('mixer', [0, 0, 0], { channels: 4, bands: 3, kills: true }),
    ...deckSide(2, 0.42, '#ff2e88'),
    ...deckSide(4, 0.78, '#ffb547'),
    make('fx', [0, 0.03, -0.2], { slots: ['echo', 'reverb', 'flanger', 'phaser', 'roll', 'filter'] }),
    make('meter', [0.12, 0.03, -0.18], { kind: 'spectrum', length: 0.08 }),
  ];
}

/** life size, like a club booth: two media players either side of a 4-channel mixer, headphones, a USB stick */
function clubReal(): BoardComponent[] {
  return [
    make('media_player', [-0.37, 0, 0], { deck: 1 }),
    make('club_mixer', [0, 0, 0]),
    make('media_player', [0.37, 0, 0], { deck: 2 }),
    make('usb_stick', [-0.49, 0.106, -0.205], {}, [0, 0.2, 0]),
    make('headphones', [-0.66, 0, 0.12], {}, [0, 0.5, 0]),
    make('gaffer_tape', [0, 0.106, 0.205], { w: 0.16 }),
  ];
}

/** life size, a vinyl booth: two direct-drive turntables either side of a rotary mixer */
function vinylReal(): BoardComponent[] {
  return [
    make('dd_turntable', [-0.42, 0, 0], { deck: 1 }),
    make('rotary_mixer', [0, 0, 0]),
    make('dd_turntable', [0.42, 0, 0], { deck: 2 }),
    make('headphones', [0.76, 0, 0.1], {}, [0, -0.5, 0]),
    make('setlist', [-0.76, 0, 0.05], {}, [0, 0.15, 0]),
  ];
}

function battle(): BoardComponent[] {
  return [
    make('turntable', [-0.4, 0, 0], { deck: 1 }, [0, Math.PI / 2, 0]),
    make('mixer', [0, 0, 0.02], { channels: 2, bands: 2, kills: true, xfader: true, material: 'brushed', colors: ['#2b2e33', '#e8ebf0', '#ff3b3b'] }),
    make('turntable', [0.4, 0, 0], { deck: 2 }, [0, -Math.PI / 2, 0]),
    make('scratch_tower', [0, 0, -0.32], { deck: 1 }),
    make('sticker', [-0.12, 0.031, 0.14], { design: 'vinyl', size: 0.035 }),
  ];
}

function minimal(): BoardComponent[] {
  return [
    make('panel', [0, 0, 0], { w: 0.7, d: 0.32, h: 0.02, material: 'oak', colors: ['#ffffff', '#1b1d22', '#ffb547'] }),
    make('jog', [-0.22, 0.02, 0], { deck: 1, size: 0.06, platter: 'metal', display: 'none', colors: ['#d8d8d8', '#bbbbbb', '#ffb547'] }),
    make('jog', [0.22, 0.02, 0], { deck: 2, size: 0.06, platter: 'metal', display: 'none', colors: ['#d8d8d8', '#bbbbbb', '#ffb547'] }),
    make('fader', [-0.03, 0.02, 0.02], { fn: 'ch.1.fader', length: 0.07 }),
    make('fader', [0.03, 0.02, 0.02], { fn: 'ch.2.fader', length: 0.07 }),
    make('knob', [-0.03, 0.02, -0.08], { fn: 'ch.1.filter', size: 0.012, shape: 'pointer' }),
    make('knob', [0.03, 0.02, -0.08], { fn: 'ch.2.filter', size: 0.012, shape: 'pointer' }),
    make('button', [-0.22, 0.02, 0.12], { fn: 'deck.1.play', shape: 'round', w: 0.02 }),
    make('button', [0.22, 0.02, 0.12], { fn: 'deck.2.play', shape: 'round', w: 0.02 }),
    make('engraving', [0, 0.021, 0.13], { w: 0.14, finish: 'engraved' }),
  ];
}

function festival(): BoardComponent[] {
  return [
    ...pro4(),
    make('light_desk', [-0.95, 0.0, 0.1]),
    make('pyro_panel', [0.95, 0.0, 0.1]),
    make('laser_ctl', [-0.95, 0.0, -0.12]),
    make('cam_switcher', [0.95, 0.0, -0.12]),
    make('drop_button', [0, 0.03, 0.24], { size: 0.06 }),
    make('engraving', [0, 0.031, -0.26], { w: 0.3, finish: 'led' }),
  ];
}

function chaos(): BoardComponent[] {
  return [
    ...club2(),
    make('theremin', [-0.85, 0, 0]),
    make('globe', [0.85, 0, -0.05]),
    make('xy', [0.85, 0, 0.14]),
    make('sequencer', [0, 0.03, 0.25]),
    make('ball_pit', [-0.85, 0, 0.22]),
    make('pendulum', [0.62, 0, -0.25]),
    make('fire_fader', [-0.62, 0.03, -0.22]),
    make('hype_dial', [0.6, 0.03, 0.22]),
    make('horn', [-0.6, 0.03, 0.24]),
    make('vocal_keys', [0, 0.03, -0.28]),
    make('drop_button', [1.05, 0, 0.1]),
    make('lava_lamp', [-1.05, 0, -0.2]),
    make('disco_ball', [1.05, 0, -0.25]),
    make('cat', [0.08, 0.03, -0.1]),
    make('bobblehead', [-0.3, 0.03, -0.2]),
    make('dancers', [0, 0.0, 0.38], { count: 10 }),
    make('plant', [-1.0, 0, 0.35]),
  ];
}

export const TEMPLATES: { id: string; name: string; blurb: string; build(): BoardComponent[] }[] = [
  { id: 'club_real', name: 'Club booth (life size)', blurb: 'Two media players and a 4-channel club mixer, as in any club booth.', build: clubReal },
  { id: 'vinyl_real', name: 'Vinyl booth (life size)', blurb: 'Two direct-drive turntables and a rotary mixer.', build: vinylReal },
  { id: 'club2', name: '2-deck Club', blurb: 'Two decks either side of a 2-channel mixer.', build: club2 },
  { id: 'pro4', name: '4-deck Pro', blurb: 'Four decks, a 4-channel mixer with kills, an FX unit.', build: pro4 },
  { id: 'battle', name: 'Battle / Scratch', blurb: 'Turntables turned sideways, a 2-channel battle mixer and a scratch tower.', build: battle },
  { id: 'minimal', name: 'Minimalist', blurb: 'Oak, two jogs, two faders, two filters. Nothing else.', build: minimal },
  { id: 'festival', name: 'Festival Rig', blurb: 'Four decks plus lights, pyro, lasers, cameras and the big red button.', build: festival },
  { id: 'chaos', name: 'Absolute Chaos', blurb: 'Everything at once.', build: chaos },
];

export function fromTemplate(templateId: string, id: string, name?: string): BoardFile {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0];
  const b = emptyBoard(id, name ?? t.name);
  b.components = t.build();
  if (templateId === 'festival' || templateId === 'chaos') b.booth = { ...b.booth, width: 2.6, front: 'led', monitors: 'stack', glassFloor: templateId === 'chaos', sideScreens: true };
  if (templateId === 'club_real' || templateId === 'vinyl_real') b.booth = { ...b.booth, width: templateId === 'vinyl_real' ? 1.9 : 1.75, depth: 0.8 };
  if (templateId === 'minimal') b.booth = { ...b.booth, material: 'oak', color: '#ffffff', front: 'wood', monitors: 'small' };
  return b;
}

/* ------------------------------ randomize ------------------------------ */

const PALETTES = [
  ['#ff2e88', '#3ad7ff', '#b6ff3b'],
  ['#ffb547', '#ff5a1a', '#fff1c1'],
  ['#c9b6ff', '#7affc0', '#ff8fd1'],
  ['#e0243c', '#f2f2f2', '#111111'],
  ['#00e5ff', '#1a1aff', '#ff00e6'],
];

/** a completely wild board: random parts, materials, colours and shapes, scattered over a random table */
export function randomBoard(id: string, rand: () => number = Math.random): BoardFile {
  const b = emptyBoard(id, 'Wild one');
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const pal = pick(PALETTES);
  const shape = pick(['rect', 'round', 'L', 'ring', 'curve', 'tier', 'hex']);
  const W = 0.8 + rand() * 1.4;
  b.components.push(make('panel', [0, 0, 0], { shape, w: W, d: 0.45 + rand() * 0.25, h: 0.03 + rand() * 0.04, material: pick(MATERIAL_IDS.filter((m) => m !== 'image')), colors: ['#15161a', pal[1], pal[0]], glow: { color: pal[0], intensity: rand() * 0.5, beat: rand() > 0.5 } }));
  const decks = rand() > 0.5 ? 4 : 2;
  for (let d = 1; d <= decks; d++) {
    const x = (d - (decks + 1) / 2) * (W / (decks + 1));
    b.components.push(make('jog', [x, 0.05, -0.05], { deck: d, size: 0.05 + rand() * 0.06, platter: pick(['vinyl', 'metal', 'led', 'glass', 'liquid', 'holo']), display: pick(['art', 'wave', 'name']), colors: ['#18191d', pick(pal), pick(pal)] }));
    b.components.push(make('transport', [x, 0.05, 0.14], { deck: d }));
  }
  b.components.push(make('mixer', [0, 0.05, 0.02], { channels: decks, bands: pick([2, 3, 4]), kills: rand() > 0.5, material: pick(['brushed', 'carbon', 'gloss', 'galaxy', 'chrome']), colors: ['#1a1b1f', '#e8ebf0', pick(pal)] }));
  const wild = ['theremin', 'ribbon', 'xy', 'globe', 'crowd_fader', 'drop_button', 'tape_stop', 'rewind', 'horn', 'vocal_keys', 'sequencer', 'ball_pit', 'pendulum', 'fire_fader', 'hype_dial', 'light_desk', 'pyro_panel', 'laser_ctl', 'cam_switcher'];
  const decor = ['bobblehead', 'lava_lamp', 'disco_ball', 'plant', 'speaker_stack', 'cocktail', 'cat', 'gears', 'dancers', 'mini_crowd'];
  const n = 4 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    b.components.push(make(pick(wild), [side * (W / 2 + 0.1 + rand() * 0.2), rand() > 0.7 ? 0.15 + rand() * 0.2 : 0, (rand() - 0.5) * 0.5], { colors: ['#15171b', pick(pal), pick(pal)] }, [0, (rand() - 0.5) * 0.6, 0]));
  }
  for (let i = 0; i < 3 + Math.floor(rand() * 4); i++) b.components.push(make(pick(decor), [(rand() - 0.5) * W * 0.9, 0.05, -0.25 + rand() * 0.1], { colors: [pick(pal), pick(pal), pick(pal)] }));
  for (let i = 0; i < 3; i++) b.components.push(make('sticker', [(rand() - 0.5) * W * 0.8, 0.051, 0.2 + rand() * 0.05], { design: pick(STICKER_DESIGNS), size: 0.03 + rand() * 0.03, colors: ['#15171b', pick(pal), '#111111'] }, [0, rand() * 6, 0]));
  b.components.push(make('engraving', [0, 0.051, -0.2], { w: 0.2, finish: pick(['neon', 'led', 'embossed']) }));
  b.booth = { ...b.booth, front: pick(['name', 'led', 'mirror', 'mesh']), monitors: pick(['small', 'large', 'stack']), cables: pick(['hidden', 'colored', 'coiled']), cableColor: pick(pal), glassFloor: rand() > 0.6, sideScreens: rand() > 0.5, width: Math.max(1.4, W + 0.6) };
  return b;
}
