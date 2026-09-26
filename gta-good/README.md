# Grand Theft Auto Good (GTA Good)

A 3D open-world browser game that flips the usual open-world crime loop: you drive an ambulance through a living city and every mission is about saving someone. It's built from the GTA Good game design document: emergency driving with sirens that clear traffic, patient stability during transport, precision medical interventions, hospital runs, convoy escorts, disaster response, random street emergencies, and a merit/certification progression.

**No install:** download [`GTA-Good.html`](../GTA-Good.html) and open it in Chrome, Edge, Firefox or Safari. It is the whole game in one file, rebuilt with `npm run build:gta-single`.

## Run it

```bash
npm install
npm run dev:gta            # http://localhost:5173
npm run build:gta          # static site in dist-gta-good/
npm run build:gta-single   # one self-contained GTA-Good.html at the repo root
npm test                   # includes tests/gtagood.test.ts
```

Keyboard and mouse. Progress is saved in the browser (localStorage).

## Controls

| Key | Action |
|---|---|
| W / ↑, S / ↓ | Accelerate, brake (hold to reverse) |
| A D / ← → | Steer |
| Space | Handbrake |
| Q | Lights and siren on/off |
| R | Siren tone: wail / yelp |
| H | Horn |
| F | Get out / get in (also loads a treated patient nearby) |
| E | Assess and treat a patient, or load them |
| Tab (hold), 1–6 | Equipment wheel |
| Shift | Sprint on foot; steady your hands while aiming |
| Mouse drag, wheel | Look around, zoom |
| C | Chase / high camera |
| Y / N | Respond to / decline an incoming call |
| M / Esc | Dispatch (missions, garage, upgrades, certifications, controls) |

## How it maps to the design document

### 2.1 Rapid emergency response driving
- **Driving model** (`src/core/vehicle.ts`): arcade bicycle model with throttle, braking, reverse, handbrake drifts and a steering limit tied to tyre grip. It reports the lateral and longitudinal g-forces felt in the cabin.
- **Siren and clearing**: with the siren on, AI traffic within range pulls to the shoulder and stops, never past a stop line, so lanes and junctions stay clear. Traffic resumes after you pass. The Smart Siren upgrade extends the range.
- **AI traffic** (`src/world/Traffic.ts`): sedans, hatchbacks, SUVs, vans, box trucks and buses follow lanes on the street grid, turn on Bézier curves, keep their distance, obey traffic lights and stop for anything in their path. They honk if you block them without a siren. Rush hour doubles the traffic.
- **Patient stability**: every patient aboard takes damage from g-forces above 0.45 g and from impacts, scaled by the vehicle's ride comfort and the Ride Stabilizer upgrade. The HUD g-meter shows the force the patient feels against that limit.

### 2.2 Precision medical interventions
- **Field triage**: four checks (look, airway and breathing, pulse, ask) each take time while the patient deteriorates. The findings point to the diagnosis.
- **Equipment**: epinephrine auto-injector, inhaler, AED (needs the ALS certification), trauma kit (tourniquet), oral glucose and oxygen, chosen from a radial wheel.
- **Tactical targeting**: a reticle with hand sway that gets worse as the patient worsens. Hold Shift to steady it. The target zones are the outer mid-thigh for epinephrine, upper-right chest and lower-left side for the AED pads followed by a timed shock, the mouth on the in-breath for the inhaler, and above the wound for the tourniquet. Placement quality sets how well the patient recovers. The wrong tool or a miss costs stability and gives feedback.

### 2.3 Hospital transport and escort
- Load treated patients and hand them off by stopping in the ER bay at St. Grace Medical Center or Metro Trauma Center. Some patients need a specific hospital.
- **Organ Convoy**: the donor-heart van follows its own route, doesn't yield and ignores lights, but cross traffic and cars ahead block it unless your siren clears them. Debris on the route has to be shoved aside.

### 3 Missions
| Mission | Type | Needs |
|---|---|---|
| EVOC Driving Course | Training: 14 lights-and-siren checkpoints with a sensor dummy on the stretcher → EVOC | – |
| First Responder Course | Training: anaphylaxis, asthma and bleeding dummies → First Responder | – |
| ALS & AED Course | Training: pads and timed shock → Advanced Life Support (unlocks the AED) | First Responder |
| Anaphylaxis Emergency | Child at the Maple Park picnic, epinephrine, then St. Grace | First Responder |
| Trauma Center Dash | Rush hour, Pinecrest Hollow farm → Metro Trauma Center across the city | EVOC + First Responder |
| Code Blue Downtown | Cardiac arrest outside an office tower | ALS |
| Organ Convoy | Escort from St. Grace to Metro Trauma | EVOC |
| Community Disaster Response | Chemical fire in Ironworks: closed roads, 2 smoke-inhalation patients, 6 evacuees shuttled to the Civic Stadium safety zone, 3 relief drops | EVOC + First Responder |

Between missions, **street calls** (asthma, low blood sugar, bleeding, allergic reactions, and cardiac arrest once you hold ALS) pop up around town with a time limit based on distance.

### 4 Open-world city
A 1 km × 1 km grid with downtown towers, residential streets of houses and apartments, the Ironworks industrial district with warehouses and tanks, two parks, the rural Pinecrest Hollow, two hospitals with ER canopies and helipads, a training center and a stadium. Pedestrians walk the sidewalks and jump out of the way. Knocking one over costs merit, and nobody is ever seriously hurt.

### 5 Progression and UI
- **Merit** from missions and calls: base reward, a time bonus against par, the patient's condition at hand-off, and penalties for hitting civilian cars.
- **Garage**: Type II Ambulance, Rapid Response SUV (fast, one patient, firm ride), Air-Ride Mobile ICU (gentlest, carries four) and ALS Interceptor.
- **Upgrades**: Steady Hands, Smart Siren & Beacons, Ride Stabilizer, Rapid Triage Kit.
- **Certifications**: EVOC, First Responder and ALS gate the higher-tier missions.
- **HUD**: rotating GPS minimap with route, closures and markers; mission objective; emergency timer; patient monitor with ECG, stability, HR, SpO₂ and RR; g-force meter; speed and siren state; seat count; equipped gear; an off-screen objective arrow and in-world beacons.

## Layout

```
gta-good/src/core/    pure logic: city layout, A* routing, medical model, targeting, vehicle physics, progression
gta-good/src/world/   Three.js: city meshes, traffic, pedestrians, player vehicle, walker, victims, markers
gta-good/src/game/    game loop, missions and street calls, input, synthesized audio
gta-good/src/ui/      HUD, minimap, treatment screen, equipment wheel, menus
```

This is a game, not medical training. In a real emergency, call your local emergency number. The title is a fan-made parody name and isn't affiliated with any game publisher.
