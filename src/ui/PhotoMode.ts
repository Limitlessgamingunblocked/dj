/*
 * Photo mode: the stage full screen with a camera's controls.
 *   – focus: follows the DJ as the camera moves (autofocus); tap anything in
 *     the picture to focus on it, or set the distance; the aperture (f/1.4 … f/16) sets how shallow the
 *     focus is, the background opening into soft bokeh
 *   – hold the moment: the room freezes (the lights, the crowd mid-jump, the
 *     confetti in the air) while the camera still moves round it
 *   – filters over the room's own grade, framing (thirds, the frame's shape:
 *     16:9, 4:5, square, 9:16 for a story, 2.39:1 cinema), and the shot is
 *     saved cropped to that frame
 */
import type { Grade } from '../three/lens';
import type { Stage } from '../three/Stage';
import { h, setClass } from './dom';
import { icon } from './icons';

export interface PhotoHost {
  stage: Stage;
  shell: HTMLElement;
  /** show and offer to save the finished picture */
  save(blob: Blob): void;
}

export const PHOTO_FILTERS: { id: string; label: string; grade: Grade | null }[] = [
  { id: 'none', label: 'None', grade: null },
  { id: 'mono', label: 'Mono', grade: { tint: 0xffffff, contrast: 1.05, saturation: 0, lift: 0 } },
  { id: 'noir', label: 'Noir', grade: { tint: 0xf4f6ff, contrast: 1.4, saturation: 0, lift: 0 } },
  { id: 'film', label: 'Warm film', grade: { tint: 0xffe6c8, contrast: 0.95, saturation: 0.9, lift: 0.025 } },
  { id: 'night', label: 'Cool night', grade: { tint: 0xc8dcff, contrast: 1.1, saturation: 0.85, lift: 0.01 } },
  { id: 'punch', label: 'Punch', grade: { tint: 0xffffff, contrast: 1.22, saturation: 1.3, lift: 0 } },
  { id: 'faded', label: 'Faded', grade: { tint: 0xfff4ea, contrast: 0.82, saturation: 0.7, lift: 0.05 } },
];

export const PHOTO_FRAMES: { id: string; label: string; aspect: number | null }[] = [
  { id: 'screen', label: 'Screen', aspect: null },
  { id: '16x9', label: '16:9', aspect: 16 / 9 },
  { id: '4x5', label: '4:5', aspect: 4 / 5 },
  { id: '1x1', label: 'Square', aspect: 1 },
  { id: '9x16', label: '9:16', aspect: 9 / 16 },
  { id: 'cine', label: '2.39:1', aspect: 2.39 },
];

const APERTURES = [1.4, 2, 2.8, 4, 5.6, 8, 16];

/** the largest centred rect of `aspect` in a w × h picture: x, y, width, height (px) */
export function cropRect(w: number, h: number, aspect: number | null): [number, number, number, number] {
  if (!aspect) return [0, 0, w, h];
  let cw = w;
  let ch = w / aspect;
  if (ch > h) {
    ch = h;
    cw = h * aspect;
  }
  return [Math.round((w - cw) / 2), Math.round((h - ch) / 2), Math.round(cw), Math.round(ch)];
}

/** focus slider (0..1) ↔ metres, log scale from 0.4 to 60 m */
export const sliderToMetres = (v: number) => 0.4 * Math.pow(150, v);
export const metresToSlider = (m: number) => Math.log(Math.max(0.4, m) / 0.4) / Math.log(150);

export class PhotoMode {
  private el: HTMLElement | null = null;
  private frame = PHOTO_FRAMES[0];
  private grid = true;
  /** focus follows the DJ until you pick a focus yourself */
  private af = true;
  private raf = 0;
  private off: (() => void)[] = [];

  constructor(private host: PhotoHost) {}

  get open(): boolean {
    return !!this.el;
  }

