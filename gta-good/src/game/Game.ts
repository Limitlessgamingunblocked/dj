import * as THREE from 'three';
import { createCity, districtAt, P, SIZE, type City, type Place } from '../core/city';
import { clamp, damp, dampAngle, dist, forward, rightOf, type Vec2 } from '../core/math';
import { CONDITIONS, treat, updatePatient, vitalsOf, type ToolId } from '../core/medical';
import { buyUpgrade, buyVehicle, checkSeconds, earn, grantCert, hasCerts, newProfile, parseProfile, rank, rideMultiplier, sirenRange, type Profile } from '../core/progression';
import { route } from '../core/route';
import { mulberry32 } from '../core/rng';
import { vehicleById, type DriveInput } from '../core/vehicle';
import { Hud, type HudPatient } from '../ui/Hud';
import { Minimap, type MapDot } from '../ui/Minimap';
import { Screens } from '../ui/Screens';
import { TreatmentUI } from '../ui/Treatment';
import { buildCityMeshes } from '../world/cityMesh';
import type { Box2 } from '../world/collide';
import { Markers } from '../world/Markers';
import { Pedestrians } from '../world/Pedestrians';
import { PlayerVehicle } from '../world/PlayerVehicle';
import { Traffic, type Obstacle } from '../world/Traffic';
import { Victims, type Dest, type Victim } from '../world/Victims';
import { Walker } from '../world/Walker';
import { AudioFx } from './Audio';
import { Input } from './Input';
import { CareMission, EscortMission, makeCall, missionById, MISSIONS, type CallOffer } from './missions';
import type { Mission } from './types';

const STEP = 1 / 60;
const SAVE_KEY = 'gta-good-save-v1';

type Mode = 'title' | 'play' | 'menu' | 'treat' | 'result';

