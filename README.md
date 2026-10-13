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
- a **debug menu**: press **Ctrl+Shift+D**, or open the page with `?debug`, to jump venues, set the fame tier, unlock everything, change the crowd and fire a drop. Its **stutter log** lists every frame that came more than 50 ms late, with what the frame before it was busy with (the 3D stage, the panels, the audio and game side, a venue being built, shaders compiling, a track decoding, or time spent outside the game's own code) and a Copy button

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
- **Results:** a grade from D to S, the vibe over the set against what the slot wanted, your best transition, the crowd's peak, and fame, cash and followers. The grade stamps down with a thump, the earnings tick up, anything new pops in with a chime, and behind the headline the replay buffer's pictures from around the crowd's peak play again, slowly pushing in. Finish above 75 % and they call for an encore.
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
- **Genres:** every track gets a genre in the library's Genre column. It's the file's own genre tag if it has one (tidied, so "hip-hop", "HipHop" and "Hip Hop" sort together). Otherwise it's a guess from the sound: House, Deep House, Tech House, Techno, Trance, Hardstyle, Drum & Bass, Dubstep, UK Garage, Disco, Afro House, Trap, Hip Hop, R&B, Pop, Reggaeton, Lo-fi or Ambient.
  - Sort by the column, pick a genre in the filter next to the key filter, or type one in the search ("trap", or genre:house).
  - A guess has a dashed outline, and a "?" when it's unsure. When it can't tell close styles apart it says the family ("House" rather than "Deep House or Afro House").
  - Click a genre (or right-click the track) to set your own. Your pick wins over the tag and the guess, and goes in the crates-and-cues backup.
- **Spotify and SoundCloud** can't be connected. Spotify's developer policy rules out DJ apps and mixing its content, and SoundCloud's API rules out modifying or mixing tracks. Both deliver their audio in a form a browser mixer can't process. Bring the track list and your own files instead.

### The daily challenge
One gig a day, the same for everyone who plays it that day.
- **What it is:** a 10-minute set on any of the career's stages (locked or not: a guest slot), in a given slot, with a twist on the crowd (a cold room, a hometown crowd, a restless one) and three objectives from the bookings' list.
- **One result a day:** the first finished set is your result for the day. Play again as much as you like, but later sets are practice.
- **Streak:** a 🔥 streak counts the days in a row you've played.
- **Share it:** the results screen has a **Copy result** button that copies a few lines to paste anywhere, like this:
  ```
  Deckhouse Daily #284 · Basement Club
  A · ✅❌✅ · 12,450 pts
  🟥🟨🟨🟩🟩
  🔥 3-day streak
  ```
  The squares are the room's vibe, one per two minutes.
- **Where to find it:** a dot on **Play a gig** shows while today's challenge is waiting. It's at the top of the bookings, and on Home.

### Gigs: streaks, requests and the coach
- **Live score** in the gig HUD.
- **Streak:** clean transitions, built drops and comebacks in a row multiply their points (×1.25, ×1.5 … up to ×2). A trainwreck, a key clash, dead air, redlining, too many drops or a repeat breaks it.
- **Crowd requests** every couple of minutes, with a timer: more energy or less when the room is off the slot's curve, otherwise a drop, a long blend, a filter fade or something new. Met requests pay points and lift the vibe; missed ones cost a little.
- **Next-track coach** (Chill and Club): a track from your crate that's in key, close in tempo and at the energy the slot wants next, with a Load button.
- **Up next, in every mode:** the coach also runs outside gigs (free play, Auto DJ, a fresh start).
  - An "Up next" card sits bottom-right on the stage, with Load and ↻ for another pick.
  - The Library shows its top three picks over the table and tags them "next" in the list.
  - An empty deck offers one with "Try: …".
  - Outside a gig it aims a step above the energy that's playing, so the night keeps building. Before anything is loaded it picks a warm opener.
  - It never suggests what the room has heard or what's on the decks.
  - Settings → Show & venue turns it off.
- The results show your best streak and how many requests you met.

### Party: hype dancers and the air horn
- **Hype dancers:** two glam go-go dancers on glowing podiums either side of the booth, in every club (not the Bedroom).
  - They dance on the beat: a new move every two bars (sway, waving, hair flips, pointing at you, body rolls).
  - They clap overhead through the build and jump on the drop.
  - Show → Party switches them off.
- **The air horn** (Show → Party, or Shift+J) works as often as you like.
- **The crowd's signs** carry a few funny lines at every venue ("TOLD MUM I'M AT THE LIBRARY", "MARRY ME DJ", "MORE COWBELL").
- **New wardrobe pieces** for anyone: a crop top, a sequin halter top, mini and sequin skirts, and go-go boots.

### The crowd
- **Regulars:** eight fictional fans (Jess, Marco, Priya, Theo, Ama, Kenji, Rosa, Dev), each with their genres. Play their music and they come back, then move to the front with a hand-made sign; ignore them and they drift away. The HUD says who's in, and the results show who moved closer.
- **Dance styles by genre:** house crowds jack, techno stomps, drum & bass bounces, slower music sways, blended as the music changes.
- **Crowd moments** start by themselves when the night is right (Show tab → Crowd to pick one, or turn auto off): a conga line that snakes through the room, everyone sitting down and jumping up on the drop, a dance circle opening up, lighters (phones) up for the closing track.
- **Hand-made signs:** cardboard signs with requests and messages. When a request is the one on the sign and you play it, they go wild.
- **DJ moves:** six pads (hands up, jump, point, clap, fist pump, climb on the booth), controls `dj.move.1–6`. The crowd copies you; well timed (on a drop) it lifts the room a little and scores.
- **Signature move:** pick one, and it fires by itself on your biggest drops. The fans learn it and copy it.
- **Room outfits:** a glow-in-the-dark tee for the UV room, a chrome jacket for the mirror room and a hologram jacket for the hologram room. Each unlocks by playing that room.

### Career: residencies, the World Tour, promoters, clashes and night events
All in the bookings calendar (Play a gig).
- **Promoters remember you.** Every booking moves how its (fictional) promoter feels: good sets and hit objectives warm them, bad ones and pulling out cool them. Keen promoters pay up to a third more and give you the peak slots; one you let down enough stops calling, and their offers stop. Each card shows the promoter's mood, and a Promoters list under the offers shows them all.
- **Residencies:** from tier 2, a promoter who likes you offers a weekly night at their club. The crowd remembers last week: a track you played then gets a groan and costs a little. Keep it fresh and play well and the room fills up week by week (it shows how full); play stale or badly and it empties. End it any time.
- **The World Tour** (tier 4): a map of real cities with fictional promoters and the game's own rooms. Pick two to five, in order, and they're booked one a night, travelling by van, then train and planes (tier 5), then private jet (tier 6). Each city's crowd has its taste (Berlin wants techno, London drum & bass and garage, Ibiza house on the terrace…): their genres lift the room, and they say so when you're off it. Finish every city for a reward in followers and fame.
- **Festival clashes** (tier 6): you're on at the same time as a rival on the other stage. A panel shows your share of the field; play better than them and their crowd drifts over to you, play worse and you can watch your field thin out. Hold more than half for +20 fame.
- **Night events:** about one set in three something happens mid-set, with a banner and a countdown in the HUD:
  - **Power cut:** the lights die and half come back on the generator. Keep the room up and it pays.
  - **Rain** (outdoor venues only): real rain streaks and its sound, and the crowd tires a little. Dance them through it for a bonus.
  - **Broken channel:** the mixer channel you'd mix in on next goes dead (the room can't hear it) until the tech fixes it.
  - **Fire alarm:** the speakers go quiet (your headphones still hear the decks) and the room waits. When it ends, drop something big to bring them back.
  The daily challenge, B2Bs and Room Battles have no night events. The debug menu can force one for the next set.

