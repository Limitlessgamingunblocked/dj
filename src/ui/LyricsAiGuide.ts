/*
 * The AI lyrics guide: what it does, how it hears the words, how to get the
 * best out of it, what happens to your music, and its settings. It opens the
 * first time AI lyrics is asked for (before anything downloads), and from
 * Help, the Show tab and the lyrics editor.
 */
import { LISTEN_LANGUAGES, LISTEN_MODELS, type ListenQuality } from '../lyrics/aiModels';
import { LyricsAI } from '../lyrics/LyricsAI';
import { h } from './dom';
import { openModal } from './modal';

const STEPS: [icon: string, title: string, text: string][] = [
  ['🎚️', 'It takes the vocal stem', 'The centre of the mix with the bass and kick cut, where the lead vocal sits: the same split as the Vocal stem knob.'],
  ['🔎', 'It finds where the singing is', 'Intros, drops and instrumental breaks are skipped, so it only listens where there are words.'],
  ['🧠', 'Whisper listens, word by word', 'OpenAI’s Whisper speech model, running in your browser, writes down each sung stretch and the moment every word starts and ends.'],
  ['🎤', 'You get karaoke', 'The words become lines on the stage, each word filling with colour as it’s sung, and on the LED walls. They’re saved with the track, so it only ever listens to a song once.'],
];

const TIPS = [
  'It starts with the part under the playhead, and the words show as karaoke while it’s still listening. Keep mixing: it works in the background.',
  'Clear lead vocals come out best. Chopped, pitched or heavily effected vocals, chants under a big drop and whispered hooks are harder, and it can mishear a word.',
  'Got the real lyrics? Paste them or press Find online in the lyrics editor, then Time with AI: the words stay exactly yours and the AI only times them.',
  'Words early or late? The offset slider in the lyrics editor moves them all. Edit any line there too.',
  'Pick the song’s language in the settings below if it guesses wrong. Best takes longer but hears busy mixes better.',
];

const NOTES = [
  'Your music never leaves your device. The AI runs inside the browser, and only the model itself is downloaded.',
  'The first time, it downloads the model from Hugging Face (Standard is about 80–150 MB, Best about 250–450 MB) and keeps it, so after that it starts quickly and works offline.',
  'With a graphics card the browser can use (WebGPU, in Chrome and Edge), a song takes seconds. On the processor alone it takes about as long as the song, a little more on older machines.',
  'Each deck’s ⋯ menu can listen again, time lyrics you have, or stop. Shift+K shows or hides the karaoke.',
];

/** The guide. With `start`, it ends by switching AI lyrics on and calling it. */
export function openLyricsAiGuide(ai: LyricsAI, start?: () => void): void {
  const s = ai.settings;
  openModal('AI lyrics: karaoke from any song', (m) => {
    const quality = h('div', { class: 'seg', role: 'group', 'aria-label': 'AI model' });
    const qBtns = new Map<ListenQuality, HTMLButtonElement>();
    const qNote = h('p', { class: 'note' });
    const paintQ = () => {
      for (const [id, b] of qBtns) b.classList.toggle('active', id === s.quality);
      qNote.textContent = `${LISTEN_MODELS[s.quality].note}. Download ${LISTEN_MODELS[s.quality].size}, once.`;
    };
    for (const q of Object.values(LISTEN_MODELS)) {
      const b = h('button', { type: 'button', class: 'btn' }, q.name) as HTMLButtonElement;
      b.addEventListener('click', () => {
        s.quality = q.id;
        ai.save();
        paintQ();
      });
      qBtns.set(q.id, b);
      quality.append(b);
    }
    paintQ();
    const lang = h('select', { id: 'aig-lang', 'aria-label': 'Language' }, ...LISTEN_LANGUAGES.map(([code, name]) => h('option', { value: code }, name))) as HTMLSelectElement;
    lang.value = s.language;
    lang.addEventListener('change', () => {
      s.language = lang.value;
      ai.save();
    });
    const auto = h('input', { type: 'checkbox', id: 'aig-auto' }) as HTMLInputElement;
    auto.checked = s.auto;
    auto.addEventListener('change', () => {
      s.auto = auto.checked;
      ai.save();
    });

    const turnOn = () => {
      s.agreed = true;
      ai.save();
      m.close();
      start?.();
    };
    const supported = LyricsAI.supported();
    const actions = !s.agreed || start
      ? h(
          'div',
          { class: 'airg-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Not now'),
          h('button', { type: 'button', class: 'btn primary', disabled: !supported, onclick: turnOn }, start ? 'Turn on and listen' : 'Turn on AI lyrics'),
        )
      : h('div', { class: 'airg-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => m.close() }, 'Got it'));

    return h(
      'div',
      { class: 'air-guide aig' },
      h('p', { class: 'airg-lead' }, 'Load a song with vocals and the AI listens to it, writes down the lyrics and times every word, so they light up karaoke-style over the stage as they’re sung, on both decks.'),
      !supported && h('p', { class: 'note ly-warn' }, 'This browser can’t run the AI (it needs Web Workers and WebAssembly). Try Chrome or Edge.'),
      h('h3', {}, 'How it hears the words'),
      h(
        'div',
        { class: 'airg-moves' },
        STEPS.map(([icon, title, text]) => h('section', { class: 'airg-move' }, h('div', { class: 'airg-icon', 'aria-hidden': 'true' }, icon), h('div', {}, h('b', {}, title), h('p', {}, text)))),
      ),
      h('h3', {}, 'Getting the best lyrics'),
      h('ul', { class: 'airg-notes' }, TIPS.map((t) => h('li', {}, t))),
      h('h3', {}, 'Settings'),
      h('div', { class: 'aig-settings' }, h('div', { class: 'toggle-row' }, h('span', { class: 'label' }, 'Model'), quality), qNote, h('label', { class: 'field', for: 'aig-lang' }, h('span', {}, 'Language'), lang), h('label', { class: 'btn', for: 'aig-auto', style: { gap: '6px', justifySelf: 'start' } }, auto, 'Listen to every track I load that has no lyrics')),
      h('h3', {}, 'Good to know'),
      h('ul', { class: 'airg-notes' }, NOTES.map((t) => h('li', {}, t))),
      actions,
    );
  });
}

/** Run `then` once AI lyrics is switched on (the guide asks the first time). */
export function withAiLyrics(ai: LyricsAI, then: () => void): void {
  if (ai.settings.agreed) then();
  else openLyricsAiGuide(ai, then);
}
