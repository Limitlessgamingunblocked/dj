import { describe, expect, it } from 'vitest';
import { formatKey, makeKey, openKey, parseKeyTag } from '../src/analysis/keys';
import { assignable, assignKey, chordFor, effectiveKeys, KEY_DEFS, keyForControl, keyName } from '../src/app/keyboard';
import { cleanSettings, DEFAULTS } from '../src/app/settingsModel';
import { BACKUP_KIND, makeBackup, parseBackup } from '../src/core/backup';
import { DEFAULT_PREFS, sanitizePrefs } from '../src/core/prefs';
import { crowdArea, setCrowdScale } from '../src/three/venues/crowd';

describe('preferences', () => {
  it('fall back to the defaults for anything missing or broken', () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs('nonsense')).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs([1, 2])).toEqual(DEFAULT_PREFS);
    const p = sanitizePrefs({ keyNotation: 'klingon', waveScheme: 7, tempoRange: 0.33, jogMode: 'laser', loopBeats: 3, endWarning: 'soon', loadLock: 'yes' });
    expect(p.keyNotation).toBe('camelot');
    expect(p.waveScheme).toBe('rgb');
    expect(p.tempoRange).toBe(0.08);
    expect(p.jogMode).toBe('vinyl');
    expect(p.loopBeats).toBe(4);
    expect(p.endWarning).toBe(30);
    expect(p.loadLock).toBe(true);
  });

  it('keep good values and clamp numbers into range', () => {
    const p = sanitizePrefs({ keyNotation: 'openkey', tempoRange: 0.16, keylock: true, uiScale: 9, crowd: -1, endWarning: 500, loopBeats: 16 });
    expect(p.keyNotation).toBe('openkey');
    expect(p.tempoRange).toBe(0.16);
    expect(p.keylock).toBe(true);
    expect(p.uiScale).toBe(1.3);
    expect(p.crowd).toBe(0);
    expect(p.endWarning).toBe(120);
    expect(p.loopBeats).toBe(16);
    // a hand-edited 1.234 snaps to a 5 % step
    expect(sanitizePrefs({ uiScale: 1.234 }).uiScale).toBe(1.25);
  });

  it('only accept real colours, and an empty accent means "follow the venue"', () => {
    const p = sanitizePrefs({ accent: 'red', deckColors: ['#ABCDEF', 'blue', 12] });
    expect(p.accent).toBe('');
    expect(p.deckColors).toEqual(['#abcdef', DEFAULT_PREFS.deckColors[1], DEFAULT_PREFS.deckColors[2], DEFAULT_PREFS.deckColors[3]]);
    expect(sanitizePrefs({ accent: '#00FF00' }).accent).toBe('#00ff00');
  });

  it('drop key overrides that are not key codes', () => {
    const p = sanitizePrefs({ keys: { KeyQ: 'KeyA', KeyW: '', 'Shift+KeyT': 'Shift+KeyY', KeyE: 'rm -rf', '<b>': 'KeyA', KeyR: 5, KeyU: 'KeyU' } });
    expect(p.keys).toEqual({ KeyQ: 'KeyA', KeyW: '', 'Shift+KeyT': 'Shift+KeyY' });
  });
});

