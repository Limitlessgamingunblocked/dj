# Decisions

Choices made where the build brief left room, newest last (Section 0: "for anything else, decide and note the decision"). Choices that are expensive to reverse are asked first and recorded here once answered.

## Stage 1: Audit & foundation (2026-10-08)

1. **Keep the engine: TypeScript + Three.js + Web Audio in the browser.**
   - The audio engine, analysis, light show and crowd are mature and tested (194 tests), and nothing in the brief needs a native engine.
   - The single-file HTML build keeps it shareable as an artifact.
   - Changing engine would be expensive to reverse, so it would be asked first; it isn't needed.
2. **The career is added beside the studio; nothing is removed.**
   - The six real-world venues (DC-10, Boiler Room, Berghain, Printworks, Alexandra Palace × 2) and the existing studio features stay, playable outside the career.
   - The brief's eight venues are new career venues. The Deckhouse Warehouse becomes the base of the career's Warehouse Rave.
   - Deleting a system would need your go-ahead, and none is deleted.
3. **Real artist names are removed from the game** (Section 2.1).
   - The Set Builder's four "in the style of" profiles were named after real DJs. They're now fictional **sound lanes** with the same musical profiles: *Deep & Groovy*, *Rolling Minimal*, *Bouncy Tech House*, *Rave Energy*.
   - Saved Set Builder anchors that used the old names now act as plain text anchors. They match nothing, which is harmless. There's no migration table, because one would put the names back in the code.
   - The real venue names stay, as you asked in earlier rounds. The brief only forbids real artists' names, likenesses, logos and tracks.
4. **One `BeatClock` reads the beat the room hears.**
   - It reads the sync master's beat grid through the AV-sync delay line, so events land with the sound from the speakers, not ahead of it.
   - Sections (breakdown, build, drop) come from the audio features until tracks carry section markers (Stage 3).
   - After a long stall (a hidden tab) the clock catches up at most 8 beats and skips the rest quietly, rather than firing a burst of old events.
   - Listener errors are caught, so one broken system can't stop the others.
5. **Career saves are separate from settings.**
   - They use the prefix `deckhouse-save:`, apart from the settings' `deckhouse:`. "Reset settings" and the settings export/import never touch a career.
   - Each kind of data (profile, progress, looks, boards, crates, recordings, bookings) is its own versioned envelope:
     - migrations step one version at a time
     - validators repair rather than reject
     - the previous good save is kept as a backup and used if the main save is damaged
     - a save from a newer game is read but never overwritten
   - The music library stays in IndexedDB, unchanged.
6. **Redlining is measured at the limiter.**
   - The master limiter (already there) keeps the output from clipping.
   - `engine.redline` (0–1) follows how hard it's working: past 1 dB of limiting, full at 6 dB, with a fast attack and a slow release. Scoring and the meter can penalise gain-staging mistakes even though the mix never distorts.
7. **Debug menu on Ctrl+Shift+D or `?debug`.**
   - Everything goes through the real systems: Career saves, prefs, the light show, a drop injected into the features.
   - "Erase career" asks for confirmation and leaves settings and the music library alone.
8. **Asset pipeline conventions.**
   - One asset = one top-level collection (or object) named `category_item_variant_##`, with `_lod1`–`_lod3` for lower detail.
   - Budgets live in `scripts/blender/budgets.json`, shared by the export script and the report.
   - Colour zones are materials named `zone1`–`zone3` (or ending `_zone1`…). The name surface is a material named `name_surface`.
   - The single-file build inlines `.glb` files. That page has a 16 MB ceiling, so model sizes count; the normal build ships them as files.
   - `ASSETS.md` is generated from export reports, and in-engine testing is recorded in `assets/status.json`.
9. **The `Career` holder (`src/game/Career.ts`)** loads profile and progress at start and autosaves 400 ms after each change, flushing on page hide. The full ProgressionSystem comes in Stage 6.

## Stage 2A: Name yourself (2026-10-09)

Started before the character work, because Blender's tools weren't reachable in this session (see TODO.md).

