import * as THREE from 'three';
import { LANE, N, P, RW, SHOULDER } from '../core/city';
import { clamp, damp, dist, headingOf, rightOf, type Vec2 } from '../core/math';
import { edgeKey, neighbours, type Node } from '../core/route';
import { mulberry32, pick, range } from '../core/rng';

const M = N + 1;
const S0 = RW / 2;
const S1 = P - RW / 2;
const STOP = S1 - 1.2;
const CYCLE = 20;
const MAX_CARS = 240;

export type Light = 'green' | 'amber' | 'red';

interface CarKind {
  name: string;
  L: number;
  W: number;
  bodyH: number;
  cabH: number;
  cabLen: number;
  cabOff: number;
  cruise: number;
}

const KINDS: CarKind[] = [
  { name: 'sedan', L: 4.6, W: 1.9, bodyH: 0.8, cabH: 0.62, cabLen: 0.5, cabOff: -0.05, cruise: 13 },
  { name: 'hatch', L: 3.9, W: 1.8, bodyH: 0.85, cabH: 0.66, cabLen: 0.56, cabOff: -0.1, cruise: 12.5 },
  { name: 'suv', L: 4.9, W: 2.0, bodyH: 1.0, cabH: 0.72, cabLen: 0.6, cabOff: -0.08, cruise: 13 },
  { name: 'van', L: 5.4, W: 2.0, bodyH: 0.95, cabH: 1.15, cabLen: 0.74, cabOff: -0.1, cruise: 12 },
  { name: 'truck', L: 7.6, W: 2.4, bodyH: 0.95, cabH: 2.4, cabLen: 0.7, cabOff: -0.14, cruise: 10.5 },
  { name: 'bus', L: 11, W: 2.6, bodyH: 1.1, cabH: 1.9, cabLen: 0.96, cabOff: 0, cruise: 10 },
];
const KIND_WEIGHTS = [5, 4, 3, 2, 1, 0.6];

const PAINT = [0xc8ccd0, 0x2b2f36, 0x8b1e22, 0x1d3f73, 0xe6e6e1, 0x51606b, 0x2f5d3a, 0xb58b2a, 0x6b3c75, 0xd0512b, 0x9aa7b4];

export interface Car {
  id: number;
  kind: CarKind;
  paint: number;
  cabPaint: number;
  from: Node;
  to: Node;
  next: Node | null;
  s: number;
  turning: boolean;
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  tt: number;
  tlen: number;
  speed: number;
  offset: number;
  yieldT: number;
  bumpT: number;
  waitT: number;
  x: number;
  z: number;
  heading: number;
  braking: boolean;
  /** Escorted vehicles follow a fixed route, ignore lights and never yield. */
  convoy: boolean;
  route: Node[] | null;
  routeIdx: number;
  /** Convoy stops at this s on the last route edge. */
  goalS: number;
  arrived: boolean;
  blocked: boolean;
  hidden: boolean;
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  /** Cars honk when this obstacle holds them up. */
  honk?: boolean;
  /** A car ignores obstacles that are its own body. */
  owner?: Car;
}

export interface TrafficEnv {
  time: number;
  player: Vec2;
  sirenOn: boolean;
  sirenRange: number;
  obstacles: Obstacle[];
  closed: ReadonlySet<string>;
  /** Called when a car has been stuck behind the player without a siren for a while. */
  onHonk?: (car: Car) => void;
}

const nodeXZ = (n: Node): Vec2 => ({ x: n[0] * P, z: n[1] * P });
const dirOf = (a: Node, b: Node): Vec2 => ({ x: Math.sign(b[0] - a[0]), z: Math.sign(b[1] - a[1]) });
const bucketKey = (a: Node, b: Node) => `${a[0]},${a[1]}>${b[0]},${b[1]}`;
const hasLight = (n: Node) => neighbours(n).length >= 3;

