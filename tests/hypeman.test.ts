import { afterEach, describe, expect, it } from 'vitest';
import { answerDelay, MicJudge, micText, timingFor, type MicEvent, type MicInput } from '../src/game/hypeman';
import { hintFor } from '../src/app/hypeman/HypeMan';
import { hostMicRoom, joinAsMc, mcFromUrl, mcLink, type McAction, type McState } from '../src/app/hypeman/link';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** runs the judge at 60 fps; `talk(t)` says when the MC is talking */
function run(j: MicJudge, secs: number, talk: (t: number) => boolean, over: Partial<MicInput> = {}, from = 0): MicEvent[] {
  const out: MicEvent[] = [];
  const dt = 1 / 60;
  const bpm = over.bpm ?? 120;
  for (let t = from; t < from + secs; t += dt) {
    out.push(...j.update({ t, dt, talking: talk(t), playing: true, bpm, beat: (t * bpm) / 60, section: 'groove', vocal: false, vibe: 0.6, ...over }));
  }
  return out;
}

describe('hype man scoring', () => {
  it('reads a shout against the beat', () => {
    expect(timingFor(16.05)).toBe('on_beat');
    expect(timingFor(15.8)).toBe('close');
    expect(timingFor(16.5)).toBe('off');
  });

  it('has the crowd answer on the next beat, at least a quarter-beat after the shout', () => {
    // 120 bpm: half a second a beat
    expect(answerDelay(16, 120, true)).toBeCloseTo(0.5);
    expect(answerDelay(16.9, 120, true)).toBeCloseTo(0.55);
    expect(answerDelay(16, 0, false)).toBeCloseTo(0.35);
  });

  it('fires an armed call on the next short shout, and the crowd answers', () => {
    const j = new MicJudge();
    j.arm('ho', 0);
    // a shout from 1.0 s to 1.5 s: ends on beat 3 at 120 bpm
    const evs = run(j, 3, (t) => t >= 1 && t < 1.5);
    const call = evs.find((e) => e.kind === 'call');
    expect(call).toBeTruthy();
    if (call?.kind !== 'call') return;
    expect(call.call).toBe('ho');
    expect(call.timing).toBe('on_beat');
    expect(call.points).toBeGreaterThan(50);
    expect(call.dv).toBeGreaterThan(0);
    expect(j.armed).toBeNull();
    expect(j.calls).toBe(1);
  });

  it('lands calls best in a breakdown and worse off the beat', () => {
    const strength = (over: Partial<MicInput>, end: number) => {
      const j = new MicJudge();
      j.arm('hands', 0);
      const c = run(j, 3, (t) => t >= 1 && t < end, over).find((e) => e.kind === 'call');
      return c?.kind === 'call' ? c.strength : 0;
    };
    expect(strength({ section: 'breakdown' }, 1.5)).toBeGreaterThan(strength({ section: 'groove' }, 1.5));
    expect(strength({}, 1.5)).toBeGreaterThan(strength({}, 1.75));
  });

  it('gets a tired answer to the same call over and over', () => {
    const j = new MicJudge();
    const pts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const from = i * 4;
      j.arm('noise', from);
      const c = run(j, 4, (t) => t >= from + 1 && t < from + 1.5, {}, from).find((e) => e.kind === 'call');
      pts.push(c?.kind === 'call' ? c.points : 0);
    }
    expect(pts[1]).toBeLessThan(pts[0]);
    expect(pts[2]).toBeLessThan(pts[1]);
  });

  it('scores nothing for a call with no music on', () => {
    const j = new MicJudge();
    j.arm('ho', 0);
    const c = run(j, 3, (t) => t >= 1 && t < 1.5, { playing: false }).find((e) => e.kind === 'call');
    expect(c?.kind === 'call' && c.points).toBe(0);
    expect(micText(c!, 'KAI')?.tone).toBe('bad');
  });

  it('lets an armed call go when nobody shouts', () => {
    const j = new MicJudge();
    j.arm('clap', 0);
    const evs = run(j, 10, () => false);
    expect(evs.some((e) => e.kind === 'missed')).toBe(true);
    expect(j.armed).toBeNull();
  });

  it('rewards hyping a build, but not the same talk in the groove', () => {
    const build = run(new MicJudge(), 3, (t) => t >= 0.5 && t < 1.5, { section: 'build' });
    expect(build.some((e) => e.kind === 'hype')).toBe(true);
    const groove = run(new MicJudge(), 3, (t) => t >= 0.5 && t < 1.5);
    expect(groove.some((e) => e.kind === 'hype')).toBe(false);
  });

  it('calls out talking over the vocal, and never letting the music breathe', () => {
    const over = run(new MicJudge(), 4, (t) => t < 3, { vocal: true });
    expect(over.some((e) => e.kind === 'over_vocal')).toBe(true);
    const nonstop = run(new MicJudge(), 60, () => true);
    expect(nonstop.some((e) => e.kind === 'too_much')).toBe(true);
    const fine = run(new MicJudge(), 60, (t) => t % 10 < 2);
    expect(fine.some((e) => e.kind === 'too_much')).toBe(false);
  });

  it('gives the MC a nudge for the section', () => {
    expect(hintFor('build', true, false, null)).toMatch(/hype/i);
    expect(hintFor('groove', true, true, null)).toMatch(/vocal/i);
    expect(hintFor('drop', false, false, null)).toMatch(/waiting/i);
  });
});

