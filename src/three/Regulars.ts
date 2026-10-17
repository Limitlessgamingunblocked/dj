/*
 * The regulars: the realistic clubbers filling the dance floor, men and
 * women, made the same way as the DJ (scanned people fitted to the same
 * skeleton) and dancing on the beat: each with their own few club moves
 * (src/character/clubDance.ts), the men's and the women's, changing every few
 * bars at their own times. One is the regular made for the floor; the others
 * wear the outfit sets, so each venue gets its own crowd.
 *
 * Each takes the place of one of the crowd's dancers (who steps aside while
 * the regular is there, and comes back when they go), so they stand in the
 * crowd, behind any barrier, facing the booth: the whole floor from the
 * front back, as many as the room can draw smoothly (the light crowd and the
 * cut-outs carry on behind them). Off where there's no crowd (the bedroom,
 * the dressing room…).
 *
 * Drawing that many: the people near the camera are drawn in full; the rest
 * with the light copy of their body (scripts/scan/lod.mjs) and no shadow of
 * their own, and the far ones move every other frame. Anyone out of shot
 * isn't drawn or moved at all.
 */
import * as THREE from 'three';
import { Avatar, type AvatarInput } from '../character/Avatar';
import { OUTFIT_SETS } from '../character/catalog';
import { ClubDancer, MEN_MOVES, WOMEN_MOVES, type ClubMove } from '../character/clubDance';
import { defaultLook, wearSet } from '../character/look';
import type { Look } from '../core/models';
import { Crowd, type CrowdSpot } from './venues/crowd';
import type { VenueScene } from './venues/base';

/** the regular made for the floor */
export const REGULAR_SCAN = 'character_scan_regular_01';
/** who's out on the floor: the regular, then the outfit sets (no robots, no DJ), the women spread through */
const CAST: { set: string | null; woman: boolean }[] = [
  { set: null, woman: false },
  { set: 'sunrise_set', woman: true },
  { set: 'selector', woman: false },
  { set: 'tracksuit_royalty', woman: false },
  { set: 'afterhours', woman: true },
  { set: 'acid_smiley', woman: false },
  { set: 'terrace_king', woman: false },
  { set: 'disco_revival', woman: true },
  { set: 'warehouse_ghost', woman: false },
  { set: 'basement_dweller', woman: true },
  { set: 'chrome_boy', woman: false },
  { set: 'bedroom_legend', woman: false },
  { set: 'boat_captain', woman: false },
];

/** how many at most, how far apart, and how far back from the booth */
const COUNT = 72;
const APART = 0.72;
const REACH = 16;
/** crowd people closer than this to a regular step aside too */
const ROOM = 0.75;
/** how many are drawn in full detail at once (the nearest the camera), and within how far of it */
const FULL = 14;
const FULL_AT = 7;
/** past this far from the camera they move every other frame */
const HALF_RATE_AT = 9;
/** how tall the men and the women stand (the scans come a little short), give or take */
const TALL = { man: 1.77, woman: 1.66, spread: 0.05 };

/** the i-th regular in a venue: who they are (each venue starts the cast somewhere else) */
export function regularCast(i: number, seed: number): { look: Look; woman: boolean } {
  const c = CAST[(seed + i) % CAST.length];
  const l = defaultLook(`regular_${seed}_${i}`, 'Regular');
  if (!c.set) {
    l.options = { ...l.options, scan: REGULAR_SCAN };
    return { look: l, woman: c.woman };
  }
  const set = OUTFIT_SETS.find((s) => s.id === c.set);
  return { look: set ? wearSet(l, set) : l, woman: c.woman };
}

/** a regular's moves: three of their kind's, in their own order */
export function regularMoves(woman: boolean, seed: number): ClubMove[] {
  const all = woman ? WOMEN_MOVES : MEN_MOVES;
  const start = seed % all.length;
  const step = seed % 2 ? 1 : all.length - 1;
  return [0, 1, 2].map((k) => all[(start + k * step) % all.length]);
}

/**
 * Where they stand: the crowd's dancers from the booth back, spread apart;
 * each regular takes that dancer's spot (`of`: its index in the list). Pure,
 * for the tests.
 */
