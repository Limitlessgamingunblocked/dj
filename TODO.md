# TODO

Every placeholder in the code is marked `TODO:` and listed here (Section 0). Stage backlogs follow. Tick items off as they land, and delete them when the stage ships.

## Placeholders in the code

| Where | What's missing | Stage |
|---|---|---|
| `src/core/BeatClock.ts` | Sections still come from the audio features (breakdown depth, drop detector). The original tracks now carry section markers (`src/game/tracks.ts`) and the vibe meter reads them; the clock should read them too for originals, keeping the features for imported music. | 4 |
| `src/game/tracks.ts` | Imported music has no section markers: its energy is estimated from tempo and loudness. Let players mark sections (or detect them). | 4 |
| `src/three/venues/bedroom.ts`, `basement.ts` | **Both venues are built in code**, stand-ins for the Blender sets (Section 14). The Bedroom's monitor shows the visual player; there's no modelled furniture, and the Basement's crowd is the shared procedural crowd. | 3 (art) |
| `src/game/Gig.ts` → `TIER_FAME` | Fame needed per tier is a placeholder table. Stage 6's ProgressionSystem owns tiers, unlocks and bookings. | 6 |
| `src/media/MediaWriter.ts`, `src/media/mp4.ts` | MP4 with H.264 + AAC is the preferred recording format, but the build container's browser can't encode H.264, so that path is checked by unit tests only (MP4 itself was verified end to end with VP9 + Opus). Record a short H.264 clip in Chrome or Edge and check it plays in a phone's gallery. | 4 (verify) |
| `src/audio/room.ts` | "Record room sound" (the venue's acoustics on the recording) isn't offered: recordings are always the clean master. | 7 |
| `src/media/Studio.ts` | Video recordings keep their encoded audio only (AAC or Opus), not a lossless copy, so they don't export to WAV or MP3. | 7 |
| `src/ui/GigSetup.ts` | You pick venue, slot and length freely. Stage 6's booking offers replace that choice. | 6 |
| `src/three/realism.ts` | **Knobs and fader caps are modelled in code** (knurled bodies, ridged caps), stand-ins for Blender models (Section 14). | 5 (art) |
| `scripts/blender/export_glb.py`, `preview.py` | Written against the Blender 4.x API but never run: there's no Blender in the build container. Run both on a test `.blend` once Blender is available. | 1 → 2 |
| `src/name/filter.ts`, `src/name/blocklist.json` | The name filter's matching works and is tested, but **the word list is empty**: nothing is refused yet. Fill `blocklist.json` from a vetted, maintained list (or wire a moderation service). | 2 |
| `src/character/Avatar.ts` | **The character is built in code**, a stand-in for the Blender character, hair and outfits (Section 14.2). Bones are named like a humanoid rig and sliders like the shape keys, so a GLB can replace the meshes. Until then: 66 meshes and about 25k triangles (one skinned mesh would draw far cheaper); some items share their slot's base shape in their own colours (e.g. most headphones, jeans vs track pants); no per-move animation clips (turning knobs, pushing faders, scratching, cueing); a little clipping with big hair under hoods or long hair through jackets. | 2 (art) |
| `src/three/venues/dressingroom.ts` | The dressing room is built in code. The mirror is a dark glossy pane, not a real reflection. | 2 (art) |

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
  - laser-written name (Stage 6: the Basement and Bedroom have no lasers; the Warehouse Rave gets them)
  - flyers and posters (Stage 6 bookings)
  - [x] results headline (Stage 3)
  - [x] the Bedroom's marker sign and the Basement's red neon (Stage 3)
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
- [x] Dress-code bonus applied at the start of a set (Stage 3).
- [ ] Your look in recordings (Stage 4).
- [ ] Base character, rig, hair and outfits in Blender (blocked; see above). The code-built character stands in until then.

## Stage 3: First playable gig

- [x] Bedroom: desk, LED strip, fairy lights, window (the computer was taken out at your request); the stream chat is its crowd; the raid is its signature moment.
- [x] Basement: black brick, sweating pipes, one red light, a strobe, a mirror ball, about 80 people; the ceiling drips and dust shakes loose at the peak.
- [x] ~~The 8-step tutorial~~ taken out at your request; the Basement unlocks after your first Bedroom set.
- [x] Assist levels (Chill, Club, Pro ×1.5), beatmatch bands (10 / 30 / 50 ms), named transitions, slot targets, the vibe meter and its penalties, the comeback, the encore, the results screen.
- [x] Lighting rules (Section 2.3): kick → washes, hats → string-light flicks, bass → booth underglow, vocals → DJ spotlight, breakdown → warm amber, intensity from the vibe.
- [x] Crowd states cold → euphoric (phones and chatting when cold, jumping in sync when euphoric) and crowd audio (murmur, cheers, groans, boos, "whoa", chants).
- [x] NPC lines: promoter, sound engineer, security, the bar, the door.
- [x] Venue acoustics on the speakers (not on recordings).
- [x] 13 original tracks with section markers, energy 1–10 and tags (45 tracks in all with the earlier demos).
- [ ] More recurring crowd characters (Section 8.2): only the superfan with the name sign exists. → Stage 6
- [ ] VIP crew that grows with fame (Section 8.4). → Stage 6
- [ ] Camera energy scaled by the vibe, and the breakdown orbit and drop punch-in as named shots (Section 2.5). → Stage 4 (with the replay camera)
- [ ] Re-skin or retire the older techno and breaks demos so the library sits in the brief's lanes. → Stage 6 (full library)

## Stage 4: Recording & replay

- [x] REC (top bar, Shift+R, MIDI-mappable) with a pulsing light, timer and optional three-beat count-in landing on a downbeat.
- [x] Audio only: lossless 24-bit / 48 kHz; WAV and MP3 (320 kbps, tagged with title, your name, venue, year and cover) exports.
- [x] Video + audio and booth cam: 720p / 1080p / 1440p / 4K (what the browser can encode), 30 / 60 fps, 16:9 / 9:16 / 1:1, size per minute shown.
- [x] Camera director while recording: auto-cinematic (phrase cuts, drop punch-in, breakdown orbit), locked, live switch.
- [x] Overlays: name watermark (corner and style), venue and date, now playing, live tracklist, VHS timestamp.
- [x] Auto cover art in the venue's flyer style; tracklist text export.
- [x] Replay buffer: 2 / 5 / 10 / 15 / 30 minutes with memory shown, audio-only or audio + video, or off; a quiet dot in the HUD and top bar.
- [x] SAVE THAT MIX (Shift+S) and CLIP IT (Shift+C, last 30 or 60 seconds, vertical), with the confirmation line.
- [x] Smart markers: vibe spikes, drops, named transitions, signature moments, crowd peaks and chants.
- [x] Trim editor: waveform with stills above, markers, bar lines, snapping handles, zoom, preview, fades, export (new set, WAV, MP3).
- [x] Results screen: Save highlights and Replay (the best transition) before the buffer is cleared.
- [x] My Sets: date, venue, length, grade, tracklist and thumbnail; sort, filter, rename, delete, favourite; storage manager with clean-up.
- [ ] Board buttons for REC, SAVE THAT MIX, CLIP IT and the camera switcher. The controls exist for MIDI and keys; the Board Builder that could place them was taken out.
- [ ] Your look in recordings is whatever's on stage; a dedicated "recording look" toggle isn't planned unless you want one.

## Stage 5: Board Builder

- [x] Built, then **taken out** at your request (see DECISIONS 69). It's in git history at commit `b2b0a98`.

## Stage 6: The world

Remaining venues and signature moments, VIP crew and NPCs, progression, bookings, reputation, hub, social feed, B2B rivals, the full track library.

## Stage 7: Polish & release prep

Accessibility (flashing warning, colour-blind modes, high contrast, subtitles, volume buses), performance pass, UI polish, audio pass, clear this file.
