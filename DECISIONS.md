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
