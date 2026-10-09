# Assets

Every 3D asset in the game (Section 14.8). **Generated** by `node scripts/assets-report.mjs` from the export reports in `assets/models/`; edit `assets/status.json` to mark an asset tested in the engine. Pipeline rules: `assets_source/blender/README.md`. Budgets: `scripts/blender/budgets.json`.

| Asset | Category | Triangles / budget | LODs | Rigged | Customisable | Preview | In-engine tested | Problems |
|---|---|---:|---|---|---|---|---|---|
| _none yet_ | | | | | | | | |

**No modelled assets yet.** Everything the player sees is still procedural (built in code), including the character, its hair and outfits (`src/character/Avatar.ts`) and the dressing room. Modelling needs Blender access; see TODO.md.
