# Deckhouse DJ

A DJ studio that runs in the browser. Pick a real-world style board — from an entry-level controller to a four-player festival booth, a hybrid vinyl + media player rig or turntables with a rotary mixer — and play it in 3D: every knob, fader, jog wheel, pad and button works. Pick where you play — Circoloco @ DC-10 in Ibiza, Boiler Room in LA, Berghain, Printworks or the house warehouse — each with its own room, crowd and a light show of lasers, moving heads, strobes, blinders and CO2 that follows the beat. Load your own music, mix it, add effects and watch an audio-reactive visual player.

It opens ready to play: two generated demo tracks are already loaded on decks 1 and 2.

It also builds DJ sets: the **Set Builder** tab (SmartDJ) turns your library into an ordered, harmonically mixed set around the artists, labels or genres you pick, shaped to an energy arc, with transition guidance for every mix.

**No install:** download [`Deckhouse-DJ.html`](Deckhouse-DJ.html) and open it in Chrome or Edge. It is the whole app in one file, rebuilt with `npm run build:single`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (serve over http(s) or localhost)
npm test           # DSP, analysis, format, mixer and set builder tests
npm run build:single   # one self-contained HTML file in dist-single/
```

Serve `dist/` from `localhost` or any `https://` host. The single-file build (`npm run build:single`) also works when opened straight from disk. Current Chrome, Edge, Firefox and Safari are supported; Web MIDI needs Chrome, Edge or Opera.

## What's in it

### Boards (3D, Three.js)
| Board | Class | Decks |
|---|---|---|
| Starter Two | Entry-level 2-channel all-in-one controller | 2 |
| Pro Four | Flagship 4-channel controller with on-jog displays, centre screen, LED filter rings | 4 (layers) |
| Club Standard | Two media players with waveform screens + 4-channel club mixer | 4 (layers) |
| Vinyl Battle | Twin direct-drive turntables + 2-channel battle mixer | 2 |
| Festival Quad | Four media players (decks 3·1 · mixer · 2·4) + 4-channel mixer | 4 (one unit each) |
| Hybrid Booth | Turntables on decks 3/4 outside media players on decks 1/2 + 4-channel mixer | 4 (one unit each) |
| Rotary House | Twin turntables + walnut-cheeked 2-channel rotary mixer (no crossfader, no sync) | 2 |

