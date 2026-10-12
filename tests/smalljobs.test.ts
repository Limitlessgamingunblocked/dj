import { describe, expect, it } from 'vitest';
import { sanitizePrefs } from '../src/core/prefs';
import { StutterLog, stutterLine, STUTTER_MS } from '../src/core/stutter';
import { idleDue } from '../src/app/broadcast';
import { uiSoundAllowed } from '../src/audio/uisound';
import { wallLevel } from '../src/three/showenv';

describe('the new preferences', () => {
  it('fall back to their defaults and keep only the offered choices', () => {
    const d = sanitizePrefs({});
    expect(d.nightMinutes).toBe(20);
    expect(d.uiSounds).toBe(0.35);
    expect(d.beatPulse).toBe(true);
    expect(d.screensaver).toBe(0);
    const p = sanitizePrefs({ nightMinutes: 33, uiSounds: 4, beatPulse: 'yes', screensaver: 7 });
    expect(p.nightMinutes).toBe(20);
    expect(p.uiSounds).toBe(1);
    expect(p.beatPulse).toBe(true);
    expect(p.screensaver).toBe(0);
    expect(sanitizePrefs({ nightMinutes: 90, uiSounds: 0, beatPulse: false, screensaver: 5 })).toMatchObject({ nightMinutes: 90, uiSounds: 0, beatPulse: false, screensaver: 5 });
  });
});

describe('the stutter log', () => {
  it('logs a late frame with the parts and work of the frame before it', () => {
    const log = new StutterLog();
    expect(log.frame(80, false)).toBeNull(); // nothing to judge yet
    log.part('stage', 40);
    log.part('panels', 3);
    log.part('stage', 12);
    log.note('venue build');
    log.note('venue build');
    log.end(58);
    const s = log.frame(90, false, 0)!;
    expect(s.ms).toBe(90);
    expect(s.work).toBe(58);
    expect(s.parts).toEqual([
      ['stage', 52],
      ['panels', 3],
    ]);
    expect(s.notes).toEqual(['venue build']);
    expect(log.items).toHaveLength(1);
  });

  it('leaves out smooth frames, hidden tabs and long pauses', () => {
    const log = new StutterLog();
    for (const [gap, hidden] of [
      [STUTTER_MS - 1, false],
      [300, true],
      [5000, false],
    ] as const) {
      log.end(5);
      expect(log.frame(gap, hidden)).toBeNull();
    }
    expect(log.items).toHaveLength(0);
  });

  it('keeps the newest forty and writes one readable line each', () => {
    const log = new StutterLog();
    for (let i = 0; i < 50; i++) {
      log.part('stage', i);
      log.end(i + 2);
      log.frame(60 + i, false);
    }
    expect(log.items).toHaveLength(40);
    expect(log.items[0].ms).toBe(109);
    const line = stutterLine({ at: new Date(2026, 0, 1, 21, 4, 13).getTime(), ms: 84, work: 61, parts: [['stage', 52]], notes: ['venue build'] });
    expect(line).toBe('21:04:13  84 ms · stage 52 · venue build · outside 23');
  });
});

describe('the screensaver', () => {
  it('starts only when on, with music playing, after the idle time', () => {
    expect(idleDue(600, 0, true)).toBe(false);
    expect(idleDue(119, 2, true)).toBe(false);
    expect(idleDue(120, 2, true)).toBe(true);
    expect(idleDue(9999, 2, false)).toBe(false);
  });
});

describe('interface sounds', () => {
  it('stay quiet when turned off and don’t stack when fired fast', () => {
    expect(uiSoundAllowed('tap', 1000, 0)).toBe(false);
    expect(uiSoundAllowed('tap', 1000, 0.5, undefined)).toBe(true);
    expect(uiSoundAllowed('tap', 1020, 0.5, 1000)).toBe(false);
    expect(uiSoundAllowed('tap', 1050, 0.5, 1000)).toBe(true);
    expect(uiSoundAllowed('unlock', 1200, 0.5, 1000)).toBe(false);
  });
});

describe('the board’s reflections indoors', () => {
  const base = { master: 1, intensity: 1, wash: 0, movers: 0, blinder: 0, flash: 0, kick: 0, playing: true };
  it('brighten with the rig and on a hit, and dim when the music stops', () => {
    const idle = wallLevel(base);
    expect(wallLevel({ ...base, wash: 1, movers: 1 })).toBeGreaterThan(idle);
    expect(wallLevel({ ...base, blinder: 1 })).toBeGreaterThan(idle + 0.5);
    expect(wallLevel({ ...base, playing: false })).toBeLessThan(idle);
    expect(wallLevel({ ...base, master: 0, playing: false })).toBe(0);
  });
});