10. **`NameService` is a module singleton** (`src/name/NameService.ts`).
    - Venues, fixtures and the board are built in many places, and all of them need the name. One shared service is simpler than threading it through every constructor.
    - Surfaces ask for a style plus a size in metres. Identical requests share one cached canvas texture (reference counted, freed when the last material is disposed).
    - Textures redraw only when the name changes or web fonts arrive; the beat reactions are shader uniforms shared by every glowing surface.
11. **The name auto-fit** prefers one line, and uses two lines only when the text gets at least 25 % bigger that way. A name with no spaces never wraps; it shrinks instead. Letters are never cut. Tested at 1 and 20 characters on three surface shapes.
12. **Glowing vs printed styles.**
    - LED, neon, chrome and white light are glowing styles: drawn on transparent black, blended additively, and pulsing with the music.
    - Marker, hand-painted and sticker are printed styles: opaque and lit like any surface. They don't pulse; paper doesn't.
13. **LED-wall overlays** show the name for the drop's first 8 bars, through builds, and for a phrase every 32 bars. They're kept dim enough (gain 1.25, a softer strobe) not to white out a drop.
14. **Until the player is named**, surfaces show "DECKHOUSE". The superfan's crowd sign keeps its old text until then.
15. **The naming scene opens by itself on first launch** until the player is named or picks "Later". Automated test browsers (`navigator.webdriver`) skip it; `?naming` forces it.
    - It borrows the 3D stage: a hidden "naming room" venue.
    - It goes back to your venue and camera afterwards.
    - It holds the auto director while it's open.
    - The sign is kept under the lens-ghost threshold, so it doesn't throw mirrored copies over the frame.
16. **The name filter ships without a word list.** I won't author a list of slurs or profanity myself. `src/name/blocklist.json` takes one from a vetted, maintained source. The matching (spacing, letter swaps, accents, whole-word-only entries) is built and tested with placeholder words.
17. **Display fonts added** (Google Fonts, like the existing ones): Pacifico for neon script, and Permanent Marker for marker and hand-painted.


## Stage 2B: Your character (2026-10-09)

Blender still wasn't reachable, so the character is built in code, made to be swapped for modelled assets later.

18. **The character is procedural, shaped like the asset it stands in for.**
    - Bones carry humanoid-rig names (`hips`, `spine`, `chest`, `neck`, `head`, `upper_arm_l`…).
    - Every slider id is the shape-key name it will drive (`jaw_width`, `nose_bridge`…).
    - Outfit slots, 3 colour zones, materials and patterns are data in `src/character/catalog.ts`, which the Blender pipeline's `zone1`–`zone3` materials already match.
    - A GLB can replace the meshes without touching the creator, the saves or the moves.
    - The default figure is about 25k triangles, inside the 25–35k player budget.
19. **Looks are save format v2** (options, tattoos, piercings), migrated from v1. No saved looks existed before this stage, so the change risked nothing.
20. **Every creator change saves at once into the look you're wearing** (Section 16.4). "Save as new look" copies it into the wardrobe; looks are unlimited. Sliders preview live while dragged and enter the undo history when released.
21. **The dressing room borrows the stage**, like the naming room: a hidden venue.
    - The stage stands your avatar there (`stage.avatarSpot`) and hides the booth.
    - It plays the set next door through the wall (a muffled kick and bassline).
    - If your decks are already playing, it grooves to them instead and stays quiet.
22. **Lighting previews light the room for real.** Venues can now turn down the stage's own soft light (`VenueScene.ambient`), so the blacklight and club previews go properly dark. The club strobe preview flashes on the beat (about 2 a second at 124 BPM), or with reduced flashing a soft pulse every other beat (about 1 a second). Both stay under 3 a second.
23. **Locked items show how they unlock** ("Play the Warehouse", "Milestone: acid"). Sandbox and the debug menu own everything. Fame tier 1 opens the Bedroom and the Basement, so Selector and Tracksuit Royalty are available from the start.
24. **The booth figure is now your character** in every venue. It's visible in the venue, crowd, drone and live-feed shots as before, faces the room, keeps its hands on the decks, grooves in your style and does your drop move on drops. Sweat resets when the venue changes.
25. **First launch goes name → dressing room.** Later visits: Settings → Profile → Dressing room. `?dressing` opens it directly.
26. **Nothing real on the clothes.** Trainer stripes are plain lines with no maker's marks. Prints and flyers are made-up nights ("Late Licence", "Basement 004").

