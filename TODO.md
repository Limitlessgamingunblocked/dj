# TODO

Every placeholder in the code is marked `TODO:` and listed here (Section 0). Stage backlogs follow. Tick items off as they land, and delete them when the stage ships.

## Placeholders in the code

| Where | What's missing | Stage |
|---|---|---|
| `src/core/BeatClock.ts` | Sections come from the audio features (breakdown depth, drop detector). Read the tracks' section markers when the game library has them, and fall back to features for imported music. | 3 |
| `src/core/models.ts` → `Look` | Provisional shape. The character model (slider names = Blender shape keys, slots, materials) is settled in Stage 2, then `LOOKS` goes to version 2 with a migration. | 2 |
| `src/core/models.ts` → `BoardDoc` | Provisional shape. The board file format gets documented, with its component types, in Stage 5. | 5 |
| `scripts/blender/export_glb.py`, `preview.py` | Written against the Blender 4.x API but never run: there's no Blender in the build container. Run both on a test `.blend` once Blender is available. | 1 → 2 |

## Blocked: needs a decision from you

- [ ] **Blender access** (Section 14). There's no Blender connector in this session and Blender isn't installed. Options:
  - attach the Blender connector
  - let me install Blender 4.0 from the Ubuntu packages in the container (large, roughly 400 MB, and reinstalled each session)
  - keep building assets procedurally in code, and add Blender models later

  Until this is settled, no modelled assets can be made.

## Stage 1 follow-ups (foundation)

- [ ] Move the light show (`show.ts`), crowd envelopes and Auto DJ onto `BeatClock` events. Today they read the same beat grid through the features. The camera director already uses the clock.
- [ ] Latency calibration tool in Settings (Section 15). Output latency is shown, and the visual delay is adjustable, but there's no tap-to-measure.
- [ ] Gamepad support in `InputMapping` (Sections 10.5 and 13.10).
- [ ] Export / import of career saves (the settings export deliberately leaves them out, so "reset settings" can't wipe a career).
- [ ] Run the performance worst case (festival crowd, heavy board, recording + replay buffer) on real hardware (Section 16.5). Only software rendering is available here.

## Stage 2: Identity

- [ ] Naming scene (dark room, LED sign letters with buzz, preview strip in 4 styles, confirm moment).
- [ ] `NameService` with style IDs, auto-fit, texture cache, live rename. Offensive-word filter.
- [ ] Name on every surface that exists (booth panel, LED wall, laser outline, neon, flyers…).
- [ ] Character creator (dressing room, lighting previews, body / face / eyes / hair / makeup / tattoos / piercings, outfit slots and sets, personality).
- [ ] Wardrobe, saved looks, dress-code bonus.
- [ ] Base character, rig, hair and outfits in Blender (blocked; see above).

## Stage 3: First playable gig

- [ ] Bedroom (tutorial) and Basement venues.
- [ ] Assist levels, beatmatch scoring bands, named transitions, slot targets, vibe meter, results screen, encore.
- [ ] Lighting rules mapped per Section 2.3: hats → pin spots, vocals → DJ spotlight, intensity from vibe.
- [ ] Crowd states cold → euphoric, crowd audio.
- [ ] Track library: section markers, energy 1–10, tags. Re-skin or replace the techno and breaks demos for the brief's lanes; reach 10+ tracks for this stage (40+ by Stage 6).

## Stage 4: Recording & replay

- [ ] WAV (24-bit / 48 kHz) and MP3 320 export, video + audio, booth cam, quality settings, overlays, cover art, tracklist.
- [ ] Ring-buffer replay (lossless audio), Save That Mix, Clip It, trim editor, smart markers, My Sets, storage manager.

## Stage 5: Board Builder

See Section 13 of the brief: editor, inspector, components, add-ons, show controls, decorations, wiring, MIDI, saving and sharing, performance guard.

## Stage 6: The world

Remaining venues and signature moments, VIP crew and NPCs, progression, bookings, reputation, hub, social feed, B2B rivals, the full track library.

## Stage 7: Polish & release prep

Accessibility (flashing warning, colour-blind modes, high contrast, subtitles, volume buses), performance pass, UI polish, audio pass, clear this file.
