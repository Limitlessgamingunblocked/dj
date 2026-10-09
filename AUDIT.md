# Codebase audit: Deckhouse DJ → DeckHouse DJ career game

Stage 1 of the master build prompt (Section 0). Written against commit `deecbcb` on `claude/3d-dj-mixer-app-8tzoh3`, before any Stage 1 code.

## What the project is today

A browser DJ studio, not yet a game:
- you play real-style DJ hardware in 3D
- you mix real or demo tracks on a full audio engine
- the club around you reacts (lights, lasers, crowd, camera)

There's no career, character, naming or progression: you open it and play.

| | |
|---|---|
| Engine | No game engine. **TypeScript + Three.js r186** (WebGL2) for 3D, **Web Audio + AudioWorklet** for sound, with an optional **WebAssembly** DSP core (key lock, stems, pitch FX). Built with **Vite 7**, tested with **Vitest**. One runtime dependency (`three`). |
| Size | 31k lines of TypeScript in 133 files; 20 test files, 194 tests, all passing; `tsc --noEmit` clean. |
| Delivery | A normal Vite build, plus a **single self-contained HTML file** (`Deckhouse-DJ.html`, about 1.4 MB) that runs from disk and is published as a claude.ai artifact. That file has a 16 MB ceiling, which matters for 3D assets (see Section 14 below). |
| Persistence | `localStorage` (`deckhouse:*` keys: prefs, settings, lights, MIDI maps, saved views), checked on load by `sanitizePrefs()` and `settingsModel`. **IndexedDB** for the music library (audio blobs, analysis cache, crates). Settings export/import to a file. No save versions or migrations yet. |
| 3D assets | **Everything is procedural**: boards, venues, crowd and avatar are built in code from primitives, canvas textures and shaders. There are no model files, no Blender sources and no glTF loader in use. |

### Folder structure

```
src/
  main.ts              boot
  app/                 App shell (frame loop, tabs, wiring), Hype (crowd meter), Auto DJ, keyboard, control defs
  audio/               AudioEngine, Deck (worklet player), Channel, Mixer (+ limiter), Sampler, Recorder, synth (demo tracks), fx/BeatFX
  analysis/            worker pool, FFT, tempo + beat grid, key detection, waveform
  library/             IndexedDB library, crates, tag readers
  setbuilder/          SmartDJ set builder (energy arcs, harmony, exports)
  lyrics/              lyric formats, vocal alignment, demo lyrics
  midi/                Web MIDI with learn and saved mappings
  visualizer/          audio features, AV-sync delay line, visual player (10+ shader modes), kinetic lyrics
  three/               Stage (renderer + post), CameraRig, director, boards/parts/builder, lens + looks, exposure, quality
  three/venues/        7 venues + shared fixtures (beams, lasers, crowd, far crowd, pyro, confetti, mirror balls, LED, haze, light maps)
  core/                control registry, prefs, settings, backup, emitter, types, util
  ui/                  software panels (decks, mixer, library, show desk, settings, set builder…), widgets, modal, toast
tests/                 vitest suites
docs/                  venue research, overhaul and VFX notes (with measurements)
scripts/               build-single (one-file HTML), build-wasm
```

### What works (verified in this and earlier sessions)
- **Decks:** 2 or 4, with sync and phase lock, key lock, ±6–100 % tempo ranges, 8 hot cues, loops of 1/4–32 beats, loop roll, slicer, beat jump, slip, jog nudge and scratch, 4-band stems (WASM).
- **Mixer:** gain, 3-band EQ with kills, filter, channel faders, crossfader curves, split cue and headphone output, brickwall limiter. Beat FX: echo, ping-pong, reverb, flanger, phaser, pitch, gate. An 8-slot sampler with synthesised one-shots.
- **Library:** imports your own files with BPM, beat grid and key detection (Camelot / Open Key / musical), crates and folders, history, IndexedDB. **32 synthesised demo tracks** in 8 styles, by fictional artists.
- **3D boards:** 7 presets with finishes and stickers. Every knob, fader, jog and pad works, with hover zoom.
- **Venues:**
  - real rooms: DC-10, Boiler Room, Berghain, Printworks, Alexandra Palace arena and in the round
  - one fictional room: the Deckhouse Warehouse
