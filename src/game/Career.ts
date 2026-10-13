/*
 * The career in memory: the DJ profile and progress, loaded through the
 * SaveSystem at start and autosaved on every change. Stage 6 builds the
 * ProgressionSystem (fame, tiers, unlocks, bookings) on top of this; for now
 * the debug menu reads and writes it. The saved looks (Section 4) live here
 * too: the one you're wearing, and the rest of the wardrobe.
 */
import { defaultLook } from '../character/look';
import { Emitter } from '../core/emitter';
import { ALL_SPECS, BOOKINGS, FEED, LOOKS, PROFILE, PROGRESS, type BookingsSave, type FeedSave, type Look, type Profile, type Progress } from '../core/models';
import { SaveSystem } from '../core/SaveSystem';
import { PROMOTERS, refreshOffers, seeded } from './bookings';
import { circuitOffers, cleanCircuit, freeRun, loadCircuit, planTour, relDeclined, residencyOffer, saveCircuit, type CircuitSave } from './circuit';
import { tierFor } from './progression';
import { awardAchievements, type Earned } from './achievements';
import { buy as shopBuy, type ShopEntry } from './shop';

export class Career {
  profile: Profile;
  progress: Progress;
  looks: { items: Look[]; current: string | null };
  /** the calendar: offers, accepted bookings, the night counter */
  bookings: BookingsSave;
  /** the social feed: fans' posts and your clips */
  feed: FeedSave;
  /** the circuit: promoters' memories, the residency, the tour */
  circuit: CircuitSave = loadCircuit();
  /** what went wrong loading the saves (shown once to the player) */
  readonly problems: string[] = [];
  readonly changed = new Emitter<{ profile: Profile; progress: Progress; look: Look; bookings: BookingsSave; feed: FeedSave; circuit: CircuitSave }>();

  constructor(readonly saves = new SaveSystem()) {
    const p = saves.load(PROFILE);
    const g = saves.load(PROGRESS);
    const l = saves.load(LOOKS);
    const b = saves.load(BOOKINGS);
    const f = saves.load(FEED);
    for (const r of [p, g, l, b, f]) if (r.problem) this.problems.push(r.problem);
    this.profile = p.data;
    // the tiers got easier (October 2026): a saved career moves up to the tier its fame has earned
    this.progress = g.data.tier < tierFor(g.data.fame) ? { ...g.data, tier: tierFor(g.data.fame) } : g.data;
    this.looks = l.data;
    this.bookings = b.data;
    this.feed = f.data;
  }

  setFeed(next: FeedSave): void {
    this.feed = FEED.validate(next);
    this.saves.autosave(FEED, () => this.feed);
    this.changed.emit('feed', this.feed);
  }

  /** the look you're wearing (the starter look until you save one) */
  get look(): Look {
    return this.looks.items.find((x) => x.id === this.looks.current) ?? this.looks.items[0] ?? defaultLook();
  }

  /** Save a look (new or changed) and, by default, wear it. */
  saveLook(look: Look, wear = true): void {
    const items = this.looks.items.filter((x) => x.id !== look.id);
    const at = this.looks.items.findIndex((x) => x.id === look.id);
    items.splice(at < 0 ? items.length : at, 0, structuredClone(look));
    this.setLooks({ items, current: wear ? look.id : this.looks.current });
  }

  wearLook(id: string): void {
    if (this.looks.items.some((x) => x.id === id)) this.setLooks({ ...this.looks, current: id });
  }

  deleteLook(id: string): void {
    this.setLooks({ items: this.looks.items.filter((x) => x.id !== id), current: this.looks.current === id ? null : this.looks.current });
  }

  /** an id no saved look has */
  newLookId(): string {
    let n = this.looks.items.length + 1;
    while (this.looks.items.some((x) => x.id === `look_${n}`)) n++;
    return `look_${n}`;
  }

  private setLooks(next: { items: Look[]; current: string | null }): void {
    const before = this.look;
    this.looks = LOOKS.validate(next);
    this.saves.autosave(LOOKS, () => this.looks);
    const now = this.look;
    if (JSON.stringify(before) !== JSON.stringify(now)) this.changed.emit('look', now);
  }

  setProfile(patch: Partial<Profile>): void {
    this.profile = PROFILE.validate({ ...this.profile, ...patch });
    this.saves.autosave(PROFILE, () => this.profile);
    this.changed.emit('profile', this.profile);
  }

  setProgress(patch: Partial<Progress>): void {
    this.progress = PROGRESS.validate({ ...this.progress, ...patch });
    this.saves.autosave(PROGRESS, () => this.progress);
    this.changed.emit('progress', this.progress);
  }

