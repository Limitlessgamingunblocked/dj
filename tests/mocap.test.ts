import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { limbTurn } from '../src/character/Avatar';
import { easeFrame, frameActive, newFrame } from '../src/character/mocapFrame';
import { POSE, type HandIn, type P3, type PoseIn } from '../src/app/mocap/landmarks';
import { Reactions } from '../src/app/mocap/reactions';
import { DEFAULT_OPTS, faceFrom, handSides, OneEuro, Retargeter, type MocapOpts } from '../src/app/mocap/retarget';

/**
 * A made-up person facing the camera, in MediaPipe's terms: the world points
 * in metres round the hips (x to the right of the picture, which is the
 * person's left; y down; z away from the camera), and the picture points to
 * match. Each arm and leg can be posed by where its joints are.
 */
interface Body {
  turn?: number;
  armL?: [P3, P3];
  armR?: [P3, P3];
  hidden?: number[];
}
function person(b: Body = {}): PoseIn {
  const world: P3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
  const put = (i: number, x: number, y: number, z = 0) => (world[i] = { x, y, z, visibility: 0.95 });
  put(POSE.nose, 0, -0.62, -0.08);
  put(POSE.shoulder.L, 0.18, -0.45);
  put(POSE.shoulder.R, -0.18, -0.45);
  // arms hanging down by default
  const [eL, wL] = b.armL ?? [{ x: 0.2, y: -0.17, z: 0 }, { x: 0.21, y: 0.08, z: 0 }];
  const [eR, wR] = b.armR ?? [{ x: -0.2, y: -0.17, z: 0 }, { x: -0.21, y: 0.08, z: 0 }];
  put(POSE.elbow.L, eL.x, eL.y, eL.z);
  put(POSE.wrist.L, wL.x, wL.y, wL.z);
  put(POSE.elbow.R, eR.x, eR.y, eR.z);
  put(POSE.wrist.R, wR.x, wR.y, wR.z);
  put(POSE.hip.L, 0.1, 0);
  put(POSE.hip.R, -0.1, 0);
  put(POSE.knee.L, 0.1, 0.42);
  put(POSE.knee.R, -0.1, 0.42);
  put(POSE.ankle.L, 0.1, 0.84);
  put(POSE.ankle.R, -0.1, 0.84);
  // turned round the vertical (seen from above), then into the picture
  if (b.turn) {
    const c = Math.cos(b.turn);
    const s = Math.sin(b.turn);
    for (const p of world) [p.x, p.z] = [p.x * c - p.z * s, p.x * s + p.z * c];
  }
  const lm = world.map((p) => ({ x: 0.5 + p.x * 0.5, y: 0.6 + p.y * 0.5, z: p.z, visibility: p.visibility }));
  for (const i of b.hidden ?? []) lm[i].visibility = world[i].visibility = 0.05;
  return { lm, world };
}

const run = (r: Retargeter, pose: PoseIn, frames = 15, o: MocapOpts = DEFAULT_OPTS) => {
  let f = r.update({ pose, face: null, hands: [] }, 1 / 30, o);
  for (let i = 1; i < frames; i++) f = r.update({ pose, face: null, hands: [] }, 1 / 30, o);
  return f;
};

