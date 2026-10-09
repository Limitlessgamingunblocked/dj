# The board file

Every board you build in the Board Builder is saved as one JSON document, the
same one a share code carries. It is versioned, and every board is checked as
it loads, so boards keep opening as the game changes. The code is in
`src/board/format.ts` (`checkBoardFile`).

```jsonc
{
  "format": "deckhouse-board",
  "version": 1,
  "id": "b-k3x9q2",            // [A-Za-z0-9_-]{1,64}
  "name": "Wax & Walnut",       // up to 60 characters
  "created": "2026-10-09T14:20:00.000Z",
  "booth": { … },               // the table the board stands on
  "components": [ … ],          // the parts, nested in groups
  "wiring": { "nodes": [ … ], "cables": [ … ] },
  "macros": [ … ],
  "triggers": [ … ],
  "midi": { "cc:1:7": "c1f2k9" } // a MIDI message → a part's id
}
```

## How a board is checked

- **Unknown part types are skipped**, so a board from a newer game still
  opens, minus the parts it doesn't know.
- Numbers are clamped to their range and strings are cut to length.
- Colours must be `#rrggbb`. Ids must match `[A-Za-z0-9_-]{1,64}`, and
  types must match `[a-z][a-z0-9_]{0,31}`.
- Anything that isn't plain data (functions, very deep nesting, odd keys) is
  dropped. A type's own settings are kept only if the type knows that key and
  the value has the same JSON type as its default.
- An `image` (for the picture material) is kept only as a
  `data:image/png|jpeg|webp;base64,…` URL of up to 300 kB. Links,
  `javascript:` and other URLs are dropped.
- MIDI entries pointing at a part that isn't there are dropped. Removing a
  part in the editor takes its MIDI mapping and its wiring with it.
- Size limits:

  | What | Limit |
  |---|---|
  | Top-level parts | 20,000 |
  | Children in one group | 5,000 |
  | Group nesting depth | 16 |
  | Wiring nodes | 2,000 |
  | Cables | 4,000 |
  | Macros | 200 (2,000 steps each, up to 10 minutes long) |
  | Triggers | 200 |
  | MIDI mappings | 1,000 |

  The performance meter warns long before you reach any of them.

## A part (component)

```jsonc
{
  "id": "c1f2k9",
  "type": "fader",              // see the table below
  "pos": [-0.2, 0.03, 0.1],     // metres, from the board's centre on the table top
  "rot": [0, 1.5708, 0],        // radians
  "scale": [1, 1, 1],
  "props": { … },
  "children": []                // only groups have children
}
```

Common settings (`props`), shared by every type:

| Key | Values |
|---|---|
| `name` | your name for it (≤ 40) |
| `shape` | a type's shape option (`round`, `big`, `cap`…) |
| `material` | `matte` `gloss` `chrome` `gold` `brushed` `oak` `walnut` `maple` `ebony` `marble` `carbon` `acrylic` `frosted` `liquid` `holo` `lava` `ice` `galaxy` `rubber` `leather` `image` |
| `colors` | three colour zones `[body, print/second, light/accent]` |
| `glow` | `{ color, intensity 0..1, beat: bool }` |
| `label` | `{ text ≤ 40, font: label/mono/marker/script, place: above/below/on/none }` |
| `fn` | what it controls: a control id such as `deck.1.play` or `ch.2.fader`, or an add-on's function |
| `fn2` | a second axis (XY pad, globe, theremin) |
| `feel` | `{ curve: linear/log/exp/s, sensitivity 0.1..4, detents 0..64, resistance 0..1 }` |
| `sound` | `click` `soft` `mechanical` `whoosh` `silent` |
| `anim` | `none` `spin` `bob` `pulse` |
| `hidden`, `locked` | editor state |

A type adds its own settings alongside (for example `deck`, `size`, `length`,
`channels`, `w`/`d`/`h`); the table below lists them.

## The booth

```jsonc
{ "table": "rect",   // rect, round, curved, L, none (none: the venue's own booth)
  "width": 1.6,      // 0.4–12 m
  "depth": 0.75,     // 0.3–4 m
  "height": 0.95,    // 0.5–1.4 m
  "front": "name",   // plain, name, led, mesh, wood, mirror
  "material": "matte", "color": "#14161a",
  "monitors": "small",  // none, small, large, stack
  "cables": "hidden",   // hidden, colored, coiled
  "cableColor": "#ff2e88",
  "riser": 0,           // 0–1.2 m
  "glassFloor": false, "sideScreens": false }
```

