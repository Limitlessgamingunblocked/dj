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

- **The crowd dominates the triangle count.** About 1,220 triangles per dancer (counted per mesh after the fact; an earlier estimate said 1,700) and several hundred to about a thousand dancers in view gives 0.3–1.2M triangles per frame, nearly all of it people, whether they are 2 m or 60 m from the camera.
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

- **Crowd level of detail and culling.** Dancers are grouped into ~6 m chunks, each its own instanced mesh with padded bounds, so chunks off screen are skipped. Chunks beyond the detail distance swap to a low-detail model with the same skeleton (and no phone torch): 579 triangles against 1,220, a little under half. Both models share one set of vertex buffers. The detail distance is 16 m on high, 12 m on medium and 8 m on low, scaled down further by adaptive quality.
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

Measured with `count.cjs`: the mean of eight two-frame windows per venue and view, with the venue's shaders compiled first. The first version of this table took a single two-frame sample with `perf.cjs`, and some of its figures were off by up to 40 % (it showed 338k triangles for Berghain's board view; the steady figure is 551k). The pre-overhaul build gives exactly the baseline figures under the new counter, so the columns compare like with like.

| Venue | View | Draw calls (before → after) | Triangles (before → after) |
|---|---|---:|---:|
| Warehouse | perf | 420 → 369 | 309k → 287k |
| Warehouse | wide | 466 → 417 | 311k → 292k |
| DC-10 | perf | 425 → 378 | 774k → 705k |
| DC-10 | wide | 205 → 160 | 724k → 679k |
| Boiler Room | perf | 413 → 362 | 434k → 408k |
| Boiler Room | wide | 190 → 136 | 391k → 307k |
| Berghain | perf | 418 → 371 | 910k → 551k |
| Berghain | wide | 496 → 453 | 913k → 499k |
| Printworks | perf | 447 → 401 | 1,160k → 368k |
| Printworks | wide | 196 → 192 | 1,108k → 562k |

Under software rendering the median frame time over 20 s fell from 1.39 s to 0.54 s at Berghain, 1.70 s to 0.73 s at Printworks and 1.17 s to 0.58 s at Boiler Room wide. That isn't a real-GPU number, but it moves in the same direction as the vertex and fill savings. DC-10 and the warehouse gain least: their crowds stand right in front of the camera, so most chunks stay detailed by design. Adaptive quality never engaged in these runs: it ignores frames slower than 250 ms, and every software-rendered frame is slower than that.

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

## Phase 4: realistic venues and environment

The research doc's ranked gaps were the spec; [venue-research.md](venue-research.md#what-phase-4-changed) lists what was done against each one.

**Rendering.**
- **Tone mapping per venue.** The same frames were rendered with ACES and AgX. AgX rolls saturated lights off towards white the way a camera sensor does, and keeps detail in the shadows; ACES pushes saturated colours further and keeps deeper blacks. The warehouse, Printworks and Boiler Room use AgX, because their look comes from footage. Berghain and DC-10 keep ACES, because both are meant to be near-black rooms; under AgX, DC-10's red walls came out of the dark. Switching recompiles only the output shader, because the scene renders to a float target without tone mapping.
- **Per-venue colour grade** in the output pass: a white-balance tint, contrast, saturation and black level. Contrast and black level work in display gamma around 0.4. The first version pivoted at 0.5 in linear light, which crushed every dark tone and halved the brightness of every venue; the before/after screenshots caught it.
- **Surface detail.** Concrete, plaster, paving and painted floors get procedural normal and roughness maps (`surfaceData` / `withSurface` in `tex.ts`, with unit tests). The maps are tileable, 256 px, from a height field of undulation, aggregate pits, formwork seams and worn, polished patches, so lights catch relief and floors shine unevenly.
- **Contact shadows.** A soft dark patch under every dancer, one instanced draw per crowd.
- **Dust** drifting through the booth light: 320 points, one draw, visible only within a few metres of the camera. It's left out at the open-air Boiler Room, where it read as stars.
- **Haze.** Phase 2's edge-on fade, added against the drone white-out, also emptied the distant haze. It now only hides sheets seen almost exactly edge-on.
- **Ambient occlusion was not added.** The crowd is posed in the vertex shader, and GTAO's normal pass would see every dancer in the rest pose; the contact shadows cover the most visible case, the floor under people.