describe('body tracking: the pose for the character', () => {
  it('waits for the resting pose before copying anything', () => {
    const r = new Retargeter();
    const f = run(r, person(), 5);
    expect(f.w.armL).toBe(0);
    expect(r.calibrated).toBe(false);
    run(r, person(), 10);
    expect(r.calibrated).toBe(true);
    expect(r.frame.w.armL).toBeGreaterThan(0.9);
    expect(r.frame.w.torso).toBeGreaterThan(0.9);
  });

  it('points the arms where the player’s go: up, out to the side, forward at the camera', () => {
    const r = new Retargeter();
    const plain = { ...DEFAULT_OPTS, mirror: false };
    run(r, person(), 15, plain);
    // the player's left arm straight up
    let f = run(r, person({ armL: [{ x: 0.2, y: -0.72, z: 0 }, { x: 0.2, y: -0.98, z: 0 }] }), 30, plain);
    expect(f.arm.l.upper.y).toBeGreaterThan(0.95);
    expect(f.arm.l.lower.y).toBeGreaterThan(0.95);
    // the right one out to their side (the character's right is −X)
    f = run(r, person({ armR: [{ x: -0.45, y: -0.45, z: 0 }, { x: -0.7, y: -0.45, z: 0 }] }), 30, plain);
    expect(f.arm.r.upper.x).toBeLessThan(-0.95);
    // reaching for the camera is reaching out to the room (+Z)
    f = run(r, person({ armL: [{ x: 0.18, y: -0.45, z: -0.28 }, { x: 0.18, y: -0.45, z: -0.54 }] }), 30, plain);
    expect(f.arm.l.upper.z).toBeGreaterThan(0.95);
  });

  it('is a mirror by default: the player’s left arm moves the character’s right', () => {
    const r = new Retargeter();
    run(r, person());
    const f = run(r, person({ armL: [{ x: 0.2, y: -0.72, z: 0 }, { x: 0.2, y: -0.98, z: 0 }] }), 30);
    expect(f.arm.r.upper.y).toBeGreaterThan(0.95);
    expect(f.arm.l.upper.y).toBeLessThan(-0.9);
  });

  it('measures the chest from the resting pose, so sitting turned to the camera doesn’t turn the DJ', () => {
    const r = new Retargeter();
    run(r, person({ turn: 0.4 }));
    const still = run(r, person({ turn: 0.4 }), 10);
    expect(still.torso.angleTo(new THREE.Quaternion())).toBeLessThan(0.02);
    const turned = run(r, person({ turn: 0.4 + 0.5 }), 40);
    expect(turned.torso.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.45);
    // recentred, that's the new rest
    r.recenter();
    expect(run(r, person({ turn: 0.9 }), 20).torso.angleTo(new THREE.Quaternion())).toBeLessThan(0.02);
  });

  it('lets go of what it can’t see', () => {
    const r = new Retargeter();
    const plain = { ...DEFAULT_OPTS, mirror: false };
    run(r, person(), 15, plain);
    const f = run(r, person({ hidden: [POSE.wrist.L] }), 3, plain);
    expect(f.w.armL).toBe(0);
    expect(f.w.armR).toBeGreaterThan(0.9);
    // and with the body switched off, the body's left alone
    expect(run(r, person(), 3, { ...plain, body: false }).w.torso).toBe(0);
    // nobody there: nothing
    expect(Object.values(r.update(null, 1 / 30, plain).w).every((w) => w === 0)).toBe(true);
  });

  it('copies the legs only with both of them in view', () => {
    const r = new Retargeter();
    run(r, person());
    expect(run(r, person(), 3).w.legs).toBeGreaterThan(0.9);
    expect(run(r, person({ hidden: [POSE.ankle.R] }), 3).w.legs).toBe(0);
  });
});

describe('body tracking: the face', () => {
  it('turns blendshapes into the character’s face', () => {
    const f = faceFrom({ jawOpen: 0.7, mouthSmileLeft: 0.6, mouthSmileRight: 0.6, browInnerUp: 0.2, browOuterUpLeft: 0.8, browOuterUpRight: 0.8 }, false);
    expect(f.jaw).toBeCloseTo(0.945, 2);
    expect(f.smile).toBeGreaterThan(0.7);
    expect(f.brow).toBeGreaterThan(0.7);
    expect(faceFrom({ mouthFrownLeft: 0.8, mouthFrownRight: 0.8 }, false).smile).toBeLessThan(-0.9);
    expect(faceFrom({ browDownLeft: 0.7, browDownRight: 0.7 }, false).frown).toBeGreaterThan(0.8);
    // a resting face's slight brow and squint read as neutral
    const rest = faceFrom({ browDownLeft: 0.18, browDownRight: 0.2, eyeSquintLeft: 0.12, eyeSquintRight: 0.14 }, false);
    expect(rest.frown).toBe(0);
    expect(rest.squint).toBe(0);
  });

  it('winks the same eye, or the other one in a mirror', () => {
    const wink = { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.05 };
    const plain = faceFrom(wink, false);
    expect(plain.blinkL).toBe(1);
    expect(plain.blinkR).toBe(0);
    const mirrored = faceFrom(wink, true);
    expect(mirrored.blinkR).toBe(1);
    expect(mirrored.blinkL).toBe(0);
    // a half-shut resting lid still reads open
    expect(faceFrom({ eyeBlinkLeft: 0.25 }, false).blinkL).toBe(0);
  });

  it('turns the head from its resting pose, mirrored the other way round', () => {
    const at = (yaw: number) => {
      const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(0, 0, -40);
      return { blend: {}, matrix: m.toArray(), dots: [] };
    };
    for (const mirror of [false, true]) {
      const r = new Retargeter();
      const o = { ...DEFAULT_OPTS, mirror };
      for (let i = 0; i < 15; i++) r.update({ pose: null, face: at(0.1), hands: [] }, 1 / 30, o);
      expect(r.frame.head.angleTo(new THREE.Quaternion())).toBeLessThan(0.02);
      for (let i = 0; i < 40; i++) r.update({ pose: null, face: at(0.1 + 0.6), hands: [] }, 1 / 30, o);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(r.frame.head);
      // turning to the camera's right (+X in its picture) is the player's left, the character's left (+X) unmirrored
      expect(Math.sign(fwd.x)).toBe(mirror ? -1 : 1);
      expect(Math.abs(Math.asin(fwd.x))).toBeCloseTo(0.6, 1);
    }
  });
});