- **Light show:** beat-locked and section-aware, with volumetric beams with gobos, lasers that stop on surfaces, strobes, blinders, CO2, pyro, confetti, mirror balls, LED walls and haze. Reduce flashing (under 3 Hz) is tested.
- **Crowd:** jointed GPU dancers with LOD, plus a far crowd of cut-outs (about 8,000 at Alexandra Palace). It reacts to energy, builds and drops, with phones, signs, VIPs, rim light and photo flashes.
- **Crowd meter (`Hype`):** rises with energy, beat-locked in-key blends and drops; falls with trainwrecks and key clashes; shows call-outs on stage.
- **Camera:** venue angles, 6 moving angles, drone FPV, an auto director that cuts on phrases and drops, 8 lens looks (fisheye, VHS, security, tilt-shift…), auto exposure, photo capture.
- **Post-processing:** bloom, anamorphic streaks, ghosts, lens dirt, starburst, grain, vignette, per-venue grade that follows the track.
- **Other systems:**
  - **Auto DJ:** beatmatched mixes on its own.
  - **Set Builder:** builds sets from your library around anchor artists, labels or genres, with energy arcs and exports.
  - **Lyrics:** shown as kinetic type.
  - **MIDI learn**, a remappable keyboard and a searchable Settings tab with export, import and reset.
  - **Adaptive quality:** low / medium / high.
  - **AV-sync delay**, so the lights land on the beat you hear.

### What's broken or weak (known)
- **Real artist names** appear in the Set Builder's style profiles (Chris Stussy, OMAR+, Cloonee, Prospa) and in its help text. Section 2.1 forbids this. **Fixed in Stage 1** (see DECISIONS.md).
- The **recorder** is audio-only (MediaRecorder: WebM/Opus or MP4). There's no WAV/MP3 export, no video and no replay buffer.
- **Timing isn't centralised.** Lights, crowd and camera all read the same deck beat grid (through the audio features), but each derives its own beat, bar and section logic. There's no `BeatClock` with events. **Addressed in Stage 1.**
- **No versioned save system.** Settings are sanitised on load, but there's no version number, migration or backup copy. **Addressed in Stage 1.**
- **Performance is only measured on software rendering** (SwiftShader in the container). Real-GPU frame times are unknown, and the 60 fps target (16.5) has never been verified.
- **The avatar is the same stylised jointed figure as the crowd** (cylinders and spheres posed in a shader). It can't be customised and it isn't a modelled character.
- **Effects gaps (from docs/vfx-master.md):** confetti doesn't collide with people, mirror-ball spots don't light people, and there's no pyro heat haze.

### Half-built
- **`Hype`** is the seed of the vibe meter (6.7). It already does blends, trainwrecks, key clashes and drops. It lacks slot targets, fatigue, variety, dead air, redline scoring and a score.
- **Auto DJ** is the engine for B2B rivals (6.10): it already picks compatible tracks and mixes them. It needs personalities and turn-taking.
- **Demo-track synthesis** is the seed of the original library (Section 7). There are 32 tracks in 8 styles with an arrangement, but no section-marker metadata, no tags or energy fields, and no stems as separate files. Several styles (techno, breaks) are outside the brief's lanes.
- **Venue `show.ts`** has a lighting-desk model, but no node wiring, macros or conditional triggers (13.9).

## Section-by-section mapping

**Exists** means the feature works today, though it may need restyling. **Partial** means some of it is built and the gaps are listed. **Missing** means it isn't there at all.

