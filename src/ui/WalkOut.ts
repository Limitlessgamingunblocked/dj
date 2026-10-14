/*
 * The walk out to the booth: before a gig, you leave the dressing room and
 * walk the corridor to the stage door (three/backstage.ts), the camera in
 * front of you at first, then round your shoulder and after you. The club
 * comes through the walls and gets louder; the door swings open onto the
 * room's light, it whites out, and you're in the venue with its walk-in.
 *
 * A click, a key or Skip goes straight to the door. Nothing plays with
 * reduced motion (or with the walk-out off in Settings), and without WebGL.
 */
import * as THREE from 'three';
import { wallThump, type WallThump } from '../audio/sfx';
import { Avatar } from '../character/Avatar';
import type { Look } from '../core/models';
import { prefs } from '../core/prefs';
import { buildBackstage, doorOpen, flashAt, shotAt, WALK, walkerZ, walkSpeed, type BackstageOptions } from '../three/backstage';
import { createMenuScene } from '../three/menu3d';
import { h } from './dom';

export interface WalkOutOptions extends BackstageOptions {
  look: Look;
  /** for the clipboard and the avatar's name on their clothes */
  djName: string;
  /** the club through the walls (null: the music's already going, or no sound) */
  ctx: AudioContext | null;
  /** the walk's over (or skipped): start the night. The overlay fades off the stage by itself. */
  done(): void;
}

const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** whether the walk-out plays at all */
export function walkOutWanted(): boolean {
  return prefs.walkOut && !motionQuery?.matches;
}

/** the walk-out, as an overlay for the stage; null when it won't play (call `done` yourself) */
export function walkOut(o: WalkOutOptions): HTMLElement | null {
  if (!walkOutWanted()) return null;
  const ms = createMenuScene({ fov: 50, label: `Backstage at ${o.venueName}: walking out to the booth`, className: 'wo-canvas' });
  if (!ms) return null;
  const { scene, camera } = ms;
  const room = buildBackstage(scene, o);
  const you = new Avatar(o.look, { djName: o.djName });
  you.mode = 'walk';
  // the avatar faces +z; the stage is down the corridor at -z
  you.object.rotation.y = Math.PI;
  you.object.position.set(0, 0, WALK.from);
  scene.add(you.object);

  let thump: WallThump | null = null;
  try {
    if (o.ctx) {
      void o.ctx.resume();
      thump = wallThump(o.ctx, 124, 0.1);
    }
  } catch {
    thump = null;
  }

  const flash = h('div', { class: 'wo-flash' });
  const skip = h('button', { type: 'button', class: 'btn ghost small wo-skip' }, 'Skip ›');
  const caption = h('div', { class: 'wo-caption' }, h('span', {}, 'Backstage'), h('b', {}, o.venueName));
  const el = h('div', { class: 'walkout', role: 'dialog', 'aria-label': `Walking out at ${o.venueName}` }, ms.canvas, caption, flash, skip);
  el.style.setProperty('--vc', o.ui);

  let t = 0;
  let ended = false;
  const input = { beat: 0, playing: false, dropHit: false, peak: 0, build: 0, kick: 0 };
  const look = new THREE.Vector3();

  const finish = () => {
    if (ended) return;
    ended = true;
    document.removeEventListener('keydown', onKey, true);
    thump?.stop();
    // the stage back to every frame, for its walk-in
    document.body.classList.remove('walking-out');
    o.done();
    // the stage's walk-in shows through as this fades
    el.classList.add('out');
    window.setTimeout(() => {
      el.remove();
      you.dispose();
    }, 650);
  };
  /** straight to the door */
  const skipIt = () => {
    if (!ended) t = Math.max(t, WALK.length - 0.35);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!el.isConnected || ended) return;
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      skipIt();
    }
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    skipIt();
  });
  skip.addEventListener('click', skipIt);

  ms.onFrame = (dt) => {
    if (ended) return;
    t += dt;
    // walk: the stride keeps time with the pace
    you.walkRate = walkSpeed(t) / WALK.stride;
    you.object.position.z = walkerZ(t);
    input.beat = t * (124 / 60);
    you.update(input, dt);
    room.update(t, dt);
    const shot = shotAt(t);
    camera.position.set(...shot.pos);
    camera.lookAt(look.set(...shot.look));
    // the club gets louder and clearer as the door opens
    const k = doorOpen(t);
    thump?.set(0.1 + 0.05 * Math.max(0, (3 - walkerZ(t)) / 12) + 0.2 * k, 190 + 2400 * k * k);
    caption.style.opacity = String(Math.max(0, 1 - Math.max(0, t - 2.4) / 0.6));
    const f = flashAt(t);
    flash.style.opacity = f.toFixed(3);
    if (t >= WALK.length) finish();
  };

  document.body.classList.add('walking-out');
  return el;
}