describe('body tracking: hands', () => {
  /** a flat hand: wrist at the picture point (x, y), fingers up (or curled into a fist) */
  function hand(x: number, y: number, fist = false): HandIn {
    const world: P3[] = [{ x: 0, y: 0.04, z: 0 }];
    // thumb
    world.push({ x: -0.03, y: 0.02, z: 0 }, { x: -0.045, y: 0, z: 0 }, { x: -0.055, y: -0.02, z: 0 }, { x: -0.06, y: -0.035, z: 0 });
    for (let i = 0; i < 4; i++) {
      const fx = -0.02 + i * 0.015;
      const mcp = { x: fx, y: -0.04, z: 0 };
      world.push(mcp);
      if (fist) world.push({ x: fx, y: -0.07, z: -0.02 }, { x: fx, y: -0.06, z: -0.045 }, { x: fx, y: -0.035, z: -0.05 });
      else world.push({ x: fx, y: -0.07, z: 0 }, { x: fx, y: -0.09, z: 0 }, { x: fx, y: -0.11, z: 0 });
    }
    return { lm: world.map((p) => ({ x: x + p.x, y: y + p.y, z: 0 })), world };
  }

  it('pairs each hand with the wrist it’s on', () => {
    const pose = person();
    const wl = pose.lm[POSE.wrist.L];
    const wr = pose.lm[POSE.wrist.R];
    const a = hand(wl.x, wl.y);
    const b = hand(wr.x, wr.y);
    expect(handSides([b, a], pose)).toEqual({ L: a, R: b });
    // no body: the player's right hand is on the left of the (unmirrored) picture
    expect(handSides([a, b], null)).toEqual({ L: a, R: b });
    // a hand nowhere near the player's wrists isn't theirs
    expect(handSides([hand(0.05, 0.05)], pose)).toEqual({});
  });

  it('curls the character’s fingers with the player’s', () => {
    const r = new Retargeter();
    const pose = person();
    const wl = pose.lm[POSE.wrist.L];
    run(r, pose);
    const open = r.update({ pose, face: null, hands: [hand(wl.x, wl.y)] }, 1 / 30, DEFAULT_OPTS);
    expect(open.w.handR).toBe(1);
    expect(Math.max(...open.hand.r.knuckle, ...open.hand.r.mid)).toBeLessThan(0.2);
    const r2 = new Retargeter();
    run(r2, pose);
    const fist = r2.update({ pose, face: null, hands: [hand(wl.x, wl.y, true)] }, 1 / 30, DEFAULT_OPTS);
    expect(Math.min(...fist.hand.r.mid)).toBeGreaterThan(1.2);
    // fingers up, palm to the camera: a mirror shows the palm out to the room, fingers up
    expect(open.hand.r.fingers.y).toBeGreaterThan(0.95);
    expect(open.hand.r.palm.z).toBeGreaterThan(0.95);
    // and the same unmirrored, on the character's own left hand
    const r3 = new Retargeter();
    const plain = { ...DEFAULT_OPTS, mirror: false };
    run(r3, pose, 15, plain);
    const own = r3.update({ pose, face: null, hands: [hand(wl.x, wl.y)] }, 1 / 30, plain);
    expect(own.w.handL).toBe(1);
    expect(own.hand.l.palm.z).toBeGreaterThan(0.95);
  });
});