## Stage 3: First playable gig (2026-10-09)

27. **The vibe meter replaces the old crowd "hype" meter.**
    - `src/game/vibe.ts` is pure (no audio, no DOM) and is fed a snapshot of both decks each frame (`src/game/snapshot.ts`), so it's tested without a browser.
    - `app/Hype.ts` is removed; free play (no gig running) still drives the lights and crowd from the same meter, against the peak-time target, with nothing saved.
    - The Top bar's "Hype" label now reads "Vibe".
28. **Beatmatch bands** are measured as the phase error between the two playing decks' beat grids: Perfect under 10 ms, Good under 30 ms, Loose up to 50 ms, Trainwreck past 50 ms (or a tempo mismatch over 0.6 %).
29. **A transition is named when it ends**, from what the mixer did while both decks were up: bass swap, filter fade, echo out, loop roll, quick cut, double drop, long blend, or a plain clean mix. Points scale with the beatmatch band and key compatibility.
30. **The grade** is mostly the set's average vibe, plus a little for score per minute: `average × 0.85 + min(0.15, points per minute / 1200)`. S from 0.82, A 0.70, B 0.56, C 0.42. A set that sits in the right place for its slot gets an A without any tricks; S needs both.
31. **Assists:**
    - **Chill** syncs tempo and key for you, and the tutorial card tips you before the outro.
    - **Club** (default) lets you press sync, and compatible keys glow in the crate.
    - **Pro** refuses sync (the button says so), hides key hints in the crate, and multiplies the score by 1.5 for the time spent in it.
32. **The default venue is now the Bedroom.** First launch shows the Bedroom at the webcam. The real-world venues and the Warehouse stay in the venue picker for free play.
33. **The Basement unlocks after the tutorial** (or in sandbox). Rewards per venue are a small table in `Gig.ts`; the Bedroom pays mostly in followers. Fame tiers are a placeholder table until Stage 6.
34. **The encore** happens when the vibe is at 75 % or more as the time runs out. It ends a minute after your next track is heard (or after 4 minutes) and multiplies the rewards by 1.25.
35. **The dress-code bonus** is added to the vibe when the set starts, and the door says so.
36. **Room acoustics are on the speakers only.** Each venue has a reverb and EQ profile (`src/audio/room.ts`) between the master and your speakers. The recorder taps the master before it, so recordings stay clean. Stage 4 can add "record room sound".
37. **The crowd you hear is synthesised** (`src/audio/crowd.ts`): shaped noise and a few oscillators for the murmur, cheers, whistles, groans, boos, "whoa" and chants. No samples, so nothing to license and nothing for the single-file build to carry. It plays into the room, not the mix. The Bedroom has none (its crowd is the chat).
38. **The new tracks are synthesised like the old demos**, in `audio/synth.ts`, with fixed seeds so they sound the same every time. Their section markers come from the arrangement plan they're rendered with (`game/tracks.ts`). The older demos stay in the library; they get markers from the same plan, and energy and tags from their style and tempo.
39. **The Bedroom and Basement are built in code** like every venue so far, stand-ins for the Blender sets (see TODO.md).
40. **Lighting rules (Section 2.3)** live in the shared light show, so every venue gets them: hats flick the string lights (off with reduced flashing), bass lights the booth from below, vocals bring up a spotlight on the DJ, breakdowns warm toward amber, and overall intensity follows the vibe (about 60 % in a cold room, full at the peak).
41. **The stream chat's handles and the raiding channel are made up.** Viewers climb from 3 to about 50 with the vibe; a raid (vibe over 85 % for 15 seconds) brings 220–400 more, once per set.