- PBR materials with a room environment map, real-time shadows from the booth light, bloom on LEDs and screens, printed faceplates.
- Each board comes in several finishes, and every board carries old stickers and gaffer tape — drawn procedurally and aged (sun-faded, scratched, torn and peeling corners), placed only in free space so they never cover a control. Switch them off in Settings.
- On the one-unit-per-deck boards the software deck panels follow whichever player or turntable you touch.
- Controls: drag knobs up/down (Shift for fine), drag faders, double-click to reset, scroll wheel over any control. Jogs have a capacitive top (scratch in vinyl mode) and an outer ring (pitch bend). Turntables have platter inertia with adjustable start/brake, slip-mat scratching (the platter keeps spinning under the record), tonearm needle drop, 33/45 and adjustable record wear (crackle, hiss, wow & flutter). Multi-touch works on touch screens.
- Hover-to-zoom (zones per unit on the multi-unit rigs): rest the mouse over a deck or the mixer and the camera moves in close so the controls are big and easy to grab; move off the board (or click the zoom chip) to pull back. The camera holds still while you're dragging a control. On touch screens, tap part of the board to zoom and tap again to zoom out. Switch it off with the Auto-zoom button on the stage.
- Cameras: top-down, performance (drifts gently with the music when you're hands-off), first-person booth and club views, orbit/pan/zoom with damping, plus saved camera views.

### Audio engine
- Each deck is an AudioWorklet: Hermite-interpolated varispeed, position-locked scratching, motor start/brake, loops, slip mode, reverse/censor.
- A C DSP core compiled to WebAssembly (`wasm/dsp.c`) provides:
  - WSOLA time-stretching with independent pitch, used for key lock across ±6 % to ±100 % tempo ranges, pitch play and key shift
  - real-time stem separation. Median-filter harmonic/percussive separation is combined with spectral-band and stereo-centre masks to split vocal, drums, bass and melody. This is DSP, not a neural network, so expect some bleed between stems.
  - a pitch-shift beat FX
- Mixer: trim, 3-band isolator EQ with Linkwitz-Riley crossovers (+6 dB up to full kill), resonant LPF/HPF filter, bitcrusher, and log, linear or fast fader curves. The crossfader curve runs from a smooth blend to a scratch cut, with a reverse (hamster) option. Dual peak VU meters and a master limiter.
- Beat FX with a channel/master assignment matrix: echo, ping-pong, hall reverb, flanger, phaser, pitch shift, transformer. All are beat-synced to the grid.
- Sync: master/follower tempo lock with continuous phase correction. Quantized, phase-preserving hot cue jumps, loops from 1/64 to 64 beats, loop rolls, slicer, beat jump.
- Performance pads: hot cues (8 per deck, colours and names), roll, slicer, beat jump, pitch play and sampler.
- Sampler: 8 slots in one-shot or loop mode, with built-in synthesized sounds or your own audio.
- Headphone cue: split mode (master left, cue right) or a second output device where the browser allows it.
- Mix recording (WebM/Opus or MP4 depending on the browser).

### Library
- Import by drag-and-drop, file picker or folder. Accepts MP3, WAV, AIFF, FLAC, OGG/Opus and M4A/AAC. WAV and AIFF are parsed in workers; other formats use the browser decoder.
- Tags read from ID3v2, FLAC/Vorbis comments, MP4 atoms and RIFF INFO, including cover art.
- Analysis runs in a pool of Web Workers:
  - BPM from spectral flux and autocorrelation, refined by comb folding to about 0.01 BPM
  - beat grid phase and first downbeat
  - Camelot key
  - 3-band waveform (low red, mid green, high blue)
  - loudness for auto gain
- IndexedDB keeps your audio, analysis and cue points between visits.
- Crates inside nested folders, smart search (`bpm:120-128 key:8A artist:name`), BPM range, and highlighting of harmonically compatible tracks.
- JSON export/import of crates, cue points and beat grids.
- Beat-grid tools: tap tempo, ×2, ÷2, set downbeat, nudge grid.

### Set Builder (SmartDJ)
Builds a set from the analysed tracks in your library (or one crate). The library ships with 16 generated demo tracks by fictional artists on three fictional labels, so you can try it straight away with anchors such as `Kora Vance`, `Tidal Room` or `techno`.

- **Anchors**: artists, labels (ID3 `TPUB`, Vorbis `LABEL`) or genres. Tracks by anchor artists and labels come first, then tracks whose genre matches. Anchors that aren't in the library are reported.
- **Length**: a target in minutes (10–360) or a track count (2–100). Set time accounts for the overlap of each transition.
- **Energy arc**: Peak Time Hour, Warm-Up Sunset, Steady Energy Flow, or Peak & Drop Storytelling. Each track's energy (1–10) is estimated from loudness, tempo, rhythmic density and brightness, and ranked against the tracks you're building from so every arc can use your whole range.
- **Transitions**: quick cuts (4 bars; tempo and key may move more), smooth blends (16 bars) or long atmospheric blends (32 bars; keys and tempos must sit tight).
- **Discovery** (0–50 %): tracks by other artists that sound like the anchors — similar tempo, energy, genre words and keys — with a push towards tracks you've rarely played. This works on your own library; it does not search online catalogues.
- **Ordering**: a beam search scores every candidate step on Camelot-wheel compatibility (same key, ±1, relative major/minor, diagonal, energy boost), tempo distance (half/double time allowed), distance from the arc's target energy, anchor fit and artist variety.
- **Guidance** for every transition: mix length in bars, where to start the incoming track (the outgoing track's mix-out point, on a 4-bar phrase found from the waveform's intro/outro), pitch change to beat-match, key move (with a key-shift suggestion for clashes) and a 0–100 score. An energy chart compares the set with the arc.
- **Fine-tuning**: pin, swap (ranked alternatives for that slot), move, remove, re-roll (keeps pins, skips removed tracks). Timings and scores update after every edit.
- **Play it**: *Load first two* puts tracks 1 and 2 on the left and right decks; *Load next* feeds the following track into whichever deck isn't playing. *Write mix cues* stores each track's mix-in and mix-out points on hot cues G and H (pads that hold your own cues are left alone). *Save as crate* adds the set to Library › Sets.
- **Export**: rekordbox XML and Traktor NML (beat grid, key, mix-in/mix-out cues, playlist), M3U8 for Serato DJ, VirtualDJ and Engine DJ, a CSV cue sheet, and a plain track list with Spotify and Apple Music search links. The browser doesn't know where your files live, so give the export the folder that holds them (or relocate after import). Built-in demo tracks are left out of file exports.

The engine is in `src/setbuilder/` (profiling, harmony, arcs, generation, exports) and has no UI dependencies.

### Venues and light show
| Venue | What it is |
|---|---|
| Circoloco @ DC-10, Ibiza | Low red room, orange globe lamps over a packed floor, warm bulb strings, red laser sheets, the fan wheel on the wall, cream booth monitors, the crowd right at the booth |
| Boiler Room, Los Angeles | Outdoor night session: crowd all around (and behind) you with phones up, the red neon ring on its wires, City Hall behind, a hot lamp on a truss tower and the stream camera — whose monitor shows a live render of the shot. Try the “Stream cam” view |
| Berghain, Berlin | 18 m concrete hall, pillars, steel balcony, towering stacks, cold white beams, red work lamps and a strobe bank for the peak |
| Printworks, London | Colossal hall with three levels of gantries, a far-wall screen and the overhead rig of light bars and beams that lowers through the build-up and slams down on the drop; lasers, blinders and CO2 across the stage |
| Deckhouse Warehouse | Raised stage, 11 m LED wall with the visual player, truss of moving heads |

The real venues are fan-made recreations and are not affiliated with or endorsed by the clubs or promoters.

- The light show director reads the beat grid, energy, breakdowns and drops: moving-head patterns change every 8 bars, lasers (fan, tunnel, sheet, chase, crossfire) come in with energy and sheet over the crowd in breakdowns, build-ups get a strobe roll, and drops fire CO2, blinders and a bar of strobes.
- Lighting desk (Lights & venue tab): follow-the-music on/off, drop FX, palettes, laser mode and pattern, intensity, haze, and hold pads for strobe, blinders, lasers, blackout and CO2 — also on the keyboard (N, B, Y, `, T) and MIDI-learnable.
- All fixtures are instanced: volumetric beam cones, camera-facing laser beams, dotted LED strings, glowing globes, CO2 particle plumes, drifting haze and colour-washed fog.
- The crowd dances on the beat, puts hands up and jumps at the peak. A crowd meter tracks the room: it rises with the music, beat-locked blends and drops, and falls with trainwrecks and key clashes, with call-outs on the stage.
- Each venue has its own camera angles (over the shoulder, stream cam, balcony, gantry, from the crowd); you appear in the booth in those shots.

### Visual player
Ten GLSL modes: Warp Tunnel, Spectrum Matrix, Particle Galaxy, Wave Grid, CRT Monitor, Laser Show, Kaleidoscope, Strobe Geometry, Liquid Chrome and Fractal Flight.

- Driven by sub-bass, kick, snare, vocal and high bands, locked to the master deck's beat grid, with drop detection.
- Post-processing: bloom, chromatic aberration, palette shifts, and camera shake that can be switched off.
- Shows on the venue screens (the warehouse LED wall, the Printworks far wall), as picture-in-picture, or as a full-screen visual player.

### Control surfaces
- **Web MIDI**: hot-plug, MIDI learn (click any on-screen or 3D control, then move the hardware control), relative encoders and jogs, LED feedback, and mapping export/import. No brand-specific presets are included — map your controller with MIDI learn.
- **Keyboard**: `Z`/`X`/`C` cue, play and sync the left deck; `M`/`,`/`.` do the same for the right. `1–4 QWER` and `7–0 UIOP` are the pads, `[ ] \` move the crossfader, `↑ ↓` browse, `← →` load, `Shift+1…8` fire the sampler, `N`, `B`, `Y` and the backtick key hold strobe, blinders, lasers and blackout, `T` fires the CO2, and `?` in the app lists everything.

## Project layout

```
wasm/dsp.c                 C DSP core → WebAssembly (npm run build:wasm, needs clang with wasm32)
src/audio/                 engine, decks, channel strips, mixer, beat FX, sampler, recorder, worklets
src/analysis/              tempo/grid, key, waveform, PCM parsers, worker pool
src/library/               IndexedDB storage, tags, crates, search
src/setbuilder/            SmartDJ set generation: track profiles, key/tempo rules, energy arcs, exports
src/three/                 stage, camera rig, board parts and presets, stickers
src/three/venues/          venues, light show director, fixtures (beams, lasers, strobes, crowd…)
src/visualizer/            audio features and visual modes
src/ui/                    software panels and widgets
src/app/                   app shell, control registry bindings, keyboard
```

Every operable control is registered once in a control registry (`src/app/controlDefs.ts`). The 3D boards, the software panels, the keyboard and MIDI all drive controls through that registry by id, so every surface stays in sync.

The compiled WebAssembly is committed as `src/audio/wasm/dspWasm.ts`, so building the app doesn't need a C toolchain. Run `npm run build:wasm` after editing `wasm/dsp.c`.
