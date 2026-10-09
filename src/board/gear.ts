/*
 * Booth gear, modelled on the real thing (Section 13.6 decoration, made
 * life-size): the things that are always on a DJ's table.
 *   headphones     closed-back DJ cans lying on the table: padded band,
 *                  swivel yokes, leatherette cushions, coiled cable, gold jack
 *   laptop         open, running DJ software that shows your two decks
 *   USB stick      the one with tonight's set on it
 *   booth mic      gooseneck on a weighted base with its switch
 *   booth monitor  a near-field speaker: woofer (moving with the kick),
 *                  tweeter, bass port, power light
 *   setlist        a sheet of paper, taped down, in marker
 *   gaffer tape    a torn strip with your name written on it
 *   water bottle   because it's hot in here
 *   record crate   a 12-inch crate (33 cm inside, the size LP sleeves need)
 *                  of sleeves leaning back, each with its own made-up artwork
 * None of them control anything. TODO: Blender models (Section 14).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { nameService } from '../name/NameService';
import type { PartCtx } from '../three/parts';
import { glassSheen, knurledKnob, turnedMetalTexture } from '../three/realism';
import type { Built, CompDef } from './catalog';
import { rng } from '../core/util';
import type { BoardComponent } from './format';
import { boardMaterial } from './materials';
import { BPart, zoneMat, type BoardEnv } from './parts';

abstract class Gear extends BPart {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    this.cursor = 'default';
  }
}

const mat = (color: string, roughness = 0.6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const chrome = () => boardMaterial({ id: 'chrome', color: '#c9ced6' });
/** paper and tape lie this far up: clear of the workshop's cutting mat, still flat on a booth top */
const FLAT = 0.0028;

/** a tube along a list of points */
function tube(pts: THREE.Vector3[], r: number, m: THREE.Material, segs = 64, closed = false): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), segs, r, 10, closed), m);
}

/* ------------------------------ headphones ------------------------------ */

class Headphones extends Gear {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const shell = zoneMat(p, 0);
    const pad = mat('#141416', 0.82);
    const metal = chrome();
    const cupR = 0.042;
    const sep = 0.088;
    for (const s of [-1, 1]) {
      const cup = new THREE.Group();
      // the cup: a rounded shell lying face down, the cushion under it
      const body = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(cupR, 0), new THREE.Vector2(cupR * 1.02, 0.012), new THREE.Vector2(cupR * 0.95, 0.024), new THREE.Vector2(cupR * 0.7, 0.03), new THREE.Vector2(0, 0.031)], 48), shell);
      body.position.y = 0.012;
      body.castShadow = true;
      const cushion = new THREE.Mesh(new THREE.TorusGeometry(cupR * 0.84, 0.0085, 12, 48), pad);
      cushion.rotation.x = Math.PI / 2;
      cushion.position.y = 0.008;
      const plate = new THREE.Mesh(new THREE.CircleGeometry(cupR * 0.55, 40), new THREE.MeshStandardMaterial({ map: turnedMetalTexture(), color: p.colors[1], metalness: 0.85, roughness: 0.3 }));
      plate.rotation.x = -Math.PI / 2;
      plate.position.y = 0.0435;
      cup.add(body, cushion, plate);
      // the swivel yoke: a metal fork round the cup
      const yoke = tube([new THREE.Vector3(-cupR * 1.05, 0.026, 0), new THREE.Vector3(-cupR * 0.8, 0.04, -cupR * 0.75), new THREE.Vector3(0, 0.045, -cupR * 1.12), new THREE.Vector3(cupR * 0.8, 0.04, -cupR * 0.75), new THREE.Vector3(cupR * 1.05, 0.026, 0)], 0.0022, metal, 40);
      cup.add(yoke);
      cup.position.set(s * sep, 0, 0.01);
      this.animGroup.add(cup);
      this.addHit(body);
    }
    // the padded headband, arched behind the cups
    const band: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const a = Math.PI * t;
      band.push(new THREE.Vector3(-Math.cos(a) * sep, 0.05 + Math.sin(a) * 0.012, -cupR * 1.12 - Math.sin(a) * 0.075));
    }
    this.animGroup.add(tube(band, 0.0075, mat('#1a1a1d', 0.75), 64));
    this.animGroup.add(tube(band.map((v) => v.clone().add(new THREE.Vector3(0, 0.008, 0))), 0.0035, metal, 64));
    // the coiled cable and its gold jack
    const coil: THREE.Vector3[] = [];
    for (let i = 0; i <= 300; i++) {
      const t = i / 300;
      const a = t * Math.PI * 2 * 26;
      coil.push(new THREE.Vector3(-sep - 0.01 + t * 0.03 + Math.cos(a) * 0.006, 0.007 + Math.sin(a) * 0.006, 0.04 + t * 0.22));
    }
    const cord = mat('#0d0d0f', 0.5);
    this.animGroup.add(tube(coil, 0.0016, cord, 600));
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 16), cord);
    plug.rotation.x = Math.PI / 2;
    plug.position.set(-sep + 0.02, 0.006, 0.275);
    const jack = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.03, 16), boardMaterial({ id: 'gold', color: '#d4a64a' }));
    jack.rotation.x = Math.PI / 2;
    jack.position.set(-sep + 0.02, 0.006, 0.305);
    this.animGroup.add(plug, jack);
  }
}

