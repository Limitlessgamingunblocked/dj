/*
 * Join the crowd's friends on the floor: each one their own character from
 * the dressing room, dancing in the front rows (or wherever they asked to
 * stand) to your music, with their name over their head and, when they hold
 * one up, their own LED sign. Lives in the stage's scene, not the venue's,
 * so friends stay on the floor when you change rooms: they move to the new
 * room's floor.
 */
import * as THREE from 'three';
import { Avatar, type AvatarInput, type DjMove } from '../character/Avatar';
import { defaultLook } from '../character/look';
import type { Look } from '../core/models';
import { spotPlace, type SpotId } from '../game/crowdGuests';
import type { VenueScene } from './venues/base';

interface Dancer {
  id: string;
  name: string;
  avatar: Avatar;
  spot: SpotId;
  /** where they stand (on the floor) and which way they face */
  pos: THREE.Vector3;
  face: number;
  tag: THREE.Sprite;
  sign: THREE.Mesh | null;
  signText: string | null;
  /** dancing (tapping along) rather than stood still */
  active: boolean;
  hype: number;
  /** beats since their character last did a move by itself */
  lastAuto: number;
}

const AUTO_MOVES: DjMove[] = ['fist_pump', 'clap', 'hands_up', 'point'];

/** a sign's colours: picked from the friend's name, so the same friend has the same sign */
const SIGN_COLORS = ['#ff2e88', '#29e3ff', '#ffd23f', '#7cff6b', '#b46bff', '#ff7a29'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** their name, small, over their head */
function nameTag(name: string): THREE.Sprite {
  const tex = canvasTexture(256, 64, (g) => {
    g.font = '700 34px "Barlow Condensed", system-ui, sans-serif';
    const w = Math.min(244, g.measureText(name).width + 28);
    g.fillStyle = 'rgba(8,10,14,0.72)';
    g.beginPath();
    g.roundRect((256 - w) / 2, 8, w, 48, 24);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, 128, 33, 230);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(0.56, 0.14, 1);
  s.renderOrder = 5;
  return s;
}

/** an LED sign: their words in lights on a dark board, glowing in the dark */
function ledSign(text: string, color: string): THREE.Mesh {
  const tex = canvasTexture(512, 192, (g) => {
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, 512, 192);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 176);
    let size = 96;
    g.font = `900 ${size}px "Barlow Condensed", system-ui, sans-serif`;
    while (g.measureText(text).width > 470 && size > 36) {
      size -= 6;
      g.font = `900 ${size}px "Barlow Condensed", system-ui, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.fillStyle = color;
    g.fillText(text, 256, 100, 480);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText(text, 256, 100, 480);
  });
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.27), mat);
  m.renderOrder = 4;
  return m;
}

function disposeObject(o: THREE.Object3D): void {
  const any = o as THREE.Mesh;
  any.geometry?.dispose?.();
  const mats = Array.isArray(any.material) ? any.material : any.material ? [any.material] : [];
  for (const m of mats) {
    (m as THREE.MeshBasicMaterial).map?.dispose();
    m.dispose();
  }
}

export interface GuestStage {
  scene: THREE.Scene;
  venue: VenueScene | null;
}

export class GuestDancers {
  readonly group = new THREE.Group();
  private list = new Map<string, Dancer>();
  private placedFor: VenueScene | null = null;
  private ray = new THREE.Raycaster();
  private lastBeat = 0;

  constructor(private stage: GuestStage) {
    this.group.name = 'join-the-crowd';
    stage.scene.add(this.group);
  }

  get size(): number {
    return this.list.size;
  }

  add(id: string, name: string, look: Look | null, spot: SpotId): void {
    this.remove(id);
    const avatar = new Avatar(look ?? defaultLook());
    avatar.mode = 'idle';
    avatar.seed = hash(id) % 997;
    const tag = nameTag(name);
    const d: Dancer = { id, name, avatar, spot, pos: new THREE.Vector3(), face: 0, tag, sign: null, signText: null, active: false, hype: 0, lastAuto: 0 };
    avatar.object.add(tag);
    this.group.add(avatar.object);
    this.list.set(id, d);
    this.place();
  }

  remove(id: string): void {
    const d = this.list.get(id);
    if (!d) return;
    this.group.remove(d.avatar.object);
    d.avatar.dispose();
    disposeObject(d.tag);
    if (d.sign) disposeObject(d.sign);
    this.list.delete(id);
    this.place();
  }

  setLook(id: string, look: Look): void {
    this.list.get(id)?.avatar.setLook(look);
  }

  setSpot(id: string, spot: SpotId): void {
    const d = this.list.get(id);
    if (!d || d.spot === spot) return;
    d.spot = spot;
    this.place();
  }

  setSign(id: string, text: string | null): void {
    const d = this.list.get(id);
    if (!d || d.signText === text) return;
    if (d.sign) {
      d.avatar.object.remove(d.sign);
      disposeObject(d.sign);
      d.sign = null;
    }
    d.signText = text;
    if (!text) return;
    d.sign = ledSign(text, SIGN_COLORS[hash(d.name) % SIGN_COLORS.length]);
    d.avatar.object.add(d.sign);
    d.avatar.perform('hands_up');
  }

  perform(id: string, move: DjMove): void {
    const d = this.list.get(id);
    if (!d) return;
    d.avatar.perform(move);
    d.lastAuto = 0;
  }

  /** how they're doing: dancing along (or stood still), and their hype */
  setMood(id: string, active: boolean, hype: number): void {
    const d = this.list.get(id);
    if (!d) return;
    d.active = active;
    d.hype = hype;
  }

  /** a camera at their spot, at their eye height, looking at the booth */
  view(id: string): { pos: THREE.Vector3; target: THREE.Vector3 } | null {
    const d = this.list.get(id);
    if (!d) return null;
    const toBooth = new THREE.Vector3(-d.pos.x, 0, -d.pos.z).normalize();
    // a step behind their head, so they're in the corner of it with the booth beyond
    const pos = d.pos.clone().addScaledVector(toBooth, -1.05).add(new THREE.Vector3(0, 1.95, 0));
    pos.addScaledVector(new THREE.Vector3(toBooth.z, 0, -toBooth.x), 0.45);
    return { pos, target: new THREE.Vector3(0, 1.35, 0.5) };
  }

  /** where everyone stands (again when the room or a spot changes) */
  private place(): void {
    const v = this.stage.venue;
    this.placedFor = v;
    const crowd = v?.views.crowd.pos ?? new THREE.Vector3(0, 1.7, -6);
    const out = new THREE.Vector2(crowd.x, crowd.z);
    const reach = out.length();
    if (reach < 0.5) out.set(0, -1);
    out.normalize();
    // out from the booth towards the crowd; the crowd's right as they face the booth
    const dir = new THREE.Vector3(out.x, 0, out.y);
    const right = new THREE.Vector3(out.y, 0, -out.x).negate();
    const front = THREE.MathUtils.clamp(reach * 0.33, 2.2, 3.4);
    const count = new Map<SpotId, number>();
    for (const d of this.list.values()) {
      const nth = count.get(d.spot) ?? 0;
      count.set(d.spot, nth + 1);
      const { angle, radius } = spotPlace(d.spot, nth, front);
      const r = Math.min(radius, Math.max(front, reach - 0.5));
      const p = dir
        .clone()
        .multiplyScalar(Math.cos(angle) * r)
        .addScaledVector(right, Math.sin(angle) * r);
      p.y = this.floorAt(p.x, p.z, crowd.y);
      d.pos.copy(p);
      d.face = Math.atan2(-p.x, -p.z);
      d.avatar.object.position.copy(p);
      d.avatar.object.rotation.y = d.face;
    }
  }

  /** the floor's height under a point: the first solid surface under head height */
  private floorAt(x: number, z: number, eye: number): number {
    const v = this.stage.venue;
    if (!v) return 0;
    const top = Math.max(1.2, eye);
    this.ray.set(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = top + 4;
    for (const hit of this.ray.intersectObject(v.group, true)) {
      const o = hit.object as THREE.Mesh;
      if (!o.isMesh || (o as unknown as THREE.InstancedMesh).isInstancedMesh || (o as unknown as THREE.SkinnedMesh).isSkinnedMesh || !o.visible) continue;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && (m.transparent || !m.visible)) continue;
      // a surface you could stand on (not a wall or a pillar's side), and not up at head height
      if (hit.face && Math.abs(hit.face.normal.clone().transformDirection(o.matrixWorld).y) < 0.7) continue;
      if (hit.point.y > top - 1.1) continue;
      return hit.point.y;
    }
    return 0;
  }

  update(show: AvatarInput, dt: number): void {
    if (!this.list.size) return;
    if (this.stage.venue !== this.placedFor) this.place();
    const beat = show.beat;
    const newBeats = show.playing ? Math.max(0, Math.floor(beat) - Math.floor(this.lastBeat)) : 0;
    this.lastBeat = beat;
    const t = performance.now() / 1000;
    for (const d of this.list.values()) {
      // dancing along with their hype up: their character throws a move every couple of bars by itself
      d.lastAuto += newBeats;
      if (d.active && show.playing && d.hype > 0.35 && d.lastAuto >= (d.hype > 0.7 ? 8 : 16) && !d.avatar.performing) {
        d.avatar.perform(AUTO_MOVES[(hash(d.id) + Math.floor(beat / 8)) % AUTO_MOVES.length]);
        d.lastAuto = 0;
      }
      // the crowd's energy is theirs: stood still they just sway
      d.avatar.update({ ...show, hype: d.active ? Math.max(d.hype, show.hype ?? 0) : 0.15 }, dt);
      // the tag floats over their head; the sign's held up over it, bobbing on the beat
      d.tag.position.set(0, d.sign ? 2.62 : 2.05, 0);
      if (d.sign) {
        const ph = ((beat % 1) + 1) % 1;
        d.sign.position.set(0, 2.28 + (show.playing ? 0.035 * Math.cos(ph * Math.PI * 2) : 0.01 * Math.sin(t * 2)), 0.06);
        d.sign.rotation.set(-0.08, 0, show.playing ? 0.05 * Math.sin(beat * Math.PI * 0.5) : 0);
        // keep the arms up while the sign's up
        if (!d.avatar.performing) d.avatar.perform('hands_up');
      }
    }
  }

  dispose(): void {
    for (const id of [...this.list.keys()]) this.remove(id);
    this.stage.scene.remove(this.group);
  }
}
