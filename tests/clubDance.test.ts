import { describe, expect, it } from 'vitest';
import { ClubDancer, clubPose, newPose, MEN_MOVES, WOMEN_MOVES } from '../src/character/clubDance';

describe('club dances', () => {
  it('never snap: every joint moves smoothly through the beats, the move changes, a build and a drop', () => {
    const d = new ClubDancer(['pump', 'sway', 'roll'], 'r', 3);
    const dt = 1 / 60;
    const beatLen = 60 / 124;
    let last: Float32Array | null = null;
    let lastHips = [0, 0, 0];
    let worst = 0;
    let worstHips = 0;
    for (let t = 0; t < 200; t += dt) {
      const beat = t / beatLen;
      // a build from beat 120 to 152, the drop on 152
      const build = beat > 120 && beat < 152 ? 0.8 : 0;
      const p = d.update({ beat, build, sinceDrop: beat >= 152 ? (beat - 152) * beatLen : 99, beatLen }, 0.8, dt);
      if (last) {
        for (let i = 0; i < p.rot.length; i++) worst = Math.max(worst, Math.abs(p.rot[i] - last[i]));
        for (let i = 0; i < 3; i++) worstHips = Math.max(worstHips, Math.abs(p.hips[i] - lastHips[i]));
      }
      last = p.rot.slice();
      lastHips = [...p.hips];
    }
    // at 60 fps no joint turns more than ~0.2 rad in a frame, and the hips move no faster than a jump
    expect(worst).toBeLessThan(0.2);
    expect(worstHips).toBeLessThan(0.03);
  });
  it('keep the feet under the body: the knees bend as much as the hips drop', () => {
    const p = newPose();
    for (const m of [...MEN_MOVES, ...WOMEN_MOVES]) {
      for (let b = 0; b < 4; b += 0.1) {
        clubPose(m, b, 0.8, 'r', p);
        expect(p.hips[1], m).toBeLessThanOrEqual(0);
        expect(p.hips[1], m).toBeGreaterThan(-0.08);
        expect(Math.abs(p.hips[0]), m).toBeLessThan(0.08);
      }
    }
  });
});