export function regularSpots(spots: CrowdSpot[], booth = new THREE.Vector2(0, 0), n = COUNT): { x: number; y: number; z: number; face: number; of: number }[] {
  const near = spots
    .map((s, i) => ({ s, i, d: Math.hypot(s.x - booth.x, s.z - booth.y) }))
    .filter(({ s, d }) => (s.role ?? 'dancer') === 'dancer' && d >= 0.9 && d <= REACH)
    .sort((a, b) => a.d - b.d);
  const out: { x: number; y: number; z: number; face: number; of: number }[] = [];
  for (const { s, i } of near) {
    if (out.length >= n) break;
    if (out.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < APART)) continue;
    // facing the booth (the avatar faces +z at rest), give or take a little
    const turn = (((out.length * 7919) % 11) / 10 - 0.5) * 0.5;
    out.push({ x: s.x, y: s.y ?? 0, z: s.z, face: Math.atan2(booth.x - s.x, booth.y - s.z) + turn, of: i });
  }
  return out;
}

/** what the regulars need of a crowd: its spots, and its people's places (kept to itself, so read through here) */
interface CrowdInside {
  spots?: CrowdSpot[];
  where?: { chunk: number; j: number }[];
  chunks?: { mesh: THREE.InstancedMesh }[];
  shadowMesh?: THREE.InstancedMesh | null;
}

/** the crowd spots of a venue in world space, wherever its crowds sit (its fixtures, or a crowd of its own), each with the crowd it's in */
function crowdSpots(venue: VenueScene): { spot: CrowdSpot; crowd: Crowd; i: number }[] {
  const fixtures = (venue as unknown as { fixtures?: unknown[] }).fixtures ?? [];
  const crowds = new Set([...fixtures, ...Object.values(venue)].filter((f): f is Crowd => f instanceof Crowd));
  venue.group.updateMatrixWorld(true);
  const out: { spot: CrowdSpot; crowd: Crowd; i: number }[] = [];
  const p = new THREE.Vector3();
  for (const f of crowds) {
    ((f as unknown as CrowdInside).spots ?? []).forEach((s, i) => {
      f.object.localToWorld(p.set(s.x, s.y ?? 0, s.z));
      out.push({ spot: { ...s, x: p.x, y: p.y, z: p.z }, crowd: f, i });
    });
  }
  return out;
}

/** a crowd member stepping aside for a regular (shrunk to nothing where they stand), and back */
class StandIn {
  private home = new THREE.Matrix4();
  private shadowHome = new THREE.Matrix4();
  private away = false;
  constructor(
    private crowd: Crowd,
    private i: number,
  ) {}

  private parts() {
    const c = this.crowd as unknown as CrowdInside;
    const w = c.where?.[this.i];
    const mesh = w && c.chunks?.[w.chunk]?.mesh;
    return mesh ? { mesh, j: w.j, shadow: c.shadowMesh ?? null } : null;
  }

  set aside(on: boolean) {
    if (on === this.away) return;
    const p = this.parts();
    if (!p) return;
    this.away = on;
    if (on) {
      p.mesh.getMatrixAt(p.j, this.home);
      p.mesh.setMatrixAt(p.j, ZERO);
      if (p.shadow && this.i < p.shadow.count) {
        p.shadow.getMatrixAt(this.i, this.shadowHome);
        p.shadow.setMatrixAt(this.i, ZERO);
      }
    } else {
      p.mesh.setMatrixAt(p.j, this.home);
      if (p.shadow && this.i < p.shadow.count) p.shadow.setMatrixAt(this.i, this.shadowHome);
    }
    p.mesh.instanceMatrix.needsUpdate = true;
    if (p.shadow) p.shadow.instanceMatrix.needsUpdate = true;
  }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** one of them on the floor: the person, and how they're drawn this frame */
interface Regular {
  av: Avatar;
  woman: boolean;
  /** time they've missed while out of shot or skipped a frame */
  owed: number;
  /** their full body and its light copy, once the scan's in (found by name: the scan's own meshes) */
  full: THREE.Object3D | null;
  lod: THREE.Object3D | null;
  /** how tall they'll stand */
  tall: number;
  /** the crowd's people who step aside for them */
  standIns: StandIn[];
}

export class Regulars {
  readonly group = new THREE.Group();
  private dancers: Regular[] = [];
  private venue = '';
  private frame = 0;
  private frustum = new THREE.Frustum();
  private viewProj = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  enabled = true;
  /**
   * how much of the floor they fill (0–1): the graphics quality and how the
   * frame rate's holding up; the ones further back give their places back to
   * the light crowd first
   */
  share = 1;

  constructor() {
    this.group.visible = false;
  }

