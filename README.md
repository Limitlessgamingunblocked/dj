# Deckhouse DJ

A DJ studio that runs in the browser. Pick a real-world style board — from an entry-level controller to a four-player festival booth, a hybrid vinyl + media player rig or turntables with a rotary mixer — and play it in 3D: every knob, fader, jog wheel, pad and button works. Pick where you play — Circoloco @ DC-10 in Ibiza, Boiler Room in LA, Berghain, Printworks, Alexandra Palace (an arena show, or in the round under 43,000 hanging lights) or the house warehouse — each with its own room, a dancing crowd (sign holders, VIP guests by the booth) and a light show of lasers, moving heads, strobes, blinders, CO2 and pyro that follows the beat. Fly an FPV drone camera through the room. Load your own music, mix it, add effects and watch an audio-reactive visual player, with the lyrics of whatever is playing as kinetic type on the LED walls.

It ships no music: it opens on the Library tab, where you add your own (files, a folder, or a playlist from another app). Load a track on each deck, or press **Play a gig** in the top bar for a scored set.

It also builds DJ sets: the **Set Builder** tab (SmartDJ) turns your library into an ordered, harmonically mixed set around the artists, labels or genres you pick, shaped to an energy arc, with transition guidance for every mix. It can build sets in four house sounds (Deep & Groovy, Rolling Minimal, Bouncy Tech House, Rave Energy) from whatever your library holds.

**No install:** download [`Deckhouse-DJ.html`](Deckhouse-DJ.html) and open it in Chrome or Edge. It is the whole app in one file, rebuilt with `npm run build:single`.

## Becoming a game

The project is turning into **DeckHouse DJ, a house-music DJ career game** (bedroom to sunrise closing set), built in stages:
- [AUDIT.md](AUDIT.md) maps the brief against the code.
- [TODO.md](TODO.md) tracks placeholders and the stage backlog.
- [DECISIONS.md](DECISIONS.md) records the choices made.
- [ASSETS.md](ASSETS.md) lists the 3D assets.

Stage 1 added the foundation:
- a central beat clock with beat, bar, phrase, build, breakdown and drop events (`src/core/BeatClock.ts`)
- versioned career saves with migrations and backups (`src/core/SaveSystem.ts`, `src/core/models.ts`)
- a master redline signal
- the Blender export pipeline (`assets_source/blender/README.md`)
- a **debug menu**: press **Ctrl+Shift+D**, or open the page with `?debug`, to jump venues, set the fame tier, unlock everything, change the crowd and fire a drop

Stage 2A added **your name**:
- **The naming scene** opens on first launch: a dark room, one spotlight on a blank LED sign. Letters strike up as you type, with a preview in four styles, then the crowd goes up when you light it.
- **The NameService** puts the name on the booth front in each venue's style, on neon signs, on the LED walls on drops, on the superfan's sign, as stickers on the board and laptop, and in the top bar. The crowd chants it at the peak.
- **Renaming:** Settings → Profile. Changes show up everywhere at once.

Stage 2B added **your character**:
- **The dressing room** comes straight after naming, and later from Settings → Profile → Dressing room (or open the page with `?dressing`). It's a backstage room with a bulb-ringed mirror, a clothes rail and the club thumping through the wall.
- **Preview your look** under the dressing-room bulbs, a club strobe, daylight on a terrace or UV blacklight.
- **Shape everything:**
  - body, face, eyes and skin (24 tones)
  - 43 hair styles with colour modes and finishes
  - makeup, face paint, 54 tattoos (one of them your DJ name) and piercings
  - 11 outfit slots, each with 3 colours, 9 materials and 8 patterns, plus the 12 signature sets
  - your groove, drop move and habits
- **Tools:** randomise, undo / redo, reset a tab. Every change saves; keep as many looks as you like.
- **That's you at the decks:** in every venue the DJ is your character, grooving your way.
- The character is built in code until the Blender models exist (see TODO.md).

Stage 3 made it **a game you can play a set in**:
- **Play a gig:** the button in the top bar. Pick a venue, a slot (warm-up, peak time, closing, after-hours), a length (10, 20, 30 or 60 minutes), an assist level and your look, read the promoter's brief, and go.
- **The Bedroom** is where you start: a desk with your controller, posters, an LED strip and fairy lights, with a livestream chat for a crowd. Get the chat going long enough and another stream raids you.
- **The Basement** unlocks after your first set in the Bedroom: black brick, sweating pipes, one red light, a mirror ball and about 80 people. Hold the peak and the ceiling starts dripping.
- **The vibe meter** scores everything Section 6 asks for:
  - beatmatching in bands (Perfect under 10 ms, Good, Loose, Trainwreck)
  - named transitions (bass swap, filter fade, echo out, loop roll, quick cut, double drop, long blend)
  - key compatibility
  - how well your energy fits the slot
  - mistakes (dead air, redlining, the same energy for too long, too many drops, banging it out in a warm-up, repeats)
  - comebacks