describe('body tracking: the room answers', () => {
  const t = () => {
    const calls = { up: 0, sway: [] as (number | null)[] };
    return { calls, target: { handsUp: () => calls.up++, crowdSway: (l: number | null) => calls.sway.push(l) } };
  };
  const both = (dx = 0) => person({ armL: [{ x: 0.25 + dx, y: -0.75, z: 0 }, { x: 0.25 + dx, y: -1, z: 0 }], armR: [{ x: -0.25 + dx, y: -0.75, z: 0 }, { x: -0.25 + dx, y: -1, z: 0 }] });

  it('fires "hands up" once both hands are held up above the head, and not again straight away', () => {
    const { calls, target } = t();
    const r = new Reactions(target);
    for (let i = 0; i < 6; i++) r.update(both(), 1 / 30);
    expect(calls.up).toBe(0);
    for (let i = 0; i < 10; i++) r.update(both(), 1 / 30);
    expect(calls.up).toBe(1);
    for (let i = 0; i < 30; i++) r.update(both(), 1 / 30);
    expect(calls.up).toBe(1);
    // one hand up is not hands up
    const one = new Reactions(target);
    for (let i = 0; i < 30; i++) one.update(person({ armL: [{ x: 0.25, y: -0.75, z: 0 }, { x: 0.25, y: -1, z: 0 }] }), 1 / 30);
    expect(calls.up).toBe(1);
  });

  it('crowd control: the room leans the way the player sways, and lets go when the hands come down', () => {
    const { calls, target } = t();
    const r = new Reactions(target);
    for (let i = 0; i < 15; i++) r.update(both(), 1 / 30);
    expect(r.crowd).toBe(true);
    // swaying to the camera's left in the picture is the player's right
    for (let i = 0; i < 10; i++) r.update(both(-0.25), 1 / 30);
    expect(r.lean).toBeGreaterThan(0.3);
    for (let i = 0; i < 30; i++) r.update(person(), 1 / 30);
    expect(r.crowd).toBe(false);
    expect(calls.sway[calls.sway.length - 1]).toBeNull();
  });
});

describe('body tracking: the character', () => {
  /** where the rig's own joints put the end of a limb, for a turn and a bend (the elbow −X, the knee +X) */
  const end = (q: THREE.Quaternion, bend: number, back: boolean) =>
    new THREE.Vector3(0, -1, 0)
      .applyQuaternion(q)
      .add(new THREE.Vector3(0, -1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), back ? bend : -bend).applyQuaternion(q));

  it('bends each joint the way the player’s limb goes, and only the way that joint bends', () => {
    const cases: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
      [new THREE.Vector3(0.3, 0.9, 0.2), new THREE.Vector3(-0.2, 0.5, 0.8)],
    ];
    for (const back of [false, true]) {
      for (const [u, f] of cases) {
        const q = new THREE.Quaternion();
        const bend = limbTurn(u.clone(), f.clone(), back, q);
        expect(bend).toBeGreaterThanOrEqual(0);
        const want = u.clone().normalize().add(f.clone().normalize());
        expect(end(q, bend, back).distanceTo(want)).toBeLessThan(1e-3);
      }
    }
    // straight, it stays untwisted
    const q = new THREE.Quaternion();
    limbTurn(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), false, q);
    expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-3);
  });

  it('fades each part in and out on its own', () => {
    const out = newFrame();
    const to = newFrame();
    to.w.armL = 1;
    to.arm.l.upper.set(0, 1, 0);
    expect(frameActive(out)).toBe(false);
    easeFrame(out, to, 0.3, 0.2, 0.1);
    // a part coming in from nothing takes the pose straight away, and fades in
    expect(out.arm.l.upper.y).toBeCloseTo(1);
    expect(out.w.armL).toBeCloseTo(0.2);
    expect(out.w.armR).toBe(0);
    expect(frameActive(out)).toBe(true);
    to.w.armL = 0;
    easeFrame(out, to, 0.3, 0.2, 0.5);
    expect(out.w.armL).toBeCloseTo(0.1);
  });
});

describe('the one-euro filter', () => {
  it('steadies jitter and keeps up with a quick move', () => {
    const f = new OneEuro(1.6, 2.5);
    let spread = 0;
    for (let i = 0; i < 60; i++) {
      const v = f.filter([0.3 + (i % 2 ? 0.004 : -0.004)], 1 / 30)[0];
      if (i > 30) spread = Math.max(spread, Math.abs(v - 0.3));
    }
    expect(spread).toBeLessThan(0.0025);
    let v = 0;
    for (let i = 0; i < 6; i++) v = f.filter([0.3 + 0.1 * (i + 1)], 1 / 30)[0];
    expect(v).toBeGreaterThan(0.75);
  });
});
