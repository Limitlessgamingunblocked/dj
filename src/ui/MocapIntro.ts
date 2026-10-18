/*
 * Body tracking's guide: what it does, how to set up in front of the
 * camera, the moves the room answers, and what happens to the picture. It
 * opens the first time body tracking starts (before the camera asks), and
 * from the ? on its window and Help.
 */
import { loadSetting, saveSetting } from '../core/settings';
import { h } from './dom';
import { openModal } from './modal';

export interface Move {
  icon: string;
  name: string;
  /** what it does, short (the camera window's list) */
  does: string;
  /** how to do it well */
  tip: string;
}

export const MOVES: Move[] = [
  {
    icon: '🕺',
    name: 'Your body',
    does: 'your DJ copies your arms, chest and, standing back, your legs',
    tip: 'Move and your DJ moves with you: arms, shoulders, the lean of your chest. Stand back so your knees and feet are in the picture and the legs copy you too, crouching included. Anything out of the picture goes back to the DJ’s own moves.',
  },
  {
    icon: '🙂',
    name: 'Your face',
    does: 'your expressions, blinks, winks and where you look',
    tip: 'Smile, frown, open your mouth, raise your brows, wink: your DJ pulls the same face. Turn and tilt your head and theirs follows. Looking at the screen is looking down at the decks.',
  },
  {
    icon: '🖐️',
    name: 'Your hands',
    does: 'each hand’s turn and every finger',
    tip: 'Hold your hands up in the picture and the DJ’s fingers open, close and point like yours. Hands out of the picture, or down on your keyboard and mouse, play the decks as usual.',
  },
  {
    icon: '🙌',
    name: 'Both hands up: hands up',
    does: 'the crowd copies you',
    tip: 'Put both hands up above your head and hold for a moment. You do the "hands up" move and the crowd throws theirs up with you.',
  },
  {
    icon: '👋',
    name: 'Hands up, then sway: crowd control',
    does: 'the whole room sways with your arms',
    tip: 'After hands up, keep your arms in the air and sway them left and right. Your DJ and the whole crowd follow your arms, the back of the room a beat behind the front. Bring your hands down to let them go.',
  },
];

const SETUP = [
  'Sit or stand facing the camera with your head and shoulders in the picture. Step back to bring your legs in too.',
  'Light in front of you works best. A bright window behind you makes you hard to see.',
  'Sit how you’ll play for the first second: that’s your resting pose. Moved? Press Recenter on the camera window.',
  'It’s a mirror by default, so raising your right arm raises the arm on the right of the screen. Turn Mirror off for the DJ’s own right.',
];

const GOOD_TO_KNOW = [
  'The picture never leaves your device. The tracking (Google’s MediaPipe) runs inside the browser, and nothing is recorded or uploaded.',
  'The first time, it downloads its models (about 20 MB). After that it starts quickly.',
  'Body, Face and Fingers on the camera window switch each part on and off. Fewer parts is lighter on an older computer.',
  'The ready-made outfits like Deep Minimal are scans of real people: they copy your body and the turn of your head, but not your expressions. Change any piece in Character for a DJ that pulls your faces.',
  'Your mouse, keyboard and MIDI controllers keep working the decks the whole time.',
  'Turn it on or off from the ⋯ menu (Play → Body tracking) or with Shift+H. The × on its window turns it off too.',
  'It works best in Chrome or Edge on a computer with a webcam.',
];

const SEEN = 'mocap.introSeen';

/** whether the guide has been shown before (it opens by itself only the first time) */
export function introSeen(): boolean {
  return loadSetting(SEEN, false);
}

/**
 * The guide. With `start`, it ends with a button that turns the camera on
 * (the first start); without, it's just the guide.
 */
export function openMocapGuide(start?: () => void): void {
  saveSetting(SEEN, true);
  openModal('Body tracking: your DJ moves like you', (m) => {
    const actions = start
      ? h(
          'div',
          { class: 'mocapg-actions' },
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
      : h('div', { class: 'mocapg-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => m.close() }, 'Got it'));
    return h(
      'div',
      { class: 'mocap-guide' },
      h('p', { class: 'mocapg-lead' }, 'Your webcam watches you, and your DJ in the booth moves like you do: your arms, hands and fingers, the turn of your head, your face. Throw your hands up and the crowd goes with you. A small mirrored camera window on the stage shows what it sees.'),
      h('h3', {}, 'Get set up'),
      h('ol', { class: 'mocapg-steps' }, SETUP.map((s) => h('li', {}, s))),
      h('h3', {}, 'What it copies, and the moves'),
      h(
        'div',
        { class: 'mocapg-moves' },
        MOVES.map((g) => h('section', { class: 'mocapg-move' }, h('div', { class: 'mocapg-icon', 'aria-hidden': 'true' }, g.icon), h('div', {}, h('b', {}, g.name), h('p', {}, g.tip)))),
      ),
      h('h3', {}, 'Good to know'),
      h('ul', { class: 'mocapg-notes' }, GOOD_TO_KNOW.map((s) => h('li', {}, s))),
      actions,
    );
  });
}