- **Assists:** Chill syncs for you, Club lets you sync, Pro takes sync away for a ×1.5 score.
- **Results:** a grade from D to S, the vibe over the set against what the slot wanted, your best transition, the crowd's peak, and fame, cash and followers. Finish above 75 % and they call for an encore.
- **The room reacts:** lights follow the hi-hats, bass and vocals and dim when the room is cold; the crowd goes from scrolling their phones to jumping in sync; you hear them murmur, cheer, groan and chant your name; the promoter, sound engineer, security, the bar and the door all have something to say.
- Your own tracks get section markers (intro, breakdown, build, drop, outro) found from their analysis, so drops and builds score on any music.
- Free play still works the way it always has: pick any venue and mix, with the vibe meter driving the room.

Stage 4 added **recording and instant replay**:
- **REC** (top bar or Shift+R) records the set, with an optional three-beat count-in so it starts on the downbeat. The ▾ next to it opens the recording studio:
  - **Audio only**: the clean master, lossless (24-bit / 48 kHz), exported as WAV or MP3 (320 kbps, tagged with your name, the venue and the cover).
  - **Video + audio** or **booth cam** (close on your hands): 720p up to 4K, 30 or 60 fps, 16:9, 9:16 or 1:1, with the size per minute shown. Saves as MP4 where the browser can, otherwise WebM.
  - **Camera:** auto-cinematic (cuts on the phrase, a punch-in on every drop, a slow orbit through breakdowns), locked, or switch it yourself.
  - **Overlays:** your name as a watermark (pick the corner and the lettering), venue and date, "now playing", a live tracklist, a VHS timestamp.
- **The replay buffer** quietly keeps the last few minutes (10 by default on a desktop; the memory each length takes is shown):
  - **SAVE THAT MIX** (Shift+S) keeps it all.
  - **CLIP IT** (Shift+C) turns the last 30 or 60 seconds into a vertical clip.
  - After a gig, the results screen offers to save it, or to replay your best transition, before it's cleared.
- **My Sets** (a new tab) lists every recording, saved mix and clip with its date, venue, length, grade, tracklist, cover art and thumbnail. You can sort, filter, rename, favourite, delete, export (video, WAV, MP3, cover art, tracklist) and clean up old sets.
- **The trim editor** shows a saved set as a waveform with stills above it, the moments it caught (drops, transitions, peaks, chants) and the bar lines. Drag the handles (they snap to bars), zoom in, preview, add fades, and export a clip in any aspect.

Stage 5 built a **Board Builder**, which has since been **taken out** at your request. It's kept in the git history (commit `b2b0a98`) if you ever want it back. The more realistic knobs and fader caps it brought stayed on every board.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (serve over http(s) or localhost)
npm test           # DSP, analysis, format, set builder, lyrics, adaptive quality, surface-map, venue geometry, laser, light-show, save, name, character, vibe-meter and gig tests
npm run build:single   # one self-contained HTML file in dist-single/
```

Serve `dist/` from `localhost` or any `https://` host. The single-file build (`npm run build:single`) also works when opened straight from disk. Current Chrome, Edge, Firefox and Safari are supported; Web MIDI needs Chrome, Edge or Opera.

## What's in it

### Your music and playlists
- **Import** MP3, WAV, AIFF, FLAC, OGG or M4A files, a whole folder, or drop them anywhere. They're analysed in the browser (tempo, beat grid, key, loudness, sections) and stay on your device.
- **Import a playlist** (Library ⋯ menu, or drop the file): M3U / M3U8, PLS, XSPF, rekordbox XML, Traktor NML, an Apple Music / iTunes library XML, a CSV of a streaming playlist from a playlist export tool, or a pasted "Artist - Title" list. Each playlist becomes a crate under **Playlists**. Tracks you have go straight in, matched by file name or by artist and title. The rest are listed under the crate and slot in when you import their files.
- **Spotify and SoundCloud** can't be connected. Spotify's developer policy rules out DJ apps and mixing its content, and SoundCloud's API rules out modifying or mixing tracks. Both deliver their audio in a form a browser mixer can't process. Bring the track list and your own files instead.

### Gigs: streaks, requests and the coach
- **Live score** in the gig HUD.
- **Streak:** clean transitions, built drops and comebacks in a row multiply their points (×1.25, ×1.5 … up to ×2). A trainwreck, a key clash, dead air, redlining, too many drops or a repeat breaks it.
- **Crowd requests** every couple of minutes, with a timer: more energy or less when the room is off the slot's curve, otherwise a drop, a long blend, a filter fade or something new. Met requests pay points and lift the vibe; missed ones cost a little.
- **Next-track coach** (Chill and Club): a track from your crate that's in key, close in tempo and at the energy the slot wants next, with a Load button.
- The results show your best streak and how many requests you met.

