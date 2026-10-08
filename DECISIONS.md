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
