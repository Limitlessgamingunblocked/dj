import { describe, expect, it } from 'vitest';
import { makeKey } from '../src/analysis/keys';
import { bandFor, gradeFor, phaseErrorMs, SLOTS, VibeMeter, type DeckSnap, type VibeEvent, type VibeInput } from '../src/game/vibe';

const BPM = 124;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

const deck = (id: number, o: Partial<DeckSnap> = {}): DeckSnap => ({
  id,
  trackId: `t${id}`,
  artist: `artist ${id}`,
  playing: true,
  audible: 0,
  bpm: BPM,
  beat: 0,
  key: makeKey(9, true),
  energy: 0.6,
  section: 'groove',
  low: 0.5,
  filter: 0.5,
  echo: false,
  roll: false,
  ...o,
});

/** run a set: `frame(t)` returns the decks at game time t; returns every event */
function run(v: VibeMeter, secs: number, frame: (t: number) => Partial<VibeInput> & { decks: DeckSnap[] }, from = 0, dt = 0.05): VibeEvent[] {
  const events: VibeEvent[] = [];
  for (let t = from; t < from + secs; t += dt) {
    const f = frame(t);
    events.push(...v.update({ t, dt, level: 0.5, redline: 0, progress: 0.5, dropHit: false, ...f }));
  }
  return events;
}

const names = (es: VibeEvent[]) => es.map((e) => ('name' in e ? e.name : e.kind));

describe('beatmatching', () => {
  it('scores the phase error in milliseconds against the brief’s bands', () => {
    expect(bandFor(5)).toBe('perfect');
    expect(bandFor(20)).toBe('good');
    expect(bandFor(40)).toBe('loose');
    expect(bandFor(80)).toBe('trainwreck');
    // a quarter of a beat out at 124 BPM is about 121 ms
    expect(phaseErrorMs({ beat: 10.25, bpm: 124 }, { beat: 3, bpm: 124 })).toBeCloseTo(121, 0);
    // folded: 0.9 beats ahead is 0.1 behind
    expect(phaseErrorMs({ beat: 0.9, bpm: 124 }, { beat: 0, bpm: 124 })).toBeCloseTo(48.4, 0);
  });

  it('a drifting blend is a trainwreck: the vibe drops but the set goes on', () => {
    const v = new VibeMeter();
    v.vibe = 0.6;
    const es = run(v, 20, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT }), deck(2, { audible: t > 4 ? 0.9 : 0, beat: t / BEAT + 0.3 })] }));
    expect(names(es)).toContain('trainwreck');
    expect(v.vibe).toBeLessThan(0.5);
    expect(v.band).toBe('trainwreck');
  });
});

describe('transitions', () => {
  /** deck 1 plays; deck 2 comes in at `inAt`, deck 1 leaves at `outAt`; `tweak` changes either deck */
  const mix = (inAt: number, outAt: number, tweak: (t: number, a: DeckSnap, b: DeckSnap) => void = () => undefined) => (t: number) => {
    const a = deck(1, { audible: t < outAt ? 1 : 0, beat: t / BEAT });
    const b = deck(2, { audible: t >= inAt ? 1 : 0, beat: t / BEAT + 8 });
    tweak(t, a, b);
    return { decks: [a, b] };
  };

  it('names a long blend after 16+ clean bars', () => {
    const v = new VibeMeter();
    const es = run(v, 30 * BAR, mix(4 * BAR, 22 * BAR));
    const tr = es.find((e) => e.kind === 'transition');
    expect(tr && tr.kind === 'transition' && tr.name).toBe('long_blend');
    expect(tr && tr.kind === 'transition' && tr.points).toBe(Math.round((150 * 1.2 * 1.2) / 10) * 10);
  });

  it('names a bass swap: the lows trade places within a couple of bars', () => {
    const v = new VibeMeter();
    const es = run(
      v,
      14 * BAR,
      mix(2 * BAR, 10 * BAR, (t, a, b) => {
        b.low = t < 6 * BAR ? 0 : 0.5;
        a.low = t < 6 * BAR + BEAT ? 0.5 : 0;
      }),
    );
    expect(names(es)).toContain('bass_swap');
    expect(names(es)).not.toContain('long_blend');
  });

  it('names a filter fade and an echo out on the way out', () => {
    const v1 = new VibeMeter();
    const f = run(v1, 14 * BAR, mix(2 * BAR, 10 * BAR, (t, a) => (a.filter = t > 7 * BAR ? 0.08 : 0.5)));
    expect(names(f)).toContain('filter_fade');
    const v2 = new VibeMeter();
    const e = run(v2, 14 * BAR, mix(2 * BAR, 10 * BAR, (t, a) => (a.echo = t > 9 * BAR)));
    expect(names(e)).toContain('echo_out');
  });

  it('names a quick cut on the one, but not off the beat', () => {
    const cutOn = 8 * BAR;
    const v = new VibeMeter();
    const es = run(v, 12 * BAR, (t) => ({ decks: [deck(1, { audible: t < cutOn ? 1 : 0, beat: t / BEAT }), deck(2, { audible: t >= cutOn - 0.05 ? 1 : 0, beat: (t - cutOn) / BEAT })] }));
    expect(names(es)).toContain('quick_cut');
    const off = cutOn + BEAT * 1.5;
    const v2 = new VibeMeter();
    const es2 = run(v2, 12 * BAR, (t) => ({ decks: [deck(1, { audible: t < off ? 1 : 0, beat: t / BEAT }), deck(2, { audible: t >= off - 0.05 ? 1 : 0, beat: (t - cutOn) / BEAT })] }));
    expect(names(es2)).not.toContain('quick_cut');
  });

  it('pays more for a key-compatible mix and penalises a clash', () => {
    const v = new VibeMeter();
    v.vibe = 0.6;
    const es = run(v, 30 * BAR, mix(4 * BAR, 22 * BAR, (_t, _a, b) => (b.key = makeKey(3, false))));
    expect(names(es)).toContain('key_clash');
    const tr = es.find((e) => e.kind === 'transition');
    expect(tr && tr.kind === 'transition' && tr.keyBonus).toBe(false);
    expect(tr && tr.kind === 'transition' && tr.points).toBe(Math.round((150 * 1.2 * 0.8) / 10) * 10);
  });
});

