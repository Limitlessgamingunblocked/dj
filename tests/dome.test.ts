import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { roomFor } from '../src/audio/room';
import { VENUE_NAME_STYLES } from '../src/name/venueStyles';
import { venueLock } from '../src/game/progression';
import { VENUE_PLACES, venueGroup } from '../src/three/venueMap';
import { venueById, VENUES } from '../src/three/venues';
import { DOME, DOME_SPEC, domeHit, domeLight, EYE_POINT } from '../src/three/venues/dome';
import { blinkAt, DomeEye, lidOpen, lookFor, pupilFor, saccade, squintFor, wantEye, wideAfter, type EyeShow } from '../src/three/venues/domeEye';
import { lookFrame, visUV } from '../src/three/venues/domeScreen';
import { hitDistance } from '../src/three/venues/lasers';
import { CRAZY_ROOMS } from '../src/three/venues/rooms';

// the glow sprites draw on a canvas: a do-nothing one is enough here
const ctx = new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx }) };

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const show = (o: Partial<EyeShow> = {}): EyeShow => ({ t: 0, beat: 0, bar: 0, bpm: 120, playing: true, build: 0, peak: 0, kick: 0, dropHit: false, ...o });

describe('the eye’s blink', () => {
  it('blinks once every 4 bars, shut on the last off-beat and open for the downbeat', () => {
    for (let bar = 0; bar < 12; bar += 4) {
      const b0 = bar * 4;
      for (let x = 0; x < 15.4; x += 0.05) expect(blinkAt(b0 + x)).toBe(0);
      expect(blinkAt(b0 + 15.65)).toBe(1);
      expect(blinkAt(b0 + 15.7)).toBe(1);
      expect(blinkAt(b0 + 16)).toBe(0);
      expect(blinkAt(b0 + 16.02)).toBe(0);
    }
  });

  it('closes faster than it opens', () => {
    const shutAt = 16 - 0.55;
    let closing = 0;
    let opening = 0;
    for (let s = 0; s < 0.55; s += 0.001) {
      const v = blinkAt(shutAt + s);
      if (v > 0 && v < 1 && s < 0.2) closing += 0.001;
      if (v > 0 && v < 1 && s > 0.2) opening += 0.001;
    }
    expect(closing).toBeLessThan(opening);
    // and it's never out of 0..1, even at negative beats
    for (let b = -40; b < 40; b += 0.037) {
      expect(blinkAt(b)).toBeGreaterThanOrEqual(0);
      expect(blinkAt(b)).toBeLessThanOrEqual(1);
    }
  });
});

describe('the eye’s saccades', () => {
  it('looks somewhere new every 2 beats, one side of the room then the other', () => {
    for (let k = 0; k < 40; k++) {
      const [x, y] = lookFor(k);
      const [nx] = lookFor(k + 1);
      expect(Math.sign(x)).toBe(-Math.sign(nx));
      expect(Math.abs(x)).toBeGreaterThanOrEqual(0.06);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.34);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.15);
      // far enough to read as a look, not a twitch
      expect(Math.abs(nx - x)).toBeGreaterThanOrEqual(0.12);
    }
  });

  it('flicks over the first eighth of the slot and holds the rest of it', () => {
    for (let k = 1; k < 10; k++) {
      const b = k * 2;
      expect(saccade(b)[0]).toBeCloseTo(lookFor(k - 1)[0], 6);
      expect(saccade(b + 0.25)[0]).toBeCloseTo(lookFor(k)[0], 6);
      expect(saccade(b + 1.99)[0]).toBeCloseTo(lookFor(k)[0], 6);
      expect(saccade(b + 1.99)[1]).toBeCloseTo(lookFor(k)[1], 6);
      // halfway through the flick it's between the two spots
      const mid = saccade(b + 0.125)[0];
      const [a, c] = [lookFor(k - 1)[0], lookFor(k)[0]];
      expect(mid).toBeGreaterThan(Math.min(a, c));
      expect(mid).toBeLessThan(Math.max(a, c));
    }
  });
});