describe('hype man online', () => {
  const g = globalThis as { MediaStream?: unknown };
  const had = g.MediaStream;
  afterEach(() => {
    g.MediaStream = had;
  });

  it('makes and reads the MC link', () => {
    const link = mcLink('K7QMP', 'https://example.com/play/?debug#x');
    expect(link).toBe('https://example.com/play/?mc=K7QMP');
    expect(mcFromUrl(link)).toBe('K7QMP');
    expect(mcFromUrl('https://example.com/?mc=nope!')).toBeNull();
  });

  it('a friend joins by code: their pads and voice reach the booth, the booth’s state reaches their card', async () => {
    // node has no MediaStream: the memory link only needs to wrap a track
    g.MediaStream = class {
      constructor(readonly tracks: unknown[]) {}
      getAudioTracks() {
        return this.tracks;
      }
      getTracks() {
        return this.tracks;
      }
    };
    const booth = await hostMicRoom('DJ KAI', 'memory');
    const acts: McAction[] = [];
    let voice: unknown = null;
    booth.onAction((a) => acts.push(a));
    booth.onVoice((s, remote) => {
      voice = remote ? s : null;
    });
    const shown: McState[] = [];
    const errors: (string | null)[] = [];
    let act: ((a: McAction) => void) | null = null;
    const screen = { show: (s: McState) => shown.push(s), onAct: (fn: (a: McAction) => void) => (act = fn), error: (e: string | null) => errors.push(e) };
    const mic = new (g.MediaStream as new (t: unknown[]) => MediaStream)([{ kind: 'audio' }]);
    const mc = await joinAsMc(booth.code, 'Sam', screen, mic, 'memory');
    await tick(10);
    expect(booth.name).toBe('Sam');
    expect(acts[0]).toEqual({ t: 'hello', name: 'Sam' });
    expect(voice).toBeTruthy();
    act!({ t: 'call', call: 'ho' });
    act!({ t: 'fx', fx: { echo: true, radio: 'loud' as unknown as boolean } });
    // made-up calls are dropped
    act!({ t: 'call', call: 'boo' as never });
    await tick(10);
    expect(acts.slice(1)).toEqual([{ t: 'call', call: 'ho' }, { t: 'fx', fx: { echo: true } }]);
    const state: McState = { t: 'state', line: 'Hands up', next: null, hint: 'Build coming: hype them up!', section: 'build', bpm: 124, beatInBar: 2, vibe: 0.7, armed: 'ho', armedLeft: 5, level: 0.4, talking: true, points: 120, calls: 1, fx: { echo: true, radio: false }, djName: 'DJ KAI', last: '' };
    booth.send(state);
    await tick(10);
    expect(shown.at(-1)).toEqual(state);
    mc.leave();
    await tick(250);
    expect(acts.at(-1)).toEqual({ t: 'bye' });
    booth.close();
    await tick(250);
    expect(errors).toEqual([]);
  });
});
