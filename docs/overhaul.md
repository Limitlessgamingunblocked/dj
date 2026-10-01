# Overhaul notes: simpler, smoother, more realistic

Working notes for the October 2026 pass. It made the app simpler to use, lighter to run and more realistic, without adding features. The venue research is in [venue-research.md](venue-research.md).

## How it was measured

There is no GPU in the build environment: Chrome runs WebGL through SwiftShader (software rendering on 4 CPU cores), so wall-clock frame times there are seconds per frame and say nothing about real GPUs. The numbers that carry over to real hardware are:

- **Draw calls and triangles per frame.** These come from `renderer.info` with auto-reset off, covering every render in a frame: the club, the visual player, the screen quad and the shadow map.
- **Render passes and their resolution**, which is the fill-rate cost.
- **Main-thread JavaScript per frame outside rendering** (engine, analysis features, UI updates).
- **Heap size, heap growth and allocation rate** over 20 s. Allocation rate is the sum of the positive heap deltas sampled every 250 ms, a proxy for garbage-collection pressure.

Probe: `perf.cjs` (Playwright). Conditions: 1280×800, medium quality, deck 1 playing, crowd energy fixed at 0.8, 20 s per venue and view. "perf" is the default board view; "wide" is the venue's signature camera.

## Baseline (before)

| Venue | View | Draw calls | Triangles | JS outside render (ms) | Heap (MB) | Alloc (MB/s) |
|---|---|---:|---:|---:|---:|---:|
| Warehouse | perf | 420 | 309k | 3.8 | 116 | 0.13 |
| Warehouse | wide | 466 | 311k | 4.9 | 115 | 0.20 |
| DC-10 | perf | 425 | 774k | 3.5 | 117 | 0.47 |
| DC-10 | wide | 205 | 724k | 4.5 | 118 | 0.14 |
| Boiler Room | perf | 413 | 434k | 2.4 | 119 | 0.29 |
| Boiler Room | wide | 190 | 391k | 2.8 | 118 | 0.18 |
| Berghain | perf | 418 | 910k | 2.7 | 123 | 0.20 |
| Berghain | wide | 496 | 913k | 1.5 | 117 | 0.18 |
| Printworks | perf | 447 | 1,160k | 1.6 | 118 | 0.17 |
| Printworks | wide | 196 | 1,108k | 1.7 | 119 | 0.13 |

What it shows:

- **The crowd dominates the triangle count.** About 1,700 triangles per dancer and several hundred dancers per venue gives 0.3–1.2M triangles per frame, nearly all of it people, whether they are 2 m or 60 m from the camera.
- **The board dominates draw calls.** Board views cost about 220 more calls than venue views, because every knob, button and LED is its own mesh.
- **Full-screen passes per frame:**
  - club: a 4× MSAA half-float render at up to 1.5× device pixel ratio, then bloom (5 mip levels), lens and output
  - visual player: render, lyrics text, bloom and final at 960×540
  - plus a 1024² shadow map and, at Boiler Room, the live-feed render every third frame
- **First render of a venue stalls on shader compilation.** The 95th-percentile frame after loading the warehouse took 13 s in SwiftShader; a real GPU is much faster, but it is still a visible hitch.
- **Garbage collection is not a problem** (0.1–0.5 MB/s, flat heap). A few per-frame allocations exist anyway: two colours per knob ring per frame, the camera presets rebuilt every frame in the idle performance sway, and a vector in the drone.
- **Main-thread work outside rendering is 1.5–5 ms per frame** under software rendering, mostly UI panel updates that rewrite the same values every frame.

## UI control inventory (before)

Each control is marked **M** (used while mixing), **O** (occasionally) or **R** (rarely).

**Top bar:** board picker (O) · venue picker (O) · Booth / Split / Visuals (O) · LIVE badge, Boiler Room only (status) · crowd meter (M, glance) · master BPM (M) · Rec (O) · MIDI (R) · Help (R) · Full screen (O).

**Waveform strip:** four deck rows (M); rows for empty decks still take space · zoom − / + (O).

**Deck panel**, one per side:
- track title and artist (M) · key chip (M) · deck-layer switch on four-deck boards (M) · lyrics 🎤 (R) · ⋯ menu with grid tools (R)
- BPM (M) · tempo % (M) · time (M) · tempo-range chip (O)
- overview waveform for seeking (M) · beat-phase LEDs (M)
- Cue · Play · Sync (M) · Master (O) · tempo fader with bend − / + (M)
- six pad modes (O) · eight pads (M for performers)
- the "Loops, key & stems" drawer (O): loop ½ / on / ×2 / in / out / reloop · beat jump · key ♭ / ♯ / match · six deck modes (key lock, slip, quantize, vinyl, reverse, censor) · four stem knobs and four stem presets

**Over the stage:** Auto-zoom (R once set) · camera menu (O) · show/hide deck panels (O) · zoom chip (contextual) · first-run hint · crowd call-outs · lyric subtitle.

**Dock tabs:** Library (M) · Set Builder (O) · Mixer & FX (M without a controller) · Lights & venue (O) · Sampler (O) · Visuals (O) · Settings, including MIDI (R).

**Duplicates:**
- venue: top bar and the Lights & venue tab
- MIDI: top bar and Settings
- Booth / Split / Visuals: top bar and the Visuals tab
- camera views: stage menu and Settings
- board: top bar and Settings

The everyday path (load, play, sync, EQ, crossfade) is spread over the deck panels, the 3D board and the Mixer tab.