**Venues** (details and sources in the research doc).
- **Berghain:** the stage is gone and the booth is recessed into a niche in the back wall. A single fixed light bar spans the room. The stacks moved to the corners. There's a dim bar in the far corner and exit signs. The lasers and the VIP guests are gone. Bare concrete with relief throughout.
- **Printworks:** the hall is 112 m long instead of 68 m, with gantries and columns the full length. Dark, part-lit presses line both sides; 17 cold LED strips run up each side wall; press outlines are marked on the floor. There are bars and exits at the far end and a sparser crowd at the back.
- **DC-10:** the "circoloco" lettering is replaced by an unbranded slat panel, including on the venue card. The ceiling is lower (4.8 m) and the fill darker. Left/centre/right speaker clusters replace the line arrays. A whitewashed doorway glows onto the terrace. There's a bar on the right wall, and the hanging booth monitors are on drop rods.
- **Boiler Room LA:** the lettering on the ring is removed (and from the card), and so are the lasers. A light-polluted LA sky; matte concrete paving.
- **Warehouse:** block walls and a ceiling close in the room. Steel pillars carry LED battens that chase with the show. There's a polished floor, a bar and exit signs.
- **Every booth** now carries a laptop on a stand, drinks, a cable run and gaffer tape.

**Cost.** Steady counts (`count.cjs`, medium quality) against phase 2:

| Venue | View | Draw calls (phase 2 → 4) | Triangles (phase 2 → 4) |
|---|---|---:|---:|
| Warehouse | perf | 369 → 382 | 287k → 282k |
| Warehouse | wide | 417 → 441 | 292k → 294k |
| DC-10 | perf | 378 → 386 | 705k → 704k |
| DC-10 | wide | 160 → 165 | 679k → 663k |
| Boiler Room | perf | 362 → 364 | 408k → 408k |
| Boiler Room | wide | 136 → 137 | 307k → 307k |
| Berghain | perf | 371 → 379 | 551k → 553k |
| Berghain | wide | 453 → 439 | 499k → 497k |
| Printworks | perf | 401 → 413 | 368k → 363k |
| Printworks | wide | 192 → 251 | 562k → 748k |

- The new details move draw calls by −14 to +24 per view, and triangles by less than 3 %.
- The exception is Printworks' gantry view, which now looks down a hall nearly twice as long, with about 320 more dancers in it (at low detail, 579 triangles each). That view is still a third below its pre-overhaul cost.
- The first cut of contact shadows used one mesh per crowd chunk, which doubled the crowd's draw calls (+142 in that view). Folding them into one draw per crowd fixed it.
- Switching venues back and forth twice settles at 80–86 shader programs, with a flat heap (125 MB): nothing accumulates.

## Before and after: the whole overhaul

**Hardware.** A cloud container with no GPU: an Intel Xeon at 2.80 GHz (4 cores), 15 GB RAM, headless Chromium 141 with WebGL through SwiftShader (software rendering). Wall-clock frame times here are a second or more per frame and don't predict a real GPU, so the table shows the counts that do carry over. These figures have not been checked on real GPU hardware.

**Method.** `count.cjs` at 1280×800, medium quality, deck 1 playing, crowd energy 0.8, adaptive quality off (full detail, the worst case). Each figure is the mean of eight two-frame windows, after the venue's shaders have compiled; the spread is about one draw call and a few thousand triangles at most. "Before" is the frozen pre-overhaul build; "after" is the final code.

| Venue | View | Draw calls | Triangles |
|---|---|---:|---:|
| Warehouse | perf | 420 → 382 (-9 %) | 309k → 282k (-9 %) |
| Warehouse | wide | 466 → 441 (-5 %) | 311k → 294k (-5 %) |
| DC-10 | perf | 425 → 386 (-9 %) | 774k → 704k (-9 %) |
| DC-10 | wide | 205 → 165 (-20 %) | 724k → 663k (-9 %) |
| Boiler Room | perf | 413 → 364 (-12 %) | 434k → 408k (-6 %) |
| Boiler Room | wide | 190 → 137 (-28 %) | 391k → 307k (-21 %) |
| Berghain | perf | 418 → 379 (-9 %) | 910k → 553k (-39 %) |
| Berghain | wide | 496 → 439 (-11 %) | 913k → 497k (-46 %) |
| Printworks | perf | 447 → 413 (-8 %) | 1,160k → 363k (-69 %) |
| Printworks | wide | 196 → 251 (+28 %) | 1,108k → 748k (-32 %) |