  show(): void {
    if (this.el) return;
    const { stage, shell } = this.host;
    this.af = true;
    shell.classList.add('photo-mode');
    stage.dof.enabled = true;
    stage.dof.focus = stage.distanceToDJ();
    stage.dof.fNumber = 2.8;

    const guide = h('div', { class: 'photo-frame' }, h('div', { class: 'photo-thirds' }));
    const focusVal = h('output', { class: 'photo-val' });
    const focus = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: metresToSlider(stage.dof.focus), 'aria-label': 'Focus distance' }) as HTMLInputElement;
    const syncFocus = () => {
      focus.value = String(metresToSlider(stage.dof.focus));
      focusVal.textContent = `${stage.dof.focus < 10 ? stage.dof.focus.toFixed(1) : Math.round(stage.dof.focus)} m`;
    };
    const afBtn = h('button', { type: 'button', class: 'photo-chip active', 'aria-pressed': 'true', title: 'Keep the DJ in focus as the camera moves' }, 'Focus on DJ');
    const setAf = (on: boolean) => {
      this.af = on;
      setClass(afBtn, 'active', on);
      afBtn.setAttribute('aria-pressed', String(on));
    };
    afBtn.addEventListener('click', () => setAf(!this.af));
    focus.addEventListener('input', () => {
      setAf(false);
      stage.dof.focus = sliderToMetres(Number(focus.value));
      syncFocus();
    });
    const chips = <T extends { id: string; label: string }>(label: string, items: T[], get: () => string, set: (x: T) => void) => {
      const row = h('div', { class: 'photo-chips', role: 'radiogroup', 'aria-label': label });
      const btns = items.map((it) => {
        const b = h('button', { type: 'button', class: 'photo-chip', role: 'radio' }, it.label);
        b.addEventListener('click', () => {
          set(it);
          sync();
        });
        row.append(b);
        return { b, it };
      });
      const sync = () =>
        btns.forEach(({ b, it }) => {
          setClass(b, 'active', it.id === get());
          b.setAttribute('aria-checked', String(it.id === get()));
        });
      sync();
      return row;
    };
    let filterId = 'none';
    const apertureRow = chips(
      'Aperture',
      APERTURES.map((f) => ({ id: String(f), label: `f/${f}` })),
      () => String(stage.dof.fNumber),
      (x) => (stage.dof.fNumber = Number(x.id)),
    );
    const filterRow = chips('Filter', PHOTO_FILTERS, () => filterId, (x) => {
      filterId = x.id;
      stage.photoFilter = x.grade;
    });
    const frameRow = chips('Frame', PHOTO_FRAMES, () => this.frame.id, (x) => {
      this.frame = x;
      this.layoutFrame(guide);
    });
    const gridBtn = h('button', { type: 'button', class: 'photo-chip active', 'aria-pressed': 'true' }, 'Thirds');
    gridBtn.addEventListener('click', () => {
      this.grid = !this.grid;
      setClass(gridBtn, 'active', this.grid);
      gridBtn.setAttribute('aria-pressed', String(this.grid));
      setClass(guide, 'no-grid', !this.grid);
    });
    const freezeBtn = h('button', { type: 'button', class: 'photo-chip', 'aria-pressed': 'false', title: 'Hold the moment: the room freezes, the camera still moves' }, 'Hold the moment');
    freezeBtn.addEventListener('click', () => {
      stage.freeze = !stage.freeze;
      setClass(freezeBtn, 'active', stage.freeze);
      freezeBtn.setAttribute('aria-pressed', String(stage.freeze));
    });
    const shutter = h('button', { type: 'button', class: 'photo-shutter', 'aria-label': 'Take the photo' });
    shutter.addEventListener('click', () => void this.shoot());
    const close = h('button', { type: 'button', class: 'btn ghost photo-close', 'aria-label': 'Leave photo mode' }, icon('close', 16));
    close.addEventListener('click', () => this.close());
    const panel = h(
      'div',
      { class: 'photo-panel' },
      h('div', { class: 'photo-row' }, h('span', { class: 'photo-label' }, 'Focus'), focus, focusVal, afBtn, h('span', { class: 'photo-hint' }, 'or tap the picture')),
      h('div', { class: 'photo-row' }, h('span', { class: 'photo-label' }, 'Aperture'), apertureRow),
      h('div', { class: 'photo-row' }, h('span', { class: 'photo-label' }, 'Filter'), filterRow),
      h('div', { class: 'photo-row' }, h('span', { class: 'photo-label' }, 'Frame'), frameRow, gridBtn, freezeBtn),
    );
    this.el = h('div', { class: 'photo-mode-ui', role: 'dialog', 'aria-label': 'Photo mode' }, guide, close, panel, shutter);
    stage.el.append(this.el);
    syncFocus();
    this.layoutFrame(guide);
    // tap to focus (a drag still turns the camera)
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const d = stage.distanceAt(e.clientX, e.clientY);
      if (d !== null) {
        setAf(false);
        stage.dof.focus = d;
        syncFocus();
      }
      down = null;
    };
    const canvas = stage.renderer.domElement;
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', key, { capture: true });
    const ro = new ResizeObserver(() => this.layoutFrame(guide));
    ro.observe(stage.el);
    // autofocus: the DJ's distance as the camera moves (the readout only changes when it does)
    const follow = () => {
      this.raf = requestAnimationFrame(follow);
      if (!this.af) return;
      const d = stage.distanceToDJ();
      if (Math.abs(d - stage.dof.focus) > d * 0.005) {
        stage.dof.focus = d;
        syncFocus();
      }
    };
    this.raf = requestAnimationFrame(follow);
    this.off = [() => cancelAnimationFrame(this.raf), () => canvas.removeEventListener('pointerdown', onDown), () => canvas.removeEventListener('pointerup', onUp), () => window.removeEventListener('keydown', key, { capture: true }), () => ro.disconnect()];
  }

  /** the frame guide: the crop's rect over the picture, the rest dimmed */
  private layoutFrame(guide: HTMLElement): void {
    const r = this.host.stage.el.getBoundingClientRect();
    const [x, y, w, hh] = cropRect(r.width, r.height, this.frame.aspect);
    Object.assign(guide.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
  }

  private async shoot(): Promise<void> {
    const stage = this.host.stage;
    const flash = h('div', { class: 'photo-flash' });
    stage.el.append(flash);
    setTimeout(() => flash.remove(), 450);
    // the picture without the panel's chrome over it
    this.el?.classList.add('shooting');
    const blob = await stage.snapshot();
    this.el?.classList.remove('shooting');
    if (!blob) return;
    const img = await createImageBitmap(blob);
    const [x, y, w, hh] = cropRect(img.width, img.height, this.frame.aspect);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hh;
    c.getContext('2d')!.drawImage(img, x, y, w, hh, 0, 0, w, hh);
    img.close();
    c.toBlob((b) => b && this.host.save(b), 'image/png');
  }

  close(): void {
    if (!this.el) return;
    const { stage, shell } = this.host;
    for (const f of this.off) f();
    this.off = [];
    this.el.remove();
    this.el = null;
    shell.classList.remove('photo-mode');
    stage.dof.enabled = false;
    stage.freeze = false;
    stage.photoFilter = null;
  }
}
