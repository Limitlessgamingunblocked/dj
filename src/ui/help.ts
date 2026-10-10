/* Help screen: the basics in short lines, then every shortcut. */
import { h } from './dom';
import { openModal } from './modal';
import { shortcutsTable } from './keysTable';

const SECTIONS: [string, string[]][] = [
  [
    'Mix',
    [
      'Two tracks are already on the decks. Press Play.',
      'Sync locks the other deck to the master tempo.',
      'Faders, EQ, filter and crossfader are on the 3D board and in Mixer & FX.',
      'Turn an EQ knob fully left to kill that band.',
    ],
  ],
  [
    'Your music',
    [
      'Import music in the Library, or drop audio files anywhere.',
      'Drag a track onto a deck, double-click it, or use its deck numbers.',
    ],
  ],
  [
    'The board',
    [
      'Everything on the 3D board works: drag knobs and faders, spin the jogs.',
      'Rest the pointer on a section and the camera zooms in.',
      'Shift+B puts the board full screen. Esc brings the rest back.',
    ],
  ],
  [
    'Pro layout',
    [
      'Switch to Pro in the top bar for pads, loops, key and stems.',
      'Hold Shift for each control’s second function.',
      'Vinyl mode: grab the top of a jog to scratch.',
    ],
  ],
  [
    'Gigs',
    [
      'Play a gig picks a booking or a free set.',
      'Clean mixes and the right energy raise the vibe; trainwrecks drop it.',
      'Home has your bookings, wardrobe, crates, sets and phone.',
    ],
  ],
  [
    'Show',
    [
      'The lights follow the beat by themselves.',
      'Fire strobes, lasers, CO2 and pyro by hand from the Show tab.',
      'The camera menu on the stage has every angle, lenses and the auto director.',
    ],
  ],
  [
    'More',
    [
      'Auto DJ (Shift+A) mixes by itself until you touch a control.',
      'The Set Builder orders a set in key and exports it to rekordbox, Traktor or Serato.',
      'Rec records your mix. Settings has colours, deck defaults and every shortcut.',
    ],
  ],
];

export function openHelp(): void {
  openModal(
    'Help',
    h(
      'div',
      { class: 'help' },
      h('div', { class: 'help-grid' }, ...SECTIONS.map(([t, lines]) => h('section', {}, h('h3', {}, t), h('ul', {}, ...lines.map((l) => h('li', {}, l)))))),
      h('h3', { class: 'help-keys label' }, 'Keyboard'),
      shortcutsTable(),
    ),
  );
}
