# Deckhouse DJ

A DJ studio that runs in the browser. Pick a real-world style board — an entry-level controller, a flagship four-deck controller, a club rig of two media players and a four-channel mixer, or twin turntables with a battle mixer — and play it in 3D: every knob, fader, jog wheel, pad and button works. Load your own music, mix it, add effects and watch an audio-reactive visual player on the club's LED wall.

It opens ready to play: two generated demo tracks are already loaded on decks 1 and 2.

**No install:** download [`Deckhouse-DJ.html`](Deckhouse-DJ.html) and open it in Chrome or Edge. It is the whole app in one file, rebuilt with `npm run build:single`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (serve over http(s) or localhost)
npm test           # DSP, analysis, format and mixer tests
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

- PBR materials with a room environment map, real-time shadows from the booth light, bloom on LEDs and screens, printed faceplates.
- Each board comes in several finishes.
- Controls: drag knobs up/down (Shift for fine), drag faders, double-click to reset, scroll wheel over any control. Jogs have a capacitive top (scratch in vinyl mode) and an outer ring (pitch bend). Turntables have platter inertia with adjustable start/brake, slip-mat scratching (the platter keeps spinning under the record), tonearm needle drop, 33/45 and adjustable record wear (crackle, hiss, wow & flutter). Multi-touch works on touch screens.
- Hover-to-zoom: rest the mouse over a deck or the mixer and the camera moves in close so the controls are big and easy to grab; move off the board (or click the zoom chip) to pull back. The camera holds still while you're dragging a control. On touch screens, tap part of the board to zoom and tap again to zoom out. Switch it off with the Auto-zoom button on the stage.
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

### Visual player
Five GLSL modes: Warp Tunnel, Spectrum Matrix, Particle Galaxy, Wave Grid and CRT Monitor.

- Driven by sub-bass, kick, snare, vocal and high bands, locked to the master deck's beat grid, with drop detection.
- Post-processing: bloom, chromatic aberration, palette shifts, and camera shake that can be switched off.
- Shows on the club's LED wall and side screens, as picture-in-picture, or as a full-screen visual player.

### Control surfaces
- **Web MIDI**: hot-plug, MIDI learn (click any on-screen or 3D control, then move the hardware control), relative encoders and jogs, LED feedback, and mapping export/import. No brand-specific presets are included — map your controller with MIDI learn.
- **Keyboard**: `Z`/`X`/`C` cue, play and sync the left deck; `M`/`,`/`.` do the same for the right. `1–4 QWER` and `7–0 UIOP` are the pads, `[ ] \` move the crossfader, `↑ ↓` browse, `← →` load, `Shift+1…8` fire the sampler, and `?` in the app lists everything.

## Project layout

```
wasm/dsp.c                 C DSP core → WebAssembly (npm run build:wasm, needs clang with wasm32)
src/audio/                 engine, decks, channel strips, mixer, beat FX, sampler, recorder, worklets
src/analysis/              tempo/grid, key, waveform, PCM parsers, worker pool
src/library/               IndexedDB storage, tags, crates, search
src/three/                 stage, club scene, camera rig, board parts and presets
src/visualizer/            audio features and visual modes
src/ui/                    software panels and widgets
src/app/                   app shell, control registry bindings, keyboard
```

Every operable control is registered once in a control registry (`src/app/controlDefs.ts`). The 3D boards, the software panels, the keyboard and MIDI all drive controls through that registry by id, so every surface stays in sync.

The compiled WebAssembly is committed as `src/audio/wasm/dspWasm.ts`, so building the app doesn't need a C toolchain. Run `npm run build:wasm` after editing `wasm/dsp.c`.