### Home: the shop and achievements
- **The shop** (Home → Shop) is where your cash goes:
  - **Wardrobe early:** any piece, outfit set, hair style or eye style that fame or a count of sets would unlock, priced by how far off it is (about $130 for a Rooftop piece, $1,200 for a Sunrise one; a set costs 2.5 times a piece and comes with its pieces).
  - **A bigger home:** move to the studio ($600) or the penthouse ($2,500) before your fame does it for you.
  - Milestone, rival and secret-room pieces can't be bought; they stay earned. Locked wardrobe pieces say when the shop sells them.
  - Buy asks once more ("Confirm $300") before it spends.
- **Achievements** (Home → Achievements): 20 long-run goals, each with bronze, silver and gold levels (sets played, minutes in the booth, perfect transitions, bass swaps, long blends, key mixes, drops, S grades, encores, sold-out shows, objectives, venues, boards, fame, followers, cash earned, cash spent, clips, the daily streak and milestones). Each level pays $50, $200 or $750 the first time. The wall shows how far you are to each next level, your milestones and your career totals.
  - New levels show on the results screen with what they paid, or as a toast when they come from a clip, the daily streak or the shop.
  - An older career gets the levels it has already earned the first time the wall is opened.

### Playing: scratch challenges, stems, mashups, the harmonic wheel and your label
In the ⋯ menu under **Play**.
- **Air DJ** (⋯ menu → Air DJ, or Shift+H): play with your hands in front of the webcam, no controller needed. Each hand works the deck on its side of the picture:
  - **pinch** thumb and index to grab the record, and move your hand left and right to scratch (with the jogs set to vinyl)
  - **open palm** for the filter: raise it for the high-pass, lower it for the low-pass; take the hand away and it glides back to off
  - **peace sign** holds the beat FX on that deck, higher for more
  - **point** and slide your finger for the crossfader
  - **both palms up high** for the "hands up" move, and the crowd copies you
  - a **fist** rests. A small mirrored camera window on the stage shows the hands it sees and what each one is doing; the 3D board moves with you.
  The first time, a guide explains the set-up and every move before the camera turns on; it's there again from the ? on the Air DJ window and in Help. Hand tracking (MediaPipe) runs in the browser and the picture never leaves your device. Its model (about 10 MB) downloads the first time you turn it on.