## Wiring

Nodes are joined by cables, from an output to the next node's input:
`{ "from": "n1", "to": "n2" }`. Each node is
`{ id, type, params, x, y }`, where `x` and `y` are its place in the node
editor. Params are numbers, booleans, or strings of up to 80 characters.

| Node | Kind | Params |
|---|---|---|
| `in.component` | input: a part on the board | `component` |
| `in.control` | input: any control | `control` |
| `in.clock` | input: a ramp every beat, bar or phrase | `rate` |
| `in.vibe` / `in.kick` / `in.drop` | input: the vibe meter, the kick, the drop | — |
| `mod.scale` | modifier | `min`, `max` |
| `mod.invert` | modifier | — |
| `mod.curve` | modifier | `curve` |
| `mod.delay` | modifier | `ms` |
| `mod.random` | modifier | `amount` |
| `mod.sync` | modifier: snaps to the beat | `every` (`1/4`, `1/2`, `1`, `bar`) |
| `mod.smooth` | modifier | `time` (seconds) |
| `mod.threshold` | modifier | `level` |
| `out.control` | output: sets a control | `control` |
| `out.light` | output | `cue` (`strobe`, `blinder`, `blackout`, `lasers`) |
| `out.show` | output: a show cue | `cue` |
| `out.crowd` / `out.hype` | output: the crowd, or hype (lights, crowd and FX together) | — |
| `out.camera` | output: cuts the camera | `view` |

## Macros, triggers and MIDI

- **Macro:** `{ id, name, steps: [{ at: ms, control, value? }] }`. A step
  without `value` is a press. Each macro also becomes a button control,
  `board.macro.<id>`, so a part, a trigger or a MIDI key can play it.
- **Trigger:** `{ id, when, above, action, on }`.
  - `when` is one of `vibe`, `drop`, `bar`, `phrase`, `build`, `breakdown` or
    `peak`. With `vibe`, it fires when the meter rises past `above` (0..1).
  - `action` is `control:<id>`, `macro:<id>` or `show:<cue>`.
- **MIDI:** keys are `cc:<channel>:<number>`, `note:<channel>:<number>` or
  `pb:<channel>:<number>`, each mapped to a part's id. A board's own mappings
  are applied after the global ones in Settings.

## Share codes and files

- **Share code:** `DH1.` followed by the board JSON, deflated (`deflate-raw`)
  and written in URL-safe base64. If the browser can't compress, it's `DH0.`
  followed by plain JSON in base64.
- **Before encoding:** settings still at their defaults are left out, so codes
  stay short.
- **Board file:** "Save as a file" writes the same JSON to `<name>.deckhouse-board.json`.
- **Reading either back:** it goes through the same checks as above.

## Versions

`version` is 1. A newer version still loads what this game understands. When
the format changes, the reader will upgrade older versions step by step, the
same way the career save does (`src/core/save.ts`).

Your boards are stored in IndexedDB, not in the career save:

- `board:<id>`: the board file
- `board-thumb:<id>`: its picture

The career save (`boards`, save v2) keeps only the list: names, ratings,
plays, favourites, the board in use, and a compact copy of it so the game
starts without waiting on IndexedDB.

## Parts

Generated from the catalogue (`allDefs()` in `src/board/catalog.ts`).

- **Cost:** what the part adds to the performance meter.
- **Unlock:** in a career, some parts unlock as your fame grows. Sandbox opens
  everything.

### Panels & shapes

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `panel` | Panel | `w`, `d`, `h` | 1 | — |
| `group` | Group | — | 0 | — |

### Decks

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `jog` | Jog wheel | `deck`, `size`, `platter`, `display` | 6 | — |
| `transport` | Transport | `deck` | 8 | — |
| `turntable` | Turntable | `deck` | 10 | Fame tier 2 |
| `media_player` | Club media player | `deck` | 42 | — |
| `dd_turntable` | Direct-drive turntable | `deck` | 30 | — |

### Mixer

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `mixer` | Mixer | `channels`, `bands`, `kills`, `xfader` | 30 | — |
| `club_mixer` | Club mixer (4-channel) | — | 60 | — |
| `rotary_mixer` | Rotary mixer | — | 34 | — |

