/*
 * Lyrics editor for the track on a deck: load an .lrc/.txt file, paste text,
 * look it up on LRCLIB (opt-in), align plain text to the vocals, tap-sync
 * each line while the track plays, nudge the offset, preview, save.
 */
import { saveFile } from '../core/download';
import type { AppContext } from '../app/context';
import type { Deck } from '../audio/Deck';
import type { LibraryTrack } from '../core/types';
import { formatTime } from '../core/util';
import { lineAt, lrclibLookup, lyricsFromText, retime, toLrc, type LyricLine, type Lyrics } from '../lyrics/lyrics';
import { alignToVocals, analyzeVocals, snapLine } from '../lyrics/vocal';
import { h, setText } from './dom';
import { openModal } from './modal';
import { toast } from './toast';

const TIMING_LABEL: Record<Lyrics['timing'], string> = {
  word: 'Word-timed',
  line: 'Line-timed (words estimated)',
  auto: 'Aligned to the vocals',
  none: 'Not timed yet — align or tap-sync',
};
const SOURCE_LABEL: Record<Lyrics['source'], string> = {
  tags: 'from the file’s tags',
  lrc: 'from an .lrc file',
  pasted: 'typed / pasted',
  lrclib: 'from LRCLIB',
  demo: 'demo vocal chops',
  tapped: 'tap-synced',
};

const clone = (l: Lyrics): Lyrics => ({ ...l, lines: l.lines.map((x) => ({ ...x, words: x.words.map((w) => ({ ...w })) })) });