- **Scratch challenges** (opt-in, scored; not a tutorial): baby scratch, forward scratch, stabs and triplets on the jog wheel, a transformer on the fader, and a beat juggle across two decks, each against a click with the pattern scrolling in a lane. Every hit is judged on timing (perfect within 50 ms, good within 100 ms) and direction, for points and up to three stars; your best is kept. Use your controller's jog, the board on the stage, the record on screen (drag it round) or the arrow keys; the fader, the Cut button or Space; deck restarts or 1 and 2.
- **Live stems:** each mixer channel has drums, bass, melody and vocals buttons (and knobs, `ch.N.stem.*`, for a controller). It's a filter split, not true source separation: bass is the lows, drums the highs (hats and snares), vocals the centre of the mids, melody the rest. The four always add back up to the original, so untouched the sound is unchanged.
- **Mashup builder:** pick a track for the vocals and melody and a track for the beat. It matches the tempo (by resampling, like a turntable's pitch, so it says how far the key moves and how the keys sit), finds each track's best section and lays out the arrangement on a timeline: B's intro, A's top over B's beat, B's drop, A's best part, A over B again. Make it (rendered in the browser), listen, and save it to your library.
- **Extended edits:** one track rearranged for DJs: a long intro, the groove, the drop, the breakdown, the drop again, the outro.
- **Your label:** release your mashups and edits on it (named after you, or rename it). Over the following nights the fictional rivals play your releases in their sets (their posts show up in the feed), and a rival in a B2B with you will sometimes drop one of yours. Each release counts its plays and who played it.
- **Harmonic wheel:** the Camelot wheel with what's playing lit up and the keys that mix with it glowing (brighter for smoother). Your tracks are dots round the wheel, and the best of them are listed, ranked by key and tempo, with Load buttons. It follows the music while it's open.

### Show: drones, fireworks, projection, VJ mode and your own visuals
- **Drone show** at the open-air venues: 360 drones fly formations (a grid, a sphere, a ring, a heart, a star and your DJ name) over the site after dark at the peak, or on the Show tab's pad.
- **Fireworks finale** at the festival, the beach and the boat: shells go up over the last track. A pad fires a volley anywhere under the open sky.
- **Projection mapping:** the visual player thrown onto the surroundings: the skyline towers from the Rooftop Bar, the headland at the Beach Club, the boat's hull.
- **VJ mode** (⋯ menu): a second person runs the visuals and lights from another window or another device. Same browser: open the link on a second screen. Another device on the same network: swap two codes by hand (WebRTC, no server, local network only). The VJ gets the visual modes, the light pads, the palette and crowd moments, and can hold their picks against the auto director.
- **Visual editor** (⋯ menu, or the Visuals tab): stack layers (tunnel, shapes, spectrum ring, starfield, grid floor, your name, waveform) on a background, each with its colour, strength and speed, add a kaleidoscope, and save up to three looks. They play like any other visual mode.

### Sharing
- **Ghost replays:** your best run of today's daily is kept, and when you play it again its ghost runs alongside: a faint marker on the vibe meter, how far ahead or behind you are on points, and a faint line on the results graph.
- **Set codes:** "Share this set…" turns the tracklist (title, artist, BPM), the venue and, in a crazy room, its look and scenes into a short code to paste anywhere. "Open a set code…" goes to the venue, sets the room up and makes a crate of the tracks you have, in order, listing the ones you don't.
- **Highlight card:** a picture card of your set (the crowd at its peak, your grade, score and best transition) to save or copy from the results.

### Auto DJ
Turn it on from the ⋯ menu (or Shift+A) and it mixes by itself, the way you would on two decks:
- **What comes next:** the next track of your Set Builder set; without a set, the best match in the library (a compatible key, a tempo within a few percent, allowing half / double time, not played this session). Load something onto the free deck yourself and that's the next track.
- **When:** it cues the next track on its first downbeat, syncs it and cuts its bass, then starts it on an 8-bar line of the outgoing track: the last one that leaves room for the whole mix before the end.
- **How:** over 8, 16 (default) or 32 bars (Settings → Decks) the crossfader moves across (the channel faders on mixers without one) and the basses swap at the half. The outgoing deck stops; the incoming one keeps the tempo it was synced to, so nothing jumps; the next track gets ready on the deck that just finished.
- **Taking over:** touch the crossfader, a channel fader or bass knob of deck 1 or 2, or play / pause, and it hands the mix back. A chip in the top bar shows when the next mix starts and how far through it is; click it to stop.
- With the auto director on too, it's a hands-off show.

### The screen
- **Title screen:** the game opens on DECKHOUSE in chrome with glowing sides, hanging over a slow camera glide through the club at night with the lights moving over it. Any key, click, tap or controller button starts: the name flies past the lens and the camera walks you in. (Open the page with `?title` to see it again.)
- **Walking in:** switching venues is a short arrival shot instead of a cut. A card with the venue's name and city, then the camera comes in from the doors, over the crowd and up to the booth in about six seconds. Starting a gig walks you in too (even into the room you're in), with the night's flyer pinned beside the venue's name. A click, tap or scroll skips it.
- **Codes** (⋯ menu → Enter a code…): type **FAME** to open every venue and secret room for gigs and max out your fame (the top tier, Legend, with everything the tiers unlock). Case doesn't matter; a wrong code just says it doesn't do anything.
- **Broadcast mode** (⋯ menu or Shift+O): the stage alone, filling the window, for streaming the game or leaving it on a screen. The auto director cuts the camera with the music, each new track's name slides in, and the pointer hides when it's still. Esc, Shift+O or the Leave button (it shows when the pointer moves or you tap) bring everything back. As a **screensaver** (Settings → Show & venue) it comes on by itself after 2, 5 or 10 minutes without a touch while music plays, and any touch ends it.
- **Photo mode** (camera menu, Shift+P, or Photo mode on the camera bar): the stage full screen with a camera's controls. Focus stays on you as the camera moves (*Focus on DJ*); tap anything in the picture to focus there instead, or set the distance. The aperture (f/1.4 to f/16) sets how shallow the focus is, and the lights behind open into soft bokeh. The camera can come right round you for a close portrait (outside photo mode you're hidden when it's that close, so you don't block the board). *Hold the moment* freezes the room (the lights, the crowd mid-jump, confetti in the air) while you still move the camera round it. Six filters (mono, noir, warm film, cool night, punch, faded), a thirds grid, and frames of 16:9, 4:5, square, 9:16 for a story and 2.39:1. The photo saves cropped to the frame. Esc leaves.
- **One style everywhere:** every button uses the same set of line icons (one stroke weight, one grid), the type sits on one scale, and panels, menus, dialogs and toasts move the same way (a short rise and fade, eased the same). It all stays still with reduced motion.
- **It moves with the music:** the top bar's accent line, the active tab and the vibe meter's lit cells pulse on the beat, and the gig's vibe meter flows, with a sheen running through it and its leading edge swelling on each beat (Settings → Appearance; off with reduced motion).
- **Interface sounds:** soft clicks on buttons and tabs, a whoosh as dialogs open and close, a low two-note warning on errors, and on the results a stamp, ticks and an unlock chime. They play straight to the output, never into the mix or a recording, and the performance controls (decks, mixer, effects, sampler, light pads, the 3D board) stay silent. Notices don't chime, because they come mid-mix. Volume or off in Settings → Appearance.
- **Now playing:** when a new track takes over, its title, artist, BPM and key slide in at the bottom of the stage like a broadcast graphic (Settings → Show & venue turns it off).
- **Board full screen** (the full-screen button on the stage, Shift+B, or the ⋯ menu): the 3D board fills the whole screen and everything else goes away. Top-down or Angled framing, plus the full camera menu (every angle and your saved views). A camera bar along the bottom changes the angle while you play: hold to orbit round the board, look from higher or lower and zoom, go back to the board view, or step to the next angle (on the keyboard: Shift + arrows, `=` and `-`, Shift+V; all MIDI-learnable; it folds away). The angle you pick is remembered for next time. Every control, the keyboard and MIDI keep working; Esc brings the rest back. Inside embedded viewers that block browser full screen it fills the window instead, and on phones it turns to landscape where the browser allows.
- **Top bar:** board, venue, the crowd meter, master BPM, Rec, the **Simple / Pro** switch and the **⋯** menu. The ⋯ menu holds the stage view (Booth, Split, Visuals; also the `V` key), full screen, the layout switch, MIDI and help. A MIDI pill appears only while a controller is connected.
- **Simple** (the default) keeps each deck panel to what you mix with: title, key, BPM, time, the overview waveform, Cue / Play / Sync and tempo. **Pro** adds Master, the tempo range, the pads and pad modes, the loops/key/stems drawer and the 🎤 lyrics button. Nothing is removed in Simple: the deck's ⋯ menu, the 3D board, the keyboard and MIDI still reach everything.
- **Waveform strip:** a lane for each deck on the left and right, plus any other deck with a track loaded.
- **Five tabs:** Library · Set Builder · Mixer & FX (with the sampler) · Show (venue, lighting desk, visual player, lyrics) · Settings (with MIDI).
- **On a phone:** one row of controls in the top bar, short tab labels, touch targets of at least 44 px, and no sideways scrolling.
- **Picks up where you left off:** a reload puts the tracks that were on the decks back on them.
- **Accessibility:** keyboard focus is visible everywhere. The camera's idle drift and beat shake stop when the system asks for reduced motion (or when you turn camera motion off in Settings). Interface size goes from 80 % to 130 %.

### Settings and customising
Everything you can change is on the Settings tab, in sections with a search box (type "key", "colour", "loop", "crowd"…):
- **Appearance:** interface size (the panels around the stage; the 3D board keeps its own pixels), Simple / Pro layout, accent colour (follows the venue by default), the four deck colours, **key notation** (Camelot `8A`, Open Key `1m`, musical `Am`, or Camelot plus musical — used in the library, on the decks, in the Set Builder, by the crowd and on the board screens; library search understands all three) and **waveform colours** (RGB, 3-band blue/orange/white, blue, or one colour), interface sounds and the beat pulse.
- **Decks:** tempo range, jog wheels (vinyl scratch or CDJ pitch bend), loop size, beat-jump size, key lock and quantize for every deck, the **end-of-track warning** (the time and overview blink red, and the board's jog ring and screen turn red; off, or the last 15–90 seconds) and the load lock (don't load onto a playing deck).
- **Audio:** auto gain, fader curve, split cue and the headphone output.
- **Board & camera:** the board and finish, stickers, hover zoom, camera motion, saved camera views.
- **Show & venue:** the venue, **crowd size** (from an empty room to 150 %; fewer people is also lighter on slow computers), Reduce flashing, how long a free-play **night** lasts at the open-air venues (10 to 90 minutes of music from sunset to dark, or dark to sunrise; a gig follows its set), the broadcast-mode **screensaver** and the **lights and visuals delay**. The lights already wait for your audio output's measured latency, so they land with the beat you hear; if they still run early (Bluetooth speakers often under-report), add up to 400 ms. The Show tab adds a **Custom** light palette with three colour pickers.
- **Performance:** graphics quality, automatic adjustment and a frame-rate meter on the stage.
- **Keyboard shortcuts:** every binding is listed; click its key and press a new one (Shift for the Shift layer, Backspace for none, Esc to cancel). A key does one thing: taking a key that is in use clears it from the other action, and the app says so. Reset one key or all of them.
- **Your settings:** export everything (preferences, keyboard, MIDI mappings, saved views, Set Builder options) to a file, import it in another browser, or reset to the defaults. The music library isn't part of the file. Saved and imported settings are checked on load, so an old or edited file can't break the app.

