import { describe, expect, it } from 'vitest';
import { cleanSettings } from '../src/app/settingsModel';
import { sanitizePrefs } from '../src/core/prefs';
import { VIEW_LABELS, LIVE_VIEWS } from '../src/three/CameraRig';
import { approachLook, copyLook, LENS_LOOKS, lookFor, LOOKS, VIEW_LOOKS } from '../src/three/looks';

describe('lens looks', () => {
  it('give each special angle its own look on Auto, and nothing to the plain ones', () => {
    expect(lookFor('fisheye', 'auto')).toBe('fisheye');
    expect(lookFor('cctv', 'auto')).toBe('cctv');
    expect(lookFor('camcorder', 'auto')).toBe('vhs');
    expect(lookFor('rig', 'auto')).toBe('tiltshift');
    expect(lookFor('perf', 'auto')).toBe('none');
    expect(lookFor('crowd', 'auto')).toBe('none');
  });

  it('let a picked look go on any angle', () => {
    expect(lookFor('perf', 'thermal')).toBe('thermal');
    expect(lookFor('fisheye', 'none')).toBe('none');
  });

  it('cover every look in the list, and only angles that exist', () => {
    for (const l of LENS_LOOKS) expect(LOOKS[l.id]).toBeDefined();
    for (const v of Object.keys(VIEW_LOOKS)) expect(Object.keys(VIEW_LABELS)).toContain(v);
    for (const v of LIVE_VIEWS) expect(Object.keys(VIEW_LABELS)).toContain(v);
  });

  it('blend smoothly towards the wanted look; frame rate and lens width switch at once', () => {
    const cur = copyLook(LOOKS.none);
    approachLook(cur, LOOKS.cctv, 0.5);
    expect(cur.mono).toBeCloseTo(0.5, 6);
    expect(cur.fps).toBe(LOOKS.cctv.fps);
    expect(cur.fov).toBe(LOOKS.cctv.fov);
    for (let i = 0; i < 60; i++) approachLook(cur, LOOKS.cctv, 0.3);
    expect(cur.mono).toBeCloseTo(1, 4);
    expect(cur.monoTint[1]).toBeCloseTo(LOOKS.cctv.monoTint[1], 4);
    // blending never touches the presets themselves
    expect(LOOKS.none.mono).toBe(0);
    expect(LOOKS.none.monoTint).toEqual([1, 1, 1]);
  });

  it('only the fisheye renders wide; the clean look changes nothing', () => {
    expect(LOOKS.fisheye.fov).toBeGreaterThan(90);
    const n = LOOKS.none;
    expect([n.fish, n.distort, n.mono, n.scan, n.vhs, n.tilt, n.bars, n.thermal, n.fps, n.fov]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('camera settings', () => {
  it('keep the lens choice valid', () => {
    expect(sanitizePrefs({ lens: 'thermal' }).lens).toBe('thermal');
    expect(sanitizePrefs({ lens: 'x-ray' }).lens).toBe('auto');
    expect(sanitizePrefs({}).lens).toBe('auto');
  });

  it('remember the new angles, and drop a saved angle that no longer exists', () => {
    expect(cleanSettings({ camera: 'vertigo' }).camera).toBe('vertigo');
    expect(cleanSettings({ boardFraming: 'cctv' }).boardFraming).toBe('cctv');
    expect(cleanSettings({ camera: 'helicopter' }).camera).toBe('perf');
  });
});