export class Traffic {
  readonly cars: Car[] = [];
  readonly group = new THREE.Group();
  density = 1;
  baseCount = 90;
  private rng = mulberry32(1234);
  private nextId = 1;
  private lightOffset: number[] = [];
  private buckets = new Map<string, { car: Car; s: number }[]>();
  private bodies: THREE.InstancedMesh;
  private cabs: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private tails: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private lampNodes: { node: Node; axis: 'NS' | 'EW' }[] = [];
  private lampTimer = 0;
  private obsHonk = false;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();

  constructor() {
    for (let k = 0; k < M * M; k++) this.lightOffset.push(range(this.rng, 0, CYCLE));
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 });
    this.bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, MAX_CARS);
    this.cabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.5 }), MAX_CARS);
    this.wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.9 }), MAX_CARS * 4);
    this.tails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.18, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_CARS);
    for (const m of [this.bodies, this.cabs]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    for (const m of [this.bodies, this.cabs, this.wheels, this.tails]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    // Colour buffers exist from the start so setColorAt works on any instance.
    for (let k = 0; k < MAX_CARS; k++) {
      this.bodies.setColorAt(k, this.col.set(0xffffff));
      this.cabs.setColorAt(k, this.col);
      this.tails.setColorAt(k, this.col);
    }
    this.lamps = this.buildSignals();
  }

  light(n: Node, axis: 'NS' | 'EW', time: number): Light {
    if (!hasLight(n)) return 'green';
    const u = (time + this.lightOffset[n[0] * M + n[1]]) % CYCLE;
    if (axis === 'NS') return u < 8 ? 'green' : u < 10 ? 'amber' : 'red';
    return u >= 10 && u < 18 ? 'green' : u >= 18 ? 'amber' : 'red';
  }

  private buildSignals(): THREE.InstancedMesh {
    const poles: THREE.Matrix4[] = [];
    const o = RW / 2 + 1.2;
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < M; j++) {
        const n: Node = [i, j];
        if (!hasLight(n)) continue;
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const x = i * P + sx * o;
          const z = j * P + sz * o;
          poles.push(new THREE.Matrix4().makeTranslation(x, 0, z));
          // One head for each axis, on short arms pointing into the road.
          this.lampNodes.push({ node: n, axis: 'NS' });
          this.lampNodes.push({ node: n, axis: 'EW' });
        }
      }
    }
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 5.2, 6).translate(0, 2.6, 0), new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6 }), poles.length);
    poles.forEach((m, k) => poleMesh.setMatrixAt(k, m));
    this.group.add(poleMesh);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.95, 0.42), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.lampNodes.length);
    let k = 0;
    for (const m of poles) {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const node = this.lampNodes[k].node;
      const sx = Math.sign(p.x - node[0] * P);
      const sz = Math.sign(p.z - node[1] * P);
      // NS head hangs over the north-south road, EW head over the east-west one.
      lamps.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(p.x - sx * 1.6, 5.0, p.z));
      lamps.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(p.x, 5.0, p.z - sz * 1.6));
    }
    for (let i = 0; i < this.lampNodes.length; i++) lamps.setColorAt(i, this.col.set(0xff2a2a));
    this.group.add(lamps);
    return lamps;
  }

  private randomKind(): CarKind {
    const total = KIND_WEIGHTS.reduce((a, b) => a + b, 0);
    let u = this.rng() * total;
    for (let k = 0; k < KINDS.length; k++) {
      u -= KIND_WEIGHTS[k];
      if (u <= 0) return KINDS[k];
    }
    return KINDS[0];
  }

  private makeCar(from: Node, to: Node, s: number, kind = this.randomKind()): Car {
    const paint = kind.name === 'bus' ? 0xf2c230 : kind.name === 'truck' ? pick(this.rng, [0xe8e8e8, 0x2d6cb3, 0xc8412c]) : pick(this.rng, PAINT);
    const cabPaint = kind.name === 'truck' ? 0xf1f1ee : kind.name === 'bus' ? 0x26313d : 0x1b242d;
    const car: Car = {
      id: this.nextId++,
      kind,
      paint,
      cabPaint,
      from,
      to,
      next: null,
      s,
      turning: false,
      p0: { x: 0, z: 0 },
      p1: { x: 0, z: 0 },
      p2: { x: 0, z: 0 },
      tt: 0,
      tlen: 1,
      speed: kind.cruise * 0.6,
      offset: LANE,
      yieldT: 0,
      bumpT: 0,
      waitT: 0,
      x: 0,
      z: 0,
      heading: 0,
      braking: false,
      convoy: false,
      route: null,
      routeIdx: 0,
      goalS: 0,
      arrived: false,
      blocked: false,
      hidden: false,
    };
    this.placeOnEdge(car);
    return car;
  }

  private placeOnEdge(c: Car) {
    const a = nodeXZ(c.from);
    const d = dirOf(c.from, c.to);
    const r = rightOf(d);
    c.x = a.x + d.x * c.s + r.x * c.offset;
    c.z = a.z + d.z * c.s + r.z * c.offset;
    c.heading = headingOf(d);
  }

  private chooseNext(c: Car, closed: ReadonlySet<string>): Node {
    if (c.route) return c.route[Math.min(c.routeIdx + 2, c.route.length - 1)];
    const d = dirOf(c.from, c.to);
    const opts = neighbours(c.to).filter((n) => !(n[0] === c.from[0] && n[1] === c.from[1]) && !closed.has(edgeKey(c.to, n)));
    if (!opts.length) return c.from;
    const weights = opts.map((n) => {
      const d2 = dirOf(c.to, n);
      return d2.x === d.x && d2.z === d.z ? 2.2 : 1;
    });
    let u = this.rng() * weights.reduce((a, b) => a + b, 0);
    for (let k = 0; k < opts.length; k++) {
      u -= weights[k];
      if (u <= 0) return opts[k];
    }
    return opts[0];
  }

  private beginTurn(c: Car) {
    const next = c.next!;
    const a = nodeXZ(c.from);
    const b = nodeXZ(c.to);
    const d = dirOf(c.from, c.to);
    const r = rightOf(d);
    const d2 = dirOf(c.to, next);
    const r2 = rightOf(d2);
    c.p0 = { x: a.x + d.x * S1 + r.x * c.offset, z: a.z + d.z * S1 + r.z * c.offset };
    c.p2 = { x: b.x + d2.x * S0 + r2.x * LANE, z: b.z + d2.z * S0 + r2.z * LANE };
    if (d2.x === -d.x && d2.z === -d.z) {
      c.p1 = { x: b.x + d.x * 2, z: b.z + d.z * 2 };
    } else {
      const k = (c.p2.x - c.p0.x) * d.x + (c.p2.z - c.p0.z) * d.z;
      c.p1 = { x: c.p0.x + d.x * k, z: c.p0.z + d.z * k };
    }
    c.tlen = (dist(c.p0, c.p1) + dist(c.p1, c.p2) + dist(c.p0, c.p2)) / 2 || 1;
    c.tt = 0;
    c.turning = true;
  }

  private isStraight(c: Car): boolean {
    if (!c.next) return true;
    const d = dirOf(c.from, c.to);
    const d2 = dirOf(c.to, c.next);
    return d.x === d2.x && d.z === d2.z;
  }

  spawnRandom(avoid?: Vec2, minDist = 60): Car | null {
    for (let tries = 0; tries < 20; tries++) {
      const from: Node = [Math.floor(this.rng() * M), Math.floor(this.rng() * M)];
      const to = pick(this.rng, neighbours(from));
      const s = range(this.rng, S0 + 4, S1 - 8);
      const car = this.makeCar(from, to, s);
      if (avoid && Math.hypot(car.x - avoid.x, car.z - avoid.z) < minDist) continue;
      const clash = this.cars.some((o) => !o.turning && o.from[0] === from[0] && o.from[1] === from[1] && o.to[0] === to[0] && o.to[1] === to[1] && Math.abs(o.s - s) < 14);
      if (clash) continue;
      car.next = this.chooseNext(car, new Set());
      this.cars.push(car);
      return car;
    }
    return null;
  }

  /** Adds an escorted vehicle that drives a node route and stops at `goalS` on the last edge. */
  spawnConvoy(route: Node[], goalS: number, kindName = 'van'): Car {
    const kind = { ...KINDS.find((k) => k.name === kindName)!, cruise: 14 };
    const car = this.makeCar(route[0], route[1], S0 + 2, kind);
    car.convoy = true;
    car.route = route;
    car.routeIdx = 0;
    car.goalS = goalS;
    car.speed = 0;
    car.hidden = true;
    car.next = route.length > 2 ? route[2] : null;
    this.cars.push(car);
    return car;
  }

  /** Removes civilian cars standing on closed streets. */
  clearClosed(closed: ReadonlySet<string>) {
    for (const c of [...this.cars]) {
      if (c.convoy) continue;
      if (closed.has(edgeKey(c.from, c.to)) || (c.next && closed.has(edgeKey(c.to, c.next)))) this.remove(c);
    }
  }

  remove(car: Car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }

  /** Physical circles along the car body. */
  circles(c: Car): Obstacle[] {
    const n = Math.max(2, Math.ceil(c.kind.L / c.kind.W));
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    const r = c.kind.W / 2;
    const span = c.kind.L / 2 - r;
    const out: Obstacle[] = [];
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : -span + (2 * span * k) / (n - 1);
      out.push({ x: c.x + fx * t, z: c.z + fz * t, r, owner: c });
    }
    return out;
  }

  private rebuildBuckets() {
    this.buckets.clear();
    const add = (k: string, car: Car, s: number) => {
      let b = this.buckets.get(k);
      if (!b) this.buckets.set(k, (b = []));
      b.push({ car, s });
    };
    for (const c of this.cars) {
      if (!c.turning) add(bucketKey(c.from, c.to), c, c.s);
      else {
        add(bucketKey(c.from, c.to), c, S1 + c.tt * c.tlen);
        if (c.next) add(bucketKey(c.to, c.next), c, S0 - (1 - c.tt) * c.tlen);
      }
    }
  }

  /** Free distance ahead of a car along its lane, to the next car's tail. */
  private leaderGap(c: Car): number {
    let gap = Infinity;
    // `myS` is this car's position projected onto the bucket's edge.
    const scan = (key: string, myS: number) => {
      const b = this.buckets.get(key);
      if (!b) return;
      for (const e of b) {
        if (e.car === c || e.s <= myS) continue;
        if (!e.car.turning && !c.turning && Math.abs(e.car.offset - c.offset) > 2.2) continue;
        const g = e.s - myS - (e.car.kind.L + c.kind.L) / 2;
        if (g < gap) gap = g;
      }
    };
    if (!c.turning) {
      scan(bucketKey(c.from, c.to), c.s);
      if (c.next && S1 - c.s < 30) scan(bucketKey(c.to, c.next), S0 - RW - (S1 - c.s));
    } else if (c.next) {
      scan(bucketKey(c.to, c.next), S0 - (1 - c.tt) * c.tlen);
    }
    return gap;
  }

  /** Distance to the nearest obstacle in the car's path. */
  private obstacleGap(c: Car, obs: Obstacle[]): number {
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    let gap = Infinity;
    this.obsHonk = false;
    for (const o of obs) {
      if (o.owner === c) continue;
      const dx = o.x - c.x;
      const dz = o.z - c.z;
      if (dx * dx + dz * dz > 400) continue;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0) continue;
      const side = Math.abs(-dx * fz + dz * fx);
      if (side > c.kind.W / 2 + o.r + 0.3) continue;
      const g = ahead - c.kind.L / 2 - o.r;
      if (g < gap) {
        gap = g;
        this.obsHonk = !!o.honk;
      }
    }
    return gap;
  }

  update(dt: number, env: TrafficEnv) {
    // Keep the population near its target, adding and removing out of sight.
    const target = Math.min(MAX_CARS - 4, Math.round(this.baseCount * this.density));
    const civilians = this.cars.filter((c) => !c.convoy);
    if (civilians.length < target) {
      for (let k = 0; k < 3 && civilians.length + k < target; k++) this.spawnRandom(env.player, 90);
    } else if (civilians.length > target) {
      const far = civilians.find((c) => Math.hypot(c.x - env.player.x, c.z - env.player.z) > 160);
      if (far) this.remove(far);
    }

    this.rebuildBuckets();
    for (const c of this.cars) {
      if (c.arrived) {
        c.speed = 0;
        continue;
      }
      const cruise = c.kind.cruise;
      let vDes = cruise;
      let offTarget = LANE;
      const gapCar = this.leaderGap(c);
      const gapObs = this.obstacleGap(c, env.obstacles);
      const gap = Math.min(gapCar, gapObs);
      const stopAt = (d: number) => Math.sqrt(2 * 4.5 * Math.max(0, d - 1.5));

      if (!c.turning) {
        if (S1 - c.s < 18 && !this.isStraight(c)) vDes = Math.min(vDes, cruise * 0.55);
        const dStop = STOP - c.s;
        if (!c.convoy && dStop > -0.5) {
          const d = dirOf(c.from, c.to);
          const l = this.light(c.to, d.x !== 0 ? 'EW' : 'NS', env.time);
          const canStop = c.speed * c.speed <= 2 * 5 * Math.max(0.1, dStop);
          if (l === 'red' || (l === 'amber' && canStop)) vDes = Math.min(vDes, stopAt(dStop + 1.5));
        }
      } else {
        vDes = this.isStraight(c) ? cruise : cruise * 0.55;
      }

      // Lights and sirens: pull to the right and stop, or hold at the stop line.
      if (!c.convoy && env.sirenOn && Math.hypot(c.x - env.player.x, c.z - env.player.z) < env.sirenRange) c.yieldT = 1.4;
      if (c.yieldT > 0) {
        if (!(env.sirenOn && Math.hypot(c.x - env.player.x, c.z - env.player.z) < env.sirenRange)) c.yieldT -= dt;
        if (!c.turning) {
          // Pull to the right and stop, never past the stop line, so the lane and junction stay clear.
          offTarget = SHOULDER;
          vDes = Math.min(vDes, c.offset < SHOULDER - 0.6 ? 5 : 0);
          const dStop = STOP - c.s;
          if (dStop > -0.5) vDes = Math.min(vDes, stopAt(dStop + 1.5));
        } else vDes = Math.min(vDes, cruise * 0.5);
      }

      if (c.bumpT > 0) {
        c.bumpT -= dt;
        vDes = 0;
      }

      vDes = Math.min(vDes, stopAt(gap + 1.5));
      if (c.convoy && c.route && !c.turning && c.routeIdx >= c.route.length - 2) {
        vDes = Math.min(vDes, stopAt(c.goalS - c.s + 1.5));
        if (c.goalS - c.s < 0.8 && c.speed < 0.5) c.arrived = true;
      }
      c.blocked = gap < 6 && vDes < 1;

      // Honk at a player blocking the lane without a siren.
      if (!c.convoy && this.obsHonk && gapObs < 5 && gapObs <= gapCar && c.speed < 0.5 && !env.sirenOn) {
        c.waitT += dt;
        if (c.waitT > 3.5) {
          c.waitT = -6;
          env.onHonk?.(c);
        }
      } else if (c.waitT > 0) c.waitT = 0;

      if (vDes > c.speed) c.speed = Math.min(vDes, c.speed + 3.5 * dt);
      else c.speed = Math.max(vDes, c.speed - 9 * dt);
      c.braking = vDes < c.speed - 0.3 || (c.speed < 0.5 && vDes < 0.5);

      if (!c.turning) {
        c.offset = damp(c.offset, offTarget, c.speed > 1 || offTarget > c.offset ? 1.8 : 0.6, dt);
        c.s += c.speed * dt;
        if (c.s >= S1) {
          if (!c.next) c.next = this.chooseNext(c, env.closed);
          this.beginTurn(c);
        } else this.placeOnEdge(c);
        if (c.turning) this.placeOnTurn(c);
      } else {
        c.tt += (c.speed * dt) / c.tlen;
        if (c.tt >= 1) {
          c.from = c.to;
          c.to = c.next!;
          c.turning = false;
          c.s = S0 + (c.tt - 1) * c.tlen;
          c.offset = LANE;
          if (c.route) c.routeIdx++;
          c.next = c.route && c.routeIdx >= c.route.length - 2 ? null : this.chooseNext(c, env.closed);
          // Never drive into a road that was closed while we were approaching it.
          if (!c.route && env.closed.has(edgeKey(c.from, c.to))) {
            const back = c.from;
            c.from = c.to;
            c.to = back;
            c.s = S0;
          }
          this.placeOnEdge(c);
        } else this.placeOnTurn(c);
      }
    }
  }

  private placeOnTurn(c: Car) {
    const t = clamp(c.tt, 0, 1);
    const u = 1 - t;
    c.x = u * u * c.p0.x + 2 * u * t * c.p1.x + t * t * c.p2.x;
    c.z = u * u * c.p0.z + 2 * u * t * c.p1.z + t * t * c.p2.z;
    const dx = 2 * u * (c.p1.x - c.p0.x) + 2 * t * (c.p2.x - c.p1.x);
    const dz = 2 * u * (c.p1.z - c.p0.z) + 2 * t * (c.p2.z - c.p1.z);
    if (dx * dx + dz * dz > 1e-6) c.heading = Math.atan2(dx, dz);
  }

  /** Stops a car for a moment after the player hits it. */
  bump(c: Car) {
    c.bumpT = 2.5;
    c.speed = 0;
  }

  render(dt: number, time: number) {
    const { m4, q, v, sc, col } = this;
    let k = 0;
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of this.cars) {
      if (c.hidden) continue;
      const kd = c.kind;
      q.setFromAxisAngle(up, c.heading);
      m4.compose(v.set(c.x, 0.32, c.z), q, sc.set(kd.W, kd.bodyH, kd.L));
      this.bodies.setMatrixAt(k, m4);
      this.bodies.setColorAt(k, col.set(c.paint));
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      const off = kd.cabOff * kd.L;
      m4.compose(v.set(c.x + fx * off, 0.32 + kd.bodyH, c.z + fz * off), q, sc.set(kd.W * 0.92, kd.cabH, kd.L * kd.cabLen));
      this.cabs.setMatrixAt(k, m4);
      this.cabs.setColorAt(k, col.set(c.cabPaint));
      const back = -kd.L / 2 - 0.02;
      m4.compose(v.set(c.x + fx * back, 0.32 + kd.bodyH * 0.72, c.z + fz * back), q, sc.set(kd.W * 0.86, 1, 1));
      this.tails.setMatrixAt(k, m4);
      this.tails.setColorAt(k, col.set(c.braking ? 0xff2222 : 0x6a0e0e));
      const rx = Math.cos(c.heading);
      const rz = -Math.sin(c.heading);
      const wl = kd.L / 2 - 0.9;
      const ww = kd.W / 2 - 0.08;
      let w = 0;
      for (const a of [wl, -wl]) {
        for (const b of [ww, -ww]) {
          m4.compose(v.set(c.x + fx * a + rx * b, 0.36, c.z + fz * a + rz * b), q, sc.set(1, 1, 1));
          this.wheels.setMatrixAt(k * 4 + w++, m4);
        }
      }
      k++;
    }
    for (const m of [this.bodies, this.cabs, this.tails]) {
      m.count = k;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.wheels.count = k * 4;
    this.wheels.instanceMatrix.needsUpdate = true;

    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.25;
      const colors = { green: 0x2bff6a, amber: 0xffb300, red: 0xff2a2a };
      this.lampNodes.forEach((l, i) => this.lamps.setColorAt(i, col.set(colors[this.light(l.node, l.axis, time)])));
      if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    }
  }
}
