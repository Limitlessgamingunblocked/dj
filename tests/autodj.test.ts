import { describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import { adoptRate, AutoDJ, mixCurves, pickNext, startHere, type AutoDJHooks } from '../src/app/autodj';

describe('picking the next track', () => {
  const am = makeKey(9, true); // 8A
  const pool = [
    { id: 'clash-close', bpm: 124, key: makeKey(1, false) },
    { id: 'match-far', bpm: 140, key: am },
    { id: 'match', bpm: 125, key: makeKey(4, true) }, // 9A, a step round the wheel
    { id: 'same-key', bpm: 123, key: am },
  ];
  it('prefers a compatible key at a close tempo', () => {
    expect(pickNext({ bpm: 124, key: am }, pool, new Set(), () => 0.5)?.id).toBe('same-key');
    expect(pickNext({ bpm: 124, key: am }, pool, new Set(['same-key']), () => 0.5)?.id).toBe('match');
  });
  it('reads half and double time as close', () => {
    const half = [{ id: 'half', bpm: 62, key: am }, { id: 'far', bpm: 100, key: am }];
    expect(pickNext({ bpm: 124, key: am }, half, new Set(), () => 0)?.id).toBe('half');
  });
  it('skips what has been played, and returns nothing when nothing is left', () => {
    expect(pickNext({ bpm: 124, key: am }, pool, new Set(pool.map((p) => p.id)), () => 0)).toBeNull();
  });
});

describe('the mix itself', () => {
  it('moves the crossfader smoothly and swaps the basses around the half', () => {
    expect(mixCurves(0)).toEqual({ travel: 0, inLow: 0, outLow: 0.5 });
    expect(mixCurves(1)).toEqual({ travel: 1, inLow: 0.5, outLow: 0 });
    const mid = mixCurves(0.5);
    expect(mid.travel).toBeCloseTo(0.5, 6);
    // never both basses fully up at once
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const c = mixCurves(p);
      expect(c.inLow + c.outLow).toBeLessThanOrEqual(0.5 + 1e-9);
      if (p > 0) expect(c.travel).toBeGreaterThanOrEqual(mixCurves(p - 0.01).travel);
    }
  });
  it('starts on the last 8-bar line that leaves room for the whole mix', () => {
    // 64 beats of mix: at 120 beats left the next line (88 left) still has room
    expect(startHere(120, 64)).toBe(false);
    expect(startHere(96, 64)).toBe(true);
  });
  it("hands the synced tempo to the deck's own fader, widening its range if it has to", () => {
    const d = { tempoRate: 1.05, range: 0.08, tempo: 0, setRange(r: number) { this.range = r; } };
    adoptRate(d);
    expect(1 + d.tempo * d.range).toBeCloseTo(1.05, 6);
    const e = { tempoRate: 1.12, range: 0.08, tempo: 0, setRange(r: number) { this.range = r; } };
    adoptRate(e);
    expect(e.range).toBe(0.16);
    expect(1 + e.tempo * e.range).toBeCloseTo(1.12, 6);
  });
});

/* ------------------------------------------------------------------ */
/* a whole session on fake decks                                         */
/* ------------------------------------------------------------------ */

class FakeDeck {
  track: { id: string; meta: { title: string } } | null = null;
  analysis: { bpm: number; firstBeat: number; key: ReturnType<typeof makeKey> } | null = null;
  duration = 0;
  pos = 0;
  playing = false;
  sync = false;
  isMaster = false;
  syncRate = 1;
  tempo = 0;
  range = 0.08;
  constructor(readonly id: number) {}
  get loaded() {
    return !!this.track && this.duration > 0;
  }
  get beatLen() {
    return this.analysis ? 60 / this.analysis.bpm : 0.5;
  }
  get tempoRate() {
    return this.sync && !this.isMaster ? this.syncRate : 1 + this.tempo * this.range;
  }
  get rate() {
    return this.tempoRate;
  }
  get bpm() {
    return (this.analysis?.bpm ?? 0) * this.tempoRate;
  }
  get remaining() {
    return Math.max(0, this.duration - this.pos);
  }
  position() {
    return this.pos;
  }
  beatPosition(t = this.pos) {
    return (t - (this.analysis?.firstBeat ?? 0)) / this.beatLen;
  }
  currentKey() {
    return this.analysis?.key ?? null;
  }
  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(t: number) {
    this.pos = t;
  }
  setSync(on: boolean) {
    this.sync = on;
  }
  setRange(r: number) {
    this.range = r;
  }
  load(id: string, bpm: number, seconds: number) {
    this.track = { id, meta: { title: id } };
    this.analysis = { bpm, firstBeat: 0.25, key: makeKey(9, true) };
    this.duration = seconds;
    this.pos = 0;
    this.tempo = 0;
  }
}

