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
import { refreshOffers, seeded } from './bookings';

export class Career {
  profile: Profile;
  progress: Progress;
  looks: { items: Look[]; current: string | null };
  /** the calendar: offers, accepted bookings, the night counter */
  bookings: BookingsSave;
  /** the social feed: fans' posts and your clips */
  feed: FeedSave;
  /** what went wrong loading the saves (shown once to the player) */
  readonly problems: string[] = [];
  readonly changed = new Emitter<{ profile: Profile; progress: Progress; look: Look; bookings: BookingsSave; feed: FeedSave }>();

  constructor(readonly saves = new SaveSystem()) {
    const p = saves.load(PROFILE);
    const g = saves.load(PROGRESS);
    const l = saves.load(LOOKS);
    const b = saves.load(BOOKINGS);
    const f = saves.load(FEED);
    for (const r of [p, g, l, b, f]) if (r.problem) this.problems.push(r.problem);
    this.profile = p.data;
    this.progress = g.data;
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

  setBookings(next: BookingsSave): void {
    this.bookings = BOOKINGS.validate(next);
    this.saves.autosave(BOOKINGS, () => this.bookings);
    this.changed.emit('bookings', this.bookings);
  }

  /** the calendar brought up to tonight: passed offers go, new ones come (the same ones for the same night) */
  refreshBookings(): BookingsSave {
    const next = refreshOffers(this.bookings, this.progress, seeded(this.bookings.night * 7919 + this.progress.setsPlayed));
    if (JSON.stringify(next) !== JSON.stringify(this.bookings)) this.setBookings(next);
    return this.bookings;
  }

  /** a new career: every career save and its backup gone */
  erase(): void {
    for (const s of ALL_SPECS) this.saves.erase(s.kind);
    this.profile = PROFILE.defaults();
    this.progress = PROGRESS.defaults();
    this.looks = LOOKS.defaults();
    this.bookings = BOOKINGS.defaults();
    this.feed = FEED.defaults();
    this.changed.emit('profile', this.profile);
    this.changed.emit('progress', this.progress);
    this.changed.emit('look', this.look);
    this.changed.emit('bookings', this.bookings);
    this.changed.emit('feed', this.feed);
  }
}