### Auto DJ
Turn it on from the ⋯ menu (or Shift+A) and it mixes by itself, the way you would on two decks:
- **What comes next:** the next track of your Set Builder set; without a set, the best match in the library (a compatible key, a tempo within a few percent, allowing half / double time, not played this session). Load something onto the free deck yourself and that's the next track.
- **When:** it cues the next track on its first downbeat, syncs it and cuts its bass, then starts it on an 8-bar line of the outgoing track: the last one that leaves room for the whole mix before the end.
- **How:** over 8, 16 (default) or 32 bars (Settings → Decks) the crossfader moves across (the channel faders on mixers without one) and the basses swap at the half. The outgoing deck stops; the incoming one keeps the tempo it was synced to, so nothing jumps; the next track gets ready on the deck that just finished.
- **Taking over:** touch the crossfader, a channel fader or bass knob of deck 1 or 2, or play / pause, and it hands the mix back. A chip in the top bar shows when the next mix starts and how far through it is; click it to stop.
- With the auto director on too, it's a hands-off show.

### The screen
- **Now playing:** when a new track takes over, its title, artist, BPM and key slide in at the bottom of the stage like a broadcast graphic (Settings → Show & venue turns it off).
- **Board full screen** (⛶ on the stage, Shift+B, or the ⋯ menu): the 3D board fills the whole screen and everything else goes away. Top-down or Angled framing, plus the full camera menu (every angle and your saved views). A camera bar along the bottom changes the angle while you play: hold to orbit round the board, look from higher or lower and zoom, go back to the board view, or step to the next angle (on the keyboard: Shift + arrows, `=` and `-`, Shift+V; all MIDI-learnable; it folds away). The angle you pick is remembered for next time. Every control, the keyboard and MIDI keep working; Esc brings the rest back. Inside embedded viewers that block browser full screen it fills the window instead, and on phones it turns to landscape where the browser allows.
- **Top bar:** board, venue, the crowd meter, master BPM, Rec, the **Simple / Pro** switch and the **⋯** menu. The ⋯ menu holds the stage view (Booth, Split, Visuals; also the `V` key), full screen, the layout switch, MIDI and help. A MIDI pill appears only while a controller is connected.
- **Simple** (the default) keeps each deck panel to what you mix with: title, key, BPM, time, the overview waveform, Cue / Play / Sync and tempo. **Pro** adds Master, the tempo range, the pads and pad modes, the loops/key/stems drawer and the 🎤 lyrics button. Nothing is removed in Simple: the deck's ⋯ menu, the 3D board, the keyboard and MIDI still reach everything.
- **Waveform strip:** a lane for each deck on the left and right, plus any other deck with a track loaded.
- **Five tabs:** Library · Set Builder · Mixer & FX (with the sampler) · Show (venue, lighting desk, visual player, lyrics) · Settings (with MIDI).
- **On a phone:** one row of controls in the top bar, short tab labels, touch targets of at least 44 px, and no sideways scrolling.
- **Picks up where you left off:** a reload puts the tracks that were on the decks back on them.
- **Accessibility:** keyboard focus is visible everywhere. The camera's idle drift and beat shake stop when the system asks for reduced motion (or when you turn camera motion off in Settings). Interface size goes from 80 % to 130 %.

### Settings and customising
Everything you can change is on the Settings tab, in sections with a search box (type "key", "colour", "loop", "crowd"…):
- **Appearance:** interface size (the panels around the stage; the 3D board keeps its own pixels), Simple / Pro layout, accent colour (follows the venue by default), the four deck colours, **key notation** (Camelot `8A`, Open Key `1m`, musical `Am`, or Camelot plus musical — used in the library, on the decks, in the Set Builder, by the crowd and on the board screens; library search understands all three) and **waveform colours** (RGB, 3-band blue/orange/white, blue, or one colour).
- **Decks:** tempo range, jog wheels (vinyl scratch or CDJ pitch bend), loop size, beat-jump size, key lock and quantize for every deck, the **end-of-track warning** (the time and overview blink red, and the board's jog ring and screen turn red; off, or the last 15–90 seconds) and the load lock (don't load onto a playing deck).
- **Audio:** auto gain, fader curve, split cue and the headphone output.
- **Board & camera:** the board and finish, stickers, hover zoom, camera motion, saved camera views.
- **Show & venue:** the venue, **crowd size** (from an empty room to 150 %; fewer people is also lighter on slow computers), Reduce flashing and the **lights and visuals delay**. The lights already wait for your audio output's measured latency, so they land with the beat you hear; if they still run early (Bluetooth speakers often under-report), add up to 400 ms. The Show tab adds a **Custom** light palette with three colour pickers.
- **Performance:** graphics quality, automatic adjustment and a frame-rate meter on the stage.
- **Keyboard shortcuts:** every binding is listed; click its key and press a new one (Shift for the Shift layer, Backspace for none, Esc to cancel). A key does one thing: taking a key that is in use clears it from the other action, and the app says so. Reset one key or all of them.
- **Your settings:** export everything (preferences, keyboard, MIDI mappings, saved views, Set Builder options) to a file, import it in another browser, or reset to the defaults. The music library isn't part of the file. Saved and imported settings are checked on load, so an old or edited file can't break the app.