describe('keyboard shortcuts', () => {
  it('have a unique default key for every binding', () => {
    const keys = KEY_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(effectiveKeys({}).size).toBe(KEY_DEFS.length);
    expect(effectiveKeys({}).get('Space')?.id).toBe('deck.L.play');
    expect(effectiveKeys({}).get('Shift+KeyB')?.action).toBe('board-full');
    // the camera: Shift + arrows orbit and tilt, = and - zoom, Shift+V the next angle; plain arrows still browse and load
    expect(effectiveKeys({}).get('Shift+ArrowLeft')?.id).toBe('cam.left');
    expect(effectiveKeys({}).get('Shift+ArrowUp')?.id).toBe('cam.raise');
    expect(effectiveKeys({}).get('Equal')?.id).toBe('cam.in');
    expect(effectiveKeys({}).get('Shift+KeyV')?.id).toBe('cam.next');
    expect(effectiveKeys({}).get('ArrowLeft')?.id).toBe('deck.L.load');
  });

  it('move a binding to a free key', () => {
    const { keys, displaced } = assignKey({}, 'KeyN', 'Semicolon');
    expect(displaced).toEqual([]);
    expect(keys).toEqual({ KeyN: 'Semicolon' });
    const map = effectiveKeys(keys);
    expect(map.get('Semicolon')?.id).toBe('light.strobe');
    expect(map.has('KeyN')).toBe(false);
  });

  it('take a key that is in use away from the other binding', () => {
    const { keys, displaced } = assignKey({}, 'KeyN', 'KeyB');
    expect(displaced.map((d) => d.id)).toEqual(['light.blinder']);
    const map = effectiveKeys(keys);
    expect(map.get('KeyB')?.id).toBe('light.strobe');
    expect([...map.values()].some((d) => d.id === 'light.blinder')).toBe(false);
    // no two bindings ever share a key
    expect(map.size).toBe(KEY_DEFS.length - 1);
  });

  it('go back to the default, freeing it from whatever had taken it', () => {
    let k = assignKey({}, 'KeyN', 'KeyB').keys;
    k = assignKey(k, 'KeyB', 'KeyB').keys;
    expect(chordFor(KEY_DEFS.find((d) => d.key === 'KeyB')!, k)).toBe('KeyB');
    expect(chordFor(KEY_DEFS.find((d) => d.key === 'KeyN')!, k)).toBe('');
    // putting strobe back on N clears every override
    expect(assignKey(k, 'KeyN', 'KeyN').keys).toEqual({});
  });

  it('can leave a binding without a key, and use the Shift layer', () => {
    const k = assignKey({}, 'KeyG', '').keys;
    expect(k).toEqual({ KeyG: '' });
    expect([...effectiveKeys(k).values()].some((d) => d.id === 'fx.on')).toBe(false);
    const s = assignKey({}, 'KeyG', 'Shift+KeyG').keys;
    expect(effectiveKeys(s).get('Shift+KeyG')?.id).toBe('fx.on');
    expect(keyForControl('fx.on', s)).toBe('⇧G');
  });

  it('let a moved binding win over a default left on the same key (old or hand-edited files)', () => {
    const map = effectiveKeys({ KeyN: 'KeyB' });
    expect(map.get('KeyB')?.id).toBe('light.strobe');
  });

  it('print keys the way they look on the keyboard and refuse the reserved ones', () => {
    expect(keyName('KeyQ')).toBe('Q');
    expect(keyName('Digit7')).toBe('7');
    expect(keyName('Shift+KeyT')).toBe('⇧T');
    expect(keyName('BracketLeft')).toBe('[');
    expect(keyName('Numpad4')).toBe('Num 4');
    expect(keyName('')).toBe('—');
    for (const c of ['Escape', 'Tab', 'ShiftLeft', 'MetaRight', 'F5', 'Enter', 'Backspace', '']) expect(assignable(c)).toBe(false);
    for (const c of ['KeyQ', 'Digit0', 'Semicolon', 'ArrowUp', 'Numpad1']) expect(assignable(c)).toBe(true);
  });
});