describe('the eye’s envelopes', () => {
  it('squints only late in a build', () => {
    expect(squintFor(0)).toBe(0);
    expect(squintFor(0.4)).toBe(0);
    expect(squintFor(0.7)).toBeGreaterThan(0.2);
    expect(squintFor(0.7)).toBeLessThan(0.8);
    expect(squintFor(1)).toBe(1);
  });

  it('opens wide on the drop for a bar and eases off over the next two', () => {
    expect(wideAfter(-1)).toBe(0);
    expect(wideAfter(Number.NaN)).toBe(0);
    expect(wideAfter(0)).toBe(1);
    expect(wideAfter(3.9)).toBe(1);
    expect(wideAfter(8)).toBeCloseTo(0.5, 6);
    expect(wideAfter(12)).toBe(0);
    for (let b = 0; b < 12; b += 0.5) expect(wideAfter(b + 0.5)).toBeLessThanOrEqual(wideAfter(b));
  });

  it('opens the lids wider on the drop, narrower in a squint, and shuts them for a blink', () => {
    expect(lidOpen(0, 0, 0)).toBe(1);
    expect(lidOpen(1, 0, 0)).toBeLessThan(0.5);
    expect(lidOpen(0, 1, 0)).toBeGreaterThan(1.25);
    expect(lidOpen(0, 1, 1)).toBe(0);
    expect(lidOpen(0, 0, 0, 1)).toBeLessThan(0.6);
    expect(lidOpen(1, 0, 0, 1)).toBeCloseTo(0, 9);
  });

  it('pumps the pupil with the kick, opens it in a build and pins it on the drop', () => {
    expect(pupilFor(1, 0, 0)).toBeGreaterThan(pupilFor(0, 0, 0));
    expect(pupilFor(0, 1, 0)).toBeGreaterThan(pupilFor(0, 0, 0));
    expect(pupilFor(0, 0, 1)).toBeLessThan(pupilFor(0, 0, 0));
    for (const k of [-1, 0, 0.5, 1, 3]) for (const b of [-1, 0, 1, 2]) for (const w of [0, 1, 4]) {
      expect(pupilFor(k, b, w)).toBeGreaterThanOrEqual(0.16);
      expect(pupilFor(k, b, w)).toBeLessThanOrEqual(0.62);
    }
  });
});

describe('the show’s running order', () => {
  it('shows the eye with no music, in a build, for the drop’s first bars and the end of each phrase', () => {
    expect(wantEye({ playing: false, build: 0, peak: 0, bar: 3 }, -1, false)).toBe(true);
    expect(wantEye({ playing: true, build: 0, peak: 0, bar: 3 }, -1, false)).toBe(false);
    expect(wantEye({ playing: true, build: 0.5, peak: 0, bar: 3 }, -1, false)).toBe(true);
    // the eye stays up through the tail of a build once it's there
    expect(wantEye({ playing: true, build: 0.2, peak: 0, bar: 3 }, -1, false)).toBe(false);
    expect(wantEye({ playing: true, build: 0.2, peak: 0, bar: 3 }, -1, true)).toBe(true);
    // the drop: the eye for 4 bars, then the visual player takes the peak
    for (let b = 0; b < 4; b++) expect(wantEye({ playing: true, build: 0, peak: 1, bar: 70 + b }, b, true)).toBe(true);
    expect(wantEye({ playing: true, build: 0, peak: 1, bar: 74 }, 4, true)).toBe(false);
    // the groove: the last 4 bars of every 32
    expect(wantEye({ playing: true, build: 0, peak: 0, bar: 27 }, -1, false)).toBe(false);
    expect(wantEye({ playing: true, build: 0, peak: 0, bar: 28 }, -1, false)).toBe(true);
    expect(wantEye({ playing: true, build: 0, peak: 0, bar: 31 }, -1, false)).toBe(true);
    expect(wantEye({ playing: true, build: 0, peak: 0, bar: 32 }, -1, false)).toBe(false);
    expect(wantEye({ playing: true, build: 0, peak: 0, bar: 60 }, -1, false)).toBe(true);
    // but not during the peak
    expect(wantEye({ playing: true, build: 0, peak: 0.9, bar: 60 }, 12, false)).toBe(false);
  });
});