export function openLyricsEditor(app: AppContext, deck: Deck): void {
  const track = deck.track;
  if (!track) {
    toast('Load a track on this deck first.');
    return;
  }
  const t: LibraryTrack = track;
  const duration = deck.duration || t.analysis?.duration || 0;
  let draft: Lyrics | null = t.lyrics ? clone(t.lyrics) : null;
  let dirty = false;
  let busy = false;

  const status = h('div', { class: 'ly-status' });
  const text = h('textarea', {
    class: 'ly-text',
    spellcheck: 'false',
    placeholder: 'Paste lyrics here: plain text (one line per sung line, [Chorus] markers welcome) or LRC with [mm:ss.xx] timestamps.',
    'aria-label': 'Lyrics text',
  }) as HTMLTextAreaElement;
  const preview = h('div', { class: 'ly-preview' });
  const clock = h('span', { class: 'ly-clock' });
  const offset = h('input', { type: 'range', min: -3, max: 3, step: 0.01, value: 0, id: 'ly-offset', 'aria-label': 'Lyrics offset' }) as HTMLInputElement;
  const offsetOut = h('output', { for: 'ly-offset' });
  const progress = h('div', { class: 'ly-progress', hidden: true }, h('i'));
  const fileIn = h('input', { type: 'file', accept: '.lrc,.txt,text/plain', hidden: true }) as HTMLInputElement;

  const btn = (label: string, cls = 'btn', title = '') => h('button', { class: cls, type: 'button', title }, label) as HTMLButtonElement;
  const loadBtn = btn('Load .lrc / .txt', 'btn', 'Lyrics file (LRC keeps its timestamps)');
  const lookupBtn = btn('Find online', 'btn', 'Look up synced lyrics on lrclib.net');
  const applyBtn = btn('Use this text', 'btn', 'Read the text box (LRC is timed right away)');
  const alignBtn = btn('Align to vocals', 'btn primary', 'Find where the vocals are and lay the lines over them');
  const tapBtn = btn('Tap-sync lines', 'btn', 'Tap at the start of each line while the track plays');
  const playBtn = btn('▶ Play', 'btn');
  const back5 = btn('−5 s', 'btn small');
  const toStart = btn('⏮', 'btn small', 'Back to the start');
  const saveBtn = btn('Save', 'btn primary');
  const exportBtn = btn('Export .lrc', 'btn ghost');
  const removeBtn = btn('Remove lyrics', 'btn ghost danger');
  const tapPad = btn('Tap — next line starts now', 'btn primary ly-tap');
  const tapUndo = btn('Undo tap', 'btn small');
  const tapDone = btn('Done', 'btn small');
  const tapNext = h('div', { class: 'ly-tapnext' });
  const tapBox = h('div', { class: 'ly-tapbox', hidden: true }, tapNext, tapPad, h('div', { class: 'toggle-row' }, tapUndo, tapDone, h('span', { class: 'note' }, 'Space or Enter taps too.')));

  const refreshText = () => {
    text.value = draft ? (draft.timing === 'none' ? draft.raw : toLrc({ ...draft, offset: 0 })) : '';
  };
  const refreshStatus = () => {
    if (!draft) {
      setText(status, 'No lyrics yet. Load a file, paste text or look them up.');
    } else {
      const words = draft.lines.reduce((s, l) => s + (l.words.length || l.text.split(/\s+/).length), 0);
      const hooks = draft.lines.filter((l) => l.hook).length;
      setText(status, `${TIMING_LABEL[draft.timing]} · ${SOURCE_LABEL[draft.source]} · ${draft.lines.length} lines, ${words} words${hooks ? `, ${hooks} hook lines (these fire the lights)` : ''}${dirty ? ' · unsaved' : ''}`);
    }
    alignBtn.textContent = draft && draft.timing !== 'none' && draft.timing !== 'word' ? 'Snap words to vocals' : 'Align to vocals';
    alignBtn.disabled = !draft || draft.timing === 'word' || busy;
    tapBtn.disabled = !draft || busy;
    saveBtn.disabled = !dirty || busy;
    exportBtn.disabled = !draft || draft.timing === 'none';
    removeBtn.disabled = !t.lyrics && !draft;
    offset.disabled = !draft;
    offset.value = String(draft?.offset ?? 0);
    setText(offsetOut, `${(draft?.offset ?? 0) >= 0 ? '+' : ''}${(draft?.offset ?? 0).toFixed(2)} s`);
  };
  const set = (l: Lyrics | null, rewrite = true) => {
    draft = l;
    dirty = true;
    if (rewrite) refreshText();
    refreshStatus();
  };

  const fromText = (raw: string, source: Lyrics['source']) => {
    const l = lyricsFromText(raw, source, duration);
    if (!l) {
      toast('No lyrics found in that text.', 'error');
      return;
    }
    if (draft) l.offset = draft.offset;
    set(l, false);
    text.value = raw;
    if (l.timing === 'none') toast('Got the words. Now press “Align to vocals” or tap-sync the lines.');
  };

  loadBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (f) fromText(await f.text(), /\.lrc$/i.test(f.name) ? 'lrc' : 'pasted');
  });
  applyBtn.addEventListener('click', () => fromText(text.value, 'pasted'));

  lookupBtn.addEventListener('click', async () => {
    const artist = t.meta.artist?.trim();
    const title = t.meta.title?.trim();
    if (!artist || !title) {
      toast('This track needs an artist and a title for a lookup.', 'error');
      return;
    }
    if (!confirm(`Look up lyrics on lrclib.net?\n\nThis sends “${artist} — ${title}” and the track length to lrclib.net. Nothing else leaves your device.`)) return;
    lookupBtn.disabled = true;
    lookupBtn.textContent = 'Searching…';
    try {
      const raw = await lrclibLookup(artist, title, duration);
      if (raw) fromText(raw, 'lrclib');
      else toast('LRCLIB has no lyrics for this track (or it is instrumental).');
    } catch (err) {
      toast(`Lookup failed: ${(err as Error).message || 'network error'}. You can paste the lyrics instead.`, 'error');
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = 'Find online';
    }
  });

  alignBtn.addEventListener('click', async () => {
    if (!draft || busy) return;
    busy = true;
    refreshStatus();
    progress.hidden = false;
    const bar = progress.firstElementChild as HTMLElement;
    try {
      const pcm = await app.library.getPcm(t);
      const vmap = await analyzeVocals(pcm, (p) => (bar.style.width = `${Math.round(p * 100)}%`));
      const d = clone(draft);
      if (d.timing === 'none') {
        d.lines = alignToVocals(d.lines, vmap, duration);
        d.timing = 'auto';
      } else {
        for (const l of d.lines) snapLine(l, vmap);
      }
      const active = vmap.activity.reduce((s, a) => s + (a > 0.45 ? 1 : 0), 0) / vmap.rate;
      set(d);
      toast(active < 6 ? 'Hardly any vocals found, so the lines are spread over the track. Tap-sync will be more accurate.' : `Found about ${Math.round(active)} s of vocals and ${vmap.onsets.length} syllable onsets.`);
    } catch (err) {
      console.error(err);
      toast('Could not analyse this track’s audio.', 'error');
    } finally {
      busy = false;
      progress.hidden = true;
      refreshStatus();
    }
  });

  // tap-sync: each tap starts the next line at the playhead
  let tapIdx = 0;
  const taps: number[] = [];
  let tapLines: LyricLine[] = [];
  const showTapNext = () => {
    const cur = tapLines[tapIdx];
    tapNext.replaceChildren(
      h('small', {}, `Line ${Math.min(tapIdx + 1, tapLines.length)} of ${tapLines.length} — tap when it starts:`),
      h('b', {}, cur ? cur.text : 'All lines tapped. Press Done.'),
      h('small', {}, tapLines[tapIdx + 1]?.text ?? ''),
    );
    tapPad.disabled = !cur;
    tapUndo.disabled = !taps.length;
  };
  const doTap = () => {
    if (!tapLines[tapIdx]) return;
    if (!deck.playing) {
      toast('Play the track, then tap at the start of each line.');
      return;
    }
    taps[tapIdx] = deck.displayPosition();
    tapIdx++;
    showTapNext();
  };
  const finishTap = () => {
    tapBox.hidden = true;
    if (!draft || !taps.length) return;
    const d = clone(draft);
    const n = taps.length;
    for (let i = 0; i < d.lines.length; i++) {
      if (i < n) {
        const start = taps[i];
        const end = i + 1 < n ? taps[i + 1] : Math.min(duration, start + Math.max(1.5, (d.lines[i].text.split(/\s+/).length || 1) * 0.45));
        retime(d.lines[i], start, Math.max(start + 0.3, end));
      }
    }
    // untapped lines keep their old timing when they had one, otherwise follow on
    if (n < d.lines.length && d.timing === 'none') {
      let at = d.lines[n - 1].end;
      for (let i = n; i < d.lines.length; i++) {
        const len = Math.max(1.5, d.lines[i].text.split(/\s+/).length * 0.45);
        retime(d.lines[i], at, at + len);
        at += len + 0.3;
      }
    }
    d.lines.sort((a, b) => a.t - b.t);
    d.timing = 'line';
    d.source = 'tapped';
    d.offset = 0;
    set(d);
  };
  tapBtn.addEventListener('click', () => {
    if (!draft) return;
    tapLines = draft.lines;
    tapIdx = 0;
    taps.length = 0;
    tapBox.hidden = false;
    showTapNext();
    tapPad.focus();
  });
  tapPad.addEventListener('click', doTap);
  tapUndo.addEventListener('click', () => {
    if (!taps.length) return;
    taps.pop();
    tapIdx = taps.length;
    showTapNext();
  });
  tapDone.addEventListener('click', finishTap);

  offset.addEventListener('input', () => {
    if (!draft) return;
    draft.offset = parseFloat(offset.value);
    dirty = true;
    refreshStatus();
  });

  playBtn.addEventListener('click', () => {
    if (!deck.loaded) return;
    deck.togglePlay();
  });
  back5.addEventListener('click', () => deck.seek(Math.max(0, deck.displayPosition() - 5)));
  toStart.addEventListener('click', () => deck.seek(0));

  saveBtn.addEventListener('click', () => {
    if (text.value.trim() && (!draft || (draft.timing === 'none' && text.value.trim() !== draft.raw))) fromText(text.value, 'pasted');
    app.library.setLyrics(t, draft ? clone(draft) : null);
    dirty = false;
    refreshStatus();
    toast(draft ? 'Lyrics saved. They show on the screens while the track plays.' : 'Lyrics removed.');
  });
  exportBtn.addEventListener('click', () => {
    if (!draft) return;
    void saveFile(toLrc(draft), `${(t.meta.artist ? `${t.meta.artist} - ` : '') + t.meta.title}.lrc`.replace(/[\\/:*?"<>|]/g, '_'), 'text/plain');
  });
  removeBtn.addEventListener('click', () => {
    if (!confirm('Remove the lyrics from this track?')) return;
    draft = null;
    app.library.setLyrics(t, null);
    dirty = false;
    refreshText();
    refreshStatus();
  });

  const body = h(
    'div',
    { class: 'ly-editor' },
    h('div', { class: 'ly-track' }, h('b', {}, t.meta.title), h('span', {}, t.meta.artist || t.fileName), clock),
    status,
    h('div', { class: 'toggle-row' }, loadBtn, lookupBtn, applyBtn, alignBtn, tapBtn, fileIn),
    progress,
    tapBox,
    h('div', { class: 'ly-cols' }, text, h('div', { class: 'ly-side' }, h('div', { class: 'label' }, 'Preview'), preview, h('div', { class: 'toggle-row' }, toStart, back5, playBtn), h('label', { class: 'field', for: 'ly-offset' }, h('span', {}, 'Offset ', offsetOut), offset), h('p', { class: 'note' }, 'Words early? Slide right. Late? Slide left.'))),
    h('p', { class: 'note' }, 'Lyrics are read from the file’s tags (ID3 USLT/SYLT, Vorbis LYRICS, MP4) and from .lrc/.txt files with the same name dropped in with the audio. “Align to vocals” looks for centre-panned tonal energy in the voice band; it is a heuristic, not speech recognition, so check it and tap-sync where it drifts.'),
    h('div', { class: 'toggle-row', style: { justifyContent: 'space-between' } }, h('div', { class: 'toggle-row' }, removeBtn, exportBtn), saveBtn),
  );
  const m = openModal('Lyrics', body, { wide: true });

  const onKey = (e: KeyboardEvent) => {
    if (tapBox.hidden || e.target === text) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) doTap();
    }
  };
  document.addEventListener('keydown', onKey, true);

  // live preview while the dialog is open
  let lastLine = -2;
  const loop = () => {
    if (!body.isConnected) {
      document.removeEventListener('keydown', onKey, true);
      return;
    }
    const pos = deck.displayPosition();
    setText(clock, `${formatTime(pos, true)} / ${formatTime(duration)}`);
    setText(playBtn, deck.playing ? '❚❚ Pause' : '▶ Play');
    if (draft && draft.timing !== 'none') {
      const lp = pos - draft.offset;
      const i = lineAt(draft.lines, lp + 0.05);
      if (i !== lastLine) {
        lastLine = i;
        const cur = draft.lines[i];
        preview.replaceChildren(
          h('small', {}, draft.lines[i - 1]?.text ?? ''),
          h('div', { class: `ly-now${cur?.hook ? ' hook' : ''}` }, ...(cur ? (cur.words.length ? cur.words : [{ t: cur.t, end: cur.end, text: cur.text }]).map((w) => h('span', { 'data-t': w.t }, `${w.text} `)) : [h('span', {}, '…')])),
          h('small', {}, draft.lines[i + 1]?.text ?? ''),
        );
      }
      preview.querySelectorAll<HTMLElement>('.ly-now span[data-t]').forEach((s) => s.classList.toggle('sung', lp >= parseFloat(s.dataset.t!)));
    } else if (lastLine !== -3) {
      lastLine = -3;
      preview.replaceChildren(h('small', {}, draft ? 'Time the lines to preview them here.' : 'No lyrics yet.'));
    }
    requestAnimationFrame(loop);
  };
  refreshText();
  refreshStatus();
  requestAnimationFrame(loop);
  void m;
}