## Stage 4: Recording & replay (2026-10-09)

42. **Recordings are lossless at the source.** An AudioWorklet taps the clean master (before the room's acoustics) and hands 4096-frame blocks to the main thread, which keeps them as 24-bit stereo. The audio engine now runs at 48 kHz, so WAV exports are native 24-bit / 48 kHz with no resampling. A stretch saved from the replay buffer is bit-identical to the same stretch recorded by hand (tested).
43. **MP3 export uses one new dependency: `@breezystack/lamejs`** (a JavaScript port of LAME, LGPL-3.0, about 170 KB minified). Browsers can't encode MP3 themselves, and writing an MP3 encoder from scratch isn't sensible. It runs in its own worker, apart from the app's code, and only when you export an MP3. **Say if you'd rather not have it:** removing it removes MP3 export and nothing else.
44. **Video goes through WebCodecs into our own muxers** (`src/media/webm.ts`, `src/media/mp4.ts`), with no library. That gives control of resolution, frame rate and bitrate, and the file is ready the moment you stop.
    - Order of preference: MP4 with H.264 + AAC (plays anywhere), then WebM with VP9 (or VP8) + Opus, then the browser's MediaRecorder where WebCodecs is missing.
    - The test browser here can't encode H.264, so MP4 was verified end to end with VP9 + Opus inside it (it plays and seeks). The H.264 + AAC sample entries are checked by unit tests only.
    - If the encoder falls behind, frames are dropped rather than queued, so a slow machine records a lower frame rate instead of stalling the game.
45. **A recording shows the stage, not the screen.** The 3D view is cropped to the aspect (16:9, 9:16, 1:1) and composited with the overlays; menus and the HUD never appear. For resolutions above the window's, the stage renders sharper while recording (up to 3×), so 4K from a small window costs GPU time.
46. **Video recordings keep their encoded audio** (AAC 256 kbps or Opus 192 kbps), not a lossless copy, to save space. Audio-only recordings and everything saved from the replay buffer keep the lossless PCM, so they export to WAV and MP3.
47. **The replay buffer's length depends on the device.** The brief's 10 minutes is the default on desktops; machines with 4 GB or less get 5 minutes, and phones get 2.
    - Audio memory is fixed once full: 10-second segments are reused, about 165 MB for 10 minutes.
    - Video (720p, 30 fps, 2 Mbps, about 150 MB for 10 minutes) starts on only with 8 GB+ and 8+ cores. Everything is changeable in the recording settings, with the memory shown for each length.
48. **SAVE THAT MIX is instant**: the buffer is copied at once, and the file is put together afterwards.
    - **CLIP IT** re-encodes the last 30 or 60 seconds as a 9:16, 720 × 1280 clip with your overlays, centre-cropped from the buffer's 720p video.
    - With video off, clips are made from the set's stills, blurred behind your name with a waveform that moves with the music.
49. **Smart markers**:
    - drops (from the beat clock)
    - named transitions and comebacks
    - vibe spikes (up 12 points within 6 seconds)
    - "hands up" (vibe over 92 %)
    - name chants
    - the venue's signature moment (vibe over 86 % for 10 seconds)
    - the encore
    Tapping one in the trim editor picks 8 bars before a drop or transition (4 before anything else) and 12 after (8 after a transition), at least 15 seconds in all.
50. **My Sets lives in IndexedDB** in a database of its own (`deckhouse-media`), separate from the music library. The list (titles, tracklists, markers, bar lines) is a career save, `recordings` v2. Nothing had ever written a v1 recordings save, so changing the format risked nothing; v1 still migrates.
51. **The drop punch-in and breakdown orbit** (Section 2.5) work whenever the auto director is on, recording or not.
    - The punch-in is a snap zoom of about 22 % that eases out over about 3 seconds, with a jolt when camera shake is on.
    - The orbit is a slow drift round the booth through breakdowns.
    - Both stop when reduced motion is on.
    - While recording: "auto-cinematic" turns the auto director on; "locked" and "live switch" turn it off; booth cam locks the booth view. The director goes back to how it was afterwards.
52. **The results screen offers the buffer before it's cleared**: "Save highlights" keeps it, and "Replay" saves it and opens the trim editor at the best transition. Closing the screen clears the buffer.
53. **Trim-editor previews play straight to the speakers**, not through the mixer, so they're never recorded or kept in the buffer.
54. **The old MediaRecorder recorder (`audio/Recorder.ts`) is replaced** by the studio. It recorded compressed WebM audio only, and everything it did is covered by the new one.
55. **The trim editor saves an audio clip instantly** (the lossless audio of the selection) and makes a video clip only when asked ("Save video clip": your aspect, size and overlays, from the set's video, or from its stills when it has none). Rendering video in software can take minutes on a slow machine, so the quick path doesn't wait for it.
56. **Every file the game saves goes through one helper** (`src/core/download.ts`). In a normal tab it's a plain download. Inside the claude.ai artifact viewer, which blocks plain downloads, it uses the viewer's save prompt. That prompt takes video, pictures, text and JSON but not WAV or MP3, so audio exports there explain that the downloaded copy of the game can export them.

## Stage 5: Board Builder (2026-10-09)

57. **Your boards live in IndexedDB, not in the career save.**
    - The files and their pictures are under `board:<id>` and `board-thumb:<id>` in the media store.
    - The career save keeps only the list (`boards` v2: names, ratings, plays, favourites, the board in use) plus a compact copy of the board in use, so the game starts on it without waiting for IndexedDB.
    - Boards a v1 save held inline move to a `pending` list and are written to IndexedDB the first time the library opens.
58. **The board format is a documented, versioned JSON file** ([docs/board-format.md](docs/board-format.md)), checked every time it loads.
    - Unknown part types are skipped, numbers are clamped, and only plain data is kept, so a board from a newer game or a hand-edited file can't break the game.
    - Share codes carry the same JSON, deflated, after `DH1.`.
    - There's no server: you share a code or a file. "Board of the Week" is picked on your device from the showcase boards by ISO week, so everyone sees the same one that week. An online gallery needs the Stage 6 social backend.
59. **You build at real size, on a workbench in the game's own 3D scene.**
    - The builder opens a workshop (a hidden venue: bench, cutting mat, pegboard, lamp, parts bins), and the board sits where a booth top would be, in metres.
    - The same stage that plays gigs draws it, so "Try it" plays the board right there with every part live, with nothing to convert. "Try it" can also send it to any venue.
60. **Editing is simple first, precise when you ask** (rebuilt after your "it's very confusing" feedback):
    - **Direct editing:** drag a part across the bench, with grid snap and guides that line it up with its neighbours and the centre line. R / [ / ] turn it, and a floating bar by the selection holds Turn, Copy, Mirror, Group and Delete.
    - **Precise tools:** the move/rotate/scale gizmo appears only with "Precise tools" in the More menu.
    - **Parts list:** shows twelve essentials, with the rest folded by category and locked parts in a fold of their own.
    - **More menu:** holds the advanced features (wiring, booth, mirror mode, box select, share).
    - **Phones:** the panels become bottom sheets, one at a time.
    - **First time:** a short coach card shows once.
61. **The life-size pro units are the preset rigs' own builders** (`src/board/units.ts` calls `player`, `clubMixer`, `turntable` and `rotaryMixer` from `src/three/boards.ts`). One code path makes a preset board and a custom one, so a custom media player is as detailed as the preset's and every control works. Proportions follow published specs; the realism notes and sources are in the Stage 5 report and in `src/board/units.ts`.
62. **Parts are modelled on the real hardware in code**, as stand-ins for Blender models (`TODO:` in `src/three/realism.ts`, `src/board/parts.ts` and `src/board/gear.ts`):
    - **Knobs:** knurled, with printed scales.
    - **Fader caps:** about 22 × 12 mm with grip ridges, in slots with printed scales.
    - **Meters:** 15-segment, with dB legends and ghost-lit off segments.
    - **Transport buttons:** rubber, in chrome bezels with LED rings.
    - **Jogs:** knurled rims, with a light-pipe ring and an on-jog display.
    - **Panels:** screwed down.
    - **Booth gear** (headphones, laptop, USB stick, booth mic, monitor, setlist, gaffer tape, water bottle, record crate) is decoration only. It shows no brands, and the sleeve art and track names are made up.
63. **The wild add-ons keep the safety rules:**
    - **Laser aim** can only raise the beams, never lower them below the rig's height above the crowd.
    - **Strobe and blinder** go through the show, so "reduce flashing" still caps them under 3 Hz.
    - **Pyro** fires only if pyro is on in the lights settings.
    - **Weather** works only at outdoor venues.
    - **The drop button** blacks out and silences the master bus for two beats, then fires the drop.
64. **A board's own MIDI mappings are applied after the global ones** in Settings, so the controller you've set up keeps working, and only messages nothing else uses reach the board. MIDI learn listens to every incoming message.
65. **Macros become button controls** (`board.macro.<id>`), so a part, a trigger, a wiring cable or a MIDI key can play one. Triggers run on the beat clock's events (drop, bar, phrase, build, breakdown, peak) and the vibe meter.
66. **A performance guard instead of a hard limit:**
    - Every part has a cost, shown on the meter as "runs smoothly", "getting busy" or "heavy", with friendly suggestions.
    - Decorations simplify with distance.
    - The file checker's limits (20,000 parts) are only there to stop broken files.
67. **The camera stays inside the workshop.**
    - Small venues can give the camera a room to stay in (`cameraRoom`), and framing a wide board comes in lower and further back instead of rising through the ceiling.
    - While you build, the lens ghosts and heavy bloom are off: mirrored copies of the part you're placing were confusing. The full look comes back when you press "Try it".
68. **Career unlocks:** some parts unlock with fame (the old-style turntable, tape stop lever, and others as listed in the board format doc). Sandbox opens everything. Templates and the "life size" booths are available from the start.
69. **The Board Builder is taken out** (your call, after trying it). Gone: the builder and its workshop, "My boards" and "Build your own" in the board picker, and the menu entry. Kept:
    - the knurled knobs and ridged fader caps on the regular boards (`src/three/realism.ts`)
    - the career save's `boards` section, at v2, so saves made while the builder existed still load (nothing reads it)
    The whole builder is in git history at commit `b2b0a98` (decisions 57–68 describe it).

## All-in-One Two (2026-10-09)

70. **A board modelled on the flagship two-channel all-in-one in your photo**, unbranded like every board here. Size and layout follow the real unit: 728 × 470 mm, identical (not mirrored) decks with 16 cm jogs, and a 10.1-inch 16:10 screen standing about 65° up behind the mixer, with the browse controls beside it. Specs: [AVL Gear](https://avlgear.com/collections/pioneer-dj/products/pioneer-dj-xdj-rx3-2-channel-performance-all-in-one-dj-system), [djcenter.ee](https://djcenter.ee/e-pood/meediam2ngijad/pioneer-xdj-rx3-detail).
71. **The touch screen browses the same list as the Library panel**: the same source, sort and selection. Turning the encoder, tapping a track or pressing ↑↓ in the panel all move one selection, and LOAD loads it wherever it was picked. Tapping a track again loads it to the deck you last touched, or else to the deck that isn't playing.
72. **Every control on it does something real, or says it can't.**
    - **Mapped onto what the game has:**
      - CUE/LOOP CALL, MEMORY and DELETE work on the hot cues; the game has no separate memory cues.
      - The pad modes are the game's (hot cue, roll, slicer, beat jump; shift: pitch, sampler).
      - The sound colour FX are FILTER and CRUSH, the two the mixer channels can do.
    - **Turn but do nothing:** the mic, aux and booth-monitor knobs, because a browser game has no mic input, aux input or second output. Their labels say so.
