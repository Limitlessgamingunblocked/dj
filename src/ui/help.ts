/* Help screen: the basics in short lines, then every shortcut. */
import { h } from './dom';
import { openModal } from './modal';
import { shortcutsTable } from './keysTable';
import { openAirDjGuide } from './AirDjIntro';

const SECTIONS: [string, string[]][] = [
  [
    'Mix',
    [
      'Load a track on each deck and press Play.',
      'Sync locks the other deck to the master tempo.',
      'Faders, EQ, filter and crossfader are on the 3D board and in Mixer & FX.',
      'Turn an EQ knob fully left to kill that band.',
    ],
  ],
  [
    'Your music',
    [
      'Import music in the Library, or drop audio files anywhere.',
      'Import a playlist from rekordbox, Traktor, Apple Music or a CSV: it becomes a crate.',
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
      'The crowd shouts for tracks from your library: press Load on their card and play it for points.',
      'Paste an OmniRoute or FreeLLMAPI key in Settings → AI crowd and an AI writes who asks and what they shout.',
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
    'Air DJ',
    [
      'Play with your hands in front of the webcam: ⋯ menu → Air DJ, or Shift+H.',
      'Pinch to scratch, open palm for the filter, peace sign for beat FX, point for the crossfader.',
      'Both palms up high and the crowd copies you. A fist rests.',
    ],
  ],
  [
    'Lyrics & karaoke',
    [
      'The AI hears the lyrics of any song with vocals and times every word: a deck’s ⋯ menu → Hear the lyrics with AI.',
      'The line being sung shows over the stage, each word filling with colour as it’s sung, for both decks in a blend. Shift+K hides or shows it.',
      'Have the words already? Paste them in the lyrics editor and press Time with AI.',
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

export function openHelp(guides: { aiLyrics?: () => void } = {}): void {
  openModal(
    'Help',
    h(
      'div',
      { class: 'help' },
      h(
        'div',
        { class: 'help-grid' },
        ...SECTIONS.map(([t, lines]) =>
          h('section', {}, h('h3', {}, t), h('ul', {}, ...lines.map((l) => h('li', {}, l))), t === 'Air DJ' && h('button', { type: 'button', class: 'btn small help-more', onclick: () => openAirDjGuide() }, 'The Air DJ guide'), t === 'Lyrics & karaoke' && guides.aiLyrics && h('button', { type: 'button', class: 'btn small help-more', onclick: guides.aiLyrics }, 'The AI lyrics guide')),
        ),
      ),
      h('h3', { class: 'help-keys label' }, 'Keyboard'),
      shortcutsTable(),
    ),
  );
}