/* ------------------------------ laptop ------------------------------ */

class Laptop extends Gear {
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;

  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const W = 0.31;
    const D = 0.215;
    const alu = zoneMat(p, 0);
    const base = new THREE.Mesh(new RoundedBoxGeometry(W, 0.012, D, 3, 0.004), alu);
    base.position.y = 0.006;
    base.castShadow = true;
    this.animGroup.add(base);
    this.addHit(base);
    // keyboard and trackpad
    const keys = document.createElement('canvas');
    keys.width = 512;
    keys.height = 200;
    const g = keys.getContext('2d')!;
    g.fillStyle = '#9ea3aa';
    g.fillRect(0, 0, 512, 200);
    g.fillStyle = '#16171a';
    const rows = [14, 14, 13, 12, 10];
    rows.forEach((n, r) => {
      const kw = 512 / 14.6;
      for (let i = 0; i < n; i++) g.fillRect(8 + i * kw + (14 - n) * kw * 0.5, 8 + r * 37, kw - 5, 31);
    });
    g.fillRect(150, 8 + 5 * 37 - 37 + 37, 210, 0);
    const kt = new THREE.CanvasTexture(keys);
    kt.colorSpace = THREE.SRGBColorSpace;
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, D * 0.4), new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6 }));
    kb.rotation.x = -Math.PI / 2;
    kb.position.set(0, 0.0122, -D * 0.12);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.36, D * 0.26), mat('#8d9299', 0.35, 0.5));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.0122, D * 0.3);
    this.animGroup.add(kb, pad);
    // the lid, open a little past upright, with the software on screen
    const lid = new THREE.Group();
    lid.position.set(0, 0.012, -D / 2);
    lid.rotation.x = -0.32;
    const back = new THREE.Mesh(new RoundedBoxGeometry(W, D * 0.98, 0.006, 3, 0.003), alu);
    back.position.set(0, D * 0.49, -0.003);
    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.98, D * 0.95), mat('#050506', 0.3));
    bezel.position.set(0, D * 0.49, 0.0001);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 400;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.92, D * 0.86), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    screen.position.set(0, D * 0.5, 0.0004);
    const sheen = glassSheen(W * 0.98, D * 0.95);
    sheen.rotation.x = 0;
    sheen.position.set(0, D * 0.49, 0.0007);
    lid.add(back, bezel, screen, sheen);
    this.animGroup.add(lid);
    this.addHit(back);
  }

  update(c: PartCtx): void {
    super.update(c);
    if (c.frame % 3 !== 0) return;
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#0d0f13';
    g.fillRect(0, 0, W, H);
    // two decks: title, BPM and a waveform moving under the playhead
    for (let i = 0; i < 2; i++) {
      const d = c.engine.deck(i + 1);
      const y0 = 14 + i * 120;
      g.fillStyle = '#1a1e26';
      g.fillRect(10, y0, W - 20, 110);
      g.fillStyle = '#e8ebf0';
      g.font = '600 18px "Barlow Condensed", sans-serif';
      g.fillText(d.track?.meta.title ?? 'Load a track', 18, y0 + 22, W * 0.6);
      g.fillStyle = i ? '#ff9f1c' : '#4cc9f0';
      g.font = '700 22px "JetBrains Mono", monospace';
      g.textAlign = 'right';
      g.fillText(d.loaded ? d.bpm.toFixed(1) : '--', W - 20, y0 + 24);
      g.textAlign = 'left';
      const [l, r] = c.levels(i + 1);
      const lv = Math.max(l, r, d.playing ? 0.15 : 0.04);
      for (let x = 20; x < W - 20; x += 3) {
        const v = (0.3 + 0.7 * Math.abs(Math.sin(x * 0.07 + (d.playing ? c.now * 8 : 0) + i) * Math.sin(x * 0.019 + c.now * (d.playing ? 1.3 : 0)))) * lv;
        g.fillRect(x, y0 + 72 - v * 40, 2, v * 80);
      }
      g.fillStyle = '#ffffff';
      g.fillRect(W / 2, y0 + 30, 2, 76);
    }
    // the library below
    g.fillStyle = '#12151b';
    g.fillRect(10, 258, W - 20, H - 268);
    g.font = '500 15px "Barlow Condensed", sans-serif';
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i === 2 ? '#24304a' : i % 2 ? '#141820' : '#12151b';
      g.fillRect(10, 262 + i * 18, W - 20, 18);
      g.fillStyle = '#9aa3b4';
      g.fillText(['Low Ceiling Theory', 'Third Floor Tape', 'Five AM Hum', 'Sticky Floor', 'Strobe Church', 'Last Bus Home', 'Piano In The Rain'][i], 18, 276 + i * 18);
      g.fillText(['123.0', '124.0', '122.0', '128.0', '128.0', '127.0', '125.0'][i], W - 70, 276 + i * 18);
    }
    this.tex.needsUpdate = true;
  }
}