function loadProfile(): { profile: Profile; saved: boolean } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return { profile: parseProfile(JSON.parse(raw)), saved: true };
  } catch {
    /* storage unavailable */
  }
  return { profile: newProfile(), saved: false };
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2400);
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  readonly city: City;
  readonly traffic = new Traffic();
  readonly peds: Pedestrians;
  readonly markers = new Markers();
  readonly victims: Victims;
  vehicle: PlayerVehicle;
  readonly walker = new Walker();
  readonly input: Input;
  readonly audio = new AudioFx();
  readonly hud: Hud;
  readonly minimap: Minimap;
  readonly treatment = new TreatmentUI();
  readonly screens = new Screens();
  profile: Profile;
  private hasSave: boolean;
  inVehicle = true;
  mission: Mission | null = null;
  readonly closed = new Set<string>();
  time = 0;
  private mode: Mode = 'title';
  private acc = 0;
  private last = 0;
  equipped: ToolId = 'epi';
  private camMode: 'chase' | 'high' = 'chase';
  private camYaw = 0;
  private camPitch = 0.28;
  private camDist = 1;
  private lookOffset = 0;
  private lookIdle = 0;
  private gpsRoute: Vec2[] | null = null;
  private routeTimer = 0;
  private offer: (CallOffer & { expires: number }) | null = null;
  private callTimer = 12;
  private rng = mulberry32(Date.now() & 0xffff);
  private lastJolt = 0;
  private pedCooldown = 0;
  private carHitCooldown = 0;
  private shake = 0;
  private wheelOpen = false;
  private boarding = 0;
  private throttle = 0;
  private braking = false;
  private warned = new Map<number, number>();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();

  constructor(private root: HTMLElement) {
    const { profile, saved } = loadProfile();
    this.profile = profile;
    this.hasSave = saved;
    this.city = createCity(7);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'view';
    root.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0x9cc7e8);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(0xb4cfe2, 260, 1100);
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5b6b4a, 1.15));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -90;
    sc.right = sc.top = 90;
    sc.near = 10;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(buildCityMeshes(this.city).group);
    this.scene.add(this.traffic.group, this.markers.group);
    this.peds = new Pedestrians(this.city);
    this.scene.add(this.peds.group);
    this.victims = new Victims(this.markers);
    this.scene.add(this.victims.group);

    const start = this.city.stadium.bay;
    this.vehicle = new PlayerVehicle(vehicleById(this.profile.vehicle), start.x - 20, start.z, -Math.PI / 2);
    this.scene.add(this.vehicle.group, this.walker.group);
    this.walker.group.visible = false;
    for (let k = 0; k < this.traffic.baseCount; k++) this.traffic.spawnRandom(start, 40);

    this.input = new Input(this.renderer.domElement);
    this.minimap = new Minimap(this.city);
    this.hud = new Hud(this.minimap, (t) => this.equip(t));
    this.hud.onBeat = () => this.audio.beep();
    root.append(this.hud.el, this.treatment.el, this.screens.el);
    this.audio.setVolume(this.profile.volume);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
    this.resize();
    this.hud.setVisible(false);
    this.showTitle();
  }

  // --- public helpers used by missions ------------------------------------------------------

  playerPos(): Vec2 {
    return this.inVehicle ? this.vehicle.pos : { x: this.walker.x, z: this.walker.z };
  }

  onboard(): Victim[] {
    return this.victims.list.filter((v) => v.state === 'onboard');
  }

  toast(text: string, kind: 'info' | 'good' | 'warn' | 'bad' | 'dispatch' = 'info', seconds = 4.5) {
    this.hud.toast(text, kind, seconds);
  }

  placeFor(dest: Dest, from: Vec2): Place | null {
    const [stgrace, metro] = this.city.hospitals;
    switch (dest) {
      case 'hospital':
        return dist(from, stgrace.bay) <= dist(from, metro.bay) ? stgrace : metro;
      case 'stgrace':
        return stgrace;
      case 'metro':
        return metro;
      case 'safety':
        return this.city.stadium;
      default:
        return null;
    }
  }

  /** Puts the player in their vehicle at a spot, stopped. */
  teleport(p: Vec2, heading: number) {
    const s = this.vehicle.state;
    s.x = p.x;
    s.z = p.z;
    s.heading = heading;
    s.vx = s.vz = s.speed = s.steer = 0;
    this.enterVehicle(true);
    this.traffic.cars.filter((c) => !c.convoy && Math.hypot(c.x - p.x, c.z - p.z) < 14).forEach((c) => this.traffic.remove(c));
    this.camYaw = heading;
    this.snapCamera();
  }

  boardVictim(v: Victim) {
    this.victims.setState(v, 'onboard');
  }

  // --- flow -----------------------------------------------------------------------------------

  private showTitle() {
    this.mode = 'title';
    this.hud.setVisible(false);
    this.screens.showTitle(
      this.hasSave,
      () => this.beginShift(),
      () => {
        this.profile = newProfile();
        this.save();
        this.beginShift();
      },
    );
    this.snapCamera();
  }

  private beginShift() {
    this.audio.unlock();
    this.screens.hide();
    this.hud.setVisible(true);
    this.mode = 'play';
    this.vehicle.setSpec(vehicleById(this.profile.vehicle));
    this.snapCamera();
    if (!this.profile.certs.length && !Object.keys(this.profile.missions).length) {
      this.toast('Welcome to your first shift! Press M for Dispatch: the training courses earn your certifications. Street calls also come in — press Y to take one.', 'dispatch', 10);
    } else this.toast(`Back on shift, ${rank(this.profile.totalMerit)}. Stay safe out there.`, 'dispatch');
    this.callTimer = 14;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.profile));
      this.hasSave = true;
    } catch {
      /* storage unavailable */
    }
  }

  startMission(id: string) {
    const def = missionById(id);
    if (!def || !hasCerts(this.profile, def.requires)) return;
    this.endMission(true);
    this.offer = null;
    this.hud.setOffer(null);
    this.launch(def.create(this));
  }

  private launch(m: Mission) {
    this.mission = m;
    m.start();
    this.gpsRoute = null;
    this.routeTimer = 0;
    this.audio.good();
  }

  /** Ends the current mission. `silent` skips the result screen (abandon or switch). */
  private endMission(silent: boolean) {
    const m = this.mission;
    if (!m) return;
    this.mission = null;
    const res = m.result();
    const success = m.status === 'success';
    m.cleanup();
    this.gpsRoute = null;
    if (silent) return;
    if (success) {
      earn(this.profile, res.merit);
      const def = missionById(m.id);
      if (def) this.profile.missions[m.id] = Math.max(this.profile.missions[m.id] ?? 0, res.merit);
      if (res.cert) grantCert(this.profile, res.cert);
      this.profile.helped += helpedBy(m);
      this.save();
      this.audio.success();
    } else this.audio.fail();
    this.callTimer = 20;
    this.mode = 'result';
    this.input.clear();
    this.screens.showResult(m.title, res, success, () => {
      this.screens.hide();
      this.mode = 'play';
      this.input.clear();
    });
  }

  private openDispatch(tab?: 'missions' | 'garage') {
    this.mode = 'menu';
    this.hud.showWheel(false);
    this.wheelOpen = false;
    this.input.clear();
    this.screens.showDispatch(
      {
        profile: this.profile,
        missions: MISSIONS,
        activeMission: this.mission && this.mission.id !== 'call' ? this.mission.id : null,
        canSwapVehicle: this.onboard().length === 0 && this.inVehicle,
        start: (id) => {
          this.closeDispatch();
          this.startMission(id);
        },
        abandon: () => {
          this.endMission(true);
          this.toast('Mission abandoned.', 'warn');
          this.screens.refresh();
          this.closeDispatch();
        },
        buyVehicle: (id) => {
          if (buyVehicle(this.profile, id)) {
            this.audio.success();
            this.save();
          }
          this.screens.refresh();
        },
        selectVehicle: (id) => {
          this.profile.vehicle = id;
          this.vehicle.setSpec(vehicleById(id));
          this.save();
          this.screens.refresh();
        },
        buyUpgrade: (id) => {
          if (buyUpgrade(this.profile, id)) {
            this.audio.good();
            this.save();
          }
          this.screens.refresh();
        },
        setVolume: (v) => {
          this.profile.volume = v;
          this.audio.setVolume(v);
          this.save();
        },
        resetSave: () => {
          this.endMission(true);
          this.profile = newProfile();
          this.vehicle.setSpec(vehicleById('van'));
          this.save();
          this.screens.refresh();
        },
        close: () => this.closeDispatch(),
      },
      tab,
    );
  }

  private closeDispatch() {
    this.screens.hide();
    this.mode = 'play';
    this.input.clear();
  }

  // --- input ------------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if (this.mode === 'treat') {
      if (this.treatment.key(k)) e.preventDefault();
      return;
    }
    if (this.mode === 'result' && (k === 'enter' || k === 'escape')) {
      (this.screens.el.querySelector('.btn.primary') as HTMLButtonElement | null)?.click();
      return;
    }
    if (this.mode === 'menu' && (k === 'escape' || k === 'm')) {
      this.closeDispatch();
      return;
    }
    if (this.mode === 'title' && k === 'enter') {
      (this.screens.el.querySelector('.btn.primary') as HTMLButtonElement | null)?.click();
    }
  }

  private equip(t: ToolId) {
    if (this.lockedTools().has(t)) {
      this.toast('The AED needs the Advanced Life Support certification.', 'warn');
      return;
    }
    this.equipped = t;
    this.audio.click();
  }

  private lockedTools(): Set<ToolId> {
    const als = this.profile.certs.includes('als') || this.mission?.id === 'als';
    return new Set<ToolId>(als ? [] : ['aed']);
  }

  /** Discrete actions, once per rendered frame. */
  private actions() {
    const i = this.input;
    if (i.wasPressed('m', 'escape')) return this.openDispatch();
    if (i.wasPressed('c')) this.camMode = this.camMode === 'chase' ? 'high' : 'chase';
    if (i.wasPressed('tab')) {
      this.wheelOpen = true;
      this.hud.showWheel(true);
      this.hud.wheel.set(this.equipped, this.lockedTools());
    }
    if (this.wheelOpen) {
      for (const [k, t] of [['1', 'epi'], ['2', 'inhaler'], ['3', 'aed'], ['4', 'trauma'], ['5', 'glucose'], ['6', 'oxygen']] as [string, ToolId][]) {
        if (i.wasPressed(k)) {
          this.equip(t);
          this.hud.wheel.set(this.equipped, this.lockedTools());
        }
      }
      if (i.wasReleased('tab') || !i.isDown('tab')) {
        this.wheelOpen = false;
        this.hud.showWheel(false);
      }
    }
    if (this.offer) {
      if (i.wasPressed('y')) {
        const o = this.offer;
        this.offer = null;
        this.hud.setOffer(null);
        this.launch(new CareMission(this, o.cfg));
      } else if (i.wasPressed('n')) {
        this.offer = null;
        this.hud.setOffer(null);
        this.callTimer = 25;
      }
    }
    if (this.inVehicle) {
      if (i.wasPressed('q')) {
        this.vehicle.siren = !this.vehicle.siren;
        this.audio.click();
      }
      if (i.wasPressed('r')) this.vehicle.sirenMode = this.vehicle.sirenMode === 'wail' ? 'yelp' : 'wail';
      if (i.wasPressed('h')) this.audio.horn();
      if (i.wasPressed('f')) this.exitVehicle();
      else if (i.wasPressed('e')) this.interactFromVehicle();
    } else {
      if (i.wasPressed('f')) {
        if (dist(this.playerPos(), this.vehicle.pos) < 5.5) this.enterVehicle(false);
        else this.toast('Walk back to your vehicle to get in.', 'info', 2.5);
      } else if (i.wasPressed('e')) this.interactOnFoot();
    }
  }

  private exitVehicle() {
    if (Math.abs(this.vehicle.state.speed) > 4) {
      this.toast('Stop the vehicle before stepping out.', 'warn', 2.5);
      return;
    }
    const s = this.vehicle.state;
    const f = forward(s.heading);
    const r = rightOf(f);
    const off = this.vehicle.spec.width / 2 + 0.9;
    // Step out on the driver's side (left).
    this.walker.place(s.x - r.x * off, s.z - r.z * off, s.heading);
    this.inVehicle = false;
    this.walker.group.visible = true;
    this.camYaw = s.heading;
    this.audio.engine(false, 0, 0);
  }

  private enterVehicle(silent: boolean) {
    this.inVehicle = true;
    this.walker.group.visible = false;
    if (silent) return;
    // Load any treated patient waiting nearby.
    for (const v of this.victims.list) {
      if (v.state === 'treated' && dist(v.pos, this.vehicle.pos) < 25) this.tryLoad(v);
    }
  }

  private capacityLeft() {
    return this.vehicle.spec.capacity - this.onboard().length;
  }

  private tryLoad(v: Victim): boolean {
    if (this.capacityLeft() <= 0) {
      this.toast('No room aboard — hand off your current patients first.', 'warn');
      return false;
    }
    this.victims.setState(v, 'onboard');
    this.audio.good();
    this.toast(v.patient.condition === 'evacuee' ? `${v.patient.name} is aboard.` : `${v.patient.name} is on the stretcher. Drive smooth.`, 'good', 3);
    return true;
  }

  private interactFromVehicle() {
    const near = this.victims.list.find((v) => v.state === 'waiting' && dist(v.pos, this.vehicle.pos) < 20);
    if (near) this.toast('Step out with F to reach the patient.', 'info', 2.5);
  }

  private interactOnFoot() {
    const p = this.playerPos();
    const cand = this.victims.list.filter((v) => (v.state === 'waiting' || v.state === 'treated') && dist(v.pos, p) < 2.8).sort((a, b) => dist(a.pos, p) - dist(b.pos, p))[0];
    if (!cand) return;
    if (cand.state === 'waiting') return this.openTreatment(cand);
    if (dist(this.vehicle.pos, p) > 25) {
      this.toast('Bring your vehicle closer (within 25 m) to load the patient.', 'warn');
      return;
    }
    this.tryLoad(cand);
  }

  private openTreatment(v: Victim) {
    this.mode = 'treat';
    this.hud.showWheel(false);
    this.wheelOpen = false;
    this.treatment.open(v, {
      checkSeconds: checkSeconds(this.profile),
      steadyLevel: this.profile.upgrades.steady,
      locked: this.lockedTools(),
      getTool: () => this.equipped,
      setTool: (t) => (this.equipped = t),
      apply: (tool, q) => {
        const res = treat(v.patient, tool, q);
        if (res.ok) {
          const needsRide = CONDITIONS[v.patient.condition].transport && v.dest !== 'none';
          this.victims.setState(v, needsRide ? 'treated' : 'released');
        }
        return res;
      },
      close: () => {
        this.mode = 'play';
        this.input.clear();
      },
      sound: (k) => {
        const a = this.audio;
        ({ click: () => a.click(), good: () => a.good(), bad: () => a.bad(), beep: () => a.beep(), shock: () => a.shock(), charge: () => a.charge(1.2) })[k]();
      },
    });
  }

  // --- simulation -----------------------------------------------------------------------------

  private obstacles(): Obstacle[] {
    const obs: Obstacle[] = [];
    for (const c of this.vehicle.circles()) obs.push({ ...c, honk: true });
    if (!this.inVehicle) obs.push({ x: this.walker.x, z: this.walker.z, r: 0.6, honk: true });
    for (const d of this.markers.debris) obs.push(d);
    for (const b of this.markers.boxes) {
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      const n = Math.max(1, Math.round(Math.max(w, d) / 4));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        obs.push({ x: w > d ? b.x0 + w * t : (b.x0 + b.x1) / 2, z: w > d ? (b.z0 + b.z1) / 2 : b.z0 + d * t, r: 2.2 });
      }
    }
    if (this.mission instanceof EscortMission) obs.push(...this.mission.obstacles());
    return obs;
  }

  private fixed(dt: number) {
    this.time += dt;
    const i = this.input;
    const control = this.mode === 'play';
    const boxes: Box2[] = this.markers.boxes;
    const drive: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: !this.inVehicle };
    if (this.inVehicle && control) {
      drive.throttle = i.isDown('w', 'arrowup') ? 1 : 0;
      drive.brake = i.isDown('s', 'arrowdown') ? 1 : 0;
      drive.steer = i.axis(['d', 'arrowright'], ['a', 'arrowleft']);
      drive.handbrake = i.isDown(' ');
    } else if (!this.inVehicle) drive.brake = 1;
    this.throttle = drive.throttle;
    this.braking = drive.brake > 0 && this.vehicle.state.speed > 0.5;
    const res = this.vehicle.step(dt, drive, this.city, this.traffic, boxes, this.markers.debris);
    this.lastJolt = res.jolt;
    if (res.jolt > 2.5) {
      this.audio.crash(res.jolt);
      this.shake = Math.min(1, this.shake + res.jolt * 0.06);
    }
    this.carHitCooldown -= dt;
    if (res.hitCar && res.jolt > 3) {
      this.traffic.bump(res.hitCar);
      if (this.carHitCooldown <= 0) {
        this.carHitCooldown = 2;
        this.mission?.onCarHit?.();
        if (res.jolt > 6) this.toast('Collision! Civilian cars stop when hit — and your patient feels it.', 'bad', 3);
      }
    }

    if (!this.inVehicle && control) {
      const mx = i.axis(['a', 'arrowleft'], ['d', 'arrowright']);
      const mz = i.axis(['s', 'arrowdown'], ['w', 'arrowup']);
      this.walker.step(dt, mx, mz, i.isDown('shift'), this.camYaw, this.city, this.traffic, boxes, this.vehicle.circles());
    }

    this.traffic.update(dt, {
      time: this.time,
      player: this.vehicle.pos,
      sirenOn: this.vehicle.siren,
      sirenRange: sirenRange(this.profile),
      obstacles: this.obstacles(),
      closed: this.closed,
      onHonk: (c) => {
        if (Math.hypot(c.x - this.vehicle.pos.x, c.z - this.vehicle.pos.z) < 40) this.audio.distantHonk();
      },
    });

    const vs = this.vehicle.state;
    this.peds.update(dt, this.inVehicle ? { x: vs.x, z: vs.z, vx: vs.vx, vz: vs.vz } : null);
    this.pedCooldown -= dt;
    if (this.inVehicle && Math.abs(vs.speed) > 3) {
      for (const p of this.peds.peds) {
        if (p.downT > 0 || Math.abs(p.x - vs.x) > 5 || Math.abs(p.z - vs.z) > 5) continue;
        if (this.vehicle.circles().some((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.35)) {
          this.peds.knockDown(p);
          this.audio.crash(3);
          if (this.pedCooldown <= 0) {
            this.pedCooldown = 3;
            earn(this.profile, -15);
            this.toast('You knocked a pedestrian over. They’re shaken but okay — −15 merit. Heroes watch the sidewalk.', 'bad', 4);
          }
        }
      }
    }

    this.markers.update(dt, this.time);

    // Patients.
    const comfort = this.vehicle.spec.comfort * rideMultiplier(this.profile);
    for (const v of this.victims.list) {
      if (v.state === 'delivered' || v.state === 'released' || v.state === 'lost') continue;
      const ride = v.state === 'onboard' && this.inVehicle ? { gLat: vs.gLat, gLong: vs.gLong, jolt: this.lastJolt, comfort } : undefined;
      updatePatient(v.patient, dt, ride);
      if (v.patient.lost) {
        this.victims.setState(v, 'lost');
        this.toast(`${v.patient.name} has gone critical. Another crew is taking over.`, 'bad', 5);
      }
      if (v.state === 'onboard') v.pos = { ...this.vehicle.pos };
    }

    // Evacuees climb in when you stop next to them.
    this.boarding -= dt;
    if (this.inVehicle && Math.abs(vs.speed) < 1.5 && this.boarding <= 0) {
      const ev = this.victims.list.find((v) => v.state === 'treated' && v.patient.condition === 'evacuee' && dist(v.pos, this.vehicle.pos) < 16);
      if (ev && this.capacityLeft() > 0) {
        this.tryLoad(ev);
        this.boarding = 0.7;
      }
    }

    // Hand-offs at the ER bays and the safety zone.
    if (this.inVehicle && Math.abs(vs.speed) < 3) {
      const aboard = this.onboard();
      if (aboard.length) {
        for (const place of [...this.city.hospitals, this.city.stadium]) {
          if (dist(place.bay, this.vehicle.pos) > 12) continue;
          for (const v of aboard) {
            const target = this.placeFor(v.dest, this.vehicle.pos);
            const ok = v.dest === 'hospital' ? place !== this.city.stadium : target === place;
            if (ok) {
              this.victims.setState(v, 'delivered');
              this.audio.success();
              this.toast(place === this.city.stadium ? `${v.patient.name} is safe at the stadium.` : `${v.patient.name} handed off to the ER team at ${place.name}.`, 'good');
            } else if (v.dest !== 'none' && target && this.time - (this.warned.get(v.id) ?? -99) > 6) {
              this.warned.set(v.id, this.time);
              this.toast(`${v.patient.name} needs ${target.name}.`, 'warn');
            }
          }
        }
      }
    }

    // Mission and calls.
    const m = this.mission;
    if (m) {
      m.update(dt);
      if (m.status !== 'running') {
        // Let the player finish with the treatment screen first, unless the call was lost.
        if (this.mode === 'treat' && m.status === 'failed') this.treatment.forceClose();
        if (this.mode !== 'treat') this.endMission(false);
      }
    } else if (this.mode === 'play') {
      if (this.offer) {
        if (this.time > this.offer.expires) {
          this.offer = null;
          this.hud.setOffer(null);
          this.toast('Another unit picked up that call.', 'info', 3);
          this.callTimer = 20;
        }
      } else {
        this.callTimer -= dt;
        if (this.callTimer <= 0) {
          const o = makeCall(this, this.rng, this.profile.certs.includes('als'));
          this.offer = { ...o, expires: this.time + 22 };
          this.audio.beep();
          this.audio.beep();
          this.callTimer = 30 + this.rng() * 25;
        }
      }
    }
  }

  // --- frame ----------------------------------------------------------------------------------

  start() {
    const loop = (now: number) => {
      const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
      this.last = now;
      if (this.mode === 'play') this.actions();
      if (this.mode === 'play' || this.mode === 'treat') {
        this.acc += dt;
        while (this.acc >= STEP) {
          this.fixed(STEP);
          this.acc -= STEP;
        }
      } else this.acc = 0;
      this.frame(dt);
      this.input.endFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Runs the simulation forward without rendering (used by automated play tests). */
  simulate(seconds: number) {
    for (let k = 0; k < Math.round(seconds / STEP); k++) {
      if (this.mode !== 'play' && this.mode !== 'treat') break;
      this.fixed(STEP);
    }
  }

  private resize() {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private snapCamera() {
    this.updateCamera(1, true);
  }

  private updateCamera(dt: number, snap = false) {
    const drag = this.input.takeDrag();
    this.camDist = clamp(this.camDist * (1 + drag.wheel * 0.08), 0.6, 2.2);
    const s = this.vehicle.state;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.mode === 'title') {
      const t = this.time * 0.04 + performance.now() * 0.00004;
      pos.set(SIZE / 2 + Math.cos(t) * 330, 150, SIZE / 2 + Math.sin(t) * 330);
      look.set(SIZE / 2, 20, SIZE / 2);
      this.camera.position.copy(pos);
      this.camera.lookAt(look);
      return;
    }
    if (this.inVehicle) {
      if (Math.abs(drag.x) > 0) {
        this.lookOffset -= drag.x * 0.006;
        this.lookIdle = 0;
      } else {
        this.lookIdle += dt;
        if (this.lookIdle > 1.2) this.lookOffset = damp(this.lookOffset, 0, 3, dt);
      }
      const speed = Math.abs(s.speed);
      const yaw = s.heading + this.lookOffset;
      const f = forward(yaw);
      if (this.camMode === 'chase') {
        const back = (9.5 + speed * 0.12 + this.vehicle.spec.length * 0.4) * this.camDist;
        pos.set(s.x - f.x * back, (3.6 + speed * 0.03) * this.camDist + 0.8, s.z - f.z * back);
        const fa = forward(s.heading);
        look.set(s.x + fa.x * 6, 1.4, s.z + fa.z * 6);
      } else {
        const back = 24 * this.camDist;
        pos.set(s.x - f.x * back, 48 * this.camDist, s.z - f.z * back);
        look.set(s.x + f.x * 8, 0, s.z + f.z * 8);
      }
      this.camera.fov = damp(this.camera.fov, 60 + speed * 0.35, 3, dt);
    } else {
      this.camYaw -= drag.x * 0.006;
      this.camPitch = clamp(this.camPitch + drag.y * 0.004, 0.05, 1.2);
      if (this.walker.speed > 0.5 && Math.abs(drag.x) === 0) this.camYaw = dampAngle(this.camYaw, this.walker.heading, 1.2, dt);
      const f = forward(this.camYaw);
      const d = 6 * this.camDist;
      pos.set(this.walker.x - f.x * d * Math.cos(this.camPitch), 1.6 + d * Math.sin(this.camPitch), this.walker.z - f.z * d * Math.cos(this.camPitch));
      look.set(this.walker.x, 1.3, this.walker.z);
      this.camera.fov = damp(this.camera.fov, 58, 3, dt);
    }
    if (snap) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else {
      const k = this.inVehicle ? 5 : 8;
      this.camPos.lerp(pos, 1 - Math.exp(-k * dt));
      this.camLook.lerp(look, 1 - Math.exp(-k * 1.6 * dt));
    }
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake = damp(this.shake, 0, 6, dt);
    }
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  private frame(dt: number) {
    const s = this.vehicle.state;
    this.vehicle.render(dt, this.time, this.braking);
    this.walker.render(dt);
    this.traffic.render(dt, this.time);
    this.peds.render();
    this.victims.update(this.time);
    this.updateCamera(dt);
    const focus = this.playerPos();
    this.sun.position.set(focus.x + 70, 120, focus.z + 45);
    this.sun.target.position.set(focus.x, 0, focus.z);
    if (this.mode === 'title') {
      this.time += dt;
      this.traffic.update(dt, { time: this.time, player: { x: SIZE / 2, z: SIZE / 2 }, sirenOn: false, sirenRange: 0, obstacles: [], closed: this.closed });
      this.peds.update(dt, null);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const active = this.mode === 'play' || this.mode === 'treat';
    this.audio.siren(active && this.vehicle.siren, this.vehicle.sirenMode);
    this.audio.engine(active && this.inVehicle, s.speed, this.throttle);
    if (this.mode === 'treat') this.treatment.update(dt, this.input.isDown('shift'));

    // GPS.
    const target = this.mission?.gps() ?? null;
    this.routeTimer -= dt;
    if (target && this.routeTimer <= 0) {
      this.gpsRoute = route(focus, target, this.closed);
      this.routeTimer = 0.5;
    } else if (!target) this.gpsRoute = null;

    this.renderer.render(this.scene, this.camera);
    this.updateHud(dt, target);
  }

  private updateHud(dt: number, target: Vec2 | null) {
    const s = this.vehicle.state;
    const p = this.playerPos();
    const patients: HudPatient[] = [];
    const nearby = this.victims.list.filter((v) => v.state === 'onboard' || ((v.state === 'waiting' || v.state === 'treated') && dist(v.pos, p) < 30 && v.patient.condition !== 'evacuee'));
    for (const v of nearby.slice(0, 3)) {
      if (v.patient.condition === 'evacuee') continue;
      patients.push({
        name: v.patient.name,
        label: v.patient.treated ? CONDITIONS[v.patient.condition].label : v.patient.revealed.length ? 'Assessing…' : 'Unknown condition',
        stability: v.patient.stability,
        vitals: vitalsOf(v.patient),
        aboard: v.state === 'onboard',
      });
    }
    let prompt: string | null = null;
    if (this.mode === 'play') {
      if (!this.inVehicle) {
        const v = this.victims.list.find((x) => (x.state === 'waiting' || x.state === 'treated') && dist(x.pos, p) < 2.8);
        if (v) prompt = v.state === 'waiting' ? `<kbd>E</kbd> Assess & treat ${v.patient.name}` : `<kbd>E</kbd> Load ${v.patient.name}`;
        else if (dist(p, this.vehicle.pos) < 5.5) prompt = '<kbd>F</kbd> Get in';
      } else {
        const bay = [...this.city.hospitals, this.city.stadium].find((pl) => dist(pl.bay, p) < 12);
        if (bay && this.onboard().length && Math.abs(s.speed) >= 3) prompt = `Stop in the bay to hand off at ${bay.name}`;
      }
    }
    if (this.offer && this.mode === 'play') this.hud.setOffer(this.offer.label + `  ·  ${Math.round(dist(p, this.offer.pos))} m`, this.offer.expires - this.time);

    // Objective marker projected onto the screen.
    let arrow = null;
    const goal = target ?? (this.offer ? this.offer.pos : null);
    if (goal) {
      const v3 = new THREE.Vector3(goal.x, 3, goal.z).project(this.camera);
      const w = this.renderer.domElement.clientWidth;
      const hgt = this.renderer.domElement.clientHeight;
      const behind = v3.z > 1;
      let x = ((behind ? -v3.x : v3.x) * 0.5 + 0.5) * w;
      let y = ((behind ? v3.y : -v3.y) * 0.5 + 0.5) * hgt;
      const onScreen = !behind && x > 40 && x < w - 40 && y > 90 && y < hgt - 60;
      if (!onScreen) {
        const cx = w / 2;
        const cy = hgt / 2;
        let dx = x - cx;
        let dy = y - cy;
        if (behind && Math.abs(dy) < 1) dy = 1;
        const sc = Math.min((w / 2 - 50) / Math.abs(dx || 1e-3), (hgt / 2 - 80) / Math.abs(dy || 1e-3));
        dx *= sc;
        dy *= sc;
        x = cx + dx;
        y = cy + dy;
        arrow = { x, y, angle: Math.atan2(dy, dx), dist: dist(p, goal), onScreen: false };
      } else arrow = { x, y: y - 26, angle: Math.PI / 2, dist: dist(p, goal), onScreen: true };
    }

    const m = this.mission;
    const left = m?.timeLeft();
    this.hud.update(
      {
        merit: this.profile.merit,
        rank: rank(this.profile.totalMerit),
        district: districtAt(this.city, p.x, p.z),
        missionTitle: m?.title ?? null,
        objective: m ? m.objective() : this.offer ? 'Incoming call — press Y to respond' : 'Patrol the city. Press M for Dispatch.',
        timer: m && left !== null && left !== undefined ? { label: m.timerLabel(), left } : null,
        inVehicle: this.inVehicle,
        speedKmh: Math.abs(s.speed) * 3.6,
        siren: this.vehicle.siren,
        sirenMode: this.vehicle.sirenMode,
        vehicleName: this.vehicle.spec.name,
        capacity: this.vehicle.spec.capacity,
        aboard: this.onboard().length,
        tool: this.equipped,
        patients,
        gLat: s.gLat,
        gLong: s.gLong,
        prompt,
        arrow: this.mode === 'play' ? arrow : null,
      },
      dt,
    );

    // Minimap.
    const dots: MapDot[] = [];
    for (const h of this.city.hospitals) dots.push({ x: h.bay.x, z: h.bay.z, color: '#e5383b', size: 7, label: 'H' });
    dots.push({ x: this.city.training.bay.x, z: this.city.training.bay.z, color: '#b08d00', size: 6, label: 'T' });
    dots.push({ x: this.city.stadium.bay.x, z: this.city.stadium.bay.z, color: '#1f5fd6', size: 6, label: 'S' });
    for (const b of this.markers.beaconsList()) {
      if (b.visible) dots.push({ x: b.pos.x, z: b.pos.z, color: `#${b.color.toString(16).padStart(6, '0')}`, pulse: true });
    }
    if (this.offer) dots.push({ x: this.offer.pos.x, z: this.offer.pos.z, color: '#ff3b3b', size: 6, pulse: true });
    if (this.mission instanceof EscortMission) {
      const g = this.mission.obstacles()[0];
      if (g) dots.push({ x: g.x, z: g.z, color: '#14a36b', size: 6 });
    }
    if (!this.inVehicle) dots.push({ x: s.x, z: s.z, color: '#ffffff', size: 4 });
    const closed = [...this.closed].map((k) => {
      const [a, b] = k.split('|').map((n) => n.split(',').map(Number));
      return { a: { x: a[0] * P, z: a[1] * P }, b: { x: b[0] * P, z: b[1] * P } };
    });
    const heading = this.inVehicle ? s.heading : this.camYaw;
    const zoom = this.inVehicle ? 0.85 - Math.min(0.4, Math.abs(s.speed) / 90) : 1.2;
    this.minimap.draw(p, heading, zoom, this.gpsRoute, dots, this.time, closed);
  }
}

/** People a finished mission counts towards the career total. */
function helpedBy(m: Mission): number {
  if (MISSIONS.find((x) => x.id === m.id)?.kind === 'training' || m.id === 'evoc') return 0;
  if (m instanceof CareMission) return m.victims.length;
  if (m instanceof EscortMission) return 1;
  return m.id === 'disaster' ? 8 : 0;
}