describe('DomeEye', () => {
  /** run the eye at 120 bpm (2 beats a second) from `from` for `beats` */
  function run(eye: DomeEye, from: number, beats: number, o: Partial<EyeShow> = {}, dropAt?: number) {
    const dt = 1 / 60;
    let beat = from;
    for (let i = 0; i < (beats / 2) * 60; i++) {
      beat += dt * 2;
      const dropHit = dropAt !== undefined && beat >= dropAt && beat - dt * 2 < dropAt;
      eye.update(show({ beat, bar: Math.floor(beat / 4), t: beat / 2, dropHit, ...o }), dt);
    }
    return beat;
  }

  it('starts on the eye and crossfades to the visual player over a bar of the music', () => {
    const eye = new DomeEye();
    expect(eye.ramp).toBe(1);
    run(eye, 0, 2);
    expect(eye.ramp).toBeCloseTo(0.5, 1);
    // the lids close in the first half, the picture comes up in the second
    expect(eye.lids).toBeLessThan(0.2);
    expect(eye.screen).toBeGreaterThan(0.8);
    run(eye, 2, 2.2);
    expect(eye.ramp).toBe(0);
    expect(eye.screen).toBe(0);
    expect(eye.open).toBe(0);
  });

  it('follows the tempo: a fade takes the same beats at any bpm', () => {
    const a = new DomeEye();
    const b = new DomeEye();
    // 2 seconds at 60 bpm and 1 second at 120 bpm are both 2 beats
    for (let i = 0; i < 120; i++) a.update(show({ bpm: 60, beat: i / 60, bar: 1 }), 1 / 60);
    for (let i = 0; i < 60; i++) b.update(show({ bpm: 120, beat: i / 30, bar: 1 }), 1 / 60);
    expect(a.ramp).toBeCloseTo(b.ramp, 3);
    expect(a.ramp).toBeCloseTo(0.5, 1);
  });

  it('comes up for the build, squints at its top, and stares wide on the drop', () => {
    const eye = new DomeEye();
    let beat = run(eye, 0, 16);
    expect(eye.ramp).toBe(0);
    beat = run(eye, beat, 8, { build: 0.97 });
    expect(eye.ramp).toBe(1);
    expect(eye.squint).toBeGreaterThan(0.95);
    const squinting = eye.open;
    expect(squinting).toBeLessThan(0.55);
    // the drop lands
    const drop = Math.ceil(beat / 4) * 4 + 4;
    beat = run(eye, beat, drop - beat - 0.05, { build: 0.97 });
    beat = run(eye, beat, 1.05, { peak: 1 }, drop);
    expect(eye.wide).toBe(1);
    expect(eye.squint).toBe(0);
    expect(eye.open).toBeGreaterThan(1.25);
    expect(eye.blink).toBe(0);
    // staring straight out
    expect(Math.abs(eye.gaze[0])).toBeLessThan(0.001);
    // pinpoint pupil
    expect(eye.pupil).toBeLessThan(0.25);
    // 4 bars on the visual player takes the peak
    beat = run(eye, beat, 4 * 4 + 4.5, { peak: 1 });
    expect(eye.wide).toBe(0);
    expect(eye.ramp).toBe(0);
  });

  it('pumps the pupil with the kick', () => {
    const eye = new DomeEye();
    eye.update(show({ kick: 0, build: 0 }), 0.016);
    const rest = eye.pupil;
    eye.update(show({ kick: 1, build: 0 }), 0.016);
    expect(eye.pupil).toBeGreaterThan(rest + 0.1);
  });

  it('keeps looking round and blinking with no music, half asleep', () => {
    const eye = new DomeEye();
    const seen = new Set<number>();
    let blinked = false;
    for (let i = 0; i < 60 * 24; i++) {
      eye.update(show({ playing: false, t: i / 60 }), 1 / 60);
      seen.add(Math.round(eye.gaze[0] * 20));
      if (eye.blink > 0.99) blinked = true;
    }
    expect(eye.ramp).toBe(1);
    expect(seen.size).toBeGreaterThan(3);
    expect(blinked).toBe(true);
    expect(eye.wide).toBe(0);
    eye.update(show({ playing: false, t: 0 }), 0);
    expect(eye.open).toBeGreaterThan(0.4);
    expect(eye.open).toBeLessThan(0.65);
  });

  it('forgets a drop after a seek back past it', () => {
    const eye = new DomeEye();
    run(eye, 0, 36, {}, 32);
    expect(eye.wide).toBeGreaterThan(0.9);
    // seek back to beat 4: no stare, and the visual player comes back
    run(eye, 4, 6);
    expect(eye.wide).toBe(0);
    expect(eye.ramp).toBe(0);
  });

  it('never puts NaN into the shader', () => {
    const eye = new DomeEye();
    eye.update(show({ bpm: 0, beat: Number.NaN }), 0.016);
    eye.update(show({ bpm: 0 }), -1);
    eye.update(show({ bpm: 128, beat: 1e6, kick: 5, build: 3 }), 10);
    for (const v of [eye.ramp, eye.screen, eye.lids, eye.open, eye.pupil, eye.wide, eye.squint, eye.gaze[0], eye.gaze[1]]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('the dome', () => {
  it('is a round room 40–60 m across, its eye high over the stage', () => {
    expect(DOME.radius * 2).toBeGreaterThanOrEqual(40);
    expect(DOME.radius * 2).toBeLessThanOrEqual(60);
    // the eye on the dome in front of the crowd, up over the stage end
    expect(EYE_POINT.z).toBeGreaterThan(DOME.stageZ);
    expect(EYE_POINT.y).toBeGreaterThan(10);
    const c = V(0, DOME.floorY + DOME.drum, DOME.centreZ);
    expect(EYE_POINT.distanceTo(c)).toBeCloseTo(DOME.radius, 3);
  });

  it('hits the inside of the dome from anywhere in the room', () => {
    const c = V(0, DOME.floorY + DOME.drum, DOME.centreZ);
    for (const d of [V(0, 1, 0), V(1, 1, 0), V(0, 0.3, 1), V(-1, 0.2, -1)]) {
      d.normalize();
      const o = V(2, 0, -10);
      const t = domeHit(o, d);
      expect(o.clone().addScaledVector(d, t).distanceTo(c)).toBeCloseTo(DOME.radius, 4);
    }
  });

  it('stops laser beams on the dome', () => {
    const c = V(0, DOME.floorY + DOME.drum, DOME.centreZ);
    const room = { floorY: DOME.floorY, x0: -40, x1: 40, z0: -60, z1: 40, dome: { centre: c, radius: DOME.radius } };
    const o = V(0, 3, 2);
    const d = V(0.2, 1, -0.4).normalize();
    expect(hitDistance(o, d, room)).toBeCloseTo(domeHit(o, d), 4);
    // the floor still stops a beam aimed down
    expect(hitDistance(o, V(0, -1, 0), room)).toBeCloseTo(3 - DOME.floorY, 4);
  });

  it('maps the visual player round the dome without a seam: the frame in the middle, mirrored beyond', () => {
    const f = lookFrame(DOME_SPEC.visAt);
    const mid = visUV(DOME_SPEC.visAt, DOME_SPEC);
    expect(mid.u).toBeCloseTo(0.5, 5);
    expect(mid.v).toBeCloseTo(0.5, 5);
    expect(mid.out).toBe(0);
    // right on the dome is right in the picture, up is up
    const right = visUV(DOME_SPEC.visAt.clone().addScaledVector(f.x, 0.3), DOME_SPEC);
    const up = visUV(DOME_SPEC.visAt.clone().addScaledVector(f.y, 0.3), DOME_SPEC);
    expect(right.u).toBeGreaterThan(0.5);
    expect(up.v).toBeGreaterThan(0.5);
    // sweeping right across the frame's edge, the picture mirrors back with no jump
    let last = visUV(DOME_SPEC.visAt, DOME_SPEC).u;
    for (let a = 0.01; a < 2.5; a += 0.01) {
      const d = DOME_SPEC.visAt.clone().applyAxisAngle(f.y, -a);
      const uv = visUV(d, DOME_SPEC);
      expect(uv.u).toBeGreaterThanOrEqual(0);
      expect(uv.u).toBeLessThanOrEqual(1);
      expect(Math.abs(uv.u - last)).toBeLessThan(0.02);
      last = uv.u;
    }
    expect(visUV(DOME_SPEC.visAt.clone().applyAxisAngle(f.y, -2), DOME_SPEC).out).toBeGreaterThan(0);
  });

  it('lights the room with the picture, or the eye’s glow when the eye is up', () => {
    const out = new THREE.Color();
    const vis = new THREE.Color(0, 0.6, 1);
    const glow = new THREE.Color(1, 0.6, 0.2);
    domeLight(vis, 0, 0, 0, 0, glow, out);
    expect(out.b).toBeGreaterThan(out.r);
    domeLight(vis, 1, 1, 0, 0, glow, out);
    expect(out.r).toBeGreaterThan(out.b);
    // the drop's stare throws more light than a squint
    const wide = domeLight(vis, 1, 1.3, 1, 1, glow, new THREE.Color()).r;
    const squint = domeLight(vis, 1, 0.4, 0, 0, glow, new THREE.Color()).r;
    expect(wide).toBeGreaterThan(squint);
    for (const c of [out.r, out.g, out.b, wide, squint]) expect(Number.isFinite(c)).toBe(true);
  });
});

describe('the venue', () => {
  it('is in the catalogue once, with its name style and a big round sound', () => {
    expect(VENUES.filter((v) => v.id === 'dome').length).toBe(1);
    const v = venueById('dome');
    expect(v.id).toBe('dome');
    expect(v.name).toBe('The Dome');
    expect(v.palette.length).toBeGreaterThanOrEqual(3);
    expect(VENUE_NAME_STYLES.dome.screen).toBeTruthy();
    expect(roomFor('dome').wet).toBeGreaterThan(roomFor('deckhouse').wet);
    expect(roomFor('dome').decay).toBeGreaterThan(1.5);
  });

  it('is made up: a card on the globe, not a pin, and open in free play', () => {
    expect('dome' in VENUE_PLACES).toBe(false);
    expect(venueGroup('dome', new Set(CRAZY_ROOMS.map((r) => r.id)))).toBe('circuit');
    expect(venueLock('dome', { tier: 0, setsPlayed: 0, unlocked: [], sandbox: false })).toBeNull();
  });
});