  /** buy something in the shop; any achievement it reaches comes back too */
  buy(e: ShopEntry): { ok: true; earned: Earned[] } | { ok: false; why: string } {
    const r = shopBuy(this.progress, e);
    if (!r.ok) return r;
    this.setProgress(r.patch);
    return { ok: true, earned: this.checkAchievements() };
  }

  /** award achievement levels reached outside a set (a clip, the daily streak, the shop) */
  checkAchievements(): Earned[] {
    const r = awardAchievements(this.progress);
    if (r.patch) this.setProgress(r.patch);
    return r.got;
  }

  setBookings(next: BookingsSave): void {
    this.bookings = BOOKINGS.validate(next);
    this.saves.autosave(BOOKINGS, () => this.bookings);
    this.changed.emit('bookings', this.bookings);
  }

  setCircuit(next: CircuitSave): void {
    this.circuit = cleanCircuit(next);
    saveCircuit(this.circuit);
    this.changed.emit('circuit', this.circuit);
  }

  /** the calendar brought up to tonight: passed offers go, new ones come (the same ones for the same night), and the circuit's own nights */
  refreshBookings(): BookingsSave {
    const r = seeded(this.bookings.night * 7919 + this.progress.setsPlayed);
    const offers = refreshOffers(this.bookings, this.progress, r);
    const out = circuitOffers(offers, this.progress, this.circuit, r);
    let circuit = out.circuit;
    // a promoter who likes you enough offers a weekly night
    if (!circuit.residency && !circuit.residencyOffer) {
      const offer = residencyOffer(this.progress, circuit.rel, null, out.save.night, PROMOTERS);
      if (offer) circuit = { ...circuit, residencyOffer: offer };
    }
    if (circuit !== this.circuit) this.setCircuit(circuit);
    if (JSON.stringify(out.save) !== JSON.stringify(this.bookings)) this.setBookings(out.save);
    return this.bookings;
  }

  /** say yes to the residency on offer */
  acceptResidency(): void {
    const o = this.circuit.residencyOffer;
    if (!o) return;
    this.setCircuit({ ...this.circuit, residency: { ...o, booked: this.bookings.night - 1 }, residencyOffer: null });
    this.refreshBookings();
  }

  /** turn the residency down (the promoter cools a little), or end the one you have (its coming nights go) */
  dropResidency(): void {
    const c = this.circuit;
    const who = c.residency?.promoter ?? c.residencyOffer?.promoter;
    if (!who) return;
    this.setCircuit({ ...c, residency: null, residencyOffer: null, rel: relDeclined(c.rel, who, !!c.residency) });
    if (c.residency) this.setBookings({ ...this.bookings, items: this.bookings.items.filter((b) => !(b.special === 'residency' && b.status === 'accepted')) });
  }

  /** book a tour of these cities, one a night from the first free run of nights */
  startTour(cities: string[]): boolean {
    if (this.circuit.tour) return false;
    const start = freeRun(this.bookings, this.bookings.night + 1, cities.length);
    const t = planTour(cities, this.progress, start);
    if (!t) return false;
    this.setCircuit({ ...this.circuit, tour: t });
    this.refreshBookings();
    return true;
  }

  /** call the tour off: the legs you haven't played go */
  cancelTour(): void {
    const t = this.circuit.tour;
    if (!t) return;
    let rel = this.circuit.rel;
    for (const city of t.cities.slice(t.leg)) {
      const b = this.bookings.items.find((x) => x.special === `tour:${city}` && x.status === 'accepted');
      if (b) rel = relDeclined(rel, b.promoter, true);
    }
    this.setCircuit({ ...this.circuit, tour: null, rel });
    this.setBookings({ ...this.bookings, items: this.bookings.items.filter((b) => !(b.special?.startsWith('tour:') && b.status === 'accepted')) });
  }

  /** a new career: every career save and its backup gone */
  erase(): void {
    for (const s of ALL_SPECS) this.saves.erase(s.kind);
    this.profile = PROFILE.defaults();
    this.progress = PROGRESS.defaults();
    this.looks = LOOKS.defaults();
    this.bookings = BOOKINGS.defaults();
    this.feed = FEED.defaults();
    this.setCircuit(cleanCircuit(null));
    this.changed.emit('profile', this.profile);
    this.changed.emit('progress', this.progress);
    this.changed.emit('look', this.look);
    this.changed.emit('bookings', this.bookings);
    this.changed.emit('feed', this.feed);
  }
}