| § | Item | Status | Where / what's there | Gap |
|---|---|---|---|---|
| **2.1** | Musical identity | Partial | `audio/synth.ts`: deep minimal, rolling minimal, bouncy tech house and rave house styles at 118–134 BPM | Tag lanes to the brief; drop or re-skin techno and breaks; no stems as files |
| **2.2** | Palette and visual identity | Partial | Design tokens in `ui/styles`, per-venue palettes in `show.ts` | The brief's 7-colour palette isn't adopted; no flyer, VHS or disposable-camera art direction in the UI |
| **2.3** | Beat-locked lighting rules | Partial | Kick drives the washes; builds and drops are choreographed; breakdowns go soft; haze in every indoor venue | No hi-hat → pin-spot mapping; vocals → DJ spotlight missing; lighting doesn't scale with a vibe meter (it uses hype) |
| **2.4** | Post-processing | Partial | Bloom, grain, vignette and VHS look all exist | Chromatic aberration only on drops isn't done; there's no per-effect toggle (one quality level only) |
| **2.5** | Six camera shots | Partial | Over-the-shoulder ("perf"), crowd POV, wide, booth fisheye, crane, drone; auto director | A named "breakdown orbit" and a "drop punch-in" with toggleable shake are missing as named shots |
| **2.6** | Voice of the game | Partial | Call-outs and toasts are short | Copy needs a pass to the brief's voice |
| **3** | Naming scene, NameService, name everywhere | Partial (Stage 2A) | `src/name/`, `ui/NamingScene.ts`, naming room; booth panels, neon, LED walls, crowd sign, stickers, top bar, chants | Filter word list; surfaces that wait on later systems (lasers, flyers, results, recordings, merch, outdoor venues) |
| **4** | Character creator, wardrobe, outfits | Built in code (Stage 2B) | `src/character/` (catalogue, looks, procedural avatar), `ui/CharacterCreator.ts`, dressing room venue; your character at the decks in every venue | Modelled character, hair and outfits (Blender, Section 14); dress-code bonus applied by the vibe meter (Stage 3); looks in recordings (Stage 4) |
| **5.2** | Venues (Bedroom → Sunrise) | Partial | The Warehouse exists (Deckhouse Warehouse), plus 6 real-world rooms that aren't in the brief | Bedroom, Basement, Rooftop, Beach Club, Boat, Festival and Sunrise are missing; no signature moments, unlock conditions or venue acoustics |
| **5.3** | Set slots | Missing | — | Slot target curves and scoring |
| **6.1** | Assist levels | Missing | Sync exists | Chill / Club / Pro modes and the Pro multiplier |
| **6.2** | Deck anatomy | Exists | `audio/Deck.ts`, `ui/DeckPanel.ts`, `ui/waveform.ts` (RGB frequency waveform) | Default range is ±8 % with a ±16 % option; matches |
| **6.3** | Mixer | Exists | `audio/Channel.ts`, `audio/Mixer.ts` | — |
| **6.4** | Beatmatching and phase meter | Partial | Phase lock in `AudioEngine`; phase display in `WaveStrip` | No 10 / 30 / 50 ms scoring bands; no audible flam feedback |
| **6.5** | Harmonic mixing | Partial | Camelot keys; compatibility used by the library, deck panel, Hype and Auto DJ | No "glow in crate" in Club mode; no bonus or penalty in a score |
| **6.6** | Transition recognition | Partial | `Hype` detects clean blends and wrecks | No named techniques (bass swap, filter fade, echo out, loop roll, quick cut, double drop) or scores |
| **6.7** | Vibe meter | Partial | `app/Hype.ts` | Slot match, fatigue, variety, drop spacing, dead air and redline are missing; it doesn't drive camera energy or signature moments |
| **6.8** | Crate digging | Exists | `ui/LibraryPanel.ts`, crates, search, sort, pre-listen | Energy 1–10 and the brief's tag set; favourites |
| **6.9** | Set lengths, results screen, encore | Missing | — | — |
| **6.10** | B2B rivals | Missing | Auto DJ is the base | Personalities, turn-taking, chemistry |
| **6.11** | Mistakes and recovery | Partial | Trainwreck call-outs; crowd groans | Dead-air detection, sound-engineer NPC, comeback bonus |
| **7.1–7.2** | 40+ original tracks with metadata and markers | Partial | 32 synthesised tracks, fictional artists | 8+ more; section markers, energy and tags; brief-lane balance |
| **7.3** | Import your own music | Exists | `library/` (BPM, grid, key detection, kept local in IndexedDB) | Mark imported tracks clearly in game mode |
| **7.4** | Sample packs | Partial | Air horn, siren, laser, impact, riser one-shots | Vocal chops, claps, stabs, crowd cheers |
| **8.1** | Crowd simulation, LOD, states | Partial | `venues/crowd.ts` (LOD), `farcrowd.ts` (instanced cut-outs); arms up, jumps, claps, phones; beat-synced | Explicit cold → euphoric states from a vibe meter; groans, "whoa"; 40,000 is untested (8,000 today) |
| **8.2** | Recurring crowd characters | Missing | Sign holders and VIPs are generic | — |
| **8.3** | Crowd sound | Missing | — | No crowd audio at all |
| **8.4** | VIP crew | Partial | VIP guests by the booth (drinks, filming) | Doesn't grow with fame; no handing drinks, no celebration |
| **8.5** | NPCs (promoter, lighting tech, sound engineer…) | Missing | — | — |
| **9** | Currencies, tiers, bookings, reputation, milestones, feed, hub | Missing | — | Everything (Stage 6). Stage 1 adds the save model for it |
| **10.1** | Design system | Partial | Tokens, shared widgets, beat-pulsing meters | Brief palette and type; chrome treatment |
| **10.2** | Screens | Partial | Studio screens (decks, mixer, library, show, settings, set builder) | Title, name entry, creator, hub, pre-gig, results, My Sets, trim, board builder, wardrobe, bookings, feed |
| **10.3** | In-gig HUD with clean view | Partial | Stage-focus layout; full-screen camera bar | Vibe meter, set timer, REC/buffer dot, clean-view toggle |
| **10.4** | Juice | Partial | Pads, knobs and faders animate; toasts | UI sounds |
| **10.5** | Input | Partial | Mouse, keyboard (remappable), touch on the software UI, MIDI | Gamepad; touch on the 3D board |
| **11** | Recording studio | Partial | `audio/Recorder.ts`: audio only, WebM/Opus | WAV / MP3 export, video, booth cam, quality, overlays, cover art, tracklist, My Sets, storage (Stage 4) |
| **12** | Replay buffer, Save That Mix, trim editor | Missing | — | Stage 4 |
| **13** | Board Builder | Partial | 7 presets built from modular parts (`three/builder.ts`, `parts.ts`), finishes, stickers; every control works | The editor, inspector, add-ons, node wiring, sharing and the board file format are all missing (Stage 5) |
| **13.10** | Hardware mapping | Partial | MIDI learn with saved mappings, keyboard remap | Gamepad; per-board profiles |
| **14** | Blender pipeline and models | Missing | No Blender, no connector, no model files | Folders, export scripts and loader added in Stage 1; **modelling is blocked on Blender access** (see the questions at the end) |
| **15** | Audio engine quality | Partial | Worklet engine, limiter, WASM key lock, tempo-synced FX, split cue, output latency shown in Settings | No latency calibration tool; no bitcrusher or roll FX; no venue acoustics or crowd layer; redline signal added in Stage 1 |
| **16.1** | Module structure | Partial | AudioEngine, Venue/Lighting (`venues/`), Crowd, Input (`core/controls`, `midi`, `keyboard`) exist | BeatClock and SaveSystem added in Stage 1; the rest map to later stages (see "Module map" below) |
| **16.2** | BeatClock and events | Missing → **Stage 1** | — | — |
| **16.3–16.4** | Versioned data models, saving, migration, backup | Missing → **Stage 1** | — | — |
| **16.5** | Performance targets and quality presets | Partial | Low / Medium / High plus adaptive stepping | Ultra; worst-case festival profiling on real hardware |
| **16.6** | Tests and debug menu | Partial | 194 tests (audio, analysis, show, lasers, exposure, AV sync…) | Debug menu → **Stage 1** |
| **17** | Settings and accessibility | Partial | Reduce flashing (on with the system's reduced-motion setting), camera-motion toggle, UI scale, full key remap | First-launch flashing warning, colour-blind modes, high contrast, subtitles, volume buses, latency calibration |
| **18–19** | Quality bar, stages | — | — | Process, not code |

## Module map (Section 16.1)

| Module | Today | After Stage 1 |
|---|---|---|
| `BeatClock` | Spread across `AudioFeatures` + `show.ts` + `director.ts` | `src/core/BeatClock.ts`, the one source of beat / bar / phrase / section events |
| `AudioEngine` | `src/audio/AudioEngine.ts` (+ Deck, Mixer, Channel, Sampler, BeatFX) | + a master redline signal |
| `NameService` | — | Stage 2 |
| `CharacterSystem` / `WardrobeSystem` | — | Stage 2 |
| `VenueSystem` | `src/three/venues/` (base, index, 7 venues) | Stage 3 / 6 add the brief's venues |
| `LightingSystem` | `src/three/venues/show.ts` + fixtures | Stage 3 moves it onto BeatClock events |
| `CrowdSystem` | `crowd.ts`, `farcrowd.ts`, `app/Hype.ts` | Stage 3 |
| `VibeMeter` | `app/Hype.ts` (partial) | Stage 3 |
| `RecordingSystem` / `ReplayBuffer` | `audio/Recorder.ts` (partial) | Stage 4 |
| `BoardBuilder` | `three/boards.ts`, `builder.ts`, `parts.ts` (presets only) | Stage 5 |
| `InputMapping` | `core/controls.ts`, `app/keyboard.ts`, `midi/MidiManager.ts` | Stage 5 / 7 (gamepad) |
| `ProgressionSystem` | — | Data model in Stage 1; system in Stage 6 |
| `SaveSystem` | `core/settings.ts`, `prefs.ts`, `backup.ts`, `library/db.ts` (unversioned) | `src/core/SaveSystem.ts` + `src/core/models.ts` (versioned, migrations, backup) |
| `UISystem` | `src/ui/` (+ tokens) | Grows every stage |
