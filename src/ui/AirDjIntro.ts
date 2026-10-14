/*
 * Air DJ's guide: what it is, how to set up in front of the camera, every
 * gesture with a tip, and what happens to the picture. It opens the first
 * time Air DJ starts (before the camera asks), and from the ? on the Air DJ
 * window and Help.
 */
import { loadSetting, saveSetting } from '../core/settings';
import { h } from './dom';
import { openModal } from './modal';

export interface Gesture {
  icon: string;
  name: string;
  /** what it does, short (the Air DJ window's list) */
  does: string;
  /** how to do it well */
  tip: string;
}

export const GESTURES: Gesture[] = [
  {
    icon: '🤏',
    name: 'Pinch: scratch',
    does: 'grab the record: move left and right to scratch',
    tip: 'Touch your thumb and index together to grab the record, like a hand on the platter. Move left and right to push it back and forth, then open your fingers to let go. Short, quick moves sound best. It needs the jogs set to vinyl (Settings → Decks).',
  },
  {
    icon: '✋',
    name: 'Open palm: filter',
    does: 'raise for the high-pass, lower for the low-pass',
    tip: 'Show a flat hand, then raise it to sweep the high-pass up (thinner) or lower it for the low-pass (muffled). It starts from wherever the filter already is. Drop the hand or close it and the filter slides back to off by itself.',
  },
  {
    icon: '✌️',
    name: 'Peace sign: beat FX',
    does: 'beat FX on that deck while held, higher for more',
    tip: 'Hold up two fingers to put the beat FX on that deck. The higher the hand, the stronger the effect. Lower the fingers and it stops. Pick the effect (echo, reverb, flanger…) in Mixer & FX first.',
  },
  {
    icon: '☝️',
    name: 'Point: crossfader',
    does: 'slide your finger left and right for the crossfader',
    tip: 'Point one finger and slide it across to move the crossfader from where it is. Only one hand works the crossfader at a time.',
  },
  {
    icon: '🙌',
    name: 'Both palms up high: hands up',
    does: 'the crowd copies you',
    tip: 'Raise both open hands near the top of the picture and hold for a moment. You do the "hands up" move and the crowd throws theirs up with you. Up there the filters stay put.',
  },
  {
    icon: '👋',
    name: 'Hands up, then sway: crowd control',
    does: 'the whole room sways with your arms',
    tip: 'After hands up, keep your arms in the air and sway them left and right. Your DJ and the whole crowd follow your arms, the back of the room a beat behind the front. Bring your hands down to let them go.',
  },
  {
    icon: '✊',
    name: 'Fist: rest',
    does: 'does nothing',
    tip: 'Make a fist whenever you want your hand in view without changing anything. It is the safe pose between moves.',
  },
];

const SETUP = [
  'Sit or stand about an arm’s length from the camera, so both hands fit in the picture with room to move.',
  'Light in front of you works best. A bright window behind you makes your hands hard to see.',
  'Your left hand plays the left deck and your right hand the right deck. The picture is a mirror, so it feels natural.',
  'Load a track on each deck first. The mouse, keyboard and MIDI controllers keep working alongside your hands.',
];

const GOOD_TO_KNOW = [
  'The picture never leaves your device. Hand tracking (Google’s MediaPipe) runs inside the browser, and nothing is recorded or uploaded.',
  'The first time, it downloads the hand model (about 10 MB). After that it starts quickly.',
  'The 3D board moves with you, and Auto DJ hands the mix back as soon as your hands touch something.',
  'Turn it on or off from the ⋯ menu (Play → Air DJ) or with Shift+H. The × on its window turns it off too.',
  'It works best in Chrome or Edge on a computer with a webcam.',
];

const SEEN = 'airdj.introSeen';

/** whether the guide has been shown before (it opens by itself only the first time) */
export function introSeen(): boolean {
  return loadSetting(SEEN, false);
}

/**
 * The guide. With `start`, it ends with a button that turns the camera on
 * (the first start); without, it's just the guide.
 */
export function openAirDjGuide(start?: () => void): void {
  saveSetting(SEEN, true);
  openModal('Air DJ: play with your hands', (m) => {
    const actions = start
      ? h(
          'div',
          { class: 'airg-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Not now'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn primary',
              onclick: () => {
                m.close();
                start();
              },
            },
            'Turn on the camera',
          ),
        )
      : h('div', { class: 'airg-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => m.close() }, 'Got it'));
    return h(
      'div',
      { class: 'air-guide' },
      h('p', { class: 'airg-lead' }, 'No controller needed. Your webcam watches your hands, and each move becomes a scratch, a filter sweep, an effect or a crossfade on the decks. A small mirrored camera window on the stage shows the hands it sees and what each one is doing.'),
      h('h3', {}, 'Get set up'),
      h('ol', { class: 'airg-steps' }, SETUP.map((s) => h('li', {}, s))),
      h('h3', {}, 'The moves'),
      h(
        'div',
        { class: 'airg-moves' },
        GESTURES.map((g) => h('section', { class: 'airg-move' }, h('div', { class: 'airg-icon', 'aria-hidden': 'true' }, g.icon), h('div', {}, h('b', {}, g.name), h('p', {}, g.tip)))),
      ),
      h('h3', {}, 'Good to know'),
      h('ul', { class: 'airg-notes' }, GOOD_TO_KNOW.map((s) => h('li', {}, s))),
      actions,
    );
  });
}
