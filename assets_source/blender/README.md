# Blender sources

One `.blend` per asset (or per small family of assets), in the folder for its category:

```
characters/  outfits/  hair/  accessories/
board/  venues/<venue_name>/  props/  animations/
```

## Rules the export script checks

- **Names:** `category_item_variant_##`, lower case, e.g. `board_fader_long_01`, `outfit_terraceking_shirt_01`, `venue_warehouse_wall_03`, `prop_lavalamp_01`. Lower-detail versions add `_lod1`, `_lod2`, `_lod3`.
- **One asset = one top-level collection** with that name. If a file has no such collections, each top-level object with a valid name is an asset.
- **Scale:** 1 unit = 1 metre. Apply rotation and scale. The pivot is the base centre.
- **Triangle budgets** (Section 14.4) are in `scripts/blender/budgets.json`.
- **Colour zones:** materials named `zone1`, `zone2`, `zone3`, or ending in `_zone1` and so on. Never bake a fixed colour into a texture on anything customisable.
- **Name surface:** every sign, screen and LED wall has a material slot named `name_surface` for the NameService.
- **Shape keys** on the character use the slider names exactly (`jaw_width`, `nose_bridge`, `lip_fullness`, `height`, `shoulder_width`…). Outfits carry the same shape keys so they follow the body.
- **Moving parts** (knob caps, fader caps, platters, levers, buttons, flip covers) are separate, named sub-objects.
- **Dance animations** are authored at **124 BPM**, looping exactly on 1, 2 or 4 bars. The engine time-scales them to the current tempo.

## Export

```
blender -b assets_source/blender/board/faders.blend -P scripts/blender/export_glb.py -- --out assets/models
blender -b assets_source/blender/board/faders.blend -P scripts/blender/preview.py -- --out assets/previews
node scripts/assets-report.mjs        # rebuilds ASSETS.md from the export reports
```

`export_glb.py` writes `assets/models/<name>.glb` and `<name>.report.json` (triangles, budget, LODs, rig, shape keys, zones, name surface, problems). It exits non-zero if an asset breaks a rule; add `--force` to export anyway. The game finds models by name (`src/three/assets.ts`).
