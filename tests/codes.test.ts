import { describe, expect, it } from 'vitest';
import { MAX_TIER, PROGRESS } from '../src/core/models';
import { redeemCode } from '../src/game/codes';
import { CAREER_VENUES, TIER_FAME, venueLock } from '../src/game/progression';

describe('codes', () => {
  it('FAME opens every career venue for gigs and maxes out fame, from a new career', () => {
    const p = PROGRESS.defaults();
    expect(CAREER_VENUES.some((v) => venueLock(v, p))).toBe(true);
    const r = redeemCode('FAME', p)!;
    const after = PROGRESS.validate({ ...p, ...r.patch });
    for (const v of CAREER_VENUES) expect(venueLock(v, after), v).toBeNull();
    expect(after.tier).toBe(MAX_TIER);
    expect(after.fame).toBe(TIER_FAME[MAX_TIER - 1]);
    // it doesn't fake a set played or switch on the debug sandbox
    expect(after.setsPlayed).toBe(0);
    expect(after.sandbox).toBe(false);
  });

  it('ignores case and spaces, keeps fame already past the top, and adds nothing twice', () => {
    const p = { ...PROGRESS.defaults(), fame: 9000, unlocked: ['venue:boat'] };
    const r = redeemCode('  fame ', p)!;
    expect(r.patch.fame).toBe(9000);
    expect(r.patch.unlocked!.filter((u) => u === 'venue:boat')).toHaveLength(1);
    expect(r.patch.unlocked).toContain('room:mirror');
  });

  it('turns down anything that isn’t a code', () => {
    expect(redeemCode('FAMES', PROGRESS.defaults())).toBeNull();
    expect(redeemCode('', PROGRESS.defaults())).toBeNull();
  });
});
