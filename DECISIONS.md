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

## Your changes after Stage 5 (2026-10-09)

73. **The tutorial is gone** (you didn't like it). The first Bedroom gig is a normal set, and the Basement opens after your first set in the Bedroom, replacing decision 33's "after the tutorial". Chill assist still tips you before an outro, in the HUD.
74. **The Bedroom has no computer**: the monitor, its webcam and the laptop are off the desk. The stream camera view is still there, as "Stream cam".


## Polish pass (2026-10-10)

You asked for the app to feel less confusing and more finished.

75. **Short copy everywhere.** Help, notes and descriptions are one line where they can be, in plain words. The long paragraphs are gone: help, the venue and board pickers, the Show tab, Settings, Set Builder and the recording studio.
76. **No emoji in the interface.** Emoji draw differently on every system. Home uses a small set of line icons (`src/ui/icons.ts`), locks are a CSS padlock, and badges are text. Fans' posts and stream chat keep their emoji, because that's how people post.
77. **A quieter top bar.** Board and venue are pickers with a small caption and no pin emoji. The vibe meter only shows during a gig, since it is the gig's score. The master tempo only shows when a deck is master. The replay buffer shows as a thin ring on the REC dot, not a loose green dot. The duplicate "Switch to Pro layout" menu item is gone; Simple / Pro stays in the bar.
78. **Menus carry check marks and shortcut hints** instead of "● " and "✓ " typed into labels. Escape closes them, the arrow keys move through them, and opening a dialog closes any open menu (the ⋯ menu used to stay on top of dialogs).
79. **A clean lens on the board.** On the board angles (top, performance, booth) and when zoomed in, the lens pass adds no ghosts or stars, and streaks and dirt are cut to 15%. A lamp's ghost smeared over the decks read as a bug. The room and moving angles keep the full effect.
80. **The Bedroom desk is dark walnut, with a softer lamp.** The white desk under the lamp blew out the frame around the board.
81. **Home takes the whole screen.** While it's open, the decks, waveforms and library hide. Its stations are a single column, so none is cut off.
82. **The library drops the kbps and format columns**, which don't help you pick a track. The deck numbers on each row stay faint until you're on the row. "Demo tracks" is now "Originals".
83. **The in-gig HUD keeps Save mix, Clip and End set in view.** The assist level and the clean view move into its ⋯ menu.

## Your music, playlists and gameplay (2026-10-10)

84. **The game ships no music.** The generated starter tracks are gone, as you asked: they're removed from existing libraries, along with the crates made for them ("Demo Set", "First Gigs", and an empty "Warm Up" and "Sets" folder). The track generator survives only as a test fixture (`tests/fixtures/synth.ts`), because synthetic tracks with a known arrangement are good ground truth for the analysis and section tests. The sampler's one-shot sounds are still generated.
85. **No Spotify or SoundCloud connection.** Spotify's Developer Policy lists DJ apps and mixing as a disallowed use: "Using Spotify's catalog to segue, mix, re-mix, or overlap any Spotify Content with any other audio content (including other Spotify content)" (quoted in [this Spotify developer forum thread](https://community.spotify.com/t5/Spotify-for-Developers/Question-regarding-no-mixing-policy/td-p/5282821)). SoundCloud's [API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use) forbid modifying users' content without consent, and its [API usage policies](https://help.soundcloud.com/hc/en-us/articles/115003446727-API-usage-policies) list mixing music within games and downloading or storing content as uses that aren't allowed. Both also stream protected audio that a browser can't run through a mixer. Instead, playlists come in as track lists and match your own files.
86. **Playlists become crates** under a Playlists folder. Entries match by file name first, then by normalised title plus an artist overlap (so "Song - Original Mix" by "A" finds "Song (Original Mix)" by "A & B"). Unmatched entries are kept on the crate (`wanted`) and fill in when matching files are imported. The parser is pure, with a small XML tokenizer, so every format is unit-tested in Node.
87. **Sections for your own music** are found from the analysis waveform's low band, bar by bar on the beat grid in 8-bar phrases: weak runs between strong ones are breakdowns, and the strong phrase after one is a drop. It needs nothing new from the analysis, so tracks already imported get markers straight away. On synthetic tracks it finds the breakdown and drop on the exact bar.
88. **Streaks, crowd requests and the coach** sit on top of the vibe meter without changing it. The gig adds the bonuses to the meter's points, so they count towards the grade like the encore bonus already did.
89. **New players start on the All-in-One Two** with 3-band (blue, orange, white) waveforms. Club Standard is a four-deck rig, which put decks 3 and 4 in front of beginners. Saved boards and colours aren't changed.

## More visuals (2026-10-10)

You asked for more, and more unique, visual modes.

90. **28 modes, each tagged calm, groove or peak.** The tag drives the mode picker's groups and the auto VJ. The 18 new modes share one shader kit (`src/visualizer/kit.ts`): common uniforms, noise, a palette that is never negative, and a strobe gate.
91. **Reduce flashing reaches the visual player.** One `gate()` helper in the kit decides every strobe in every mode. With flashing reduced it drops to once a beat (every other beat above 165 BPM, so always under 3 a second) at about a third of the brightness. The drop flash in the output pass is softer too.
92. **Feedback modes keep their two frame buffers at screen size only while they play.** When a mode leaves the screen, its buffers shrink to 16 × 9, so 28 modes don't hold 28 sets of full-screen textures.
93. **Changes over a beat, not a cut.** The outgoing mode keeps rendering into its own target while a pass blends it out over one beat: a fade, an iris, slices, a zoom or pixels. Saved settings load with a cut.
94. **The auto VJ is a pure class (`director.ts`), unit-tested.** It changes on a bar line every 8 bars. A breakdown under a loud mode gets a calm mode at the next bar, after at least 4 bars. A drop cuts to a peak mode on the hit, unless a peak mode started under 4 bars ago. It doesn't pick any of the last four modes.
95. **Shaders compile in the background**, one mode every 30 frames, against an offscreen target so the compiled programs match the ones used at draw time. The first switch to a mode, often on a drop, no longer stalls.

96. **No one stands behind you in the Basement Club** (you asked). The booth there is tiny and on the crowd's level, and the one friend who stood behind the DJ crowded the shot. Your crew still turns up from the Rooftop on, where the stage has room.

## Party: hype dancers and HELL YEAH (2026-10-10)

You asked for dancers next to you while you DJ, and for funny "hell yeah" moments.

97. **The dancers are built on your own avatar**, in a new 'hype' mode, not on the crowd's instanced figures. Up close next to you they need faces, hair that swings and real outfits. Their looks are glam go-go styles picked by seed, so each venue has its own pair. They wear clothes anyone can now wear too: a crop top, a sequin halter top, mini and sequin skirts, and go-go boots. They're styled for a club, nothing more revealing than that.
98. **They stand on podiums out past the booth's monitors** (2.35 m either side by default, closer in the small rooms). At first they stood where the monitors hid them. They stay home from the Bedroom, the menus and the naming scene.
99. **HELL YEAH waits at least 4 s between any two, and 45 s between automatic ones**, so it stays an event (game/hellyeah.ts, unit-tested). The pad always works. The air horn has no limit, because spamming it is the joke.
100. **The HELL YEAH camera cut only happens from a board angle** (top, angled or booth), and only if you're not zoomed into the board. It goes back after two bars unless you've picked another angle meanwhile. That's how you see the dancers and the crowd go off while you're mixing.
101. **The horn plays into the mix like a sampler pad**, so it's in your recordings. It's rendered apart from the 8 slots, so it works whatever you've loaded into them. The crowd's cheer stays in the room, not the mix, as before.
102. **The crowd surfer keeps clear of the crowd camera.** They ride on the side of the room away from it, and don't appear in rooms too narrow to pass at 2 m. In the first test they flew straight through the lens.
103. **HELL YEAH is gone** (you asked). With it went the stamp, the LED-wall shout and the camera cut to the room. So did the beach balls, the flamingo, the crowd surfer, the dancers' sparklers, the HELL YEAH signs and its automatic triggers, since nothing else used them. Decisions 99–102 no longer apply. The dancers, the air horn pad, the funny signs and the new clothes stay.

## Genres (2026-10-10)

You asked for the analyser to say house, hip hop, trap and so on, and to sort by it in the library.

104. **Genre is a guess from rules over rhythm and tone, not a trained model.** There's no labelled music to train on here, and a model big enough to be good would be tens of megabytes in a single-file app. The analyser measures the drum pattern on the beat grid (four on the floor, backbeat, half-time, dembow, 2-step, hats, rolls, swing), the tonal balance and the pulse. Each genre is a set of soft rules over those. It is tested on synthetic beats in ten styles and on the 58 generated club tracks. On real music it will get the family right more often than the exact sub-style. That's why a low-confidence pick between close sub-styles is shown as the family, and why the file's tag wins over the guess.
105. **Your genre wins, then the tag, then the guess.** Tags are tidied to one spelling per genre so they sort together. Anything we don't know is kept as written.
106. **Old tracks get their genre without being re-analysed.** Bumping the analysis version would redo every track and throw away manual beat-grid edits, which live in the analysis. Instead, tracks analysed before genres existed get a genre-only pass in the background, using their current grid.

## Pioneer DDJ-REV5 (2026-10-10)

You asked for your DDJ-REV5 to plug in and work with the game, then sent AlphaTheta's *DDJ-REV5 List of MIDI Messages* (E1).

107. **The REV5's mapping is built in, from the message list, and loads by itself** the first time the board is plugged in (a mapping you made yourself is never replaced). This reverses the earlier "no brand-specific presets" line for this one board: it names the model in text only, with no logo. Each control maps to the game feature it names; where the game has nothing matching, to the nearest it has: SAVED LOOP → Beat Jump, SCRATCH BANK → Slicer. That's said in the README and the code.
108. **Pads are one block per deck that covers every pad mode.** The board sends each pad mode on its own run of eight notes. The block maps any note to pad (note mod 8) and switches the deck's pad mode to match the run, so the game and the board can't disagree about the mode. An exact mapping beats the block on the same note: the deck pads' hot cues, sampler and stem mutes.
109. **DECK 1/3 and 2/4 drive the game's deck layers from the board's own "deck on" message, and only from its "on".** Switching back to deck 1 the board sends "deck 1 on" and then "deck 3 off", so following every message would land on the wrong deck. Any message from deck 3/4 also moves the layer, so the game catches up even if it missed the switch. The board's lights follow the layer to that deck's channel.
110. **Jog ticks per turn default to 720** because the list doesn't say; *Calibrate jog wheels* measures them in one spin each. Jog sensitivity in Settings still scales them.
111. **The touch-by-touch setup stays, for every other board.** It also reads the tempo fader's direction, 14-bit pairs, jog ticks and decks 3/4 from what it hears.
112. **The output device is the AudioContext's own (setSinkId), not a second audio element**, so the whole mix, recordings aside, goes to the board with no extra latency. With four outputs, master goes to 1/2 and the headphone cue to 3/4 (a discrete four-channel destination), which is where controller sound cards wire their headphone jack. Device names need microphone permission in browsers, so that's asked for only when you click Show names, and the microphone is let go straight away.

## Visuals that follow each song (2026-10-10)

You asked for the visuals to fit any song, to be different for every song, and to follow the drums, the melody and the vocals.

113. **The drums, melody and vocals are pulled apart from the live mix on the analyser's spectrum, not taken from the decks' stem separator.** That separator only runs while a stem knob is turned, per deck, on the audio thread. Running it all the time for the visuals would cost every deck an STFT. Instead `parts.ts` does the same split on the master analyser's spectrum (96 bands, 40 Hz–12 kHz): a time median against a frequency median for harmonic against percussive, then bass below ~180 Hz, then the vocal as harmonic energy in the voice range that's centred in the stereo picture, read from a new side-channel analyser (L − R). It sees what you hear, stem knobs included. A centred synth lead would look like a voice by that test alone, so the vocal also has to waver: a voice's pitch drifts and shakes by tens of cents all the time, while a synth sits still. A steady centred sound counts as melody. The shares of melody and vocal are measured with the spectrum tilted up about 3 dB an octave, or the bass, by far the loudest part of most mixes, made every melody look small.
114. **Each song's look is a pure function of the track** (`songLook.ts`): the key (round the circle of fifths), the genre family and a hash of the track. The same song always looks the same. Colours flow into every mode by blending the shared palette towards the song's three colours (85%), so all 28 modes change with the song without touching each one.
115. **The music layers are one post pass over every mode**, not something each mode does. Every mode gets drums, melody and vocals consistently, and the song's look picks one style of each. The light is added where the picture has room for it, and held back over bright areas. With reduce flashing on, hits are softer and the sparkles calmer. Nothing in the layers strobes.
116. **The auto VJ is now on by default and plays the song's own eight modes**, always with calm, groove and peak ones so it can still follow breakdowns and drops. On a new song it fades over four beats to that song's opening mode on the next bar. Settings saved before this change get the auto VJ switched on once, because the visuals following the song was the point of the request. You can turn it off in Show → Visuals.


## Venue detail (2026-10-10)

You asked for every venue to be more detailed, going all out.

117. **The detail is one set-dressing kit (`dress.ts`) that each venue calls, not loose meshes.** About a hundred kinds of piece (ducts, trays, fire doors, flyer walls, neon, road cases, amp racks, barriers, FOH desks, stairs, ladders, festoons, trees, tents, food trucks, cabins, generators, lorries, fences, litter, floor wear and more) are built in code and merged when the venue is built. Plain colours share four materials (metal, matte, cloth and flat-shaded), with each piece's colour carried per vertex, so a venue's dressing is a handful of meshes plus its lamps, a few flyer and sign materials and the decals. The litter is instanced. Measured per frame on each venue's main angle, draw calls went up by 0 to 80 (the festival went from 840 to 922, Berghain from 664 to 657, Printworks from 272 to 318) and triangles by about 2–15%. Sunrise and Alexandra Palace rose more because their main angles now frame the whole room (decision 122). Nothing new casts shadows or adds a real light. The lamps are emissive and the show drives them.
118. **Glow lights of one kind share one material.** Lamps that pulse on their own time (blinking LEDs, breathing bulbs, flickering neon, flames) are split into four phase groups, so they don't all pulse together and the draw calls stay bounded. Neon holds steady with Reduce flashing on.
119. **Dressing goes where the cameras look**: above head height, round the edges of the room, on stages and in the background of each venue's angles. The middle of each floor stays crowd. Where a piece blocked an angle, the piece moved, not the camera: the basement duct was cut back from the security camera and the bedroom lantern was moved out of the stream shot.
120. **The real venues' dressing fits the building type but isn't documented.** For example: Berghain's crane girder, valves and control cabinets; Printworks' stairs, ladders and roof ducts; Boiler Room's gazebo, truck and parked cars; Alexandra Palace's radiators and far-end windows. All of it was invented to suit the building, not traced from photos. Signs are generic words (BAR, TOILETS, FOOD, WATER, CAMP, MERCH, FOH, WC, HALL 1) and flyers are made-up nights. There are no logos, brands or promoters.
121. **The festival's placeholder boxes are now built pieces.** The mix tent is an open black scaffold tent with both desks, racks and a camera riser. The barrier is a steel crowd barrier, its footplate on the crowd's side, with trackway in the pit.
122. **A venue's far camera angles now reach their spot.** You can only zoom out 45 m from what the camera looks at, and the orbit controls were pulling in every preset shot set further out than that. Sunrise's "Up the hill" (87 m from its aim point) ended up on the stage. Alexandra Palace's "From the stage" (60 m) and "From the organ gallery" (53 m) were pulled forward over the crowd, and the festival's field shot moved in a few metres. Going to an angle now lifts the limit to fit that shot, and the limit drops back to 45 m once the camera arrives somewhere closer.

## Board screens (2026-10-11)

You asked for better, brighter, larger screens on the boards.

123. **Screens are lit above paper white (×1.4) and sit behind glass.** The frame is tone-mapped at the end, so a screen drawn at plain white read as grey in a dark booth. At 1.4× it reads as a backlit display while staying under the lens's flare threshold (1.6), so screens don't throw streaks or ghosts. The glass is a black, additive, slightly rough layer: it only adds a soft glint of the room, and never a hard hotspot over the waveform.
124. **Larger where each board's layout has room.**
    - The media players' screens grow from 9.7 to 11 inches, as wide as the gap between the browse and deck buttons allows.
    - The Pro Four's centre strip (0.2 × 0.06 m) becomes a raised 9-inch 16:9 display on a housing behind the mixer, with a new layout: both decks stacked, each with title, BPM, tempo, key, time, a wide waveform and an overview.
    - The All-in-One's screen grows from 10.1 to 11.6 inches.
    - The jog displays stay the size of the jog.
125. **Sharper, but with the upload cost in mind.** The resolutions are 1024×576 on players, 1280×720 on the Pro Four, 512² on jogs and 1.25× on the All-in-One (its layout stays in its 1024×640 units). The four-player Festival Quad redraws each screen every third frame instead of every second, so it uploads about as much per second as before.
126. **The boards with no screen get a laptop on a stand behind them**, running the DJ software (Starter Two, Vinyl Battle and Rotary House). That's how those setups are played in real life, and the laptop shows both decks, their waveforms and your library. The booth's own laptop at the side stays.
127. **The jog displays now read upright from the DJ's side.** Their texture lay a quarter turn round, so the BPM read sideways. The drawing is turned back, and the position marker still tracks the platter.

## Venue detail, second pass (2026-10-11)

You asked again for more detailed venues, going all out.

128. **The open-air venues get landmarks in the distance that move** (`landmarks.ts`), so the world carries on past the crowd:
    - The festival has a funfair past the left-hand fence with a 40 m big wheel turning. Its gondolas hang level, and its bulbs run through three patterns (a rainbow rolling round the rim, pulses out along the spokes, alternate spokes trading places). Food stalls and festoons stand round its foot. It sits where the drone's outbound run and a free camera look; every fixed angle at the festival faces the stage, which hides anything behind it.
    - The sunrise valley has six hot-air balloons drifting on the wind. Their burners roar every so often, the envelope glowing from inside (brighter in the dark), and they climb as it gets light. Two flocks of birds loop over the stage and the valley once dawn breaks, and the audio already has the birdsong.
    - The beach bay has a headland running out to sea on the left, with a lighthouse on its point. After dark its two beams sweep the bay, and the lantern blazes as one swings past the camera. A town lines the far shore, its hotel windows and streets lighting up through the dusk. Gulls fly over the shore by day.
    - Airliners cross the sky over the festival, the beach and the rooftop: a dark shape by day, nav lights and a strobe by night. Over the rooftop, one comes in low on the approach.
129. **The landmarks follow the flash rules.**
    - The wheel's bulbs change at most 1.2 times a second, or 0.35 with Reduce flashing on.
    - Burners glow up and die away over a quarter of a second, or about a second with Reduce flashing.
    - The lighthouse blazes twice per 12-second turn.
    - The aircraft strobe pulses every 1.3 s, or every 2.2 s with Reduce flashing.
130. **Distant landmarks see through the haze more than the rest of the scene.** At sunrise the haze is thick enough that a balloon 200 m off went flat grey. The balloons, the wheel and its bulbs now take 40–60% of the fog (`thinFog`), so their colours read while they still sit back in the air. At night they darken towards silhouettes, because the venue's key light is aimed at the stage and lit them as if it were day; the burners and bulbs carry them after dark. The wheel's bulbs are kept under full brightness, because brighter than that the tone curve turned every colour to white.
131. **Each landmark costs one to seven draw calls.** The wheel's frame, bulbs and gondolas are one mesh each, the gondolas instanced. Each balloon is one mesh, with all the burner flames in one point cloud. A flock is one mesh rebuilt each frame from preallocated buffers. The town's lights are one point cloud. The legs, platforms, the lighthouse masonry and the hotels go into the venue's merged set.
132. **More life at the bars and on the skylines.**
    - Bar counters get a smoked mirror, lit fridge doors, a tap tower, a till with its screen, cups and a drinks board (generic drinks, made-up prices).
    - Bar staff and drinkers now work the bars at DC-10, Berghain, Printworks, the Warehouse and Alexandra Palace.
    - The booth laptop in the venues shows the DJ software rather than a blank glow.
    - City skylines have roof structures: setbacks, plant rooms, water towers and masts, with the red beacons on the mast tops.
    - Boiler Room's downtown towers get the same: parapets, plant rooms and condensers, water tanks and antenna masts.
133. **The small rooms get the details that make them lived in.**
    - The bedroom window looks out on a night city (moon, two rows of rooftops with lit windows, a red light on a mast) instead of a grid of windows.
    - Photos are pegged on a string over the bed, and a laundry basket stands by the fridge.
    - The basement has tags sprayed low on its walls (generic words only).
    - The Warehouse's far wall stays as it is: the LED wall and side screens already fill it.

## Big-screen visuals always rotating (2026-10-11)

You asked for the visuals on the big screens to always rotate to the vibe of the song.

134. **The auto VJ is always on; its switch is gone.** Every venue screen shows the visual player, and it now always moves through modes. Picking a mode by hand puts it up straight away, and the rotation carries on from it at the next change. Saved settings that had the auto VJ off are ignored.
135. **Each song sets its own pace** (`songPace`, on the song's look): about 40 s a mode for chill tracks, 15–16 s for house, techno and trance, and 7–8 s for bass music and hip hop, pop and R&B. That time is turned into bars at the song's tempo and rounded to a phrase length (4, 8 or 16 bars), so changes still land on phrase lines.
    - On a drop it cuts to a peak mode, then rotates twice as fast for the next 16 bars.
    - In a breakdown it goes to a calm mode.
    - With "Follow each song" off, or a track with no look, it changes every 8 bars.
136. **Between tracks the screens drift on slowly**, through calm and groove modes, every 16 bars of the beat the player keeps on its own (about half a minute). An empty room no longer leaves one picture frozen on the wall.

## Burning Man (2026-10-11)

You asked for a 1:1, ultra-realistic, fully working Burning Man venue, researched as far as possible, with a photo of a fire-breathing mechanical octopus art car.

137. **Laid out from Burning Man's own city plan.**
    - The Esplanade is 2,500 ft from the Man, the outer road 11,690 ft across, Center Camp 3,026 ft out at 6:00.
    - Lantern spires stand every 150 ft along the 6:00/12:00 and 3:00/9:00 promenades.
    - The city fills 2:00 to 10:00, and the Temple stands at 12:00 about 2,500 ft past the Man.
    - True north lies along the 4:30 axis, so 12:00 points north-east and the sun comes up at about one o'clock.
    - The hills sit at their real bearings: the Granite Range to the west, the Calico Hills north-west, the Black Rock Range north, the Selenite Range south-east, and the playa running flat away behind the Temple.
    - Sources are in docs/venue-research.md.
138. **You play from the top deck of a sound art car parked on the burn perimeter**, 1,000 ft from the Man at about 5:30.
    - That's where the crowd sits on burn night, and sound cars are where the music happens on the open playa.
    - The Man stands behind you with the Temple beyond. Past the crowd you see the city's lights, with Center Camp on the 6:00 promenade.
    - The wide shot is from the top deck of the next art car along: high enough to see the Man over your car.
139. **The Man, the Temple and every art car are generic forms, not copies.** Each year's Man, pavilion and Temple are new designs, many by named artists, and the octopus in your photo is a specific artist's sculpture.
    - The Man is a timber lattice figure on an octagonal timber pavilion, outlined in neon (which goes back to 1991). His arms hinge at the shoulders.
    - The Temple is a tiered timber sanctuary with a spire, lit warm from inside.
    - The octopus is an original design in the spirit of the photo: a riveted brass mantle, lamp eyes with a slit pupil, a chimney poofer, and six raised arms with nozzles.
    - The name and the place are real, with the usual fan-made, not-affiliated note. There's no logo.
140. **The burn follows the real sequence, compressed into about two minutes.** It fires on a long peak while it's still dark, or from code (`signature('burn')`).
    - The Man raises his arms, and fireworks go up off his base.
    - The fire takes the pavilion and climbs him, then he falls away from the crowd.
    - It burns down to a glow that lasts the rest of the night, and the crowd goes up for it.
    - Fireworks burst at most three times a second, or 1.8 with Reduce flashing. The fire's light flickers smoothly.
141. **Fire follows the playa's rules and the flash rules.**
    - The poofers are propane fireballs at least 10 ft up, as the art car rules require.
    - On the drop they all fire. Through the peak, half fire on beats one and three (once a bar with Reduce flashing). The octopus also fires one arm every few bars on its own.
142. **The set runs from the dark to sunrise.**
    - No moon, the Milky Way over a dark desert, the city's glow low on the horizon.
    - Then blue hour, the hills going magenta (as Burning Man's own journal describes the dawn), and the sun up over them.
    - The playa is held near-black at night. The scene's fill light falls evenly on everything, and on pale alkali that read as daylight. It comes up with the dawn.
143. **Everything else is the playa at night:**
    - art cars crawling past at 5 mph (a jellyfish, a galleon, a dome, a fish);
    - 160 bikes riding loops round the Man in EL wire;
    - bikes dumped in heaps at the edge of the crowd;
    - the crowd in fur, goggles and sequins;
    - lasers sweeping up from the city's sound camps;
    - art out on the open playa (a ring of light, a forest of glowing poles, a steel tree).

    The open desert sounds dry: nothing to bounce off, and a heavy low end. Underneath it, wind blows across the lake bed in slow gusts.
144. **The art car's lasers stay over heads everywhere round the car**, because people stand all round it, not just in front; they reach 150 m. Two orange shapes that hung in the sky in every shot turned out to be lens ghosts, not lasers. The octopus's polished deck caught a wash light, and the cinematic lens mirrored that bright flat rectangle across the frame. The deck is matte now.
145. **A full volley of fireballs reads as fire, not a white-out.** Each ball is drawn on its front faces only. With the back faces added in as well, the octopus's seven arms firing together stacked up to cream-white and buried the sculpture in bloom. The hot core is a deeper yellow, and the light the fire throws onto the playa is a little lower.
146. **Poofers throw tall rolling columns of flame, as in the photo of a real fire-breathing art car.** Each burst is five billows that leave the nozzle 70 ms apart. The first one rolls up into the top of the column and the rest make its body, so the flame reads as one tall plume, not a ball. While the valve's open, a short blue cone of fresh gas shows at the nozzle. The octopus itself stays an original design.
147. **The burn reads clean.** The red smear on the crowd beside the car was the cinematic lens's ghost of the burning Man: a ghost mirrors whatever is brightest through the frame's centre, and the burn is the brightest thing on the playa by far. Two changes:
    - Ghosts now saturate, as real ones do. A big fire throws a soft veil, not a second fire.
    - A venue can turn its ghosts down; Burning Man runs them at a quarter.

    The art car's moving heads also come down to 30 % while the Man is in flames, so the fire lights the playa, then back up as he falls.

## Up next in every mode (2026-10-11)
148. **One coach for the whole app.** The gig's next-track coach became a service (`app/nextup.ts`) that runs every frame in every mode. The gig HUD, the stage card, the Library strip and an empty deck's hint all read the same picks, so they never disagree.
    - A gig hands it its slot's energy and the tracks heard tonight.
    - Outside a gig it aims a step above the energy playing (the night keeps building).
    - With nothing loaded it picks an opener around energy 4–5.
149. **Where the picks show.**
    - The stage card sits bottom right, because the now-playing card is bottom left. It hides in a gig, since the HUD shows the gig's own pick.
    - The Library strip and the empty-deck hint show in every mode, gigs included. Pro assist still hides the HUD's pick, as before.
    - Loading a pick puts it on the free deck. Under Auto DJ, a track you load yourself is the one it mixes next, so a pick works there too.

## Show effects in use now (2026-10-11)
150. **Three effects the game didn't have, picked from what big shows use now:**
    - LED wristbands in the crowd;
    - kinetic winch lights;
    - a holographic gauze in front of the booth.

    It already had CO2, cold sparks, flame jets, confetti, lasers, a mirror ball, drones and pixel-mapped LED, so those weren't redone. Anamorphic "3D" screens were left out: the illusion only works from one fixed spot, and the game's camera moves.
151. **Where each one goes:**
    - Wristbands are at the arena-scale rooms (the Main-Stage Festival and both Alexandra Palace layouts), on the far crowd's spots. The jointed dancers up front don't get them, because a point can't follow a moving wrist and would float.
    - Kinetic rigs are in the two warehouses, over the floor where the roof is high enough.
    - The gauze is on the festival main stage.
    - Outdoors, the bands and the gauze fade with daylight.
152. **The gauze is drawn for one viewpoint, the mix tent, as real projected content is.** Strokes are about 25 cm wide so they read from the back of the field. The content is held back in the groove and comes up through the build and drop, so it doesn't sit over the DJ all night. An early version with thin strokes and a wide glow blew the close crowd camera out to white; the glow is now a tight halo.
153. **The flash rules hold.** With Reduce flashing on:
    - the wristbands swap halves every other beat, not every beat;
    - the drop's all-band flash drops to a quarter;
    - the gauze doesn't flash on the drop;
    - the kinetic balls pulse on the kick at 40 % of their usual depth.

## The daily challenge (2026-10-11)
154. **A daily challenge, to give people a reason to come back and something to share.** It's the same set for everyone each day, and the result copies as a few lines of text, so it pastes into any chat.
    - The game ships no music and has no server. So the challenge fixes the stage, slot, twist and objectives, and you play it with your own tracks. Scores aren't compared on a leaderboard; the shared text is the comparison.
    - The date seeds everything, with #1 on 1 January 2026, and it uses your local date.
155. **Any stage, locked or not.** The daily is the one way a new player gets a set on the festival main stage or at sunrise before their career opens it. That's a taste of what's ahead, once a day. The first finish is the result and moves the streak; replays are practice. Rewards are the normal set rewards, and the once-a-day result keeps that from being a farm.
156. **Built on what was there.** Objectives come from the bookings' list (an encore is left out, since it's down to luck). The set runs through the normal gig flow, its twist nudges the room's starting vibe, and the results screen gets a Daily block. The save is checked field by field, so an old or edited save can't break it.

## Easier tiers (2026-10-11)
157. **Fame tiers come about three times sooner.**
    - The thresholds are roughly halved: 80, 300, 700, 1,400, 2,600 and 4,500 fame, where they were 150, 550, 1,300, 2,700, 5,200 and 9,500.
    - Every grade pays more fame. A B pays 45 where it paid 30, and a D pays 12 where it paid 5, so a rough night still moves you on.
    - At a steady B on 10-minute sets, the first tier comes after 3 sets (was 6), and the sunrise after 29 (was 87). At a C it's 46 sets (was 172).
    - Grades themselves are unchanged.
    - A saved career moves straight up to the tier its fame has now earned when the game loads.

## The visual upgrade: shadows where things meet, reflections, models, the crowd (2026-10-11)
158. **Ambient occlusion in screen space, from the frame's own depth.**
    - It works at half resolution: 12 taps spiral round each pixel, then an edge-keeping blur. It never draws the scene a second time.
    - Lamps, screens, beams and lasers keep their full brightness, since light doesn't sit in shadow.
    - It fades out past about 18–45 m, where it only adds noise.
    - The radius is a hand's span (55 cm). People, booths and walls pick up contact shadow without a dark halo round the room.
    - The composer's target now keeps a depth texture. A small pass notes which buffer holds the scene, because the composer swaps buffers as passes run.
159. **Reflections are a mirror render of only the bright things.** In a dark club, the lamps, screens, beams and lasers are what you see in a polished floor; dark walls reflect nothing you'd notice.
    - Bright objects are tagged on their own layer: additive, not tone-mapped, or strongly emissive. A virtual camera below the floor draws just that layer at quarter resolution.
    - The render is blurred by how rough the floor is and laid on with Fresnel, faint looking down and strong at a grazing angle.
    - Screen-space reflections were rejected because they lose anything off screen, which is the rig overhead.
    - Each venue sets its floor height, strength and roughness. The rooms with a stage get a second plane on the stage deck, because the crowd covers most of the floor.
160. **Both are on at Medium and High.** They're off on Low, and the automatic quality turns them off at its lower two steps, before it cuts the render resolution further.
161. **The models are built in code, not downloaded.**
    - The free libraries (Poly Haven, Kenney, through jsDelivr) are blocked by this build environment's network policy. The single-file build also argues against large model files.
    - Trusses are tube geometry: four chords, zigzag braces on each face, couplers every 3 m. Each length is built once and shared.
    - Speakers are rounded cabinets with perforated grilles, handles and rigging plates: one mesh with two materials. A line array merges into a single mesh.
    - The booth gets aluminium trims, a kick plate and a rounded top.
162. **The crowd stays a jointed figure posed in the vertex shader, not a skinned model per person.** It is skinning with rigid bones, posed in the vertex shader, and it keeps one draw call per 6 m chunk of people. Mocap clips would need model and animation files from outside, which can't be fetched here.
    - The close-up figure now has:
      - a shaped torso (waist, ribcage, shoulder slope) and rounded shoulders that turn with the arm;
      - a jaw, nose and ears, and trainers;
      - long hair on about 40 %, a cap on about 14 %;
      - shorts, by venue: about half the beach crowd, 10 % indoors;
      - slimmer and broader builds.
    - Triangles per person: 1,226 to 1,854 close up, and 581 to 810 in the low-detail model used past 12 m.
    - The dancing gained a step-touch: the weight goes from leg to leg each beat, one knee bends and the other foot comes up. The body also leans into the beat.
163. **The far crowd is drawn from the same 3D person.**
    - Its four poses are posed on the CPU through the same joints as the shader. The poses are dancing, filming, hands up and a fist pump.
    - The poses are drawn into the cut-out atlas back to front, with shading from the light. There's a long-hair version of each.
    - The atlas carries data, not colour: skin, hair or clothes; top, trousers or phone; shading; coverage. Each far person keeps their own clothes and skin colours.
    - Colour is padded past the outline so the edges don't darken as the cut-outs get small.

## Atmosphere, outdoor venues, your DJ, presentation (2026-10-11)
164. **The open-air sky is light through air, not keyed colours.**
    - It uses single scattering through a planet's atmosphere: Rayleigh for the blue and the low sun's reddening, Mie for haze and glare, and ozone for the deep twilight blue overhead.
    - On the GPU it goes into a small sky-view table (azimuth by elevation, denser at the horizon) that the dome reads. The table is redrawn only when the sun or the moon moves.
    - On the CPU, a handful of directions give the sun's colour at the ground and at the clouds, and the sky's light on the scene.
    - Each venue's keys now only give the sun's height, the stars and when the site lights come on.
    - Single scattering leaves twilight too dark, because most twilight light has bounced twice. The sun's share is lifted up to 3.5 times as it sets, like a camera opening up.
165. **Everything outside takes its light from that sky.**
    - The sun light is the colour and strength that reaches the ground. After dark the moon takes over, cool and dim, with its strength following its phase.
    - The hemisphere fill is the sky's average from above, plus the site's ground colour lit by the sun and sky from below.
    - The haze takes the horizon's colour. Metal and glass reflect a small filtered cube render of the sky, re-made every few seconds.
    - The moon is far brighter than a real one (day for night, as on film); otherwise the night would be invisible on a screen.
    - The sun disc is bright enough to flare but no more. At ten times brighter, the lens bloom veiled the whole midday frame.
166. **Real clouds, cheaply.**
    - A low layer of heaped cloud and a high layer of streaks are drawn in the dome from tiling noise.
    - Each is lit by the sun as it is at that height, so high cloud stays pink after sunset.
    - Heaps are shadowed where they're thick and silver at the edges towards the sun, grey-blue by moonlight, and glow underneath with the site's lights.
    - Cover is set against the noise's measured spread. The first threshold sat above 99 % of the noise, so there was no cloud at all.
    - Per venue:
      - festival: the full moon rising behind the stage;
      - beach and boat: sea air, with a moonrise;
      - Sunrise and the playa: a thin crescent over the dawn, so the Milky Way stays bright.
167. **Proper water at the beach and the boat.**
    - Gerstner swells move the surface on a grid of rings that is fine underfoot and coarse at the horizon, with two layers of ripples on top.
    - It reflects the same sky table and clouds the dome draws, plus sun and moon glitter paths.
    - The show's lights glitter beneath each one. Rows of lamps on a shore or bank are reflected as shimmering columns, found where the reflected ray meets their plane.
    - Surf runs up the beach and washes back. The boat leaves a churn, the two arms of its V wake and wash along the hull.
    - The beach sand was tilted the wrong way (rising towards the sea); it now slopes in and meets the water where the surf breaks.
168. **Life in the air.**
    - Dust specks drift through every moving-head rig, lit only where a beam passes through them and brightest looking up the beam. They replace the blocky sparkle cells drawn on the beam surfaces.
    - Steam rises off a packed crowd. It builds over a minute or two of a hard peak, clears in a breakdown and is lit only by the rig.
    - The crowd's skin goes glossy with sweat over a long peak.
169. **Your hand goes to whatever control moves**, whether by mouse, key, MIDI or the Auto DJ.
    - Each board part has a grip point, such as a fader's cap or a jog wheel's near edge. The registry's activity event finds the part, and a two-bone reach puts the hand there.
    - It eases in, holds while the control keeps moving, then eases back to the dance.
    - The fingers curl round it, and the head glances down.
170. **A better DJ:**
    - **Fingers:** two segments on joints, with knuckles and nails. They curl to grip a control, open with hands up and close to a fist for the pump.
    - **Face:** brows lift through the build and on the drop, the mouth shouts along on the drop, and the eyes go between the decks and the room.
    - **Clothes and props that swing:** a skirt, hoodie strings, a lanyard pass and a towel over the shoulder. These are driven by the chest's motion, as the hair is by the head's.
    - **Headphones on one ear:** the cup is on the left ear and the band crosses the crown. While a channel is cued, the head tips to that side and every eight beats the hand presses the cup in.
    - **Starter look:** it now wears headphones, because a DJ always has them.
171. **Walking in.**
    - Switching venue plays a 6-second shot from the back of the room, over the crowd, to the booth, with the venue's name. It starts once the room's shaders have compiled.
    - Any touch skips it. It doesn't play with reduced motion, and it doesn't play on load (the title does that).
172. **A title screen.**
    - The name is traced from the display face on a canvas, its holes found by nesting, and extruded: chrome faces with glowing sides.
    - It hangs close to the lens, so a small room's walls can't hide it, in front of a slow glide through a club at night. A new player's bedroom would be a weak first look, so the title uses the Deckhouse club and then walks you into your own venue.
    - Any key, tap or controller button starts. Automated browsers and deep links skip it; `?title` forces it.
173. **Photo mode** (camera menu, the camera pad, or Shift+P):
    - Depth of field comes from the scene's depth, with a real aperture (f/1.4 to f/16) and highlights opening into bokeh.
    - Tap anything in the picture to focus on it.
    - "Hold the moment" freezes the room while the camera still moves.
    - Filters layer over the room's own grade.
    - Framing offers thirds and frame shapes (16:9, 4:5, square, 9:16, 2.39:1). The picture is saved cropped to the frame.
174. **One interface style.**
    - Every button glyph (✕ ⋯ ⛶ ↶ ▲ ★ 📌 and the rest) is now a line icon from one set, on one grid and stroke weight.
    - Font sizes snap to one scale (2xs to 2xl). They had drifted to 20 values.
    - Dialogs, menus, toasts and dock panels share one set of curves and timings, and buttons respond to a press.
    - Reduced motion still turns the movement off.
175. **A shader bug shipped and fixed.** The step-touch round declared `lean` twice in the crowd's pose shader, so it didn't compile and the 3D crowd didn't draw. The from-disk tests run in the bedroom, which has no crowd, so they didn't catch it.
    - It's fixed, and a test now checks the pose shader declares each top-level variable once.
    - Screenshots of a crowded venue are now part of every round's checks.
176. **Depth of field reads its own copy of depth.**
    - On Medium and High, the ambient-occlusion pass draws into the buffer that holds the scene's depth and clears it, so depth of field saw everything as far away and blurred the subject too. Low has no such pass, which is why the first test looked right.
    - While photo mode is open, the depth tap now writes the distance from the camera, in metres, into a texture of its own, and depth of field reads that. It costs one small pass, only in photo mode.
    - The blur's taps turn at random from pixel to pixel, so a small bright speck spreads into a soft disc instead of printing the tap pattern as a flower.
177. **Close portraits, and bloom that follows exposure.**
    - In a custom camera view the DJ is hidden when the camera is within 1.2 m of their head, so the head never blocks the board. In photo mode that hid the DJ from every close portrait, so there the DJ only disappears with the camera inside their head (under 0.35 m).
    - The bloom's threshold was fixed in the scene's light before exposure. When the camera stops down for daylight it now rises to match (the threshold over the exposure, below exposure 1 only), so a bright sky doesn't bloom over the picture. Clubs, where exposure sits at 1 or above, look the same as before.
    - Photo mode's focus now follows the DJ as the camera moves, until you tap to focus or set the distance (the *Focus on DJ* chip turns it back on). Before, it kept the distance from when photo mode opened, so moving in for a portrait left the DJ soft.
178. **One art direction: stylised realism.**
    - Realistic lighting sat next to blocky, low-poly people. The two options were to push everything to photoreal or to design the shapes and keep the physics, and stylised realism was chosen.
    - What stays physically based: the light, the sky and sun, water, haze, exposure, and materials (roughness and metalness from real values).
    - What is designed: people and props. Smooth, simple forms with clean silhouettes, details painted in rather than modelled, and no hard 90° edges on anything you see up close.
    - Materials follow one vocabulary: skin is semi-gloss (wetter as the night peaks), cotton and fabric matte, denim matte with a weave, hair satin, rubber soles and plastic in between, phones glossy. New props should take their roughness from that list, not pick a fresh value.
    - WebGPU was prototyped for this round and then removed at the user's request. Nothing of it was committed.
179. **The crowd figure, rebuilt.**
    - Limbs, neck and pelvis are lathes of real proportions (a calf, a tapered thigh, a forearm narrowing to the wrist), closed with domed ends so there are no rings where parts meet. Knees, elbows and shoulders are small spheres that hide the joints when they bend.
    - The head is one deformed sphere (the jaw narrows, the back of the jaw tucks in, the chin comes forward), welded so it has no seam. The hair is a second shell over it: its hairline is lower at the sides and back than at the front, and it thins to nothing at the edge, so it reads as hair rather than a helmet. A quiff (on some people, never under a cap), a nose, ears and thumbs complete it.
    - The close model is about 3,100 vertices (4,600 triangles), up from 1,500, and the far one about 1,000. A test holds both under budget and checks that every body part is a closed surface.
    - The figures at the back of big rooms are drawn from the low-detail model, so they changed with it.
180. **Detail painted in the shader, not modelled.**
    - The fragment shader gets each vertex's rest-pose position and bone, and paints from them: eyes with a catch light, brows, a mouth and cheeks; necklines (crew or V), collar ribs, hems, tonal stripes, colour blocks and small chest prints (a ring, a dot or a chevron: abstract, never a logo); belts and buckles; denim twill, seams and worn knees; shoe soles, laces and side stripes; strands in the hair.
    - Every edge is antialiased with `fwidth`, so the details stay clean at any distance instead of shimmering.
    - Each part sets its own roughness (`crowdRough`) from the material list in 178.
    - Shorts are painted rather than cut: below the hem, the thigh is coloured as skin. Modelled shorts left a ragged edge where the thigh's triangles crossed the hem.
181. **Bevelled props.**
    - `bevelBox` keeps a box's 24 vertices, in the same order and with the same uvs (so tiled uvs still work), shrinks each face and closes the gaps with a strip along every edge and a triangle at every corner. Those reuse the faces' vertices, so across a strip the normal turns from one face's to the other's and the edge shades like a rounded one, for 32 more triangles and no more vertices. Material groups are kept.
    - It is used by every set-dressing box, every `block()` (risers, desks, pillars, beams) and the furniture in the bedroom, the apartment, the dressing room and the basement. The bevel scales with size, from 3 mm to 3 cm, and thin plates stay plain. Cushions and mattresses get deep bevels so they look padded.
    - Room shells stay plain boxes: their corners aren't seen, and one shell's floor is an invisible face.
    - Cost: 2–3 % more triangles per venue (11,000 more in the warehouse, 49,000 at the festival).
182. **The small presentation jobs, together.**
    - **The moving sun was already there.** The open-air venues have followed the set clock since the outdoor round (golden hour to night on the Rooftop, sunset at the Beach, sunrise across the closing set). It was listed as an idea by mistake. What was missing was control: free play ran a fixed 20-minute night, so an hour's mix sat in the dark for 40 minutes. Its length is now a setting (10, 20, 45 or 90 minutes of music); a gig still follows its set.
    - **The board reflects the room indoors** (`showenv.ts`). Indoors the hardware used to reflect a neutral studio environment, so the club's colours never showed in the chrome. Now a tiny room of light is painted in the show's three colours: the wall in front, the side walls, a dim back wall and a warm lamp overhead. It brightens with the wash, the moving heads, blinders, strobes and the kick, eased so a strobe reads as a lift, not a flicker. It is a 32 px cube re-filtered 15 times a second, the same size as the open-air sky's, so switching between indoors and outdoors never recompiles a material. Low keeps the studio environment. The lamp and the base levels were tuned against screenshots so the board is as bright as before.
183. **Interface sounds stay out of the music.**
    - They are synthesised (no files), play straight to the audio output (never through the mixer, the capture tap or the replay buffer), and each kind has a minimum gap so a fast run of clicks doesn't stack.
    - Silent on purpose: the decks, mixer, effects, sampler, light pads and the 3D board (a DJ hears the music, not the buttons), and ordinary notices. A deck ending, Auto DJ starting or a camera change happen mid-mix, and a chime there would be in the way. Errors still make a low sound.
    - The default is a quiet 35 %, on a squared curve so the slider's middle is gentle.
184. **The interface moves with the music.** The top bar sets one CSS variable, `--beat`, from the beat pulse (rounded to 0.05, so most frames change nothing). The accent line, the active tab, the vibe meter's cells and the gig's vibe meter read it, and the meter also gets a running sheen and a leading edge that swells. It's off with reduced motion, and a setting turns it off. The gig HUD's score already rolled up and the results already counted, so those stayed.
185. **Broadcast mode, and the screensaver.**
    - It reuses the title screen's layout (everything but the stage hidden, the stage fixed to the window) and keeps the track-name card and the walk-in card. It turns the auto director on and puts back what was there before when it ends. The track name shows even with the now-playing setting off, because there is nothing else on screen to say what's playing.
    - Manual broadcast ignores pointer movement (a streamer moves the mouse) and leaves with Esc, Shift+O or a Leave button that shows with the pointer, so touch screens have a way out. The screensaver version ends on any touch: mouse, keys or a controller.
    - The screensaver needs music playing and no dialog, title or naming scene open. It is off by default: an interface that vanishes by itself would surprise people who just listen.
186. **A gig walks you in with its flyer.** Starting a set plays the arrival shot even when you're already in the room, with the night's flyer pinned beside the venue's name: the booking's own flyer, or for a set you picked yourself, one from the venue's own (fictional) promoter. Beside the name rather than above it, because on a small stage a tall flyer ran under the gig HUD.
187. **Results with a moment.**
    - The grade stamps down from above at a slight angle, with a ring and a thump as it lands. The earnings count up after it, ticking, and new unlocks pop in with a chime.
    - The replay of the crowd's peak uses the buffer's stills (one picture every two seconds, kept whenever the buffer is on), not its video, which is optional and heavier. The peak's time in the set becomes the picture clock by counting back from the end, because the set clock runs from the first track without stopping. If no picture falls within a few seconds of the peak, the nearest four are used. With the buffer off there is no reel and the screen looks as before.
188. **The stutter log** (debug menu): a frame that came more than 50 ms late is logged with the previous frame's work. Its main parts are timed (audio and game, the 3D stage, the panels), and code doing known heavy work notes it as it happens: a venue built, shaders compiled, a board built, a track decoded. Time not spent in the game's own code is shown as "outside": drawing on the GPU, garbage collection or the browser. Frames after a hidden tab or a pause of more than 2 s are left out. The newest 40 are kept, with a Copy button.
189. **Codes, and FAME.** The ⋯ menu has an "Enter a code…" box (`game/codes.ts`, `ui/CodeEntry.ts`). FAME puts the career at the top tier with 4,500 fame (the top tier's mark; more fame you already have is kept), and opens the two venues that don't open by fame: the Basement, which needs a first set, and the Boat, which needs its booking. These are marked as unlocks (`venue:basement`, `venue:boat`), not done by faking a set played or switching on the debug menu's sandbox, so your stats and reputation stay honest and everything else keeps working as normal. Everything the tiers unlock (wardrobe pieces, VIP crew) follows from the tier, as it always has. The code isn't case-sensitive and can be typed again safely.
190. **Crazy rooms share one engine** (`rooms/kit.ts`). Each room is a venue (`CrazyRoom extends VenueBase`) with the same parts: modes, up to six actions (hit, toggle or hold), drop moments marked big or deep, a look (mode, colour, level) saved per room, and four scene slots. One `roomShow` object connects the room to the rest of the app (the pads, the Show tab's panel, the gig director and the app's key and glitch feed), so no other module needs to know which room is up. Rooms are venues rather than a separate mode, so gigs, cameras, photo mode, the director and the arrival shot all work in them for free.
191. **Mirrors are a reflection probe, rendered twice.** The mirror room, the dome and the pool each render a cube map of the room from its centre, 30 times a second at most. Each frame the probe renders the room using the previous frame's cube (ping-pong targets), so reflections of reflections build up over frames and the corridor goes on forever without recursion in a frame. Lookups are corrected to the room's box (or the dome's sphere), so reflections line up with the walls instead of floating at infinity. One 192 px cube per room keeps it in budget on Medium.
192. **The light grid isn't lasers.** Its beams run at body height through the crowd, which real lasers must never do (the safety rule is at least 3 m above the audience). So they are drawn and described as light beams, and the room's only lasers are overhead with an audience zone like every other venue's. Where a person breaks a beam is worked out on the CPU (`splitBeam`), so the beam stops at them and the note plays (`scaleNote`, a pentatonic scale on the track's key, so any break sounds right). Notes are rate-limited and go to the audio output, never into the mix or a recording.
193. **Stems route to surfaces.** The song-following parts (drums, melody, vocals) drive the floor, walls and ceiling (`routeStems`), eased and scaled by the look's level. Without stems it falls back to the kick and the highs. Two other routings exist because some tracks are all drums or all vocal.
194. **A drop moment scores only when you chose it.** Auto picks a moment that suits the drop, but scores nothing, so the +250 is a reward for reading the track: choose a big moment for a big drop (energy over 0.6) or a deep one for a gentle drop. Choosing wrong costs nothing but shows a call-out.
195. **The Upside-Down flip rolls the camera, not the world.** Rotating the scene would break the lights, the crowd shader and the reflections. Instead the room holds a second booth and crowd on the ceiling, and halfway through the set (once per set) the camera rolls 180° over a few seconds. The roll is reapplied each frame after the camera rig moves and undone if anything else moved the camera, and it never applies close to the booth, so playing at the decks is never upside down.
196. **The hologram copies your avatar's bones.** It is a second `Avatar` built from your look with hologram materials, scaled up 5× (8× with Giant), and every frame it copies each bone's position and rotation from you, so it dances exactly as you do with no animation code of its own. "Crowd faces" are the crowd's head shape scaled up, not real faces.
197. **The crowd looks up.** Two crowd shader uniforms: `uLook` raises heads and makes some people point (staff don't), and `uUV` makes light clothes, teeth and eyes glow under blacklight. Rooms set them from their moments and their pads, and big moments bring up more phones.
198. **Room Battle is pure logic** (`game/roomBattle.ts`), fed the beat and the presses. Turns count bars actually played, one at a time, so loading a new track (whose beat grid starts somewhere else) or seeking doesn't skip a turn. Each side has its own half of the pads (`roomShow.owned`), so you can't steal the rival's effects. The rival's skill follows your tier. The rival is one of the existing fictional rivals.
199. **Secret rooms open by challenge, not by tier** (`game/rooms.ts`). Each has a challenge checked after every set, like the milestones, using numbers the set summary already has. Once open it stays open (`room:<id>` in unlocks). The sandbox and the FAME code open them all.
200. **The crowd's new behaviours live in one object** (`crowdShow.ts`), like the rooms' `roomShow`: the genre's dance style, the current crowd moment, the move being copied, the signs' texts, the regulars at the front, and now the share of the crowd still in (a clash) and the rain. The crowd shader reads uniforms set from it; the director (`crowdDirector.ts`) and the gig set it. Nothing else needs to know which venue is up.
201. **Crowd moments are picked from the music, rarely.** At least 75 s apart, and only when the moment fits: lighters for the closing track of a closing set when the room's gentle, a sit-down before a big drop that's building, a dance circle when the room is peaking, a conga in a relaxed groove. The conga moves real instance matrices along a path (people leave their spot and come back), so it can't be a pure shader effect.
202. **Regulars are fictional and remember genres, not tracks.** Loyalty moves with the grade and with how long the room heard their genres. It's saved in settings, separate from the career save, so an old save never breaks.
203. **DJ moves override the avatar's arms, not its body.** The move animation replaces the arm pose for its length and skips the hands-follow-the-controls reach, so the DJ never punches through the board. A move scores only when the room is with you (vibe over 30 %), at most every 6 s, so it can't be spammed for points.
204. **Room outfits are unlocks by venue** (`outfit:<venue>`), the same mechanism as the other wardrobe unlocks, given after a set in that room.
205. **The drone show and fireworks are one fixture** (`skyshow.ts`), placed per venue. Drones use one Points buffer; fireworks a pool of 3,000 sparks reused. Drones only fly after dark. The fireworks finale is three venues only (festival, beach, boat): fireworks over a rooftop bar or a city club would read as wrong.
206. **Projection is the visual player as a projector texture** (`projection.ts`): overlay meshes on the chosen surfaces read the visualizer's output through a projector's view and projection. Because the stage only renders the visualizer when something on screen uses it, the overlays register as visual objects.
207. **VJ mode has no server.** Same browser: a BroadcastChannel. Another device: WebRTC with the offer and answer swapped by hand as codes, no STUN or TURN servers (so it only connects on a local network; nothing goes to an outside service). The VJ's picks can hold the auto director off; the deck stays the authority and the VJ only sends control presses and choices.
208. **The visual editor makes data, not shaders.** A look is a short list of layers with a few numbers each, drawn by one 2D-canvas mode, so a saved look can't fail to compile and three slots are cheap. They register as ordinary visual modes (`my1–3`).
209. **New rooms reuse the kit.** The seven new rooms are `CrazyRoom`s like the first twelve, with their own modes, actions and drop moments. The arcade's score board listens to `roomShow.pop`, fed by the gig's transitions, drops and mistakes, so it is the real score. Masks that used `1 − smoothstep(…)` on a centred `fract` were inverted (washed-out walls) and were rewritten as `smoothstep(a, b, abs(fract(x) − 0.5))`.
210. **Rooms you build are configs, not code** (`rooms/custom.ts`). A built room is a small JSON (parts, colours, size), validated, saved in settings (eight at most) and registered as a venue `custom-<id>` at start-up, so every venue feature works in it. The parts are simpler cousins of the crazy rooms' surfaces.
211. **Ghosts are sampled every 2 s** (`[time, vibe, score]`), one per day, kept only if the run beat the old one. Small enough for settings, and interpolated for the HUD.
212. **Set codes carry track names, never audio.** `DH1.` + deflate-raw base64url JSON (`DH0.` uncompressed where the browser can't compress), short keys, 40 tracks at most. Opening one matches by title and artist, then title alone, and lists what's missing, so a friend needs their own copies of the music.
213. **The career's new parts are one save and pure logic** (`game/circuit.ts`, settings key `circuit`): promoter relationships (−1 to 1), the residency, the tour and the cities toured. It's separate from the versioned career saves so adding it needed no migration. The calendar gets the circuit's bookings after the normal offers (`circuitOffers`), with the same seeded random source, so a night's offers stay stable.
214. **Promoters' memories are small and slow.** A grade moves a relationship by +0.25 (S) to −0.12 (D), so it takes two bad nights to cool a promoter, a hit objective +0.05, a declined offer −0.04, pulling out of a booking −0.15. Below −0.5 the promoter stops calling (their offers are declined for you); above 0.4 they give the peak slot. Pay changes once per offer (marked in its id), so refreshing the calendar can't inflate it.
215. **A residency is booked a week ahead, once.** It remembers the last night it filled in the calendar, so a residency night you pull out of isn't put back. The crowd's size shows as how much of the room is there (people leave from the back), and repeats are judged against last week's tracks only.
216. **The World Tour uses the game's own rooms in real cities.** Real city names are fine; the promoters are fictional and the rooms are the game's venues, so nothing claims to be a real club. Legs can be played in any order (a city with a result isn't booked again); pulling out of one calls the tour off, and each unplayed city's promoter remembers it. Travel is only flavour (and the map's line style), set by tier.
217. **The festival clash is a tug-of-war, shown on the crowd.** The field's share eases toward `0.5 + (your vibe − the rival's) × 0.9`, kept between 12 % and 88 %, slowly (about 20 s to move). The rival's "vibe" is a smooth curve, so there are stretches where they're strong. People leave from the back of the field (their instances are scaled to nothing, their shadows too) and come back the same way.
218. **Night events put everything back.** Each event changes something shared (the rig's power, the speakers, a channel's output, the rain), so `CircuitGig.dispose()` restores all of it whenever the set ends, however it ends. The fire alarm mutes only the speakers: the headphones, the recorder and the level meter still hear the decks, so the vibe meter doesn't call dead air for something you didn't do. A dead channel's audible level is zero to the game too (`Snapshot.dead`). Events never come in the daily (it's the same for everyone), B2Bs or Room Battles.
219. **Rain is a box of streaks that follows the camera** (`rain.ts`), falling in the vertex shader (no CPU work), fading near the lens and far off, lit by the sky's fill. It only falls at the open-air venues. Its sound is filtered noise, straight to the output.
220. **Stems are an honest approximation.** True stem separation needs a trained model (tens of megabytes) we don't ship. The split is filters arranged as complements (each band is "the band" and "the input minus the band"), so the four stems always sum back to the input exactly, and untouched the channel takes a dry path. The UI and the docs say what each stem really is.
221. **Mashups resample rather than time-stretch.** The offline renderer plays each part at a rate, like a turntable's pitch, so it's fast and clean, and the plan says how far the key moves. The beat/top split is the same complementary filter split as the live stems. Parts start on their track's bars and are cross-faded over 12 ms. The result is a 16-bit WAV imported like any file, so it's analysed and can be mixed, saved in crates and backed up like your other music.
222. **The label is fictional all the way.** Rivals who play your releases are the game's fictional rivals, and their posts are generated lines. Plays are worked out per career night (at most the last three nights at a time), so a long break doesn't flood the feed.
223. **Scratch challenges judge strokes, not audio.** Jog movement becomes strokes when the record gets moving or changes direction fast enough (0.45 rev/s on, 0.12 off). Each stroke is matched to the nearest unplayed hit of the same kind and direction within 150 ms; the clock is the audio clock, so the click and the judging agree. A forward scratch's way back isn't scored. In headless software rendering the page runs seconds behind the audio clock, so the in-browser check confirmed one perfect stroke, and the timing was tested in unit tests.
224. **The harmonic wheel reuses the set builder's key rules** (`keyRelation`): the same scores decide what glows and what's listed, so the wheel, the set builder and the coach agree.
225. **Sharpness comes last when the frame rate drops.** The adaptive quality used to halve the render resolution (down to 50 %) before anything else, and a soft half-resolution picture is what made the game look cheap. Now its steps drop the lens streaks, then ambient occlusion, floor reflections and the visual player's frame rate, then its bloom, and only then the resolution, to 90 % and at worst 80 %. High is the default quality (the adaptive steps still protect weaker machines).
226. **Contrast-adaptive sharpening in the output pass** (after AMD's CAS): four neighbours, sharpened where detail is soft and held back on hard edges, in a compressed range (x / (1 + x)) so bright lights don't ring. Gentle on the wide shots, stronger on the board views, more again when the render is scaled down, and none under the looks that are meant to be grainy. Default film grain is gone: it read as noise (on the board's print especially), and sharpening made it worse; only the drone's speed and the VHS, CCTV and night-vision looks add grain.
227. **Ambient occlusion scales with the view and respects edges.** Its radius was a fixed 0.55 m, larger than a whole controller, so at the decks it darkened the desk round every object into a smeared halo. The radius now shrinks with distance (a few centimetres at the board, the old hand's span across a club), and the half-resolution result is upsampled with depth-weighted bilinear filtering, so it never bleeds across an edge.
228. **The beams' march jitter is white noise, and gentler.** Interleaved gradient noise has a diagonal structure that, without a temporal filter to average it, showed as stripes through every beam. A hash with no structure, at under a third of the offset, smooths the steps without reading as grain. Low and medium march a step more.
229. **A deck light over every board.** A soft, shadowless spot just over the front of the board, the same in every venue, so the print, caps and faders read however dark the room is (real booths have gooseneck lamps for the same reason). The board's materials also take 1.6× the environment's reflections, so caps and chrome catch highlights that show their shape.
230. **Board print reads at screen distance.** Real silk-screen is 2–3 mm, which on a monitor is a few pixels. Faceplate text is drawn 24 % larger and lines 50 % heavier, secondary print is pulled 38 % towards the main print colour, fader slots get a lit rim, and the panel's speckle and brushing are finer and fainter. Every board texture gets the GPU's best anisotropic filtering, the all-in-one's side-panel print is drawn at three times its old resolution, and button symbols at twice.
231. **Controls show where they are.** Knob caps are satin with a clear coat and a bold pointer from the middle to the edge; fader caps are lighter with a wider white line; unlit buttons keep a faint glow of their colour and unlit pads a faint white one; white LEDs glow at half the gain of coloured ones so a lit white button no longer burns into a blob. Pointing at a control draws an outline round it on the panel in the board's accent colour, the size of the control (a fader's outline covers its whole travel).
232. **The camera frames the hardware.** The performance view fits the board's chassis (not a laptop on a stand behind it) and sits closer, so the controls fill the frame. Close to the board the bloom is about half as strong with a tighter radius.
233. **Cut-out foliage is antialiased.** Palm fronds and chain-link use alpha-to-coverage, so the multisampling smooths their cut edges instead of leaving stair steps, and the frond texture is drawn at twice its old size.
234. **The shop sells time, not prestige.** Cash had nothing to buy. The shop sells what fame or a count of sets would unlock anyway (wardrobe pieces, sets, hair, eye styles, the next home), priced by its tier (`40 × tier^1.75`, rounded to $10; sets ×2.5, hair ×0.8, eyes ×0.6). Milestone, rival and secret-room pieces stay earned. A purchase is a `buy:<kind>:<id>` key in `progress.unlocked`, so it needs no new save version, and `ownedThing()` checks it next to `owned()`. Homes moved to `game/home.ts` so the shop doesn't pull in the 3D hub.
235. **Achievements count what the career already keeps.** Twenty of them, three levels each, read from `progress` and its stats (new stats: `encores`, `grade:<G>`, `cash_earned`, `shop_spent`, `shop_buys`, `daily_streak`). A level reached is `ach:<id>:<level>` in `unlocked`, which makes it pay once and lets an old career be awarded retroactively when the wall opens. They sit beside the milestones rather than replacing them: milestones are one-off moments with titles, achievements are long grinds with cash.
236. **The director follows how DJ sets are filmed.** Sources: DJ-streaming guides (front camera slightly above eye level for face, hands and gear; overhead; side; a wide on the crowd; multi-camera = main + hands + side/crowd), festival broadcast write-ups (three to six cameras up to twelve: telephoto from front of house, on-stage close-ups, a jib or crane over the crowd, Steadicam, drone; low angles make the DJ look powerful; tight hands at key moments; regular crowd reactions; switching in rhythm with the music and its transitions), music-video editing advice (cut on downbeats and phrases, not every beat; longer shots early, quicker through a build, fast on the drop; mix near and far; an occasional two-beat or two-bar cut so it doesn't go square), and the two best-known formats: Boiler Room (intimate, crowd behind the DJ, born from one fixed camera) and location sets like Cercle (the place first: drone reveals and slow orbits, long shots). No official production notes from those brands were found, so nothing here claims to copy them, and the styles are named for kinds of video (festival stream, club stream, cinematic), not for brands.
237. **Moves are poses over a shot, not new menu angles** (`shots.ts`). Each is a pure function of progress through the shot (eased) and the board's bounds, sized by the venue's reach (its crane radius unless it sets one). The rig plays one with the view reading `custom` and `isLive` true (so hover zoom stays out of the way and you're visible in it); any camera input ends it. They skip the orbit controls' limits so a low angle can look up.
238. **A wall check instead of hand-placing every move in 30-plus rooms.** Before a move plays, the stage casts rays from the air over the decks to the move's start, middle and end; if something solid is in the way (meshes that write depth and aren't glass, light, haze, instanced crowds or you), the whole move is pulled in towards the booth by one factor, so it doesn't jump. Long-lens moves keep the DJ the same size when pulled in. Landmark shots are absolute poses checked by eye, and the director only uses aerials where the venue says the sky is open.
239. **The director is pure logic with a measured bar** (`director.ts`): it answers each show frame with a take (what, which way round, how long it's planned for, hard cut or dip), learning the bar's length from the clock so moves last their phrase. Cuts are hard on the beat (a dip through black was a tell that this was a game camera); only the cinematic style dips between calm shots. "A mix" is two decks playing with their channel meters above −28 dBFS for most of a bar. Rapid cutting isn't flashing, but with less motion asked for the drop montage is skipped anyway.
240. **A festival build speeds up, and a new track goes back to the place.** Festival streams cut faster into the drop, so once a build is three quarters deep its shots last half as long (2 bars), and at the top (0.9) it cuts every bar between close-ups (the `tension` pool: the hands, the fisheye, the booth, the crowd). Club streams and cinematic sets only tighten their shots. When the track out front changes, the next bar line after the blend goes to an opening shot of the place, unless the music is building or peaking. "A mix" now counts a deck only past its channel fader and the crossfader, so a track cued in the headphones doesn't send the camera to the hands.

241. **Venues can turn moves off, and phrase cuts survive slow frames.** A venue's `director.skip` drops moves that can't work there (no crowd to turn round to in the bedroom; at Boiler Room the crowd is pressed round the DJ, so a side-on camera only sees a shoulder); the build's push in and the mix's hands respect it. A phrase cut fires when a line of the grid has been crossed since the last frame, not only on the frame that lands on it, so a slow frame that skips the bar doesn't lose the cut.

## The first modelled asset: the DJ's body (2026-10-13)

242. **The body is MakeHuman's base mesh, made in Blender through MPFB** (`assets_source/blender/characters/character_dj_body_01.blend`). The base mesh and its targets are CC0, the topology is made for animation and it comes with a game rig and weights, which beats modelling a body from scratch through scripts. It's a neutral build (gender 0.5, ideal proportions), the head cut away at the jaw (the code-built head with its face sliders, eyes and expressions stays), 18.6k triangles.
243. **The model's rig is the game's skeleton, renamed.** MPFB's game-engine rig was posed arms down, palms forward, fingers straight (the code-built skeleton's rest), the pose applied as the rest pose with every shape key carried through it, and the bones merged and renamed to the game's (`pelvis` → `hips`, `spine_02` + `spine_03` → `chest`, `clavicle` → `shoulder`, `calf` → `shin`, `ball` into `foot`). The fingers keep their three joints.
244. **The code skeleton still does the moving; the model follows it** (`src/character/modelBody.ts`). Each frame every model bone takes its game bone's rotation (keeping its rest offset), the limbs' joints sit on the game's and the limb bones stretch to the game's lengths, so a hand lands on the control the arm reached for. The spine, neck, shoulders and fingers keep the model's proportions. The bones hang flat off the model's root, so a stretched upper arm doesn't shear the forearm. The fingertip curls with the game's middle joint.
245. **The body sliders are the model's shape keys** (built from MakeHuman's macro and measure targets: weight, muscle, chest, waist, hips, shoulders, arms). Height and leg length come from the skeleton's lengths, as before.
246. **The mesh comes in skin regions, and clothes decide what shows.** Each part (chest, neck, each upper arm, forearm, hand, thigh, calf, foot) is its own material. Long sleeves, trousers and shoes hide what they cover; a region with a tattoo stays code-built, because tattoos are painted for the code-built parts' UVs. The torso always shows, tucked in by shape keys (`tuck_torso`, `tuck_chest` under a crop top, `tuck_thighs` under shorts) so the code-built shells fit round it, which keeps the neck, shoulders and armholes seamless. Tops, waistbands, shorts and skirts are cut a little looser when the model is under them.
247. **It loads after the first frame.** The GLB (1.7 MB) loads once; an avatar built before it arrives is rebuilt with it, so the character is never missing.

## Gear that holds up in close-up (2026-10-13)

248. **Close-up detail is merged per material, so it costs draws per material, not per part** (`src/three/rear.ts`, `parts.ts`, `builder.ts`). Each unit's feet, screws, rear-panel print and connectors are 2 meshes, the cables and plugs 2 per board, the tonearm 5. Dark plastic parts merged into a textured mesh sample solid colour swatches kept in a strip of that texture. Draw calls went down on every board (vinyl2 236 → 218, quad4 374 → 362); triangles went up (vinyl2 93k → 163k, hybrid4 141k → 237k), mostly from lathed connectors, the tonearm and cable tubes, whose segment counts can come down if a phone needs it.
249. **Vinyl grooves are an anisotropy map pointing along the radius**, not geometry or a normal map. That gives the radial light streak real records show without aliasing on grooves smaller than a pixel.
250. **Cables don't run over the desk's edge**, because desk depth varies by venue. They patch deck to mixer and drop into a desk grommet 11.5 cm behind each unit (no further back than z = −0.37), and stay out of the framing box.
251. **Wear stays subtle.** Roughness maps (polished fader slots, worn knob caps and grips, jog fingerprints) and faint scuffs, never grime, and only on the controls a DJ touches most.

## A face that performs, hands that hold each control (2026-10-13)

252. **The face is a weighted sum of fixed expressions** (`src/character/Avatar.ts`). Twelve channels (brows, lids, squint, jaw, lip corners, mouth width, sneer, pucker, head pitch and roll, gaze) are each the weighted sum of seven expressions: the stank face on a drop, eyes shut in a breakdown, wide eyes at the top of a build, a grin at the crowd's peak, a focus frown on a control, a brow flash for a good transition and a wince for a mistake. The show state eases the weights; a vocal opens and closes the mouth on a syllable pattern. Cheeks and chin are morph targets on the head and beard, so a modelled head can carry the same shape-key names.
253. **Parts say how they're held.** Each `Part` declares `hold` (knob, fader, jog, press or grip) and `turn()`, and the avatar picks the hand shape and the wrist's motion from them: a pinch that turns with the knob, fingertips riding a fader, a flat spread palm carried round with the record, an index tap on a pad. A new part type only needs to set `hold`.
254. **Hands are placed from the touching point.** The hand's orientation is solved in the avatar's own space (where the fingers point and the palm faces), and the wrist backs off from the point the hand touches. A control beyond arm's length makes the DJ lean in rather than stop short.
255. **Cueing has a hold.** While a channel is cued the left hand holds the headphone cup to the ear for two bars in every four; any control on that side takes the hand back.
256. **The game's hand is palm back, and the model is turned to match** (`src/character/modelBody.ts`). The code hand's fingers always curled towards its −Z, but its nails and thumb were drawn as if −Z were the back; they moved, so the palm faces down on the decks. The modelled body stands palms forward, so its hands and fingers turn half a turn about the arm to follow the game's, and each forearm takes half the twist between the elbow and the hand, since the rig has no twist bone. A forearm twist bone in the .blend would spread it more evenly.

## A detailed front row (2026-10-13)

257. **The front row is one more instanced chunk of the crowd, not a new system** (`src/three/venues/frontrow.ts`, `crowd.ts`). The 24 dancers nearest each booth (left–right distance weighted 0.6, so it favours the barrier line) move into their own chunk drawn from a detailed model (about 6k triangles: real eyes with lids and lashes, brows, lips, clumped hair, hands, jackets, hats, shades, glowsticks, fans and phones), with a `CROWD_FRONT` define on the same shader. It shares the skeleton, pose, roles, conga, thinning and LOD, and it replaces those people rather than adding to them: about +35k triangles and one draw call per crowd up close, and the low-detail model when far. Low quality has no front row.
258. **Outfit and kit choices are made in the vertex shader and passed down.** Hashing the seed per pixel speckled the clothes, because the seed's rounding varies across a triangle.
259. **Straps and harnesses are painted, not modelled**, to stay near 6k triangles a person (the close-up crowd model was already 4.6k). Kit a venue doesn't use is still in the mesh, hidden.
260. **Each venue's `look` picks what the front row wears** (club, dark, beach, festival, playa), so outfits suit the venue without new colour palettes.

## 3D menus: the board showroom and the tour globe (2026-10-14)

261. **A 3D menu gets its own small renderer** (`src/three/menu3d.ts`), not a corner of the stage's. It has its own canvas, scene and camera inside the dialog, lit like the stage (ACES, the room environment), and it stops and loses its context when the dialog closes. The stage behind a dialog already drops to a third of its frames, so the two don't fight, and nothing about the stage's camera, venue or post passes changes. Board geometry and materials aren't disposed one by one on close, because they're shared with the stage's board and a dispose event would make the stage upload them again; losing the context frees what the menu put on the GPU.
262. **The showroom builds the real boards** (`src/ui/BoardShowroom.ts`) with the same `buildBoard` as the stage, minus the cables (they'd hang off the plinth). Boards stand at real size unless wider than 1.25 m. The board you're on is built first and the rest one a frame, nearest first, so opening doesn't stall. Only the front board and its neighbours are drawn (two each way while the ring turns). The screens show a demo splash, since nothing drives them in the showroom.
263. **The showroom applies a board only on "Play on this"**, not on every click as the flat cards did, so browsing doesn't rebuild the stage's board behind the dialog. The grid still applies straight away.
264. **The globe uses the tour map's outlines, not map data** (`src/three/globe.ts`). The land is dots spread evenly over the sphere (a Fibonacci lattice) and kept where they fall inside the outlines; the cities' map positions convert back to latitude and longitude. City names are page elements placed over the canvas each frame, so they stay sharp and clickable, and they fade out round the back of the globe.
265. **Routes are tubes with a dash shader.** WebGL lines are one pixel wide, so each leg is a thin tube along a great-circle arc lifted in the middle (higher for the train, higher still for the jet), with the van's and train's dashes running along it and the newest leg drawing itself in.

## Lights as real machines (2026-10-14)

266. **Fixtures get bodies, built once and instanced** (`src/three/venues/fixturebody.ts`). A moving head is a base with an omega bracket and safety loop, a yoke that turns with the pan only, and a head that tilts in it (bezel, cooling rings, tilt hubs), with a sixteen-cell pixel ring round the lens that spins as a comet, faster as the room peaks. Strobes are a bare tube between end caps with guard rods, lit from every side because venues hang them at every angle. Blinders are a housing on a yoke bracket with each lamp a bulb in a reflector bowl that glows with it. Trusses carry a taped cable loom along one chord, coloured by vertex colour so it stays one draw call. About 1.6k triangles a moving head (it was about 130), so Ally Pally's 62 heads add roughly 90k; each rig adds two draw calls (yokes, rings) and each strobe group one (frames).

## Clean boards in every room (2026-10-13)

267. **No ambient occlusion on the board you're looking at** (`src/three/ao.ts`, `Stage.ts`). In the board views (Top-down, Performance, booth, zoomed sections) the occlusion is cleared out to just past the hardware's farthest corner and fades in over 0.8 m beyond, so the crowd and the room keep their contact shadows. On the desk the estimate was mostly noise from print, caps and bevels: smoky smudges round every jog and knob, only on GPUs fast enough to keep it on.
268. **Board metal is darker and a little rougher, and close up only light sources bloom.** Looking straight down, the platter rims, jog tops, tonearms and chrome caps reflected the venue's lights overhead at full strength: white rings and blobs that clipped and bloomed. Aluminium, platter metal, chrome and the jog alloy are now about 20 % darker (base reflectance 0x9ca1aa–0xa9adb5) with roughness raised by 0.04–0.08. The bloom threshold is 2.4× higher in the board views, so LEDs, pads and screens still glow but lit metal doesn't. The studio environment's overhead skylight is dimmed to 12 %, and the board's 1.6× environment boost applies to non-metals only.
269. **The deck light meters the board.** The exposure pass's 16 × 9 grid already measures the frame, so the deck light reads the cells under the board's rectangle on screen and comes up (to 2.6× at most, never below its set level) until that patch reaches a fixed level. Dark rooms between drops get a readable board, and a lit room is left as it was.
270. **Booth clutter keeps off the hardware.** The cup, bottle and laptop on a booth are tagged `deskProp`. When a board is set up, each one that overlaps the hardware slides out past its edge if that's within 14 cm, and is put away otherwise.
271. **Nobody stands in the booth in a crazy room.** `RoomKit.people` drops spots within 1.8 m either side of the decks and 1.4 m in front or behind, unless the room puts its booth somewhere else. The Cloud Room's crowd area also started behind the booth front.
272. **Board print is 1.4× the real silk-screen** (was 1.24×). At 1× and in board full screen it's about 6 px tall, which is readable. Zooming to a section makes it twice that.
273. **No hype dancers.** The two go-go dancers on podiums either side of the booth are gone, along with their Show → Party toggle (`HypeSquad`). The avatar's `hype` routine stays in `Avatar.ts`, unused.

## AI lyrics and karaoke (2026-10-13)

274. **Whisper in the browser, not a server.** The app has no backend and Air DJ already runs its model on the device, so lyrics do too: OpenAI's Whisper through Hugging Face's transformers.js (3.8.1, from jsDelivr like Air DJ's MediaPipe, so the app's own size doesn't change), in a worker. It's the only open speech model with word timestamps that runs in a browser at a usable speed. Word times come from Whisper's cross-attention (dynamic time warping over its alignment heads), so the `_timestamped` exports from onnx-community are tried first and the Xenova exports after. WebGPU with a full-precision encoder and a 4-bit decoder first, then WebAssembly with 8-bit weights; a model that loads but fails its first second of audio counts as failed.
275. **It listens to the vocal stem, only where someone sings.** The stems are filters, not source separation (there's no separation model small enough to ship), so the model hears the stems' vocal split: the centre of the mix with everything under 140 Hz cut. The existing vocal-activity scan picks the sung stretches (a low bar, 0.28, because missing a quiet vocal costs more than listening to a pad), padded half a second and merged across gaps under 1.5 s; stretches over 28 s are cut at their quietest point. With hardly any vocal found, it listens to the whole track. Skipping the instrumental parts is most of a dance track, which makes it faster and stops Whisper inventing words over the music.
276. **Cleaning up what Whisper hears over music.** Bracketed tags (`[Music]`, `(upbeat music)`), ♪, the stock lines it invents over silence ("Thank you for watching", subtitle credits), three or more words stamped at one instant (it looping) and a phrase repeated more than six times in a row (cut to four) are dropped. Lines break at a breath (over 0.5 s), at the end of a sentence, at a comma in a long line, and at nine words or five seconds.
277. **The language is Whisper's own guess, once per track.** transformers.js doesn't detect the language and defaults to English, so the worker runs the decoder for one token after "start of transcript" on the most sung window (that token is the language) and transcribes every window in it. You can pick it instead (Show → AI lyrics).
278. **The part you're about to hear comes first, and shows while it listens.** Windows run from the one under the playhead to the end, then from the start. What's been heard so far is kept apart from the track's lyrics and shown as karaoke (marked "AI · listening"), so a half-heard song is never saved; the finished lyrics are saved with the track, and a track it heard nothing in is marked so it isn't listened to again.
279. **Time with AI aligns your words to what it heard.** Needleman–Wunsch over the two word lists (a match scores by edit-distance similarity, so "gonna"/"going" and "ya"/"you" still match; skipping a word costs a little), matched words take the heard times and the rest share the gaps by syllables. Under a quarter matched means the lyrics are for another song, and nothing changes.
280. **It asks before downloading.** The first request opens the guide (what it does, how, the download size, that the music stays on the device, the settings), and nothing downloads until you press Turn on. After that it listens to every track loaded without lyrics, one at a time, and the worker (and the model's memory) goes after two minutes idle.
281. **Karaoke replaces the booth subtitle.** One lane per audible deck with timed lyrics (the two loudest), in deck order so they don't swap as the faders move; the louder is big, the other smaller and fading with its level. Each word's fill is a gradient clipped to the text, moved by `--p` every frame (only when it changes by half a percent). The next line moves up into place with a FLIP animation; a line after a gap of 3.5 s or more gets up to four beat dots at the deck's tempo. Reduced motion swaps lines in place.

## The venue globe and the walk out to the booth (2026-10-14)

282. **The two globes share one planet** (`src/three/planet.ts`): the stars, the atmosphere, the land dots, the pins, the names beside them and the turning (drag with a throw, scroll, turn a place to the front, drift). The World Tour globe and the venue globe each add only their own things on top: routes and the ride, or rings of rooms.
283. **Only the real clubs go on the map.** The career's own rooms (Bedroom, Basement, Rooftop…) have no real place, so they ride an orbit of picture cards instead of being pinned somewhere made up, and the secret rooms and your own rooms are portals further out. Pins are one per city (`src/three/venueMap.ts`), because Printworks and both Ally Pally rooms are a few kilometres apart and would sit on top of each other; clicking London again steps through its rooms.
284. **Picking a club leans in and fades the rings**, so the planet is the subject; picking a room in a ring turns that ring to the front and pulls back out. Going there dives the camera into the pin or picture and closes the dialog; the venue loads with its usual walk-in. With reduced motion (or camera motion off) there's no dive.
285. **The walk-out is its own small scene, not the stage's camera.** The corridor (`src/three/backstage.ts`) is a separate renderer in an overlay on the stage (the same `createMenuScene` as the menus), with its own copy of your avatar in a new `walk` mode. Nothing about the stage's camera, director or arrival changes: the walk-out ends, then `start()` runs as before and the venue's walk-in plays under the white-out as it fades. The stage drops to a third of its frames underneath while it plays.
286. **The walk-out's timing is plain maths** (`walkerZ`, `shotAt`, `doorOpen`, `flashAt`), tested for staying inside the corridor and off the avatar. The camera cuts from in front of you to behind you instead of orbiting round, because a corridor is too narrow to swing a camera through without passing through the walls or the avatar.
287. **The walk-out plays whenever a gig starts from the pre-gig screen or the daily challenge**, but not when "again" restarts a free set straight from the results. It's skippable with any click or key, and it has a Settings switch, since it's seven seconds before every set.

## Two modes for long nights: 16mm film and your set as a sculpture (2026-10-14)

You picked these from the visuals sketch page: a black-and-white film mode for deep minimal sets, and a sculpture of the whole set that grows through the night.

300. **Two more modes, in their own file** (`src/visualizer/modes5.ts`), registered like the others, so they're in the Visuals panel, the VJ remote and the auto VJ's pool: Black & White 16mm is calm, Your Set as a Sculpture is groove. The song looks offer the film to techno, house and chill tracks and the sculpture to techno, house and trance.
301. **The film is worked out as it looks on screen, then squared to light.** The player's output is linear light, so a backdrop at 0.13 came out light grey once the screen encoded it. Working in display terms (0 black, 1 white) and squaring at the end puts the blacks, the grain and the negative where they look right; the highlights still pass 1 so the bloom gives the halation.
302. **The film runs at 24 frames a second.** The rings' pose, the weave, the flicker, the grain and the dust only change on a new film frame, so the one-notch-a-beat turn (eased over the first fifth of the beat, then still) lands in two or three frames, like stop motion. The two rings are signed-distance tori, raymarched, with a backdrop in a pool of light that their soft shadow falls on.
303. **Its strobe and its negative follow Reduce flashing.** The build's shutter strobe uses the kit's `gate()` and `flashAmp()`, so it drops to once a beat at about a third of the depth. The drop's negative is a hard flip for one beat; with flashing reduced it fades in over three quarters of a beat, never goes all the way, and fades out over a beat and a half, to a dimmer white.
304. **A mode can say it's black and white** (`VisMode.mono`). While one plays, the drums, melody and vocal layers and the output pass's colour fringes ease out, and lyrics come in white. Coloured rings and ribbons over grainy black-and-white film looked wrong.
305. **The set's history is its own small pure module** (`src/visualizer/setHistory.ts`), one instance for the session, in memory only. The visual player feeds it every frame from the stage, whether the player is on screen or not, so the set is all there when the sculpture comes up.
306. **The audio features now carry each deck** (`Features.decks`): its track while it plays, its channel fader and crossfader gain, and its meter's peak before the fader (`Channel.peak`, the reading the meters already took that frame, so nothing is measured twice). A track is on past a gain of 0.05, so a deck only in the headphones doesn't count, and two decks on at once is a mix, the same rule the camera director uses. The deck list is live, not delayed with the rest of the features; a mix lasts many seconds, so it doesn't matter.
307. **Each track that's on gets four samples a beat**: the music's level, kick and bass, scaled by that deck's share of what's playing (its peak times its gain, against the loudest). The set has its own beat clock that runs only while something is on, so a gap between tracks leaves no gap in the sculpture. A ribbon ends six seconds after its track stops, so a quick fader dip doesn't start a new one.
308. **The path is a rising spiral that widens**, at a fixed 0.04 units a beat. Each turn is 0.9 wider and 1.6 higher, so a two-hour set is about a dozen turns of a wide funnel rather than a hundred turns of a thin needle. A test checks the turns never come close enough for braids and rungs to touch.
309. **A braid is two strands on opposite sides of the path**, twisting once every 16 beats, 0.3 out. Each new ribbon takes the strand opposite whichever track is on, so the outgoing and incoming tracks always braid. The braid opens and closes over about three beats as the second deck comes in and the first leaves, and the rungs turn with the strand.
310. **The colours are the songs' looks.** When a track becomes the lead, its look's colours reach the history and its ribbon eases to the look's main colour, or to another of its colours when the main one is too close to the ribbon before. Until then a track has a hue from its id.
311. **A budget of 12,000 samples, thinned oldest first.** Past it, the oldest finished ribbon still at the finest density has neighbouring samples merged (the level and bass averaged, the kick's peak kept), so density only falls with age, and the tracks playing keep full detail (only their older part is ever merged, if nothing else is left). The sculpture is one instanced draw of camera-facing segments, a rung and a stretch of spine per sample, at most about 24,000 instances, appended as samples arrive and rebuilt only after thinning.
312. **Lines stay even at any distance.** Segments have a world width with a pixel and a half as the least, and rungs that end up closer together on screen than they are wide share their light, so a ribbon doesn't turn into a white bar when the camera pulls back to the whole set.
313. **The caption is a canvas texture on the camera**, in JetBrains Mono like the CRT mode's type, dim enough that the bloom barely touches it: "Track 3", "Mixing 3 into 4", "The whole set · 6 tracks" when it pulls back, "Your set starts here" before anything plays.
314. **The sculpture's camera stays outside the spiral**, square on to the middle of the newest 192 beats and swinging about 50 degrees either way (wider when it pulls back). Orbiting freely round the tip put the camera inside the spiral late in a set, with older turns huge in the foreground; looking at the tip end on made a one-minute first track look like a stub.