Printworks' gantry view is the one rise in draw calls. It now looks down a hall nearly twice as long, with more crowd chunks, presses and LED strips in view, and its triangles are still down by a third.

Also:
- **One fewer full-screen pass**, on every frame.
- **No first-frame stall** when switching venues or boards.
- **No multisampling on Low.**
- **Shadows** update every second frame.
- **UI updates at 30 Hz**, with no redundant DOM writes.
- **Hidden tab:** no rendering while the tab is hidden.
- **Allocation:** 0.1–0.5 MB/s and a flat heap, unchanged.
- **Shader programs:** visiting all five venues ends at 86 programs, against 69 before. The new normal-mapped surfaces, details and dust add variants. Switching back and forth levels off rather than growing.

## Alexandra Palace (added after the overhaul)

There are two new venues: the Great Hall as an arena show, and in the round. Same counter and conditions as above (`count.cjs`, medium quality, adaptive quality off), with Printworks for comparison.

| Venue | View | Draw calls | Triangles |
|---|---|---:|---:|
| Alexandra Palace | perf | 444 | 668k |
| Alexandra Palace | wide (from the stage) | 184 | 162k |
| Alexandra Palace | crowd | 485 | 636k |
| Alexandra Palace · In the round | perf | 392 | 472k |
| Alexandra Palace · In the round | wide (organ gallery) | 457 | 406k |
| Alexandra Palace · In the round | crowd | 429 | 632k |
| Printworks | perf / wide / crowd | 413 / 251 / 469 | 373k / 748k / 418k |

How it stays in budget:
- **The far crowd.** About 8,000 people would be close to 10 million triangles as jointed dancers. The 516 jointed dancers at the front (493 in the round) are joined by 7,450 (7,900) animated cut-outs in one instanced draw at two triangles each.
- **The lights field.** 43,125 bulbs are one point draw, with every pattern in the vertex shader. The 8,600 cords were dropped: as one-pixel lines they aliased into bright streaks.
- **The IMAG towers.** The live pit camera renders every fourth frame (15 fps on a 60 Hz display). It sees the decks, which cost a couple of hundred draws.
- **Merged geometry.** Speaker hangs, sub lines and doors are merged meshes. A flown hang built from separate cabinets costs two draws per box, and this hall has about 90 boxes.

The arena's average includes the IMAG camera on a quarter of the frames, so its perf and crowd figures spread by about ±36 calls across samples.

## Lasers and effects pass (Alexandra Palace)

