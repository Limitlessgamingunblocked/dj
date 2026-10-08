import { describe, expect, it } from 'vitest';
import type { Features } from '../src/visualizer/AudioFeatures';
import { LightShow } from '../src/three/venues/show';

/** a minimal feature frame at time t for a track at `bpm` */
function frame(t: number, bpm: number, o: Partial<Features> = {}): Features {
  const beats = (t * bpm) / 60;
  const beatCount = Math.floor(beats);
  return {
    spectrum: new Float32Array(256),
    waveform: new Float32Array(512),
    sub: 0.5,
    kick: 0.5,
    snare: 0.3,
    vocal: 0.2,
    high: 0.3,
    level: 0.6,
    kickHit: false,
    snareHit: false,
    kickPulse: 1 - (beats % 1),
    snarePulse: 0,
    beatPulse: 1 - (beats % 1),
    beatPhase: beats % 1,
    beatInBar: beatCount % 4,
    beatCount,
    bpm,
    drop: 0,
    dropHit: false,
    breakdown: 0,
    energy: 0.7,
    hue: 0,
    time: t,
    playing: true,
    intensity: 1,
    shake: 1,
    ...o,
  };
}

/** run the show for `secs` at 60 fps; the times of flashes (strobe going from off to on) */
function flashTimes(show: LightShow, secs: number, bpm: number): number[] {
  const times: number[] = [];
  let was = false;
  for (let i = 0; i < secs * 60; i++) {
    const s = show.update(frame(i / 60, bpm), 1 / 60, 0.8);
    const on = s.strobe > 0.05;
    if (on && !was) times.push(i / 60);
    was = on;
  }
  return times;
}

/** the most flashes in any one-second window */
function worstSecond(times: number[]): number {
  let worst = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length && times[j] < times[i] + 1 - 1e-9; j++) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

describe('reduce flashing', () => {
  it('a held strobe flashes fast normally, and no more than 3 times a second with reduce flashing', () => {
    const fast = new LightShow();
    fast.controls.reduceFlash = false;
    fast.controls.strobeHold = true;
    expect(worstSecond(flashTimes(fast, 10, 128))).toBeGreaterThan(6);

    const calm = new LightShow();
    calm.controls.reduceFlash = true;
    calm.controls.strobeHold = true;
    const times = flashTimes(calm, 10, 174);
    expect(worstSecond(times)).toBeLessThanOrEqual(3);
    expect(times.length).toBeGreaterThan(20);
  });

  it('softens strobes and blinders', () => {
    const calm = new LightShow();
    calm.controls.reduceFlash = true;
    calm.controls.strobeHold = true;
    calm.controls.blinderHold = true;
    let maxStrobe = 0;
    let maxBlinder = 0;
    for (let i = 0; i < 120; i++) {
      const s = calm.update(frame(i / 60, 128), 1 / 60, 0.8);
      maxStrobe = Math.max(maxStrobe, s.strobe);
      maxBlinder = Math.max(maxBlinder, s.blinder);
    }
    expect(maxStrobe).toBeLessThanOrEqual(0.6);
    expect(maxBlinder).toBeLessThanOrEqual(0.6);
  });
});

describe('the drop', () => {
  it('dips the lights on the last half-beat of the phrase at the top of a build, then lands on the drop', () => {
    const show = new LightShow();
    show.controls.reduceFlash = false;
    const bpm = 120; // 2 beats a second, a bar every 2 s
    let darkest = 1;
    let darkestElsewhere = 1;
    let t = 0;
    // one 8-bar phrase at the top of the build
    for (; t < 16; t += 1 / 60) {
      const s = show.update(frame(t, bpm, { breakdown: 0.97 }), 1 / 60, 0.8);
      if (s.bar === 7 && s.beatInBar === 3 && s.beatPhase > 0.75) darkest = Math.min(darkest, s.master);
      else if (s.bar < 7 && s.beatPhase > 0.2) darkestElsewhere = Math.min(darkestElsewhere, s.master);
    }
    expect(darkest).toBeLessThan(0.35);
    // never a dip in the other bars of the phrase
    expect(darkestElsewhere).toBeGreaterThan(0.95);
    // the drop: everything at once
    const hit = show.update(frame(t, bpm, { breakdown: 0, drop: 1, dropHit: true }), 1 / 60, 0.8);
    expect(hit.co2).toBe(true);
    expect(hit.pyro).toBe(true);
    expect(hit.blinder).toBeGreaterThan(0.8);
    expect(hit.laserPattern).toBe('burst');
  });

  it('keeps the lights up before the drop with reduce flashing', () => {
    const show = new LightShow();
    show.controls.reduceFlash = true;
    for (let t = 0; t < 4; t += 1 / 60) expect(show.update(frame(t, 120, { breakdown: 0.97 }), 1 / 60, 0.8).master).toBeGreaterThan(0.9);
  });
});

describe('confetti', () => {
  const drop = (show: LightShow, t: number) => show.update(frame(t, 120, { drop: 1, dropHit: true }), 1 / 60, 0.8);

  it('fires on a drop, then not again for 90 s, so it stays special', () => {
    const show = new LightShow();
    let t = 0;
    for (; t < 2; t += 1 / 60) show.update(frame(t, 120), 1 / 60, 0.8);
    const first = drop(show, t);
    expect(first.confetti).toBe(true);
    expect(first.confettiByHand).toBe(false);
    // the next drop a minute later: CO2 and pyro, no paper
    for (; t < 62; t += 1 / 60) show.update(frame(t, 120), 1 / 60, 0.8);
    const second = drop(show, t);
    expect(second.co2).toBe(true);
    expect(second.confetti).toBe(false);
    for (; t < 95; t += 1 / 60) show.update(frame(t, 120), 1 / 60, 0.8);
    expect(drop(show, t).confetti).toBe(true);
  });

  it('can be turned off for drops and still fired from the desk', () => {
    const show = new LightShow();
    show.controls.confetti = false;
    expect(drop(show, 1).confetti).toBe(false);
    show.fireConfetti();
    const s = show.update(frame(1.1, 120), 1 / 60, 0.8);
    expect(s.confetti).toBe(true);
    expect(s.confettiByHand).toBe(true);
    // a held key doesn't keep restarting it
    show.fireConfetti();
    expect(show.update(frame(1.2, 120), 1 / 60, 0.8).confetti).toBe(false);
  });
});

describe('phone flashes', () => {
  it('burst after the drop, thin out, and never show with reduce flashing', () => {
    const show = new LightShow();
    show.controls.reduceFlash = false;
    const hit = show.update(frame(1, 120, { drop: 1, dropHit: true }), 1 / 60, 0.8);
    expect(hit.photos).toBeCloseTo(1, 1);
    let s = hit;
    for (let t = 1; t < 9; t += 1 / 60) s = show.update(frame(t, 120), 1 / 60, 0.8);
    expect(s.photos).toBeLessThan(0.15);
    const calm = new LightShow();
    calm.controls.reduceFlash = true;
    expect(calm.update(frame(1, 120, { drop: 1, dropHit: true }), 1 / 60, 0.8).photos).toBe(0);
  });
});
