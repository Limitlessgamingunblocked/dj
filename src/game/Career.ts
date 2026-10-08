/*
 * The career in memory: the DJ profile and progress, loaded through the
 * SaveSystem at start and autosaved on every change. Stage 6 builds the
 * ProgressionSystem (fame, tiers, unlocks, bookings) on top of this; for now
 * the debug menu reads and writes it.
 */
import { Emitter } from '../core/emitter';
import { ALL_SPECS, PROFILE, PROGRESS, type Profile, type Progress } from '../core/models';
import { SaveSystem } from '../core/SaveSystem';

export class Career {
  profile: Profile;
  progress: Progress;
  /** what went wrong loading the saves (shown once to the player) */
  readonly problems: string[] = [];
  readonly changed = new Emitter<{ profile: Profile; progress: Progress }>();

  constructor(readonly saves = new SaveSystem()) {
    const p = saves.load(PROFILE);
    const g = saves.load(PROGRESS);
    for (const r of [p, g]) if (r.problem) this.problems.push(r.problem);
    this.profile = p.data;
    this.progress = g.data;
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

  /** a new career: every career save and its backup gone */
  erase(): void {
    for (const s of ALL_SPECS) this.saves.erase(s.kind);
    this.profile = PROFILE.defaults();
    this.progress = PROGRESS.defaults();
    this.changed.emit('profile', this.profile);
    this.changed.emit('progress', this.progress);
  }
}