  /** a new venue: its floor filled from the front back, or none */
  setVenue(id: string, venue: VenueScene | null): void {
    if (id === this.venue) return;
    this.venue = id;
    this.clear();
    if (!venue) return;
    const seed = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 11) & 0xffff;
    const all = crowdSpots(venue);
    const spots = regularSpots(all.map((a) => a.spot));
    // the crowd's people they stand in for, and any squeezed in right next to them (room to dance)
    const asides: StandIn[][] = spots.map(() => []);
    all.forEach((a, k) => {
      let by = spots.findIndex((p) => p.of === k);
      if (by < 0) by = spots.findIndex((p) => Math.hypot(p.x - a.spot.x, p.z - a.spot.z) < ROOM);
      if (by >= 0) asides[by].push(new StandIn(a.crowd, a.i));
    });
    spots.forEach((p, i) => {
      const who = regularCast(i, seed);
      const av = new Avatar(who.look);
      av.mode = 'hype';
      av.side = p.x < 0 ? -1 : 1;
      av.seed = (seed + i * 5) % 7;
      // their own moves, changing at their own time, with their own favourite hand
      const own = seed + i * 7;
      av.club = new ClubDancer(regularMoves(who.woman, own), own % 3 ? 'r' : 'l', (own * 3) % 8, (own * 0.618034) % 1);
      av.object.position.set(p.x, p.y, p.z);
      av.object.rotation.y = p.face;
      this.group.add(av.object);
      const base = who.woman ? TALL.woman : TALL.man;
      this.dancers.push({ av, woman: who.woman, owed: 0, full: null, lod: null, tall: base + ((((own * 7919) % 13) / 12) * 2 - 1) * TALL.spread, standIns: asides[i] });
    });
  }

  private clear(): void {
    for (const d of this.dancers) {
      for (const st of d.standIns) st.aside = false;
      d.av.object.removeFromParent();
      d.av.dispose();
    }
    this.dancers = [];
  }

  /** a regular's scan meshes, once it's in: stood at their height */
  private find(d: Regular): void {
    let up: THREE.Object3D | null = d.full;
    while (up && up !== d.av.object) up = up.parent;
    if (up) return;
    d.full = d.lod = null;
    d.av.object.traverse((o) => {
      if (o.name === 'scan_body') d.full = o;
      else if (o.name === 'scan_lod') d.lod = o;
    });
    const geo = (d.full as THREE.Mesh | null)?.geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const h = geo.boundingBox!.max.y;
    d.av.object.scale.setScalar(h > 1 ? d.tall / h : 1);
  }

  /** every frame: dance (the ones in shot; the nearest in full, the rest lighter) */
  update(s: AvatarInput, show: boolean, dt: number, camera?: THREE.Camera): void {
    this.group.visible = this.enabled && show && this.dancers.length > 0;
    // the crowd members they stand in for are back whenever the regulars aren't there
    const here = Math.ceil(this.dancers.length * THREE.MathUtils.clamp(this.share, 0, 1));
    this.dancers.forEach((d, i) => {
      const on = this.group.visible && i < here;
      for (const st of d.standIns) st.aside = on;
      if (!on) d.av.object.visible = false;
    });
    if (!this.group.visible) return;
    this.frame++;
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    const eye = camera?.getWorldPosition(_eye);
    // the nearest the camera first: they get the full detail
    const order = this.dancers
      .slice(0, here)
      .map((d, i) => ({ d, i, far: eye ? d.av.object.position.distanceTo(eye) : 0 }))
      .sort((a, b) => a.far - b.far);
    let full = 0;
    for (const { d, i, far } of order) {
      const o = d.av.object;
      this.sphere.center.copy(o.position).y += 0.9;
      this.sphere.radius = 1.3;
      const seen = !camera || this.frustum.intersectsSphere(this.sphere);
      o.visible = seen;
      d.owed += dt;
      if (!seen) continue;
      // further back: every other frame (each on their own frame)
      if (far > HALF_RATE_AT && (this.frame + i) % 2) continue;
      d.av.update(s, Math.min(d.owed, 0.25));
      d.owed = 0;
      this.find(d);
      // (a little further for whoever's already in full, so nobody flickers between the two at the edge)
      const near = !d.lod || (far < FULL_AT + (d.full?.visible ? 0.8 : 0) && full < FULL);
      if (near) full++;
      if (d.full) {
        d.full.visible = near;
        d.full.castShadow = near;
      }
      if (d.lod) d.lod.visible = !near;
    }
  }

  get count(): number {
    return this.dancers.length;
  }

  dispose(): void {
    this.clear();
  }
}
const _eye = new THREE.Vector3();
