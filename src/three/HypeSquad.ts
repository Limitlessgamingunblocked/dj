/*
 * The side dancers: two dancers on lit podiums either side of the DJ.
 * They dance on the beat with smooth, blended moves (hip sway, hands up,
 * shimmy, body roll, pointing at you), clap through the build and jump on
 * the drop. Built on the same procedural avatar as you (Avatar's 'hype'
 * mode, not the scanned characters); their looks are club outfits (crop,
 * mesh or sequin tops with cargos, flares, jeans or skirts, trainers,
 * platforms or boots) with skin, hair and colours varied by seed, so each
 * venue has its own pair. Off in the bedroom, the naming scene and anywhere
 * you've been put somewhere else.
 */
import * as THREE from 'three';
import { Avatar, type AvatarInput } from '../character/Avatar';
import { NATURAL_HAIR, SKIN_TONES, WILD_HAIR } from '../character/catalog';
import { defaultLook } from '../character/look';
import type { Look } from '../core/models';

/** where the pair stand, per venue (x of the right-hand podium; the left mirrors it) */
export interface HypeSpot {
  x: number;
  z: number;
  /** podium height; 0 for none (they stand on a raised stage already) */
  podium: number;
}

const DEFAULT_SPOT: HypeSpot = { x: 2.35, z: 0.45, podium: 0.32 };
const SPOTS: Record<string, HypeSpot | null> = {
  bedroom: null,
  naming: null,
  dressing: null,
  hub: null,
  basement: { x: 1.45, z: 0.35, podium: 0.2 },
  boilerroom: { x: 1.6, z: 0.35, podium: 0.25 },
  rooftop: { x: 1.8, z: 0.4, podium: 0.3 },
};

export function hypeSpot(venue: string): HypeSpot | null {
  return venue in SPOTS ? SPOTS[venue] : DEFAULT_SPOT;
}

const HAIR = ['long_waves', 'long_straight', 'high_ponytail', 'box_braids_long', 'long_curls', 'space_buns', 'afro_medium', 'half_up'];
const TOPS = ['crop_top', 'top_sequin', 'tank_mesh', 'crop_top', 'top_sequin'];
const BOTTOMS = ['cargos_black', 'skirt_mini', 'trousers_flared', 'jeans_straight', 'skirt_sequin', 'cargos_baggy'];
const SHOES = ['platforms', 'trainers_chunky', 'gogo_boots', 'trainers_silver', 'high_tops'];
const NEON = ['#ff2e88', '#3ad7ff', '#b6ff3b', '#ffb547', '#7a3cff', '#ffffff', '#ff5b2e', '#2effc5', '#d4a64a'];
const LIPS = ['#b3122e', '#8a1238', '#d94a6a', '#7a2a1e', '#c2185b', '#9c4a3a'];

