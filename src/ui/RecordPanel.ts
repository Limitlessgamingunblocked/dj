/*
 * Recording settings (Sections 11.2–11.5, 12.3): what to record, at what
 * quality (with the size it'll take), how the camera behaves, which overlays
 * go on the picture, the count-in, and the replay buffer.
 */
import { STYLES } from '../name/styles';
import { mbPerMinute, frameSize, planVideo, RESOLUTIONS, type ResolutionId } from '../media/MediaWriter';
import type { Corner } from '../media/Compositor';
import type { RecordSettings } from '../media/Studio';
import { formatBytes } from '../media/MediaStore';
import { h, setClass, setText } from './dom';
import { openModal, type ModalHandle } from './modal';

export interface ReplaySettings {
  /** minutes kept; 0 = off */
  minutes: number;
  video: boolean;
  /** CLIP IT's length, seconds */
  clip: 30 | 60;
}

export const REPLAY_LENGTHS = [2, 5, 10, 15, 30] as const;

export interface RecordPanelHooks {
  settings: RecordSettings;
  replay: ReplaySettings;
  /** bytes the replay buffer would use for this length (audio, and video if on) */
  replayBytes(minutes: number, video: boolean): number;
  change(s: RecordSettings): void;
  changeReplay(r: ReplaySettings): void;
  start(): void;
  recording: boolean;
}

type Opt<T> = { id: T; label: string; title?: string };

function chips<T extends string | number>(label: string, values: readonly Opt<T>[], get: () => T, set: (v: T) => void): { row: HTMLElement; sync: () => void; btn: (v: T) => HTMLButtonElement } {
  const row = h('div', { class: 'gs-chips', role: 'radiogroup', 'aria-label': label });
  const btns = values.map((v) => {
    const b = h('button', { type: 'button', class: 'gs-chip', role: 'radio', title: v.title ?? '' }, v.label) as HTMLButtonElement;
    b.addEventListener('click', () => {
      set(v.id);
      sync();
    });
    row.append(b);
    return { b, v };
  });
  const sync = () =>
    btns.forEach(({ b, v }) => {
      setClass(b, 'active', v.id === get());
      b.setAttribute('aria-checked', String(v.id === get()));
    });
  sync();
  return { row, sync, btn: (id) => btns.find((x) => x.v.id === id)!.b };
}

function toggle(label: string, get: () => boolean, set: (v: boolean) => void, title = ''): HTMLElement {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return h('label', { class: 'toggle-row rp-toggle', title }, input, h('span', {}, label));
}

