/*
 * Pre-gig (Section 10.2): pick the venue, the slot, the set length and the
 * assist level, then your look and the crate you're bringing. The Bedroom is
 * the tutorial and opens the Basement once it's done (Section 5.2).
 * TODO: Stage 6's bookings replace the free choice of venue and slot with offers.
 */
import { ASSISTS, SET_LENGTHS, type Assist, type GigConfig } from '../game/Gig';
import { SLOTS, type SlotId } from '../game/vibe';
import type { Look, Progress } from '../core/models';
import type { Crate } from '../library/Library';
import { h, setClass } from './dom';
import { openModal } from './modal';

export interface GigVenue {
  id: string;
  name: string;
  blurb: string;
  capacity: string;
  locked: string | null;
  draw(g: CanvasRenderingContext2D, w: number, h: number): void;
}

export interface SetupHooks {
  venues: GigVenue[];
  looks: Look[];
  currentLook: string;
  crates: Crate[];
  currentCrate: string | null;
  progress: Progress;
  assist: Assist;
  start(cfg: GigConfig, o: { look: string; crate: string | null }): void;
  dressingRoom(): void;
}

export function openGigSetup(o: SetupHooks): void {
  const firstOpen = o.venues.find((v) => !v.locked);
  const cfg: GigConfig = { venue: firstOpen?.id ?? 'bedroom', slot: 'warmup', minutes: 10, assist: o.assist };
  let look = o.currentLook;
  let crate = o.currentCrate ?? o.crates.find((c) => c.name === 'First Gigs')?.id ?? null;

  const chipRow = <T extends string | number>(label: string, values: readonly { id: T; label: string; title?: string }[], get: () => T, set: (v: T) => void) => {
    const row = h('div', { class: 'gs-chips', role: 'radiogroup', 'aria-label': label });
    const btns = values.map((v) => {
      const b = h('button', { type: 'button', class: 'gs-chip', role: 'radio', title: v.title ?? '' }, v.label);
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
    return { row, sync };
  };

  const brief = h('p', { class: 'gs-brief' });
  const updateBrief = () => {
    const v = o.venues.find((x) => x.id === cfg.venue);
    const tut = cfg.venue === 'bedroom' && !o.progress.tutorialDone;
    brief.replaceChildren(h('b', {}, tut ? 'Tutorial: ' : 'The promoter says: '), tut ? "Your first stream. We'll walk you through your first mix, then it's all yours." : SLOTS[cfg.slot].brief, v ? ` (${v.capacity})` : '');
  };

  const venueCards = h('div', { class: 'gs-venues' });
  const cards = o.venues.map((v) => {
    const c = h('canvas', { width: 240, height: 120 }) as HTMLCanvasElement;
    v.draw(c.getContext('2d')!, 240, 120);
    const b = h('button', { type: 'button', class: 'gs-venue', disabled: !!v.locked, title: v.locked ?? v.blurb }, c, h('b', {}, v.name), h('span', {}, v.locked ? `🔒 ${v.locked}` : v.blurb)) as HTMLButtonElement;
    b.addEventListener('click', () => {
      cfg.venue = v.id;
      syncVenues();
      updateBrief();
    });
    venueCards.append(b);
    return { b, v };
  });
  const syncVenues = () => cards.forEach(({ b, v }) => setClass(b, 'active', v.id === cfg.venue));
  syncVenues();

  const slot = chipRow<SlotId>('Slot', Object.values(SLOTS).map((s) => ({ id: s.id, label: s.label, title: s.brief })), () => cfg.slot, (v) => {
    cfg.slot = v;
    updateBrief();
  });
  const len = chipRow<number>('Set length', SET_LENGTHS.map((m) => ({ id: m, label: `${m} min` })), () => cfg.minutes, (v) => (cfg.minutes = v));
  const assist = chipRow<Assist>('Assist', ASSISTS.map((a) => ({ id: a.id, label: a.label, title: a.blurb })), () => cfg.assist, (v) => (cfg.assist = v));
  const assistNote = h('p', { class: 'gs-note' });
  const syncAssistNote = () => (assistNote.textContent = ASSISTS.find((a) => a.id === cfg.assist)!.blurb);
  assist.row.addEventListener('click', syncAssistNote);
  syncAssistNote();

  const lookSel = h('select', { 'aria-label': 'Look' }, ...o.looks.map((l) => h('option', { value: l.id, selected: l.id === look }, l.name))) as HTMLSelectElement;
  lookSel.addEventListener('change', () => (look = lookSel.value));
  const crateSel = h('select', { 'aria-label': 'Crate' }, h('option', { value: '' }, 'Whole collection'), ...o.crates.filter((c) => c.kind === 'crate').map((c) => h('option', { value: c.id, selected: c.id === crate }, `${c.name} (${c.trackIds.length})`))) as HTMLSelectElement;
  crateSel.addEventListener('change', () => (crate = crateSel.value || null));
  const dress = h('button', { type: 'button', class: 'btn ghost' }, 'Dressing room…');

  const go = h('button', { type: 'button', class: 'btn primary gs-go' }, 'Start the set');
  const content = h(
    'div',
    { class: 'gig-setup' },
    h('section', {}, h('h3', {}, 'Where'), venueCards),
    h('section', {}, h('h3', {}, 'Slot'), slot.row, brief),
    h('div', { class: 'gs-two' }, h('section', {}, h('h3', {}, 'Set length'), len.row), h('section', {}, h('h3', {}, 'Assist'), assist.row, assistNote)),
    h('div', { class: 'gs-two' }, h('section', {}, h('h3', {}, 'Look'), h('div', { class: 'gs-row' }, o.looks.length ? lookSel : h('span', { class: 'gs-note' }, 'Your starter look'), dress)), h('section', {}, h('h3', {}, 'Crate'), crateSel)),
    h('div', { class: 'gs-actions' }, go),
  );
  updateBrief();
  const m = openModal('Play a gig', content, { wide: true });
  go.addEventListener('click', () => {
    m.close();
    o.start({ ...cfg, tutorial: cfg.venue === 'bedroom' && !o.progress.tutorialDone }, { look, crate });
  });
  dress.addEventListener('click', () => {
    m.close();
    o.dressingRoom();
  });
  setTimeout(() => go.focus(), 30);
}