describe('key notation', () => {
  it('writes Open Key with C major on 1d and A minor on 1m', () => {
    expect(openKey(makeKey(0, false))).toBe('1d');
    expect(openKey(makeKey(9, true))).toBe('1m');
    expect(openKey(makeKey(7, false))).toBe('2d');
    expect(openKey(makeKey(11, false))).toBe('6d');
  });

  it('formats a key in each notation', () => {
    const am = makeKey(9, true);
    expect(formatKey(am, 'camelot')).toBe('8A');
    expect(formatKey(am, 'openkey')).toBe('1m');
    expect(formatKey(am, 'musical')).toBe('Am');
    expect(formatKey(am, 'both')).toBe('8A Am');
  });

  it('reads every key back from Camelot, Open Key and musical tags', () => {
    for (let r = 0; r < 12; r++)
      for (const minor of [false, true]) {
        const k = makeKey(r, minor);
        for (const tag of [k.camelot, openKey(k), k.name]) {
          const p = parseKeyTag(tag);
          expect(p?.camelot, tag).toBe(k.camelot);
        }
      }
  });
});

describe('settings files', () => {
  it('round-trip through export and import', () => {
    const entries = { prefs: { keyNotation: 'openkey' }, settings: { venue: 'berghain' }, 'anchors:club4': [{ name: 'Low' }], midiMappings: [] };
    const text = JSON.stringify(makeBackup(entries, new Date('2026-01-01T00:00:00Z')));
    expect(parseBackup(text)).toEqual(entries);
    expect(JSON.parse(text).kind).toBe(BACKUP_KIND);
  });

  it('refuse files that are not Deckhouse settings', () => {
    expect(() => parseBackup('not json')).toThrow(/JSON/);
    expect(() => parseBackup('{"kind":"other","version":1,"entries":{}}')).toThrow(/Deckhouse/);
    expect(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 2, entries: {} }))).toThrow(/newer/);
    expect(() => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1, entries: [] }))).toThrow(/damaged/);
  });

  it('skip entries with odd names', () => {
    const text = JSON.stringify({ kind: BACKUP_KIND, version: 1, entries: { prefs: {}, '../../x': 1, '': 2, 'a b': 3 } });
    expect(Object.keys(parseBackup(text))).toEqual(['prefs']);
  });

  it('only keep app settings with the type the app expects', () => {
    const s = cleanSettings({ venue: 'printworks', quality: 5, focus: 'yes', vis: [1], lights: { palette: 'custom', custom: ['#ff0000', 'red', '#00ff00'] }, boardFraming: 'sideways', unknown: 1 });
    expect(s.venue).toBe('printworks');
    expect(s.quality).toBe(DEFAULTS.quality);
    expect(s.focus).toBe(DEFAULTS.focus);
    expect(s.vis).toEqual({});
    expect(s.lights).toEqual({ palette: 'custom' });
    expect(s.boardFraming).toBeUndefined();
    expect('unknown' in s).toBe(false);
    expect(cleanSettings(null)).toEqual({ ...DEFAULTS, vis: {}, lights: {} });
    expect(cleanSettings({ lights: { custom: ['#ff0000', '#00ff00', '#0000ff'] } }).lights.custom).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('remember any camera angle for board full screen, and only Top-down or Angled as its home', () => {
    const s = cleanSettings({ boardFraming: 'crowd', boardHome: 'perf', camPad: false });
    expect(s.boardFraming).toBe('crowd');
    expect(s.boardHome).toBe('perf');
    expect(s.camPad).toBe(false);
    const bad = cleanSettings({ boardFraming: 'ceiling', boardHome: 'crowd', camPad: 'no' });
    expect(bad.boardFraming).toBeUndefined();
    expect(bad.boardHome).toBeUndefined();
    expect(bad.camPad).toBe(true);
  });
});

describe('crowd size', () => {
  it('scales the number of dancers, down to an empty room', () => {
    const n = (k: number) => {
      setCrowdScale(k);
      return crowdArea(-10, 10, -2, -22, 1.5, 7).length;
    };
    const full = n(1);
    expect(n(0)).toBe(0);
    expect(n(0.5) / full).toBeGreaterThan(0.4);
    expect(n(0.5) / full).toBeLessThan(0.6);
    expect(n(1.5) / full).toBeGreaterThan(1.3);
    setCrowdScale(1);
  });
});