A pass to make lasers and effects look like a real arena show on camera, starting with the two Alexandra Palace venues. The research is in [venue-research.md](venue-research.md#lasers-and-effects).

**How it was judged.**
- **Show moments.** A test-page patch forces the light show into a breakdown, the top of a build-up and the first bar of a drop. Captures were taken of every view, before and after, plus frame strips through a drop.
- **The patch isn't production code.** It overrides the audio features the show reads.
- **Frame strips don't show real time.** Software rendering runs at about one frame a second while the music plays in real time, so a strip covers several bars.

**Lasers** (`src/three/venues/lasers.ts`, shared by every laser venue):
- Beams only show where there's haze. A shared haze field (`atmos.ts`) is used by lasers, moving-head beams and haze slices alike, so beams brighten in the clumps and thin in clear pockets as clouds drift through.
- Each beam has a hard core, a faint halo, a slight red/blue fringe and slight divergence, and shimmers like a scanned beam.
- Beams end where they hit the room (floor, walls, ceiling or the barrel vault, and solids such as the LED wall and the organ gallery) and leave a dot. The hit test is analytic, against a proxy of the room, and unit-tested.
- Sheet looks are real planes of light between neighbouring beams: liquid sky, sheets, waves and tunnel cones.
- Every beam stays at least 3 m above the floor over the crowd. This follows the common practice described in the research; there's no audience scanning. It's unit-tested.
- Looks ease in: fans open and beams sweep to their new places.
- Projectors take part by tier. The liquid sky comes from low projectors, the starfield from high ones, and a projector can sit a look out.

**Looks.** There are 13 now (8 new: fan with gaps, liquid sky, wave, converge, rotating fan, burst, strobe fan, starfield). A tested scheduler picks them from the track:
- quiet stretches get slow, sparse looks
- a build goes liquid sky → tunnel → every projector closing in on one point
- the drop is a burst
- the peak gets a new busy look every 4 bars
- a hook line landing also bursts

The Show tab lists every look. Auto, the Y key and MIDI learn work as before.

**Rigs:**
- Alexandra Palace, arena (14 projectors): the stage lip, stands at the stage corners (for the liquid sky), high upstage beside the wall, the audience trusses, the side walls mid-hall, and the mix position firing back at the stage.
- In the round (12 projectors): a ring on the riser firing up through the light field, plus the grid corners and both ends.
- Printworks and the warehouse: lasers moved onto stands, so they fire over heads.

**Haze and light that lands on things:**
- **Floor light map** (`lightmap.ts`). Each frame the venue paints a small top-down map of the light on its floor: moving-head pools, the LED wall's spill, blinders, the light field's glow, its kick ripples and drop shell, and strobes. The floor, the jointed dancers and the far crowd all read it, so beams sweeping the room light the people where they land. The far crowd's procedural pools are gone where a map exists.
- **LED wall spill.** The wall's actual average colour is read back without stalling (4×4, every sixth frame) and drives a spill light and the map.
- **Haze tiers.** Low keeps the horizontal sheets. Medium and High use camera-facing slices in one instanced draw, so haze reads as a volume from any angle; High lights the slices from the pools below. One slice draw replaced six or seven sheet draws.
- **Stage hazers** puff clouds that roll out over the crowd (Medium and High).
- **Moving-head beams** use the shared haze, with gobo breakup and dust in the light (dust is off on Low).
- **Bloom on drops** is eased back in every venue: glow, not fog.

**Screens, the light field, the drop:**
- **LED wall and IMAG towers** show:
  - pixel structure up close, fading out before it can alias
  - tile seams
  - dimming off-axis, and enough brightness to bloom
  - the pit camera composited into the wall through the peak, and a flash on the drop
- **IMAG** cuts between four cameras on the phrase (pit close-up, long lens from the mix position, crowd camera from the stage, side of stage), with a slow zoom drift, a light broadcast grade, and monochrome through build-ups.
- **The light field** adds rain down the strings, a band breathing with the energy, a shell of light bursting from the booth on the drop, planes turning through the volume at the peak, per-bulb tints, halos and a lift from the crowd meter.
- **The drop** is choreographed and tested: the last beat of a build drops to near-black, then the laser burst, CO2, sparks, blinders, wall flash and crowd jump land together.

**Reduce flashing** (Show tab). It's on by default when the system asks for reduced motion, and saved with the other light settings:
- strobes, blinders, laser blinking and field sparkle stay under 3 flashes a second, and no one-second window ever holds more than 3 (tested)
- flashes are softer
- there's no blackout before the drop

**Cost.** Steady counts (`count.cjs`, medium quality, adaptive quality off), before and after the pass:

| Venue | View | Draw calls | Triangles |
|---|---|---:|---:|
| Alexandra Palace | perf | 444 → 492 (+11 %) | 668k → 705k |
| Alexandra Palace | wide | 184 → 183 | 162k → 166k |
| Alexandra Palace | crowd | 485 → 540 (+11 %) | 636k → 713k |
| Alexandra Palace · In the round | perf / wide / crowd | 391 / 457 / 429 → 393 / 458 / 430 | 469k / 406k / 632k → 477k / 411k / 637k |
| Printworks | perf / wide / crowd | 413 / 251 / 469 → 411 / 248 / 467 | unchanged |
| Warehouse | perf / wide / crowd | 384 / 441 / 450 → 383 / 440 / 449 | unchanged |
| DC-10 | perf / wide / crowd | 386 / 165 / 464 → 384 / 163 / 462 | unchanged |
| Berghain | perf / wide / crowd | 379 / 439 / 403 → 374 / 434 / 398 | unchanged |
| Boiler Room | perf / wide | 364 / 137 → 364 / 137 | unchanged |

- Every view is within the +15 % budget set for the pass.
- **Alexandra Palace's rise** comes from the IMAG cameras' new wide shots (long lens and crowd camera), which draw more of the hall on the quarter of frames that render the feed. The new lasers, light map, haze slices and hazers are a few draws each.
- **Boiler Room's crowd view** (473 → 398) is sampling noise from its own stream-camera feed, which already varied by ±76.
- **Fill.** One extra full-screen-ish pass was added: the 128×256 light map, plus two tiny reads for the wall colour. Haze slices are full-screen additive quads: 7 on Medium, 12 on High.
- **Not measured.** Real-GPU fill rate couldn't be measured here (software rendering only).