function session(opts: { setIds?: string[] } = {}) {
  const decks = [new FakeDeck(1), new FakeDeck(2)];
  const channels = decks.map((_, i) => ({ state: { assign: i === 0 ? 'A' : 'B', fader: 0.8, low: 0.5 }, setEq(b: 'low', v: number) { this.state[b] = v; }, setFader(v: number) { this.state.fader = v; } }));
  const mixer = { xfader: 0.5, setCrossfader(v: number) { this.xfader = v; } };
  let listener: ((e: { id: string; source: string }) => void) | null = null;
  const reg = { on: (_: string, fn: typeof listener) => (listener = fn) };
  const library = ['b', 'c', 'd'].map((id) => ({ id, status: 'ready', analysis: { bpm: 122, key: makeKey(9, true) } }));
  const notes: string[] = [];
  const set = [...(opts.setIds ?? [])];
  const hooks: AutoDJHooks = {
    loadTrack: async (d, id) => decks[d - 1].load(id, id === 'a' ? 120 : 122, 150),
    nextFromSet: () => set.shift() ?? null,
    candidates: () => library as never,
    mixBars: () => 16,
    note: (kind, d, o) => notes.push(`${kind}:${d.track?.id}${o ? `>${o.track?.id}` : ''}`),
  };
  const engine = { deck: (n: number) => decks[n - 1], channels, mixer };
  const dj = new AutoDJ(engine as never, reg as never, hooks);
  decks[0].load('a', 120, 150);
  // a stand-in for the engine's sync: the playing unsynced deck leads, the synced one follows its tempo
  const step = (dt: number) => {
    const lead = decks.find((d) => d.playing && !d.sync) ?? decks.find((d) => d.playing);
    for (const d of decks) {
      d.isMaster = d === lead;
      if (lead && d !== lead && d.sync && d.analysis && lead.analysis) d.syncRate = lead.bpm / d.analysis.bpm;
      if (d.playing) {
        d.pos += dt * d.rate;
        if (d.pos >= d.duration) {
          d.pos = d.duration;
          d.playing = false;
        }
      }
    }
    dj.update();
  };
  return { decks, channels, mixer, dj, notes, step, touch: (id: string) => listener?.({ id, source: 'ui' }) };
}

async function run(s: ReturnType<typeof session>, seconds: number, each?: (t: number) => void) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    s.step(dt);
    each?.(t);
    await Promise.resolve();
  }
}

describe('Auto DJ on two decks', () => {
  it('mixes the next track in on a phrase line, before the end, and keeps going', async () => {
    const s = session();
    expect(s.dj.start()).toBe(true);
    expect(s.decks[0].playing).toBe(true);
    expect(s.mixer.xfader).toBe(0);
    let startBeat = Number.NaN;
    let startRemaining = Number.NaN;
    let lastXf = 0;
    let monotonic = true;
    await run(s, 150, () => {
      if (Number.isNaN(startBeat) && s.dj.phase === 'mixing') {
        startBeat = s.decks[0].beatPosition();
        startRemaining = s.decks[0].remaining / s.decks[0].beatLen;
      }
      if (s.dj.phase === 'mixing') {
        if (s.mixer.xfader < lastXf - 1e-9) monotonic = false;
        lastXf = s.mixer.xfader;
      }
    });
    // the mix began just after an 8-bar line (within a frame) with room for all 16 bars
    expect(startBeat % 32).toBeLessThan(0.1);
    expect(startRemaining).toBeGreaterThanOrEqual(64);
    expect(monotonic).toBe(true);
    // deck 2 now leads, deck 1 stopped with its bass back up; the crossfader is over on B
    // b, c and d are equally good matches: any of them
    expect(s.notes[0]).toMatch(/^start:a>[bcd]$/);
    const first = s.notes[0].slice(-1);
    expect(s.notes).toContain(`done:${first}>a`);
    expect(s.decks[0].playing).toBe(false);
    expect(s.decks[1].playing).toBe(true);
    expect(s.mixer.xfader).toBe(1);
    expect(s.channels[0].state.low).toBe(0.5);
    expect(s.channels[1].state.low).toBe(0.5);
    // it kept deck 1's tempo (120) instead of jumping back to its own 122
    expect(s.decks[1].bpm).toBeCloseTo(120, 3);
    // and the next one is already lined up on deck 1, not a repeat
    await run(s, 140);
    expect(['b', 'c', 'd'].filter((x) => x !== first)).toContain(s.decks[0].track?.id);
    expect(s.notes.filter((n) => n.startsWith('done')).length).toBeGreaterThanOrEqual(2);
  });

  it('follows the Set Builder set first', async () => {
    const s = session({ setIds: ['d'] });
    s.dj.start();
    await run(s, 140);
    expect(s.notes[0]).toBe('start:a>d');
  });

  it('uses a track you loaded on the free deck yourself', async () => {
    const s = session();
    s.decks[1].load('mine', 121, 150);
    s.dj.start();
    await run(s, 140);
    expect(s.notes[0]).toBe('start:a>mine');
  });

  it('hands the mix back when you touch the crossfader', async () => {
    const s = session();
    s.dj.start();
    // 150 s at 120 BPM: the last 8-bar line with room for 16 bars is beat 224, at 112.25 s
    await run(s, 116);
    expect(s.dj.phase).toBe('mixing');
    s.touch('mixer.xfader');
    expect(s.dj.on).toBe(false);
    expect(s.notes).toContain('off:a');
    // a control on another channel doesn't count
    const t = session();
    t.dj.start();
    t.touch('ch.3.fader');
    expect(t.dj.on).toBe(true);
  });

  it('turned on late, it still gets a shorter mix in before the end', async () => {
    const s = session();
    s.decks[0].pos = 150 - 30; // 30 s (60 beats) left: less than a 16-bar mix
    s.dj.start();
    await run(s, 40);
    expect(s.notes[0]).toMatch(/^start:a>[bcd]$/);
    expect(s.decks[1].playing).toBe(true);
  });
});
