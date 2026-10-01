/* Help screen: quick start and shortcuts. */
import { h } from './dom';
import { openModal } from './modal';
import { shortcutsTable } from './SetupPanel';

export function openHelp(): void {
  const steps: [string, string][] = [
    ['Layout', 'Simple shows what you need to mix: play, cue, sync, tempo and the library (EQ, filter and faders are on the 3D board and in Mixer & FX). Switch to Pro in the top bar for pads, loops, key and stems on the deck panels.'],
    ['Load', 'Two demo tracks are already on the decks. Import your own music with “Import music” in the library, or drop audio files anywhere. Drag a track onto a deck, or use its 1/2/3/4 buttons.'],
    ['Play & cue', 'Press PLAY. CUE returns to the cue point; while paused, CUE sets a new cue point and holding it previews.'],
    ['Beatmatch', 'Press SYNC on the incoming deck to lock its tempo and phase to the MASTER deck, or ride the tempo fader and nudge the jog edge by ear. The waveform strip shows both grids and the phase offset in milliseconds.'],
    ['Mix', 'Use the channel faders, 3-band EQ (turn fully left to kill a band), filter knob and crossfader. Everything on the 3D board works: drag knobs up/down, drag faders, spin jogs.'],
    ['Zoom', 'Rest the pointer on the left deck, the mixer or the right deck and the camera zooms in so the controls are big and easy to grab. Move off the board to zoom back out. On a touch screen, tap an empty spot of that section. Turn it off in the camera menu on the stage.'],
    ['Perform', 'In the Pro layout, pads switch between hot cues, loop rolls, slicer, beat jump, pitch play and the sampler. Hold SHIFT (or Shift on the keyboard) for the second layer. Add Beat FX from the Mixer & FX tab or the board.'],
    ['Scratch', 'With VINYL on, grab the top of a jog wheel or the record on the turntables and move it. The platter edge nudges instead. Turntables have real start/brake inertia.'],
    ['More per deck', 'In the Pro layout, open “Loops, key & stems” under the pads for loops, beat jump, key lock and key shift, slip, and turning vocals, drums, bass or melody up and down.'],
    ['Build a set', 'The Set Builder tab (SmartDJ) orders tracks from your library around anchor artists, labels or genres, following an energy arc with key- and tempo-matched transitions. It shows where and how to mix each track, loads the set onto the decks one track at a time, and exports to rekordbox, Traktor, Serato (M3U) or a streaming track list. The ≈ buttons build sets in the style of Chris Stussy, OMAR+, Prospa or Cloonee — “All four → journey” travels through all of them.'],
    ['Venue', 'Pick where you play with 📍 in the top bar: Circoloco @ DC-10 in Ibiza, Boiler Room in LA, Berghain, Printworks or the Deckhouse warehouse. The camera menu has each venue’s signature angle (try “Stream cam” at Boiler Room), a view from the crowd and Drone FPV, which loops through the room over the crowd, past the pyro and the booth.'],
    ['Lights', 'The light show follows the beat grid by itself — moving heads, lasers, strobes, blinders and CO2 hit harder in build-ups and go off on the drop. Drops also fire the pyro (flame jets or cold sparks). Fire them by hand from the Show tab or hold N (strobe), B (blinders), Y (lasers), ` (blackout), press T for CO2 and Shift+T for pyro.'],
    ['Crowd', 'The crowd meter rises with the music, clean beat-locked blends and drops, and drops with trainwrecks and key clashes. The dancers bounce on the kick, clap through build-ups, throw their arms up on drops and hooks, film on their phones and hold up signs; VIP guests hang out by the booth.'],
    ['Lyrics', 'Tracks with lyrics (from the file’s tags, a matching .lrc/.txt file, pasted text or an LRCLIB lookup) show them word by word on the LED walls as kinetic type. The 🎤 button on a deck (Pro layout) or the deck’s ⋯ menu opens the lyrics editor: align plain text to the vocals, tap-sync lines, nudge the offset. Hook lines fire strobes and haze. Styles are in the Show tab.'],
    ['Visuals', 'Ten visual modes follow the music on the venue screens. Pick “Booth + visual player inset” or “Visual player only” from the ⋯ menu in the top bar (or press V) for the full visual player.'],
    ['Record', 'Press REC to capture your mix; press it again to play back or save the file.'],
  ];
  openModal(
    'Getting started',
    h(
      'div',
      { style: { display: 'grid', gap: '14px' } },
      h('ol', { style: { margin: '0', paddingLeft: '20px', display: 'grid', gap: '8px', maxWidth: '75ch' } }, ...steps.map(([t, d]) => h('li', {}, h('b', {}, `${t}. `), d))),
      h('h3', { class: 'label' }, 'Keyboard'),
      shortcutsTable(),
    ),
  );
}