### Boards (3D, Three.js)
| Board | Class | Decks |
|---|---|---|
| Starter Two | Entry-level 2-channel all-in-one controller | 2 |
| All-in-One Two | Flagship 2-channel all-in-one (73 × 47 cm) with a 10.1-inch touch screen that browses your library | 2 |
| Pro Four | Flagship 4-channel controller with on-jog displays, centre screen, LED filter rings | 4 (layers) |
| Club Standard | Two media players with waveform screens + 4-channel club mixer | 4 (layers) |
| Vinyl Battle | Twin direct-drive turntables + 2-channel battle mixer | 2 |
| Festival Quad | Four media players (decks 3·1 · mixer · 2·4) + 4-channel mixer | 4 (one unit each) |
| Hybrid Booth | Turntables on decks 3/4 outside media players on decks 1/2 + 4-channel mixer | 4 (one unit each) |
| Rotary House | Twin turntables + walnut-cheeked 2-channel rotary mixer (no crossfader, no sync) | 2 |

- PBR materials with a room environment map, real-time shadows from the booth light, bloom on LEDs and screens, printed faceplates.
- Each board comes in several finishes, and every board carries old stickers and gaffer tape — drawn procedurally and aged (sun-faded, scratched, torn and peeling corners), placed only in free space so they never cover a control. Switch them off in Settings.
- On the one-unit-per-deck boards the software deck panels follow whichever player or turntable you touch.
- **All-in-One Two's touch screen** works like the real one. Tap its tabs:
  - **DECKS:** both decks' scrolling waveforms, title, BPM, key, tempo and time, beat FX, and an overview per deck. Tap an overview to jump there.
  - **BROWSE:** your library, the same list as the Library tab. Tap a track to pick it and tap it again to load it, or use LOAD ▶ DECK 1 / 2. Drag or scroll to move through the list, tap a column to sort, and use ★ TAG for favourites. Tracks that suit the master deck's key get a green dot.
  - **PLAYLISTS:** the collection, favourites, history and your crates.
  - **SEARCH:** jump to a letter, or change the sort.

  Beside the screen are the browse encoder (turn to move through the list; push to open it, or to load from it), BACK, TAG TRACK and LOAD 1 / 2. Each deck adds CUE/LOOP CALL ◀ ▶ with MEMORY and DELETE (on the hot cues), track search ◀◀ ▶▶ (the previous or next track in the list) and search (hold to scan). The mixer has a sound colour FX (FILTER or CRUSH on the COLOR knobs, with PARAMETER). The mic, aux and booth-monitor knobs turn but have no audio behind them in a browser game.