### Faders, knobs, buttons

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `fader` | Fader | `fn`, `length`, `orient` | 3 | — |
| `knob` | Knob | `fn`, `size`, `ring` | 3 | — |
| `button` | Button | `fn`, `w` | 2 | — |
| `pads` | Pad grid | `rows`, `cols`, `size`, `base` | 8 | — |

### Screens & meters

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `screen` | Screen | `kind`, `deck`, `w`, `d` | 4 | — |
| `meter` | Meter | `kind`, `source`, `length` | 3 | — |

### FX

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `fx` | FX unit | `slots` | 12 | — |

### Wild add-ons

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `theremin` | Theremin Zone | `fn`, `fn2` | 6 | Fame tier 3 |
| `ribbon` | Touch Ribbon | `fn`, `w` | 4 | Fame tier 2 |
| `xy` | XY Pad | `fn`, `fn2`, `w` | 4 | — |
| `globe` | Spinning Globe | `fn`, `fn2`, `size` | 5 | Fame tier 4 |
| `crowd_fader` | Crowd Fader | `length` | 4 | Fame tier 3 |
| `drop_button` | Big Red Drop Button | `size` | 6 | Milestone: an S grade |
| `scratch_tower` | Scratch Tower | `deck` | 10 | Fame tier 4 |
| `tape_stop` | Tape Stop Lever | `deck` | 3 | Fame tier 2 |
| `rewind` | Rewind Wheel | `deck` | 3 | Fame tier 3 |
| `horn` | Air Horn & Siren | — | 3 | — |
| `vocal_keys` | Vocal Chop Keyboard | `keys` | 8 | Fame tier 3 |
| `sequencer` | Step Sequencer | — | 12 | Fame tier 2 |
| `ball_pit` | Gravity Ball Pit | — | 10 | Fame tier 5 |
| `pendulum` | Pendulum | `fn` | 4 | Fame tier 3 |
| `fire_fader` | Fire Fader | `fn`, `length` | 5 | Fame tier 5 |
| `hype_dial` | Hype Dial | `size` | 3 | Fame tier 4 |

### Show controls

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `laser_ctl` | Laser Controller | — | 8 | Fame tier 4 |
| `light_desk` | Lighting Desk | — | 8 | — |
| `pyro_panel` | Pyro & CO2 Panel | — | 8 | Fame tier 5 |
| `ledwall_ctl` | LED Wall Controller | — | 4 | Fame tier 3 |
| `cam_switcher` | Camera Switcher | — | 6 | — |
| `weather` | Weather Button | — | 3 | Fame tier 5 |
| `crowd_cam` | Crowd Cam | — | 10 | — |

### Booth gear

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `headphones` | Headphones | — | 6 | — |
| `laptop` | Laptop | — | 6 | — |
| `usb_stick` | USB stick | — | 1 | — |
| `booth_mic` | Booth mic | — | 4 | — |
| `booth_monitor` | Booth monitor | — | 4 | — |
| `setlist` | Setlist | `title`, `lines` | 1 | — |
| `gaffer_tape` | Gaffer tape | `text`, `w` | 1 | — |
| `record_crate` | Record crate | `count`, `seed` | 5 | — |
| `water_bottle` | Water bottle | — | 2 | — |

### Decorations

| type | name | settings of its own | cost | unlock |
|---|---|---|---|---|
| `bobblehead` | Bobblehead | — | 2 | — |
| `lava_lamp` | Lava lamp | — | 4 | — |
| `disco_ball` | Mini disco ball | — | 6 | Fame tier 2 |
| `plant` | Plant | — | 2 | — |
| `speaker_stack` | Mini speaker stack | — | 2 | — |
| `cocktail` | Cocktail | — | 2 | — |
| `cat` | Sleeping cat | — | 2 | Milestone: your first encore |
| `gears` | Spinning gears | — | 3 | — |
| `dancers` | Tiny dancers | — | 4 | — |
| `mini_crowd` | Mini crowd | — | 8 | Fame tier 3 |
| `sticker` | Sticker | `design`, `size` | 1 | — |
| `drawing` | Drawing | `w`, `d` | 1 | — |
| `engraving` | Name engraving | `w`, `finish`, `style` | 2 | — |