describe('drops', () => {
  /** one deck through a build into a drop at `dropAt` */
  const into = (dropAt: number, o: Partial<DeckSnap> = {}) => (t: number) => deck(1, { audible: 1, beat: t / BEAT, section: t < dropAt - 16 * BEAT ? 'breakdown' : t < dropAt ? 'build' : 'drop', ...o });

  it('rewards a drop after a proper build, with a loop roll into it', () => {
    const v = new VibeMeter();
    const at = 12 * BAR;
    const es = run(v, 14 * BAR, (t) => ({ decks: [into(at, { roll: t > at - 2 * BAR && t < at })(t)] }));
    expect(names(es)).toContain('drop');
    expect(names(es)).toContain('loop_roll');
    const d = es.find((e) => e.kind === 'drop');
    expect(d && d.kind === 'drop' && d.built).toBe(true);
  });

  it('a double drop: two beatmatched decks drop together', () => {
    const v = new VibeMeter();
    const at = 12 * BAR;
    const es = run(v, 14 * BAR, (t) => ({ decks: [into(at)(t), { ...into(at)(t), id: 2, trackId: 't2' }] }));
    expect(names(es)).toContain('double_drop');
  });

  it('too many drops with no breathing room costs', () => {
    const v = new VibeMeter();
    // drops at bars 8, 16 and 24, each after a 4-bar build
    const section = (t: number) => {
      const bar = t / BAR;
      const inBar = bar % 8;
      return bar < 4 ? 'groove' : inBar >= 4 ? 'build' : inBar < 3 ? 'drop' : 'groove';
    };
    const es = run(v, 27 * BAR, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT, section: section(t) })] }));
    expect(names(es).filter((n) => n === 'drop')).toHaveLength(2);
    expect(names(es)).toContain('drop_spam');
  });
});

describe('mistakes, slots and the score', () => {
  it('dead air hurts once the music has started', () => {
    const v = new VibeMeter();
    v.vibe = 0.6;
    // silence before the first track is fine
    expect(names(run(v, 5, () => ({ decks: [deck(1, { playing: false })], level: 0 })))).not.toContain('dead_air');
    run(v, 5, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT })] }), 5);
    const es = run(v, 6, () => ({ decks: [deck(1, { playing: false })], level: 0 }), 10);
    expect(names(es)).toContain('dead_air');
    expect(v.vibe).toBeLessThan(0.6);
  });

  it('redlining the master costs', () => {
    const v = new VibeMeter();
    const es = run(v, 4, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT })], redline: 0.9 }));
    expect(names(es)).toContain('redline');
  });

  it('a warm-up wants it deep: going peak-time too early is called out', () => {
    const warm = new VibeMeter(SLOTS.warmup);
    const es = run(warm, 40, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT, energy: 0.95 })], progress: 0.1 }));
    expect(names(es)).toContain('too_hard');
    // and the vibe settles lower than playing to the slot
    const right = new VibeMeter(SLOTS.warmup);
    run(right, 40, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT, energy: 0.35 })], progress: 0.1 }));
    expect(right.vibe).toBeGreaterThan(warm.vibe);
  });

  it('the same energy for six minutes tires the crowd', () => {
    const v = new VibeMeter();
    const es = run(v, 400, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT, energy: 0.7 })] }), 0, 0.25);
    expect(names(es)).toContain('fatigue');
  });

  it('pays a comeback for getting the room back fast', () => {
    const v = new VibeMeter();
    v.vibe = 0.25;
    run(v, 1, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT })] }));
    v.vibe = 0.75;
    const es = run(v, 1, (t) => ({ decks: [deck(1, { audible: 1, beat: t / BEAT })] }), 60);
    expect(names(es)).toContain('comeback');
  });

  it('every slot has a target curve in range, and grades run D to S', () => {
    for (const s of Object.values(SLOTS)) for (let p = 0; p <= 1; p += 0.05) expect(s.target(p)).toBeGreaterThan(0.2), expect(s.target(p)).toBeLessThan(1);
    expect(SLOTS.warmup.target(0)).toBeLessThan(SLOTS.peak.target(0.5));
    expect(SLOTS.closing.target(1)).toBeGreaterThan(SLOTS.closing.target(0.5));
    expect(gradeFor(0.95, 900)).toBe('S');
    expect(gradeFor(0.8, 100)).toBe('A');
    expect(gradeFor(0.65, 100)).toBe('B');
    expect(gradeFor(0.5, 60)).toBe('C');
    expect(gradeFor(0.2, 0)).toBe('D');
    // points help, but can't carry a cold room
    expect(gradeFor(0.3, 5000)).not.toBe('S');
  });

  it('keeps a timeline and the peak for the results screen', () => {
    const v = new VibeMeter();
    run(v, 30 * BAR, (t) => ({ decks: [deck(1, { audible: t < 22 * BAR ? 1 : 0, beat: t / BEAT }), deck(2, { audible: t >= 4 * BAR ? 1 : 0, beat: t / BEAT })] }));
    expect(v.timeline.length).toBeGreaterThan(20);
    expect(v.peak.vibe).toBeGreaterThan(0);
    expect(v.best?.name).toBe('long_blend');
    expect(v.points).toBeGreaterThan(0);
  });
});