export function openRecordPanel(o: RecordPanelHooks): ModalHandle {
  const s = structuredClone(o.settings);
  const r = { ...o.replay };
  const commit = () => {
    o.change(structuredClone(s));
    refresh();
  };

  const mode = chips(
    'What to record',
    [
      { id: 'audio', label: 'Audio only', title: 'The clean master: WAV (24-bit / 48 kHz) and MP3 (320 kbps)' },
      { id: 'video', label: 'Video + audio', title: 'The whole set: venue, lights, crowd and you' },
      { id: 'booth', label: 'Booth cam', title: 'Close on your hands on the board, for tutorial-style clips' },
    ],
    () => s.mode,
    (v) => {
      s.mode = v;
      commit();
    },
  );
  const res = chips(
    'Resolution',
    RESOLUTIONS.map((x) => ({ id: x.id, label: x.id === '4k' ? '4K' : x.id })),
    () => s.resolution,
    (v: ResolutionId) => {
      s.resolution = v;
      commit();
    },
  );
  const fps = chips(
    'Frame rate',
    [
      { id: 30, label: '30 fps' },
      { id: 60, label: '60 fps' },
    ],
    () => s.fps,
    (v) => {
      s.fps = v as 30 | 60;
      commit();
    },
  );
  const aspect = chips(
    'Aspect',
    [
      { id: '16:9', label: '16:9 full set' },
      { id: '9:16', label: '9:16 vertical' },
      { id: '1:1', label: '1:1 square' },
    ],
    () => s.aspect,
    (v) => {
      s.aspect = v;
      commit();
    },
  );
  const director = chips(
    'Camera',
    [
      { id: 'auto', label: 'Auto-cinematic', title: 'Cuts between angles on the phrase (every 8 or 16 bars), with a punch-in on drops' },
      { id: 'locked', label: 'Locked', title: 'One angle the whole time: the one on screen when you start' },
      { id: 'live', label: 'Live switch', title: 'You switch angles: the camera menu, Shift+V, or a camera switcher on your board' },
    ],
    () => s.director,
    (v) => {
      s.director = v;
      commit();
    },
  );
  const size = h('p', { class: 'gs-note rp-size' });
  const format = h('p', { class: 'gs-note' });

  const corner = h('select', { 'aria-label': 'Watermark corner' }, ...(['tl', 'tr', 'bl', 'br'] as Corner[]).map((c) => h('option', { value: c }, { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' }[c]))) as HTMLSelectElement;
  corner.value = s.overlays.corner;
  corner.addEventListener('change', () => {
    s.overlays.corner = corner.value as Corner;
    commit();
  });
  const style = h('select', { 'aria-label': 'Watermark style' }, h('option', { value: 'venue' }, 'The venue’s lettering'), ...Object.values(STYLES).map((st) => h('option', { value: st.id }, st.label))) as HTMLSelectElement;
  style.value = s.overlays.style;
  style.addEventListener('change', () => {
    s.overlays.style = style.value as RecordSettings['overlays']['style'];
    commit();
  });
  const ov = s.overlays;
  const overlays = h(
    'div',
    { class: 'rp-overlays' },
    h('div', { class: 'rp-wm' }, toggle('Your name as a watermark', () => ov.watermark, (v) => ((ov.watermark = v), commit())), corner, style),
    toggle('Venue and date', () => ov.venueDate, (v) => ((ov.venueDate = v), commit())),
    toggle('“Now playing” on each new track', () => ov.nowPlaying, (v) => ((ov.nowPlaying = v), commit())),
    toggle('Live tracklist in a corner', () => ov.tracklist, (v) => ((ov.tracklist = v), commit())),
    toggle('VHS timestamp filter', () => ov.vhs, (v) => ((ov.vhs = v), commit())),
  );

  // the replay buffer (Section 12.3)
  const replayLen = chips(
    'Replay buffer length',
    [{ id: 0, label: 'Off' }, ...REPLAY_LENGTHS.map((m) => ({ id: m, label: `${m} min` }))],
    () => r.minutes,
    (v) => {
      r.minutes = v;
      o.changeReplay({ ...r });
      refresh();
    },
  );
  const replayVideo = chips(
    'Replay buffer content',
    [
      { id: 'audio', label: 'Audio only' },
      { id: 'video', label: 'Audio + video' },
    ],
    () => (r.video ? 'video' : 'audio'),
    (v) => {
      r.video = v === 'video';
      o.changeReplay({ ...r });
      refresh();
    },
  );
  const replayMem = h('p', { class: 'gs-note' });
  const replayVideoRow = h('div', { class: 'rp-row' }, h('span', { class: 'rp-label' }, 'Content'), h('div', { class: 'rp-ctl' }, replayVideo.row));
  const clipLen = chips(
    'Clip It length',
    [
      { id: 30, label: 'Last 30 s' },
      { id: 60, label: 'Last 60 s' },
    ],
    () => r.clip,
    (v) => {
      r.clip = v as 30 | 60;
      o.changeReplay({ ...r });
      refresh();
    },
  );

  // a two-column form: labels on the left, controls (and their notes) on the right
  const row = (label: string, ...controls: (Node | null)[]) => h('div', { class: 'rp-row' }, h('span', { class: 'rp-label' }, label), h('div', { class: 'rp-ctl' }, ...controls));
  const videoBits = h('div', { class: 'rp-rows' }, row('Resolution', res.row), row('Frame rate', fps.row), row('Aspect', aspect.row, format), row('Overlays', overlays));
  const camRow = row('Camera', director.row);
  const count = toggle('Count in three beats, so it starts on the downbeat', () => s.countdown, (v) => ((s.countdown = v), commit()));
  const startBtn = h('button', { class: 'btn primary gs-go', type: 'button' }, o.recording ? 'Recording…' : 'Start recording') as HTMLButtonElement;
  startBtn.disabled = o.recording;

  // which resolutions this browser can encode
  const supported = new Map<ResolutionId, string>();
  void (async () => {
    for (const x of RESOLUTIONS) {
      const { w, h: hh } = frameSize(x.id, '16:9');
      const p = await planVideo(w, hh, 30);
      if (p) supported.set(x.id, p.container === 'mp4' ? 'MP4 (H.264 + AAC)' : `WebM (${p.video.codec.startsWith('vp09') ? 'VP9' : 'VP8'} + Opus)`);
    }
    refresh();
  })();

  function refresh(): void {
    const video = s.mode !== 'audio';
    videoBits.hidden = !video;
    camRow.hidden = s.mode === 'booth';
    for (const x of RESOLUTIONS) {
      const b = res.btn(x.id);
      b.disabled = supported.size > 0 && !supported.has(x.id);
      b.title = b.disabled ? 'Your browser can’t encode this size' : '';
    }
    const fs = frameSize(s.resolution, s.aspect);
    setText(size, video ? `About ${Math.round(mbPerMinute(fs.w, fs.h, s.fps))} MB a minute (${fs.w}×${fs.h}, ${s.fps} fps).` : 'About 17 MB a minute as WAV (24-bit / 48 kHz); MP3 exports are about 2.4 MB a minute.');
    setText(format, supported.size ? `Saves as ${supported.get(s.resolution) ?? supported.values().next().value}.` : 'Checking what this browser can encode…');
    replayVideoRow.hidden = r.minutes === 0;
    setText(replayMem, r.minutes === 0 ? 'Off: only what you record is kept.' : `Uses up to ${formatBytes(o.replayBytes(r.minutes, r.video))} of memory.`);
    mode.sync();
    res.sync();
    fps.sync();
    aspect.sync();
    director.sync();
    replayLen.sync();
    replayVideo.sync();
    clipLen.sync();
  }
  refresh();

  return openModal(
    'Recording studio',
    (m) => {
      startBtn.addEventListener('click', () => {
        m.close();
        o.start();
      });
      return h(
        'div',
        { class: 'gig-setup rec-panel' },
        h('div', { class: 'rp-rows' }, row('Record', mode.row, size)),
        videoBits,
        h('div', { class: 'rp-rows' }, camRow, row('', count)),
        h('h3', { class: 'rp-h' }, 'Replay buffer'),
        h('div', { class: 'rp-rows' }, row('Keep', replayLen.row, replayMem), replayVideoRow, row('Clip length', clipLen.row)),
        h('p', { class: 'gs-note' }, 'Shift+S saves the buffer, Shift+C clips the end of it.'),
        h('div', { class: 'gs-actions' }, startBtn),
      );
    },
    { wide: true },
  );
}
