/*
 * Engine side of the Blender pipeline (Section 14): models exported to
 * assets/models/*.glb by scripts/blender/export_glb.py are found here by
 * name, loaded once and cloned per use.
 *   – names follow category_item_variant_## (optionally _lod1.._lod3), the
 *     same rule the export script enforces
 *   – materials named name_surface are where the NameService draws the DJ
 *     name; materials named zone1 / zone2 / zone3 (or ending _zone1…) are the
 *     colour zones customisation recolours at runtime
 * The single-file build inlines the .glb files (vite.config.ts), so keep an
 * eye on their size: that page has a 16 MB ceiling.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export const ASSET_CATEGORIES = ['character', 'outfit', 'hair', 'accessory', 'board', 'venue', 'prop', 'anim'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** category_item[_variant]_##[_lodN]: board_fader_long_01, prop_lavalamp_01, character_crowd_dancer_01_lod1 */
export const ASSET_NAME = /^(character|outfit|hair|accessory|board|venue|prop|anim)_([a-z0-9]+)(?:_([a-z0-9]+(?:_[a-z0-9]+)*))?_(\d{2})(?:_lod([0-3]))?$/;

export interface AssetName {
  category: AssetCategory;
  item: string;
  variant: string | null;
  index: number;
  lod: number;
}

export function parseAssetName(name: string): AssetName | null {
  const m = ASSET_NAME.exec(name);
  if (!m) return null;
  return { category: m[1] as AssetCategory, item: m[2], variant: m[3] ?? null, index: Number(m[4]), lod: m[5] ? Number(m[5]) : 0 };
}

/** every exported model, by name (empty until the first export) */
const URLS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('/assets/models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>).map(([path, url]) => [path.replace(/^.*\/|\.glb$/g, ''), url]),
);

export function modelNames(): string[] {
  return Object.keys(URLS).sort();
}

export function hasModel(name: string): boolean {
  return name in URLS;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Load a model once; every call gets its own copy (skinned meshes keep their own skeleton). */
export async function loadModel(name: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const url = URLS[name];
  if (!url) throw new Error(`No model called ${name} in assets/models`);
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(name, p);
    p.catch(() => cache.delete(name));
  }
  const gltf = await p;
  return { scene: SkeletonUtils.clone(gltf.scene), animations: gltf.animations };
}

const materialsOf = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

/** the meshes with a name_surface material, where the DJ name is drawn */
export function nameSurfaces(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && materialsOf(m).some((mat) => mat.name === 'name_surface')) out.push(m);
  });
  return out;
}

/** the colour-zone materials (zone1..zone3), so customisation can recolour them */
export function colorZones(root: THREE.Object3D): Map<1 | 2 | 3, THREE.Material[]> {
  const zones = new Map<1 | 2 | 3, THREE.Material[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of materialsOf(m)) {
      const z = /(?:^|_)zone([123])$/.exec(mat.name);
      if (!z) continue;
      const k = Number(z[1]) as 1 | 2 | 3;
      const list = zones.get(k) ?? [];
      if (!list.includes(mat)) list.push(mat);
      zones.set(k, list);
    }
  });
  return zones;
}