/* ------------------------------ USB stick ------------------------------ */

class UsbStick extends Gear {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.008, 0.042, 2, 0.003), zoneMat(p, 0));
    body.position.y = 0.004;
    body.castShadow = true;
    const plug = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0045, 0.012), chrome());
    plug.position.set(0, 0.004, -0.026);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.004, 0.0012, 8, 24), chrome());
    loop.rotation.x = Math.PI / 2;
    loop.position.set(0, 0.004, 0.024);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 12), new THREE.MeshBasicMaterial({ color: p.colors[2], toneMapped: false }));
    led.rotation.x = -Math.PI / 2;
    led.position.set(0, 0.0081, 0.012);
    this.animGroup.add(body, plug, loop, led);
    this.addHit(body);
  }
}

/* ------------------------------ booth mic ------------------------------ */

class BoothMic extends Gear {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const black = mat('#141416', 0.55, 0.3);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.016, 40), black);
    base.position.y = 0.008;
    base.castShadow = true;
    const sw = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.004, 0.008, 2, 0.001), new THREE.MeshStandardMaterial({ color: p.colors[2], emissive: p.colors[2], emissiveIntensity: 0.4 }));
    sw.position.set(0, 0.017, 0.03);
    // the gooseneck: a curving segmented tube
    const pts = [new THREE.Vector3(0, 0.016, 0), new THREE.Vector3(0, 0.12, -0.01), new THREE.Vector3(0.01, 0.22, 0.03), new THREE.Vector3(0.015, 0.28, 0.1), new THREE.Vector3(0.015, 0.29, 0.15)];
    const neck = tube(pts, 0.0045, chrome(), 80);
    const rings = tube(pts, 0.0049, new THREE.MeshStandardMaterial({ color: '#30343a', roughness: 0.4, metalness: 0.7, wireframe: true }), 80);
    // the head: a slim barrel with a grille
    const head = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.06, 24), black);
    barrel.rotation.x = Math.PI / 2;
    const grille = new THREE.Mesh(new THREE.SphereGeometry(0.012, 20, 14), new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.5, metalness: 0.6, wireframe: true }));
    grille.position.z = 0.034;
    const foam = new THREE.Mesh(new THREE.SphereGeometry(0.0108, 16, 12), zoneMat(p, 0));
    foam.position.z = 0.034;
    head.add(barrel, grille, foam);
    head.position.set(0.015, 0.29, 0.18);
    head.rotation.x = 0.35;
    this.animGroup.add(base, sw, neck, rings, head);
    this.addHit(base);
    this.addHit(barrel);
  }
}

/* ------------------------------ booth monitor ------------------------------ */

