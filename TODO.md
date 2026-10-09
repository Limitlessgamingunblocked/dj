# TODO

Every placeholder in the code is marked `TODO:` and listed here (Section 0). Stage backlogs follow. Tick items off as they land, and delete them when the stage ships.

## Placeholders in the code

| Where | What's missing | Stage |
|---|---|---|
| `src/core/BeatClock.ts` | Sections come from the audio features (breakdown depth, drop detector). Read the tracks' section markers when the game library has them, and fall back to features for imported music. | 3 |
| `src/core/models.ts` → `Look` | Provisional shape. The character model (slider names = Blender shape keys, slots, materials) is settled in Stage 2, then `LOOKS` goes to version 2 with a migration. | 2 |
| `src/core/models.ts` → `BoardDoc` | Provisional shape. The board file format gets documented, with its component types, in Stage 5. | 5 |
| `scripts/blender/export_glb.py`, `preview.py` | Written against the Blender 4.x API but never run: there's no Blender in the build container. Run both on a test `.blend` once Blender is available. | 1 → 2 |
| `src/name/filter.ts`, `src/name/blocklist.json` | The name filter's matching works and is tested, but **the word list is empty**: nothing is refused yet. Fill `blocklist.json` from a vetted, maintained list (or wire a moderation service). | 2 |

## Blocked: needs a decision from you

- [ ] **Blender access** (Section 14). You've said the Blender connector is connected, but its tools weren't loaded in the session that built Stages 1 and 2A (connectors are read when a session starts). Check it at claude.ai → Customize → Connectors and start a new session. If the connector drives Blender on your own computer, a cloud session may not reach it. Until then, no modelled assets can be made.

## Stage 1 follow-ups (foundation)

- [ ] Move the light show (`show.ts`), crowd envelopes and Auto DJ onto `BeatClock` events. Today they read the same beat grid through the features. The camera director already uses the clock.
- [ ] Latency calibration tool in Settings (Section 15). Output latency is shown, and the visual delay is adjustable, but there's no tap-to-measure.
- [ ] Gamepad support in `InputMapping` (Sections 10.5 and 13.10).
- [ ] Export / import of career saves (the settings export deliberately leaves them out, so "reset settings" can't wipe a career).
- [ ] Run the performance worst case (festival crowd, heavy board, recording + replay buffer) on real hardware (Section 16.5). Only software rendering is available here.

## Stage 2: Identity

- [x] Naming scene: dark room, LED sign letters strike up with a buzz, tagline, capitals, preview strip in 4 styles, confirm moment (flicker, bass hit, pull back over a cheering crowd). Opens on first launch and from Settings → Profile.
- [x] `NameService` with style IDs, auto-fit (1–20 characters, never cut), cached textures, live rename (about 20 ms for every surface), beat reactions (kick, build chase, drop strobe + glitch, breakdown breathing).
- [ ] Name filter word list (see the placeholders table).
- [x] Name on every surface that exists today:
  - booth front panel, in every venue's style
  - neon on the wall (DC-10, the warehouse)
  - LED walls (warehouse, Printworks, Alexandra Palace) on drops, builds and every 32 bars
  - the superfan's crowd sign
  - laptop-lid sticker
  - board stickers
  - top bar
  - crowd chants at the peak
- [ ] Name surfaces that need later systems:
  - laser-written name (Stage 3, lasers)
  - flyers and posters (Stage 6 bookings)
  - results headline (Stage 3)
  - recording watermark and cover art (Stage 4)
  - merch, cocktail menu, wristbands, billboards, drone show, plane banner (Stage 6 venues)
  - record bag, headphone case (Stage 2 wardrobe models)
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
