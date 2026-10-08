# Visuals, lighting & VFX master pass

The brief: make every frame look like a festival livestream shot on a cinema camera, lit by a world-class lighting designer. It must stay fast, tiered (low / medium / high) and safe: no NaN frames, reduce-flashing respected, lasers at least 3 m above the crowd.

This file holds the baseline, what each phase changed, the measurements and the known limits.

## Phase 0: baseline

**How it was measured**
- Chromium on SwiftShader (software WebGL2), 1280×800, stage-focus layout, medium quality, adaptive quality off.
- Show moments were forced through `stage.show.update` (the same harness as the earlier effects pass): breakdown (build 0.6), build (0.97), drop (the drop frame, then 0.9 s), with deck 1 playing.
- Shots: all seven venues × breakdown / build / drop × the venue's wide angle and the crowd angle (42 frames).

**Draw calls, triangles and programs per frame**

Steady state (mean of 4 two-frame windows):

| Venue | View | Draw calls | Triangles | Programs |
|---|---|---:|---:|---:|
| Warehouse | perf | 382 | 284 k | 55 |
| Warehouse | wide | 440 | 295 k | 58 |
| DC-10 | perf | 384 | 704 k | 59 |
| DC-10 | wide | 163 | 663 k | 59 |
| Boiler Room | perf | 364 | 408 k | 61 |
| Boiler Room | wide | 137 | 307 k | 61 |
| Berghain | perf | 374 | 553 k | 73 |
| Berghain | wide | 434 | 497 k | 73 |
| Printworks | perf | 411 | 363 k | 90 |
| Printworks | wide | 248 | 748 k | 90 |
| Alexandra Palace | perf | 424 | 632 k | 107 |
| Alexandra Palace | wide | 183 | 166 k | 107 |
| Ally Pally, in the round | perf | 393 | 477 k | 114 |
| Ally Pally, in the round | wide | 458 | 411 k | 114 |

Frame times on SwiftShader (roughly 2–10 fps) say nothing about a real GPU. They are not used as a budget. Each new effect is costed by its pass count, its per-pixel work and its tier instead.

**What reads fake (ranked)**

1. **Beams are plastic tubes.**
   - Every moving-head beam is an additive cylinder shell with a fresnel-style edge.
   - The "gobo" is a ±20 % sine. There's no hot core and no gobo fingers.
   - The brightness doesn't change when you look into the beam, and there's no prism.
   - Seen in every venue; worst at Berghain and the warehouse, where the beams are the show.
2. **Haze is evenly lit.**
   - The beams show the haze noise, but nothing gives the feeling of a beam *in* a volume.
   - Drops at Alexandra Palace go milky white: too many additive beams and lasers at full level.
3. **Light doesn't land.**
   - Floor pools are soft dots: no gobo pattern on the dance floor.
   - Walls and the booth don't take the beams.
   - The crowd is lit only at Alexandra Palace (light map); elsewhere it's flat.
4. **CO2 reads as white blobs.** On the DC-10 drop, the plumes are flat bright sprites that eat the frame.
5. **No confetti, streamers or paper on drops.** Only sparks and flames.
6. **LED walls are flat images.** No pixel structure up close, and nothing the camera reacts to.
7. **The camera is too clean.**
   - Bloom is generic, with no lens dirt and no starburst on point lights.
   - No exposure response to strobes and blinders.
   - Grading is the same for a breakdown and a drop.
8. **No backlight.** The crowd has no rim light from the beams behind it, and no phone flashes on the drop.
9. **Lights run ahead of the sound.** The show reads the playhead that's about to be heard, so on a Bluetooth output (100–200 ms) the lights land early.

## Phase 1: light that behaves like light

### Beams as volumes (`src/three/venues/beams.ts`)
Each moving-head beam is still one instanced cone mesh, but its fragment shader is now a small volume renderer:

1. **Ray against the cone, analytically.** It solves for the part of the view ray inside the cone, clipped between the lens and the far end. `coneInterval()` in TypeScript is the same maths and is tested against brute-force sampling, including cameras inside a beam.
2. **March along that part.** 1 step on low, 4 on medium, 7 on high, with interleaved-gradient jitter. At each step it adds:
   - the field: an even top with a defined edge (a soft edge read as milk), a little hotter in the middle
   - **the gobo in the beam's cross-section**: spokes, a ring of dots, organic breakup, rings, or open. Its shadows run the length of the beam as fingers through the haze
   - distance falloff: the light spreads over a growing disc, so beams are brightest near the lens
   - wisps along the chord: cheap on medium, true noise at two points on high
3. **Haze density.** One sample of the shared haze field per pixel. Noise is the expensive part, so it isn't sampled per step.
4. **Absorption.** The sum saturates (1 − e^−7x)/7, so a beam seen end-on glows hard but can't white out the frame.
5. **Forward scattering.** Henyey–Greenstein, g = 0.5, normalised to 1 side-on and capped at 2.5. Looking up into a beam, it blazes.
6. **Up close.** A beam passing right in front of the lens fades by its apparent size, so it reads as a glow rather than a wall. From inside a beam only the inside walls draw, at low strength.
7. **Each beam is capped** at 1.6 HDR.

**Gobos and the prism follow the music** (`goboFor`):
- dots turning slowly through a breakdown
- spokes spinning up with the build, with the prism in its last stretch
- open beams through the prism at the peak, with spokes every other 4 bars
- a different texture every 8 bars of the groove
- alternate heads turn the other way

**The prism** splits each head into three beams turned evenly round its axis and tipped 0.11 rad off it. They share the light at 0.42 each.

**The gobo lands on the floor.** The floor pools are now a shader that draws the same gobo, turning with the beam.

**Energy budget.** A rig of n heads runs each beam at √(12/n) of full gain. Thirty heads at Alexandra Palace no longer add up to a white frame; Berghain's eight are untouched.

### Auto exposure (`src/three/exposure.ts`)
Pulled forward from Phase 5, because the drops needed it.
- **Measuring.** A pass after the scene render measures it without changing it. It reduces the frame to 16 × 9 cells, each the average brightness of its patch, log-encoded into a byte, and reads them back asynchronously every 4 frames.
- **Metering.** It meters the **highlights**: the 80th-percentile cell. A log average doesn't work here, because half dark crowd and half blown-out beams averages "dark" while the frame is white.
- **Adjusting.** The tone-mapping exposure eases in stops: 3.2/s stopping down, 0.9/s opening up, within 0.35–1.12 around the venue's base. A drop's first frames still land at full punch (under a tenth of a stop on the first frame); dark clubs sit at the top of the range and stay dark.
- **Result.** At Alexandra Palace's drop from the crowd it settles at about 0.7. The frame went from a white sheet to a readable LED wall, beams and crowd (`cust/ally-drop-settled.png`).

### Measured on the drop
Berghain, crowd angle, mean frame brightness (0–255), 24 frames after the drop hit:
- first pass of the beams: up to 236 (white)
- with absorption and the up-close fade: 28–104
- beams hidden: 18–31

The white-out came from beams seen end-on near the camera. Absorption and the up-close fade fixed it.

### Cost
- One extra full-screen pass at 16 × 9, plus a 576-byte async readback every 4 frames.
- Beam pixels cost about 2 noise lookups (as before) plus 4 or 7 cheap steps: a gobo function, an `atan` and a few multiply-adds each.
- Draw calls are unchanged. The prism uses the same instanced draw with three times the instances (the spare ones scaled to zero when it's out).
- On SwiftShader, frame rate is dominated by the library's background analysis and is not a measure of GPU cost.
