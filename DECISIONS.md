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