- Controls: drag knobs up/down (Shift for fine), drag faders, double-click to reset, scroll wheel over any control. Jogs have a capacitive top (scratch in vinyl mode) and an outer ring (pitch bend). Turntables have platter inertia with adjustable start/brake, slip-mat scratching (the platter keeps spinning under the record), tonearm needle drop, 33/45 and adjustable record wear (crackle, hiss, wow & flutter). Multi-touch works on touch screens.
- Hover-to-zoom (zones per unit on the multi-unit rigs): rest the mouse over a deck or the mixer and the camera moves in close so the controls are big and easy to grab; move off the board (or click the zoom chip) to pull back. The camera holds still while you're dragging a control. On touch screens, tap part of the board to zoom and tap again to zoom out. Switch it off in the camera menu on the stage.
- Cameras: top-down, performance (drifts gently with the music when you're hands-off), first-person booth, club views, six moving angles with their own lens looks and the FPV drone (see Venues), orbit/pan/zoom with damping, plus saved camera views.

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
- Tags read from ID3v2, FLAC/Vorbis comments, MP4 atoms and RIFF INFO, including cover art and lyrics.
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
Builds a set from the analysed tracks in your library (or one crate), around artists, labels or genres you name, or one of four sounds.

- **Sound lanes**: `Deep & Groovy`, `Rolling Minimal`, `Bouncy Tech House` and `Rave Energy` work as anchors (type them or use the ≈ buttons). The builder matches the sound from your library and says so. Each lane has a profile: tempo range, energy band, genre words, sounds to avoid and major/minor leaning.
  | Lane | Sound |
  |---|---|
  | Deep & Groovy | deep, rolling minimal house: swung hats, walking basslines, jazzy chord stabs · 125–129 BPM |
  | Rolling Minimal | percussive, groove-first minimal tech house: congas, shakers, hypnotic loops · 126–130 BPM |
  | Bouncy Tech House | bouncy, bass-led tech house: chopped vocal hooks, big drops · 126–129 BPM |
  | Rave Energy | euphoric rave house: breakbeats, rave piano, stabs, huge builds · 126–133 BPM |

  The fictional demo artists (deep minimal, minimal tech house, tech house, rave house) exist so each lane has something to match. *All four → journey* builds a **Style Journey**: the set moves through the styles one after another (deepest first, or in the order you typed them), with each section's energy fitted to how those tracks actually sound, and keys walking between Camelot neighbours at the joins.

- **Anchors**: artists, labels (ID3 `TPUB`, Vorbis `LABEL`) or genres. Tracks by anchor artists and labels come first, then tracks whose genre matches. Anchors that aren't in the library are reported.
- **Length**: a target in minutes (10–360) or a track count (2–100). Set time accounts for the overlap of each transition.
- **Energy arc**: Peak Time Hour, Warm-Up Sunset, Steady Energy Flow, Peak & Drop Storytelling, or Style Journey. Each track's energy (1–10) is estimated from loudness, tempo, rhythmic density and brightness, and ranked against the tracks you're building from so every arc can use your whole range.
- **Transitions**: quick cuts (4 bars; tempo and key may move more), smooth blends (16 bars) or long atmospheric blends (32 bars; keys and tempos must sit tight).
- **Discovery** (0–50 %): tracks by other artists that sound like the anchors — similar tempo, energy, genre words and keys — with a push towards tracks you've rarely played. This works on your own library; it does not search online catalogues.
- **Ordering**: a beam search scores every candidate step on Camelot-wheel compatibility (same key, ±1, relative major/minor, diagonal, energy boost), tempo distance (half/double time allowed), distance from the arc's target energy, anchor fit and artist variety.
- **Guidance** for every transition: mix length in bars, where to start the incoming track (the outgoing track's mix-out point, on a 4-bar phrase found from the waveform's intro/outro), pitch change to beat-match, key move (with a key-shift suggestion for clashes) and a 0–100 score. An energy chart compares the set with the arc.
- **Fine-tuning**: pin, swap (ranked alternatives for that slot), move, remove, re-roll (keeps pins, skips removed tracks). Timings and scores update after every edit.
- **Play it**: *Load first two* puts tracks 1 and 2 on the left and right decks; *Load next* feeds the following track into whichever deck isn't playing. *Write mix cues* stores each track's mix-in and mix-out points on hot cues G and H (pads that hold your own cues are left alone). *Save as crate* adds the set to Library › Sets.
- **Export**: rekordbox XML and Traktor NML (beat grid, key, mix-in/mix-out cues, playlist), M3U8 for Serato DJ, VirtualDJ and Engine DJ, a CSV cue sheet, and a plain track list with Spotify and Apple Music search links. The browser doesn't know where your files live, so give the export the folder that holds them (or relocate after import).

The engine is in `src/setbuilder/` (profiling, harmony, arcs, generation, exports) and has no UI dependencies.

### Lyrics on the screens
- **Where lyrics come from**: the file's own tags (ID3 USLT and synced SYLT, Vorbis `LYRICS`, MP4 `©lyr`), an `.lrc` or `.txt` file with the same name dropped in with the audio, text you paste, or an optional LRCLIB lookup (lrclib.net; it asks first and sends only the artist, title and length). LRC and enhanced LRC (per-word `<mm:ss.xx>` stamps) keep their timing.
- **Aligning plain lyrics to the vocals**: the track is scanned for centre-panned tonal energy in the voice band (250 Hz–3.5 kHz, side channel subtracted, broadband drums ignored). That gives a vocal-activity curve and syllable onsets. Lines are laid over the sung parts in proportion to their syllables, and words snap to nearby onsets. This is signal analysis, not speech recognition, so it can drift on dense tracks: the editor has tap-sync (tap at the start of each line while the track plays), an offset slider, a live preview and .lrc export.
- **Kinetic typography**: the loudest playing deck's lyrics appear on the LED walls and in the visual player. Words pop in as they're sung, the type breathes with the kick, ripples with the vocal and glitches on snares. Styles: neon outline, glitch (slice displacement and RGB split), kinetic wave, tracking (letter-spacing glides in), karaoke wipe, or auto (hooks in neon and glitch, verses tracking and waving). Colours follow the light show's palette.
- **Key phrases hit the lights**: repeated lines and `[Chorus]`/`[Hook]` sections are hooks. When one lands, the lights fire a beat of strobes, a blinder pop and a burst of lit haze, and the crowd throws their arms up.
- The 🎤 button on each deck (Pro layout, or the deck's ⋯ menu) opens the editor; the Show tab has the style and switches (hook lighting, booth subtitle).

### Venues and light show
| Venue | What it is |
|---|---|
| Circoloco @ DC-10, Ibiza | A low, dark red room: orange globe lamps over a packed floor, warm bulb strings, red laser sheets, the fan wheel on the wall. Left/centre/right speaker clusters, cream booth monitors on drop rods, the crowd right at the booth. A whitewashed doorway glows onto the terrace, and there's a bar along the side |
| Boiler Room, Los Angeles | An outdoor night session under an orange LA sky glow. The crowd is all around (and behind) you with phones up, the plain red neon ring hangs on its wires, City Hall is behind, and a hot lamp sits on a truss tower. No lasers. The stream camera's monitor shows a live render of the shot; try the “Stream cam” view |
| Berghain, Berlin | An 18 m bare-concrete hall with steel pillars. No stage: the booth is recessed into the back wall. A single fixed light bar crosses the room, the stacks stand in the corners, and there's a dim bar in the far corner. Cold white beams, red work lamps and a strobe bank for the peak; no lasers, no phones |
| Printworks, London | The 112 m press hall: three levels of gantries the full length, part-lit printing presses down both sides, 17 cold LED strips up each side wall chasing the beat, press outlines on the floor, and a far-wall screen. The overhead rig of light bars lowers through the build-up and slams down on the drop |
| Alexandra Palace, London | The Great Hall at its published size (116.6 × 55 m, a fabric barrel vault rising to 25 m), with the organ on its gallery and the rose window at the far end. An arena show:<ul><li>a 23 × 7 m LED wall with the visual player and the pit camera cut in at the peak</li><li>LED towers cutting between four cameras on the phrase</li><li>flown PA with delays</li><li>three stage and three audience trusses of beams and strobe bars</li><li>14 laser projectors around the hall, CO2, sparks and hazers</li><li>a mix position mid-floor, and about 8,000 people</li></ul>Best shots: “From the stage” in a breakdown (the liquid sky over the crowd), and “From the crowd” on the drop |
| Alexandra Palace · In the round | The same hall with the decks on a round riser in the middle of the floor and the crowd all the way round. 43,000 hanging lights over the whole room play the music in 3D: ripples out from the booth on the kick, rain in breakdowns, sheets of light through the build, a shell of light bursting out on the drop, turning planes at the peak. Lasers fire up through the field from the riser. Surround PA. Best shots: “From the organ gallery” in a breakdown, and the drone on the drop |
| Deckhouse Warehouse | A raised stage, an 11 m LED wall with the visual player and a truss of moving heads. Steel pillars carry LED battens that chase down the room; block walls, a bar and exit signs |

The real venues are fan-made recreations and are not affiliated with or endorsed by the clubs or promoters. They carry no club logos or wordmarks. What each room really looks like, with sources and what the scenes still get wrong, is in [docs/venue-research.md](docs/venue-research.md).

- The light show director reads the beat grid, energy, breakdowns and drops: moving-head patterns change every 8 bars, the lasers follow the track's arc, build-ups get a strobe roll, and the drop is choreographed. The last beat of the build goes near-black, then the laser burst, CO2, blinders, strobes, pyro, the LED wall flash and the crowd jump land on the same downbeat, and phone cameras start flashing across the crowd. A big drop also fires the confetti (at most once every 90 seconds, so it stays special).
- **Moving-head beams are volumes of light**, not glowing tubes: each beam is ray-marched through the haze with the gobo in its cross-section, so the gobo's shadows run down the beam as fingers and land on the floor. The gobos change with the music (dots turning through a breakdown, spokes spinning up the build, a prism splitting each head into three beams at its top). Beams blaze when you look up into them, fade to a glow when one passes right in front of the lens, and a big rig shares out its light so a drop never goes milky.
- **The camera adapts like a real one**: auto exposure meters the highlights and stops down fast when a wall of light hits, opening up slowly, so the first frames of a drop still land at full punch. The grade follows the track: softer through a breakdown, harder and richer at the peak.
- **Lasers** look like RGB show lasers on camera. They only show where there's haze, brightening in the clumps as clouds drift through, and they end on whatever they hit: the floor, walls, the ceiling or Alexandra Palace's vault. Each hit leaves a dot, so a sweeping fan draws a line of light across the ceiling. Sheets, tunnels and the "liquid sky" are real planes of light. There are 13 looks:
  - Fan, Fan with gaps, Tunnel, Sheet, Liquid sky, Wave
  - Crossfire, Converge, Rotating fan, Chase, Burst, Strobe fan, Starfield

  On Auto they follow the track: slow looks when it's quiet, a liquid-sky sheet over the crowd as a build starts, then a tunnel, then every projector closing in on one point, a burst on the drop, and a new look every 4 bars through the peak. Beams always stay at least 3 m above the crowd.
- **Haze and light that lands on things**: the haze reads as a volume (lit from below on High), and hazers on stage puff clouds out over the crowd. At Alexandra Palace the light landing on the floor (beam pools, the LED wall's spill in its real colours, blinders, strobes) lights the people standing in it.
- **Pyro**: flame-jet machines in the Warehouse and at Printworks; cold-spark fountains (the indoor kind) at DC-10, Boiler Room and Berghain. On a drop they fire a full salvo, then a flame chases across the next downbeats, and the room glows orange.
- **Confetti**: cannons at the front of the stage fire thousands of pieces of paper (in the show's colours, plus gold and silver foil that glints) up and out over the crowd. It flutters down for a good 20 seconds, sways and tumbles, lands where it falls and lies on the floor. Berghain and Boiler Room only fire it by hand; outdoors in LA the breeze carries it.
- **Mirror balls** at DC-10 and the warehouse throw hundreds of spots that drift across the walls, floor and ceiling, with faint rays through the haze; they take over in breakdowns.
- **CO2** jets go up as dense columns that billow and tear into wisps, lit white from the rig above and in the show's colour underneath.
- **The crowd is lit from the stage**: people seen against the rig get bright rims, so the floor reads as silhouettes edged in light.
- Lighting desk (Show tab): follow-the-music on/off, drop FX, pyro on drops, **Reduce flashing**, palettes (including a Custom one with your own three colours), laser mode and look, intensity, haze, confetti on drops, and pads for strobe, blinders, lasers, CO2, pyro, confetti and blackout. The pads are also on the keyboard (N, B, Y, T, Shift+T, Shift+Y, ` by default; each pad shows its current key) and MIDI-learnable.
- **Reduce flashing** keeps strobes, blinders and blinking lasers under 3 flashes a second, softens them, skips the blackout before the drop and turns off the crowd's phone flashes. It's on by default if your system is set to reduce motion.
- All fixtures are instanced: volumetric beam cones that throw pools of light on the floor, camera-facing laser beams, dotted LED strings, glowing globes, CO2 particle plumes, drifting haze, dust in the booth light and colour-washed fog.
- **Rooms with edges:** bars, exit signs and doorways. Every booth has a laptop on a stand, drinks, a cable run and gaffer tape. Concrete, plaster and floors carry procedural normal and roughness maps, so lights catch relief and floors shine unevenly.
- **Big rooms**: at Alexandra Palace the jointed dancers fill the front of the floor and thousands of animated cut-outs fill the rest (one draw call, two triangles each). They bob on the beat, raise their arms with the crowd, jump on the peak and hold phones up, lit by the beams sweeping over them.
- **The crowd**: every dancer is a jointed figure posed on the GPU. Knees bend on the beat and on kick transients, hips sway, shoulders twist, heads nod and look around. People mix club-dance arms, hands in the air, fist pumps, clapping overhead through build-ups and arms up (with a jump) on drops and hook lines, and some film on phones whose screens and torches light up. LED-dot signs ("ONE MORE TUNE", "HI MUM"…) are held up near the front, VIP guests stand by the booth with drinks, chatting and filming, and some dancers turn to their friends. Tops, sleeves, trousers, shoes, skin and hair vary, and every dancer casts a soft contact shadow. (No phones, signs or VIPs at Berghain.) It is stylised, not photoreal.
- A crowd meter tracks the room: it rises with the music, beat-locked blends and drops, and falls with trainwrecks and key clashes, with call-outs on the stage.
- Each venue has its own camera angles (over the shoulder, stream cam, balcony, gantry, from the stage, from the organ gallery, from the crowd); you appear in the booth in those shots, hands on the decks.
- **Moving camera angles** (camera menu), placed for each room:
  - **Fisheye on the booth**: a little camera clamped to the front of the booth, looking back up at the DJ through a real fisheye lens; the bass shakes it.
  - **Crane sweep**: a jib swinging round in front of the DJ and rising and falling, once every 8 bars, in widescreen with teal-and-orange colour.
  - **Lighting rig**: from up in the truss, looking down at the booth and the front rows, with a tilt-shift blur that makes the room look like a model.
  - **Security camera**: a high corner of the room, black and white, scanlines, a burnt-in clock and REC, a slow motorised pan, and a choppy 8 frames a second.
  - **90s camcorder**: someone in the front rows filming on tape: handheld wobble, colour bleed, tracking noise, REC and a date stamp.
  - **Dolly zoom**: the camera pulls back while the lens zooms in, so the DJ stays the same size while the room stretches behind them (one cycle every 8 bars).
- **Auto director** (camera menu, `'`, or Auto on the board full-screen camera bar): the camera cuts between the angles with the music like a livestream director: calm, wide shots in a breakdown; the crane, the dolly zoom and the rig through a build, every 4 bars; a cut on the drop to the booth fisheye, the drone, the crowd or the camcorder; every 8 bars in the groove, always on a phrase line and never the same shot twice in a row. Cuts dip quickly through black. Touch the camera (drag, camera bar, keys, or pick an angle) and it hands over to you.
- **Photo** (camera menu, `Shift+'`, or 📷 on the camera bar): a full-resolution still of the stage as it looks, lens look and burnt-in text included, to save.
- Long camera moves (across the room, through walls) cut through a quick dip to black instead of flying.
- **Lens looks** (camera menu → Lens, Settings → Board & camera, or ◎ on the board full-screen camera bar): Auto gives each angle its own look; or put any look on any angle: Clean, Fisheye, 90s camcorder, Security camera, Tilt-shift miniature, Cinematic widescreen, Thermal or Night vision. Zooming in on the board always shows it clean.
- **Drone FPV** (camera menu): a looping fly-through of each venue — over the crowd, banking past the pyro, gliding across the front of the booth and swinging round to look at the DJ — with a wide lens, barrel distortion, colour fringing and a zoom blur that grows with speed. It flies faster as the energy rises.
- **Screens**: LED walls (Alexandra Palace, Printworks, the warehouse) read as LED up close (pixels, tile seams, dimmer off-axis). The IMAG towers use a broadcast grade and go monochrome through build-ups.
- **Lens and grade**: bright fixtures (beam lenses, lasers, strobes, flames) throw anamorphic streaks and faint ghosts; the brightest points turn into six-point stars (four on medium), and dust and smudges on the lens light up when a wall of light hits it; vignette and film grain (medium and high quality). Each venue has its own colour grade and tone mapping. AgX rolls lights off to white like a camera, for the warehouse, Printworks and Boiler Room; ACES keeps the blacks deep in Berghain and DC-10. Lens effects, tone mapping, grade and output run in one full-screen pass.

### Performance
- **Graphics quality** (Settings): Low, Medium or High is the ceiling. With *Adjust automatically to keep it smooth* on (the default), the app steps down when frames run long. The steps are, in order: render resolution, crowd detail distance, lens streaks, the visual player's rate on the venue screens, then bloom inside the player. It steps back up when there's headroom. Low also turns off shadows, bloom, multisampling and lens effects.
- **Crowd:** dancers are grouped into chunks that are skipped when off screen. Chunks far from the camera swap to a low-detail model with the same skeleton, about half the triangles.
- **Venue and board switches** compile their shaders in the background, holding the last frame instead of stalling on the first one.
- **When the tab is hidden**, rendering stops while the audio engine keeps time. While a dialog covers the stage, the club renders a third of the frames. The UI panels update at 30 Hz.
- Measurements and method (draw calls, triangles, heap and allocation rate, before and after each change) are in [docs/overhaul.md](docs/overhaul.md); the lighting and effects pass (volumetric beams, exposure, confetti, mirror balls, lens, AV sync) is in [docs/vfx-master.md](docs/vfx-master.md).

### Visual player
Ten GLSL modes: Warp Tunnel, Spectrum Matrix, Particle Galaxy, Wave Grid, CRT Monitor, Laser Show, Kaleidoscope, Strobe Geometry, Liquid Chrome and Fractal Flight.

- Driven by sub-bass, kick, snare, vocal and high bands, locked to the master deck's beat grid, with drop detection.
- Post-processing: bloom, chromatic aberration, palette shifts, and camera shake that can be switched off.
- Lyrics as kinetic typography over every mode (see Lyrics on the screens).
- Shows on the venue screens (the warehouse LED wall, the Printworks far wall, the Alexandra Palace LED wall), as picture-in-picture, or as a full-screen visual player.

### Control surfaces
- **Web MIDI**: hot-plug, MIDI learn (click any on-screen or 3D control, then move the hardware control), relative encoders and jogs, LED feedback, and mapping export/import. No brand-specific presets are included — map your controller with MIDI learn.
- **Keyboard**: `Z`/`X`/`C` cue, play and sync the left deck; `M`/`,`/`.` do the same for the right. `1–4 QWER` and `7–0 UIOP` are the pads, `[ ] \` move the crossfader, `↑ ↓` browse, `← →` load, `Shift+1…8` fire the sampler, `N`, `B`, `Y` and the backtick key hold strobe, blinders, lasers and blackout, `T` fires the CO2, `Shift+T` the pyro, `Shift+Y` the confetti, Shift + arrows orbit and tilt the camera, `=` and `-` zoom it, Shift+V steps to the next camera angle, and Help lists everything. Every key can be moved in Settings → Keyboard shortcuts.

## Project layout

```
wasm/dsp.c                 C DSP core → WebAssembly (npm run build:wasm, needs clang with wasm32)
src/audio/                 engine, decks, channel strips, mixer, beat FX, sampler, recorder, worklets
src/analysis/              tempo/grid, key, waveform, PCM parsers, worker pool
src/library/               IndexedDB storage, tags, crates, search
src/setbuilder/            SmartDJ set generation: track profiles, artist styles, key/tempo rules, energy arcs, exports
src/lyrics/                lyric formats (LRC, tags, LRCLIB), vocal activity + alignment, lyrics clock
src/three/                 stage, camera rig (incl. drone and the moving angles), lens pass and looks, board parts and presets, stickers
src/three/venues/          venues, light show director, fixtures (beams, lasers, strobes…), crowd, pyro
src/visualizer/            audio features, visual modes, lyrics typography
src/ui/                    software panels and widgets
src/app/                   app shell, saved settings, control registry bindings, keyboard map, gigs (gigs.ts)
src/game/                  career, vibe meter, gigs and rewards, track metadata (sections, energy, tags)
src/name/                  NameService: name layout, styles, textures, filter, beat reactions
src/character/             character catalogue, looks, procedural avatar
src/core/                  control registry, beat clock, save system, preferences (prefs.ts), settings backup, storage helpers
docs/                      venue research (sources, gaps) and the overhaul notes (measurements)
```

Every operable control is registered once in a control registry (`src/app/controlDefs.ts`). The 3D boards, the software panels, the keyboard and MIDI all drive controls through that registry by id, so every surface stays in sync.

The compiled WebAssembly is committed as `src/audio/wasm/dspWasm.ts`, so building the app doesn't need a C toolchain. Run `npm run build:wasm` after editing `wasm/dsp.c`.
