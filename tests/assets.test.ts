import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { colorZones, modelNames, nameSurfaces, parseAssetName } from '../src/three/assets';

describe('asset pipeline (engine side)', () => {
  it('reads names that follow category_item_variant_##', () => {
    expect(parseAssetName('board_fader_long_01')).toEqual({ category: 'board', item: 'fader', variant: 'long', index: 1, lod: 0 });
    expect(parseAssetName('prop_lavalamp_01')).toEqual({ category: 'prop', item: 'lavalamp', variant: null, index: 1, lod: 0 });
    expect(parseAssetName('outfit_terraceking_shirt_01')?.category).toBe('outfit');
    expect(parseAssetName('venue_warehouse_wall_03')?.index).toBe(3);
    expect(parseAssetName('character_crowd_dancer_01_lod2')?.lod).toBe(2);
    for (const bad of ['Board_Fader_01', 'board-fader-01', 'board_fader_1', 'gadget_thing_01', 'board_fader_01_lod4', 'prop__01']) expect(parseAssetName(bad)).toBeNull();
  });

  it('finds the name surface and the colour zones on a model', () => {
    const root = new THREE.Group();
    const name = new THREE.MeshBasicMaterial({ name: 'name_surface' });
    const z1 = new THREE.MeshStandardMaterial({ name: 'zone1' });
    const z2 = new THREE.MeshStandardMaterial({ name: 'shirt_zone2' });
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), name), new THREE.Mesh(new THREE.BoxGeometry(), [z1, z2, new THREE.MeshStandardMaterial({ name: 'metal' })]));
    expect(nameSurfaces(root)).toHaveLength(1);
    const zones = colorZones(root);
    expect(zones.get(1)).toEqual([z1]);
    expect(zones.get(2)).toEqual([z2]);
    expect(zones.has(3)).toBe(false);
  });

  it('lists exported models (none yet)', () => {
    expect(Array.isArray(modelNames())).toBe(true);
  });
});
