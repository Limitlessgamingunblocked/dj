/*
 * Home (Section 9.7): your place between gigs. The stage shows the hub (a
 * bedroom, then a studio, then the penthouse, as your fame grows) with your
 * flyers, plaques and gold records on the wall, and you standing in it. The
 * stations are here: the bookings calendar, the wardrobe, the crates, My
 * Sets and the phone with your feed.
 */
import type { AvatarInput } from '../character/Avatar';
import type { Career } from '../game/Career';
import { CAREER, isCareerVenue, nextGoal, TIER_FAME, TIER_NAMES } from '../game/progression';
import { MILESTONE_BY_ID } from '../game/progression';
import { nameService } from '../name/NameService';
import type { Stage } from '../three/Stage';
import type { ViewId } from '../three/CameraRig';
import { goldRecords, homeLevel, HOME_NAMES, HOME_TIERS, hub, setHubState } from '../three/venues/hub';
import { rivalOf } from '../game/rivals';
import { SLOTS } from '../game/vibe';
import * as THREE from 'three';
import { h } from './dom';
import type { FlyerInfo } from './flyer';

export interface HubHooks {
  stage: Stage;
  career: Career;
  venue(): string;
  restoreVenue(id: string): void;
  venueName(id: string): string;
  music(): { playing: boolean; beat: number; kick: number };
  bookings(): void;
  wardrobe(): void;
  crates(): void;
  mySets(): void;
  phone(): void;
  busy(on: boolean): void;
}

export class HubView {
  private el: HTMLElement | null = null;
  private prevVenue = '';
  private prevView: ViewId = 'perf';
  private t = 0;

  constructor(private host: HubHooks) {}

  get open(): boolean {
    return this.el !== null;
  }

  /** what the hub's walls show, from the career */
  private state(): Parameters<typeof setHubState>[0] {
    const c = this.host.career;
    const p = c.progress;
    const dj = nameService.text;
    const flyers: FlyerInfo[] = c.bookings.items
      .filter((b) => b.status === 'played')
      .reverse()
      .map((b) => ({ venue: b.venue, venueName: this.host.venueName(b.venue), promoter: b.promoter, dj, slotLabel: SLOTS[b.slot].label, minutes: b.minutes, night: b.night, special: b.special, rival: rivalOf(b.special)?.name }));
    const plaques = p.milestones.map((m) => MILESTONE_BY_ID.get(m)?.label ?? m);
    return { tier: p.sandbox ? 7 : p.tier, dj, flyers, plaques, golds: goldRecords(p.tier, p.setsPlayed) };
  }

  show(): void {
    if (this.open) return;
    const st = this.host.stage;
    this.prevVenue = this.host.venue();
    const v = st.rig.view;
    this.prevView = v === 'drone' || v === 'custom' ? 'perf' : v;
    setHubState(this.state());
    st.setVenue(hub);
    // you, at home, grooving to whatever's on
    st.avatarSpot = { pos: new THREE.Vector3(0.4, 0, 0.2), face: 0.5, input: () => this.input() };
    st.rig.goTo('wide', true);
    this.host.busy(true);
    document.body.classList.add('hub-open');
    this.el = this.build();
    st.el.append(this.el);
    requestAnimationFrame(() => st.resize());
  }

  close(): void {
    if (!this.open) return;
    const st = this.host.stage;
    this.el?.remove();
    this.el = null;
    st.avatarSpot = null;
    document.body.classList.remove('hub-open');
    this.host.restoreVenue(this.prevVenue);
    st.rig.goTo(this.prevView, true);
    this.host.busy(false);
    requestAnimationFrame(() => st.resize());
  }

  private input(): AvatarInput {
    const m = this.host.music();
    this.t += 1 / 60;
    return { beat: m.playing ? m.beat : this.t * 1.6, playing: m.playing, dropHit: false, peak: 0, build: 0, kick: m.playing ? m.kick : 0 };
  }

  private build(): HTMLElement {
    const c = this.host.career;
    const p = c.progress;
    const level = homeLevel(p.sandbox ? 7 : p.tier);
    const next = level < 2 ? `${HOME_NAMES[level + 1]} at fame tier ${HOME_TIERS[level + 1]}` : 'The top floor. You made it.';
    const lo = TIER_FAME[p.tier - 1] ?? 0;
    const hi = TIER_FAME[p.tier] ?? lo;
    const k = hi > lo ? Math.min(1, (p.fame - lo) / (hi - lo)) : 1;
    const station = (icon: string, label: string, sub: string, fn: () => void) => {
      const b = h('button', { type: 'button', class: 'hub-station' }, h('span', { class: 'hub-ic', 'aria-hidden': 'true' }, icon), h('b', {}, label), h('small', {}, sub));
      b.addEventListener('click', fn);
      return b;
    };
    const offers = c.bookings.items.filter((b) => b.status === 'offered').length;
    const booked = c.bookings.items.filter((b) => b.status === 'accepted');
    const nextBooked = booked.sort((a, b) => a.night - b.night)[0];
    const back = h('button', { type: 'button', class: 'btn primary' }, 'Back to the decks');
    back.addEventListener('click', () => this.close());
    const leave = (fn: () => void) => () => {
      this.close();
      fn();
    };
    return h(
      'div',
      { class: 'hub-panel', role: 'dialog', 'aria-label': 'Home' },
      h(
        'div',
        { class: 'hub-head' },
        h('span', { class: 'hub-kicker' }, HOME_NAMES[level]),
        h('h2', {}, nameService.text),
        h('div', { class: 'hub-tier' }, h('b', {}, `Tier ${p.tier} · ${TIER_NAMES[p.tier - 1] ?? ''}`), h('div', { class: 'bk-bar' }, h('i', { style: `width:${(k * 100).toFixed(1)}%` })), h('small', {}, `${p.fame.toLocaleString()} fame · $${p.cash.toLocaleString()} · ${p.followers.toLocaleString()} followers`)),
        h('p', { class: 'hub-next' }, 'Next: ', nextGoal(p), ' · Home: ', next),
      ),
      h(
        'div',
        { class: 'hub-stations' },
        station('📅', 'Bookings', nextBooked ? `Next: ${isCareerVenue(nextBooked.venue) ? CAREER[nextBooked.venue].name : nextBooked.venue}` : offers ? `${offers} offer${offers > 1 ? 's' : ''} waiting` : 'The calendar', leave(() => this.host.bookings())),
        station('👕', 'Wardrobe', 'Dressing room', leave(() => this.host.wardrobe())),
        station('💿', 'Crates', 'Dig through your records', leave(() => this.host.crates())),
        station('🎞', 'My Sets', 'Recordings and clips', leave(() => this.host.mySets())),
        station('📱', 'Phone', `${c.feed.posts.length} posts`, () => this.host.phone()),
      ),
      h('div', { class: 'hub-foot' }, back),
    );
  }
}