class BoothMonitor extends Gear {
  private cone: THREE.Group;
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const W = 0.2;
    const H = 0.3;
    const D = 0.24;
    const cab = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.012), zoneMat(p, 0));
    cab.position.y = H / 2;
    cab.castShadow = true;
    this.animGroup.add(cab);
    this.addHit(cab);
    const front = D / 2 + 0.0005;
    // woofer: surround, cone, dust cap; it moves with the kick
    this.cone = new THREE.Group();
    const surround = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 10, 48), mat('#121214', 0.85));
    const cone = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.066, 0), new THREE.Vector2(0.03, -0.022), new THREE.Vector2(0.02, -0.024)], 48), new THREE.MeshStandardMaterial({ color: p.colors[1], roughness: 0.7, side: THREE.DoubleSide }));
    cone.rotation.x = -Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), mat('#18181b', 0.4));
    cap.rotation.x = Math.PI / 2;
    cap.position.z = -0.016;
    this.cone.add(surround, cone, cap);
    this.cone.position.set(0, 0.105, front);
    // a satin gunmetal trim ring and a soft dome tweeter, as on most studio monitors (not mirror chrome)
    const trim = mat('#2b2d32', 0.38, 0.75);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.004, 8, 48), trim);
    ring.position.set(0, 0.105, front);
    // tweeter in its waveguide
    const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.016, 0.012, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.4, side: THREE.DoubleSide }));
    guide.rotation.x = Math.PI / 2;
    guide.position.set(0, 0.235, front - 0.006);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#3a3c41', 0.55));
    dome.rotation.x = Math.PI / 2;
    dome.position.set(0, 0.235, front - 0.011);
    // bass port and power light
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 24), mat('#050506', 0.9));
    port.rotation.x = Math.PI / 2;
    port.position.set(-0.06, 0.03, front);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.003, 12), new THREE.MeshBasicMaterial({ color: p.colors[2], toneMapped: false }));
    led.position.set(0.075, 0.025, front + 0.001);
    this.animGroup.add(this.cone, ring, guide, dome, port, led);
  }
  update(c: PartCtx): void {
    super.update(c);
    this.cone.position.z = 0.12 + 0.0005 + this.env.hooks.kick() * 0.003;
  }
}

/* ------------------------------ paper, tape, bottle ------------------------------ */

const PEN = '"Permanent Marker", "Marker Felt", "Comic Sans MS", cursive';

class Setlist extends Gear {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const c = document.createElement('canvas');
    c.width = 420;
    c.height = 594;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(80,120,190,0.25)';
    for (let y = 70; y < c.height; y += 34) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(c.width, y);
      g.stroke();
    }
    g.fillStyle = p.colors[2];
    g.font = `700 40px ${PEN}`;
    // centred, clear of the tape on the corners
    g.textAlign = 'center';
    g.fillText(String(p.title || 'SET').slice(0, 18), c.width / 2, 54);
    g.textAlign = 'left';
    const lines = String(p.lines || 'Low Ceiling Theory 123 8A\nThird Floor Tape 124 9A\nFive AM Hum 122 7A\nSticky Floor 128\nShake The Booth 127\nStrobe Church 128 !!\nPiano In The Rain 125\nSunrise Ring Road 124').split(/\n|;/).map((l) => l.trim()).filter(Boolean).slice(0, 14);
    // marker, not biro: thick and dark enough to read under the booth lights
    g.font = `700 24px ${PEN}`;
    lines.forEach((l, i) => {
      g.fillStyle = '#0b0f1a';
      g.fillText(`${i + 1}. ${l}`.slice(0, 34), 22, 96 + i * 34);
      if (i === 3) {
        // one crossed out: plans change
        g.strokeStyle = '#1d2433';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(20, 90 + i * 34);
        g.lineTo(300, 88 + i * 34);
        g.stroke();
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    // the sheet, curling up a touch at the bottom
    const geo = new THREE.PlaneGeometry(0.15, 0.212, 8, 12);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.max(0, -y - 0.07) ** 2 * 0.6);
    }
    geo.computeVertexNormals();
    // a little under white: paper under the lamp shouldn't burn out to a blank sheet
    const sheet = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, color: '#d6d2c8', roughness: 0.92, side: THREE.DoubleSide }));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = FLAT;
    this.animGroup.add(sheet);
    this.addHit(sheet);
    for (const s of [-1, 1]) {
      const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.016), mat('#1b1b1d', 0.95));
      tape.rotation.set(-Math.PI / 2, 0, s * 0.5);
      tape.position.set(s * 0.068, FLAT + 0.0004, -0.1);
      this.animGroup.add(tape);
    }
  }
}

