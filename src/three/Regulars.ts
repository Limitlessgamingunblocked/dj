/*
 * The regulars: a few realistic clubbers right at the front of the dance
 * floor, made the same way as the DJ (scanned people fitted to the same
 * skeleton) and dancing on the beat: motion-captured club dances
 * (src/character/danceClip.ts), each their own, locked to the music. One is the
 * regular made for the floor; the others wear the outfit sets, so each
 * venue gets its own handful.
 *
 * Each takes the place of one of the crowd's front-row dancers (who steps
 * aside while the regular is there, and comes back when they go), so they
 * stand in the crowd, behind any barrier, facing the booth. Off where
 * there's no crowd (the bedroom, the dressing room…).
 */
import * as THREE from 'three';
import { Avatar, type AvatarInput } from '../character/Avatar';
import { OUTFIT_SETS } from '../character/catalog';
import { DANCES } from '../character/danceClip';
import { defaultLook, wearSet } from '../character/look';
import type { Look } from '../core/models';
import { Crowd, type CrowdSpot } from './venues/crowd';
import type { VenueScene } from './venues/base';

/** the regular made for the floor, then outfit sets the others wear (no robots on the floor) */
export const REGULAR_SCAN = 'character_scan_regular_01';
const REGULAR_SETS = ['afterhours', 'selector', 'acid_smiley', 'sunrise_set', 'basement_dweller', 'tracksuit_royalty', 'terrace_king', 'warehouse_ghost', 'bedroom_legend', 'disco_revival'];

/** how many at most, and how far apart */
const COUNT = 3;
const APART = 1.3;

/** a regular's look: the floor regular first, then sets picked by seed */
export function regularLook(i: number, seed: number): Look {
  const l = defaultLook(`regular_${seed}_${i}`, 'Regular');
  if (i === 0) {
    l.options = { ...l.options, scan: REGULAR_SCAN };
    return l;
  }
  const id = REGULAR_SETS[(seed + i * 3) % REGULAR_SETS.length];
  const set = OUTFIT_SETS.find((s) => s.id === id);
  return set ? wearSet(l, set) : l;
}

/**
 * Where they stand: the crowd's dancers nearest the booth (and near its
 * middle), spread apart; each regular takes that dancer's spot (`of`: its
 * index in the list). Pure, for the tests.
 */
export function regularSpots(spots: CrowdSpot[], booth = new THREE.Vector2(0, 0), n = COUNT): { x: number; y: number; z: number; face: number; of: number }[] {
  const near = spots
    .map((s, i) => ({ s, i, d: Math.hypot(s.x - booth.x, s.z - booth.y) }))
    .filter(({ s, d }) => (s.role ?? 'dancer') === 'dancer' && d >= 1.4 && d <= 9 && Math.abs(s.x - booth.x) < 3.5)
    .sort((a, b) => a.d - b.d);
  const out: { x: number; y: number; z: number; face: number; of: number }[] = [];
  for (const { s, i } of near) {
    if (out.length >= n) break;
    if (out.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < APART)) continue;
    // facing the booth (the avatar faces +z at rest)
    out.push({ x: s.x, y: s.y ?? 0, z: s.z, face: Math.atan2(booth.x - s.x, booth.y - s.z), of: i });
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

/** the crowd spots of a venue in world space, wherever its crowds sit, each with the crowd it's in */
function crowdSpots(venue: VenueScene): { spot: CrowdSpot; crowd: Crowd; i: number }[] {
  const fixtures = (venue as unknown as { fixtures?: unknown[] }).fixtures ?? [];
  venue.group.updateMatrixWorld(true);
  const out: { spot: CrowdSpot; crowd: Crowd; i: number }[] = [];
  const p = new THREE.Vector3();
  for (const f of fixtures) {
    if (!(f instanceof Crowd)) continue;
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

export class Regulars {
  readonly group = new THREE.Group();
  private dancers: Avatar[] = [];
  private standIns: StandIn[] = [];
  private venue = '';
  enabled = true;

  constructor() {
    this.group.visible = false;
  }

  /** a new venue: a new handful at the front of its crowd, or none */
  setVenue(id: string, venue: VenueScene | null): void {
    if (id === this.venue) return;
    this.venue = id;
    this.clear();
    if (!venue) return;
    const seed = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 11) & 0xffff;
    const all = crowdSpots(venue);
    regularSpots(all.map((a) => a.spot)).forEach((p, i) => {
      this.standIns.push(new StandIn(all[p.of].crowd, all[p.of].i));
      const av = new Avatar(regularLook(i, seed));
      av.mode = 'hype';
      av.side = p.x < 0 ? -1 : 1;
      // (each their own moves, so they're never in lockstep)
      av.seed = (seed + i * 5) % 7;
      // a motion-captured dance each, started at a different point
      av.moves = DANCES[(seed + i) % DANCES.length];
      av.movesAt = ((seed * 7 + i * 13) % 40) * 0.25;
      av.object.position.set(p.x, p.y, p.z);
      av.object.rotation.y = p.face;
      this.group.add(av.object);
      this.dancers.push(av);
    });
  }

  private clear(): void {
    for (const s of this.standIns) s.aside = false;
    this.standIns = [];
    for (const d of this.dancers) {
      d.object.removeFromParent();
      d.dispose();
    }
    this.dancers = [];
  }

  /** every frame: dance */
  update(s: AvatarInput, show: boolean, dt: number): void {
    this.group.visible = this.enabled && show && this.dancers.length > 0;
    // the crowd members they stand in for are back whenever the regulars aren't there
    for (const st of this.standIns) st.aside = this.group.visible;
    if (!this.group.visible) return;
    for (const d of this.dancers) d.update(s, dt);
  }

  get count(): number {
    return this.dancers.length;
  }

  dispose(): void {
    this.clear();
  }
}
