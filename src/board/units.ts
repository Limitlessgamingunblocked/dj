/*
 * Life-size pro units for the Board Builder: the same media player, club
 * mixer, direct-drive turntable and rotary mixer the preset rigs are made of,
 * every control live, with their printed faceplates (section outlines, knob
 * scales, fader scales, labels). Their finish comes from the part's colours
 * and material. Proportions follow the real gear:
 *   media player   32 × 43 cm, 9-inch screen, 8 hot cues, a 20 cm jog with a
 *                  screen in the centre, a long tempo fader
 *   club mixer     4 channels, trim / 3-band EQ / colour filter, 15-segment
 *                  meters, channel faders, crossfader, beat FX, master section
 *   turntable      45 × 35 cm, 33 cm die-cast platter with strobe dots, an
 *                  S-shaped 23 cm tonearm, start/stop, 33/45, a ±8/16 % pitch fader
 *   rotary mixer   big rotary channel levels, gain, isolator-style EQ, filter,
 *                  12-segment meters, wood cheeks
 */
import * as THREE from 'three';
import { BoardBuild, finish, type Finish } from '../three/builder';
import { clubMixer, player, rotaryMixer, turntable } from '../three/boards';
import type { Built, CompDef } from './catalog';
import type { BoardComponent } from './format';
import type { BoardEnv } from './parts';

const DECKS = [1, 2, 3, 4].map((n) => ({ id: n, label: `Deck ${n}` }));

/** a unit's finish from the part's colours: body, print, light colour; brushed, gloss or matte from its material */
export function finishFor(c: BoardComponent): Finish {
  const p = c.props;
  const [body, print, accent] = p.colors;
  const texture = ['brushed', 'chrome', 'gold', 'carbon'].includes(p.material) ? 'brushed' : ['gloss', 'acrylic', 'frosted'].includes(p.material) ? 'gloss' : 'matte';
  const face = new THREE.Color(body).lerp(new THREE.Color('#ffffff'), 0.035).getStyle();
  const hex = '#' + new THREE.Color(face).getHexString();
  const sub = '#' + new THREE.Color(print).lerp(new THREE.Color(hex), 0.5).getHexString();
  return finish({
    id: 'custom',
    name: 'As built',
    swatch: accent,
    body,
    bodyMetal: texture === 'brushed' ? 0.55 : 0.2,
    bodyRough: texture === 'gloss' ? 0.3 : 0.5,
    face: { base: hex, print, sub, accent: print, texture },
    accent,
    knobCap: null,
  });
}

/** build with the preset rigs' own unit builders, then hand back their parts */
function presetUnit(c: BoardComponent, make: (b: BoardBuild) => void): Built {
  const b = new BoardBuild(finishFor(c));
  make(b);
  b.finishAll();
  return { object: b.root, parts: [...b.parts] };
}

const deckOf = (c: BoardComponent) => Math.max(1, Math.min(4, Number(c.props.deck) || 1));
const BOOTH = ['#16181c', '#e8ebf0', '#2ec4f1'];

export const PRO_UNITS: CompDef[] = [
  {
    type: 'media_player',
    category: 'decks',
    label: 'Club media player',
    blurb: 'Life size, like the booth standard: a 9-inch waveform screen, 8 hot cues, a 20 cm jog with a screen in the middle, loops, beat jump and a long tempo fader.',
    icon: '💽',
    defaults: () => ({ deck: 1, material: 'brushed', colors: [...BOOTH] }),
    options: [{ key: 'deck', label: 'Deck', kind: 'select', choices: DECKS }],
    cost: 42,
    build: (c: BoardComponent, env: BoardEnv) => {
      void env;
      return presetUnit(c, (b) => player(b, deckOf(c), 0));
    },
  },
  {
    type: 'club_mixer',
    category: 'mixer',
    label: 'Club mixer (4-channel)',
    blurb: 'Life size, like the booth standard: trim, 3-band EQ and colour filter on four channels, 15-segment meters, channel faders, crossfader, beat FX and the master section.',
    icon: '🎛',
    defaults: () => ({ material: 'brushed', colors: [...BOOTH] }),
    cost: 60,
    build: (c: BoardComponent) => presetUnit(c, (b) => clubMixer(b)),
  },
  {
    type: 'dd_turntable',
    category: 'decks',
    label: 'Direct-drive turntable',
    blurb: 'Life size: a 33 cm die-cast platter with strobe dots, a record you can scratch, an S-shaped tonearm you drop on it, start/stop, 33/45 and a long pitch fader.',
    icon: '💿',
    defaults: () => ({ deck: 1, material: 'brushed', colors: ['#2a2d33', '#e8ebf0', '#ff3b3b'] }),
    options: [{ key: 'deck', label: 'Deck', kind: 'select', choices: DECKS }],
    cost: 30,
    build: (c: BoardComponent) => presetUnit(c, (b) => turntable(b, deckOf(c), 0)),
  },
  {
    type: 'rotary_mixer',
    category: 'mixer',
    label: 'Rotary mixer',
    blurb: 'Big rotary level knobs instead of faders, gain, 3-band EQ and filter per channel, 12-segment meters, a send FX, walnut cheeks.',
    icon: '🎚',
    defaults: () => ({ material: 'brushed', colors: ['#c9ccd2', '#15171b', '#ff9f1c'] }),
    cost: 34,
    build: (c: BoardComponent) => presetUnit(c, (b) => rotaryMixer(b)),
  },
];
