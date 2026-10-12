/*
 * The mashup and edit builder, and your label.
 *   Mashup: pick the track for the vocals and melody and the track for the
 *   beat; the plan matches the tempo, shows how the keys sit, picks each
 *   track's best section and lays out the arrangement. Make it, listen,
 *   save it to your library (and release it on your label).
 *   Edit: one track rearranged into an extended mix.
 * Everything renders in the browser, from the music you imported.
 */
import { formatKey } from '../analysis/keys';
import type { LibraryTrack } from '../core/types';
import { labelName, loadLabel, release, saveLabel, type LabelSave } from '../game/label';
import { planEdit, planMashup, planSeconds, type MashPlan, type MashSource } from '../game/mashup';
import { RIVALS } from '../game/rivals';
import { trackInfo } from '../game/tracks';
import type { Library } from '../library/Library';
import { renderPlan } from '../media/mashup';
import { h } from './dom';
import { openModal, type ModalHandle } from './modal';
import { toast } from './toast';

export interface MashupHooks {
  library: Library;
  dj(): string;
  /** the career night (for the release date) */
  night(): number;
  /** load a track on the free deck */
  load(id: string): void;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function source(t: LibraryTrack): MashSource {
  const a = t.analysis!;
  return { id: t.id, title: t.meta.title, bpm: a.bpm, firstBeat: a.firstBeat, duration: a.duration, key: a.key, sections: trackInfo(t).sections };
}

/** the tracks with audio stored here and a beat grid */
function usable(lib: Library): LibraryTrack[] {
  return lib
    .list()
    .filter((t) => t.source === 'file' && t.status === 'ready' && t.analysis && t.analysis.bpm > 0)
    .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}

export function openMashupBuilder(o: MashupHooks, mode: 'mashup' | 'edit' = 'mashup'): ModalHandle {
  const tracks = usable(o.library);
  const body = h('div', { class: 'mashup' });
  if (tracks.length < (mode === 'mashup' ? 2 : 1)) {
    body.append(h('p', {}, mode === 'mashup' ? 'A mashup needs two of your own imported tracks (with their audio stored in this browser).' : 'An edit needs one of your own imported tracks.'), h('p', { class: 'gs-note' }, 'Import some music in the Library, let it analyse, then come back.'));
    return openModal('Mashups and edits', body, { wide: true });
  }
  let kind = mode;
  let a = tracks[0].id;
  let b = tracks[Math.min(1, tracks.length - 1)].id;
  let plan: MashPlan | null = null;
  let blob: Blob | null = null;
  let url: string | null = null;

  const opt = (t: LibraryTrack, sel: string) => h('option', { value: t.id, selected: t.id === sel ? true : undefined }, `${t.meta.title}${t.meta.artist ? ` · ${t.meta.artist}` : ''} (${Math.round(t.analysis!.bpm)}${t.analysis!.key ? ` · ${formatKey(t.analysis!.key)}` : ''})`);
  const selA = h('select', { 'aria-label': 'First track' }) as HTMLSelectElement;
  const selB = h('select', { 'aria-label': 'Second track' }) as HTMLSelectElement;
  const fill = () => {
    selA.replaceChildren(...tracks.map((t) => opt(t, a)));
    selB.replaceChildren(...tracks.map((t) => opt(t, b)));
  };
  fill();
  const swap = h('button', { type: 'button', class: 'btn ghost', title: 'Swap which track is the beat' }, '⇅ Swap');
  const tabs = h('div', { class: 'seg', role: 'tablist' });
  const tabBtn = (k: 'mashup' | 'edit', label: string) => {
    const t = h('button', { type: 'button', role: 'tab', class: `btn${kind === k ? ' active' : ''}`, 'aria-selected': kind === k ? 'true' : 'false' }, label);
    t.addEventListener('click', () => {
      kind = k;
      for (const x of tabs.children) x.classList.toggle('active', x === t);
      update();
    });
    return t;
  };
  tabs.append(tabBtn('mashup', 'Mashup'), tabBtn('edit', 'Extended edit'));
  const rowA = h('label', { class: 'mb-pick' }, h('span', {}, 'Vocals and melody from'), selA);
  const rowB = h('label', { class: 'mb-pick' }, h('span', {}, 'Beat from'), selB, swap);
  const info = h('div', { class: 'mb-info' });
  const timeline = h('canvas', { class: 'mb-timeline', width: 900, height: 120, 'aria-label': 'The arrangement' }) as HTMLCanvasElement;
  const status = h('p', { class: 'gs-note', role: 'status' });
  const audio = h('audio', { controls: true, class: 'mb-audio', hidden: true }) as HTMLAudioElement;
  const make = h('button', { type: 'button', class: 'btn primary' }, 'Make it');
  const save = h('button', { type: 'button', class: 'btn', disabled: true }, 'Save to my library');
  const rel = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const lab = loadLabel();
  const relLabel = h('label', { class: 'row' }, rel, ` Release it on ${labelName(lab, o.dj())}`);

  const update = () => {
    a = selA.value;
    b = selB.value;
    rowA.querySelector('span')!.textContent = kind === 'mashup' ? 'Vocals and melody from' : 'Track';
    rowB.hidden = kind !== 'mashup';
    const ta = o.library.get(a);
    const tb = o.library.get(b);
    if (!ta?.analysis || (kind === 'mashup' && !tb?.analysis)) return;
    plan = kind === 'mashup' ? planMashup(source(ta), source(tb!)) : planEdit(source(ta));
    blob = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    audio.hidden = true;
    save.setAttribute('disabled', '');
    status.textContent = '';
    const p = plan;
    info.replaceChildren(
      ...[
      h('b', {}, p.title),
      h('span', {}, `${Math.round(p.bpm)} BPM · ${mmss(planSeconds(p))} · ${p.bars} bars`),
      p.kind === 'mashup' ? h('span', {}, `Tempo: ${p.rate.A === 1 ? 'already matched' : `${ta.meta.title} ${p.rate.A > 1 ? 'up' : 'down'} ${Math.abs((p.rate.A - 1) * 100).toFixed(1)}% (${p.semis >= 0 ? '+' : ''}${p.semis.toFixed(1)} semitones, like a turntable’s pitch)`}`) : null,
      p.kind === 'mashup' && p.keyA && p.keyB ? h('span', { class: p.keyScore >= 0.85 ? 'mb-good' : p.keyScore >= 0.5 ? '' : 'mb-bad' }, `Keys: ${formatKey(p.keyA)} over ${formatKey(p.keyB)}, ${p.keyNote.toLowerCase()}`) : null,
      ...p.warnings.map((w) => h('span', { class: 'mb-warn' }, w)),
      ].filter((x): x is HTMLElement => !!x),
    );
    drawTimeline(timeline, p);
  };
  selA.addEventListener('change', update);
  selB.addEventListener('change', update);
  swap.addEventListener('click', () => {
    [a, b] = [b, a];
    fill();
    update();
  });
  make.addEventListener('click', async () => {
    if (!plan) return;
    const p = plan;
    make.setAttribute('disabled', '');
    status.textContent = 'Rendering…';
    try {
      const ta = o.library.get(a)!;
      const pcmA = await o.library.getPcm(ta);
      const pcmB = p.kind === 'mashup' ? await o.library.getPcm(o.library.get(b)!) : undefined;
      blob = await renderPlan(p, { A: pcmA, B: pcmB }, (k) => (status.textContent = `Rendering… ${Math.round(k * 100)}%`));
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      audio.src = url;
      audio.hidden = false;
      save.removeAttribute('disabled');
      status.textContent = `Done: ${(blob.size / 1e6).toFixed(1)} MB WAV. Listen, then save it.`;
    } catch (err) {
      status.textContent = `Couldn’t make it: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      make.removeAttribute('disabled');
    }
  });
  save.addEventListener('click', async () => {
    if (!blob || !plan) return;
    const p = plan;
    save.setAttribute('disabled', '');
    status.textContent = 'Adding it to your library…';
    const name = `${p.title.replace(/[\\/:*?"<>|]/g, '-')}.wav`;
    const [t] = await o.library.importFiles([new File([blob], name, { type: 'audio/wav' })]);
    if (!t) {
      status.textContent = 'Couldn’t add it to the library.';
      return;
    }
    const lb = loadLabel();
    const ln = labelName(lb, o.dj());
    o.library.setMeta(t, { title: p.title, artist: o.dj() || 'You', label: rel.checked ? ln : undefined });
    if (rel.checked) {
      saveLabel(release(lb, { trackId: t.id, title: p.title, kind: p.kind, night: o.night() }));
      toast(`“${p.title}” is out on ${ln}. Watch the feed: the rivals might play it.`);
    } else toast(`“${p.title}” is in your library.`);
    status.textContent = 'Saved.';
    const load = h('button', { type: 'button', class: 'btn' }, 'Load it on a deck');
    load.addEventListener('click', () => o.load(t.id));
    status.append(' ', load);
  });

  body.append(
    tabs,
    h('div', { class: 'mb-picks' }, rowA, rowB),
    info,
    timeline,
    h('div', { class: 'mb-legend' }, h('i', { class: 'l-full' }), 'Full track ', h('i', { class: 'l-beat' }), 'Beat (drums and bass) ', h('i', { class: 'l-top' }), 'Vocals and melody'),
    h('div', { class: 'gs-actions' }, make, save, relLabel),
    status,
    audio,
    h('p', { class: 'gs-note' }, 'The split into beat and vocals is done with filters (lows and highs against the mids), not true stem separation: it works best when the vocal sits in the middle of the mix. Tempo is matched by resampling, so the key moves with it.'),
  );
  kind = mode;
  update();
  const modal = openModal('Mashups and edits', body, { wide: true });
  // drawn again at the size it's shown
  requestAnimationFrame(() => plan && drawTimeline(timeline, plan));
  return modal;
}

function drawTimeline(c: HTMLCanvasElement, p: MashPlan): void {
  const g = c.getContext('2d');
  if (!g) return;
  // sharp at the size it's shown
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(300, c.clientWidth || 900);
  const H = 120;
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  c.style.height = `${H}px`;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const lanes = p.kind === 'mashup' ? 2 : 1;
  const lh = (H - 24) / lanes;
  const x = (bar: number) => 8 + (bar / Math.max(1, p.bars)) * (W - 16);
  g.font = '600 11px system-ui, sans-serif';
  g.textBaseline = 'middle';
  // the bar ruler
  g.fillStyle = 'rgb(255 255 255 / 35%)';
  for (let b = 0; b <= p.bars; b += 8) {
    g.fillRect(x(b), H - 18, 1, 6);
    g.fillText(String(b + 1), x(b) + 3, H - 8);
  }
  const col = { full: '#4cc9f0', beat: '#ff9f1c', top: '#b6ff3b' };
  for (const part of p.parts) {
    const lane = p.kind === 'mashup' ? (part.src === 'A' ? 0 : 1) : 0;
    const y = 4 + lane * lh;
    const x0 = x(part.at);
    const x1 = x(part.at + part.bars);
    g.fillStyle = col[part.layer];
    g.globalAlpha = 0.85;
    g.beginPath();
    g.roundRect(x0 + 1, y + 2, Math.max(2, x1 - x0 - 2), lh - 6, 6);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#0b1020';
    g.save();
    g.beginPath();
    g.rect(x0 + 4, y, Math.max(0, x1 - x0 - 8), lh);
    g.clip();
    g.fillText(part.label, x0 + 8, y + lh / 2);
    g.restore();
  }
}

/** your label: its name, its releases and who's been playing them */
export function openLabel(o: MashupHooks): ModalHandle {
  const body = h('div', { class: 'label-panel' });
  const render = () => {
    const l: LabelSave = loadLabel();
    const name = labelName(l, o.dj());
    const input = h('input', { type: 'text', value: l.name, placeholder: name, maxlength: 40, 'aria-label': 'Label name' }) as HTMLInputElement;
    input.addEventListener('change', () => {
      saveLabel({ ...loadLabel(), name: input.value.trim() });
      render();
    });
    const mash = h('button', { type: 'button', class: 'btn primary' }, 'Make a mashup');
    const edit = h('button', { type: 'button', class: 'btn' }, 'Make an extended edit');
    mash.addEventListener('click', () => openMashupBuilder(o, 'mashup'));
    edit.addEventListener('click', () => openMashupBuilder(o, 'edit'));
    const total = l.releases.reduce((n, r) => n + r.plays, 0);
    body.replaceChildren(
      h('div', { class: 'lb-head' }, h('div', { class: 'lb-logo', 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase()), h('div', {}, h('h3', {}, name), h('span', { class: 'gs-note' }, `${l.releases.length} release${l.releases.length === 1 ? '' : 's'} · ${total} play${total === 1 ? '' : 's'} by other DJs`))),
      h('label', { class: 'mb-pick' }, h('span', {}, 'Label name'), input),
      l.releases.length
        ? h(
            'ol',
            { class: 'lb-list' },
            ...l.releases.map((r) => {
              const t = o.library.get(r.trackId);
              const play = h('button', { type: 'button', class: 'btn ghost', disabled: t ? undefined : true, title: t ? 'Load it on a deck' : 'No longer in your library' }, 'Load');
              play.addEventListener('click', () => o.load(r.trackId));
              return h('li', {}, h('span', { class: `lb-kind ${r.kind}` }, r.kind === 'edit' ? 'Edit' : 'Mashup'), h('span', { class: 'hw-t' }, h('b', {}, r.title), h('small', {}, r.by.length ? `Played by ${r.by.map((x) => RIVALS[x].name).join(', ')} · ${r.plays} play${r.plays === 1 ? '' : 's'}` : 'No plays yet: give it a few nights')), play);
            }),
          )
        : h('p', { class: 'gs-note' }, 'Nothing out yet. Make a mashup or an edit and release it: other DJs will pick it up, play it out, and drop it in B2Bs with you.'),
      h('div', { class: 'gs-actions' }, mash, edit),
    );
  };
  render();
  return openModal('Your label', body, { wide: true });
}
