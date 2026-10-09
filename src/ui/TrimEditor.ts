/*
 * The trim editor (Section 12.4): a saved set on a timeline (stills above
 * the waveform, the smart markers, bar lines), in and out handles that snap
 * to bars, zoom, a preview, fades, and export: a new set (video in any
 * aspect with your overlays, or audio), WAV or MP3.
 * Tapping a marker jumps there and picks a sensible clip around it.
 */
import { BYTES_PER_FRAME, fade24, peaks24, unpack24 } from '../audio/capture/pcm';
import { mp3From, wavFrom } from '../audio/capture/export';
import type { Marker, Recording } from '../core/models';
import { mmss, type OverlayOpts } from '../media/Compositor';
import { demux, type DemuxedVideo } from '../media/demux';
import { clipAround } from '../media/logs';
import { renderClip } from '../media/reencode';
import { downloadBlob, type SetLibrary } from '../media/sets';
import type { Take } from '../media/Studio';
import type { ResolutionId } from '../media/MediaWriter';
import { h, setClass, setText } from './dom';
import { openModal, type ModalHandle } from './modal';
import { toast } from './toast';

export interface TrimHooks {
  sets: SetLibrary;
  ctx: AudioContext;
  djName: string;
  venueName(id: string): string;
  venueStyle(id: string): string;
  overlays: OverlayOpts;
  /** keep a trimmed take as a new set */
  keep(take: Take, from: Recording, a: number, b: number): Promise<Recording | null>;
}

const MARK_COLOR: Record<Marker['kind'], string> = { vibe: '#b6ff3b', drop: '#ff2e88', transition: '#3ad7ff', signature: '#ffb547', peak: '#c9b6ff', chant: '#ff8f5a' };

/** the tracks in a stretch, from its start; the one already playing at the start is listed at 0 */
export function clipTracklist(list: Recording['tracklist'], from: number, to: number): Recording['tracklist'] {
  const before = list.filter((t) => t.at <= from).at(-1);
  const inside = list.filter((t) => t.at > from && t.at < to).map((t) => ({ ...t, at: t.at - from }));
  return before ? [{ ...before, at: 0 }, ...inside] : inside;
}

