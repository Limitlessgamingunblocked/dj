# TODO

Every placeholder in the code is marked `TODO:` and listed here (Section 0). Stage backlogs follow. Tick items off as they land, and delete them when the stage ships.

## Placeholders in the code

| Where | What's missing | Stage |
|---|---|---|
| `src/core/BeatClock.ts` | Sections come from the audio features (breakdown depth, drop detector). Read the tracks' section markers when the game library has them, and fall back to features for imported music. | 3 |
| `src/core/models.ts` → `BoardDoc` | Provisional shape. The board file format gets documented, with its component types, in Stage 5. | 5 |
| `scripts/blender/export_glb.py`, `preview.py` | Written against the Blender 4.x API but never run: there's no Blender in the build container. Run both on a test `.blend` once Blender is available. | 1 → 2 |
| `src/name/filter.ts`, `src/name/blocklist.json` | The name filter's matching works and is tested, but **the word list is empty**: nothing is refused yet. Fill `blocklist.json` from a vetted, maintained list (or wire a moderation service). | 2 |
| `src/character/Avatar.ts` | **The character is built in code**, a stand-in for the Blender character, hair and outfits (Section 14.2). Bones are named like a humanoid rig and sliders like the shape keys, so a GLB can replace the meshes. Until then: 66 meshes and about 25k triangles (one skinned mesh would draw far cheaper); some items share their slot's base shape in their own colours (e.g. most headphones, jeans vs track pants); no per-move animation clips (turning knobs, pushing faders, scratching, cueing); a little clipping with big hair under hoods or long hair through jackets. | 2 (art) |
| `src/three/venues/dressingroom.ts` | The dressing room is built in code. The mirror is a dark glossy pane, not a real reflection. | 2 (art) |
| `src/character/look.ts` → `dressCodeBonus` | Computed and shown in the wardrobe, but nothing applies it yet: Stage 3's vibe meter adds it when a set starts. | 3 |

## Blocked: needs a decision from you

- [ ] **Blender access** (Section 14). You've said the Blender connector is connected, but its tools weren't loaded in the sessions that built Stages 1 and 2 (connectors are read when a session starts). Check it at claude.ai → Customize → Connectors and start a new session. If the connector drives Blender on your own computer, a cloud session may not reach it. Until then, no modelled assets can be made.

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
- [x] Character creator in a backstage dressing room:
  - bulb-ringed mirror, clothes rail, flyers and stickers, the club thumping through the wall
  - lighting previews: dressing room, club strobe, daylight terrace, UV blacklight
  - camera: full body, face, turn, auto-turn, zoom
  - tabs: body, face, eyes, skin, hair, makeup and art (tattoos, piercings), outfit (11 slots, 3 colour zones, 9 materials, 8 patterns, 12 sets), moves (personality)
  - tools: randomise all or one tab, undo / redo, reset a tab, autosave, save as a new look
- [x] Wardrobe: saved looks (wear, delete), every item with slot and vibe filters, locks that say how they unlock, the dress code for your venue.
- [x] Your look at the decks in every venue: the booth figure is your character, mixing, grooving in your style, doing your drop move and your between-mix habit. Sweat builds through a set and resets between venues.
- [ ] Dress-code bonus applied at the start of a set (Stage 3, see the placeholders table).
- [ ] Your look in recordings (Stage 4).
- [ ] Base character, rig, hair and outfits in Blender (blocked; see above). The code-built character stands in until then.

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
