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

## Phase 2: performance changes

- **Crowd level of detail and culling.** Dancers are grouped into ~6 m chunks, each its own instanced mesh with padded bounds, so chunks off screen are skipped. Chunks beyond the detail distance swap to a low-detail model with the same skeleton and props: about a third of the triangles. Both models share one set of vertex buffers. The detail distance is 16 m on high, 12 m on medium and 8 m on low, scaled down further by adaptive quality.
- **Adaptive quality** (`src/three/quality.ts`, with unit tests). It watches frame times and steps through five levels: render scale 1 → 0.5, crowd detail distance down to 30 %, lens streaks off, the visual player at half rate on the venue screens, then no bloom inside the player. It steps down when more than a quarter of recent frames run over budget. It probes back up after a calm spell, and backs off twice as long whenever a probe fails. The Low/Medium/High setting is the ceiling; it can be switched off in Settings.
- **One fewer full-screen pass.** The lens effects (streaks, ghosts, drone distortion and blur), tone mapping, a new per-venue colour grade and the sRGB output now run in one pass (`LensOutputPass`) instead of a lens pass plus three's output pass.
- **Multisampling** is off on Low.
- **Shadows** from the booth light update every second frame.
- **The visual player** shrinks with the render scale while it's only on the venue screens.
- **No first-frame stall on venue or board switches.** Shaders are compiled with `compileAsync` against the composer's half-float target, and the club view holds its last frame until they're ready. Compiling against the screen would build tone-mapped variants the club never uses; that mistake briefly doubled the program count.
- **Per-frame allocations removed:**
  - knob LED rings now relight only when the value changes, and no longer create two colours per knob per frame
  - the idle performance sway no longer rebuilds every camera preset
  - the drone's look-ahead vector is reused
  - the CO2 tint colour is a constant
  - fixed light palettes are cached instead of rebuilt every frame
- **UI panels at 30 Hz.** Deck panels and the lyric subtitle update on even frames; the top bar, stage overlay and open tab on odd frames. The waveform strip stays at 60 Hz for smooth scrolling.
- **The audio engine keeps running when the tab is hidden.** Sync correction, loops and deck events run on a 50 ms timer while the render loop is paused.
- **Dialogs over the stage:** the club renders a third of the frames while one is open.
- **Fixes:**
  - The drone white-out is fixed preventively. CO2 sprites are capped at 260 px and fade out within 3 m of the camera; haze sheets fade near the camera and when seen edge-on; beam cones fade when the camera is inside them. The original white frame could not be reproduced on demand, either before or after the change.
  - The light show could crash on a negative bar number (before a track's first beat); the palette index is now always positive.

### After phase 2

Same probe and conditions as the baseline.

| Venue | View | Draw calls (before → after) | Triangles (before → after) |
|---|---|---:|---:|
| Warehouse | perf | 420 → 370 | 309k → 288k |
| Warehouse | wide | 466 → 417 | 311k → 292k |
| DC-10 | perf | 425 → 378 | 774k → 705k |
| DC-10 | wide | 205 → 160 | 724k → 692k |
| Boiler Room | perf | 413 → 362 | 434k → 408k |
| Boiler Room | wide | 190 → 136 | 391k → 307k |
| Berghain | perf | 418 → 371 | 910k → 338k |
| Berghain | wide | 496 → 453 | 913k → 370k |
| Printworks | perf | 447 → 401 | 1,160k → 248k |
| Printworks | wide | 196 → 178 | 1,108k → 484k |

Under software rendering the median frame time fell from 1.39 s to 0.54 s at Berghain, 1.70 s to 0.73 s at Printworks and 1.17 s to 0.58 s at Boiler Room wide. That isn't a real-GPU number, but it moves in the same direction as the vertex and fill savings. DC-10 and the warehouse gain least: their crowds stand right in front of the camera, so most chunks stay detailed by design. Shader programs after visiting several venues: 40–55 (baseline 43–69).

## Phase 3: simpler, cleaner UI

| | Before | After |
|---|---|---|
| Top bar | 10 controls (board, venue, Booth/Split/Visuals, MIDI, help, full screen, Rec, meters) | board, venue, crowd, master BPM, Rec, **Simple / Pro**, ⋯ menu (view, full screen, layout, MIDI, help); a MIDI pill only while a controller is connected |
| Deck panels | everything always visible | **Simple** (default): title, key, BPM, time, overview, Cue / Play / Sync, tempo. **Pro** adds master, tempo range, pad modes, pads, the loops/key/stems drawer and the 🎤 button. Lyrics stay reachable from the deck's ⋯ menu in both |
| Waveform strip | four lanes on four-deck boards, empty ones included | lanes for the decks on each side plus any other deck with a track |
| Over the stage | Auto-zoom, camera menu, show/hide panels | camera menu (with the auto-zoom toggle inside), show/hide panels |
| Dock | 7 tabs | 5: Library · Set Builder · Mixer & FX (sampler included) · Show (venue, lighting desk, visual player, lyrics) · Settings (MIDI included) |
| Duplicates | venue, MIDI, view and camera views each in two places | the camera-view buttons left Settings; the view switch moved into ⋯ (and the V key) |

**Design system.**
- The stylesheet is split into 15 component files, imported in the original cascade order; the build output was byte-for-byte the same size before the edits.
- Four dead rules removed.
- Tokens for an 8 px spacing grid, three radii, a five-step type scale, motion (easing and two durations) and control heights; buttons use them.

**Accessibility and touch.**
- Secondary text raised from 3.2:1 to 4.9:1 contrast.
- A brighter focus ring.
- Controls at least 44 px on touch screens (checked: none smaller on a 390 px phone).
- The camera's idle sway and beat shake stop when the OS asks for reduced motion, alongside the existing CSS rule.
- The Barlow Condensed weights 800–900 used by the lyrics and LED signs are now loaded.

**Phone layout (390 px).**
- A single-row top bar: logo mark, board, short venue name, a REC dot and ⋯.
- Deck panels stay stacked but are far shorter in Simple.
- Short tab labels, so all five tabs fit without scrolling.
- No horizontal overflow.