function rand(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** a glam go-go look, the same for the same seed */
export function hypeLook(seed: number): Look {
  const r = rand(seed + 7);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
  const l = defaultLook(`hype_${seed}`, 'Side dancer');
  const j = (v: number, spread = 0.15) => Math.max(-1, Math.min(1, v + (r() - 0.5) * 2 * spread));
  l.sliders = {
    height: j(0.1, 0.3),
    shoulder_width: j(-0.45),
    chest: j(0.15),
    waist: j(-0.5, 0.15),
    hips: j(0.35),
    arm_thickness: j(-0.45),
    leg_length: j(0.3, 0.2),
    muscle_definition: j(-0.1),
    body_weight: j(-0.15, 0.25),
    jaw_width: j(-0.6),
    jaw_angle: j(-0.5),
    chin_shape: j(-0.3),
    cheekbones: j(0.5),
    lip_fullness: j(0.6),
    nose_width: j(-0.4),
    brow_thickness: j(-0.6),
    eye_size: j(0.35),
    lash_length: 0.9,
    lash_volume: 0.8,
    glitter: r() * 0.4,
  };
  const top = pick(TOPS);
  const bottom = pick(BOTTOMS);
  const hair = pick(HAIR);
  const wild = r() < 0.3;
  const c1 = pick(NEON);
  l.items = {
    hair,
    top,
    bottom,
    shoes: pick(SHOES),
    eyewear: r() < 0.2 ? 'cat_eye' : null,
    neck: r() < 0.4 ? 'chain_gold' : null,
    wrists: r() < 0.5 ? 'rings' : null,
    headphones: null,
    head: null,
    outer: null,
    socks: null,
    bag: null,
  };
  l.colors = {
    ...l.colors,
    skin: pick(SKIN_TONES),
    hair: wild ? pick(WILD_HAIR) : pick(NATURAL_HAIR.slice(0, 10)),
    hair2: pick(WILD_HAIR),
    brows: '#1d140e',
    lips: pick(LIPS),
    eyeshadow: c1,
    liner: '#111111',
    top_1: c1,
    bottom_1: r() < 0.5 ? '#111111' : pick(NEON),
    shoes_1: r() < 0.6 ? '#f4f4f2' : c1,
  };
  l.options = {
    ...l.options,
    face_shape: pick(['heart', 'oval'] as const),
    brows: pick(['soft_arch', 'high_arch', 'thin_arch'] as const),
    facial_hair: 'clean',
    eyeliner: pick(['wing', 'classic'] as const),
    hair_finish: 'glossy',
    hair_color_mode: wild ? 'solid' : r() < 0.3 ? 'tips' : 'solid',
  };
  l.tattoos = [];
  l.piercings = r() < 0.5 ? ['ear_lobe_l', 'ear_lobe_r'] : [];
  return l;
}

export class HypeSquad {
  readonly group = new THREE.Group();
  private dancers: Avatar[] = [];
  private podiums = new THREE.Group();
  private ringMats: THREE.MeshBasicMaterial[] = [];
  private venue = '';
  private spot: HypeSpot | null = null;
  enabled = true;

  constructor() {
    this.group.add(this.podiums);
    this.group.visible = false;
  }

  /** a new venue: a new pair, or none */
  setVenue(id: string): void {
    if (id === this.venue) return;
    this.venue = id;
    this.spot = hypeSpot(id);
    this.clear();
    if (!this.spot) return;
    const seed = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
    for (const side of [-1, 1]) {
      const av = new Avatar(hypeLook(seed + (side > 0 ? 1 : 0)));
      av.mode = 'hype';
      av.side = side;
      av.seed = side > 0 ? 3 : 0;
      av.object.position.set(side * this.spot.x, this.spot.podium, this.spot.z);
      // facing the room, turned a little towards the middle
      av.object.rotation.y = Math.PI - side * 0.35;
      this.group.add(av.object);
      this.dancers.push(av);
      if (this.spot.podium > 0) this.podium(side * this.spot.x, this.spot.z, this.spot.podium);
    }
  }

  /** a round podium with an LED ring that pulses with the kick */
  private podium(x: number, z: number, h: number): void {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, h, 32), new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.35, metalness: 0.4 }));
    top.position.set(x, h / 2, z);
    top.receiveShadow = true;
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.2, 0.9), toneMapped: false });
    this.ringMats.push(ringMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.012, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, h - 0.01, z);
    const base = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.01, 8, 48), ringMat);
    base.rotation.x = Math.PI / 2;
    base.position.set(x, 0.015, z);
    this.podiums.add(top, ring, base);
  }

  private clear(): void {
    for (const d of this.dancers) {
      d.object.removeFromParent();
      d.dispose();
    }
    this.dancers = [];
    this.podiums.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.podiums.clear();
    this.ringMats = [];
  }

  /** every frame: dance; the rings take the palette and the kick */
  update(s: AvatarInput, color: THREE.Color, show: boolean, dt: number): void {
    this.group.visible = this.enabled && show && this.dancers.length > 0;
    if (!this.group.visible) return;
    for (const d of this.dancers) d.update(s, dt);
    for (const m of this.ringMats) m.color.copy(color).multiplyScalar(0.8 + s.kick * 1.4 + s.peak * 0.5);
  }

  dispose(): void {
    this.clear();
  }
}
