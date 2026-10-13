# Director research

How filmed DJ sets are shot and cut, gathered to make the auto director (`src/three/director.ts`) cut like a real one. Researched October 2026 from this environment: web search and a couple of fetched articles. Video of recorded sets couldn't be watched from here, so the notes on Cercle and the big festival streams come from general knowledge of those formats and are marked **from memory**.

## The three styles

| Style | How it's shot | Source |
|---|---|---|
| Boiler Room | Started as a single fixed webcam taped to a wall. The DJ stands in the middle of the crowd and the stream is a fly-on-the-wall view of the room: dancers around and behind the DJ are part of the picture. Unpolished, documentary. | [Stereogum](https://stereogum.com/2260449/club-classics-a-brief-history-of-the-boiler-room-set/columns/sounding-board) |
| Festival main stage | Several cameras and a live cut. A low-angle hero shot of the DJ against the LED wall and lights; tight close-ups of the hands on knobs, faders and jogs; crowd reaction cutaways (hands up, cheering); wide shots of the whole stage and crowd for the drop. Wide, medium and close are mixed through the set. | [Ticket Fairy](https://www.ticketfairy.com/blog/making-djs-telegenic-on-big-festival-screens) |
| Cercle | Long, slow takes at a landmark location. Drone and crane shots open the set and keep coming back to show where it is; slow moves round the DJ; few cuts. **From memory.** | — |

## Cutting rhythm

| Moment | What the editor does | Source |
|---|---|---|
| Build | Holds a close-up on the DJ's face or the hand on the filter to build tension. | [Ticket Fairy](https://www.ticketfairy.com/blog/making-djs-telegenic-on-big-festival-screens) |
| Last bars before the drop | Cuts to the hand over the controls, or to the crowd. Festival streams cut faster and faster on the bar lines into the drop. **The speeding-up is from memory.** | [Ticket Fairy](https://www.ticketfairy.com/blog/making-djs-telegenic-on-big-festival-screens) |
| Drop | A wide shot of the stage and the crowd for the payoff. Festival streams often go to the view from behind the DJ, out over the crowd, with the pyro going off. **The behind-the-DJ shot is from memory.** | [Ticket Fairy](https://www.ticketfairy.com/blog/making-djs-telegenic-on-big-festival-screens) |
| Fast tracks | Quick cuts between the DJ, the crowd and the detail shots. | [Ticket Fairy](https://www.ticketfairy.com/blog/making-djs-telegenic-on-big-festival-screens) |
| Slow and melodic | Longer, sweeping takes. | [Ticket Fairy](https://www.ticketfairy.com/blog/making-djs-telegenic-on-big-festival-screens) |
| Cuts | Hard cuts on the beat. Dissolves only in the quiet parts. **From memory.** | — |

## What the director does with this

- **Shot sizes.** Every angle is wide, medium or close (`SHOT_SIZE`). The next shot is a different size from the one on screen whenever the pool has one, so the picture goes wide, close, medium instead of wide, wide.
- **Two new angles.** *Over the shoulder* (`hero`): low behind the DJ, past their shoulder at the crowd, pushing in slowly. It aims at the venue's own crowd camera, so it finds the dance floor in every room; Boiler Room and the bedroom set their own. *On the hands* (`hands`): just over the front edge of the board, off to one side, looking down at the hands on the jogs and the mixer. It slides along the board and swaps sides each time it's picked.
- **The build speeds up.** Cuts every 4 bars early in the build, every 2 as it climbs, then every bar on close-ups (the hands, the booth, the fisheye) for the last bars.
- **The drop pays off.** A hard cut on the hit to the room, the hero shot, the drone or the crowd, held for 4 bars.
- **The craft.** When two tracks are audible together (past the channel faders and the crossfader), the next bar line cuts to the hands or the top-down view, and the cuts alternate between the hands and the rest while the blend lasts.
- **The venue.** When a new track takes over, the next bar line cuts to an establishing shot: the venue's signature angle, the crane, the drone or the rig. The breakdown holds long shots of the room.
- **Hard cuts on the beat.** Cuts land on the downbeat with no fade. Only the breakdown, a new track and the quiet between tracks dip through black.