class GafferTape extends Gear {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const g = c.getContext('2d')!;
    // torn ends: a jagged edge each side
    g.fillStyle = p.colors[0];
    g.beginPath();
    g.moveTo(14, 0);
    for (let y = 0; y <= 96; y += 8) g.lineTo(6 + ((y * 7) % 13), y);
    for (let y = 96; y >= 0; y -= 8) g.lineTo(500 + ((y * 5) % 11), y);
    g.closePath();
    g.fill();
    // cloth weave
    g.globalAlpha = 0.08;
    g.fillStyle = '#ffffff';
    for (let x = 0; x < 512; x += 4) g.fillRect(x, 0, 1, 96);
    g.globalAlpha = 1;
    g.fillStyle = p.colors[1];
    g.font = `400 54px ${PEN}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((String(p.text || '') || nameService.text || 'DJ').slice(0, 18), 256, 52, 470);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const w = (p.w as number) || 0.2;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (96 / 512)), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.95, alphaTest: 0.5 }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.y = FLAT;
    this.animGroup.add(strip);
    this.addHit(strip);
  }
}

class WaterBottle extends Gear {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    // a 500 ml PET bottle, 6.8 cm across and 22 cm tall: a petal foot, grip rings at the waist, a shoulder up to the neck
    const prof: [number, number][] = [[0.0, 0.003], [0.02, 0], [0.031, 0.001], [0.034, 0.008]];
    for (let y = 0.012; y <= 0.155; y += 0.0055) {
      const waist = y > 0.045 && y < 0.075;
      prof.push([waist ? 0.0325 + 0.0012 * Math.cos(((y - 0.045) / 0.0075) * Math.PI) : 0.034, y]);
    }
    prof.push([0.033, 0.165], [0.028, 0.188], [0.018, 0.207], [0.0135, 0.214], [0.0135, 0.222]);
    const outline = prof.map(([x, y]) => new THREE.Vector2(x, y));
    const bottle = new THREE.Mesh(new THREE.LatheGeometry(outline, 48), new THREE.MeshStandardMaterial({ color: '#e6f2fa', transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0, envMapIntensity: 1.6, depthWrite: false }));
    bottle.renderOrder = 2;
    // the water inside, three-quarters full, following the bottle's shape
    const fill = prof.filter(([, y]) => y <= 0.15).map(([x, y]) => new THREE.Vector2(x * 0.94, y + 0.0015));
    fill.push(new THREE.Vector2(0, 0.1515));
    const water = new THREE.Mesh(new THREE.LatheGeometry(fill, 40), new THREE.MeshStandardMaterial({ color: '#a9d8ef', transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false }));
    water.renderOrder = 1;
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0344, 0.0344, 0.055, 48, 1, true), new THREE.MeshStandardMaterial({ color: p.colors[2], roughness: 0.45 }));
    label.position.y = 0.11;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0346, 0.0346, 0.008, 48, 1, true), new THREE.MeshStandardMaterial({ color: p.colors[1], roughness: 0.45 }));
    band.position.y = 0.1;
    // a ridged screw cap and the tamper ring under it
    const cap = new THREE.Mesh(knurledKnob(0.0145, 0.016, 36, 0.04), zoneMat(p, 0));
    cap.position.y = 0.222;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0142, 0.0012, 6, 32), zoneMat(p, 0));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2195;
    this.animGroup.add(label, band, water, bottle, cap, ring);
    this.addHit(label);
    this.addHit(cap);
  }
}


/* ------------------------------ record crate ------------------------------ */

const SLEEVE = 0.315;

/** made-up sleeve art: colour fields, rings and type blocks, never a real record */
function sleeveTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const r = rng(seed * 7919 + 13);
  const hue = Math.floor(r() * 360);
  const style = seed % 4;
  g.fillStyle = `hsl(${hue} ${30 + r() * 50}% ${style === 3 ? 88 : 18 + r() * 30}%)`;
  g.fillRect(0, 0, 256, 256);
  if (style === 0) {
    // concentric rings, a nod to the record inside
    for (let i = 6; i > 0; i--) {
      g.fillStyle = `hsl(${(hue + i * 25) % 360} 70% ${30 + i * 7}%)`;
      g.beginPath();
      g.arc(128 + (r() - 0.5) * 30, 128, i * 18, 0, Math.PI * 2);
      g.fill();
    }
  } else if (style === 1) {
    // hard-edged colour blocks
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `hsl(${(hue + 40 + r() * 140) % 360} ${50 + r() * 40}% ${35 + r() * 40}%)`;
      g.fillRect(r() * 200, r() * 200, 40 + r() * 140, 20 + r() * 90);
    }
  } else if (style === 2) {
    // a photo-ish gradient with a sun
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `hsl(${hue} 60% 25%)`);
    grd.addColorStop(1, `hsl(${(hue + 50) % 360} 80% 60%)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = `hsl(${(hue + 180) % 360} 90% 70%)`;
    g.beginPath();
    g.arc(90 + r() * 80, 150, 34, 0, Math.PI * 2);
    g.fill();
  } else {
    // a plain white-label style die-cut sleeve: the centre hole shows the label
    g.fillStyle = '#121214';
    g.beginPath();
    g.arc(128, 128, 54, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `hsl(${hue} 70% 55%)`;
    g.beginPath();
    g.arc(128, 128, 30, 0, Math.PI * 2);
    g.fill();
  }
  // a block of type in one corner: lines, not words
  g.fillStyle = style === 3 ? '#1d2433' : 'rgba(255,255,255,0.82)';
  const y0 = r() > 0.5 ? 18 : 206;
  for (let i = 0; i < 3; i++) g.fillRect(18, y0 + i * 11, 40 + r() * 90, i === 0 ? 7 : 4);
  // shelf wear: a ring rubbed into the sleeve and softened corners
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

class RecordCrate extends Gear {
  constructor(comp: BoardComponent, env: BoardEnv) {
    super(comp, env);
    const p = this.p;
    const inside = 0.335;
    const wall = 0.012;
    const H = 0.3;
    const out = inside + wall * 2;
    const box = zoneMat(p, 0);
    // four walls with hand holes cut in the sides, and a floor
    const sideShape = (w: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      s.lineTo(w / 2, 0);
      s.lineTo(w / 2, H);
      s.lineTo(-w / 2, H);
      s.closePath();
      const hole = new THREE.Path();
      hole.absarc(-0.04, H - 0.05, 0.016, Math.PI / 2, (Math.PI * 3) / 2, false);
      hole.absarc(0.04, H - 0.05, 0.016, -Math.PI / 2, Math.PI / 2, false);
      hole.closePath();
      s.holes.push(hole);
      return new THREE.ExtrudeGeometry(s, { depth: wall, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 10 });
    };
    // front and back run the full width; the ends fit between them (extruded along +z, so a turned wall's thickness runs along +x)
    const longGeo = sideShape(out);
    const endGeo = sideShape(inside);
    const walls: [THREE.BufferGeometry, number, number, number][] = [
      [longGeo, 0, -out / 2, 0],
      [longGeo, 0, out / 2 - wall, 0],
      [endGeo, -out / 2, 0, Math.PI / 2],
      [endGeo, out / 2 - wall, 0, Math.PI / 2],
    ];
    for (const [geo, x, z, ry] of walls) {
      const m = new THREE.Mesh(geo, box);
      m.rotation.y = ry;
      m.position.set(x, 0, z);
      m.castShadow = true;
      this.animGroup.add(m);
      this.addHit(m);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(out, wall, out), box);
    floor.position.y = wall / 2;
    this.animGroup.add(floor);
    // the records: sleeves leaning back against each other, front ones more upright
    const n = Math.round(Math.min(40, Math.max(4, Number(p.count) || 24)));
    const sleeveGeo = new THREE.BoxGeometry(SLEEVE, SLEEVE, 0.0032);
    const spine = new THREE.MeshStandardMaterial({ color: '#d9d4c8', roughness: 0.9 });
    const designs = Array.from({ length: 6 }, (_, i) => new THREE.MeshStandardMaterial({ map: sleeveTexture(i + 1 + (Number(p.seed) || 0) * 6), roughness: 0.62 }));
    const r = rng(Number(p.seed) || 3);
    // the back sleeve's top rests on the back wall; the rest pack forward by their thickness; fewer records lean further
    const t = 0.0032;
    const lean0 = 0.3 + (1 - n / 40) * 0.25;
    const back = -inside / 2 + SLEEVE * Math.sin(lean0);
    for (let i = 0; i < n; i++) {
      const face = designs[Math.floor(r() * designs.length)];
      const m = new THREE.Mesh(sleeveGeo, [spine, spine, spine, spine, face, face]);
      // the front few stand a little straighter, as if someone's been flipping through
      const flip = Math.max(0, i - (n - 4));
      const lean = lean0 - flip * 0.06 + (r() - 0.5) * 0.012;
      const zb = back + (i * t) / Math.cos(lean0);
      m.rotation.x = -lean;
      m.rotation.z = (r() - 0.5) * 0.015;
      m.position.set((r() - 0.5) * 0.006, wall + (SLEEVE / 2) * Math.cos(lean), zb - (SLEEVE / 2) * Math.sin(lean));
      m.castShadow = i === n - 1;
      this.animGroup.add(m);
    }
  }
}

/* ------------------------------ the list ------------------------------ */

const single = (P: new (c: BoardComponent, e: BoardEnv) => BPart) => (c: BoardComponent, env: BoardEnv): Built => {
  const p = new P(c, env);
  return { object: p.object, parts: [p] };
};

const gear = (type: string, label: string, blurb: string, icon: string, P: new (c: BoardComponent, e: BoardEnv) => BPart, cost: number, defaults: Record<string, unknown> = {}, options: CompDef['options'] = undefined): CompDef => ({ type, category: 'gear', label, blurb, icon, defaults: () => ({ fn: '', sound: 'silent', ...defaults }), cost, options, build: single(P) });

export const GEAR: CompDef[] = [
  gear('headphones', 'Headphones', 'Closed-back DJ headphones lying on the table: padded band, swivel cups, coiled cable.', '🎧', Headphones, 6, { material: 'matte', colors: ['#18191c', '#9ea4ac', '#2ec4f1'] }),
  gear('laptop', 'Laptop', 'Open, running DJ software that shows your two decks moving.', '💻', Laptop, 6, { material: 'brushed', colors: ['#b8bcc2', '#e8ebf0', '#4cc9f0'] }),
  gear('usb_stick', 'USB stick', 'Tonight’s set, plugged in or on the table.', '💾', UsbStick, 1, { material: 'gloss', colors: ['#ff2e88', '#e8ebf0', '#3ddc97'] }),
  gear('booth_mic', 'Booth mic', 'A gooseneck microphone on a weighted base.', '🎤', BoothMic, 4, { material: 'matte', colors: ['#202226', '#e8ebf0', '#ff3b3b'] }),
  gear('booth_monitor', 'Booth monitor', 'A near-field speaker: the woofer moves with the kick.', '🔈', BoothMonitor, 4, { material: 'matte', colors: ['#141518', '#2a2c31', '#4cc9f0'] }),
  gear('setlist', 'Setlist', 'A sheet of paper taped down, your set in marker (edit the lines).', '📝', Setlist, 1, { title: 'SET', lines: '', colors: ['#f4f1e8', '#1d2433', '#ff2e88'] }, [
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'lines', label: 'Tracks (separate them with ;)', kind: 'text', max: 600 },
  ]),
  gear('gaffer_tape', 'Gaffer tape', 'A torn strip of tape with your name in marker.', '🩹', GafferTape, 1, { text: '', w: 0.2, colors: ['#1b1b1d', '#f4f1e8', '#15171b'] }, [
    { key: 'text', label: 'Written on it (blank: your name)', kind: 'text' },
    { key: 'w', label: 'Length (m)', kind: 'number', min: 0.05, max: 0.6, step: 0.01 },
  ]),
  gear('record_crate', 'Record crate', 'A 12-inch crate of records with made-up sleeve art, leaning back the way they do.', '📦', RecordCrate, 5, { material: 'maple', count: 24, seed: 3, colors: ['#d9b98c', '#d9d4c8', '#ff9f1c'] }, [
    { key: 'count', label: 'Records', kind: 'number', min: 4, max: 40, step: 1 },
    { key: 'seed', label: 'Shuffle the sleeves', kind: 'number', min: 0, max: 99, step: 1 },
  ]),
  gear('water_bottle', 'Water bottle', 'Because it’s hot in here.', '🍶', WaterBottle, 2, { colors: ['#2ec4f1', '#e8ebf0', '#2ec4f1'] }),
];