### Boards (3D, Three.js)
- **Easy to read in any room:** a soft deck light over every board, print drawn larger and brighter than the real silk-screen, lit fader slots, satin knob caps with bold pointers, backlit buttons and pads that glow faintly even when off, and an outline round the control you're pointing at. The performance view frames the hardware so its controls fill the picture.

| Board | Class | Decks |
|---|---|---|
| Starter Two | Entry-level 2-channel controller, with a laptop on a stand running the DJ software | 2 |
| All-in-One Two | Flagship 2-channel all-in-one (73 × 47 cm) with an 11.6-inch touch screen that browses your library | 2 |
| Pro Four | Flagship 4-channel controller with on-jog displays, a raised 9-inch centre display (both decks' waveforms, overviews, BPM, key and time), LED filter rings | 4 (layers) |
| Club Standard | Two media players with 11-inch waveform screens + 4-channel club mixer | 4 (layers) |
| Vinyl Battle | Twin direct-drive turntables + 2-channel battle mixer, with a laptop on a stand running the DJ software | 2 |
| Festival Quad | Four media players (decks 3·1 · mixer · 2·4) + 4-channel mixer | 4 (one unit each) |
| Hybrid Booth | Turntables on decks 3/4 outside media players on decks 1/2 + 4-channel mixer | 4 (one unit each) |
| Rotary House | Twin turntables + walnut-cheeked 2-channel rotary mixer (no crossfader, no sync), with a laptop on a stand | 2 |

- PBR materials with a room environment map, real-time shadows from the booth light, bloom on LEDs and screens, printed faceplates.
- **Screens:** every screen is lit about 40 % above paper white, so it reads as a backlit display in a dark booth (kept under the lens's flare threshold). Each sits behind glass that picks up a soft glint of the room. The screens are drawn at higher resolution: 1024×576 on the media players, 1280×720 on the Pro Four, 512×512 on the jog displays and 1280×800 on the All-in-One. Raised screens sit on a housing.
  - The jog displays read upright from the DJ's side. They show the deck number, BPM, time left, a progress ring and four beat dots.
  - The boards with no screen of their own (Starter Two, Vinyl Battle and Rotary House) have a laptop on a stand behind them, running the DJ software: both decks, their waveforms and the library, with what's loaded marked.
- Each board comes in several finishes, and every board carries old stickers and gaffer tape — drawn procedurally and aged (sun-faded, scratched, torn and peeling corners), placed only in free space so they never cover a control. Switch them off in Settings.
- On the one-unit-per-deck boards the software deck panels follow whichever player or turntable you touch.
- **All-in-One Two's 11.6-inch touch screen** works like the real one. Tap its tabs:
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
  - genre from rhythm and tone on the beat grid. It reads four on the floor, the backbeat, a half-time snare, the dembow, 2-step kicks, off-beat and rolling hats and swing. It also weighs the sub/bass/mid/top balance and how clearly the music pulses
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
| Circoloco @ DC-10, Ibiza | A low, dark red room: orange globe lamps over a packed floor, warm bulb strings, red laser sheets, the fan wheel on the wall. Left/centre/right speaker clusters, cream booth monitors on drop rods, the crowd right at the booth. A whitewashed doorway glows onto the terrace, and there's a bar along the side. Black ducts run down the walls under a pipe grid, with fill speakers, drink ledges round the walls and columns, a fire door and potted plants by the doorway |
| Boiler Room, Los Angeles | An outdoor night session under an orange LA sky glow. The crowd is all around (and behind) you with phones up, the plain red neon ring hangs on its wires, City Hall is behind, and a hot lamp sits on a truss tower. No lasers. The stream camera's monitor shows a live render of the shot; try the “Stream cam” view. Round the session: sandbagged truss feet and cable runs, a production gazebo with the stream desk behind bike-rack barriers, a taco truck, cars parked at the kerb, and palms along broad steps up to City Hall's terrace |
| Berghain, Berlin | An 18 m bare-concrete hall with steel pillars. No stage: the booth is recessed into the back wall. A single fixed light bar crosses the room, the stacks stand in the corners, and there's a dim bar in the far corner. Cold white beams, red work lamps and a strobe bank for the peak; no lasers, no phones. What's left of the power station: a travelling crane girder with its hook and chains, old pipes with valve wheels and gauges, a bank of control cabinets with a few lamps still lit, a big sliding steel door, and a spiral stair up to the balcony |
| Printworks, London | The 112 m press hall: three levels of gantries the full length, part-lit printing presses down both sides, 17 cold LED strips up each side wall chasing the beat, press outlines on the floor, and a far-wall screen. The overhead rig of light bars lowers through the build-up and slams down on the drop. Steel stairs and caged ladders climb the gantries, crane rails and girders and big ducts cross the roof, and the stage wings hold racks and cases |
| Alexandra Palace, London | The Great Hall at its published size (116.6 × 55 m, a fabric barrel vault rising to 25 m), with the organ on its gallery and the rose window at the far end. An arena show:<ul><li>a 23 × 7 m LED wall with the visual player and the pit camera cut in at the peak</li><li>LED towers cutting between four cameras on the phrase</li><li>flown PA with delays</li><li>three stage and three audience trusses of beams and strobe bars</li><li>14 laser projectors around the hall, CO2, sparks and hazers</li><li>a mix position mid-floor, and about 8,000 people</li><li>the hall dressed: skirting and dado rail, cast-iron radiators, lamps on the columns, signs and extinguishers at the doors, monitor risers in the wings, queue lanes at the bars and a merch stand</li></ul>Best shots: “From the stage” in a breakdown (the liquid sky over the crowd), and “From the crowd” on the drop |
| Alexandra Palace · In the round | The same hall with the decks on a round riser in the middle of the floor and the crowd all the way round. 43,000 hanging lights over the whole room play the music in 3D: ripples out from the booth on the kick, rain in breakdowns, sheets of light through the build, a shell of light bursting out on the drop, turning planes at the peak. Lasers fire up through the field from the riser. Surround PA. Best shots: “From the organ gallery” in a breakdown, and the drone on the drop |
| Burning Man, Black Rock City | Burn night on the open playa, laid out from the city plan. You're on the top deck of a sound art car on the burn perimeter, 1,000 ft from the Man at about 5:30:<ul><li>the Man on his timber pavilion, outlined in neon</li><li>the Temple out past him at 12:00</li><li>the lantern spires every 150 ft down the promenades</li><li>the city's horseshoe of lights from 2:00 to 10:00, its Esplanade 2,500 ft from the Man, with Center Camp at 6:00</li><li>the hills round the lake bed (the Granite Range highest, to the west), the Milky Way over it all</li></ul>The art car has a canopy of LED ribs, LED screens on its hull and behind the DJ, lasers, heads and propane poofers. Parked alongside is an original fire-breathing mechanical octopus that throws fireballs on the drop. Art cars crawl past at 5 mph, bikes in EL wire ride loops round the Man, and the crowd is in fur and goggles. The set runs from the dark to sunrise, when the hills go magenta. Hold a peak in the dark and the Man burns: his arms go up, fireworks go off his base, the fire takes the pavilion and climbs him, he falls, and it burns down to a glow. Best shots: “From the next art car” and the camcorder (turned round to the Man) |
| Deckhouse Warehouse | A raised stage, an 11 m LED wall with the visual player and a truss of moving heads. Steel pillars carry LED battens that chase down the room; block walls, a bar and exit signs. A black drape with a twinkling star cloth hangs behind the stage, and ducts, trays, bar stools, a drink ledge and poseur tables fill out the room |

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
- **Show effects the big tours use now** (`showfx.ts`):
  - **LED wristbands** on everyone at the Main-Stage Festival and Alexandra Palace, driven by the show as at stadium tours:
    - colour sectors drift round the crowd in the groove, with stars in a breakdown;
    - waves run out from the stage through a build, faster as it tightens;
    - every band fires on the drop, then a ring of colour runs out through the crowd;
    - at the peak the two halves of the room swap on the beat.
  - **Kinetic lights**: a grid of LED spheres on motor winches over the floor of the Warehouse Rave, and a small one in the Deckhouse Warehouse.
    - They fly in formations: a new wave, tilt, ripple or dome each phrase.
    - They go up into the roof for a breakdown and come down slowly through a build.
    - On the drop they form a V or a dome, and at the peak they ripple on the beat.
    - Winch speed is capped at real-world speeds.
  - **Holographic gauze** across the front of the festival stage, as at the big "hologram" DJ shows. The content is drawn for the mix tent's view, so shapes seem to hang in the air in front of the booth:
    - a turning wireframe solid, a new one every 16 bars;
    - a tunnel of rings rushing out at you through a build;
    - a burst on the drop.

    From behind it's a faint reverse.
  - All of them follow Reduce flashing.
- Lighting desk (Show tab): follow-the-music on/off, drop FX, pyro on drops, **Reduce flashing**, palettes (including a Custom one with your own three colours), laser mode and look, intensity, haze, confetti on drops, and pads for strobe, blinders, lasers, CO2, pyro, confetti and blackout. The pads are also on the keyboard (N, B, Y, T, Shift+T, Shift+Y, ` by default; each pad shows its current key) and MIDI-learnable.
- **Reduce flashing** keeps strobes, blinders and blinking lasers under 3 flashes a second, softens them, skips the blackout before the drop and turns off the crowd's phone flashes. It's on by default if your system is set to reduce motion.
- All fixtures are instanced: volumetric beam cones that throw pools of light on the floor, camera-facing laser beams, dotted LED strings, glowing globes, CO2 particle plumes, drifting haze, dust in the booth light and colour-washed fog.
- **Set dressing in every venue** (`dress.ts`): the parts that make a room look used rather than built for the shot. Indoors that means ducts with hangers, cable trays, sprinkler pipe and conduit; fire doors with push bars, extinguishers, call points and breaker panels; flyers pasted over flyers, spray paint and neon words; road cases, amp racks with LEDs on the kick, hazers, monitor wedges, cable ramps, barriers and FOH desks; worn floors with cups and cans underfoot. The open-air sites get festoon lights and bunting, trees, hay bales round fire pits, bell tents, bars under canvas, food trucks, toilets, light masts, generators, site cabins, lorries, trackway, fences and trodden mud. Each venue's pieces merge into a handful of meshes (plain colours share four materials, the colour carried per vertex), glow lights of a kind share one material, and the litter is instanced. Neon holds steady with Reduce flashing on. Every sign is a generic word and every flyer a made-up night.
- **Landmarks in the distance** (`landmarks.ts`), so the world carries on past the crowd:
  - a funfair big wheel turning past the festival field;
  - hot-air balloons over the sunrise valley, burners glowing in the dark and climbing as it gets light, and birds at dawn;
  - at the beach, a lighthouse sweeping the bay from its headland, a town lighting up along the far shore, and gulls by day;
  - airliners crossing the sky, one coming in low over the rooftop.

  They follow Reduce flashing too, and see through the haze a little more than the rest of the scene.
- **A real sky over the open-air venues** (festival, beach, boat, sunrise, Burning Man, rooftop): the sky is worked out as sunlight scattering through air, the way a physical sky model does (blue overhead by day, a red sun low down, the glow after sunset, the Earth's shadow and the deep blue of twilight, stars coming out). There are two layers of cloud: puffy cumulus low down and streaks of cirrus high up. They drift, are lit from the side the sun's on, and stay pink after the sun has gone. The moon rises orange near the horizon and climbs white, lit on the side facing the sun, and lights the night a little. The sky lights the scene too: the sun's colour on the key light, the sky's colour as the fill, the haze matching the horizon, and reflections in chrome and wet floors showing the real sky. Each venue has its own air (Burning Man is dusty, the boat and beach clear) and cloud.
- **Water at the beach and on the boat**: open sea with rolling swells and chop that move the surface, reflecting the sky with a Fresnel edge (dark looking down, mirror-like at a low angle). The sun and moon lay a glitter path across it. The stage lights, the town along the shore and the boat's deck lights shimmer on the water as columns of broken light. Waves break into white surf along the beach, and the boat leaves a wake and a foam trail behind it as it moves.
- **Life in the air**: dust specks drift through the room and light up only where a beam passes through them, so the beams sparkle. A packed, hot crowd steams: wisps rise off the floor at the peak and catch the lights (not in cold rooms, and it clears in the quiet). Faces and arms pick up a sweat sheen as the night peaks.
- **Shadows where things meet and shine on the floor**: ambient occlusion darkens where things meet (under the booth, round people's feet, between bodies, in corners), while lamps, screens and beams keep their full brightness. Polished floors and stage decks reflect the bright things over them (screens, beams, lamps, lasers), blurred by how worn the floor is, and strongest at a low angle. Both run on Medium and High.
- **The room in the hardware**: indoors on Medium and High, jog wheels, chrome, screens and glossy tops reflect the show (the wall in front of you in the first show colour, the side walls in the others), brightening with the wash and moving heads and flaring on blinders and strobes. A soft booth lamp overhead keeps the board as readable as before. Outdoors they reflect the sky.
- **Modelled gear**: trusses are real tube truss (chords, zigzag bracing, couplers at the joins); speakers are rounded cabinets with perforated grilles, the drivers showing through, handles and rigging; booths have aluminium trims, a kick plate and a rounded top.
- **Rooms with edges:** bars, exit signs and doorways. Every booth has a laptop on a stand, drinks, a cable run and gaffer tape. Concrete, plaster and floors carry procedural normal and roughness maps, so lights catch relief and floors shine unevenly.
- **Big rooms**: at Alexandra Palace the jointed dancers fill the front of the floor and thousands of animated cut-outs fill the rest (one draw call, two triangles each). The cut-outs are drawn from the same 3D person as the dancers, in four of their poses, shaded, some with long hair, so the back of the room matches the front. They bob on the beat, raise their arms with the crowd, jump on the peak and hold phones up, lit by the beams sweeping over them.
- **The crowd**: every dancer is a jointed figure posed on the GPU. Knees bend on the beat and on kick transients, hips sway, shoulders twist, heads nod and look around. People mix club-dance arms, hands in the air, fist pumps, clapping overhead through build-ups and arms up (with a jump) on drops and hook lines, and some film on phones whose screens and torches light up. LED-dot signs ("ONE MORE TUNE", "HI MUM"…) are held up near the front, VIP guests stand by the booth with drinks, chatting and filming, and some dancers turn to their friends. The weight goes from leg to leg on the beat, one foot coming up, and the body leans into it. Each figure is built from smooth, tapered parts (calves, knees, elbows, a pelvis, a one-piece head with a jaw and chin, a nose, ears and thumbs), with a face that reads at a distance: eyes with a catch light, brows, a mouth, a little colour in the cheeks. Hair is a shell with a fringe that thins out at the hairline; some have long hair, a quiff or a cap. The clothes have their details painted on: crew or V necks with a ribbed collar and hem, tonal stripes, a colour block or a small abstract print on the chest, belts with a buckle, jeans with twill, seams and worn knees, shorts with a hem, and trainers with a sole, laces and side stripes. Skin, cotton, denim, hair, rubber and plastic each have their own sheen. Tops, trousers, shoes, skin, hair and build vary, and more people wear shorts at the beach and festivals. Every dancer casts a soft contact shadow. (No phones, signs or VIPs at Berghain.)
- **One art direction, stylised realism**: the light, sky, water, haze and materials are physically based, and the people and props are designed shapes with clean, smooth forms, so the two sit together. Hard-edged props (road cases, bars, crates, furniture, risers, steps, desks) have bevelled edges that catch the light, and cushions and mattresses get deep ones so they look padded. The bevels add no vertices and about 2–3 % more triangles per venue.
- A crowd meter tracks the room: it rises with the music, beat-locked blends and drops, and falls with trainwrecks and key clashes, with call-outs on the stage.
- **You at the decks**: when you move a fader, knob, button or jog wheel (on screen, on the 3D board, from the keyboard or a controller), your character's hand goes to it, fingers curled round the cap or flat on the platter, and stays a moment before going back to the groove. Hands have jointed fingers. The face moves with the music: the brows lift through a build, the mouth opens on the drop, and the eyes go from the decks up to the crowd at the peak. Headphones are on by default, worn the DJ's way on one ear with the other cup pushed up (or on both ears, or round the neck: Dressing room → Moves). While a channel is cued, the head tips into the cup and every few bars a hand comes up to press it in. Skirts, towels, lanyards and hoodie strings swing with the body.
- Each venue has its own camera angles (over the shoulder, stream cam, balcony, gantry, from the stage, from the organ gallery, from the crowd); you appear in the booth in those shots, hands on the decks.
- **Moving camera angles** (camera menu), placed for each room:
  - **Fisheye on the booth**: a little camera clamped to the front of the booth, looking back up at the DJ through a real fisheye lens; the bass shakes it.
  - **Crane sweep**: a jib swinging round in front of the DJ and rising and falling, once every 8 bars, in widescreen with teal-and-orange colour.
  - **Lighting rig**: from up in the truss, looking down at the booth and the front rows, with a tilt-shift blur that makes the room look like a model.
  - **Security camera**: a high corner of the room, black and white, scanlines, a burnt-in clock and REC, a slow motorised pan, and a choppy 8 frames a second.
  - **90s camcorder**: someone in the front rows filming on tape: handheld wobble, colour bleed, tracking noise, REC and a date stamp.
  - **Dolly zoom**: the camera pulls back while the lens zooms in, so the DJ stays the same size while the room stretches behind them (one cycle every 8 bars).
- **Auto director** (camera menu, `'`, or Auto on the board full-screen camera bar): the camera cuts between the angles with the music like a livestream director: calm, wide shots in a breakdown; the crane, the dolly zoom and the rig through a build, every 4 bars; a cut on the drop to the booth fisheye, the drone, the crowd or the camcorder; every 8 bars in the groove, always on a phrase line and never the same shot twice in a row. Cuts dip quickly through black. Touch the camera (drag, camera bar, keys, or pick an angle) and it hands over to you.
- **Photo** (camera menu, `Shift+'`, or the camera icon on the camera bar): a quick full-resolution still of the stage as it looks, lens look and burnt-in text included, to save. For focus, filters and framing use photo mode (see The screen).
- Long camera moves (across the room, through walls) cut through a quick dip to black instead of flying.
- **Lens looks** (camera menu → Lens, Settings → Board & camera, or the lens button on the board full-screen camera bar): Auto gives each angle its own look; or put any look on any angle: Clean, Fisheye, 90s camcorder, Security camera, Tilt-shift miniature, Cinematic widescreen, Thermal or Night vision. Zooming in on the board always shows it clean.
- **Drone FPV** (camera menu): a looping fly-through of each venue — over the crowd, banking past the pyro, gliding across the front of the booth and swinging round to look at the DJ — with a wide lens, barrel distortion, colour fringing and a zoom blur that grows with speed. It flies faster as the energy rises.
- **Screens**: LED walls (Alexandra Palace, Printworks, the warehouse) read as LED up close (pixels, tile seams, dimmer off-axis). The IMAG towers use a broadcast grade and go monochrome through build-ups.
- **Lens and grade**: bright fixtures (beam lenses, lasers, strobes, flames) throw anamorphic streaks and faint ghosts; the brightest points turn into six-point stars (four on medium), and dust and smudges on the lens light up when a wall of light hits it; vignette and film grain (medium and high quality). Each venue has its own colour grade and tone mapping. AgX rolls lights off to white like a camera, for the warehouse, Printworks and Boiler Room; ACES keeps the blacks deep in Berghain and DC-10. Lens effects, tone mapping, grade and output run in one full-screen pass.

### Crazy rooms
Nineteen secret rooms to DJ in, built to move with the music (`src/three/venues/rooms/`), and any you build yourself. Each opens when you meet its challenge in a set; the lock on the venue card says what it is.

| Room | What it does | Opens when you… |
|---|---|---|
| Infinity Mirror Room | Mirrors on every surface reflecting each other into endless corridors, with lasers bouncing round. The panels tilt, spin and on the drop fold into a six-way kaleidoscope. | finish a set with an A or better |
| LED Cube | Every surface is an LED screen: the visual player, the waveform or the spectrum on the walls, ripples on the floor where people stand on the kick. On the drop the room falls away into a tunnel, space or shatters. | land 5 named transitions in one set |
| Kaleidoscope Dome | A dome of mirrored triangles, each tipped its own way, breaking the room into a kaleidoscope that turns with the melody and tints with its note. | play 3 sets |
| Laser Grid Room | Pitch black with a grid of light beams at body height. People break the beams, and every break plays a note in the track's key. On the drop the grid closes into a cage round the booth. | land 3 perfect transitions in one set |
| UV Blacklight Room | White clothes, teeth and tubes glow under UV, and glow paint splats over the walls and floor on the beat and drips down. | play a set in the Basement Club |
| Sound Wave Room | Walls of pins and a ceiling of rods that move like a 3D equaliser: the bass pushes the walls out, hi-hats ripple across the ceiling. | keep the average vibe over 70 % for a whole set |
| Fog Room | Thick fog with solid beams, and sculptures of light overhead: rings, a tunnel, a face, a star. | play a closing set |
| Upside-Down Room | A second booth and crowd on the ceiling. Halfway through the set gravity flips and the camera rolls over to join them. | get called back for an encore |
| Neon Maze | Arches of neon tubes that chase, flicker and pulse to the beat, and spell your DJ name on the back wall. | reach fame tier 3 |
| Water Room | A shallow pool floor that mirrors the lights, rings out on the kick, and curtains of rain that freeze mid-air under the strobe. | play a set at the Beach Club Terrace |
| Hologram Room | A giant hologram of you behind the crowd copying every move, floating faces and shapes that orbit the room. | play in 5 different venues |
| Glitch Room | A clean white gallery that tears into pixels, wireframe and inverted colour when you scratch, echo out or stutter-loop. | finish a set with no mistakes |
| Zero Gravity | A space-station module over a planet. In the breakdowns the crowd and the props float up and tumble; on the drop they slam back down. | play a set at the Main-Stage Festival |
| Aquarium | A glass tunnel on the sea floor: kelp, light shafts, caustics, fish swirling with the melody, and a whale gliding over on the drop. | play the Boat Party |
| Inside a Speaker | You play on the dust cap of a giant woofer. Every kick pumps the cone the crowd stands on and sends a shockwave to the rim. | land 8 drops in one set |
| Vinyl Floor | The dance floor is a turning record with the crowd riding it, light sweeping the grooves, your name on the label and the tonearm creeping in over the set. | mix in key 4 times in one set |
| Lava Lamp Room | Giant lava lamps whose blobs rise and split with the bass and light the room. | play a set at the Rooftop Bar |
| Arcade Room | Inside an 80s game: pixel-art walls, an 8-bit sprite crowd and a giant score that pops on every transition (and flashes MISS). | hold the room at 100 % for a full minute |
| Cloud Room | A deck floating over a sea of clouds at sunset; on the drop lightning flickers inside them. | play the Sunrise closing set |

- **Room panel** (Show tab, in a crazy room): you're the room's lighting designer.
  - Up to six pads play the room's own effects (hits, toggles and holds). Two more recall scenes. All eight are controls (`room.pad.1–8`), so they go on keys in Settings → Keyboard or on a controller with MIDI learn.
  - The room's look is its mode, colour and level. Save it to four **scene slots** and recall one on a pad, or arm one to come in on the next drop.
  - **On the drop**: pick the room's drop moment yourself, or leave it on Auto. In a gig, a moment you chose that suits the drop (a big one for a big drop, a softer one for a gentle one) scores +250.
  - **What drives the room**: with stems, the drums drive the floor, the melody the walls and the vocals the ceiling. You can also swap them round, or let the drums drive everything.
  - **Room sounds**: turns the light grid's notes on and off.
- **The crowd reacts to the room**: they look up and point at the big moments, and more phones come up to film.
- **Room Battle** (pre-gig screen, in a crazy room): you and a fictional rival take turns on the room, 16 bars each. You get the first half of the pads and they get the rest, dimmed on your panel. A press scores by timing: on the beat, more on the downbeat, double just after a drop, nothing for mashing. After both turns the crowd votes, counting presses and how the room felt, and a round won is +500. The results show the score.
- **Photo angles**: each room's wide view is placed for its best shot (the endless corridor in the mirror room, into the dome, both crowds upside down, your name in neon, your hologram). The rig view looks straight down, which in the mirror rooms makes a kaleidoscope.
- **Build a room** (⋯ menu, or the Show tab in any room): pick the walls (mirrors, LED screens, moving pins, neon, glow paint or dark), the floor, the ceiling, extras, three colours and a size. It saves as a venue of its own (up to eight) with the same pads, scenes and drop moments as the others, and can host a Room Battle.
- Safety: the light grid's body-height beams are light, not lasers; the real lasers stay overhead, at least 3 m above the crowd. Flicker, glitch, invert, strobe-freeze and the cloud room's lightning all follow Reduce flashing.

### Performance
- **Graphics quality** (Settings): Low, Medium or High is the ceiling (High by default). With *Adjust automatically to keep it smooth* on (the default), the app steps down when frames run long, effects first and sharpness last: lens streaks and crowd detail, then ambient occlusion, floor reflections and the visual player's rate on the venue screens, then bloom inside the player, and only then the render resolution, to 90 % and never below 80 %. It steps back up when there's headroom. Low also turns off shadows, bloom, multisampling, lens effects, ambient occlusion and reflections.
- **Sharp picture:** a contrast-adaptive sharpening step in the output (stronger on the board and when the resolution is scaled down), the GPU's best texture filtering on every board and venue texture, depth-aware ambient occlusion (no halos round objects), smooth light beams (no dither stripes) and antialiased foliage.
- **Crowd:** dancers are grouped into chunks that are skipped when off screen. Chunks far from the camera swap to a low-detail model with the same skeleton, about half the triangles.
- **The sky** is worked out once into a small table (128 × 64) that is only redrawn when the sun or moon has moved enough to show, and the dome reads from it. The sky's reflection (a 32-pixel cube) is redrawn every four seconds, or straight away when the light jumps. The water is one mesh in rings, fine near the camera and coarse at the horizon. Dust in the beams is one draw of points lit in the vertex shader; it's off on Low.
- **Photo mode's** depth of field is a pass that only runs while photo mode is open.
- **Venue and board switches** compile their shaders in the background, holding the last frame instead of stalling on the first one.
- **When the tab is hidden**, rendering stops while the audio engine keeps time. While a dialog covers the stage, the club renders a third of the frames. The UI panels update at 30 Hz.
- Measurements and method (draw calls, triangles, heap and allocation rate, before and after each change) are in [docs/overhaul.md](docs/overhaul.md); the lighting and effects pass (volumetric beams, exposure, confetti, mirror balls, lens, AV sync) is in [docs/vfx-master.md](docs/vfx-master.md).

### Visual player
28 modes, grouped by how hard they hit:

| Group | Modes |
|---|---|
| Calm (breakdowns and warm-ups) | Wave Grid, CRT Monitor, Liquid Chrome, Acid Plasma, Aurora, Deep Water, Op Art, Ink Flow |
| Groove (the body of the set) | Warp Tunnel, Spectrum Matrix, Kaleidoscope, Cell Pulse, Sonar, Circuit Board, Mandelbulb, Code Rain, Infinity Mirror, Spectrum City, Morph Cloud, Name in Lights |
| Peak (drops) | Particle Galaxy, Laser Show, Strobe Geometry, Fractal Flight, Hyperspace, Hex Floor, Datamosh, Pulse Orb |

- **Some modes remember their last frame** (feedback): Infinity Mirror folds every frame into the last, Datamosh smears the picture along broken motion vectors until a clean frame lands on the bar, and Ink Flow carries coloured ink on a curl-noise current.
- **3D scenes:** a night drive through towers that grow with the spectrum (Spectrum City), 60,000 points that become a new shape every four bars (Morph Cloud), and a sphere the spectrum pushes out (Pulse Orb).
- **Name in Lights** puts your DJ name on an LED marquee that steps along with the beat.
- **Modes change over on the beat.** The old mode fades, irises, slices, zooms or pixels away over one beat.
- **Every song has its own look** (Show → Visuals → *Follow each song*, on by default). The colours come from the song's key, so related keys get related colours and minor keys go deeper. How bright and saturated they are comes from the genre, and the song itself picks the colour scheme. Those colours flow into every mode. The auto VJ plays eight modes that suit the genre: hard geometry and op art for techno, warm liquid looks for house, flight and lasers for trance, datamosh and particles for bass music, calmer scenes for ambient and lo-fi. Each song also picks its own drum, melody and vocal styles. When the lead track changes, the new look eases in: the colours over a few seconds, and a four-beat fade to the new song's opening mode on the next bar.
- **Drums, melody and vocals each have their own layer**, over whatever mode is playing. The live mix is pulled apart the same way the decks' stem knobs do it: harmonic or percussive, then bass, the centred voice and the rest.
  - **Drums:** the picture punches in on the kick, rings leave the centre, light bars flare at the edges, or the picture shatters into slices on the snare. The hats sparkle in every style.
  - **Melody:** a ribbon of light draws its last few seconds (high notes high), an aurora rises as high as the melody goes, or a light orbits the circle of notes. The colour is the note's, and every mode's colours move with the melody too.
  - **Vocals:** a halo breathes with the voice (wider for high notes), a wave ripples with its pitch, or light rays come out while someone sings.
  - Switch each layer off on its own. The light added is held back where the picture is already bright, so nothing washes out.
- **The big screens are always rotating** through modes from the song's set; the auto VJ can't be switched off. It changes on a bar line at the song's own pace: about every 16 bars for chill tracks, 8 for house, techno and trance, and 4 for bass music and hip hop, pop and R&B, set from the genre and the tempo. On a drop it cuts straight to a peak mode and rotates twice as fast for the next 16 bars. It plays calm modes in breakdowns and never repeats what it just played. Between tracks the screens keep drifting slowly through calm and groove modes. Pick a mode in Show → Visuals to put it up now; the rotation carries on from it.
- **Reduce flashing** (lights desk) applies to the player too: strobing modes flash at most once a beat (every other beat above 165 BPM), always under 3 a second, and softer.
- Driven by the drums (kick, snare and hat hits), the bass, the melody (its note and how high it is) and the vocal (whether someone's singing, and how high), locked to the master deck's beat grid, with drop detection. The club lights use the same split: the pin spots flick on the hi-hats and the DJ's spotlight follows the voice. The lighting desk has a **Song** palette with the playing song's colours.
- Post-processing: bloom, chromatic aberration, palette shifts, and camera shake that can be switched off.
- Lyrics as kinetic typography over every mode (see Lyrics on the screens).
- Shows on the venue screens (the warehouse LED wall, the Printworks far wall, the Alexandra Palace LED wall), as picture-in-picture, or as a full-screen visual player.

### Control surfaces
- **Web MIDI**: hot-plug, MIDI learn (click any on-screen or 3D control, then move the hardware control), relative encoders and jogs, 14-bit faders, LED feedback, and mapping export/import. Once you've allowed MIDI, it reconnects by itself on your next visit.
- **Pioneer DDJ-REV5, built in.** Plug it in (Chrome or Edge on a computer; on Windows install Pioneer's driver so the board shows up) and it works: the mapping comes from AlphaTheta's *DDJ-REV5 List of MIDI Messages*. Transport, sync, key lock, loops, slip, censor, key ±, the jogs (top scratches while touched, side nudges, the position ring lights up), the 14-bit tempo faders, the mixer (trim, EQ, filter knobs, faders, headphone cue, crossfader and its curve and reverse switch, master, headphone level and mix), the browser and LOAD, both FX units and their paddles, and the pads in every pad mode. The deck's pad mode follows the board; SAVED LOOP plays Beat Jump and SCRATCH BANK plays Slicer, the nearest the game has. The four deck pads play hot cues, the sampler or stem mutes. DECK 1/3 and 2/4 move the game's decks with the board, lights and all. In Settings → MIDI controllers: **Calibrate jog wheels** (spin each once, so scratching moves the track as far as the platter) and **Play through its sound card** (master on outputs 1/2, the headphone cue on 3/4 when the browser sees four outputs). Not yet: pad colours (the list gives colour numbers without the colours), the BPM transition and STEMS button features.
- **Any other controller: set up by touch.** Settings → MIDI controllers → *Set up a controller by touch* walks you round the board, one control at a time, about two minutes. It works out 14-bit faders, which way the tempo faders run, the jogs and their ticks per turn, a pad block that covers every pad mode, and decks 3/4.
- **Sound card output** (Settings → Audio, Chrome/Edge): send the whole game to any output device, remembered between visits, with the headphone cue on outputs 3/4 of a four-output card.
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
src/three/venues/rooms/    the crazy rooms and their shared engine (pads, scenes, drop moments, mirror probes)
src/visualizer/            audio features, visual modes and their shader kit, the auto VJ, lyrics typography
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