export async function openTrimEditor(rec: Recording, hooks: TrimHooks, at?: number): Promise<ModalHandle | null> {
  const pcmBlob = await hooks.sets.file(rec, 'pcm');
  if (!pcmBlob) {
    toast('This set has no lossless audio to trim.', 'error');
    return null;
  }
  const pcm = new Uint8Array(await pcmBlob.arrayBuffer());
  const rate = rec.rate;
  const total = pcm.length / BYTES_PER_FRAME / rate;
  const videoBlob = await hooks.sets.file(rec, 'video');
  const stripBlob = await hooks.sets.file(rec, 'strip');
  const strip = stripBlob ? await createImageBitmap(stripBlob).catch(() => null) : null;
  // an audio set without stills shows its cover in the preview
  const coverBlob = !videoBlob && !strip ? await hooks.sets.file(rec, 'cover') : null;
  const cover = coverBlob ? await createImageBitmap(coverBlob).catch(() => null) : null;
  const tiles = strip ? Math.round((strip.width / 160) * (strip.height / 90)) : 0;
  const tileCount = strip ? Math.min(tiles, Math.max(1, Math.round(total / rec.stripEvery))) : 0;
  const urls: string[] = [];

  // the selection: a sensible clip around the marker asked for, or the first 30 seconds
  const bar = rec.bars.length > 1 ? (rec.bars.at(-1)! - rec.bars[0]) / (rec.bars.length - 1) : 2;
  let sel = at !== undefined ? clipAround({ at, kind: rec.markers.find((m) => Math.abs(m.at - at) < 0.5)?.kind ?? 'peak' }, total, bar) : { from: 0, to: Math.min(total, 30) };
  let view = { a: 0, b: total };
  if (total > 120) view = { a: Math.max(0, sel.from - 30), b: Math.min(total, sel.to + 30) };
  let snap = rec.bars.length > 0;
  let fadeIn = 0.5;
  let fadeOut = 1;
  let aspect: '16:9' | '9:16' | '1:1' = rec.aspect === '9:16' ? '9:16' : '16:9';
  let resolution: ResolutionId = '1080p';
  let playhead = sel.from;
  let playing: { src: AudioBufferSourceNode; started: number; from: number } | null = null;

  /* ---------------------------- preview ---------------------------- */
  const preview = h('div', { class: 'tr-preview' });
  let video: HTMLVideoElement | null = null;
  const still = h('canvas', { class: 'tr-still', width: 640, height: 360 }) as HTMLCanvasElement;
  if (videoBlob) {
    const u = URL.createObjectURL(videoBlob);
    urls.push(u);
    video = h('video', { src: u, muted: true, playsinline: true, class: 'tr-video' }) as HTMLVideoElement;
    video.muted = true;
    preview.append(video);
  } else preview.append(still);
  const drawStill = (t: number) => {
    const g = still.getContext('2d')!;
    g.fillStyle = '#0b0b10';
    g.fillRect(0, 0, still.width, still.height);
    if (cover) {
      const sz = still.height * 0.9;
      g.drawImage(cover, (still.width - sz) / 2, (still.height - sz) / 2, sz, sz);
    }
    if (!strip || !tileCount) return;
    const i = Math.min(tileCount - 1, Math.max(0, Math.floor(t / rec.stripEvery)));
    g.drawImage(strip, (i % 12) * 160, Math.floor(i / 12) * 90, 160, 90, 0, 0, still.width, still.height);
  };

  /* ---------------------------- timeline ---------------------------- */
  const canvas = h('canvas', { class: 'tr-canvas', height: 180, tabindex: 0, 'aria-label': 'Timeline: drag the handles to choose the clip' }) as HTMLCanvasElement;
  const W = () => canvas.clientWidth || 900;
  const xOf = (t: number) => ((t - view.a) / (view.b - view.a)) * W();
  const tOf = (x: number) => view.a + (x / W()) * (view.b - view.a);
  const snapT = (t: number) => {
    if (!snap || !rec.bars.length) return Math.max(0, Math.min(total, t));
    let best = t;
    let d = Infinity;
    for (const b of rec.bars) {
      const dd = Math.abs(b - t);
      if (dd < d) {
        d = dd;
        best = b;
      }
    }
    // only snap when the bar line is close on screen
    return Math.abs(xOf(best) - xOf(t)) < 14 ? best : Math.max(0, Math.min(total, t));
  };
  let peakCache = { key: '', p: new Float32Array(0) };
  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = W();
    const H = 180;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = H * dpr;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a0a0f';
    g.fillRect(0, 0, w, H);
    // stills along the top
    const TH = 54;
    if (strip && tileCount) {
      const tw = TH * (16 / 9);
      for (let x = 0; x < w; x += tw) {
        const t = tOf(x + tw / 2);
        const i = Math.min(tileCount - 1, Math.max(0, Math.floor(t / rec.stripEvery)));
        g.drawImage(strip, (i % 12) * 160, Math.floor(i / 12) * 90, 160, 90, x, 0, tw, TH);
      }
    }
    // waveform
    const cols = Math.max(1, Math.floor(w));
    const a = Math.floor(view.a * rate);
    const b = Math.min(Math.floor(pcm.length / BYTES_PER_FRAME), Math.ceil(view.b * rate));
    const key = `${a}:${b}:${cols}`;
    if (peakCache.key !== key) peakCache = { key, p: peaks24(pcm.subarray(a * BYTES_PER_FRAME, b * BYTES_PER_FRAME), b - a, cols) };
    const mid = TH + (H - TH - 20) / 2 + 6;
    const amp = (H - TH - 28) / 2;
    g.fillStyle = '#3ad7ff';
    for (let c = 0; c < cols; c++) {
      const lo = peakCache.p[c * 2];
      const hi = peakCache.p[c * 2 + 1];
      g.fillRect(c, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
    }
    // bar lines (when zoomed in enough to see them)
    if (rec.bars.length && (view.b - view.a) / bar < w / 6) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (const t of rec.bars) if (t >= view.a && t <= view.b) g.fillRect(xOf(t), TH, 1, H - TH - 18);
    }
    // the selection
    const x0 = xOf(sel.from);
    const x1 = xOf(sel.to);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, Math.max(0, x0), H - 18);
    g.fillRect(x1, 0, Math.max(0, w - x1), H - 18);
    g.fillStyle = '#ffb547';
    g.fillRect(x0 - 2, 0, 4, H - 18);
    g.fillRect(x1 - 2, 0, 4, H - 18);
    g.fillRect(x0 - 8, H - 34, 10, 16);
    g.fillRect(x1 - 2, H - 34, 10, 16);
    // markers
    for (const m of rec.markers) {
      if (m.at < view.a || m.at > view.b) continue;
      const x = xOf(m.at);
      g.fillStyle = MARK_COLOR[m.kind];
      g.beginPath();
      g.moveTo(x, TH);
      g.lineTo(x + 7, TH + 6);
      g.lineTo(x, TH + 12);
      g.fill();
      g.fillRect(x, TH, 1.5, H - TH - 18);
    }
    // playhead
    g.fillStyle = '#fff';
    g.fillRect(xOf(playhead) - 1, 0, 2, H - 18);
    // time ruler
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.font = '11px "JetBrains Mono", monospace';
    g.textBaseline = 'bottom';
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => (s / (view.b - view.a)) * w > 70) ?? 600;
    for (let t = Math.ceil(view.a / step) * step; t <= view.b; t += step) g.fillText(mmss(t), xOf(t) + 3, H - 2);
    setText(selText, `${mmss(sel.from)} → ${mmss(sel.to)} · ${mmss(sel.to - sel.from)}`);
  };

  // dragging the handles, the selection or the playhead
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const near = (t: number) => Math.abs(xOf(t) - x) < 10;
    const mode = near(sel.from) ? 'in' : near(sel.to) ? 'out' : 'seek';
    canvas.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = tOf(ev.clientX - r.left);
      if (mode === 'in') sel.from = Math.min(snapT(t), sel.to - 0.5);
      else if (mode === 'out') sel.to = Math.max(snapT(t), sel.from + 0.5);
      else setPlayhead(Math.max(0, Math.min(total, t)));
      draw();
    };
    move(e);
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (mode !== 'seek') setPlayhead(sel.from);
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });
  const zoom = (k: number, around = playhead) => {
    const span = Math.max(4, Math.min(total, (view.b - view.a) * k));
    let a = around - (around - view.a) * (span / (view.b - view.a));
    a = Math.max(0, Math.min(total - span, a));
    view = { a, b: a + span };
    draw();
  };
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const span = view.b - view.a;
        const a = Math.max(0, Math.min(total - span, view.a + (e.deltaX / W()) * span));
        view = { a, b: a + span };
        draw();
      } else zoom(e.deltaY > 0 ? 1.25 : 0.8, tOf(e.clientX - r.left));
    },
    { passive: false },
  );

  function setPlayhead(t: number): void {
    playhead = t;
    if (video && !playing) video.currentTime = t;
    if (!video) drawStill(t);
  }

  /* ---------------------------- playback ---------------------------- */
  const playBtn = h('button', { class: 'btn primary', type: 'button' }, '▶ Preview') as HTMLButtonElement;
  const stop = () => {
    if (!playing) return;
    try {
      playing.src.stop();
    } catch {
      /* stopped */
    }
    playing = null;
    video?.pause();
    setText(playBtn, '▶ Preview');
  };
  const play = () => {
    stop();
    const from = playhead >= sel.from && playhead < sel.to - 0.2 ? playhead : sel.from;
    const len = Math.min(sel.to - from, 180);
    const f0 = Math.round(from * rate);
    const n = Math.round(len * rate);
    const bytes = pcm.slice(f0 * BYTES_PER_FRAME, (f0 + n) * BYTES_PER_FRAME);
    fade24(bytes, n, from === sel.from ? fadeIn * rate : 0, from + len >= sel.to - 0.01 ? fadeOut * rate : 0);
    const [l, r] = unpack24(bytes, n);
    const buf = hooks.ctx.createBuffer(2, n, rate);
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    const src = hooks.ctx.createBufferSource();
    src.buffer = buf;
    // straight to the speakers: a preview isn't part of the mix (or the replay buffer)
    src.connect(hooks.ctx.destination);
    src.start();
    playing = { src, started: hooks.ctx.currentTime, from };
    src.onended = () => playing?.src === src && stop();
    if (video) {
      video.currentTime = from;
      void video.play().catch(() => undefined);
    }
    setText(playBtn, '■ Stop');
    const tick = () => {
      if (!playing) return;
      playhead = playing.from + (hooks.ctx.currentTime - playing.started);
      if (!video) drawStill(playhead);
      draw();
      requestAnimationFrame(tick);
    };
    tick();
  };
  playBtn.addEventListener('click', () => (playing ? stop() : play()));

  /* ---------------------------- controls ---------------------------- */
  const selText = h('span', { class: 'mono tr-sel' });
  const chip = <T,>(label: string, opts: { id: T; label: string }[], get: () => T, set: (v: T) => void) => {
    const row = h('div', { class: 'gs-chips', role: 'radiogroup', 'aria-label': label });
    const sync = () => [...row.children].forEach((b, i) => setClass(b as HTMLElement, 'active', opts[i].id === get()));
    for (const o of opts) {
      const b = h('button', { type: 'button', class: 'gs-chip' }, o.label);
      b.addEventListener('click', () => {
        set(o.id);
        sync();
      });
      row.append(b);
    }
    sync();
    return row;
  };
  const snapBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  snapBox.checked = snap;
  snapBox.disabled = !rec.bars.length;
  snapBox.addEventListener('change', () => (snap = snapBox.checked));
  const zoomIn = h('button', { class: 'btn', type: 'button', title: 'Zoom in' }, '＋');
  const zoomOut = h('button', { class: 'btn', type: 'button', title: 'Zoom out' }, '－');
  const fit = h('button', { class: 'btn', type: 'button', title: 'Show the whole set' }, 'Whole set');
  zoomIn.addEventListener('click', () => zoom(0.6));
  zoomOut.addEventListener('click', () => zoom(1.6));
  fit.addEventListener('click', () => {
    view = { a: 0, b: total };
    draw();
  });
  const marks = h(
    'div',
    { class: 'gs-chips tr-marks' },
    ...rec.markers.slice(0, 60).map((m) => {
      const b = h('button', { type: 'button', class: 'gs-chip', style: { borderColor: MARK_COLOR[m.kind] } }, `${mmss(m.at)} ${m.label}`);
      b.addEventListener('click', () => {
        sel = clipAround(m, total, bar);
        if (sel.from < view.a || sel.to > view.b) {
          const span = Math.max(view.b - view.a, sel.to - sel.from + 20);
          const a = Math.max(0, Math.min(total - span, sel.from - 10));
          view = { a, b: a + span };
        }
        setPlayhead(sel.from);
        draw();
      });
      return b;
    }),
  );
  const fades = [0, 0.5, 1, 2, 4].map((s) => ({ id: s, label: s ? `${s} s` : 'None' }));
  const status = h('span', { class: 'gs-note' });
  const venue = hooks.venueName(rec.venue);
  const audioBtn = h('button', { class: 'btn primary', type: 'button', title: 'The lossless audio of the selection, straight into My Sets' }, 'Save audio clip') as HTMLButtonElement;
  const exportBtn = h('button', { class: 'btn', type: 'button', title: 'A video of the selection in the aspect and size chosen, with your overlays' }, 'Save video clip') as HTMLButtonElement;
  const wavBtn = h('button', { class: 'btn', type: 'button' }, 'WAV') as HTMLButtonElement;
  const mp3Btn = h('button', { class: 'btn', type: 'button' }, 'MP3') as HTMLButtonElement;
  const cut = () => {
    const f0 = Math.round(sel.from * rate);
    const f1 = Math.round(sel.to * rate);
    const b = pcm.slice(f0 * BYTES_PER_FRAME, f1 * BYTES_PER_FRAME);
    fade24(b, f1 - f0, fadeIn * rate, fadeOut * rate);
    return b;
  };
  const name = (ext: string) => `${hooks.sets.fileName(rec, hooks.djName, venue, ext).replace(/\.\w+$/, '')}-${Math.round(sel.from)}s.${ext}`;
  wavBtn.addEventListener('click', () => downloadBlob(wavFrom(new Blob([cut() as BlobPart]), rate), name('wav')));
  mp3Btn.addEventListener('click', async () => {
    mp3Btn.disabled = true;
    try {
      const m = await mp3From(new Blob([cut() as BlobPart]), rate, { title: `${rec.title} (clip)`, artist: hooks.djName || 'DJ', album: venue, date: rec.date }, (k) => setText(status, `MP3… ${Math.round(k * 100)}%`));
      setText(status, '');
      downloadBlob(m, name('mp3'));
    } finally {
      mp3Btn.disabled = false;
    }
  });
  const clipMarkers = () => rec.markers.filter((m) => m.at >= sel.from && m.at <= sel.to).map((m) => ({ ...m, at: m.at - sel.from }));
  audioBtn.addEventListener('click', async () => {
    stop();
    audioBtn.disabled = true;
    try {
      const take: Take = {
        mode: 'audio',
        start: 0,
        seconds: sel.to - sel.from,
        date: new Date(),
        pcm: new Blob([cut() as BlobPart]),
        rate,
        aspect: rec.aspect,
        tracklist: clipTracklist(rec.tracklist, sel.from, sel.to),
        markers: clipMarkers(),
        thumb: (await hooks.sets.file(rec, 'thumb')) ?? undefined,
        dropped: 0,
      };
      const saved = await hooks.keep(take, rec, sel.from, sel.to);
      if (saved) toast('Clip saved to My Sets.');
    } finally {
      audioBtn.disabled = false;
    }
  });
  exportBtn.addEventListener('click', async () => {
    stop();
    exportBtn.disabled = true;
    try {
      let vid: DemuxedVideo | null = null;
      if (videoBlob) vid = await demux(videoBlob);
      const stills: { t: number; img: ImageBitmap }[] = [];
      if (!vid && strip) for (let i = 0; i < tileCount; i++) stills.push({ t: i * rec.stripEvery, img: await createImageBitmap(strip, (i % 12) * 160, Math.floor(i / 12) * 90, 160, 90) });
      setText(status, 'Making the clip… 0%');
      const res = await renderClip({
        from: sel.from,
        to: sel.to,
        video: vid,
        stills,
        pcm,
        rate,
        aspect,
        resolution,
        fps: 30,
        overlays: hooks.overlays,
        overlay: { name: hooks.djName, venueStyle: hooks.venueStyle(rec.venue) as never, venue, date: new Date(rec.date) },
        tracklist: rec.tracklist,
        fadeIn,
        fadeOut,
        onProgress: (k) => setText(status, `Making the clip… ${Math.round(k * 100)}%`),
      });
      for (const s of stills) s.img.close();
      const take: Take = {
        mode: 'video',
        start: 0,
        seconds: sel.to - sel.from,
        date: new Date(),
        pcm: new Blob([res.pcm as BlobPart]),
        rate,
        video: res.video,
        aspect,
        tracklist: clipTracklist(rec.tracklist, sel.from, sel.to),
        markers: clipMarkers(),
        thumb: (await hooks.sets.file(rec, 'thumb')) ?? undefined,
        dropped: 0,
      };
      setText(status, '');
      const saved = await hooks.keep(take, rec, sel.from, sel.to);
      if (saved) toast('Clip saved to My Sets.');
    } catch (e) {
      setText(status, '');
      toast(`Couldn’t make the clip: ${(e as Error).message}`, 'error');
    } finally {
      exportBtn.disabled = false;
    }
  });

  const handle = openModal(
    `Trim · ${rec.title}`,
    h(
      'div',
      { class: 'trim-editor' },
      h('div', { class: 'tr-top' }, preview, h('div', { class: 'tr-side' }, h('div', { class: 'tr-row' }, playBtn, selText), h('label', { class: 'toggle-row' }, snapBox, h('span', {}, 'Snap the handles to bars')), h('div', { class: 'gs-row' }, h('span', {}, 'Fade in'), chip('Fade in', fades, () => fadeIn, (v) => (fadeIn = v))), h('div', { class: 'gs-row' }, h('span', {}, 'Fade out'), chip('Fade out', fades, () => fadeOut, (v) => (fadeOut = v))), h('div', { class: 'gs-row' }, h('span', {}, 'Aspect'), chip('Aspect', [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }, { id: '1:1', label: '1:1' }], () => aspect, (v) => (aspect = v as typeof aspect))), h('div', { class: 'gs-row' }, h('span', {}, 'Size'), chip('Resolution', [{ id: '720p', label: '720p' }, { id: '1080p', label: '1080p' }], () => resolution, (v) => (resolution = v as ResolutionId))), h('div', { class: 'tr-row' }, audioBtn, exportBtn, wavBtn, mp3Btn), status)),
      h('div', { class: 'tr-row tr-zoom' }, zoomOut, zoomIn, fit, h('span', { class: 'gs-note' }, 'Drag the orange handles; scroll to zoom, shift-scroll to move. Click a moment to clip around it.')),
      canvas,
      rec.markers.length ? marks : null,
    ),
    { wide: true },
  );
  const close = handle.close;
  handle.close = () => {
    stop();
    close();
    for (const u of urls) URL.revokeObjectURL(u);
    strip?.close();
    cover?.close();
    ro.disconnect();
  };
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  setPlayhead(sel.from);
  requestAnimationFrame(draw);
  return handle;
}
